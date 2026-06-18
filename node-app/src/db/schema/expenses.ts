/**
 * Session Expenses Schema
 * Tracks token usage and costs per analysis session
 * Supports up to 3 different models per session
 */

import {
  pgTable,
  text,
  timestamp,
  integer,
  numeric,
  index,
  serial,
} from "drizzle-orm/pg-core";
import { analysisSessions } from "./analysis";
import { organizations, users } from "./auth";

/**
 * Session Expenses Table
 * Stores per-session token usage and cost data for billing and analytics
 */
export const sessionExpenses = pgTable(
  "session_expenses",
  {
    id: serial("id").primaryKey(),

    // Session relationship
    sessionId: integer("session_id")
      .notNull()
      .references(() => analysisSessions.id, { onDelete: "cascade" }),

    // Multi-tenant support
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    // User who initiated the session
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    // Cached username for display (avoids joins in queries)
    username: text("username"),

    // Session timing
    sessionStartTime: timestamp("session_start_time"), // Start time of first step
    sessionCompletionTime: timestamp("session_completion_time"), // When session completed

    // Model 1 usage (primary model - always used)
    model1Name: text("model_1_name"),
    model1InputTokens: integer("model_1_input_tokens").default(0),
    model1OutputTokens: integer("model_1_output_tokens").default(0),
    model1CacheCreationTokens: integer("model_1_cache_creation_tokens").default(
      0,
    ),
    model1CacheReadTokens: integer("model_1_cache_read_tokens").default(0),
    model1CostUsd: numeric("model_1_cost_usd", {
      precision: 10,
      scale: 6,
    }).default("0"),

    // Model 2 usage (optional - e.g., verification model)
    model2Name: text("model_2_name"),
    model2InputTokens: integer("model_2_input_tokens").default(0),
    model2OutputTokens: integer("model_2_output_tokens").default(0),
    model2CacheCreationTokens: integer("model_2_cache_creation_tokens").default(
      0,
    ),
    model2CacheReadTokens: integer("model_2_cache_read_tokens").default(0),
    model2CostUsd: numeric("model_2_cost_usd", {
      precision: 10,
      scale: 6,
    }).default("0"),

    // Model 3 usage (optional - e.g., planner model)
    model3Name: text("model_3_name"),
    model3InputTokens: integer("model_3_input_tokens").default(0),
    model3OutputTokens: integer("model_3_output_tokens").default(0),
    model3CacheCreationTokens: integer("model_3_cache_creation_tokens").default(
      0,
    ),
    model3CacheReadTokens: integer("model_3_cache_read_tokens").default(0),
    model3CostUsd: numeric("model_3_cost_usd", {
      precision: 10,
      scale: 6,
    }).default("0"),

    // Combined total cost (AI models only, for backward compatibility)
    totalCostUsd: numeric("total_cost_usd", {
      precision: 10,
      scale: 6,
    }).default("0"),

    // Tavily API usage
    tavilyCreditsUsed: integer("tavily_credits_used").default(0),
    tavilyCostUsd: numeric("tavily_cost_usd", {
      precision: 10,
      scale: 6,
    }).default("0"),

    // Grand total (AI + Tavily combined)
    grandTotalCostUsd: numeric("grand_total_cost_usd", {
      precision: 10,
      scale: 6,
    }).default("0"),

    // Timestamps
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    // Indexes for efficient queries
    sessionIdIdx: index("idx_session_expenses_session_id").on(table.sessionId),
    organizationIdIdx: index("idx_session_expenses_organization_id").on(
      table.organizationId,
    ),
    userIdIdx: index("idx_session_expenses_user_id").on(table.userId),
    completionTimeIdx: index("idx_session_expenses_completion_time").on(
      table.sessionCompletionTime,
    ),
    orgCompletionIdx: index("idx_session_expenses_org_completion").on(
      table.organizationId,
      table.sessionCompletionTime,
    ),
  }),
);

// Type exports
export type SessionExpense = typeof sessionExpenses.$inferSelect;
export type NewSessionExpense = typeof sessionExpenses.$inferInsert;

/**
 * Model pricing configuration (per 1K tokens)
 * These values should be updated when Anthropic changes pricing
 */
export const MODEL_PRICING = {
  // Claude Sonnet 4.5
  "claude-sonnet-4-5-20250929": {
    inputPer1K: 0.003,
    outputPer1K: 0.015,
    cacheCreationPer1K: 0.00375,
    cacheReadPer1K: 0.0003,
  },
  // Claude Opus 4.5
  "claude-opus-4-5-20251101": {
    inputPer1K: 0.005,
    outputPer1K: 0.025,
    cacheCreationPer1K: 0.00625,
    cacheReadPer1K: 0.0005,
  },
  // Claude Haiku 4.5 (for verification)
  "claude-haiku-4-5-20251001": {
    inputPer1K: 0.001,
    outputPer1K: 0.005,
    cacheCreationPer1K: 0.00125,
    cacheReadPer1K: 0.0001,
  },
  // Default pricing (fallback)
  default: {
    inputPer1K: 0.003,
    outputPer1K: 0.015,
    cacheCreationPer1K: 0.00375,
    cacheReadPer1K: 0.0003,
  },
} as const;

/**
 * Tavily API pricing configuration
 * Based on pay-as-you-go rate of $0.008 per credit
 * Update this if you have a different plan (Bootstrap: $0.0067, Startup: $0.0058, Growth: $0.005)
 */
export const TAVILY_PRICING = {
  costPerCredit: 0.008, // Pay-as-you-go rate
  // Credit costs by operation type
  credits: {
    searchBasic: 1,
    searchAdvanced: 2,
    extractBasicPer5Urls: 1,
    extractAdvancedPer5Urls: 2,
    mapPer10Pages: 1,
    mapWithInstructionsPer10Pages: 2,
  },
} as const;

/**
 * Calculate Tavily credits used based on tool name and input parameters
 */
export function calculateTavilyCredits(
  toolName: string,
  toolInput: Record<string, unknown>,
): number {
  const searchDepth = (toolInput.searchDepth ||
    toolInput.search_depth ||
    "basic") as string;

  switch (toolName) {
    case "tavily-search":
    case "tavily_search":
    case "tavilySearchTool":
    case "tavily-basic-search":
    case "tavily-deep-search":
    case "tavily-filtered-search":
      return searchDepth === "advanced"
        ? TAVILY_PRICING.credits.searchAdvanced
        : TAVILY_PRICING.credits.searchBasic;

    case "tavily-answer":
    case "tavily_answer":
    case "tavilyAnswerQuestionTool":
      return searchDepth === "advanced"
        ? TAVILY_PRICING.credits.searchAdvanced
        : TAVILY_PRICING.credits.searchBasic;

    case "tavily-extract":
    case "tavily_extract":
    case "tavilyExtractTextTool":
    case "batch-url-extractor": {
      const urls = toolInput.urls as string[] | undefined;
      const urlCount = urls?.length || 1;
      const extractDepth = (toolInput.extractDepth ||
        toolInput.extract_depth ||
        "basic") as string;
      const creditsPer5 =
        extractDepth === "advanced"
          ? TAVILY_PRICING.credits.extractAdvancedPer5Urls
          : TAVILY_PRICING.credits.extractBasicPer5Urls;
      return Math.ceil(urlCount / 5) * creditsPer5;
    }

    case "tavily-map":
    case "tavily_map":
    case "tavilyMapSiteTool": {
      const limit = (toolInput.limit as number) || 10;
      const hasInstructions = !!toolInput.instructions;
      const creditsPer10 = hasInstructions
        ? TAVILY_PRICING.credits.mapWithInstructionsPer10Pages
        : TAVILY_PRICING.credits.mapPer10Pages;
      return Math.ceil(limit / 10) * creditsPer10;
    }

    case "tavily-crawl":
    case "tavily_crawl":
    case "tavilyCrawlSiteTool": {
      const maxPages =
        (toolInput.max_pages as number) || (toolInput.maxPages as number) || 10;
      const extractDepth = (toolInput.extractDepth ||
        toolInput.extract_depth ||
        "basic") as string;
      const mapCredits =
        Math.ceil(maxPages / 10) * TAVILY_PRICING.credits.mapPer10Pages;
      const extractCredits =
        Math.ceil(maxPages / 5) *
        (extractDepth === "advanced"
          ? TAVILY_PRICING.credits.extractAdvancedPer5Urls
          : TAVILY_PRICING.credits.extractBasicPer5Urls);
      return mapCredits + extractCredits;
    }

    default:
      // Unknown Tavily tool, assume 1 credit
      if (toolName.toLowerCase().includes("tavily")) {
        return 1;
      }
      return 0;
  }
}

/**
 * Calculate Tavily cost in USD from credits used
 */
export function calculateTavilyCost(creditsUsed: number): number {
  return creditsUsed * TAVILY_PRICING.costPerCredit;
}

/**
 * Calculate cost for a given model and token usage
 */
export function calculateModelCost(
  modelName: string,
  inputTokens: number,
  outputTokens: number,
  cacheCreationTokens: number = 0,
  cacheReadTokens: number = 0,
): number {
  const pricing =
    MODEL_PRICING[modelName as keyof typeof MODEL_PRICING] ||
    MODEL_PRICING.default;

  const inputCost = (inputTokens / 1000) * pricing.inputPer1K;
  const outputCost = (outputTokens / 1000) * pricing.outputPer1K;
  const cacheCreationCost =
    (cacheCreationTokens / 1000) * pricing.cacheCreationPer1K;
  const cacheReadCost = (cacheReadTokens / 1000) * pricing.cacheReadPer1K;

  return inputCost + outputCost + cacheCreationCost + cacheReadCost;
}
