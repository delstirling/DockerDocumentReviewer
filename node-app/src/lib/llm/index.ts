export type {
  LLMClient,
  LLMCompletionRequest,
  LLMCompletionResult,
} from "./LLMClient";
export { AnthropicLLMClient } from "./AnthropicClient";
export { LocalAiServerClient } from "./LocalAiServerClient";
export { FireworksLLMClient } from "./FireworksClient";

import { AnthropicLLMClient } from "./AnthropicClient";
import { LocalAiServerClient } from "./LocalAiServerClient";
import { FireworksLLMClient } from "./FireworksClient";
import type { LLMClient } from "./LLMClient";

export function createLLMClient(provider?: string): LLMClient {
  const resolvedProvider = provider || process.env.LLM_PROVIDER || "anthropic";

  switch (resolvedProvider) {
    case "local":
      return new LocalAiServerClient();
    case "fireworks":
      return new FireworksLLMClient();
    case "anthropic":
    default:
      return new AnthropicLLMClient();
  }
}

export async function createLLMClientAsync(): Promise<LLMClient> {
  const { getProviderTypeAsync } = await import("@/lib/model-config");
  const provider = await getProviderTypeAsync();
  return createLLMClient(provider);
}
