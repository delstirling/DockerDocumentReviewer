import { createAnthropic } from "@ai-sdk/anthropic";
import { createFireworks } from "@ai-sdk/fireworks";
import {
  getProviderTypeAsync,
  getLocalModelNameAsync,
  getFireworksModelNameAsync,
  getAnalysisModelAsync,
} from "@/lib/model-config";

export type AnthropicProvider = ReturnType<typeof createAnthropic>;
export type FireworksProvider = ReturnType<typeof createFireworks>;

export interface AnalysisProviderConfig {
  providerType: "anthropic" | "local" | "fireworks";
  modelName: string;
  anthropicProvider?: AnthropicProvider;
  fireworksProvider?: FireworksProvider;
  isAnthropic: boolean;
}

export async function getAnalysisProviderConfig(): Promise<AnalysisProviderConfig> {
  const providerType = await getProviderTypeAsync();

  if (providerType === "local") {
    const localModel = await getLocalModelNameAsync();
    return {
      providerType: "local",
      modelName: localModel,
      isAnthropic: false,
    };
  }

  if (providerType === "fireworks") {
    const fireworksModel = await getFireworksModelNameAsync();
    return {
      providerType: "fireworks",
      modelName: fireworksModel,
      fireworksProvider: createFireworks({
        apiKey: process.env.FIREWORKS_API_KEY,
      }),
      isAnthropic: false,
    };
  }

  const analysisModel = await getAnalysisModelAsync();
  return {
    providerType: "anthropic",
    modelName: analysisModel,
    anthropicProvider: createAnthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    }),
    isAnthropic: true,
  };
}
