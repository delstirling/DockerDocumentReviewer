import type { WorkflowConfig, StepConfig } from "@/lib/workflow-config";

interface ReportingStepsResult {
  executiveSummaryStepId: string | null;
  executiveSummaryStepIndex: number;
  paralegalChecklistStepId: string | null;
  paralegalChecklistStepIndex: number;
  qualityGateStepId: string | null;
  qualityGateStepIndex: number;
  lessonsLearnedStepId: string | null;
  lessonsLearnedStepIndex: number;
  allReportingStepIds: string[];
}

function findStepByPatterns(
  steps: StepConfig[],
  patterns: RegExp[],
): { step: StepConfig | null; index: number } {
  const index = steps.findIndex((step) =>
    patterns.some((pattern) => pattern.test(step.name)),
  );

  if (index < 0) {
    return { step: null, index: -1 };
  }

  return { step: steps[index], index };
}

export function identifyReportingSteps(
  workflow: WorkflowConfig,
  isOffenseMode = false,
  isDiscoveryDraftingMode = false,
): ReportingStepsResult {
  const steps = workflow.steps || [];

  const executiveSummary = findStepByPatterns(steps, [/executive summary/i]);
  const qualityGate = findStepByPatterns(steps, [/quality gate/i]);
  const lessonsLearned = findStepByPatterns(steps, [/lessons learned/i]);

  const checklistPatterns = isDiscoveryDraftingMode
    ? [/revision checklist/i, /action checklist/i]
    : isOffenseMode
      ? [/response brief action checklist/i, /action checklist/i]
      : [/paralegal action checklist/i, /action checklist/i];

  const checklist = findStepByPatterns(steps, checklistPatterns);

  const allReportingStepIds = [
    executiveSummary.step?.id,
    checklist.step?.id,
    qualityGate.step?.id,
    lessonsLearned.step?.id,
  ].filter((id): id is string => Boolean(id));

  return {
    executiveSummaryStepId: executiveSummary.step?.id ?? null,
    executiveSummaryStepIndex: executiveSummary.index,
    paralegalChecklistStepId: checklist.step?.id ?? null,
    paralegalChecklistStepIndex: checklist.index,
    qualityGateStepId: qualityGate.step?.id ?? null,
    qualityGateStepIndex: qualityGate.index,
    lessonsLearnedStepId: lessonsLearned.step?.id ?? null,
    lessonsLearnedStepIndex: lessonsLearned.index,
    allReportingStepIds,
  };
}
