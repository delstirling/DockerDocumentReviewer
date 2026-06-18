import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db/client";
import { analysisSessions, analysisSteps } from "@/db/schema";
import { eq, and } from "drizzle-orm";

export const maxDuration = 60;

/**
 * GET /api/sessions/[id]/progress
 * Poll analysis progress for a session (user-authenticated)
 *
 * Returns current status, progress, and heartbeat information for UI auto-resume.
 */
export async function GET(
  req: NextRequest,
  segmentData: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const authenticatedUserId = Number(session.user.id);

    const params = await segmentData.params;
    const sessionId = Number(params.id);

    // Select only the columns needed for progress response
    // Avoids fetching large JSON fields like analysisResult, metadata, workflowSnapshot
    const [analysisSession] = await db
      .select({
        id: analysisSessions.id,
        userId: analysisSessions.userId,
        status: analysisSessions.status,
        currentStep: analysisSessions.currentStep,
        totalSteps: analysisSessions.totalSteps,
        metadata: analysisSessions.metadata,
        startedAt: analysisSessions.startedAt,
        completedAt: analysisSessions.completedAt,
        updatedAt: analysisSessions.updatedAt,
        lastActivityAt: analysisSessions.lastActivityAt,
        isResuming: analysisSessions.isResuming,
        continuationCount: analysisSessions.continuationCount,
        processingLockId: analysisSessions.processingLockId,
        processingWorkerType: analysisSessions.processingWorkerType,
        processingLockAcquiredAt: analysisSessions.processingLockAcquiredAt,
        processingLockExpiresAt: analysisSessions.processingLockExpiresAt,
      })
      .from(analysisSessions)
      .where(eq(analysisSessions.id, Number(sessionId)))
      .limit(1);

    if (!analysisSession) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    if (analysisSession.userId !== authenticatedUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const isComplete = analysisSession.status === "complete";
    const isError = analysisSession.status === "error";
    const isProcessing = analysisSession.status === "processing";

    const currentStep = analysisSession.currentStep || 0;
    const totalSteps = analysisSession.totalSteps || 0;
    const progressPercentage =
      totalSteps > 0 ? Math.round((currentStep / totalSteps) * 100) : 0;

    const metadata = (analysisSession.metadata as any) || {};
    const finalStepId = metadata.finalStepId;

    let finalStepCompleted = false;
    let isFinalized = metadata.isFinalized === true;

    if (finalStepId) {
      const finalStepRecord = await db
        .select()
        .from(analysisSteps)
        .where(
          and(
            eq(analysisSteps.analysisSessionId, sessionId),
            eq(analysisSteps.stepId, finalStepId),
          ),
        )
        .limit(1);
      finalStepCompleted = finalStepRecord.length > 0;
    }

    return NextResponse.json(
      {
        success: true,
        sessionId: sessionId,
        status: analysisSession.status,
        currentStep: currentStep,
        totalSteps: totalSteps,
        progressPercentage: progressPercentage,
        isComplete: isComplete,
        isError: isError,
        isProcessing: isProcessing,
        finalStepCompleted: finalStepCompleted,
        isFinalized: isFinalized,
        canDownloadFullReport:
          isComplete && (finalStepCompleted || isFinalized),
        startedAt: analysisSession.startedAt,
        completedAt: analysisSession.completedAt,
        updatedAt: analysisSession.updatedAt,
        lastActivityAt: analysisSession.lastActivityAt,
        isResuming: analysisSession.isResuming,
        continuationCount: analysisSession.continuationCount ?? 0,
        // Distributed lock information
        processingLock: analysisSession.processingLockId
          ? {
              lockId: analysisSession.processingLockId,
              workerType: analysisSession.processingWorkerType,
              acquiredAt: analysisSession.processingLockAcquiredAt,
              expiresAt: analysisSession.processingLockExpiresAt,
              isExpired:
                analysisSession.processingLockExpiresAt &&
                new Date(analysisSession.processingLockExpiresAt) < new Date(),
            }
          : null,
        message: isComplete
          ? "Analysis complete."
          : isError
            ? "Analysis failed."
            : isProcessing
              ? `Analysis in progress: ${currentStep}/${totalSteps} steps completed.`
              : "Analysis not started.",
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
          Pragma: "no-cache",
          Expires: "0",
        },
      },
    );
  } catch (error: any) {
    console.error("[Progress API] Error fetching progress:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch progress" },
      { status: 500 },
    );
  }
}
