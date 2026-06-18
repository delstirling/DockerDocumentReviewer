import type {
  LLMClient,
  LLMCompletionRequest,
  LLMCompletionResult,
} from "./LLMClient";

/**
 * Fireworks AI LLM Client
 *
 * Uses the Fireworks.ai OpenAI-compatible REST API for simple completions.
 * For streaming and tool-calling, the platform AI SDK's @ai-sdk/fireworks
 * provider is used directly via model-provider.ts.
 */
export class FireworksLLMClient implements LLMClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey?: string, baseUrl?: string) {
    this.apiKey = apiKey || process.env.FIREWORKS_API_KEY || "";
    this.baseUrl =
      baseUrl ||
      process.env.FIREWORKS_BASE_URL ||
      "https://api.fireworks.ai/inference/v1";
  }

  async complete(request: LLMCompletionRequest): Promise<LLMCompletionResult> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: request.model,
        messages: [
          { role: "system", content: request.systemPrompt },
          { role: "user", content: request.userPrompt },
        ],
        max_tokens: request.maxTokens || 4096,
        temperature: request.temperature ?? 0.7,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Fireworks API returned ${response.status}: ${errorText}`,
      );
    }

    const data = await response.json();
    const choice = data.choices?.[0];

    return {
      content: choice?.message?.content || "",
      model: data.model || request.model,
      usage: {
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0,
      },
      stopReason: choice?.finish_reason || "stop",
    };
  }

  async isAvailable(): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  getProviderName(): string {
    return "fireworks";
  }
}
