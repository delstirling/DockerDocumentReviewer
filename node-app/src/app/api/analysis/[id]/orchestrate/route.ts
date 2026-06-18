import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { analysisSessions } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  ORCHESTRATOR_SAFETY_MARGIN_MS,
  ORCHESTRATOR_MAX_TIME_MS,
  ORCHESTRATOR_BASE_DELAY_MS,
  ORCHESTRATOR_MAX_DELAY_MS,
  ORCHESTRATOR_JITTER_MS,
  ANTHROPIC_CACHE_TTL_MS,
  ANTHROPIC_CACHE_SAFE_GAP_MS,
  calculateResumeChunkTimeout,
  hasTimeForResumeChunk,
} from "@/lib/time-budgets";
import {
  cleanupExpiredLocks,
  forceReleaseAllLocks,
} from "@/lib/distributed-lock";
import {
  persistSessionMetadata,
  createErrorMetadata,
  formatErrorWithCause,
} from "@/lib/session-metadata";
import { failContinuationJob } from "@/lib/continuation-jobs";

export const maxDuration = 800; // 13.3 minutes for orchestration loop
export const runtime = "nodejs"; // Explicitly declare Node.js runtime

function defer(promise: Promise<unknown>): void {
  promise.catch((error) => {
    console.error("[Defer] Background task failed:", error);
  });
}

type ResumeResponse = {
  success?: boolean;
  status?: "complete" | "error" | string;
  message?: string;
  error?: string;
  currentStep?: number;
  totalSteps?: number;
};

function isResumeResponse(x: unknown): x is ResumeResponse {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;
  const okBool = (v: unknown) => v === undefined || typeof v === "boolean";
  const okStr = (v: unknown) => v === undefined || typeof v === "string";
  return (
    okBool(o.success) && okStr(o.status) && okStr(o.message) && okStr(o.error)
  );
}

/**
 * Trigger a new orchestrator instance if the session is still processing.
 * Uses fire-and-forget pattern — does NOT await the new orchestrator's response.
 * This prevents sessions from being orphaned when the current orchestrator exits.
 */
async function triggerSelfChainIfNeeded(
  sessionId: string,
  reason: string,
): Promise<void> {
  try {
    const [currentSession] = await db
      .select({
        id: analysisSessions.id,
        status: analysisSessions.status,
        currentStep: analysisSessions.currentStep,
        totalSteps: analysisSessions.totalSteps,
        metadata: analysisSessions.metadata,
      })
      .from(analysisSessions)
      .where(eq(analysisSessions.id, Number(sessionId)))
      .limit(1);

    // Chain if session is still processing, OR if it's in a non-permanent error state.
    // Non-permanent errors (e.g., reporting validation failure with retries remaining)
    // can be recovered by the orchestrator's POST handler which resets error→processing.
    // Don't check currentStep < totalSteps because dynamic workflows may use fewer steps.
    if (
      currentSession &&
      (currentSession.status === "processing" ||
        currentSession.status === "error")
    ) {
      // For error sessions, skip if it's a permanent failure
      if (currentSession.status === "error") {
        const meta = (currentSession.metadata as Record<string, unknown>) || {};
        const isPermanentFailure =
          meta.reportingValidationFailed === true ||
          (typeof meta.watchdogError === "string" &&
            meta.watchdogError.length > 0) ||
          (meta.criticalStepFailure !== undefined &&
            (meta.criticalStepFailure as Record<string, unknown>)
              ?.retriesExhausted === true);

        if (isPermanentFailure) {
          console.log(
            `[Orchestrator] Self-chaining skipped (${reason}): session ${sessionId} is in permanent error state ` +
              `(reportingValidationFailed=${meta.reportingValidationFailed}, watchdogError=${!!meta.watchdogError}, ` +
              `criticalStepFailure=${!!(meta.criticalStepFailure as Record<string, unknown>)?.retriesExhausted}) — not recoverable`,
          );
          return;
        }

        console.log(
          `[Orchestrator] Self-chaining (${reason}): session ${sessionId} is in error state, ` +
            `triggering new orchestrator to attempt recovery (step ${currentSession.currentStep}/${currentSession.totalSteps})`,
        );
      } else {
        console.log(
          `[Orchestrator] Self-chaining (${reason}): triggering new orchestrator for session ${sessionId} (step ${currentSession.currentStep}/${currentSession.totalSteps})`,
        );
      }

      const chainBaseUrl =
        process.env.NEXT_PUBLIC_APP_URL ??
        (process.env.APP_URL
          ? `https://${process.env.APP_URL}`
          : "http://localhost:3000");

      const chainHeaders: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (process.env.INTERNAL_API_TOKEN) {
        chainHeaders["x-internal-api-token"] =
          process.env.INTERNAL_API_TOKEN;
      }

      // Await the fetch so that waitUntil keeps the function alive until the request completes
      await fetch(`${chainBaseUrl}/api/analysis/${sessionId}/orchestrate`, {
        method: "POST",
        headers: chainHeaders,
        cache: "no-store",
      })
        .then((res) => {
          console.log(
            `[Orchestrator] Self-chain trigger response (${reason}): ${res.status}`,
          );
        })
        .catch((err: unknown) => {
          console.error(
            `[Orchestrator] Self-chain trigger fetch failed (${reason}): ${formatErrorWithCause(err)}`,
          );
        });

      console.log(`[Orchestrator] Self-chain trigger sent (${reason})`);
    } else {
      console.log(
        `[Orchestrator] Self-chaining skipped (${reason}): status=${currentSession?.status}, step=${currentSession?.currentStep}/${currentSession?.totalSteps}`,
      );
    }
  } catch (err) {
    console.error(`[Orchestrator] Self-chain trigger failed (${reason}):`, err);
  }
}

/**
 * POST /api/analysis/[id]/orchestrate
 *
 * Server-side auto-orchestration endpoint for UI-started sessions.
 * Loops resume-chunk until analysis completes or function timeout approaches.
 *
 * This endpoint is called automatically when a chunk completes and more work remains.
 * It continues calling resume-chunk until the analysis is complete, an error occurs,
 * or the function approaches its maxDuration limit.
 *
 * Key improvements:
 * - Tracks total orchestration time (not time since last activity)
 * - No artificial max attempts limit
 * - Adds fetch timeouts to prevent hanging
 * - Updates session metadata when stopping gracefully
 * - Uses short jittered backoff for retries
 */
export async function POST(
  req: NextRequest,
  segmentData: { params: Promise<{ id: string }> },
) {
  try {
    // SECURITY: Authenticate orchestrator requests
    // Accepts: bypass header (internal calls), INTERNAL_API_TOKEN (testing), or CRON_SECRET
    const bypassHeader = req.headers.get("x-internal-api-token");
    const authHeader = req.headers.get("authorization");
    const hasBypassAuth =
      bypassHeader &&
      process.env.INTERNAL_API_TOKEN &&
      bypassHeader === process.env.INTERNAL_API_TOKEN;
    const hasTokenAuth =
      authHeader &&
      process.env.INTERNAL_API_TOKEN &&
      authHeader.replace(/^Bearer\s+/i, "") === process.env.INTERNAL_API_TOKEN;

    if (!hasBypassAuth && !hasTokenAuth) {
      console.error("[Orchestrator] Unauthorized access attempt");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const params = await segmentData.params;
    const sessionId = params.id;

    console.log(
      `[Orchestrator] Starting orchestration for session ${sessionId}`,
    );

    // Select only the columns needed for orchestration decisions
    const [session] = await db
      .select({
        id: analysisSessions.id,
        status: analysisSessions.status,
        currentStep: analysisSessions.currentStep,
        totalSteps: analysisSessions.totalSteps,
        continuationCount: analysisSessions.continuationCount,
        lastContinuedAt: analysisSessions.lastContinuedAt,
        lastActivityAt: analysisSessions.lastActivityAt,
        isResuming: analysisSessions.isResuming,
        metadata: analysisSessions.metadata,
      })
      .from(analysisSessions)
      .where(eq(analysisSessions.id, Number(sessionId)))
      .limit(1);

    if (!session) {
      // Cancel any orphaned continuation jobs for this non-existent session
      await failContinuationJob(
        sessionId,
        "Session not found — cancelling orphaned continuation job",
      );
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const metadata = (session.metadata as Record<string, unknown>) || {};
    const sessionOrigin = metadata.origin as string | undefined;
    const effectiveOrigin = sessionOrigin || "ui";

    if (!sessionOrigin) {
      console.warn(
        `[Orchestrator] Session ${sessionId} has no origin in metadata, defaulting to "ui" for orchestration`,
      );
    }

    const allowedOrigins = ["ui", "testing", "chatuserinterface"];
    const isAllowedOrigin = allowedOrigins.includes(effectiveOrigin);

    console.log(`[Orchestrator] Session state:`, {
      sessionId,
      status: session.status,
      currentStep: session.currentStep,
      totalSteps: session.totalSteps,
      continuationCount: session.continuationCount,
      lastContinuedAt: session.lastContinuedAt,
      isResuming: session.isResuming,
      origin: sessionOrigin,
      effectiveOrigin,
      isAllowedOrigin,
    });

    if (session.status === "complete") {
      const metadata = (session.metadata as Record<string, unknown>) || {};
      const finalStepId = metadata.finalStepId as string | undefined;
      const currentStep = session.currentStep ?? 0;
      const totalSteps = session.totalSteps ?? 0;

      if (finalStepId && currentStep < totalSteps) {
        console.warn(
          `[Orchestrator] PREMATURE COMPLETION DETECTED: Session ${sessionId} marked complete but currentStep=${session.currentStep} < totalSteps=${session.totalSteps}. finalStepId=${finalStepId}`,
        );
        console.log(
          `[Orchestrator] Session ${sessionId}: Continuing despite complete status due to incomplete steps`,
        );
      } else {
        console.log(`[Orchestrator] Session ${sessionId} already complete`);
        // Cancel any orphaned continuation jobs so the watchdog stops re-triggering
        await failContinuationJob(
          sessionId,
          "Session already complete — cancelling orphaned continuation job",
        );
        return NextResponse.json({
          success: true,
          message: "Analysis already complete",
          status: "complete",
        });
      }
    }

    if (session.status === "error") {
      // Check if this is a permanent failure that should NOT be retried.
      // Two types of permanent failures:
      // 1. reportingValidationFailed: analysis completed but a critical reporting
      //    step produced insufficient content after exhausting retries.
      // 2. watchdogError: watchdog detected the session is stuck in an infinite
      //    reset loop (e.g., premature completion at step 0) and marked it as
      //    error to break the cycle. Resetting would restart the loop.
      const isReportingValidationFailure =
        metadata.reportingValidationFailed === true;
      const isWatchdogPermanentFailure =
        typeof metadata.watchdogError === "string" &&
        metadata.watchdogError.length > 0;

      if (isReportingValidationFailure) {
        console.error(
          `[Orchestrator] Session ${sessionId} has permanent reporting validation failure - NOT retrying. ` +
            `Invalid steps: ${JSON.stringify(metadata.invalidReportingSteps || [])}`,
        );
        // Cancel continuation jobs so the watchdog stops re-triggering this session
        await failContinuationJob(
          sessionId,
          "Permanent reporting validation failure — not retryable",
        );
        return NextResponse.json({
          success: false,
          message:
            "Analysis failed due to reporting validation - permanent failure, not retryable",
          status: "error",
          permanentFailure: true,
        });
      }

      if (isWatchdogPermanentFailure) {
        console.error(
          `[Orchestrator] Session ${sessionId} has watchdog permanent failure - NOT retrying. ` +
            `Reason: ${metadata.watchdogError}`,
        );
        // Cancel continuation jobs so the watchdog stops re-triggering this session
        await failContinuationJob(
          sessionId,
          `Watchdog permanent failure: ${metadata.watchdogError}`,
        );
        return NextResponse.json({
          success: false,
          message:
            "Analysis failed due to watchdog detection (stuck session) - permanent failure, not retryable",
          status: "error",
          permanentFailure: true,
        });
      }

      const isCriticalStepPermanentFailure =
        metadata.criticalStepFailure !== undefined &&
        (metadata.criticalStepFailure as Record<string, unknown>)
          ?.retriesExhausted === true;

      if (isCriticalStepPermanentFailure) {
        const csf = metadata.criticalStepFailure as Record<string, unknown>;
        console.error(
          `[Orchestrator] Session ${sessionId} has critical step permanent failure - NOT retrying. ` +
            `Step: ${csf?.stepName || "unknown"}, Retries exhausted.`,
        );
        // Cancel continuation jobs so the watchdog stops re-triggering this session
        await failContinuationJob(
          sessionId,
          `Critical step failure (retries exhausted): ${csf?.stepName || "unknown"}`,
        );
        return NextResponse.json({
          success: false,
          message:
            "Analysis failed due to critical step failure (retries exhausted) - permanent failure, not retryable",
          status: "error",
          permanentFailure: true,
        });
      }

      console.log(
        `[Orchestrator] Session ${sessionId} in error state - attempting recovery`,
      );

      // CRITICAL: Check for stale locks before resetting
      const staleLocksCleaned = await cleanupExpiredLocks(sessionId);
      if (staleLocksCleaned > 0) {
        console.log(
          `[Orchestrator] Cleaned ${staleLocksCleaned} stale locks before recovery`,
        );
      }

      // Reset error status to allow retry
      // Also explicitly clear lock-related fields to prevent stuck isResuming
      await db
        .update(analysisSessions)
        .set({
          status: "processing",
          isResuming: false,
          processingLockId: null,
          processingLockAcquiredAt: null,
          processingLockExpiresAt: null,
          processingWorkerType: null,
          updatedAt: new Date(),
        })
        .where(eq(analysisSessions.id, Number(sessionId)));
      console.log(
        `[Orchestrator] Reset session ${sessionId} status from error to processing (cleared locks)`,
      );
      // Continue with orchestration instead of bailing
    }

    // Check cache continuity risk
    const lastActivity = session.lastActivityAt || session.lastContinuedAt;
    const gapMs = lastActivity
      ? Date.now() - new Date(lastActivity).getTime()
      : 0;
    const cacheExpiresIn = ANTHROPIC_CACHE_TTL_MS - gapMs;
    const cacheAtRisk = gapMs > ANTHROPIC_CACHE_SAFE_GAP_MS;
    const cacheExpired = gapMs > ANTHROPIC_CACHE_TTL_MS;

    console.log(
      `[Orchestrator] Cache status: gap=${Math.floor(gapMs / 1000)}s, expiresIn=${Math.floor(cacheExpiresIn / 1000)}s, atRisk=${cacheAtRisk}, expired=${cacheExpired}`,
    );

    if (!isAllowedOrigin) {
      console.warn(
        `[Orchestrator] Session ${sessionId} has disallowed origin (${effectiveOrigin}), skipping orchestration. Allowed: ${allowedOrigins.join(", ")}`,
      );
      // Cancel continuation jobs for disallowed-origin sessions to prevent infinite watchdog retries
      await failContinuationJob(
        sessionId,
        `Disallowed origin (${effectiveOrigin}) — cancelling continuation job`,
      );
      return NextResponse.json({
        success: true,
        message: `Orchestration skipped for origin: ${effectiveOrigin}`,
      });
    }

    const orchestrationStartTime = Date.now();

    let attempt = 0;
    let first409Timestamp: number | null = null;
    const FORCE_RELEASE_AFTER_MS = 60_000; // Force-release locks after 60s of continuous 409s

    // Track consecutive non-transient errors to prevent infinite retrying
    // on persistent failures (e.g., auth issues, bad requests)
    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 5; // After 5 consecutive non-transient errors, self-chain and exit

    // Track no-progress loops: if resume-chunk returns success+processing with
    // the same currentStep repeatedly, the session is stuck (e.g., phase-based
    // completion gap where all phases finished but session status wasn't updated).
    let lastSeenStep: number | null = null;
    let noProgressSinceTimestamp: number | null = null;
    const NO_PROGRESS_TIMEOUT_MS = 90_000; // 90 seconds of no step progress → mark session complete or error

    const jitter = () => Math.random() * ORCHESTRATOR_JITTER_MS;

    while (Date.now() - orchestrationStartTime <= ORCHESTRATOR_MAX_TIME_MS) {
      attempt++;
      const elapsedTime = Date.now() - orchestrationStartTime;

      // CRITICAL GUARD: Check if we have enough remaining time to start a new
      // resume-chunk call. If not, self-chain to a fresh instance instead of
      // starting a fetch that may be killed mid-flight (causing "fetch failed").
      if (!hasTimeForResumeChunk(elapsedTime)) {
        const remainingSec = Math.floor(
          (ORCHESTRATOR_MAX_TIME_MS - elapsedTime) / 1000,
        );
        console.log(
          `[Orchestrator] Session ${sessionId}: Only ${remainingSec}s remaining — insufficient for resume-chunk, self-chaining to new instance`,
        );
        break; // Exit loop → self-chain logic below handles continuation
      }

      console.log(
        `[Orchestrator] Session ${sessionId}: Attempt ${attempt} (${Math.floor(elapsedTime / 1000)}s elapsed, timeout=${Math.floor(calculateResumeChunkTimeout(elapsedTime) / 1000)}s)`,
      );

      try {
        const baseUrl =
          process.env.NEXT_PUBLIC_APP_URL ??
          (process.env.APP_URL
            ? `https://${process.env.APP_URL}`
            : "http://localhost:3000");

        const controller = new AbortController();
        const fetchTimeoutMs = calculateResumeChunkTimeout(elapsedTime);
        const fetchTimeout = setTimeout(
          () => controller.abort(),
          fetchTimeoutMs,
        );

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.INTERNAL_API_TOKEN}`,
          "X-Invoked-By": "orchestrator", // Signal to resume-chunk to skip orchestrator trigger
        };

        if (process.env.INTERNAL_API_TOKEN) {
          headers["x-internal-api-token"] =
            process.env.INTERNAL_API_TOKEN;
        }

        console.log(
          `[Orchestrator] Session ${sessionId}: Calling resume-chunk (Authorization: ${!!process.env.INTERNAL_API_TOKEN}, Bypass: ${!!process.env.INTERNAL_API_TOKEN})`,
        );

        const resumeResponse = await fetch(
          `${baseUrl}/api/testing/sessions/${sessionId}/resume-chunk`,
          {
            method: "POST",
            headers,
            signal: controller.signal,
            cache: "no-store",
          },
        );

        clearTimeout(fetchTimeout);

        const contentType = resumeResponse.headers.get("content-type") || "";
        let resumeData: ResumeResponse;

        if (contentType.includes("application/json")) {
          const parsed: unknown = await resumeResponse.json();
          resumeData = isResumeResponse(parsed) ? parsed : {};
        } else {
          const textBody = await resumeResponse.text();
          console.error(
            `[Orchestrator] Session ${sessionId}: Resume-chunk returned non-JSON response (${resumeResponse.status}): ${textBody.substring(0, 200)}`,
          );
          resumeData = {
            error: `Non-JSON response: ${textBody.substring(0, 100)}`,
          };
        }

        if (resumeResponse.status === 409) {
          // Track when the first consecutive 409 was seen (wall-clock time)
          if (first409Timestamp === null) {
            first409Timestamp = Date.now();
          }
          const continuous409Ms = Date.now() - first409Timestamp;

          console.log(
            `[Orchestrator] Session ${sessionId}: Stream busy (409), continuous for ${Math.round(continuous409Ms / 1000)}s/${Math.round(FORCE_RELEASE_AFTER_MS / 1000)}s, waiting before retry`,
          );

          // CRITICAL FIX: After 60s of continuous 409s (wall-clock time), force-release
          // all locks. This is safe regardless of retry delay timing (cacheAtRisk fast
          // path vs normal backoff) because it measures actual elapsed time, not a
          // counter that could fire in seconds with zero-delay retries.
          if (continuous409Ms >= FORCE_RELEASE_AFTER_MS) {
            console.warn(
              `[Orchestrator] Session ${sessionId}: ${Math.round(continuous409Ms / 1000)}s of continuous 409 responses - FORCE-RELEASING all locks to break stuck loop`,
            );
            const forceReleased = await forceReleaseAllLocks(sessionId);
            console.log(
              `[Orchestrator] Session ${sessionId}: Force-released ${forceReleased} lock(s), resetting timer and retrying`,
            );
            first409Timestamp = null;
            // Short delay then retry - next attempt should succeed
            await new Promise((resolve) => setTimeout(resolve, 1000));
            continue;
          }

          // Cache-aware retry delay: skip delay if cache at risk
          if (cacheAtRisk) {
            console.log(
              `[Orchestrator] Cache at risk - skipping retry delay for fast recovery`,
            );
            // No delay - retry immediately to preserve cache
          } else {
            const delayMs = Math.min(
              ORCHESTRATOR_BASE_DELAY_MS + jitter(),
              ORCHESTRATOR_MAX_DELAY_MS,
            );
            await new Promise((resolve) => setTimeout(resolve, delayMs));
          }
          continue;
        }

        // Reset consecutive 409 tracking on any non-409 response
        first409Timestamp = null;

        // Handle transient network errors (503 Service Unavailable)
        if (resumeResponse.status === 503) {
          console.log(
            `[Orchestrator] Session ${sessionId}: Transient error (503), retrying immediately`,
          );
          // Retry immediately for transient errors - no delay needed
          continue;
        }

        if (!resumeResponse.ok) {
          consecutiveErrors++;
          const msg = resumeData.error ?? resumeData.message ?? "Resume failed";
          console.error(
            `[Orchestrator] Session ${sessionId}: Resume failed with status ${resumeResponse.status} (consecutive errors: ${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS})`,
            resumeData,
          );

          if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            console.error(
              `[Orchestrator] Session ${sessionId}: ${MAX_CONSECUTIVE_ERRORS} consecutive errors — self-chaining to new instance instead of abandoning`,
            );
            // Don't orphan the session — trigger a new orchestrator
            // A fresh instance may succeed if the errors were transient
            defer(
              triggerSelfChainIfNeeded(
                sessionId,
                `consecutive_errors_${consecutiveErrors}`,
              ),
            );
            return NextResponse.json({
              success: false,
              message: `${msg} (self-chained after ${consecutiveErrors} consecutive errors)`,
              attempt,
            });
          }

          // Retry with backoff instead of returning immediately
          const delayMs = Math.min(
            ORCHESTRATOR_BASE_DELAY_MS +
              ORCHESTRATOR_BASE_DELAY_MS / 2 +
              jitter(),
            ORCHESTRATOR_MAX_DELAY_MS,
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }

        if (resumeData.success === true) {
          // Reset consecutive error counter only on genuine success
          consecutiveErrors = 0;
          if (resumeData.status === "complete") {
            console.log(
              `[Orchestrator] Session ${sessionId}: Analysis complete after ${attempt} attempts`,
            );
            // Cancel continuation jobs now that analysis is complete
            await failContinuationJob(
              sessionId,
              "Analysis completed successfully",
            );
            return NextResponse.json({
              success: true,
              message: "Analysis complete",
              status: "complete",
              attempts: attempt,
            });
          }

          if (resumeData.status === "error") {
            console.log(
              `[Orchestrator] Session ${sessionId}: Analysis error after ${attempt} attempts`,
            );
            return NextResponse.json({
              success: false,
              message: "Analysis encountered an error",
              status: "error",
              attempts: attempt,
            });
          }

          // SAFETY: Detect no-progress loops (e.g., phase-based completion gap)
          // If resume-chunk keeps returning the same currentStep, something is stuck.
          const currentStep =
            typeof resumeData.currentStep === "number"
              ? resumeData.currentStep
              : null;
          if (currentStep !== null) {
            if (lastSeenStep === null || currentStep > lastSeenStep) {
              // Progress was made — reset tracker
              lastSeenStep = currentStep;
              noProgressSinceTimestamp = null;
            } else {
              // No progress — start or continue tracking
              if (noProgressSinceTimestamp === null) {
                noProgressSinceTimestamp = Date.now();
              }
              const stuckMs = Date.now() - noProgressSinceTimestamp;
              console.warn(
                `[Orchestrator] Session ${sessionId}: No step progress for ${Math.round(stuckMs / 1000)}s (stuck at step ${currentStep}/${resumeData.totalSteps ?? "?"})`,
              );

              if (stuckMs >= NO_PROGRESS_TIMEOUT_MS) {
                // Re-check the session status directly from DB — the phase-based
                // fix should have set status="complete" by now after a few iterations.
                const [freshSession] = await db
                  .select({
                    id: analysisSessions.id,
                    status: analysisSessions.status,
                    finalStepCompleted: analysisSessions.finalStepCompleted,
                  })
                  .from(analysisSessions)
                  .where(eq(analysisSessions.id, Number(sessionId)))
                  .limit(1);

                if (
                  freshSession?.status === "complete" ||
                  freshSession?.finalStepCompleted
                ) {
                  console.log(
                    `[Orchestrator] Session ${sessionId}: DB shows complete despite resume-chunk returning processing — ending orchestration`,
                  );
                  // Cancel continuation jobs now that analysis is confirmed complete
                  await failContinuationJob(
                    sessionId,
                    "Analysis complete (detected from DB after no-progress timeout)",
                  );
                  return NextResponse.json({
                    success: true,
                    message:
                      "Analysis complete (detected from DB after no-progress timeout)",
                    status: "complete",
                    attempts: attempt,
                  });
                }

                // Session is genuinely stuck — mark as error so it doesn't loop forever
                console.error(
                  `[Orchestrator] Session ${sessionId}: No progress for ${Math.round(stuckMs / 1000)}s and session not complete in DB — marking as error`,
                );
                await db
                  .update(analysisSessions)
                  .set({
                    status: "error",
                    updatedAt: new Date(),
                    metadata: {
                      ...metadata,
                      lastError: {
                        errorMessage: `Orchestrator detected no-progress loop: stuck at step ${currentStep} for ${Math.round(stuckMs / 1000)}s`,
                        source: "orchestrator_no_progress",
                        timestamp: new Date().toISOString(),
                      },
                    },
                  })
                  .where(eq(analysisSessions.id, Number(sessionId)));
                return NextResponse.json({
                  success: false,
                  message: `No progress for ${Math.round(stuckMs / 1000)}s — session marked as error`,
                  status: "error",
                  attempts: attempt,
                });
              }
            }
          }

          const delayMs = Math.min(
            ORCHESTRATOR_BASE_DELAY_MS + jitter(),
            ORCHESTRATOR_MAX_DELAY_MS,
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        } else {
          const msg = resumeData.message ?? "Resume failed";
          console.log(
            `[Orchestrator] Session ${sessionId}: Resume returned success=false, message: ${msg}`,
          );

          if (
            typeof resumeData.message === "string" &&
            resumeData.message.includes("busy")
          ) {
            const delayMs = Math.min(
              ORCHESTRATOR_BASE_DELAY_MS + jitter(),
              ORCHESTRATOR_MAX_DELAY_MS,
            );
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            continue;
          }

          // Retry non-busy failures instead of giving up immediately
          consecutiveErrors++;
          console.warn(
            `[Orchestrator] Session ${sessionId}: Non-busy failure (consecutive errors: ${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}), retrying`,
          );

          if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            console.error(
              `[Orchestrator] Session ${sessionId}: ${MAX_CONSECUTIVE_ERRORS} consecutive non-busy failures — self-chaining to new instance`,
            );
            defer(
              triggerSelfChainIfNeeded(
                sessionId,
                `consecutive_non_busy_failures_${consecutiveErrors}`,
              ),
            );
            return NextResponse.json({
              success: false,
              message: `${msg} (self-chained after ${consecutiveErrors} consecutive failures)`,
              attempts: attempt,
            });
          }

          const errorDelayMs = Math.min(
            ORCHESTRATOR_BASE_DELAY_MS +
              ORCHESTRATOR_BASE_DELAY_MS / 2 +
              jitter(),
            ORCHESTRATOR_MAX_DELAY_MS,
          );
          await new Promise((resolve) => setTimeout(resolve, errorDelayMs));
          continue;
        }
      } catch (error: unknown) {
        const isAbortError =
          error instanceof Error && error.name === "AbortError";

        if (isAbortError) {
          // AbortError is a transient timeout - retry immediately without persisting as error
          // This happens when the resume-chunk call takes longer than expected but may still succeed
          console.log(
            `[Orchestrator] Session ${sessionId}: Resume-chunk timeout at attempt ${attempt} - retrying immediately (transient)`,
          );
          // Short delay to avoid hammering the endpoint
          await new Promise((resolve) => setTimeout(resolve, 1000));
          continue; // Retry immediately without persisting error metadata
        }

        // For non-AbortError errors, log and persist metadata including .cause chain
        console.error(
          `[Orchestrator] Session ${sessionId}: Error during attempt ${attempt}: ${formatErrorWithCause(error)}`,
        );

        try {
          const errorMetadata = createErrorMetadata(error, {
            source: "orchestrator_loop",
            sessionId,
            currentStep: session.currentStep,
            totalSteps: session.totalSteps,
            continuationCount: session.continuationCount ?? 0,
            attempt,
            elapsedTimeMs: Date.now() - orchestrationStartTime,
          });
          await persistSessionMetadata(sessionId, errorMetadata);
          console.log(
            `[Orchestrator] Persisted error metadata for session ${sessionId}`,
          );
        } catch (metadataError) {
          console.error(
            `[Orchestrator] Failed to persist error metadata:`,
            metadataError,
          );
        }

        const delayMs = Math.min(
          ORCHESTRATOR_BASE_DELAY_MS + jitter(),
          ORCHESTRATOR_MAX_DELAY_MS,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    const elapsedTime = Date.now() - orchestrationStartTime;
    console.log(
      `[Orchestrator] Session ${sessionId}: Approaching function timeout (${Math.floor(elapsedTime / 1000)}s elapsed), self-chaining to new instance`,
    );

    try {
      await db
        .update(analysisSessions)
        .set({
          metadata: {
            ...metadata,
            orchestrationIncomplete: true,
            lastOrchestratorStopReason: "timeout_self_chain",
            lastOrchestratorStopTime: new Date().toISOString(),
          },
        })
        .where(eq(analysisSessions.id, Number(sessionId)));
    } catch (error) {
      console.error(
        `[Orchestrator] Session ${sessionId}: Failed to update metadata:`,
        error,
      );
    }

    // Use the shared self-chain helper (fire-and-forget, status-aware)
    defer(triggerSelfChainIfNeeded(sessionId, "timeout"));

    return NextResponse.json({
      success: false,
      message:
        "Orchestration paused due to time limit - self-chained to new instance",
      needsRestart: false,
      attempts: attempt,
      elapsedTimeMs: elapsedTime,
    });
  } catch (error: unknown) {
    console.error(`[Orchestrator] Error: ${formatErrorWithCause(error)}`);

    // CRITICAL: Even on unexpected top-level errors, don't orphan the session.
    // Extract sessionId from the URL params if possible and trigger self-chain.
    try {
      const params = await segmentData.params;
      const sessionId = params.id;
      console.log(
        `[Orchestrator] Top-level error — attempting self-chain for session ${sessionId}`,
      );
      defer(triggerSelfChainIfNeeded(sessionId, "top_level_error"));
    } catch (chainErr) {
      console.error(
        `[Orchestrator] Failed to self-chain after top-level error: ${formatErrorWithCause(chainErr)}`,
      );
    }

    return NextResponse.json(
      {
        error: formatErrorWithCause(error),
      },
      { status: 500 },
    );
  }
}
