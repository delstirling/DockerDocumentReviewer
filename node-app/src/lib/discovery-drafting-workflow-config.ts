import {
  type WorkflowConfig,
  type WorkflowValidationResult,
  type StepConfig,
  type StepModelParams,
} from "@/lib/workflow-config";

const DISCOVERY_MODEL_PARAMS: StepModelParams = {
  temperature: 0.1,
  maxTokens: 9000,
  topP: 1,
  frequencyPenalty: 0,
  presencePenalty: 0,
  maxSteps: 1,
};

const DISCOVERY_STEPS: StepConfig[] = [
  {
    id: "discovery-step-1",
    name: "Discovery Scope Review",
    description: "Evaluate request scope, burden, and relevance.",
    order: 1,
    enabled: true,
    systemPrompt:
      "Analyze outgoing discovery content for scope, burden, and legal sufficiency.",
    availableTools: [],
    modelParams: DISCOVERY_MODEL_PARAMS,
  },
  {
    id: "discovery-step-2",
    name: "Executive Summary",
    description: "Summarize key discovery drafting findings.",
    order: 2,
    enabled: true,
    systemPrompt:
      "Write a concise summary emphasizing risk, revisions, and compliance.",
    availableTools: [],
    modelParams: DISCOVERY_MODEL_PARAMS,
  },
  {
    id: "discovery-step-3",
    name: "Revision Checklist",
    description: "List concrete drafting edits and follow-ups.",
    order: 3,
    enabled: true,
    systemPrompt:
      "Generate a numbered revision checklist with clear drafting actions.",
    availableTools: [],
    modelParams: DISCOVERY_MODEL_PARAMS,
  },
];

export const DISCOVERY_DRAFTING_SYSTEM_PROMPT =
  "Operate in discovery drafting mode: improve outbound discovery quality, proportionality, and enforceability.";

export const DISCOVERY_DRAFTING_WORKFLOW_CONFIG: WorkflowConfig = {
  id: "discovery-drafting-workflow",
  name: "Discovery Drafting Workflow",
  description: "Workflow for outgoing discovery documents from our firm.",
  version: 1,
  steps: DISCOVERY_STEPS,
};

export function getDiscoveryDraftingEnabledSteps(
  workflow: WorkflowConfig,
): StepConfig[] {
  return (workflow.steps ?? [])
    .filter((step) => step.enabled)
    .sort((a, b) => a.order - b.order);
}

export function validateDiscoveryDraftingWorkflow(
  workflow: WorkflowConfig,
): WorkflowValidationResult {
  const errors: string[] = [];
  if (!workflow?.steps?.length) {
    errors.push("Discovery drafting workflow has no steps");
  }

  for (const step of workflow.steps ?? []) {
    if (!step.id.startsWith("discovery-step-")) {
      errors.push(
        `Discovery workflow step id must start with discovery-step-: ${step.id}`,
      );
    }
  }

  return { valid: errors.length === 0, errors };
}
