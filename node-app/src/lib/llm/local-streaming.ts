import type { LLMCompletionResult } from "./LLMClient";

interface LocalStreamOptions {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export async function* streamLocalCompletion(
  options: LocalStreamOptions,
): AsyncGenerator<string> {
  const gatewayUrl = process.env.AISERVER_URL || "http://100.104.89.121:10000";
  const apiKey = process.env.AISERVER_API || "";

  const payload = {
    model: options.model,
    messages: [
      { role: "system", content: options.systemPrompt },
      { role: "user", content: options.userPrompt },
    ],
    stream: true,
    options: {
      temperature: options.temperature ?? 0.7,
    },
  };

  const response = await fetch(`${gatewayUrl}/v1/llm/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify(payload),
    signal: options.signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `ai-server gateway returned ${response.status}: ${errorText}`,
    );
  }

  if (!response.body) {
    throw new Error("No response body from ai-server gateway");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line);
          if (data.message?.content) {
            yield data.message.content;
          }
        } catch {
          // skip malformed NDJSON lines
        }
      }
    }

    if (buffer.trim()) {
      try {
        const data = JSON.parse(buffer);
        if (data.message?.content) {
          yield data.message.content;
        }
      } catch {
        // skip
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function completeLocal(
  options: LocalStreamOptions,
): Promise<LLMCompletionResult> {
  let content = "";
  for await (const chunk of streamLocalCompletion(options)) {
    content += chunk;
  }
  return {
    content,
    model: options.model,
    usage: { inputTokens: 0, outputTokens: 0 },
    stopReason: "stop",
  };
}
