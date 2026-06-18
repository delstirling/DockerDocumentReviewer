import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db/client";
import { analysisSessions, continuationJobs } from "@/db/schema";
import { eq, and, lt, or, isNull } from "drizzle-orm";
import { cleanupExpiredLocks } from "@/lib/distributed-lock";
import { triggerOrchestratorNow, getBaseUrl } from "@/lib/orchestrator-trigger";

export const maxDuration = 60;
export const runtime = "nodejs";

/**
 * POST /api/analysis/[id]/force-recover
 *
 * Manually force recovery of a stuck analysis session.
 * This endpoint provides a fallback recovery mechanism that doesn't rely on cron.
 *
 * Actions taken:
 * 1. Clean up expired locks on the session
 * 2. Reset any stuck continuation jobs for this session
 * 3. Create a new continuation job if needed
 * 4. Trigger the orchestrator
 *
 * Use this when:
 * - Watchdog cron is not running (preview deployments)
 * - Session appears stuck with no progress
 * - Manual intervention is needed
 */
export async function POST(
  req: NextRequest,
  segmentData: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const params = await segmentData.params;
    const sessionId = Number.parseInt(params.id, 10);
    const sessionIdKey = String(sessionId);

    if (!Number.isFinite(sessionId) || sessionId <= 0) {
      return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
    }

    console.log(`[Force-Recover] Starting recovery for session ${sessionId}`);

    // 1. Verify session exists and user has access
    const [analysisSession] = await db
      .select()
      .from(analysisSessions)
      .where(eq(analysisSessions.id, Number(sessionId)))
      .limit(1);

    if (!analysisSession) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    if (analysisSession.userId !== session.user.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    if (analysisSession.status === "complete") {
      return NextResponse.json({
        success: true,
        message: "Session already complete",
        action: "none",
      });
    }

    if (analysisSession.status === "draft") {
      return NextResponse.json({
        success: false,
        message: "Session is in draft status, start analysis first",
        action: "none",
      });
    }

    // 2. Clean up expired locks
    console.log(
      `[Force-Recover] Cleaning expired locks for session ${sessionId}`,
    );
    const locksCleared = await cleanupExpiredLocks(sessionIdKey);
    console.log(`[Force-Recover] Cleared ${locksCleared} expired locks`);

    // 3. Reset stuck continuation jobs for this session
    const now = new Date();
    const twoMinutesAgo = new Date(now.getTime() - 2 * 60 * 1000);

    console.log(`[Force-Recover] Checking for stuck continuation jobs`);
    const stuckJobs = await db
      .select()
      .from(continuationJobs)
      .where(
        and(
          eq(continuationJobs.sessionId, sessionId),
          eq(continuationJobs.status, "processing"),
          or(
            lt(continuationJobs.leaseUntil, twoMinutesAgo),
            isNull(continuationJobs.leaseUntil),
          ),
        ),
      );

    if (stuckJobs.length > 0) {
      console.log(
        `[Force-Recover] Found ${stuckJobs.length} stuck jobs, resetting to pending`,
      );

      for (const job of stuckJobs) {
        await db
          .update(continuationJobs)
          .set({
            status: "pending",
            leaseUntil: null,
            visibleAt: now,
            updatedAt: now,
          })
          .where(eq(continuationJobs.id, job.id));
      }
    }

    // 4. Check if we need to create a new continuation job
    const existingPendingJobs = await db
      .select()
      .from(continuationJobs)
      .where(
        and(
          eq(continuationJobs.sessionId, sessionId),
          eq(continuationJobs.status, "pending"),
        ),
      )
      .limit(1);

    if (
      existingPendingJobs.length === 0 &&
      analysisSession.status === "processing"
    ) {
      // Check if session is actually incomplete
      const currentStep = analysisSession.currentStep ?? 0;
      const totalSteps = analysisSession.totalSteps ?? 0;
      if (currentStep < totalSteps) {
        console.log(`[Force-Recover] Creating new continuation job`);
        await db.insert(continuationJobs).values({
          sessionId: sessionId,
          status: "pending",
          visibleAt: now,
          attempts: 0,
        });
      }
    }

    // 5. Reset session lock fields if they're stale
    await db
      .update(analysisSessions)
      .set({
        processingLockId: null,
        processingLockAcquiredAt: null,
        processingLockExpiresAt: null,
        processingWorkerType: null,
        isResuming: false,
        updatedAt: now,
      })
      .where(eq(analysisSessions.id, Number(sessionId)));

    console.log(`[Force-Recover] Reset session lock fields`);

    // 6. Trigger orchestrator
    const baseUrl = getBaseUrl(req);
    const bypass = process.env.INTERNAL_API_TOKEN;

    console.log(
      `[Force-Recover] Triggering orchestrator for session ${sessionId}`,
    );
    triggerOrchestratorNow(baseUrl, sessionIdKey, "force-recover", bypass);

    return NextResponse.json({
      success: true,
      message: "Recovery initiated successfully",
      actions: {
        locksCleared,
        jobsReset: stuckJobs.length,
        orchestratorTriggered: true,
      },
      nextSteps: [
        "Orchestrator has been triggered",
        "Monitor session progress over next few minutes",
        "If still stuck after 5 minutes, check internal platform logs",
      ],
    });
  } catch (error: unknown) {
    console.error("[Force-Recover] Error:", error);
    const message = error instanceof Error ? error.message : "Recovery failed";
    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}
