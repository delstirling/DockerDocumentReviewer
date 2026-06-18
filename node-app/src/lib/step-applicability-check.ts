import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { db } from "@/db/client";
import { analysisSessions, analysisSteps } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { StepConfig } from "./workflow-config";

const APPLICABILITY_CHECK_THRESHOLD = 5;

interface ApplicabilityCheckResult {
  isApplicable: boolean;
  rawResponse: string;
  skipped: boolean;
}

interface StepAttemptState {
  lastAttemptedStepId: string | null;
  lastAttemptedStepOrder: number | null;
  attemptsOnCurrentStep: number;
}

export async function checkStepApplicability(
  sessionId: unknown,
  step: StepConfig,
  documentText: string,
  metadata: {
    documentType?: string | null;
    caseType?: string | null;
    jurisdiction?: string | null;
    ourClients?: string[] | null;
    opposingParties?: string[] | null;
    contextSummary?: string | null;
  },
): Promise<ApplicabilityCheckResult> {
  const sessionIdText = String(sessionId ?? "");
  const anthropic = createAnthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  const truncatedDocumentText =
    documentText.length > 50000
      ? documentText.substring(0, 50000) +
        "\n\n[Document truncated for applicability check]"
      : documentText;

  const metadataText = [
    metadata.documentType ? `Document Type: ${metadata.documentType}` : null,
    metadata.caseType ? `Case Type: ${metadata.caseType}` : null,
    metadata.jurisdiction ? `Jurisdiction: ${metadata.jurisdiction}` : null,
    metadata.ourClients?.length
      ? `Our Clients: ${metadata.ourClients.join(", ")}`
      : null,
    metadata.opposingParties?.length
      ? `Opposing Parties: ${metadata.opposingParties.join(", ")}`
      : null,
    metadata.contextSummary
      ? `Context Summary: ${metadata.contextSummary}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  const prompt = `Given the information I am sharing with you, does the current step, which is "${step.name}: ${step.description}", actually apply to the analysis of the specific content under review? You must answer with ONLY the word "Yes" or "No" because your answer must be compatible with our automated programming.

METADATA:
${metadataText || "No metadata provided"}

DOCUMENT CONTENT:
${truncatedDocumentText}

Remember: Answer with ONLY "Yes" or "No".`;

  try {
    const result = await generateText({
      model: anthropic("claude-sonnet-4-20250514"),
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      maxOutputTokens: 5,
    });

    const response = result.text.trim().toLowerCase();
    const isApplicable = response !== "no";

    console.log(
      `[StepApplicabilityCheck] Step "${step.name}" (${step.id}): response="${result.text.trim()}", isApplicable=${isApplicable}`,
    );

    return {
      isApplicable,
      rawResponse: result.text.trim(),
      skipped: !isApplicable,
    };
  } catch (error) {
    console.error(
      `[StepApplicabilityCheck] Error checking applicability for step "${step.name}":`,
      error,
    );
    return {
      isApplicable: true,
      rawResponse: "Error - defaulting to applicable",
      skipped: false,
    };
  }
}

export async function updateStepAttemptState(
  sessionId: unknown,
  step: StepConfig,
): Promise<{
  attemptsOnCurrentStep: number;
  shouldCheckApplicability: boolean;
}> {
  const sessionIdText = String(sessionId ?? "");
  const sessionIdNum = Number(sessionIdText);
  const session = await db
    .select({
      lastAttemptedStepId: analysisSessions.lastAttemptedStepId,
      lastAttemptedStepOrder: analysisSessions.lastAttemptedStepOrder,
      attemptsOnCurrentStep: analysisSessions.attemptsOnCurrentStep,
    })
    .from(analysisSessions)
    .where(eq(analysisSessions.id, sessionIdNum))
    .limit(1);

  if (!session.length) {
    throw new Error(`Session ${sessionIdText} not found`);
  }

  const currentState = session[0];
  let newAttempts: number;

  if (currentState.lastAttemptedStepId === step.id) {
    newAttempts = (currentState.attemptsOnCurrentStep || 0) + 1;
  } else {
    newAttempts = 1;
  }

  await db
    .update(analysisSessions)
    .set({
      lastAttemptedStepId: step.id,
      lastAttemptedStepOrder: step.order,
      attemptsOnCurrentStep: newAttempts,
      updatedAt: new Date(),
    })
    .where(eq(analysisSessions.id, sessionIdNum));

  console.log(
    `[StepAttemptTracking] Session ${sessionIdText}: step="${step.name}" (${step.id}), attempts=${newAttempts}, threshold=${APPLICABILITY_CHECK_THRESHOLD}`,
  );

  return {
    attemptsOnCurrentStep: newAttempts,
    shouldCheckApplicability: newAttempts >= APPLICABILITY_CHECK_THRESHOLD,
  };
}

export async function resetStepAttemptState(sessionId: unknown): Promise<void> {
  const sessionIdText = String(sessionId ?? "");
  const sessionIdNum = Number(sessionIdText);
  await db
    .update(analysisSessions)
    .set({
      attemptsOnCurrentStep: 0,
      updatedAt: new Date(),
    })
    .where(eq(analysisSessions.id, sessionIdNum));

  console.log(
    `[StepAttemptTracking] Session ${sessionIdText}: reset attempts to 0 after step completion`,
  );
}

export async function persistSkippedStep(
  sessionId: unknown,
  stepIndex: number,
  step: StepConfig,
  applicabilityResult: ApplicabilityCheckResult,
): Promise<void> {
  const sessionIdText = String(sessionId ?? "");
  const skippedText = `SKIPPED (Not Applicable)

This step was automatically skipped after ${APPLICABILITY_CHECK_THRESHOLD} failed attempts.

Step Name: ${step.name}
Step Description: ${step.description}

Applicability Check Result: ${applicabilityResult.rawResponse}

The system determined that this step does not apply to the specific content under review.`;

  await db.insert(analysisSteps).values({
    analysisSessionId: Number(sessionIdText),
    stepIndex,
    stepName: step.name,
    stepId: step.id,
    analysisText: skippedText,
    toolCallCount: 0,
  });

  console.log(
    `[StepApplicabilityCheck] Persisted skipped step record for step ${stepIndex + 1} (${step.name})`,
  );
}

export async function advanceToNextStep(
  sessionId: unknown,
  currentStepIndex: number,
): Promise<void> {
  const sessionIdText = String(sessionId ?? "");
  const sessionIdNum = Number(sessionIdText);
  await db
    .update(analysisSessions)
    .set({
      currentStep: currentStepIndex + 1,
      attemptsOnCurrentStep: 0,
      updatedAt: new Date(),
    })
    .where(eq(analysisSessions.id, sessionIdNum));

  console.log(
    `[StepApplicabilityCheck] Advanced session ${sessionIdText} from step ${currentStepIndex} to step ${currentStepIndex + 1}`,
  );
}

export { APPLICABILITY_CHECK_THRESHOLD };
