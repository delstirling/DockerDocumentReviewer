import Anthropic from "@anthropic-ai/sdk";
import type {
  LLMClient,
  LLMCompletionRequest,
  LLMCompletionResult,
} from "./LLMClient";

export class AnthropicLLMClient implements LLMClient {
  private client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic({
      apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
    });
  }

  async complete(request: LLMCompletionRequest): Promise<LLMCompletionResult> {
    const response = await this.client.messages.create({
      model: request.model,
      max_tokens: request.maxTokens || 4096,
      temperature: request.temperature ?? 0.7,
      system: request.systemPrompt,
      messages: [{ role: "user", content: request.userPrompt }],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    const content = textBlock && "text" in textBlock ? textBlock.text : "";

    return {
      content,
      model: response.model,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      stopReason: response.stop_reason || "end_turn",
    };
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 10,
        messages: [{ role: "user", content: "ping" }],
      });
      return true;
    } catch {
      return false;
    }
  }

  getProviderName(): string {
    return "anthropic";
  }
}
