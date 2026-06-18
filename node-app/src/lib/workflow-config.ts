import type { ToolId } from "@/lib/ai-tools";

export interface ExtendedThinkingConfig {
  enabled: boolean;
  budgetTokens: number;
}

export interface StepModelParams {
  model?: string;
  temperature: number;
  maxTokens: number;
  topP: number;
  frequencyPenalty: number;
  presencePenalty: number;
  maxSteps: number;
  extendedThinking?: ExtendedThinkingConfig;
}

export interface IterativeStepConfig {
  enabled: boolean;
  itemExtractionMode: string;
  extractionPattern?: string;
  iterationPromptTemplate: string;
  maxIterations: number;
  aggregateResults: boolean;
  aggregationPrompt: string;
  aiDiscretionEnabled: boolean;
}

export interface VerificationSettings {
  legalAuthorityVerification?: {
    enabled: boolean;
    maxRetries?: number;
  };
}

export interface StepConfig {
  id: string;
  name: string;
  description: string;
  order: number;
  category?: string;
  citationScopeRestriction?: "subject_only" | "all_documents";
  enabled: boolean;
  systemPrompt: string;
  availableTools: ToolId[];
  modelParams: StepModelParams;
  iterativeConfig?: IterativeStepConfig;
  verificationSettings?: VerificationSettings;
}

export interface WorkflowConfig {
  id: string;
  name: string;
  description: string;
  version: number;
  steps: StepConfig[];
}

export interface WorkflowValidationResult {
  valid: boolean;
  errors: string[];
}

export const OFFENSIVE_ANALYSIS_PROMPT =
  "Focus on weaknesses, contradictions, and procedural vulnerabilities while preserving accurate legal analysis.";

const DEFAULT_MODEL_PARAMS: StepModelParams = {
  temperature: 0.2,
  maxTokens: 8000,
  topP: 1,
  frequencyPenalty: 0,
  presencePenalty: 0,
  maxSteps: 1,
};

export const DEFAULT_WORKFLOW: WorkflowConfig = {
  id: "default-workflow",
  name: "Default Legal Analysis Workflow",
  description: "Baseline workflow used when no organization override exists.",
  version: 1,
  steps: [
    {
      id: "step-1",
      name: "Issue Spotting",
      description: "Identify claims, defenses, and disputed issues.",
      order: 1,
      enabled: true,
      systemPrompt:
        "Extract the key legal and factual issues from the provided material.",
      availableTools: [],
      modelParams: DEFAULT_MODEL_PARAMS,
    },
    {
      id: "step-2",
      name: "Executive Summary",
      description: "Summarize top findings for attorney review.",
      order: 2,
      enabled: true,
      systemPrompt:
        "Produce a concise executive summary suitable for partner-level review.",
      availableTools: [],
      modelParams: DEFAULT_MODEL_PARAMS,
    },
    {
      id: "step-3",
      name: "Paralegal Action Checklist",
      description: "Generate concrete follow-up tasks.",
      order: 3,
      enabled: true,
      systemPrompt:
        "List concrete, actionable next steps with owners and dependencies.",
      availableTools: [],
      modelParams: DEFAULT_MODEL_PARAMS,
    },
  ],
};

export function getEnabledSteps(workflow: WorkflowConfig): StepConfig[] {
  return (workflow.steps ?? [])
    .filter((step) => step.enabled)
    .sort((a, b) => a.order - b.order);
}

export function validateWorkflow(
  workflow: WorkflowConfig,
): WorkflowValidationResult {
  const errors: string[] = [];

  if (!workflow || typeof workflow !== "object") {
    return { valid: false, errors: ["Workflow config is missing or invalid"] };
  }

  if (!Array.isArray(workflow.steps) || workflow.steps.length === 0) {
    errors.push("Workflow must include at least one step");
  }

  const seenIds = new Set<string>();
  for (const step of workflow.steps ?? []) {
    if (!step.id || typeof step.id !== "string") {
      errors.push("Each step must include a valid id");
      continue;
    }
    if (seenIds.has(step.id)) {
      errors.push(`Duplicate step id: ${step.id}`);
    }
    seenIds.add(step.id);
  }

  return { valid: errors.length === 0, errors };
}