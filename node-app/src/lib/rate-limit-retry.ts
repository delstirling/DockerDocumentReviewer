export const DEFAULT_RATE_LIMIT_RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 2000,
  maxDelayMs: 30000,
  minTimeBudgetForRetryMs: 15000,
};

export function isRateLimitOrOverloadError(error: unknown): {
  isTransient: boolean;
  isOverload: boolean;
  retryAfterMs?: number;
} {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  const is429 = message.includes("429") || message.includes("rate limit");
  const is529 = message.includes("529") || message.includes("overload");

  return {
    isTransient: is429 || is529,
    isOverload: is529,
  };
}

export function calculateRateLimitDelay(
  retryAttempt: number,
  config = DEFAULT_RATE_LIMIT_RETRY_CONFIG,
  retryAfterMs?: number,
): number {
  if (retryAfterMs && retryAfterMs > 0) {
    return retryAfterMs;
  }
  const backoff = config.baseDelayMs * Math.pow(2, retryAttempt);
  return Math.min(backoff, config.maxDelayMs);
}

export async function sleepWithHeartbeat(
  delayMs: number,
  onHeartbeat: () => Promise<void>,
  heartbeatIntervalMs = 10000,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < delayMs) {
    const remaining = delayMs - (Date.now() - started);
    const slice = Math.min(heartbeatIntervalMs, remaining);
    await new Promise((resolve) => setTimeout(resolve, slice));
    await onHeartbeat();
  }
}

export function hasTimeBudgetForRetry(
  startTimeMs: number,
  totalBudgetMs: number,
  retryDelayMs: number,
  config = DEFAULT_RATE_LIMIT_RETRY_CONFIG,
): boolean {
  const elapsed = Date.now() - startTimeMs;
  const remaining = totalBudgetMs - elapsed;
  return remaining >= retryDelayMs + config.minTimeBudgetForRetryMs;
}

export function formatRateLimitRetryMessage(
  stepIndex: number,
  stepName: string,
  retryAttemptZeroBased: number,
  maxRetries: number,
  delayMs: number,
  isOverload: boolean,
): string {
  const retryDisplay = retryAttemptZeroBased + 1;
  const delaySeconds = Math.round(delayMs / 1000);
  const kind = isOverload ? "overload" : "rate-limit";
  return `\n[Retry] Step ${stepIndex + 1} (${stepName}) hit ${kind}. Retry ${retryDisplay}/${maxRetries} in ${delaySeconds}s.\n`;
}
