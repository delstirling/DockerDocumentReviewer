import type {
  LLMClient,
  LLMCompletionRequest,
  LLMCompletionResult,
} from "./LLMClient";

export class LocalAiServerClient implements LLMClient {
  private gatewayUrl: string;
  private apiKey: string;

  constructor(gatewayUrl?: string, apiKey?: string) {
    this.gatewayUrl =
      gatewayUrl || process.env.AISERVER_URL || "http://100.104.89.121:10000";
    this.apiKey = apiKey || process.env.AISERVER_API || "";
  }

  async complete(request: LLMCompletionRequest): Promise<LLMCompletionResult> {
    const payload = {
      model: request.model,
      messages: [
        { role: "system", content: request.systemPrompt },
        { role: "user", content: request.userPrompt },
      ],
      stream: false,
      options: {
        temperature: request.temperature ?? 0.7,
      },
    };

    const response = await fetch(`${this.gatewayUrl}/v1/llm/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `ai-server gateway returned ${response.status}: ${errorText}`,
      );
    }

    const data = await response.json();

    return {
      content: data.message?.content || "",
      model: data.model || request.model,
      usage: {
        inputTokens: data.prompt_eval_count || 0,
        outputTokens: data.eval_count || 0,
      },
      stopReason: data.done_reason || "stop",
    };
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.gatewayUrl}/v1/llm/health`, {
        method: "GET",
        headers: { "x-api-key": this.apiKey },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  getProviderName(): string {
    return "local";
  }
}
