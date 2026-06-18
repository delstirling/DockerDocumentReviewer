import Anthropic from "@anthropic-ai/sdk";
import { getAnalysisModel } from "@/lib/model-config";

export interface StepExecutionOptions {
  anthropicClient: Anthropic;
  systemPrompt: string;
  userMessage: string;
  tools?: Record<string, any>;
  temperature?: number;
  maxTokens?: number;
  abortSignal?: AbortSignal;
  onTextChunk?: (chunk: string) => void;
  onToolCall?: (toolName: string) => void;
  onToolResult?: () => void;
}

export interface StepExecutionResult {
  analysisText: string;
  thinkingText: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  finishReason: string;
  toolCallCount: number;
}

/**
 * Execute a single analysis step using Anthropic SDK with thinking capture
 *
 * This adapter provides direct access to Anthropic's streaming events to capture
 * extended thinking output while maintaining compatibility with tool execution.
 */
export async function runStepAnthropic(
  options: StepExecutionOptions,
): Promise<StepExecutionResult> {
  const {
    anthropicClient,
    systemPrompt,
    userMessage,
    tools,
    temperature = 0.7,
    maxTokens = 50000,
    abortSignal,
    onTextChunk,
    onToolCall,
    onToolResult,
  } = options;

  let analysisText = "";
  let thinkingText = "";
  let currentThinkingBuffer = "";
  let toolCallCount = 0;
  let usage = { inputTokens: 0, outputTokens: 0 };
  let finishReason = "end_turn";

  const anthropicTools = tools
    ? Object.entries(tools).map(([name, tool]: [string, any]) => ({
        name,
        description: tool.description || "",
        input_schema: tool.parameters || { type: "object", properties: {} },
      }))
    : undefined;

  try {
    const stream = await anthropicClient.messages.create({
      model: getAnalysisModel(),
      max_tokens: maxTokens,
      temperature,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: userMessage,
        },
      ],
      tools: anthropicTools,
      thinking: {
        type: "enabled",
        budget_tokens: 10000,
      },
      stream: true,
    });

    if (abortSignal) {
      abortSignal.addEventListener("abort", () => {});
    }

    for await (const event of stream) {
      if (abortSignal?.aborted) {
        break;
      }

      switch (event.type) {
        case "message_start":
          usage.inputTokens = event.message.usage.input_tokens;
          break;

        case "content_block_start":
          if (event.content_block.type === "thinking") {
            currentThinkingBuffer = "";
          } else if (event.content_block.type === "tool_use") {
            toolCallCount++;
            if (onToolCall) {
              onToolCall(event.content_block.name);
            }
          }
          break;

        case "content_block_delta":
          if (event.delta.type === "thinking_delta") {
            currentThinkingBuffer += event.delta.thinking;
          } else if (event.delta.type === "text_delta") {
            const chunk = event.delta.text;
            analysisText += chunk;
            if (onTextChunk) {
              onTextChunk(chunk);
            }
          }
          break;

        case "content_block_stop":
          if (event.index !== undefined) {
            const blockType = currentThinkingBuffer ? "thinking" : "text";
            if (blockType === "thinking" && currentThinkingBuffer) {
              thinkingText += currentThinkingBuffer + "\n\n";
              currentThinkingBuffer = "";
            }
          }
          break;

        case "message_delta":
          if (event.delta.stop_reason) {
            finishReason = event.delta.stop_reason;
          }
          if (event.usage) {
            usage.outputTokens = event.usage.output_tokens;
          }
          break;

        case "message_stop":
          break;

        default:
          break;
      }
    }

    if (onToolResult && toolCallCount > 0) {
      onToolResult();
    }

    return {
      analysisText: analysisText.trim(),
      thinkingText: thinkingText.trim(),
      usage,
      finishReason,
      toolCallCount,
    };
  } catch (error: any) {
    if (error.name === "AbortError" || abortSignal?.aborted) {
      throw new Error("Hard-stop triggered");
    }
    throw error;
  }
}
