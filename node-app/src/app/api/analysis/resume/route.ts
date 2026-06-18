import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db/client";
import { analysisSessions } from "@/db/schema";
import { eq } from "drizzle-orm";

export const maxDuration = 800;

/**
 * Validate that the request is authenticated via either:
 * 1. A valid user session (NextAuth)
 * 2. The INTERNAL_API_TOKEN header (for internal orchestrator calls)
 * 3. A valid INTERNAL_API_TOKEN in the Authorization header (for testing)
 */
async function authenticateResumeRequest(
  req: NextRequest,
): Promise<NextResponse | null> {
  // Check bypass header for internal orchestrator calls
  const bypassHeader = req.headers.get("x-internal-api-token");
  if (
    bypassHeader &&
    process.env.INTERNAL_API_TOKEN &&
    bypassHeader === process.env.INTERNAL_API_TOKEN
  ) {
    return null; // Authenticated via bypass
  }

  // Check INTERNAL_API_TOKEN for testing/automation calls
  const authHeader = req.headers.get("authorization");
  if (authHeader && process.env.INTERNAL_API_TOKEN) {
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (token === process.env.INTERNAL_API_TOKEN) {
      return null; // Authenticated via INTERNAL_API_TOKEN
    }
  }

  // Check user session
  const session = await auth();
  if (session?.user?.id) {
    return null; // Authenticated via session
  }

  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function POST(req: NextRequest) {
  try {
    // SECURITY: Authenticate before processing
    const authError = await authenticateResumeRequest(req);
    if (authError) return authError;

    const { sessionId } = await req.json();

    if (!sessionId) {
      return NextResponse.json(
        { error: "sessionId is required" },
        { status: 400 },
      );
    }

    console.log(`[Analysis Resume] Resuming analysis for session ${sessionId}`);

    await db
      .update(analysisSessions)
      .set({
        isResuming: true,
        updatedAt: new Date(),
      })
      .where(eq(analysisSessions.id, Number(sessionId)));

    console.log(
      `[Analysis Resume] Set isResuming=true for session ${sessionId}`,
    );

    // DIRECT INVOCATION: Call the stream handler directly instead of making an
    // HTTP fetch. This avoids platform's automatic recursion protection which
    // detects same-deployment fetch chains and returns 508 "Loop Detected".
    const { POST: streamHandler } =
      await import("@/app/api/analysis/[id]/stream/route");

    const origin = req.nextUrl.origin;
    let streamUrl = `${origin}/api/analysis/${sessionId}/stream`;

    if (process.env.INTERNAL_API_TOKEN) {
      streamUrl += `?x-internal-api-token=${process.env.INTERNAL_API_TOKEN}`;
    }

    console.log(
      `[Analysis Resume] Invoking stream handler directly for session ${sessionId}`,
    );

    const streamHeaders = new Headers({
      "Content-Type": "application/json",
      Authorization: req.headers.get("Authorization") || "",
    });

    const bypassHeader = req.headers.get("x-internal-api-token");
    if (bypassHeader) {
      streamHeaders.set("x-internal-api-token", bypassHeader);
    }

    const incomingHost = req.headers.get("host");
    if (incomingHost) {
      streamHeaders.set("host", incomingHost);
    }

    const syntheticRequest = new NextRequest(streamUrl, {
      method: "POST",
      headers: streamHeaders,
    });

    const response = await streamHandler(syntheticRequest, {
      params: Promise.resolve({ id: sessionId }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Analysis Resume] Stream request failed:`, errorText);
      return NextResponse.json(
        { error: "Failed to resume analysis", details: errorText },
        { status: response.status },
      );
    }

    const reader = response.body?.getReader();
    if (!reader) {
      console.error(`[Analysis Resume] No reader available for stream`);
      return NextResponse.json(
        { error: "No reader available for stream" },
        { status: 500 },
      );
    }

    try {
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
      console.log(`[Analysis Resume] Chunk completed for session ${sessionId}`);
    } catch (error) {
      console.error(
        `[Analysis Resume] Error reading stream for session ${sessionId}:`,
        error,
      );
      return NextResponse.json(
        {
          error:
            error instanceof Error ? error.message : "Stream reading failed",
        },
        { status: 500 },
      );
    } finally {
      reader.releaseLock();
    }

    // Select only columns needed for status check
    const [updatedSession] = await db
      .select({
        id: analysisSessions.id,
        status: analysisSessions.status,
        currentStep: analysisSessions.currentStep,
        totalSteps: analysisSessions.totalSteps,
      })
      .from(analysisSessions)
      .where(eq(analysisSessions.id, Number(sessionId)))
      .limit(1);

    if (!updatedSession) {
      return NextResponse.json(
        { error: "Session not found after chunk completion" },
        { status: 404 },
      );
    }

    console.log(
      `[Analysis Resume] Session status after chunk: ${updatedSession.status}, currentStep: ${updatedSession.currentStep}`,
    );

    if (updatedSession.status === "complete") {
      return NextResponse.json({
        success: true,
        sessionId,
        status: "complete",
        currentStep: updatedSession.currentStep,
        message: "Analysis completed successfully.",
      });
    }

    if (updatedSession.status === "error") {
      return NextResponse.json(
        {
          error: "Analysis failed",
          sessionId,
          status: "error",
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      sessionId,
      status: "processing",
      currentStep: updatedSession.currentStep,
      message:
        "Chunk completed. Analysis still in progress. UI will auto-resume.",
    });
  } catch (error: unknown) {
    console.error("[Analysis Resume] Error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to resume analysis",
      },
      { status: 500 },
    );
  }
}
