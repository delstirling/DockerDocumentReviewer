/**
 * Centralized Model Configuration
 *
 * This module provides a single source of truth for Anthropic model selection
 * across all parts of the application. Model names should NEVER be hardcoded
 * in individual files - always use these getters.
 *
 * Priority order for model selection (async version):
 * 1. Database setting: primary_model (set via /settings UI) - USER CHOICE TAKES PRIORITY
 * 2. Role-specific env var: CLAUDE_ANALYSIS_MODEL, CLAUDE_PLANNER_MODEL, etc.
 * 3. Global env var: CLAUDE_MODEL
 * 4. Safe default: claude-sonnet-4-6 (Claude Sonnet 4.6)
 *
 * IMPORTANT: The database setting takes precedence over env vars so that
 * users can change the model via the /settings UI without needing to
 * modify environment variables in platform.
 */

import { getPrimaryModel as getPrimaryModelFromDb } from "./settings-service";
import { getProviderConfig } from "./settings-service";

const DEFAULT_MODEL = "claude-sonnet-4-6"; // Claude Sonnet 4.6
const DEFAULT_MODEL_SHORTHAND = "sonnet-4.6";

/**
 * Get the model to use for main analysis workflows (async version)
 * Priority: database setting → CLAUDE_ANALYSIS_MODEL → CLAUDE_MODEL → default
 *
 * IMPORTANT: Database setting takes precedence over env vars so that
 * users can change the model via the /settings UI without needing to
 * modify environment variables in platform.
 *
 * Use this in async contexts where you can await the database call.
 */
export async function getAnalysisModelAsync(): Promise<string> {
  // First, check database setting (user's UI selection takes priority)
  try {
    const dbConfig = await getPrimaryModelFromDb();
    if (dbConfig?.modelId) {
      console.log(
        `[Model Config] Using database model setting: ${dbConfig.modelId}`,
      );
      return resolveModelShorthand(dbConfig.modelId);
    }
  } catch (error) {
    console.error("[Model Config] Failed to load from database:", error);
  }

  // Fall back to env vars if no database setting
  if (process.env.CLAUDE_ANALYSIS_MODEL) {
    console.log(
      `[Model Config] Using CLAUDE_ANALYSIS_MODEL env var: ${process.env.CLAUDE_ANALYSIS_MODEL}`,
    );
    return resolveModelShorthand(process.env.CLAUDE_ANALYSIS_MODEL);
  }
  if (process.env.CLAUDE_MODEL) {
    console.log(
      `[Model Config] Using CLAUDE_MODEL env var: ${process.env.CLAUDE_MODEL}`,
    );
    return resolveModelShorthand(process.env.CLAUDE_MODEL);
  }

  console.log(`[Model Config] Using default model: ${DEFAULT_MODEL}`);
  return DEFAULT_MODEL;
}

/**
 * Get the model to use for main analysis workflows (sync version)
 * Checks: CLAUDE_ANALYSIS_MODEL → CLAUDE_MODEL → default
 * Note: This does NOT check database settings. Use getAnalysisModelAsync for that.
 */
export function getAnalysisModel(): string {
  return (
    process.env.CLAUDE_ANALYSIS_MODEL ||
    process.env.CLAUDE_MODEL ||
    DEFAULT_MODEL
  );
}

/**
 * Get the model to use for planning/workflow generation
 * Checks: CLAUDE_PLANNER_MODEL → CLAUDE_MODEL → default
 */
export function getPlannerModel(): string {
  return (
    process.env.CLAUDE_PLANNER_MODEL ||
    process.env.CLAUDE_MODEL ||
    DEFAULT_MODEL
  );
}

/**
 * Get the model to use for metadata extraction
 * Checks: CLAUDE_METADATA_MODEL → CLAUDE_MODEL → default
 */
export function getMetadataModel(): string {
  return (
    process.env.CLAUDE_METADATA_MODEL ||
    process.env.CLAUDE_MODEL ||
    DEFAULT_MODEL
  );
}

/**
 * Get the model to use for testing
 * Checks: CLAUDE_TEST_MODEL → CLAUDE_MODEL → default
 */
export function getTestModel(): string {
  return (
    process.env.CLAUDE_TEST_MODEL || process.env.CLAUDE_MODEL || DEFAULT_MODEL
  );
}

/**
 * Get the model to use for validation tasks
 * Checks: CLAUDE_VALIDATION_MODEL → CLAUDE_MODEL → default
 */
export function getValidationModel(): string {
  return (
    process.env.CLAUDE_VALIDATION_MODEL ||
    process.env.CLAUDE_MODEL ||
    DEFAULT_MODEL
  );
}

/**
 * Get the configured LLM provider type (async, reads from database)
 * Priority: database setting → LLM_PROVIDER env var → "anthropic"
 */
export async function getProviderTypeAsync(): Promise<
  "anthropic" | "local" | "fireworks"
> {
  try {
    const config = await getProviderConfig();
    if (config?.provider) {
      return config.provider;
    }
  } catch (error) {
    console.error(
      "[Model Config] Failed to load provider from database:",
      error,
    );
  }

  const envProvider = process.env.LLM_PROVIDER;
  if (envProvider === "local") {
    return "local";
  }
  if (envProvider === "fireworks") {
    return "fireworks";
  }

  return "anthropic";
}

/**
 * Get the local model name (async, reads from database)
 * Priority: database setting → LOCAL_MODEL_NAME env var → "llama3.3:70b"
 */
export async function getLocalModelNameAsync(): Promise<string> {
  try {
    const config = await getProviderConfig();
    if (config?.localModelName) {
      return config.localModelName;
    }
  } catch (error) {
    console.error(
      "[Model Config] Failed to load local model from database:",
      error,
    );
  }

  return process.env.LOCAL_MODEL_NAME || "llama3.3:70b";
}

/**
 * Get the Fireworks model name (async, reads from database)
 * Priority: database setting → FIREWORKS_MODEL env var → default
 */
export async function getFireworksModelNameAsync(): Promise<string> {
  try {
    const config = await getProviderConfig();
    if (config?.fireworksModelName) {
      return config.fireworksModelName;
    }
  } catch (error) {
    console.error(
      "[Model Config] Failed to load Fireworks model from database:",
      error,
    );
  }

  return process.env.FIREWORKS_MODEL || "accounts/fireworks/models/kimi-k2p5";
}

/**
 * Log the current model configuration (useful for debugging)
 */
export function logModelConfig(): void {
  console.log("[Model Config] Current configuration:", {
    analysis: getAnalysisModel(),
    planner: getPlannerModel(),
    metadata: getMetadataModel(),
    test: getTestModel(),
    validation: getValidationModel(),
    envVars: {
      CLAUDE_ANALYSIS_MODEL: process.env.CLAUDE_ANALYSIS_MODEL || "not set",
      CLAUDE_PLANNER_MODEL: process.env.CLAUDE_PLANNER_MODEL || "not set",
      CLAUDE_METADATA_MODEL: process.env.CLAUDE_METADATA_MODEL || "not set",
      CLAUDE_TEST_MODEL: process.env.CLAUDE_TEST_MODEL || "not set",
      CLAUDE_VALIDATION_MODEL: process.env.CLAUDE_VALIDATION_MODEL || "not set",
      CLAUDE_MODEL: process.env.CLAUDE_MODEL || "not set",
    },
  });
}

/**
 * Model-specific max output token limits
 * Used to cap maxOutputTokens at runtime to avoid API errors
 */
// Default Claude model used throughout the app. Allows overriding via the
// environment variable `CLAUDE_MODEL`. This mirrors the fallback used in the
// document‑analysis route and other places.
export const DEFAULT_CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

const MODEL_MAX_OUTPUT_TOKENS: Record<string, number> = {
  // Anthropic models
  "claude-sonnet-4-6": 64000,
  "sonnet-4.6": 64000,
  "claude-opus-4-6": 128000,
  "opus-4.6": 128000,
  "claude-sonnet-4-5-20250929": 64000,
  "sonnet-4.5": 64000,
  "claude-opus-4-5-20251101": 32000,
  "opus-4.5": 32000,
  "claude-opus-4-1-20250805": 64000,
  "opus-4.1": 64000,
  "claude-opus-4-20250514": 32000,
  "opus-4": 32000,
  // Use the default model constant as the key so the token limit updates
  // automatically when the environment variable changes.
  [DEFAULT_CLAUDE_MODEL]: 16000,
  "sonnet-4": 16000,
  "claude-3-7-sonnet-20250219": 16000,
  "sonnet-3.7": 16000,
  "claude-haiku-4-5-20251001": 8192,
  "haiku-4.5": 8192,
  "claude-3-5-haiku-20241022": 8192,
  "haiku-3.5": 8192,
  "claude-3-haiku-20240307": 4096,
  "haiku-3": 4096,
  // Fireworks models — Kimi (Moonshot AI)
  "accounts/fireworks/models/kimi-k2p5": 65536,
  "kimi-k2.5": 65536,
  // Fireworks models — GLM (Zhipu AI)
  "accounts/fireworks/models/glm-5": 128000,
  "glm-5": 128000,
  "accounts/fireworks/models/glm-4p5": 16384,
  "glm-4.5": 16384,
};

/** Default fallback when model is unknown */
const DEFAULT_MAX_OUTPUT_TOKENS = 64000;

/**
 * Get the max output token limit for a given model
 * Returns the model-specific limit, or 64000 as a safe default
 */
export function getModelMaxOutputTokens(modelName: string): number {
  return MODEL_MAX_OUTPUT_TOKENS[modelName] ?? DEFAULT_MAX_OUTPUT_TOKENS;
}

/**
 * Check if a model name matches the legacy "opus-4.5" shorthand
 * (used in some conditional logic for model-specific behavior)
 */
export function isOpus45(modelName: string): boolean {
  return modelName === "opus-4.5" || modelName === "claude-opus-4-5-20251101";
}

/**
 * Get the full model ID from a shorthand name
 * Supports legacy shorthand like "opus-4.5" → "claude-opus-4-5-20251101"
 */
export function resolveModelShorthand(modelName: string): string {
  const shorthands: Record<string, string> = {
    // Anthropic shorthands
    "opus-4.6": "claude-opus-4-6",
    "opus-4.5": "claude-opus-4-5-20251101",
    "opus-4.1": "claude-opus-4-1-20250805",
    "opus-4": "claude-opus-4-20250514",
    "sonnet-4.6": "claude-sonnet-4-6",
    "sonnet-4.5": "claude-sonnet-4-5-20250929",
    "sonnet-4": DEFAULT_CLAUDE_MODEL,
    "sonnet-3.7": "claude-3-7-sonnet-20250219",
    "haiku-4.5": "claude-haiku-4-5-20251001",
    "haiku-3.5": "claude-3-5-haiku-20241022",
    "haiku-3": "claude-3-haiku-20240307",
    "claude-haiku-4-5": "claude-haiku-4-5-20251001",
    // Fireworks shorthands
    "kimi-k2.5": "accounts/fireworks/models/kimi-k2p5",
    "glm-5": "accounts/fireworks/models/glm-5",
    "glm-4.5": "accounts/fireworks/models/glm-4p5",
  };

  return shorthands[modelName] || modelName;
}
