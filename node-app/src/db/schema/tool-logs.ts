import {
  pgTable,
  text,
  timestamp,
  jsonb,
  integer,
  bigint,
  boolean,
  index,
  serial,
} from "drizzle-orm/pg-core";
import { analysisSessions, analysisSteps } from "./analysis";

/**
 * Tool Call Logs Table
 * Comprehensive audit trail for all AI tool invocations during analysis
 * Enables debugging of "empty searches" and other tool-related issues
 */
export const toolCallLogs = pgTable(
  "tool_call_logs",
  {
    // Primary identifier
    id: serial("id").primaryKey(),

    analysisSessionId: integer("analysis_session_id")
      .notNull()
      .references(() => analysisSessions.id, { onDelete: "cascade" }),

    analysisStepId: integer("analysis_step_id").references(
      () => analysisSteps.id,
      {
        onDelete: "cascade",
      },
    ),

    stepIndex: integer("step_index"), // Denormalized for quick filtering
    stepName: text("step_name"), // Denormalized for quick filtering

    toolName: text("tool_name").notNull(), // e.g., "tavily_search", "courtlistener_search"
    toolCategory: text("tool_category"), // e.g., "web_research", "legal_research"

    toolInput: jsonb("tool_input").notNull(), // Complete input arguments as JSON
    toolOutput: jsonb("tool_output"), // Complete output/result as JSON

    httpMethod: text("http_method"), // e.g., "GET", "POST"
    httpUrl: text("http_url"), // Full URL called (with query params redacted if sensitive)
    httpStatusCode: integer("http_status_code"), // e.g., 200, 429, 500
    httpResponseSize: bigint("http_response_size", { mode: "number" }), // Response size in bytes

    startedAt: timestamp("started_at").notNull(),
    completedAt: timestamp("completed_at"),
    elapsedMs: integer("elapsed_ms"), // Execution time in milliseconds

    errorCategory: text("error_category"), // e.g., "network", "validation", "rate_limit", "empty_result"
    errorMessage: text("error_message"), // Human-readable error description
    errorStack: text("error_stack"), // Stack trace for debugging

    isEmptyInput: boolean("is_empty_input").default(false), // Query/input was empty or too short
    isEmptyOutput: boolean("is_empty_output").default(false), // Result array was empty
    isTimeout: boolean("is_timeout").default(false), // Request timed out
    isRateLimited: boolean("is_rate_limited").default(false), // 429 or rate limit detected
    isNetworkError: boolean("is_network_error").default(false), // Network/fetch failure

    metadata: jsonb("metadata"), // Flexible field for provider-specific data

    // Timestamps
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    sessionIdIdx: index("idx_tool_call_logs_session_id").on(
      table.analysisSessionId,
    ),
    stepIdIdx: index("idx_tool_call_logs_step_id").on(table.analysisStepId),
    toolNameIdx: index("idx_tool_call_logs_tool_name").on(table.toolName),
    errorCategoryIdx: index("idx_tool_call_logs_error_category").on(
      table.errorCategory,
    ),
    diagnosticIdx: index("idx_tool_call_logs_diagnostic").on(
      table.isEmptyInput,
      table.isEmptyOutput,
      table.isTimeout,
      table.isRateLimited,
    ),
    startedAtIdx: index("idx_tool_call_logs_started_at").on(table.startedAt),
  }),
);

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type ToolCallLog = typeof toolCallLogs.$inferSelect;
export type NewToolCallLog = typeof toolCallLogs.$inferInsert;

// ============================================================================
// ============================================================================

/**
 * Error category types for tool calls
 */
export type ToolErrorCategory =
  | "network"
  | "validation"
  | "rate_limit"
  | "empty_result"
  | "timeout"
  | "authentication"
  | "unknown";

/**
 * Tool category types
 */
export type ToolCategory =
  | "web_research"
  | "legal_research"
  | "document_analysis"
  | "government_monitoring"
  | "verification";

/**
 * Diagnostic summary for a session's tool calls
 */
export interface ToolCallDiagnostics {
  sessionId: number;
  totalToolCalls: number;
  successfulCalls: number;
  failedCalls: number;
  emptyInputCalls: number;
  emptyOutputCalls: number;
  timeoutCalls: number;
  rateLimitedCalls: number;
  networkErrorCalls: number;
  averageElapsedMs: number;
  toolBreakdown: {
    toolName: string;
    count: number;
    successRate: number;
    avgElapsedMs: number;
  }[];
  errorBreakdown: {
    errorCategory: string;
    count: number;
  }[];
}
