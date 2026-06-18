import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { analysisSessions, continuationJobs } from "@/db/schema";
import { and, eq, lt, or, isNull, asc, gte, gt } from "drizzle-orm";
import { triggerOrchestratorNow, getBaseUrl } from "@/lib/orchestrator-trigger";
import {
  createContinuationJob,
  resetExpiredLease,
  claimNextJob,
  cancelSupersededJobs,
  failContinuationJob,
  completeContinuationJob,
} from "@/lib/continuation-jobs";
import { finalizeSession } from "@/lib/analysis-helpers/finalize-session";

export const maxDuration = 60; // 1 minute for watchdog
export const runtime = "nodejs";

/**
 * Watchdog Cron Endpoint
 *
 * Runs every 2 minutes to detect stalled sessions and force continuation.
 *
 * Responsibilities:
 * 1. Find sessions with status="processing" and lastActivityAt > 5 minutes ago
 * 2. Find sessions with status="complete" but incomplete steps (premature completion bug)
 * 3. Create continuation jobs for stalled sessions (if not already exists)
 * 4. Find jobs with expired leases and reset them
 * 5. Trigger orchestrator for pending jobs
 *
 * This ensures analyses complete reliably even if fire-and-forget triggers fail.
 */
export async function GET(req: NextRequest) {
  const startTime = Date.now();

  // SECURITY: Verify platform Cron secret to prevent unauthorized access
  const authHeader = req.headers.get("authorization");
  const bypassHeader = req.headers.get("x-internal-api-token");
  const hasCronSecret =
    authHeader === `Bearer ${process.env.CRON_SECRET}` &&
    !!process.env.CRON_SECRET;
  const hasBypassSecret =
    bypassHeader === process.env.INTERNAL_API_TOKEN &&
    !!process.env.INTERNAL_API_TOKEN;

  if (!hasCronSecret && !hasBypassSecret) {
    console.error("[Watchdog] Unauthorized access attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  console.log("[Watchdog] Starting watchdog cron run");

  // CRITICAL: Warn if not running in production (crons only work in production)
  const platformEnv = process.env.RUNTIME_ENV || process.env.NODE_ENV;
  if (platformEnv !== "production") {
    console.warn(
      `[Watchdog] ⚠️ WARNING: Running in ${platformEnv} environment - platform crons ONLY execute in production!`,
    );
    console.warn(
      "[Watchdog] This endpoint can be called manually but will NOT auto-execute via cron.",
    );
  } else {
    console.log(
      "[Watchdog] ✅ Running in production - cron will execute automatically",
    );
  }

  try {
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    // SAFETY IMPROVEMENT: Only pick up sessions with NO active processing lock.
    // If processingLockId is set, a worker is actively processing — don't interfere.
    // This prevents the watchdog from "rushing" sessions that are genuinely slow
    // due to complex steps (e.g., large document analysis, iterative steps).
    const stalledSessions = await db
      .select()
      .from(analysisSessions)
      .where(
        and(
          eq(analysisSessions.status, "processing"),
          isNull(analysisSessions.processingLockId),
          or(
            lt(analysisSessions.lastActivityAt, fiveMinutesAgo),
            isNull(analysisSessions.lastActivityAt),
          ),
        ),
      )
      .limit(100);

    // FAST-PATH: Detect definitively orphaned sessions that explicitly paused
    // with PAUSE_INSUFFICIENT_TIME — these are sessions where the chunk completed
    // normally and expected the orchestrator to trigger a continuation, but the
    // orchestrator died (e.g., platform timeout). These can be recovered faster
    // (2 min threshold vs 5 min) because the PAUSE decision is unambiguous.
    // Note: These overlap with stalledSessions when lastActivityAt > 5 min, but
    // we use a shorter threshold (2 min) to catch them sooner.
    const orphanedPausedSessions = await db
      .select()
      .from(analysisSessions)
      .where(
        and(
          eq(analysisSessions.status, "processing"),
          isNull(analysisSessions.processingLockId),
          or(
            lt(analysisSessions.lastActivityAt, twoMinutesAgo),
            isNull(analysisSessions.lastActivityAt),
          ),
        ),
      )
      .limit(100);

    // Filter orphanedPausedSessions to only those with PAUSE_INSUFFICIENT_TIME metadata
    const confirmedOrphans = orphanedPausedSessions.filter((session) => {
      const metadata = (session.metadata as Record<string, unknown>) || {};
      const diagnostics = metadata.lastPreStepGateDiagnostics as
        | Record<string, unknown>
        | undefined;
      return diagnostics?.decision === "PAUSE_INSUFFICIENT_TIME";
    });

    // Merge: use confirmedOrphans (2-min threshold) + stalledSessions (5-min threshold),
    // deduplicating by session ID
    const seenIds = new Set<string>();
    const mergedSessions: typeof stalledSessions = [];

    // Add confirmed orphans first (faster recovery)
    for (const session of confirmedOrphans) {
      const sessionId = String(session.id);
      if (!seenIds.has(sessionId)) {
        seenIds.add(sessionId);
        mergedSessions.push(session);
      }
    }
    // Add remaining stalled sessions
    for (const session of stalledSessions) {
      const sessionId = String(session.id);
      if (!seenIds.has(sessionId)) {
        seenIds.add(sessionId);
        mergedSessions.push(session);
      }
    }

    console.log(
      `[Watchdog] Found ${mergedSessions.length} stalled sessions ` +
        `(${confirmedOrphans.length} confirmed orphans via PAUSE_INSUFFICIENT_TIME, ` +
        `${stalledSessions.length} stale >5min with no lock)`,
    );

    // Filter out sessions with permanent failure metadata.
    // These sessions are stuck in "processing" status but have metadata indicating
    // they will never recover (e.g., reportingValidationFailed, watchdogError,
    // criticalStepFailure with retriesExhausted). Mark them as "error" and skip.
    const recoverableSessions: typeof mergedSessions = [];
    let permanentFailuresFound = 0;

    for (const session of mergedSessions) {
      const metadata = (session.metadata as Record<string, unknown>) || {};
      const isReportingValidationFailure =
        metadata.reportingValidationFailed === true;
      const isWatchdogPermanentFailure =
        typeof metadata.watchdogError === "string" &&
        (metadata.watchdogError as string).length > 0;
      const isCriticalStepFailure =
        metadata.criticalStepFailure !== undefined &&
        (metadata.criticalStepFailure as Record<string, unknown>)
          ?.retriesExhausted === true;

      if (
        isReportingValidationFailure ||
        isWatchdogPermanentFailure ||
        isCriticalStepFailure
      ) {
        permanentFailuresFound++;
        console.log(
          `[Watchdog] Skipping permanently-failed session ${session.id} ` +
            `(reportingValidation=${isReportingValidationFailure}, watchdog=${isWatchdogPermanentFailure}, ` +
            `criticalStep=${isCriticalStepFailure}). Marking as error and cancelling jobs.`,
        );

        // Ensure the session is marked as "error" (it may still be "processing")
        try {
          await db
            .update(analysisSessions)
            .set({
              status: "error",
              updatedAt: new Date(),
            })
            .where(eq(analysisSessions.id, session.id));

          // Cancel any active continuation jobs for this session
          await failContinuationJob(
            session.id,
            "Permanent failure detected by watchdog — session is not recoverable",
          );
        } catch (cleanupErr) {
          console.error(
            `[Watchdog] Failed to clean up permanently-failed session ${session.id}:`,
            cleanupErr,
          );
        }
        continue;
      }

      recoverableSessions.push(session);
    }

    if (permanentFailuresFound > 0) {
      console.log(
        `[Watchdog] Skipped ${permanentFailuresFound} permanently-failed sessions, ` +
          `${recoverableSessions.length} recoverable sessions remain`,
      );
    }

    const prematureCompleteSessions = await db
      .select()
      .from(analysisSessions)
      .where(
        and(
          eq(analysisSessions.status, "complete"),
          or(
            isNull(analysisSessions.completedAt),
            lt(analysisSessions.currentStep, analysisSessions.totalSteps),
          ),
        ),
      )
      .limit(10);

    console.log(
      `[Watchdog] Found ${prematureCompleteSessions.length} premature-complete sessions`,
    );

    const MAX_WATCHDOG_RESETS = 3;
    const sessionsActuallyReset: typeof prematureCompleteSessions = [];

    for (const session of prematureCompleteSessions) {
      const metadata = (session.metadata as Record<string, unknown>) || {};
      const watchdogResetCount =
        typeof metadata.watchdogResetCount === "number"
          ? metadata.watchdogResetCount
          : 0;

      console.warn(
        `[Watchdog] PREMATURE COMPLETION DETECTED: Session ${session.id} marked complete but currentStep=${session.currentStep} < totalSteps=${session.totalSteps} OR completedAt=${session.completedAt} (reset count: ${watchdogResetCount}/${MAX_WATCHDOG_RESETS})`,
      );

      if (watchdogResetCount >= MAX_WATCHDOG_RESETS) {
        console.error(
          `[Watchdog] Session ${session.id} has been reset ${watchdogResetCount} times without progressing. Marking as error to prevent infinite loop.`,
        );
        try {
          await db
            .update(analysisSessions)
            .set({
              status: "error",
              updatedAt: new Date(),
              metadata: {
                ...metadata,
                watchdogResetCount,
                watchdogError: `Exceeded max resets (${MAX_WATCHDOG_RESETS}). Session stuck at step ${session.currentStep}/${session.totalSteps}.`,
                watchdogErrorAt: new Date().toISOString(),
              },
            })
            .where(eq(analysisSessions.id, session.id));

          console.log(
            `[Watchdog] Marked session ${session.id} as error after ${watchdogResetCount} failed resets`,
          );
        } catch (error) {
          console.error(
            `[Watchdog] Failed to mark session ${session.id} as error:`,
            error,
          );
        }
        continue;
      }

      try {
        await db
          .update(analysisSessions)
          .set({
            status: "processing",
            updatedAt: new Date(),
            lastActivityAt: new Date(),
            metadata: {
              ...metadata,
              watchdogResetCount: watchdogResetCount + 1,
              lastWatchdogResetAt: new Date().toISOString(),
            },
          })
          .where(eq(analysisSessions.id, session.id));

        sessionsActuallyReset.push(session);
        console.log(
          `[Watchdog] Reset session ${session.id} from complete to processing (attempt ${watchdogResetCount + 1}/${MAX_WATCHDOG_RESETS})`,
        );
      } catch (error) {
        console.error(
          `[Watchdog] Failed to reset session ${session.id}:`,
          error,
        );
      }
    }

    // =========================================================================
    // DETECTION: Sessions at 100% progress that haven't completed
    // =========================================================================
    // These sessions have currentStep >= totalSteps (100% according to stored value)
    // but are still in "processing" status. This can happen when:
    // 1. totalSteps was set incorrectly (fewer than actual workflow steps)
    // 2. finalizeSession failed silently
    // 3. Workflow snapshot has more steps than totalSteps
    //
    // Fix: Check the workflow snapshot. If snapshot steps match totalSteps, finalize.
    // If snapshot has more steps, update totalSteps and trigger orchestrator.
    // =========================================================================
    const stuckAt100PercentSessions = await db
      .select()
      .from(analysisSessions)
      .where(
        and(
          eq(analysisSessions.status, "processing"),
          isNull(analysisSessions.processingLockId),
          // currentStep >= totalSteps means 100% progress according to stored value
          // Using Drizzle's gte operator for type-safe column-to-column comparison
          gte(analysisSessions.currentStep, analysisSessions.totalSteps),
          // totalSteps must be set (non-null and > 0)
          gt(analysisSessions.totalSteps, 0),
          // Must be stale (no activity for 2+ minutes)
          lt(analysisSessions.lastActivityAt, twoMinutesAgo),
        ),
      )
      .limit(20);

    console.log(
      `[Watchdog] Found ${stuckAt100PercentSessions.length} sessions stuck at 100% progress`,
    );

    let sessionsFixedAt100Percent = 0;
    let sessionsTotalStepsUpdated = 0;
    for (const session of stuckAt100PercentSessions) {
      const metadata = (session.metadata as Record<string, unknown>) || {};
      const workflowSnapshot = metadata.workflowSnapshot as
        | Array<{ id: string; name: string }>
        | undefined;

      console.log(
        `[Watchdog] Checking stuck session ${session.id}: currentStep=${session.currentStep}, ` +
          `totalSteps=${session.totalSteps}, snapshotLength=${workflowSnapshot?.length || 0}`,
      );

      // Validate workflowSnapshot exists and is a non-empty array
      if (
        !workflowSnapshot ||
        !Array.isArray(workflowSnapshot) ||
        workflowSnapshot.length === 0
      ) {
        // No valid snapshot - can't determine correct totalSteps, skip this session
        console.warn(
          `[Watchdog] Session ${session.id} has no valid workflow snapshot (type: ${typeof workflowSnapshot}, ` +
            `isArray: ${Array.isArray(workflowSnapshot)}, length: ${workflowSnapshot?.length}), cannot fix`,
        );
        continue;
      }

      const snapshotStepCount = workflowSnapshot.length;
      const storedTotalSteps = session.totalSteps || 0;
      const currentStep = session.currentStep || 0;

      if (snapshotStepCount > storedTotalSteps) {
        // Workflow snapshot has more steps than totalSteps - update totalSteps
        // This allows the orchestrator to continue processing remaining steps
        console.log(
          `[Watchdog] Session ${session.id}: Snapshot has ${snapshotStepCount} steps but ` +
            `totalSteps=${storedTotalSteps}. Updating totalSteps to match snapshot.`,
        );

        try {
          await db
            .update(analysisSessions)
            .set({
              totalSteps: snapshotStepCount,
              updatedAt: new Date(),
              lastActivityAt: new Date(),
              metadata: {
                ...metadata,
                watchdogTotalStepsFix: {
                  timestamp: new Date().toISOString(),
                  previousTotalSteps: storedTotalSteps,
                  newTotalSteps: snapshotStepCount,
                  currentStep,
                  reason: "totalSteps mismatch with workflow snapshot",
                },
              },
            })
            .where(eq(analysisSessions.id, session.id));

          sessionsTotalStepsUpdated++;
          console.log(
            `[Watchdog] Updated totalSteps for session ${session.id}: ${storedTotalSteps} -> ${snapshotStepCount}`,
          );

          // Create a continuation job so the orchestrator picks it up
          const jobResult = await createContinuationJob(String(session.id));
          if (jobResult.created) {
            console.log(
              `[Watchdog] Created continuation job for fixed session ${session.id}`,
            );
          }
        } catch (updateErr) {
          console.error(
            `[Watchdog] Failed to update totalSteps for session ${session.id}:`,
            updateErr,
          );
        }
      } else if (currentStep >= snapshotStepCount) {
        // currentStep >= snapshotStepCount means all steps have been processed
        // The session should be finalized. Try to finalize it now.
        console.log(
          `[Watchdog] Session ${session.id}: All ${snapshotStepCount} steps processed ` +
            `(currentStep=${currentStep}). Attempting to finalize.`,
        );

        try {
          // Set finalStepCompleted to allow finalizeSession to proceed
          await db
            .update(analysisSessions)
            .set({
              finalStepCompleted: true,
              updatedAt: new Date(),
              metadata: {
                ...metadata,
                watchdogFinalizeFix: {
                  timestamp: new Date().toISOString(),
                  currentStep,
                  totalSteps: storedTotalSteps,
                  snapshotStepCount,
                  reason: "Session stuck at 100% - watchdog forcing finalization",
                },
              },
            })
            .where(eq(analysisSessions.id, session.id));

          // Call finalizeSession to complete the session
          const finalizedSession = await finalizeSession(String(session.id));

          if (finalizedSession.status === "complete") {
            sessionsFixedAt100Percent++;
            console.log(
              `[Watchdog] Successfully finalized session ${session.id}`,
            );

            // Mark continuation job as completed since session is now done
            await completeContinuationJob(String(session.id));
          } else {
            console.warn(
              `[Watchdog] finalizeSession returned status=${finalizedSession.status} ` +
                `for session ${session.id}, expected 'complete'`,
            );
          }
        } catch (finalizeErr) {
          console.error(
            `[Watchdog] Failed to finalize session ${session.id}:`,
            finalizeErr,
          );
        }
      } else {
        // Edge case: snapshotStepCount === storedTotalSteps but currentStep < snapshotStepCount
        // This shouldn't happen given our query (currentStep >= totalSteps), but log it for debugging
        console.warn(
          `[Watchdog] Unexpected state for session ${session.id}: ` +
            `snapshotStepCount=${snapshotStepCount}, storedTotalSteps=${storedTotalSteps}, ` +
            `currentStep=${currentStep}. Session may need manual investigation.`,
        );
      }
    }

    if (stuckAt100PercentSessions.length > 0) {
      console.log(
        `[Watchdog] 100% stuck sessions: ${sessionsFixedAt100Percent} finalized, ` +
          `${sessionsTotalStepsUpdated} totalSteps updated`,
      );
    }

    const allStalledSessions = [
      ...recoverableSessions,
      ...sessionsActuallyReset,
    ];

    let jobsCreated = 0;
    for (const session of allStalledSessions) {
      try {
        // Use idempotent job creation - handles duplicate key errors gracefully
        const result = await createContinuationJob(String(session.id));
        if (result.created) {
          jobsCreated++;
          console.log(
            `[Watchdog] Created continuation job for stalled session ${session.id}`,
          );
        } else if (result.job) {
          console.log(
            `[Watchdog] Job already exists for session ${session.id} (idempotent)`,
          );
        } else if (result.error) {
          console.error(
            `[Watchdog] Failed to create job for session ${session.id}: ${result.error}`,
          );
        }

        // Clean up any duplicate jobs for this session
        await cancelSupersededJobs(String(session.id));
      } catch (error) {
        console.error(
          `[Watchdog] Failed to create job for session ${session.id}:`,
          error,
        );
      }
    }

    const now = new Date();
    // Increased limit from 20 to 200 to handle backlog of expired leases
    // With 283+ expired jobs, a limit of 20 was causing sessions to get stuck
    const expiredJobs = await db
      .select()
      .from(continuationJobs)
      .where(
        and(
          eq(continuationJobs.status, "processing"),
          lt(continuationJobs.leaseUntil, now),
        ),
      )
      .limit(200);

    console.log(`[Watchdog] Found ${expiredJobs.length} expired leases`);

    let leasesReset = 0;
    let expiredJobsCancelled = 0;
    for (const job of expiredJobs) {
      try {
        // Before resetting a lease, check if the associated session is permanently failed.
        // If so, cancel the job instead of resetting it to break the retry cycle.
        const [jobSession] = await db
          .select({
            id: analysisSessions.id,
            status: analysisSessions.status,
            metadata: analysisSessions.metadata,
          })
          .from(analysisSessions)
          .where(eq(analysisSessions.id, job.sessionId))
          .limit(1);

        if (jobSession) {
          const jobMeta =
            (jobSession.metadata as Record<string, unknown>) || {};
          const isPermanent =
            jobMeta.reportingValidationFailed === true ||
            (typeof jobMeta.watchdogError === "string" &&
              (jobMeta.watchdogError as string).length > 0) ||
            (jobMeta.criticalStepFailure !== undefined &&
              (jobMeta.criticalStepFailure as Record<string, unknown>)
                ?.retriesExhausted === true);

          if (isPermanent) {
            // Session is permanently failed — cancel the job
            await failContinuationJob(
              job.sessionId,
              `Session permanently failed — cancelling expired lease job`,
            );
            expiredJobsCancelled++;
            console.log(
              `[Watchdog] Cancelled expired job ${job.id} for permanently-failed session ${job.sessionId}`,
            );
            continue;
          }
        }

        // Use safe lease reset that checks for existing pending jobs
        // This prevents duplicate key constraint violations
        const wasReset = await resetExpiredLease(String(job.id));
        if (wasReset) {
          leasesReset++;
          console.log(`[Watchdog] Reset expired lease for job ${job.id}`);
        } else {
          // If not reset, clean up duplicate jobs for this session
          console.log(
            `[Watchdog] Job ${job.id} not reset (another pending job exists), cleaning up duplicates`,
          );
          await cancelSupersededJobs(String(job.sessionId));
        }
      } catch (error) {
        console.error(
          `[Watchdog] Failed to reset lease for job ${job.id}:`,
          error,
        );
      }
    }

    const pendingJobs = await db
      .select()
      .from(continuationJobs)
      .where(
        and(
          eq(continuationJobs.status, "pending"),
          lt(continuationJobs.visibleAt, now),
        ),
      )
      .orderBy(asc(continuationJobs.visibleAt), asc(continuationJobs.createdAt))
      .limit(50); // Trigger max 50 orchestrators per run (increased from 10 to clear backlog faster)

    console.log(
      `[Watchdog] Found ${pendingJobs.length} pending jobs to trigger`,
    );

    const baseUrl = getBaseUrl(req);
    const bypass = process.env.INTERNAL_API_TOKEN;
    const twoMinutesFromNow = new Date(Date.now() + 2 * 60 * 1000);

    let orchestratorsTriggered = 0;
    let jobsClaimed = 0;
    for (const job of pendingJobs) {
      try {
        const claimed = await db
          .update(continuationJobs)
          .set({
            status: "processing",
            leaseUntil: twoMinutesFromNow,
            updatedAt: now,
          })
          .where(
            and(
              eq(continuationJobs.id, job.id),
              eq(continuationJobs.status, "pending"),
            ),
          )
          .returning();

        if (claimed.length === 0) {
          console.log(
            `[Watchdog] Job ${job.id} already claimed by another process`,
          );
          continue;
        }

        jobsClaimed++;
        console.log(
          `[Watchdog] Claimed job ${job.id} for session ${job.sessionId}`,
        );

        triggerOrchestratorNow(baseUrl, job.sessionId, "watchdog", bypass);
        orchestratorsTriggered++;
        console.log(
          `[Watchdog] Triggered orchestrator for session ${job.sessionId}`,
        );
      } catch (error) {
        console.error(
          `[Watchdog] Failed to claim/trigger job ${job.id}:`,
          error,
        );
      }
    }

    const elapsedMs = Date.now() - startTime;

    console.log(
      `[Watchdog] Completed in ${elapsedMs}ms: ${mergedSessions.length} stalled ` +
        `(${confirmedOrphans.length} confirmed orphans, ${stalledSessions.length} stale >5min, ` +
        `${permanentFailuresFound} permanent, ${recoverableSessions.length} recoverable), ` +
        `${prematureCompleteSessions.length} premature-complete, ` +
        `${stuckAt100PercentSessions.length} stuck at 100% (${sessionsFixedAt100Percent} finalized, ${sessionsTotalStepsUpdated} totalSteps updated), ` +
        `${jobsCreated} jobs created, ` +
        `${leasesReset} leases reset, ${expiredJobsCancelled} expired jobs cancelled, ` +
        `${jobsClaimed} jobs claimed, ${orchestratorsTriggered} orchestrators triggered`,
    );

    return NextResponse.json({
      success: true,
      elapsedMs,
      stalledSessions: mergedSessions.length,
      confirmedOrphans: confirmedOrphans.length,
      stalledNoLock: stalledSessions.length,
      permanentFailuresFound,
      recoverableSessions: recoverableSessions.length,
      prematureCompleteSessions: prematureCompleteSessions.length,
      stuckAt100Percent: stuckAt100PercentSessions.length,
      sessionsFixedAt100Percent,
      sessionsTotalStepsUpdated,
      jobsCreated,
      leasesReset,
      expiredJobsCancelled,
      jobsClaimed,
      orchestratorsTriggered,
    });
  } catch (error) {
    console.error("[Watchdog] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
