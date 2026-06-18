export const STREAM_HEARTBEAT_INTERVAL_MS = 12_000;
export const STREAM_SOFT_TIMEOUT_MS = 770_000;
export const STALE_LOCK_THRESHOLD_MS = 2 * 60_000;

export const ANTHROPIC_CACHE_TTL_MS = 5 * 60_000;
export const ANTHROPIC_CACHE_SAFE_GAP_MS = 4 * 60_000;

export const PRE_STEP_MIN_WINDOW_MS = 30_000;
export const DEFAULT_CHUNK_TIME_BUDGET_MS = STREAM_SOFT_TIMEOUT_MS;

export const ORCHESTRATOR_MAX_TIME_MS = 800_000;
export const ORCHESTRATOR_SAFETY_MARGIN_MS = 30_000;
export const ORCHESTRATOR_BASE_DELAY_MS = 1_000;
export const ORCHESTRATOR_MAX_DELAY_MS = 8_000;
export const ORCHESTRATOR_JITTER_MS = 300;

export function calculateResumeChunkTimeout(elapsedTimeMs: number): number {
  const remaining = ORCHESTRATOR_MAX_TIME_MS - elapsedTimeMs;
  const usable = Math.max(10_000, remaining - ORCHESTRATOR_SAFETY_MARGIN_MS);
  return Math.min(usable, STREAM_SOFT_TIMEOUT_MS);
}

export function hasTimeForResumeChunk(elapsedTimeMs: number): boolean {
  return calculateResumeChunkTimeout(elapsedTimeMs) > 10_000;
}
