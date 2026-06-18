import { db } from "@/db/client";
import { analysisSessions, users, analysisSteps } from "@/db/schema";
import { toolCallLogs } from "@/db/schema/tool-logs";
import { eq, and, gte, inArray } from "drizzle-orm";
import { createExpenseFromSession } from "@/lib/expense-tracking";
import { getAnalysisModel } from "@/lib/model-config";
import {
  calculateTavilyCredits,
  calculateTavilyCost,
} from "@/db/schema/expenses";
import { failContinuationJob } from "@/lib/continuation-jobs";

/**
 * NOTE: Database Transactions Limitation
 *
 * The Neon HTTP driver (drizzle-orm/neon-http) does NOT support interactive
 * transactions. Attempting to use db.transaction() will throw:
 * "No transactions support in neon-http driver"
 *
 * To mitigate data integrity risks without transactions:
 * 1. Operations are ordered to minimize inconsistent states
 * 2. Expense creation is idempotent (checks for existing records)
 * 3. Session status updates are atomic single-table operations
 * 4. Error handling ensures partial failures are logged
 *
 * For true ACID guarantees, consider:
 * - Using Neon WebSocket driver with Pool/Client for transaction support
 * - Using postgres-js driver for migrations and complex operations
 */

/**
 * Aggregated token usage across all steps in a session
 */
interface AggregatedUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  stepCount: number;
}

/**
 * Aggregate token usage from all analysis_steps records for a session.
 * This is more accurate than relying on analysisResult.usage which only
 * contains the last chunk's accumulated tokens (not the total across all chunks).
 *
 * Each step stores its own usage in the `usage` JSONB column when persisted,
 * so we can sum them all up to get the true total cost.
 */
async function aggregateSessionTokenUsage(
  sessionId: string,
): Promise<AggregatedUsage> {
  const sessionIdNum = Number(sessionId);
  const steps = await db
    .select({
      usage: analysisSteps.usage,
    })
    .from(analysisSteps)
    .where(eq(analysisSteps.analysisSessionId, sessionIdNum));

  const aggregated: AggregatedUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    stepCount: 0,
  };

  for (const step of steps) {
    if (step.usage && typeof step.usage === "object") {
      const usage = step.usage as Record<string, number>;
      aggregated.promptTokens += usage.promptTokens ?? usage.inputTokens ?? 0;
      aggregated.completionTokens +=
        usage.completionTokens ?? usage.outputTokens ?? 0;
      aggregated.totalTokens += usage.totalTokens ?? 0;
      aggregated.cacheCreationInputTokens +=
        usage.cacheCreationInputTokens ?? 0;
      aggregated.cacheReadInputTokens += usage.cacheReadInputTokens ?? 0;
      aggregated.stepCount++;
    }
  }

  console.log(
    `[aggregateSessionTokenUsage] Aggregated usage from ${aggregated.stepCount} steps for session ${sessionId}:`,
    {
      promptTokens: aggregated.promptTokens,
      completionTokens: aggregated.completionTokens,
      totalTokens: aggregated.totalTokens,
      cacheCreationInputTokens: aggregated.cacheCreationInputTokens,
      cacheReadInputTokens: aggregated.cacheReadInputTokens,
    },
  );

  return aggregated;
}

/**
 * Aggregated Tavily API usage for a session
 */
interface AggregatedTavilyUsage {
  creditsUsed: number;
  costUsd: number;
  callCount: number;
}

/**
 * Aggregate Tavily API usage from tool_call_logs for a session.
 * Calculates credits based on tool type and parameters (search depth, URL count, etc.)
 */
async function aggregateSessionTavilyUsage(
  sessionId: string,
): Promise<AggregatedTavilyUsage> {
  const sessionIdNum = Number(sessionId);
  // Query all tool calls for this session that are Tavily-related
  const toolCalls = await db
    .select({
      toolName: toolCallLogs.toolName,
      toolInput: toolCallLogs.toolInput,
    })
    .from(toolCallLogs)
    .where(eq(toolCallLogs.analysisSessionId, sessionIdNum));

  let totalCredits = 0;
  let tavilyCallCount = 0;

  for (const call of toolCalls) {
    // Check if this is a Tavily tool call
    const toolName = call.toolName?.toLowerCase() || "";
    if (
      toolName.includes("tavily") ||
      toolName === "batch-url-extractor" ||
      toolName === "government-website-search"
    ) {
      const toolInput = (call.toolInput as Record<string, unknown>) || {};
      const credits = calculateTavilyCredits(call.toolName || "", toolInput);
      if (credits > 0) {
        totalCredits += credits;
        tavilyCallCount++;
      }
    }
  }

  const costUsd = calculateTavilyCost(totalCredits);

  console.log(
    `[aggregateSessionTavilyUsage] Aggregated Tavily usage for session ${sessionId}:`,
    {
      creditsUsed: totalCredits,
      costUsd: costUsd.toFixed(4),
      callCount: tavilyCallCount,
      totalToolCalls: toolCalls.length,
    },
  );

  return {
    creditsUsed: totalCredits,
    costUsd,
    callCount: tavilyCallCount,
  };
}

/**
 * Minimum character thresholds for reporting steps to detect truncated content.
 * These thresholds are based on expected minimum content for each step type.
 * Steps with content below these thresholds are considered incomplete/truncated.
 *
 * NOTE: We use step NAME patterns (case-insensitive) instead of hardcoded step IDs
 * because step IDs change when steps are added/deleted/reordered in the dynamic
 * workflow system. Step names remain consistent across workflow modifications.
 */
const REPORTING_STEP_MIN_CHARS_BY_NAME: Record<string, number> = {
  "executive summary": 200, // Executive summary should be substantial (lowered from 500 — production data shows valid summaries at 300-350 chars)
  "quality gate": 200, // Quality gate assessment should have detailed findings
  paralegal: 200, // Paralegal checklist should have actionable items (matches "Paralegal Action Checklist")
  "action checklist": 200, // Alternative name for paralegal checklist (matches "Response Brief Action Checklist")
  "revision checklist": 200, // Discovery drafting checklist
  "lessons learned": 200, // Lessons learned should have meaningful content
};

/**
 * Critical reporting step name patterns that must have valid content for session to be complete.
 * These patterns are matched case-insensitively against step names.
 *
 * NOTE: We use name patterns instead of step IDs because:
 * 1. Step IDs change when steps are added/deleted/reordered (e.g., step-40 becomes step-34)
 * 2. Step names remain consistent across workflow modifications
 * 3. This allows the validation to work with any workflow configuration
 *
 * The patterns are designed to match:
 * - "Executive Summary" (QA mode)
 * - "Paralegal Action Checklist" (QA mode)
 * - "Response Brief Action Checklist" (Offense mode)
 * - "Revision Checklist" (Discovery drafting mode)
 */
const CRITICAL_REPORTING_STEP_PATTERNS = [
  "executive summary",
  "paralegal", // Matches "Paralegal Action Checklist"
];

interface ReportingStepValidation {
  isValid: boolean;
  invalidSteps: Array<{
    stepId: string;
    stepName: string;
    charCount: number;
    minRequired: number;
    reason: "empty" | "truncated";
  }>;
}

/**
 * Workflow mode detection result
 */
type WorkflowMode = "qa" | "offense" | "discovery-drafting";

/**
 * Determine the workflow mode for a session based on step IDs.
 * Different workflow modes have different step ID prefixes:
 * - QA mode: step-* (default)
 * - Offense mode: offense-step-*
 * - Discovery drafting mode: discovery-step-*
 */
async function detectWorkflowMode(sessionId: string): Promise<WorkflowMode> {
  const sessionIdNum = Number(sessionId);
  // Check step IDs to determine workflow mode
  const steps = await db
    .select({
      stepId: analysisSteps.stepId,
    })
    .from(analysisSteps)
    .where(eq(analysisSteps.analysisSessionId, sessionIdNum))
    .limit(5);

  // Check for offense mode (offense-step-* IDs)
  if (steps.some((s) => s.stepId?.startsWith("offense-step-"))) {
    return "offense";
  }

  // Check for discovery drafting mode (discovery-step-* IDs)
  if (steps.some((s) => s.stepId?.startsWith("discovery-step-"))) {
    return "discovery-drafting";
  }

  // Default to QA mode
  return "qa";
}

/**
 * Get the minimum character threshold for a step based on its name.
 * Uses case-insensitive pattern matching against step names.
 */
function getMinCharsForStepName(stepName: string): number {
  const lowerName = stepName.toLowerCase();
  for (const [pattern, minChars] of Object.entries(
    REPORTING_STEP_MIN_CHARS_BY_NAME,
  )) {
    if (lowerName.includes(pattern)) {
      return minChars;
    }
  }
  return 200; // Default minimum (lowered from 500 — production data shows valid content at 300-350 chars)
}

/**
 * Check if a step name matches any of the critical reporting step patterns.
 * Uses case-insensitive pattern matching.
 */
function matchesCriticalReportingPattern(stepName: string): boolean {
  const lowerName = stepName.toLowerCase();
  return CRITICAL_REPORTING_STEP_PATTERNS.some((pattern) =>
    lowerName.includes(pattern),
  );
}

/**
 * Validate that all critical reporting steps have sufficient content.
 * This prevents marking sessions as complete when steps are empty or truncated.
 *
 * NOTE: This validation uses step NAME patterns (case-insensitive) instead of
 * hardcoded step IDs. This is necessary because step IDs change when steps are
 * added/deleted/reordered in the dynamic workflow system, but step names remain
 * consistent (e.g., "Executive Summary", "Paralegal Action Checklist").
 *
 * NOTE: This validation is SKIPPED for offense mode workflows, which have
 * different step IDs (offense-step-*) and don't have the same reporting
 * structure as QA mode. Offense mode ends with analytical steps like
 * "Doctrinal Shift Detection" and "Procedural Completeness Attack".
 */
async function validateReportingSteps(
  sessionId: string,
): Promise<ReportingStepValidation> {
  const sessionIdNum = Number(sessionId);
  // Check workflow mode - skip validation for non-QA workflows
  // Offense mode and discovery drafting mode have different step structures
  // and don't have the same reporting steps as QA mode
  const workflowMode = await detectWorkflowMode(sessionId);
  if (workflowMode !== "qa") {
    console.log(
      `[validateReportingSteps] Skipping reporting validation for ${workflowMode} mode session ${sessionId}`,
    );
    return { isValid: true, invalidSteps: [] };
  }

  // Fetch ALL steps for this session and filter by name pattern
  // This is necessary because step IDs are dynamic and change when steps are reordered
  const allSteps = await db
    .select({
      stepId: analysisSteps.stepId,
      stepName: analysisSteps.stepName,
      analysisText: analysisSteps.analysisText,
    })
    .from(analysisSteps)
    .where(eq(analysisSteps.analysisSessionId, sessionIdNum));

  // Find steps that match critical reporting patterns by NAME
  const reportingSteps = allSteps.filter(
    (step) => step.stepName && matchesCriticalReportingPattern(step.stepName),
  );

  console.log(
    `[validateReportingSteps] Found ${reportingSteps.length} reporting steps by name pattern for session ${sessionId}:`,
    reportingSteps.map((s) => ({ stepId: s.stepId, stepName: s.stepName })),
  );

  const invalidSteps: ReportingStepValidation["invalidSteps"] = [];

  // Check each critical pattern to ensure we have a matching step with content
  for (const pattern of CRITICAL_REPORTING_STEP_PATTERNS) {
    const matchingStep = reportingSteps.find((s) =>
      s.stepName?.toLowerCase().includes(pattern),
    );

    if (!matchingStep) {
      // No step found matching this pattern - this is a critical issue
      console.warn(
        `[validateReportingSteps] No step found matching pattern "${pattern}" for session ${sessionId}`,
      );
      invalidSteps.push({
        stepId: `pattern:${pattern}`,
        stepName: pattern,
        charCount: 0,
        minRequired: REPORTING_STEP_MIN_CHARS_BY_NAME[pattern] || 500,
        reason: "empty",
      });
      continue;
    }

    const charCount = matchingStep.analysisText?.length || 0;
    const minChars = getMinCharsForStepName(matchingStep.stepName || pattern);

    if (charCount === 0) {
      invalidSteps.push({
        stepId: matchingStep.stepId || `pattern:${pattern}`,
        stepName: matchingStep.stepName || pattern,
        charCount: 0,
        minRequired: minChars,
        reason: "empty",
      });
    } else if (charCount < minChars) {
      invalidSteps.push({
        stepId: matchingStep.stepId || `pattern:${pattern}`,
        stepName: matchingStep.stepName || pattern,
        charCount,
        minRequired: minChars,
        reason: "truncated",
      });
    } else {
      console.log(
        `[validateReportingSteps] Step "${matchingStep.stepName}" (${matchingStep.stepId}) passed validation with ${charCount} chars (min: ${minChars})`,
      );
    }
  }

  return {
    isValid: invalidSteps.length === 0,
    invalidSteps,
  };
}

/**
 * Finalize an analysis session with status invariant guards
 *
 * This helper ensures that status="complete" is only set when the session
 * has truly completed all required steps. It prevents circular logic issues
 * by checking if the final step (stored in metadata.finalStepId) has been
 * completed in the analysis_steps table.
 *
 * @param sessionId - The analysis session ID
 * @param fields - Additional fields to update (e.g., analysisResult, completedAt)
 * @returns The updated session record
 */
export async function finalizeSession(
  sessionId: unknown,
  fields?: {
    analysisResult?: any;
    completedAt?: Date;
    metadata?: any;
  },
) {
  const sessionIdText = String(sessionId ?? "");
  const sessionIdNum = Number(sessionIdText);

  const [session] = await db
    .select()
    .from(analysisSessions)
    .where(eq(analysisSessions.id, sessionIdNum))
    .limit(1);

  if (!session) {
    throw new Error(`Session ${sessionIdText} not found`);
  }

  const metadata = (session.metadata as any) || {};
  const finalStepId = metadata.finalStepId;

  // Check the finalStepCompleted column directly (set by PR #393's stream route)
  // This column is set to true when the analysis reaches the final step (Step 35/35)
  const finalStepCompleted = session.finalStepCompleted === true;
  const isFinalized = metadata.isFinalized === true;

  // Simplified guard: rely on the finalStepCompleted column instead of checking for specific steps
  // This avoids timing issues where finalization is called before steps are saved to the database
  const canSetComplete = finalStepCompleted || isFinalized;

  console.log(`[finalizeSession] Completion check for session ${sessionId}:`, {
    currentStep: session.currentStep,
    totalSteps: session.totalSteps,
    finalStepId,
    finalStepCompleted,
    finalStepCompletedColumn: session.finalStepCompleted, // Show the actual column value
    isFinalized,
    canSetComplete,
    guardCondition: `finalStepCompleted(${finalStepCompleted}) || isFinalized(${isFinalized})`,
    currentStatus: session.status,
  });

  if (!canSetComplete) {
    console.warn(
      `[finalizeSession] Cannot set status="complete" for session ${sessionId}: ` +
        `finalStepCompleted=${finalStepCompleted}, isFinalized=${isFinalized}`,
    );

    const updateFields = {
      status: "processing" as const,
      updatedAt: new Date(),
      lastActivityAt: new Date(),
      ...(fields?.metadata && {
        metadata: { ...metadata, ...fields.metadata },
      }),
    };

    const [updated] = await db
      .update(analysisSessions)
      .set(updateFields)
      .where(eq(analysisSessions.id, sessionIdNum))
      .returning();

    return updated;
  }

  // Validate that all critical reporting steps have sufficient content
  // This prevents marking sessions as complete when steps are empty or truncated
  const reportingValidation = await validateReportingSteps(sessionIdText);

  if (!reportingValidation.isValid) {
    // Track how many times reporting validation has failed for this session.
    // Allow up to 3 retries before declaring permanent failure, giving the
    // orchestrator a chance to re-run the final steps with tools disabled.
    const MAX_REPORTING_VALIDATION_RETRIES = 3;
    const previousRetryCount =
      typeof metadata.reportingValidationRetryCount === "number"
        ? metadata.reportingValidationRetryCount
        : 0;
    const isPermanentFailure =
      previousRetryCount >= MAX_REPORTING_VALIDATION_RETRIES;

    console.error(
      `[finalizeSession] Cannot set status="complete" for session ${sessionId}: ` +
        `reporting steps have invalid content (attempt ${previousRetryCount + 1}/${MAX_REPORTING_VALIDATION_RETRIES + 1}, permanent=${isPermanentFailure})`,
      {
        invalidSteps: reportingValidation.invalidSteps,
      },
    );

    if (!isPermanentFailure) {
      // NON-PERMANENT FAILURE: Roll back empty steps and keep session processing.
      // This allows the orchestrator to naturally re-run the empty steps instead
      // of entering an error→retry loop that re-finalizes with the same empty data.
      try {
        // Find the step_index values for the invalid steps so we can roll back
        const invalidStepIds = reportingValidation.invalidSteps
          .map((s) => s.stepId)
          .filter((id) => !id.startsWith("pattern:"));

        let earliestInvalidStepIndex = session.currentStep; // fallback

        if (invalidStepIds.length > 0) {
          const invalidStepRecords = await db
            .select({
              stepIndex: analysisSteps.stepIndex,
              stepId: analysisSteps.stepId,
            })
            .from(analysisSteps)
            .where(
              and(
                eq(analysisSteps.analysisSessionId, sessionIdNum),
                inArray(analysisSteps.stepId, invalidStepIds),
              ),
            );

          if (invalidStepRecords.length > 0) {
            earliestInvalidStepIndex = Math.min(
              ...invalidStepRecords.map((r) => r.stepIndex),
            );

            // Delete ALL step records from the earliest invalid step onwards.
            // This ensures clean re-execution — the model's context builds on
            // previous steps, so re-running with gaps could produce inconsistent results.
            const deleteResult = await db
              .delete(analysisSteps)
              .where(
                and(
                  eq(analysisSteps.analysisSessionId, sessionIdNum),
                  gte(analysisSteps.stepIndex, earliestInvalidStepIndex),
                ),
              );

            console.log(
              `[finalizeSession] Deleted step records from index ${earliestInvalidStepIndex} onwards for session ${sessionId}`,
              { deleteResult, invalidStepIds },
            );
          }
        }

        // Roll back session state: keep "processing" so orchestrator continues naturally
        const rollbackMetadata = {
          ...metadata,
          ...fields?.metadata,
          reportingValidationFailed: false,
          reportingValidationTimestamp: new Date().toISOString(),
          reportingValidationRetryCount: previousRetryCount + 1,
          invalidReportingSteps: reportingValidation.invalidSteps,
          reportingValidationRollback: {
            timestamp: new Date().toISOString(),
            rolledBackToStep: earliestInvalidStepIndex,
            previousCurrentStep: session.currentStep,
            deletedFromStepIndex: earliestInvalidStepIndex,
            reason:
              "Non-permanent reporting validation failure — rolling back empty steps for re-execution",
          },
        };

        const [updated] = await db
          .update(analysisSessions)
          .set({
            status: "processing" as const,
            currentStep: earliestInvalidStepIndex,
            finalStepCompleted: false,
            isResuming: false,
            processingLockId: null,
            processingLockAcquiredAt: null,
            processingLockExpiresAt: null,
            processingWorkerType: null,
            updatedAt: new Date(),
            lastActivityAt: new Date(),
            metadata: rollbackMetadata,
          })
          .where(eq(analysisSessions.id, sessionIdNum))
          .returning();

        console.log(
          `[finalizeSession] Rolled back session ${sessionId} from step ${session.currentStep} to ${earliestInvalidStepIndex} ` +
            `for reporting validation retry (attempt ${previousRetryCount + 1}/${MAX_REPORTING_VALIDATION_RETRIES + 1})`,
        );

        return updated;
      } catch (rollbackError) {
        console.error(
          `[finalizeSession] Rollback failed for session ${sessionId}, falling through to error state:`,
          rollbackError instanceof Error
            ? rollbackError.message
            : String(rollbackError),
        );
        // Fall through to the error state below
      }
    }

    // PERMANENT FAILURE (or rollback failed): Mark session as error
    const validationMetadata = {
      ...metadata,
      ...fields?.metadata,
      reportingValidationFailed: isPermanentFailure,
      reportingValidationTimestamp: new Date().toISOString(),
      reportingValidationRetryCount: previousRetryCount + 1,
      invalidReportingSteps: reportingValidation.invalidSteps,
    };

    const updateFields = {
      status: "error" as const,
      updatedAt: new Date(),
      lastActivityAt: new Date(),
      metadata: validationMetadata,
    };

    const [updated] = await db
      .update(analysisSessions)
      .set(updateFields)
      .where(eq(analysisSessions.id, sessionIdNum))
      .returning();

    // Cancel continuation jobs immediately so the watchdog/orchestrator
    // don't keep re-triggering this permanently-failed session.
    if (isPermanentFailure) {
      await failContinuationJob(
        sessionId,
        `Permanent reporting validation failure: ${reportingValidation.invalidSteps.map((s) => s.stepId).join(", ")}`,
      ).catch((err) =>
        console.error(
          `[finalizeSession] Failed to cancel continuation job for ${sessionId}:`,
          err,
        ),
      );
    }

    return updated;
  }

  console.log(
    `[finalizeSession] Reporting steps validation passed for session ${sessionId}`,
    {
      validatedPatterns: CRITICAL_REPORTING_STEP_PATTERNS,
    },
  );

  const updateFields = {
    status: "complete" as const,
    currentStep: session.currentStep, // Preserve currentStep when marking complete
    completedAt: fields?.completedAt || new Date(),
    updatedAt: new Date(),
    lastActivityAt: new Date(),
    ...(fields?.analysisResult && { analysisResult: fields.analysisResult }),
    ...(fields?.metadata && { metadata: { ...metadata, ...fields.metadata } }),
  };

  console.log(
    `[finalizeSession] Setting status="complete" for session ${sessionId}: ` +
      `finalStepCompleted=${finalStepCompleted}, isFinalized=${isFinalized}`,
    {
      stackTrace: new Error().stack?.split("\n").slice(1, 4).join("\n"),
    },
  );

  const [updated] = await db
    .update(analysisSessions)
    .set(updateFields)
    .where(eq(analysisSessions.id, sessionIdNum))
    .returning();

  // Create expense record for the completed session
  // IMPORTANT: Aggregate token usage from all analysis_steps records instead of
  // relying on analysisResult.usage, which only contains the last chunk's tokens.
  // This fixes the bug where multi-chunk sessions reported dramatically underestimated costs.
  // Also aggregate Tavily API usage from tool_call_logs for unified cost tracking.
  // Wrap in try-catch to prevent expense tracking failures from failing finalization
  try {
    // Aggregate usage from all persisted analysis steps - this is the accurate total
    const aggregatedUsage = await aggregateSessionTokenUsage(sessionIdText);

    // Aggregate Tavily API usage from tool_call_logs
    const tavilyUsage = await aggregateSessionTavilyUsage(sessionIdText);

    // Get the user's name for the expense record
    let username: string | undefined;
    if (updated.userId) {
      const user = await db.query.users.findFirst({
        where: eq(users.id, updated.userId),
      });
      username = user?.name ?? user?.email ?? undefined;
    }

    // Get the model name from config (model name is not stored per-session currently)
    const modelName = getAnalysisModel();

    await createExpenseFromSession(
      sessionIdText,
      String(updated.organizationId ?? ""),
      String(updated.userId ?? ""),
      modelName,
      {
        promptTokens: aggregatedUsage.promptTokens,
        completionTokens: aggregatedUsage.completionTokens,
        totalTokens: aggregatedUsage.totalTokens,
        cacheCreationInputTokens: aggregatedUsage.cacheCreationInputTokens,
        cacheReadInputTokens: aggregatedUsage.cacheReadInputTokens,
      },
      updated.startedAt ?? updated.createdAt,
      username,
      {
        creditsUsed: tavilyUsage.creditsUsed,
        costUsd: tavilyUsage.costUsd,
      },
    );

    console.log(
      `[finalizeSession] Created expense record for session ${sessionId} ` +
        `(AI: ${aggregatedUsage.stepCount} steps, ${aggregatedUsage.promptTokens} input, ${aggregatedUsage.completionTokens} output tokens; ` +
        `Tavily: ${tavilyUsage.callCount} calls, ${tavilyUsage.creditsUsed} credits, $${tavilyUsage.costUsd.toFixed(4)})`,
    );
  } catch (expenseError) {
    console.error(
      `[finalizeSession] Failed to create expense record for session ${sessionId}:`,
      expenseError instanceof Error
        ? expenseError.message
        : String(expenseError),
    );
    // Don't throw - finalization succeeded even if expense tracking failed
  }

  return updated;
}

/**
 * Mark a session as finalized (for dynamic workflows where AI decides when done)
 *
 * @param sessionId - The analysis session ID
 */
export async function markSessionFinalized(sessionId: string) {
  const sessionIdNum = Number(sessionId);
  const [session] = await db
    .select()
    .from(analysisSessions)
    .where(eq(analysisSessions.id, sessionIdNum))
    .limit(1);

  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }

  const metadata = (session.metadata as any) || {};

  const [updated] = await db
    .update(analysisSessions)
    .set({
      metadata: { ...metadata, isFinalized: true },
      updatedAt: new Date(),
    })
    .where(eq(analysisSessions.id, sessionIdNum))
    .returning();

  console.log(
    `[markSessionFinalized] Marked session ${sessionId} as finalized`,
  );

  return updated;
}
