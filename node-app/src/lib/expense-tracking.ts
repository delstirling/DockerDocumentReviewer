/**
 * Session Expense Tracking
 *
 * Tracks token usage and costs per analysis session.
 * Supports up to 3 different models per session.
 */

import { db } from "@/db/client";
import { sessionExpenses, calculateModelCost } from "@/db/schema/expenses";
import { analysisSessions, users } from "@/db/schema";
import { eq, and, desc, count } from "drizzle-orm";

/**
 * Token usage data for a single model
 */
export interface ModelUsage {
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

/**
 * Accumulated usage across all models in a session
 */
export interface SessionUsageAccumulator {
  sessionId: string;
  organizationId: string;
  userId: string;
  username?: string;
  sessionStartTime?: Date;
  model1: ModelUsage | null;
  model2: ModelUsage | null;
  model3: ModelUsage | null;
}

/**
 * Create a new session usage accumulator
 */
export function createSessionUsageAccumulator(
  sessionId: string,
  organizationId: string,
  userId: string,
  username?: string,
): SessionUsageAccumulator {
  return {
    sessionId,
    organizationId,
    userId,
    username,
    sessionStartTime: undefined,
    model1: null,
    model2: null,
    model3: null,
  };
}

/**
 * Add token usage for a model to the accumulator
 * Automatically assigns to model1, model2, or model3 slot based on model name
 */
export function addModelUsage(
  accumulator: SessionUsageAccumulator,
  modelName: string,
  inputTokens: number,
  outputTokens: number,
  cacheCreationTokens: number = 0,
  cacheReadTokens: number = 0,
): void {
  // Set session start time on first usage
  if (!accumulator.sessionStartTime) {
    accumulator.sessionStartTime = new Date();
  }

  // Find existing slot for this model or assign to next available slot
  if (accumulator.model1?.modelName === modelName) {
    accumulator.model1.inputTokens += inputTokens;
    accumulator.model1.outputTokens += outputTokens;
    accumulator.model1.cacheCreationTokens += cacheCreationTokens;
    accumulator.model1.cacheReadTokens += cacheReadTokens;
  } else if (accumulator.model2?.modelName === modelName) {
    accumulator.model2.inputTokens += inputTokens;
    accumulator.model2.outputTokens += outputTokens;
    accumulator.model2.cacheCreationTokens += cacheCreationTokens;
    accumulator.model2.cacheReadTokens += cacheReadTokens;
  } else if (accumulator.model3?.modelName === modelName) {
    accumulator.model3.inputTokens += inputTokens;
    accumulator.model3.outputTokens += outputTokens;
    accumulator.model3.cacheCreationTokens += cacheCreationTokens;
    accumulator.model3.cacheReadTokens += cacheReadTokens;
  } else if (!accumulator.model1) {
    accumulator.model1 = {
      modelName,
      inputTokens,
      outputTokens,
      cacheCreationTokens,
      cacheReadTokens,
    };
  } else if (!accumulator.model2) {
    accumulator.model2 = {
      modelName,
      inputTokens,
      outputTokens,
      cacheCreationTokens,
      cacheReadTokens,
    };
  } else if (!accumulator.model3) {
    accumulator.model3 = {
      modelName,
      inputTokens,
      outputTokens,
      cacheCreationTokens,
      cacheReadTokens,
    };
  } else {
    // All slots full, add to model1 as fallback (shouldn't happen with 3 models)
    console.warn(
      `[ExpenseTracking] All model slots full, adding ${modelName} usage to model1`,
    );
    accumulator.model1.inputTokens += inputTokens;
    accumulator.model1.outputTokens += outputTokens;
    accumulator.model1.cacheCreationTokens += cacheCreationTokens;
    accumulator.model1.cacheReadTokens += cacheReadTokens;
  }
}

/**
 * Persist session expenses to the database
 * Called when a session completes
 */
export async function persistSessionExpenses(
  accumulator: SessionUsageAccumulator,
): Promise<string | null> {
  try {
    // Calculate costs for each model
    const model1Cost = accumulator.model1
      ? calculateModelCost(
          accumulator.model1.modelName,
          accumulator.model1.inputTokens,
          accumulator.model1.outputTokens,
          accumulator.model1.cacheCreationTokens,
          accumulator.model1.cacheReadTokens,
        )
      : 0;

    const model2Cost = accumulator.model2
      ? calculateModelCost(
          accumulator.model2.modelName,
          accumulator.model2.inputTokens,
          accumulator.model2.outputTokens,
          accumulator.model2.cacheCreationTokens,
          accumulator.model2.cacheReadTokens,
        )
      : 0;

    const model3Cost = accumulator.model3
      ? calculateModelCost(
          accumulator.model3.modelName,
          accumulator.model3.inputTokens,
          accumulator.model3.outputTokens,
          accumulator.model3.cacheCreationTokens,
          accumulator.model3.cacheReadTokens,
        )
      : 0;

    const totalCost = model1Cost + model2Cost + model3Cost;

    // Check if expense record already exists for this session
    const existingExpense = await db.query.sessionExpenses.findFirst({
      where: eq(sessionExpenses.sessionId, Number(accumulator.sessionId)),
    });

    const completionTime = new Date();

    if (existingExpense) {
      // Update existing record
      await db
        .update(sessionExpenses)
        .set({
          sessionCompletionTime: completionTime,
          model1Name: accumulator.model1?.modelName,
          model1InputTokens: accumulator.model1?.inputTokens ?? 0,
          model1OutputTokens: accumulator.model1?.outputTokens ?? 0,
          model1CacheCreationTokens:
            accumulator.model1?.cacheCreationTokens ?? 0,
          model1CacheReadTokens: accumulator.model1?.cacheReadTokens ?? 0,
          model1CostUsd: model1Cost.toFixed(6),
          model2Name: accumulator.model2?.modelName,
          model2InputTokens: accumulator.model2?.inputTokens ?? 0,
          model2OutputTokens: accumulator.model2?.outputTokens ?? 0,
          model2CacheCreationTokens:
            accumulator.model2?.cacheCreationTokens ?? 0,
          model2CacheReadTokens: accumulator.model2?.cacheReadTokens ?? 0,
          model2CostUsd: model2Cost.toFixed(6),
          model3Name: accumulator.model3?.modelName,
          model3InputTokens: accumulator.model3?.inputTokens ?? 0,
          model3OutputTokens: accumulator.model3?.outputTokens ?? 0,
          model3CacheCreationTokens:
            accumulator.model3?.cacheCreationTokens ?? 0,
          model3CacheReadTokens: accumulator.model3?.cacheReadTokens ?? 0,
          model3CostUsd: model3Cost.toFixed(6),
          totalCostUsd: totalCost.toFixed(6),
          updatedAt: completionTime,
        })
        .where(eq(sessionExpenses.id, existingExpense.id));

      console.log(
        `[ExpenseTracking] Updated expense record ${existingExpense.id} for session ${accumulator.sessionId}: $${totalCost.toFixed(4)}`,
      );
      return String(existingExpense.id);
    } else {
      // Create new record
      const [newExpense] = await db
        .insert(sessionExpenses)
        .values({
          sessionId: Number(accumulator.sessionId),
          organizationId: Number(accumulator.organizationId),
          userId: Number(accumulator.userId),
          username: accumulator.username,
          sessionStartTime: accumulator.sessionStartTime,
          sessionCompletionTime: completionTime,
          model1Name: accumulator.model1?.modelName,
          model1InputTokens: accumulator.model1?.inputTokens ?? 0,
          model1OutputTokens: accumulator.model1?.outputTokens ?? 0,
          model1CacheCreationTokens:
            accumulator.model1?.cacheCreationTokens ?? 0,
          model1CacheReadTokens: accumulator.model1?.cacheReadTokens ?? 0,
          model1CostUsd: model1Cost.toFixed(6),
          model2Name: accumulator.model2?.modelName,
          model2InputTokens: accumulator.model2?.inputTokens ?? 0,
          model2OutputTokens: accumulator.model2?.outputTokens ?? 0,
          model2CacheCreationTokens:
            accumulator.model2?.cacheCreationTokens ?? 0,
          model2CacheReadTokens: accumulator.model2?.cacheReadTokens ?? 0,
          model2CostUsd: model2Cost.toFixed(6),
          model3Name: accumulator.model3?.modelName,
          model3InputTokens: accumulator.model3?.inputTokens ?? 0,
          model3OutputTokens: accumulator.model3?.outputTokens ?? 0,
          model3CacheCreationTokens:
            accumulator.model3?.cacheCreationTokens ?? 0,
          model3CacheReadTokens: accumulator.model3?.cacheReadTokens ?? 0,
          model3CostUsd: model3Cost.toFixed(6),
          totalCostUsd: totalCost.toFixed(6),
        })
        .returning({ id: sessionExpenses.id });

      console.log(
        `[ExpenseTracking] Created expense record ${newExpense.id} for session ${accumulator.sessionId}: $${totalCost.toFixed(4)}`,
      );
      return String(newExpense.id);
    }
  } catch (error) {
    console.error(
      `[ExpenseTracking] Failed to persist expenses for session ${accumulator.sessionId}:`,
      error,
    );
    return null;
  }
}

/**
 * Get session expenses for an organization
 * Ordered by completion time (most recent first)
 */
export async function getOrganizationExpenses(
  organizationId: string,
  limit: number = 50,
  offset: number = 0,
): Promise<{
  expenses: Array<{
    id: string;
    sessionId: string;
    sessionTitle: string | null;
    username: string | null;
    sessionStartTime: Date | null;
    sessionCompletionTime: Date | null;
    models: Array<{
      name: string;
      inputTokens: number;
      outputTokens: number;
      cacheCreationTokens: number;
      cacheReadTokens: number;
      costUsd: number;
    }>;
    totalCostUsd: number;
    tavilyCreditsUsed: number;
    tavilyCostUsd: number;
    grandTotalCostUsd: number;
  }>;
  total: number;
}> {
  const organizationIdNum = Number(organizationId);
  try {
    // Get expenses with session titles
    const expenses = await db
      .select({
        id: sessionExpenses.id,
        sessionId: sessionExpenses.sessionId,
        sessionTitle: analysisSessions.title,
        username: sessionExpenses.username,
        sessionStartTime: sessionExpenses.sessionStartTime,
        sessionCompletionTime: sessionExpenses.sessionCompletionTime,
        model1Name: sessionExpenses.model1Name,
        model1InputTokens: sessionExpenses.model1InputTokens,
        model1OutputTokens: sessionExpenses.model1OutputTokens,
        model1CacheCreationTokens: sessionExpenses.model1CacheCreationTokens,
        model1CacheReadTokens: sessionExpenses.model1CacheReadTokens,
        model1CostUsd: sessionExpenses.model1CostUsd,
        model2Name: sessionExpenses.model2Name,
        model2InputTokens: sessionExpenses.model2InputTokens,
        model2OutputTokens: sessionExpenses.model2OutputTokens,
        model2CacheCreationTokens: sessionExpenses.model2CacheCreationTokens,
        model2CacheReadTokens: sessionExpenses.model2CacheReadTokens,
        model2CostUsd: sessionExpenses.model2CostUsd,
        model3Name: sessionExpenses.model3Name,
        model3InputTokens: sessionExpenses.model3InputTokens,
        model3OutputTokens: sessionExpenses.model3OutputTokens,
        model3CacheCreationTokens: sessionExpenses.model3CacheCreationTokens,
        model3CacheReadTokens: sessionExpenses.model3CacheReadTokens,
        model3CostUsd: sessionExpenses.model3CostUsd,
        totalCostUsd: sessionExpenses.totalCostUsd,
        tavilyCreditsUsed: sessionExpenses.tavilyCreditsUsed,
        tavilyCostUsd: sessionExpenses.tavilyCostUsd,
        grandTotalCostUsd: sessionExpenses.grandTotalCostUsd,
      })
      .from(sessionExpenses)
      .leftJoin(
        analysisSessions,
        eq(sessionExpenses.sessionId, analysisSessions.id),
      )
      .where(eq(sessionExpenses.organizationId, organizationIdNum))
      .orderBy(desc(sessionExpenses.sessionCompletionTime))
      .limit(limit)
      .offset(offset);

    // Count total expenses for pagination
    const countResult = await db
      .select({ count: count() })
      .from(sessionExpenses)
      .where(eq(sessionExpenses.organizationId, organizationIdNum));

    const total = countResult[0]?.count ?? 0;

    // Transform to response format
    const formattedExpenses = expenses.map((expense) => {
      const models: Array<{
        name: string;
        inputTokens: number;
        outputTokens: number;
        cacheCreationTokens: number;
        cacheReadTokens: number;
        costUsd: number;
      }> = [];

      if (expense.model1Name) {
        models.push({
          name: expense.model1Name,
          inputTokens: expense.model1InputTokens ?? 0,
          outputTokens: expense.model1OutputTokens ?? 0,
          cacheCreationTokens: expense.model1CacheCreationTokens ?? 0,
          cacheReadTokens: expense.model1CacheReadTokens ?? 0,
          costUsd: parseFloat(expense.model1CostUsd ?? "0"),
        });
      }

      if (expense.model2Name) {
        models.push({
          name: expense.model2Name,
          inputTokens: expense.model2InputTokens ?? 0,
          outputTokens: expense.model2OutputTokens ?? 0,
          cacheCreationTokens: expense.model2CacheCreationTokens ?? 0,
          cacheReadTokens: expense.model2CacheReadTokens ?? 0,
          costUsd: parseFloat(expense.model2CostUsd ?? "0"),
        });
      }

      if (expense.model3Name) {
        models.push({
          name: expense.model3Name,
          inputTokens: expense.model3InputTokens ?? 0,
          outputTokens: expense.model3OutputTokens ?? 0,
          cacheCreationTokens: expense.model3CacheCreationTokens ?? 0,
          cacheReadTokens: expense.model3CacheReadTokens ?? 0,
          costUsd: parseFloat(expense.model3CostUsd ?? "0"),
        });
      }

      return {
        id: String(expense.id),
        sessionId: String(expense.sessionId),
        sessionTitle: expense.sessionTitle,
        username: expense.username,
        sessionStartTime: expense.sessionStartTime,
        sessionCompletionTime: expense.sessionCompletionTime,
        models,
        totalCostUsd: parseFloat(expense.totalCostUsd ?? "0"),
        tavilyCreditsUsed: expense.tavilyCreditsUsed ?? 0,
        tavilyCostUsd: parseFloat(expense.tavilyCostUsd ?? "0"),
        grandTotalCostUsd: parseFloat(expense.grandTotalCostUsd ?? "0"),
      };
    });

    return {
      expenses: formattedExpenses,
      total,
    };
  } catch (error) {
    console.error(
      `[ExpenseTracking] Failed to get expenses for organization ${organizationId}:`,
      error,
    );
    return { expenses: [], total: 0 };
  }
}

/**
 * Initialize or update expense tracking for a session
 * Called at the start of analysis to create the initial record
 */
export async function initializeSessionExpense(
  sessionId: string,
  organizationId: string,
  userId: string,
  username?: string,
): Promise<string | null> {
  const sessionIdNum = Number(sessionId);
  const organizationIdNum = Number(organizationId);
  const userIdNum = Number(userId);
  try {
    // Check if expense record already exists
    const existingExpense = await db.query.sessionExpenses.findFirst({
      where: eq(sessionExpenses.sessionId, sessionIdNum),
    });

    if (existingExpense) {
      // Update start time if not set
      if (!existingExpense.sessionStartTime) {
        await db
          .update(sessionExpenses)
          .set({
            sessionStartTime: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(sessionExpenses.id, existingExpense.id));
      }
      return String(existingExpense.id);
    }

    // Create new record with start time
    const [newExpense] = await db
      .insert(sessionExpenses)
      .values({
        sessionId: sessionIdNum,
        organizationId: organizationIdNum,
        userId: userIdNum,
        username,
        sessionStartTime: new Date(),
      })
      .returning({ id: sessionExpenses.id });

    console.log(
      `[ExpenseTracking] Initialized expense record ${newExpense.id} for session ${sessionId}`,
    );
    return String(newExpense.id);
  } catch (error) {
    console.error(
      `[ExpenseTracking] Failed to initialize expense for session ${sessionId}:`,
      error,
    );
    return null;
  }
}

/**
 * Update session expense with incremental token usage
 * Called after each step completes
 */
export async function updateSessionExpenseTokens(
  sessionId: string,
  modelName: string,
  inputTokens: number,
  outputTokens: number,
  cacheCreationTokens: number = 0,
  cacheReadTokens: number = 0,
): Promise<void> {
  const sessionIdNum = Number(sessionId);
  try {
    const existingExpense = await db.query.sessionExpenses.findFirst({
      where: eq(sessionExpenses.sessionId, sessionIdNum),
    });

    if (!existingExpense) {
      console.warn(
        `[ExpenseTracking] No expense record found for session ${sessionId}`,
      );
      return;
    }

    // Determine which model slot to update
    let updateData: Record<string, unknown> = { updatedAt: new Date() };

    if (
      existingExpense.model1Name === modelName ||
      !existingExpense.model1Name
    ) {
      // Update model 1
      const newInputTokens =
        (existingExpense.model1InputTokens ?? 0) + inputTokens;
      const newOutputTokens =
        (existingExpense.model1OutputTokens ?? 0) + outputTokens;
      const newCacheCreation =
        (existingExpense.model1CacheCreationTokens ?? 0) + cacheCreationTokens;
      const newCacheRead =
        (existingExpense.model1CacheReadTokens ?? 0) + cacheReadTokens;
      const newCost = calculateModelCost(
        modelName,
        newInputTokens,
        newOutputTokens,
        newCacheCreation,
        newCacheRead,
      );

      updateData = {
        ...updateData,
        model1Name: modelName,
        model1InputTokens: newInputTokens,
        model1OutputTokens: newOutputTokens,
        model1CacheCreationTokens: newCacheCreation,
        model1CacheReadTokens: newCacheRead,
        model1CostUsd: newCost.toFixed(6),
      };
    } else if (
      existingExpense.model2Name === modelName ||
      !existingExpense.model2Name
    ) {
      // Update model 2
      const newInputTokens =
        (existingExpense.model2InputTokens ?? 0) + inputTokens;
      const newOutputTokens =
        (existingExpense.model2OutputTokens ?? 0) + outputTokens;
      const newCacheCreation =
        (existingExpense.model2CacheCreationTokens ?? 0) + cacheCreationTokens;
      const newCacheRead =
        (existingExpense.model2CacheReadTokens ?? 0) + cacheReadTokens;
      const newCost = calculateModelCost(
        modelName,
        newInputTokens,
        newOutputTokens,
        newCacheCreation,
        newCacheRead,
      );

      updateData = {
        ...updateData,
        model2Name: modelName,
        model2InputTokens: newInputTokens,
        model2OutputTokens: newOutputTokens,
        model2CacheCreationTokens: newCacheCreation,
        model2CacheReadTokens: newCacheRead,
        model2CostUsd: newCost.toFixed(6),
      };
    } else if (
      existingExpense.model3Name === modelName ||
      !existingExpense.model3Name
    ) {
      // Update model 3
      const newInputTokens =
        (existingExpense.model3InputTokens ?? 0) + inputTokens;
      const newOutputTokens =
        (existingExpense.model3OutputTokens ?? 0) + outputTokens;
      const newCacheCreation =
        (existingExpense.model3CacheCreationTokens ?? 0) + cacheCreationTokens;
      const newCacheRead =
        (existingExpense.model3CacheReadTokens ?? 0) + cacheReadTokens;
      const newCost = calculateModelCost(
        modelName,
        newInputTokens,
        newOutputTokens,
        newCacheCreation,
        newCacheRead,
      );

      updateData = {
        ...updateData,
        model3Name: modelName,
        model3InputTokens: newInputTokens,
        model3OutputTokens: newOutputTokens,
        model3CacheCreationTokens: newCacheCreation,
        model3CacheReadTokens: newCacheRead,
        model3CostUsd: newCost.toFixed(6),
      };
    }

    // Recalculate total cost
    const model1Cost = parseFloat(
      (updateData.model1CostUsd as string) ??
        existingExpense.model1CostUsd ??
        "0",
    );
    const model2Cost = parseFloat(
      (updateData.model2CostUsd as string) ??
        existingExpense.model2CostUsd ??
        "0",
    );
    const model3Cost = parseFloat(
      (updateData.model3CostUsd as string) ??
        existingExpense.model3CostUsd ??
        "0",
    );
    updateData.totalCostUsd = (model1Cost + model2Cost + model3Cost).toFixed(6);

    await db
      .update(sessionExpenses)
      .set(updateData)
      .where(eq(sessionExpenses.id, existingExpense.id));
  } catch (error) {
    console.error(
      `[ExpenseTracking] Failed to update tokens for session ${sessionId}:`,
      error,
    );
  }
}

/**
 * Mark session expense as complete
 * Called when session finishes
 */
export async function completeSessionExpense(sessionId: string): Promise<void> {
  const sessionIdNum = Number(sessionId);
  try {
    await db
      .update(sessionExpenses)
      .set({
        sessionCompletionTime: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(sessionExpenses.sessionId, sessionIdNum));

    console.log(`[ExpenseTracking] Marked session ${sessionId} as complete`);
  } catch (error) {
    console.error(
      `[ExpenseTracking] Failed to complete expense for session ${sessionId}:`,
      error,
    );
  }
}

/**
 * Create or update expense record from session's analysisResult
 * Called when a session is finalized
 * Now includes Tavily API usage for unified cost tracking
 */
export async function createExpenseFromSession(
  sessionId: string,
  organizationId: string,
  userId: string,
  modelName: string,
  usage: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
  },
  sessionStartTime?: Date,
  username?: string,
  tavilyUsage?: {
    creditsUsed: number;
    costUsd: number;
  },
): Promise<string | null> {
  const sessionIdNum = Number(sessionId);
  const organizationIdNum = Number(organizationId);
  const userIdNum = Number(userId);
  try {
    const inputTokens = usage.promptTokens ?? 0;
    const outputTokens = usage.completionTokens ?? 0;
    const cacheCreationTokens = usage.cacheCreationInputTokens ?? 0;
    const cacheReadTokens = usage.cacheReadInputTokens ?? 0;

    // Import calculateModelCost from expenses schema
    const { calculateModelCost } = await import("@/db/schema/expenses");
    const aiCost = calculateModelCost(
      modelName,
      inputTokens,
      outputTokens,
      cacheCreationTokens,
      cacheReadTokens,
    );

    // Calculate Tavily costs
    const tavilyCredits = tavilyUsage?.creditsUsed ?? 0;
    const tavilyCost = tavilyUsage?.costUsd ?? 0;

    // Grand total = AI cost + Tavily cost
    const grandTotal = aiCost + tavilyCost;

    // Check if expense record already exists
    const existingExpense = await db.query.sessionExpenses.findFirst({
      where: eq(sessionExpenses.sessionId, sessionIdNum),
    });

    const completionTime = new Date();

    if (existingExpense) {
      // Update existing record
      await db
        .update(sessionExpenses)
        .set({
          sessionCompletionTime: completionTime,
          model1Name: modelName,
          model1InputTokens: inputTokens,
          model1OutputTokens: outputTokens,
          model1CacheCreationTokens: cacheCreationTokens,
          model1CacheReadTokens: cacheReadTokens,
          model1CostUsd: aiCost.toFixed(6),
          totalCostUsd: aiCost.toFixed(6),
          tavilyCreditsUsed: tavilyCredits,
          tavilyCostUsd: tavilyCost.toFixed(6),
          grandTotalCostUsd: grandTotal.toFixed(6),
          updatedAt: completionTime,
        })
        .where(eq(sessionExpenses.id, existingExpense.id));

      console.log(
        `[ExpenseTracking] Updated expense from session ${sessionId}: AI $${aiCost.toFixed(4)} + Tavily $${tavilyCost.toFixed(4)} = $${grandTotal.toFixed(4)}`,
      );
      return String(existingExpense.id);
    } else {
      // Create new record
      const [newExpense] = await db
        .insert(sessionExpenses)
        .values({
          sessionId: sessionIdNum,
          organizationId: organizationIdNum,
          userId: userIdNum,
          username,
          sessionStartTime: sessionStartTime ?? new Date(),
          sessionCompletionTime: completionTime,
          model1Name: modelName,
          model1InputTokens: inputTokens,
          model1OutputTokens: outputTokens,
          model1CacheCreationTokens: cacheCreationTokens,
          model1CacheReadTokens: cacheReadTokens,
          model1CostUsd: aiCost.toFixed(6),
          totalCostUsd: aiCost.toFixed(6),
          tavilyCreditsUsed: tavilyCredits,
          tavilyCostUsd: tavilyCost.toFixed(6),
          grandTotalCostUsd: grandTotal.toFixed(6),
        })
        .returning({ id: sessionExpenses.id });

      console.log(
        `[ExpenseTracking] Created expense from session ${sessionId}: AI $${aiCost.toFixed(4)} + Tavily $${tavilyCost.toFixed(4)} = $${grandTotal.toFixed(4)}`,
      );
      return String(newExpense.id);
    }
  } catch (error) {
    console.error(
      `[ExpenseTracking] Failed to create expense from session ${sessionId}:`,
      error,
    );
    return null;
  }
}
