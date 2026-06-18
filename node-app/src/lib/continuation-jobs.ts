import { db } from "@/db/client";
import { continuationJobs } from "@/db/schema";
import { eq, and, lt, isNull, or, asc, sql } from "drizzle-orm";

/**
 * Result type for createContinuationJob
 */
export type CreateJobResult = {
  job: typeof continuationJobs.$inferSelect | null;
  created: boolean;
  error?: string;
};

/**
 * Safely create a continuation job for a session (IDEMPOTENT)
 *
 * Uses a two-phase approach:
 * 1. Check if a pending job already exists
 * 2. Try to insert, catching duplicate key errors (23505) as success
 *
 * This handles the production DB unique constraint on (session_id) WHERE status='pending'
 */
export async function createContinuationJob(
  sessionId: unknown,
): Promise<CreateJobResult> {
  const sessionIdText = String(sessionId ?? "");
  const sessionIdNum = Number(sessionIdText);
  console.log(
    `[createContinuationJob] Ensuring continuation job exists for session ${sessionIdText}`,
  );

  try {
    // Check if there's already a pending job for this session
    const existingJobs = await db
      .select()
      .from(continuationJobs)
      .where(
        and(
          eq(continuationJobs.sessionId, sessionIdNum),
          eq(continuationJobs.status, "pending"),
        ),
      )
      .limit(1);

    if (existingJobs.length > 0) {
      // Job already exists, this is idempotent success
      console.log(
        `[createContinuationJob] Found existing pending job ${existingJobs[0].id}, returning it (idempotent)`,
      );
      return { job: existingJobs[0], created: false };
    }

    // Try to create new job
    console.log(
      `[createContinuationJob] No existing job found, creating new continuation job`,
    );
    const [newJob] = await db
      .insert(continuationJobs)
      .values({
        sessionId: sessionIdNum,
        status: "pending",
        visibleAt: new Date(),
      })
      .returning();

    console.log(
      `[createContinuationJob] Created new job ${newJob.id} for session ${sessionIdText}`,
    );
    return { job: newJob, created: true };
  } catch (error: unknown) {
    // Check for duplicate key violation (23505) - treat as idempotent success
    const errorCode = (error as { code?: string })?.code;
    if (errorCode === "23505") {
      console.log(
        `[createContinuationJob] Duplicate key detected (23505), job already exists for session ${sessionIdText} - treating as success`,
      );
      // Fetch the existing job
      const existingJobs = await db
        .select()
        .from(continuationJobs)
        .where(
          and(
            eq(continuationJobs.sessionId, sessionIdNum),
            eq(continuationJobs.status, "pending"),
          ),
        )
        .limit(1);

      return { job: existingJobs[0] || null, created: false };
    }

    // For other errors, log and return error result
    console.error(
      `[createContinuationJob] Error creating job for session ${sessionIdText}:`,
      error,
    );
    return {
      job: null,
      created: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Claim the next available job from the queue (FIFO ordered)
 *
 * Uses atomic UPDATE with subquery to prevent race conditions.
 * Jobs are processed in order of visibleAt, then createdAt.
 *
 * @param leaseDurationMs - How long to hold the lease (default 2 minutes)
 * @returns The claimed job, or null if no jobs available
 */
export async function claimNextJob(leaseDurationMs: number = 2 * 60 * 1000) {
  const now = new Date();
  const leaseUntil = new Date(Date.now() + leaseDurationMs);

  console.log(`[claimNextJob] Attempting to claim next available job`);

  try {
    // Use raw SQL for atomic claim with FOR UPDATE SKIP LOCKED
    // This ensures ordered processing and prevents race conditions
    const result = await db.execute(sql`
      WITH next_job AS (
        SELECT id
        FROM continuation_jobs
        WHERE status = 'pending'
          AND visible_at <= ${now}
          AND (lease_until IS NULL OR lease_until <= ${now})
        ORDER BY visible_at ASC, created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE continuation_jobs cj
      SET 
        status = 'processing',
        lease_until = ${leaseUntil},
        attempts = attempts + 1,
        updated_at = ${now}
      FROM next_job
      WHERE cj.id = next_job.id
      RETURNING cj.*
    `);

    const rows = result.rows as Array<Record<string, unknown>>;
    if (rows.length === 0) {
      console.log(`[claimNextJob] No jobs available to claim`);
      return null;
    }

    const claimedJob = rows[0];
    console.log(
      `[claimNextJob] Claimed job ${claimedJob.id} for session ${claimedJob.session_id}`,
    );

    // Convert snake_case to camelCase for consistency with Drizzle types
    return {
      id: claimedJob.id as number,
      sessionId: claimedJob.session_id as number,
      status: claimedJob.status as string,
      leaseUntil: claimedJob.lease_until as Date | null,
      attempts: claimedJob.attempts as number,
      visibleAt: claimedJob.visible_at as Date,
      lastError: claimedJob.last_error as string | null,
      createdAt: claimedJob.created_at as Date,
      updatedAt: claimedJob.updated_at as Date,
    };
  } catch (error) {
    console.error(`[claimNextJob] Error claiming job:`, error);
    return null;
  }
}

/**
 * Reset an expired job's lease back to pending (SAFE)
 *
 * Only resets if no other pending job exists for the same session.
 * This prevents the duplicate key constraint violation.
 *
 * @param jobId - The job ID to reset
 * @returns true if reset, false if skipped (another pending job exists)
 */
export async function resetExpiredLease(jobId: unknown): Promise<boolean> {
  const jobIdText = String(jobId ?? "");
  const jobIdNum = Number(jobIdText);
  console.log(`[resetExpiredLease] Attempting to reset lease for job ${jobId}`);

  try {
    // Use raw SQL to atomically check and reset
    // Only reset if no other pending job exists for this session
    const result = await db.execute(sql`
      UPDATE continuation_jobs cj
      SET 
        status = 'pending',
        lease_until = NULL,
        visible_at = NOW(),
        updated_at = NOW()
      WHERE cj.id = ${jobIdNum}
        AND cj.status = 'processing'
        AND NOT EXISTS (
          SELECT 1 FROM continuation_jobs other
          WHERE other.session_id = cj.session_id
            AND other.status = 'pending'
            AND other.id != cj.id
        )
      RETURNING cj.id, cj.session_id
    `);

    const rows = result.rows as Array<Record<string, unknown>>;
    if (rows.length === 0) {
      console.log(
        `[resetExpiredLease] Job ${jobId} not reset - either already pending, not processing, or another pending job exists for this session`,
      );
      return false;
    }

    console.log(
      `[resetExpiredLease] Successfully reset lease for job ${jobId} (session ${rows[0].session_id})`,
    );
    return true;
  } catch (error) {
    console.error(
      `[resetExpiredLease] Error resetting lease for job ${jobId}:`,
      error,
    );
    return false;
  }
}

/**
 * Mark superseded jobs as cancelled
 *
 * When multiple jobs exist for the same session, mark all but the newest as cancelled.
 * This cleans up duplicate jobs that may have been created due to race conditions.
 *
 * @param sessionId - The session ID to clean up
 * @returns Number of jobs cancelled
 */
export async function cancelSupersededJobs(sessionId: unknown): Promise<number> {
  const sessionIdText = String(sessionId ?? "");
  const sessionIdNum = Number(sessionIdText);
  console.log(
    `[cancelSupersededJobs] Cleaning up duplicate jobs for session ${sessionIdText}`,
  );

  try {
    // Find all non-terminal jobs for this session, keep only the newest
    const result = await db.execute(sql`
      WITH ranked_jobs AS (
        SELECT id, 
               ROW_NUMBER() OVER (ORDER BY created_at DESC) as rn
        FROM continuation_jobs
        WHERE session_id = ${sessionIdNum}
          AND status IN ('pending', 'processing')
      )
      UPDATE continuation_jobs cj
      SET 
        status = 'failed',
        last_error = 'Superseded by newer job',
        updated_at = NOW()
      FROM ranked_jobs rj
      WHERE cj.id = rj.id
        AND rj.rn > 1
      RETURNING cj.id
    `);

    const rows = result.rows as Array<Record<string, unknown>>;
    if (rows.length > 0) {
      console.log(
        `[cancelSupersededJobs] Cancelled ${rows.length} superseded jobs for session ${sessionIdText}`,
      );
    }
    return rows.length;
  } catch (error) {
    console.error(
      `[cancelSupersededJobs] Error cancelling jobs for session ${sessionIdText}:`,
      error,
    );
    return 0;
  }
}

/**
 * Get pending job count for monitoring
 */
export async function getPendingJobCount(): Promise<number> {
  const now = new Date();
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(continuationJobs)
    .where(
      and(
        eq(continuationJobs.status, "pending"),
        lt(continuationJobs.visibleAt, now),
      ),
    );
  return Number(result[0]?.count || 0);
}

/**
 * Mark a continuation job as done
 */
export async function completeContinuationJob(
  sessionId: unknown,
): Promise<void> {
  const sessionIdText = String(sessionId ?? "");
  const sessionIdNum = Number(sessionIdText);
  try {
    await db
      .update(continuationJobs)
      .set({
        status: "done",
        updatedAt: new Date(),
      })
      .where(eq(continuationJobs.sessionId, sessionIdNum));

    console.log(
      `[Continuation Jobs] Marked job as done for session ${sessionIdText}`,
    );
  } catch (error) {
    console.error(
      `[Continuation Jobs] Error completing job for session ${sessionIdText}:`,
      error,
    );
  }
}

/**
 * Mark a continuation job as failed
 */
export async function failContinuationJob(
  sessionId: unknown,
  errorMessage: string,
): Promise<void> {
  const sessionIdText = String(sessionId ?? "");
  const sessionIdNum = Number(sessionIdText);

  try {
    await db
      .update(continuationJobs)
      .set({
        status: "failed",
        lastError: errorMessage,
        updatedAt: new Date(),
      })
      .where(eq(continuationJobs.sessionId, sessionIdNum));

    console.log(
      `[Continuation Jobs] Marked job as failed for session ${sessionIdText}`,
    );
  } catch (error) {
    console.error(
      `[Continuation Jobs] Error failing job for session ${sessionIdText}:`,
      error,
    );
  }
}
