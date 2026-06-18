import {
  type WorkflowConfig,
  type WorkflowValidationResult,
  type StepModelParams,
  type StepConfig,
} from "@/lib/workflow-config";

const OFFENSE_MODEL_PARAMS: StepModelParams = {
  temperature: 0.15,
  maxTokens: 9000,
  topP: 1,
  frequencyPenalty: 0,
  presencePenalty: 0,
  maxSteps: 1,
};

const OFFENSE_STEPS: StepConfig[] = [
  {
    id: "offense-step-1",
    name: "Claims And Defense Mapping",
    description: "Map dispute framing and burden points.",
    order: 1,
    enabled: true,
    systemPrompt:
      "Identify high-leverage attack surfaces in the record and pleadings.",
    availableTools: [],
    modelParams: OFFENSE_MODEL_PARAMS,
  },
  {
    id: "offense-step-2",
    name: "Executive Summary",
    description: "Summarize strongest offensive themes.",
    order: 2,
    enabled: true,
    systemPrompt:
      "Draft a strategy-focused executive summary with prioritized arguments.",
    availableTools: [],
    modelParams: OFFENSE_MODEL_PARAMS,
  },
  {
    id: "offense-step-3",
    name: "Response Brief Action Checklist",
    description: "List practical drafting tasks.",
    order: 3,
    enabled: true,
    systemPrompt:
      "Generate an attorney-ready checklist for drafting and evidence support.",
    availableTools: [],
    modelParams: OFFENSE_MODEL_PARAMS,
  },
];

export const OFFENSE_SYSTEM_PROMPT =
  "Operate in offense mode: identify vulnerabilities, exploit weak assumptions, and provide actionable litigation strategy.";

export const OFFENSE_WORKFLOW_CONFIG: WorkflowConfig = {
  id: "offense-workflow",
  name: "Offense Workflow",
  description: "Focused workflow for opposing-party document analysis.",
  version: 1,
  steps: OFFENSE_STEPS,
};

export function getOffenseEnabledSteps(workflow: WorkflowConfig): StepConfig[] {
  return (workflow.steps ?? [])
    .filter((step) => step.enabled)
    .sort((a, b) => a.order - b.order);
}

export function validateOffenseWorkflow(
  workflow: WorkflowConfig,
): WorkflowValidationResult {
  const errors: string[] = [];
  if (!workflow?.steps?.length) {
    errors.push("Offense workflow has no steps");
  }

  for (const step of workflow.steps ?? []) {
    if (!step.id.startsWith("offense-step-")) {
      errors.push(`Offense workflow step id must start with offense-step-: ${step.id}`);
    }
  }

  return { valid: errors.length === 0, errors };
}
