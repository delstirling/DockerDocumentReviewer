import { db } from "@/db/client";
import { analysisSessions, processingLocks } from "@/db/schema";
import { eq, and, lt, sql } from "drizzle-orm";
import { randomUUID } from "crypto";

export const LOCK_TTL_MS = 5 * 60 * 1000; // 5 minutes default
export const LOCK_RENEWAL_INTERVAL_MS = 2 * 60 * 1000; // Renew every 2 minutes

// Stale lock threshold: If a session has a valid lock but lastActivityAt is older than this,
// the lock is considered stale (worker likely crashed without releasing it)
export const STALE_LOCK_ACTIVITY_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

export type WorkerType = "api" | "inngest" | "orchestrator" | "resume" | "test";

export interface LockOptions {
  sessionId: string;
  chunkIdentifier?: string; // Optional - if not provided, locks entire session
  workerType: WorkerType;
  workerPid?: string;
  ttlMs?: number;
  lockPurpose?: string;
  metadata?: Record<string, any>;
}

export interface LockResult {
  success: boolean;
  lockId?: string;
  error?: string;
  existingLock?: any;
  retryAfter?: number; // Seconds until lock expires
}

/**
 * Acquire a distributed lock for session/chunk processing
 * Uses PostgreSQL's INSERT ... ON CONFLICT to atomically acquire locks
 */
export async function acquireLock(options: LockOptions): Promise<LockResult> {
  const lockId = randomUUID();
  const ttl = options.ttlMs || LOCK_TTL_MS;
  const expiresAt = new Date(Date.now() + ttl);
  const chunkId = options.chunkIdentifier || "session-wide";
  const sessionIdNum = Number(options.sessionId);

  console.log(
    `[Lock] Attempting to acquire lock: ${chunkId} for session ${options.sessionId}`,
  );

  try {
    // STEP 1: Clean up expired locks first
    await cleanupExpiredLocks(options.sessionId);

    // STEP 2: Try to insert the lock (atomic operation)
    const result = await db
      .insert(processingLocks)
      .values({
        sessionId: sessionIdNum,
        chunkIdentifier: chunkId,
        lockId: lockId,
        workerType: options.workerType,
        workerPid: options.workerPid,
        expiresAt: expiresAt,
        lockPurpose: options.lockPurpose,
        metadata: options.metadata,
      })
      .onConflictDoNothing() // If conflict, lock already exists
      .returning();

    if (result.length > 0) {
      // Successfully acquired lock!
      console.log(`[Lock] ✅ Acquired lock ${lockId} for ${chunkId}`);

      // Also update session-level tracking (for backwards compat)
      await db
        .update(analysisSessions)
        .set({
          processingLockId: lockId,
          processingLockAcquiredAt: new Date(),
          processingLockExpiresAt: expiresAt,
          processingWorkerType: options.workerType,
          lockVersion: sql`${analysisSessions.lockVersion} + 1`,
          isResuming: true, // TEMPORARY - for backwards compatibility
        })
        .where(eq(analysisSessions.id, sessionIdNum));

      return {
        success: true,
        lockId: lockId,
      };
    } else {
      // Lock already exists - check who owns it
      const existingLock = await db
        .select()
        .from(processingLocks)
        .where(
          and(
            eq(processingLocks.sessionId, sessionIdNum),
            eq(processingLocks.chunkIdentifier, chunkId),
          ),
        )
        .limit(1);

      if (existingLock.length === 0) {
        // Race condition - lock was released between insert and select
        console.log(`[Lock] ⚠️ Lock vanished, retrying...`);
        return acquireLock(options); // Recursive retry
      }

      const lock = existingLock[0];
      const now = Date.now();
      const lockExpiry = new Date(lock.expiresAt).getTime();
      const retryAfterSec = Math.max(1, Math.ceil((lockExpiry - now) / 1000));

      console.log(
        `[Lock] ❌ Lock held by ${lock.lockId} (worker: ${lock.workerType}), expires in ${retryAfterSec}s`,
      );

      return {
        success: false,
        error: `Lock held by another worker (${lock.workerType})`,
        existingLock: lock,
        retryAfter: retryAfterSec,
      };
    }
  } catch (error) {
    console.error(`[Lock] Error acquiring lock:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Release a lock when processing is complete
 */
export async function releaseLock(
  sessionId: unknown,
  lockId: unknown,
): Promise<void> {
  const sessionIdText = String(sessionId ?? "");
  const sessionIdNum = Number(sessionIdText);
  const lockIdText = String(lockId ?? "");
  console.log(`[Lock] Releasing lock ${lockIdText} for session ${sessionIdText}`);

  try {
    // Delete lock from processing_locks table
    await db
      .delete(processingLocks)
      .where(
        and(
          eq(processingLocks.sessionId, sessionIdNum),
          eq(processingLocks.lockId, lockIdText),
        ),
      );

    // Update session-level tracking
    const [session] = await db
      .select()
      .from(analysisSessions)
      .where(eq(analysisSessions.id, sessionIdNum))
      .limit(1);

    // Only clear session lock if THIS lock owns it
    if (session && session.processingLockId === lockIdText) {
      await db
        .update(analysisSessions)
        .set({
          processingLockId: null,
          processingLockAcquiredAt: null,
          processingLockExpiresAt: null,
          processingWorkerType: null,
          isResuming: false, // TEMPORARY - for backwards compatibility
        })
        .where(eq(analysisSessions.id, sessionIdNum));
    }

    console.log(`[Lock] ✅ Released lock ${lockIdText}`);
  } catch (error) {
    console.error(`[Lock] Error releasing lock:`, error);
    throw error;
  }
}

/**
 * Renew an existing lock to extend its TTL
 * Call this periodically during long-running operations
 */
export async function renewLock(
  sessionId: unknown,
  lockId: unknown,
  ttlMs?: number,
): Promise<boolean> {
  const sessionIdText = String(sessionId ?? "");
  const sessionIdNum = Number(sessionIdText);
  const lockIdText = String(lockId ?? "");
  const ttl = ttlMs || LOCK_TTL_MS;
  const newExpiry = new Date(Date.now() + ttl);

  try {
    const result = await db
      .update(processingLocks)
      .set({
        expiresAt: newExpiry,
      })
      .where(
        and(
          eq(processingLocks.sessionId, sessionIdNum),
          eq(processingLocks.lockId, lockIdText),
        ),
      )
      .returning();

    if (result.length > 0) {
      // Also renew session-level lock
      await db
        .update(analysisSessions)
        .set({
          processingLockExpiresAt: newExpiry,
        })
        .where(
          and(
            eq(analysisSessions.id, sessionIdNum),
            eq(analysisSessions.processingLockId, lockIdText),
          ),
        );

      console.log(
        `[Lock] ♻️ Renewed lock ${lockId} until ${newExpiry.toISOString()}`,
      );
      return true;
    }

    console.log(
      `[Lock] ⚠️ Could not renew lock ${lockId} (may have been released)`,
    );
    return false;
  } catch (error) {
    console.error(`[Lock] Error renewing lock:`, error);
    return false;
  }
}

/**
 * Clean up expired locks for a session
 * Called before attempting to acquire a new lock
 * Also cleans up stale isResuming flags (>2 minutes old)
 */
export async function cleanupExpiredLocks(sessionId: string): Promise<number> {
  const sessionIdNum = Number(sessionId);
  const now = new Date();

  try {
    const deleted = await db
      .delete(processingLocks)
      .where(
        and(
          eq(processingLocks.sessionId, sessionIdNum),
          lt(processingLocks.expiresAt, now),
        ),
      )
      .returning();

    if (deleted.length > 0) {
      console.log(
        `[Lock] 🧹 Cleaned up ${deleted.length} expired locks for session ${sessionId}`,
      );

      // Also clear session-level lock if it was expired
      await db
        .update(analysisSessions)
        .set({
          processingLockId: null,
          processingLockAcquiredAt: null,
          processingLockExpiresAt: null,
          processingWorkerType: null,
          isResuming: false,
        })
        .where(
          and(
            eq(analysisSessions.id, sessionIdNum),
            lt(analysisSessions.processingLockExpiresAt as any, now),
          ),
        );
    }

    // CRITICAL FIX: Also check for stale isResuming flags (without lock expiry)
    // If isResuming=true but no valid lock exists, clear it
    const staleResuming = await db
      .update(analysisSessions)
      .set({
        isResuming: false,
        processingLockId: null,
        processingLockAcquiredAt: null,
        processingLockExpiresAt: null,
        processingWorkerType: null,
      })
      .where(
        and(
          eq(analysisSessions.id, sessionIdNum),
          eq(analysisSessions.isResuming, true),
          sql`${analysisSessions.processingLockExpiresAt} IS NULL OR ${analysisSessions.processingLockExpiresAt} < NOW()`,
        ),
      )
      .returning();

    if (staleResuming.length > 0) {
      console.log(
        `[Lock] 🧹 Cleared stale isResuming flag for session ${sessionId}`,
      );
    }

    return deleted.length;
  } catch (error) {
    console.error(`[Lock] Error cleaning up expired locks:`, error);
    return 0;
  }
}

/**
 * Check if a session/chunk is currently locked
 */
export async function isLocked(
  sessionId: string,
  chunkIdentifier?: string,
  { skipCleanup = false }: { skipCleanup?: boolean } = {},
): Promise<{
  locked: boolean;
  lock?: any;
  retryAfter?: number;
}> {
  const sessionIdNum = Number(sessionId);
  const chunkId = chunkIdentifier || "session-wide";

  // Only clean up expired locks if not already done by caller (e.g., acquireLock)
  if (!skipCleanup) {
    await cleanupExpiredLocks(sessionId);
  }

  const existingLock = await db
    .select()
    .from(processingLocks)
    .where(
      and(
        eq(processingLocks.sessionId, sessionIdNum),
        eq(processingLocks.chunkIdentifier, chunkId),
        sql`${processingLocks.expiresAt} > NOW()`, // Still valid
      ),
    )
    .limit(1);

  if (existingLock.length > 0) {
    const lock = existingLock[0];
    const retryAfter = Math.ceil(
      (new Date(lock.expiresAt).getTime() - Date.now()) / 1000,
    );

    return {
      locked: true,
      lock: lock,
      retryAfter: retryAfter,
    };
  }

  return { locked: false };
}

/**
 * Clean up stale locks for a session
 * A lock is considered "stale" if:
 * 1. The lock is still valid (not expired)
 * 2. BUT the session's lastActivityAt is older than STALE_LOCK_ACTIVITY_THRESHOLD_MS
 *
 * This handles the case where a worker acquired a lock but crashed/timed out
 * without releasing it, and the lock keeps getting renewed by retry attempts.
 *
 * @returns Object with cleaned count and whether any stale locks were found
 */
export async function cleanupStaleLocks(sessionId: string): Promise<{
  cleaned: number;
  wasStale: boolean;
  staleDurationMs?: number;
}> {
  const sessionIdNum = Number(sessionId);
  const now = new Date();
  const staleThreshold = new Date(
    now.getTime() - STALE_LOCK_ACTIVITY_THRESHOLD_MS,
  );

  try {
    // First, check if the session has a valid lock but stale activity
    const [session] = await db
      .select({
        id: analysisSessions.id,
        lastActivityAt: analysisSessions.lastActivityAt,
        processingLockId: analysisSessions.processingLockId,
        processingLockExpiresAt: analysisSessions.processingLockExpiresAt,
        status: analysisSessions.status,
        currentStep: analysisSessions.currentStep,
      })
      .from(analysisSessions)
      .where(eq(analysisSessions.id, sessionIdNum))
      .limit(1);

    if (!session) {
      return { cleaned: 0, wasStale: false };
    }

    // Check if session has a valid lock
    const hasValidLock =
      session.processingLockExpiresAt &&
      new Date(session.processingLockExpiresAt) > now;

    if (!hasValidLock) {
      // No valid lock, nothing to clean
      return { cleaned: 0, wasStale: false };
    }

    // Check if lastActivityAt is stale
    const lastActivity = session.lastActivityAt
      ? new Date(session.lastActivityAt)
      : null;
    const isStale = !lastActivity || lastActivity < staleThreshold;

    if (!isStale) {
      // Lock is valid and activity is recent - worker is actually busy
      return { cleaned: 0, wasStale: false };
    }

    // Lock is stale! Calculate how long it's been stale
    const staleDurationMs = lastActivity
      ? now.getTime() - lastActivity.getTime()
      : STALE_LOCK_ACTIVITY_THRESHOLD_MS;

    console.log(
      `[Lock] 🔍 Detected stale lock for session ${sessionId}: lastActivityAt=${lastActivity?.toISOString() || "null"}, staleDuration=${Math.round(staleDurationMs / 1000)}s, currentStep=${session.currentStep}`,
    );

    // Force-release the stale lock from processingLocks table
    const deleted = await db
      .delete(processingLocks)
      .where(eq(processingLocks.sessionId, sessionIdNum))
      .returning();

    // Clear session-level lock tracking
    await db
      .update(analysisSessions)
      .set({
        processingLockId: null,
        processingLockAcquiredAt: null,
        processingLockExpiresAt: null,
        processingWorkerType: null,
        isResuming: false,
      })
      .where(eq(analysisSessions.id, sessionIdNum));

    console.log(
      `[Lock] 🧹 Force-released ${deleted.length} stale lock(s) for session ${sessionId} (no activity for ${Math.round(staleDurationMs / 1000)}s)`,
    );

    return {
      cleaned: deleted.length,
      wasStale: true,
      staleDurationMs,
    };
  } catch (error) {
    console.error(`[Lock] Error cleaning up stale locks:`, error);
    return { cleaned: 0, wasStale: false };
  }
}

/**
 * Force-release ALL locks for a session, regardless of expiry or activity.
 *
 * This is a last-resort recovery mechanism used by the orchestrator when it
 * detects a stuck lock loop (many consecutive 409 responses). The normal
 * cleanup paths (cleanupExpiredLocks, cleanupStaleLocks) can fail when:
 * - A hung worker's heartbeat keeps renewing the lock TTL
 * - The heartbeat keeps updating lastActivityAt, defeating stale detection
 *
 * This function unconditionally deletes all locks and clears session lock state.
 */
export async function forceReleaseAllLocks(sessionId: string): Promise<number> {
  const sessionIdNum = Number(sessionId);
  console.log(`[Lock] ⚠️ FORCE-RELEASING all locks for session ${sessionId}`);

  try {
    // Delete ALL locks for this session, regardless of expiry
    const deleted = await db
      .delete(processingLocks)
      .where(eq(processingLocks.sessionId, sessionIdNum))
      .returning();

    // Clear all session-level lock tracking
    await db
      .update(analysisSessions)
      .set({
        processingLockId: null,
        processingLockAcquiredAt: null,
        processingLockExpiresAt: null,
        processingWorkerType: null,
        isResuming: false,
      })
      .where(eq(analysisSessions.id, sessionIdNum));

    console.log(
      `[Lock] ⚠️ Force-released ${deleted.length} lock(s) for session ${sessionId}`,
    );
    return deleted.length;
  } catch (error) {
    console.error(`[Lock] Error force-releasing locks:`, error);
    return 0;
  }
}
