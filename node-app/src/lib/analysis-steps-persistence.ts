import { db } from "@/db/client";
import { analysisSteps } from "@/db/schema";
import { eq, and } from "drizzle-orm";

export interface StepPersistenceData {
  sessionId: unknown;
  stepIndex: number;
  stepName: string;
  stepId?: string;
  analysisText: string;
  thinkingText?: string;
  toolCallCount: number;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export async function persistAnalysisStep(
  data: StepPersistenceData,
): Promise<void> {
  const sessionIdNum = Number(String(data.sessionId ?? ""));

  const existingStep = await db
    .select()
    .from(analysisSteps)
    .where(
      and(
        eq(analysisSteps.analysisSessionId, sessionIdNum),
        eq(analysisSteps.stepIndex, data.stepIndex),
      ),
    )
    .limit(1);

  if (existingStep.length > 0) {
    await db
      .update(analysisSteps)
      .set({
        stepName: data.stepName,
        stepId: data.stepId,
        analysisText: data.analysisText,
        thinkingText: data.thinkingText,
        toolCallCount: data.toolCallCount,
        usage: data.usage,
        updatedAt: new Date(),
      })
      .where(eq(analysisSteps.id, existingStep[0].id));
  } else {
    await db.insert(analysisSteps).values({
      analysisSessionId: sessionIdNum,
      stepIndex: data.stepIndex,
      stepName: data.stepName,
      stepId: data.stepId,
      analysisText: data.analysisText,
      thinkingText: data.thinkingText,
      toolCallCount: data.toolCallCount,
      usage: data.usage,
    });
  }
}

export interface StepSummary {
  stepIndex: number;
  stepName: string;
  charCount: number;
  toolCallCount: number;
}

export function createStepSummary(
  stepIndex: number,
  stepName: string,
  analysisText: string,
  toolCallCount: number,
): StepSummary {
  return {
    stepIndex,
    stepName,
    charCount: analysisText.length,
    toolCallCount,
  };
}
