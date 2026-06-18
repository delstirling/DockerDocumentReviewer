export interface LLMCompletionRequest {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface LLMCompletionResult {
  content: string;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  stopReason: string;
}

export interface LLMClient {
  complete(request: LLMCompletionRequest): Promise<LLMCompletionResult>;
  isAvailable(): Promise<boolean>;
  getProviderName(): string;
}
