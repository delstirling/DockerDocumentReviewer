type ValidationSuccess<T> = {
  success: true;
  data: T;
};

type ValidationFailure = {
  success: false;
  error: string;
};

type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

type Schema<T> = {
  parse: (input: unknown) => T;
};

type CreateSessionInput = {
  title: string;
  document_type?: string | null;
  case_type?: string | null;
  jurisdiction?: string | null;
  our_clients?: string[];
  opposing_parties?: string[];
  context_summary?: string | null;
  ai_mode?: "none" | "tools" | "tools_and_steps";
  workflow_config_id?: number | null;
  metadata?: Record<string, unknown>;
};

type UpdateSessionInput = {
  title?: string;
  status?: string;
  documentType?: string | null;
  caseType?: string | null;
  jurisdiction?: string | null;
  ourClients?: string[];
  opposingParties?: string[];
  contextSummary?: string | null;
  aiMode?: "none" | "tools" | "tools_and_steps";
  workflowConfigId?: number | null;
  metadata?: Record<string, unknown>;
  analysisResult?: Record<string, unknown>;
  currentStep?: number;
  totalSteps?: number;
  startedAt?: Date | null;
  completedAt?: Date | null;
};

const AI_MODES = new Set(["none", "tools", "tools_and_steps"]);

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const asOptionalString = (value: unknown, field: string): string | null | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error(`${field} must be a string`);
  }

  return value;
};

const asRequiredString = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} is required`);
  }

  return value.trim();
};

const asOptionalStringArray = (value: unknown, field: string): string[] | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${field} must be an array of strings`);
  }

  return value;
};

const asOptionalAiMode = (
  value: unknown,
  field: string,
): "none" | "tools" | "tools_and_steps" | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || !AI_MODES.has(value)) {
    throw new Error(`${field} must be one of none, tools, or tools_and_steps`);
  }

  return value as "none" | "tools" | "tools_and_steps";
};

const asOptionalNumber = (value: unknown, field: string): number | null | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`${field} must be a number`);
  }

  return value;
};

const asOptionalDate = (value: unknown, field: string): Date | null | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (value instanceof Date) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`${field} must be a valid date`);
    }
    return parsed;
  }

  throw new Error(`${field} must be a valid date`);
};

const asOptionalRecord = (
  value: unknown,
  field: string,
): Record<string, unknown> | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new Error(`${field} must be an object`);
  }

  return value;
};

export const createSessionSchema: Schema<CreateSessionInput> = {
  parse(input: unknown): CreateSessionInput {
    if (!isRecord(input)) {
      throw new Error("Request body must be an object");
    }

    return {
      title: asRequiredString(input.title, "title"),
      document_type: asOptionalString(input.document_type, "document_type"),
      case_type: asOptionalString(input.case_type, "case_type"),
      jurisdiction: asOptionalString(input.jurisdiction, "jurisdiction"),
      our_clients: asOptionalStringArray(input.our_clients, "our_clients"),
      opposing_parties: asOptionalStringArray(
        input.opposing_parties,
        "opposing_parties",
      ),
      context_summary: asOptionalString(
        input.context_summary,
        "context_summary",
      ),
      ai_mode: asOptionalAiMode(input.ai_mode, "ai_mode"),
      workflow_config_id: asOptionalNumber(
        input.workflow_config_id,
        "workflow_config_id",
      ),
      metadata: asOptionalRecord(input.metadata, "metadata"),
    };
  },
};

export const UPDATABLE_SESSION_FIELDS = [
  "title",
  "status",
  "documentType",
  "caseType",
  "jurisdiction",
  "ourClients",
  "opposingParties",
  "contextSummary",
  "aiMode",
  "workflowConfigId",
  "metadata",
  "analysisResult",
  "currentStep",
  "totalSteps",
  "startedAt",
  "completedAt",
] as const;

export const updateSessionSchema: Schema<UpdateSessionInput> = {
  parse(input: unknown): UpdateSessionInput {
    if (!isRecord(input)) {
      throw new Error("Request body must be an object");
    }

    return {
      title: asOptionalString(input.title, "title") ?? undefined,
      status: asOptionalString(input.status, "status") ?? undefined,
      documentType:
        asOptionalString(input.documentType, "documentType") ?? undefined,
      caseType: asOptionalString(input.caseType, "caseType") ?? undefined,
      jurisdiction:
        asOptionalString(input.jurisdiction, "jurisdiction") ?? undefined,
      ourClients:
        asOptionalStringArray(input.ourClients, "ourClients") ?? undefined,
      opposingParties:
        asOptionalStringArray(input.opposingParties, "opposingParties") ??
        undefined,
      contextSummary:
        asOptionalString(input.contextSummary, "contextSummary") ?? undefined,
      aiMode: asOptionalAiMode(input.aiMode, "aiMode"),
      workflowConfigId:
        asOptionalNumber(input.workflowConfigId, "workflowConfigId") ??
        undefined,
      metadata: asOptionalRecord(input.metadata, "metadata"),
      analysisResult: asOptionalRecord(input.analysisResult, "analysisResult"),
      currentStep: asOptionalNumber(input.currentStep, "currentStep") ?? undefined,
      totalSteps: asOptionalNumber(input.totalSteps, "totalSteps") ?? undefined,
      startedAt: asOptionalDate(input.startedAt, "startedAt") ?? undefined,
      completedAt: asOptionalDate(input.completedAt, "completedAt") ?? undefined,
    };
  },
};

export function validateInput<T>(
  schema: Schema<T>,
  input: unknown,
): ValidationResult<T> {
  try {
    return {
      success: true,
      data: schema.parse(input),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Invalid input",
    };
  }
}

export function filterToWhitelist<
  T extends Record<string, unknown>,
  K extends readonly (keyof T)[],
>(data: T, whitelist: K): Partial<Pick<T, K[number]>> {
  return whitelist.reduce<Partial<Pick<T, K[number]>>>((result, key) => {
    if (data[key] !== undefined) {
      result[key] = data[key];
    }
    return result;
  }, {});
}