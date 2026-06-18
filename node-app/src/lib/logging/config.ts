export const PERFORMANCE_THRESHOLDS = {
  STEP_DURATION_WARN_MS: 60_000,
  STEP_DURATION_CRITICAL_MS: 180_000,
  OUTPUT_TOKENS_WARN: 8_000,
  OUTPUT_TOKENS_CRITICAL: 16_000,
} as const;

export interface DebugConfig {
  enabled: boolean;
}

export function getDebugConfig(): DebugConfig {
  return {
    enabled: process.env.ANALYSIS_DEBUG === "1",
  };
}

export function checkPerformanceThreshold(
  metric: "step_duration" | "output_tokens",
  value: number,
): { level: "ok" | "warn" | "critical" } {
  if (metric === "step_duration") {
    if (value >= PERFORMANCE_THRESHOLDS.STEP_DURATION_CRITICAL_MS) {
      return { level: "critical" };
    }
    if (value >= PERFORMANCE_THRESHOLDS.STEP_DURATION_WARN_MS) {
      return { level: "warn" };
    }
    return { level: "ok" };
  }

  if (value >= PERFORMANCE_THRESHOLDS.OUTPUT_TOKENS_CRITICAL) {
    return { level: "critical" };
  }
  if (value >= PERFORMANCE_THRESHOLDS.OUTPUT_TOKENS_WARN) {
    return { level: "warn" };
  }
  return { level: "ok" };
}
