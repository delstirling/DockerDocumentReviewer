import { db } from "@/db/client";
import { toolCallLogs } from "@/db/schema";

/**
 * Tool Call Logger
 *
 * Wraps AI tool executions to capture comprehensive audit trails including:
 * - Tool inputs and outputs
 * - Execution timing and performance metrics
 * - HTTP request/response details for external API calls
 * - Error tracking and categorization
 * - Diagnostic flags for empty searches, timeouts, rate limits
 */

export interface ToolCallContext {
  analysisSessionId: unknown;
  analysisStepId?: string;
  stepIndex?: number;
  stepName?: string;
}

export interface ToolCallMetadata {
  httpMethod?: string;
  httpUrl?: string;
  httpStatusCode?: number;
  httpResponseSize?: number;
  errorCategory?: string;
  errorMessage?: string;
  errorStack?: string;
  metadata?: Record<string, any>;
}

/**
 * Logs a tool call execution to the database
 */
export async function logToolCall(
  context: ToolCallContext,
  toolName: string,
  toolCategory: string | undefined,
  toolInput: any,
  toolOutput: any,
  startedAt: Date,
  completedAt: Date,
  metadata?: ToolCallMetadata,
): Promise<void> {
  try {
    const analysisSessionIdText = String(context.analysisSessionId ?? "");
    const analysisSessionIdNum = Number(analysisSessionIdText);
    const analysisStepIdNum = context.analysisStepId ? Number(String(context.analysisStepId)) : null;
    const elapsedMs = completedAt.getTime() - startedAt.getTime();

    const isEmptyInput = analyzeEmptyInput(toolInput);
    const isEmptyOutput = analyzeEmptyOutput(toolOutput);
    const isTimeout = metadata?.errorCategory === "timeout";
    const isRateLimited =
      metadata?.httpStatusCode === 429 ||
      metadata?.errorCategory === "rate_limit";
    const isNetworkError = metadata?.errorCategory === "network";

    await db.insert(toolCallLogs).values({
      analysisSessionId: analysisSessionIdNum,
      analysisStepId: analysisStepIdNum,
      stepIndex: context.stepIndex,
      stepName: context.stepName,
      toolName,
      toolCategory,
      // Ensure toolInput is never undefined/null (NOT NULL constraint in DB)
      toolInput: (toolInput ?? {}) as any,
      toolOutput: toolOutput as any,
      httpMethod: metadata?.httpMethod,
      httpUrl: metadata?.httpUrl,
      httpStatusCode: metadata?.httpStatusCode,
      httpResponseSize: metadata?.httpResponseSize
        ? Number(metadata.httpResponseSize)
        : undefined,
      startedAt,
      completedAt,
      elapsedMs,
      errorCategory: metadata?.errorCategory,
      errorMessage: metadata?.errorMessage,
      errorStack: metadata?.errorStack,
      isEmptyInput,
      isEmptyOutput,
      isTimeout,
      isRateLimited,
      isNetworkError,
      metadata: metadata?.metadata as any,
    });
  } catch (error) {
    console.error("Failed to log tool call:", error);
  }
}

/**
 * Analyzes tool input to detect empty or invalid queries
 */
function analyzeEmptyInput(toolInput: any): boolean {
  if (!toolInput) return true;

  if (typeof toolInput === "object") {
    const query = toolInput.query || toolInput.q || toolInput.search;
    if (query !== undefined) {
      if (typeof query === "string") {
        const trimmed = query.trim();
        return trimmed.length === 0 || trimmed.length < 3;
      }
    }
  }

  return false;
}

/**
 * Analyzes tool output to detect empty results
 */
function analyzeEmptyOutput(toolOutput: any): boolean {
  if (!toolOutput) return true;

  if (toolOutput.error) return false; // Errors are not "empty" - they're failures

  if (Array.isArray(toolOutput.results)) {
    return toolOutput.results.length === 0;
  }

  if (toolOutput.data !== undefined) {
    if (Array.isArray(toolOutput.data)) {
      return toolOutput.data.length === 0;
    }
    return !toolOutput.data;
  }

  if (
    typeof toolOutput.count === "number" ||
    typeof toolOutput.total === "number"
  ) {
    return (toolOutput.count || toolOutput.total) === 0;
  }

  return false;
}

/**
 * Wraps a tool execution with logging
 */
export async function executeToolWithLogging<T>(
  context: ToolCallContext,
  toolName: string,
  toolCategory: string | undefined,
  toolInput: any,
  executeFunction: () => Promise<T>,
  extractMetadata?: (result: T, error?: Error) => ToolCallMetadata,
): Promise<T> {
  const startedAt = new Date();
  let result: T;
  let error: Error | undefined;
  let metadata: ToolCallMetadata = {};

  try {
    result = await executeFunction();

    if (extractMetadata) {
      metadata = extractMetadata(result);
    }

    return result;
  } catch (err) {
    error = err instanceof Error ? err : new Error(String(err));

    metadata = {
      errorCategory: categorizeError(error),
      errorMessage: error.message,
      errorStack: error.stack,
      ...(extractMetadata ? extractMetadata(undefined as any, error) : {}),
    };

    throw error;
  } finally {
    const completedAt = new Date();

    logToolCall(
      context,
      toolName,
      toolCategory,
      toolInput,
      result!,
      startedAt,
      completedAt,
      metadata,
    ).catch((logError) => {
      console.error("Failed to log tool call:", logError);
    });
  }
}

/**
 * Categorizes errors for diagnostic purposes
 */
function categorizeError(error: Error): string {
  const message = error.message.toLowerCase();

  if (message.includes("timeout") || message.includes("timed out")) {
    return "timeout";
  }

  if (
    message.includes("rate limit") ||
    message.includes("429") ||
    message.includes("too many requests")
  ) {
    return "rate_limit";
  }

  if (
    message.includes("network") ||
    message.includes("fetch") ||
    message.includes("econnrefused") ||
    message.includes("enotfound") ||
    message.includes("etimedout")
  ) {
    return "network";
  }

  if (
    message.includes("auth") ||
    message.includes("unauthorized") ||
    message.includes("forbidden") ||
    message.includes("401") ||
    message.includes("403")
  ) {
    return "authentication";
  }

  if (
    message.includes("validation") ||
    message.includes("invalid") ||
    message.includes("required")
  ) {
    return "validation";
  }

  if (message.includes("empty") || message.includes("no results")) {
    return "empty_result";
  }

  return "unknown";
}

/**
 * Creates a metadata extractor for HTTP-based tool calls
 */
export function createHttpMetadataExtractor(
  method: string,
  url: string,
): (result: any, error?: Error) => ToolCallMetadata {
  return (result: any, error?: Error) => {
    const metadata: ToolCallMetadata = {
      httpMethod: method,
      httpUrl: url,
    };

    if (error) {
      return metadata;
    }

    if (result && typeof result === "object") {
      if (result.status) {
        metadata.httpStatusCode = result.status;
      }
      if (result.statusCode) {
        metadata.httpStatusCode = result.statusCode;
      }

      try {
        const jsonSize = JSON.stringify(result).length;
        metadata.httpResponseSize = jsonSize;
      } catch {}
    }

    return metadata;
  };
}
