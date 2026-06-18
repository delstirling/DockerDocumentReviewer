import { db } from "@/db/client";
import { stepToolAvailability } from "@/db/schema";
import { and, eq } from "drizzle-orm";

export async function logStepToolAvailability(
  analysisSessionId: unknown,
  stepIndex: number,
  stepName: string,
  toolsOffered: string[],
  analysisStepId?: string,
): Promise<void> {
  const analysisSessionIdNum = Number(String(analysisSessionId ?? ""));
  const analysisStepIdNum = analysisStepId ? Number(String(analysisStepId)) : null;
  try {
    await db.insert(stepToolAvailability).values({
      analysisSessionId: analysisSessionIdNum,
      analysisStepId: analysisStepIdNum,
      stepIndex,
      stepName,
      toolsOffered,
      toolsUsedCount: 0,
    });

    console.log(
      `[Step Tool Logger] Logged ${toolsOffered.length} tools offered for step ${stepIndex}: ${stepName}`,
    );
  } catch (error) {
    console.error(
      `[Step Tool Logger] Failed to log tools offered for step ${stepIndex}:`,
      error,
    );
    throw error;
  }
}

export async function updateStepToolUsageCount(
  analysisSessionId: unknown,
  stepIndex: number,
  toolsUsedCount: number,
): Promise<void> {
  const analysisSessionIdNum = Number(String(analysisSessionId ?? ""));
  try {
    await db
      .update(stepToolAvailability)
      .set({ toolsUsedCount })
      .where(
        and(
          eq(stepToolAvailability.analysisSessionId, analysisSessionIdNum),
          eq(stepToolAvailability.stepIndex, stepIndex),
        ),
      );

    console.log(
      `[Step Tool Logger] Updated tools used count for step ${stepIndex}: ${toolsUsedCount}`,
    );
  } catch (error) {
    console.error(
      `[Step Tool Logger] Failed to update tools used count for step ${stepIndex}:`,
      error,
    );
  }
}
