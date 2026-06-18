import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { analysisSessions } from "@/db/schema";

type MetadataMap = Record<string, unknown>;

function coerceSessionId(sessionId: number | string): number {
  if (typeof sessionId === "number") {
    return sessionId;
  }
  const parsed = Number(sessionId);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid session id: ${sessionId}`);
  }
  return parsed;
}

export function formatErrorWithCause(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause;
    if (cause instanceof Error) {
      return `${error.message} | caused by: ${cause.message}`;
    }
    if (cause !== undefined) {
      return `${error.message} | caused by: ${String(cause)}`;
    }
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function createErrorMetadata(
  error: unknown,
  extra: MetadataMap = {},
): MetadataMap {
  return {
    ...extra,
    error: formatErrorWithCause(error),
    errorAt: new Date().toISOString(),
  };
}

export async function persistSessionMetadata(
  sessionId: number | string,
  patch: MetadataMap,
): Promise<void> {
  const numericSessionId = coerceSessionId(sessionId);

  const [session] = await db
    .select({ metadata: analysisSessions.metadata })
    .from(analysisSessions)
    .where(eq(analysisSessions.id, numericSessionId))
    .limit(1);

  const current = (session?.metadata ?? {}) as MetadataMap;
  const merged = { ...current, ...patch };

  await db
    .update(analysisSessions)
    .set({
      metadata: merged,
      updatedAt: new Date(),
    })
    .where(eq(analysisSessions.id, numericSessionId));
}
