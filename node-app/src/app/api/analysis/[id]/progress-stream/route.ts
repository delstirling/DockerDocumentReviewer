import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { ProgressUpdate } from "@/lib/progress-service";
import { db } from "@/db/client";
import { analysisSessions } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * GET /api/analysis/[id]/progress-stream
 *
 * Server-Sent Events (SSE) endpoint for real-time analysis progress updates.
 *
 * Provides live streaming of progress updates as they happen, eliminating the need
 * for client-side polling and ensuring the UI always shows current backend state.
 *
 * Features:
 * - Automatic reconnection handling (built into EventSource)
 * - Heartbeat messages every 15 seconds to keep connection alive
 * - Immediate delivery of current state on connection
 * - Memory-efficient cleanup when session completes
 *
 * Based on Next.js 15 App Router SSE best practices (2025).
 *
 * @see https://www.pedroalonso.net/blog/sse-nextjs-real-time-notifications/
 * @see https://xiouyang.medium.com/building-production-ready-sse-in-next-js-a-complete-guide-18450fb74b7a
 */

// Force dynamic rendering (required for SSE)
export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes max connection time

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    // Authentication check
    const authHeader = req.headers.get("authorization");
    const isTestingAuth =
      authHeader &&
      authHeader.replace(/^Bearer\s+/i, "") === process.env.INTERNAL_API_TOKEN;

    if (!isTestingAuth) {
      const session = await auth();
      if (!session?.user?.id) {
        return new Response("Unauthorized", { status: 401 });
      }
    }

    const resolvedParams = await params;
    const sessionId = resolvedParams.id;

    console.log(
      `[SSE Progress] New connection for session ${sessionId.substring(0, 8)}...`,
    );

    // Verify session exists and user has access - select only needed columns
    const [analysisSession] = await db
      .select({
        id: analysisSessions.id,
        userId: analysisSessions.userId,
        status: analysisSessions.status,
        currentStep: analysisSessions.currentStep,
        totalSteps: analysisSessions.totalSteps,
      })
      .from(analysisSessions)
      .where(eq(analysisSessions.id, Number(sessionId)))
      .limit(1);

    if (!analysisSession) {
      return new Response("Session not found", { status: 404 });
    }

    // If not testing auth, verify ownership (reuse auth session from above)
    if (!isTestingAuth) {
      const authSession = await auth();
      if (analysisSession.userId !== authSession?.user?.id) {
        return new Response("Forbidden", { status: 403 });
      }
    }

    // Create SSE stream with database polling (works reliably in serverless environments)
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        let pollInterval: NodeJS.Timeout | null = null;
        let heartbeatInterval: NodeJS.Timeout | null = null;
        let isActive = true;
        let lastCurrentStep = analysisSession.currentStep || 0;
        let lastStatus = analysisSession.status;

        // Helper to send SSE message
        const sendMessage = (data: ProgressUpdate) => {
          if (!isActive) return;

          try {
            const message = `data: ${JSON.stringify(data)}\n\n`;
            controller.enqueue(encoder.encode(message));
          } catch (error) {
            console.error("[SSE Progress] Error sending message:", error);
          }
        };

        // Send initial state immediately
        const currentStep = analysisSession.currentStep || 0;
        const totalSteps = analysisSession.totalSteps || 0;
        const progressPercentage =
          totalSteps > 0 ? Math.round((currentStep / totalSteps) * 100) : 0;

        console.log(
          `[SSE Progress] Sending initial state: step ${currentStep}/${totalSteps}, status: ${analysisSession.status}`,
        );

        sendMessage({
          sessionId,
          currentStep,
          totalSteps,
          status: analysisSession.status as string,
          progressPercentage,
          timestamp: Date.now(),
          message: `Connected to session ${sessionId.substring(0, 8)}...`,
        });

        // Poll database for updates every 2 seconds
        const pollDatabase = async () => {
          if (!isActive) return;

          try {
            const [session] = await db
              .select({
                id: analysisSessions.id,
                status: analysisSessions.status,
                currentStep: analysisSessions.currentStep,
                totalSteps: analysisSessions.totalSteps,
              })
              .from(analysisSessions)
              .where(eq(analysisSessions.id, Number(sessionId)))
              .limit(1);

            if (!session) {
              console.error("[SSE Progress] Session not found during polling");
              return;
            }

            // Check if progress changed
            const currentStepChanged = session.currentStep !== lastCurrentStep;
            const statusChanged = session.status !== lastStatus;

            if (currentStepChanged || statusChanged) {
              const currentStep = session.currentStep || 0;
              const totalSteps = session.totalSteps || 0;
              const progressPercentage =
                totalSteps > 0
                  ? Math.round((currentStep / totalSteps) * 100)
                  : 0;

              const update: ProgressUpdate = {
                sessionId,
                currentStep,
                totalSteps,
                status: session.status as string,
                progressPercentage,
                timestamp: Date.now(),
                message: `Step ${currentStep}/${totalSteps} - ${session.status}`,
              };

              console.log(
                `[SSE Progress] Progress changed: ${lastCurrentStep} -> ${currentStep}, status: ${lastStatus} -> ${session.status}`,
              );

              sendMessage(update);

              lastCurrentStep = session.currentStep || 0;
              lastStatus = session.status;

              // Close connection when analysis completes
              if (session.status === "complete" || session.status === "error") {
                console.log(
                  `[SSE Progress] Analysis ${session.status}, closing connection in 5 seconds...`,
                );

                setTimeout(() => {
                  if (isActive) {
                    const finalMessage = `data: ${JSON.stringify({
                      type: "close",
                      reason: `Analysis ${session.status}`,
                    })}\n\n`;
                    controller.enqueue(encoder.encode(finalMessage));
                    performCleanup();
                  }
                }, 5000);
              }
            }
          } catch (error) {
            console.error("[SSE Progress] Error polling database:", error);
          }
        };

        // Cleanup function
        const performCleanup = () => {
          if (!isActive) return;

          isActive = false;
          console.log(
            `[SSE Progress] Closing connection for session ${sessionId.substring(0, 8)}...`,
          );

          if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
          }

          if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
          }

          try {
            controller.close();
          } catch (error) {
            // Connection already closed
          }
        };

        // Start polling every 2 seconds
        pollInterval = setInterval(pollDatabase, 2000);

        // Send heartbeat every 15 seconds to keep connection alive
        heartbeatInterval = setInterval(() => {
          if (!isActive) return;

          try {
            const heartbeat = `: heartbeat ${Date.now()}\n\n`;
            controller.enqueue(encoder.encode(heartbeat));
          } catch (error) {
            console.error("[SSE Progress] Error sending heartbeat:", error);
            performCleanup();
          }
        }, 15000);

        // Handle client disconnect
        req.signal.addEventListener("abort", () => {
          console.log(
            `[SSE Progress] Client disconnected for session ${sessionId.substring(0, 8)}...`,
          );
          performCleanup();
        });
      },
    });

    // Return SSE response with proper headers
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no", // Disable nginx buffering
      },
    });
  } catch (error: unknown) {
    console.error("[SSE Progress] Error creating stream:", error);
    return new Response(
      JSON.stringify({
        error: (error as Error).message || "Failed to create progress stream",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
