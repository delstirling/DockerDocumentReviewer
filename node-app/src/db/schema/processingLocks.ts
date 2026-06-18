import {
  pgTable,
  text,
  timestamp,
  jsonb,
  index,
  integer,
  serial,
} from "drizzle-orm/pg-core";
import { analysisSessions } from "./analysis";

/**
 * Processing Locks Table
 * Fine-grained distributed locks for session/chunk/phase processing
 */
export const processingLocks = pgTable(
  "processing_locks",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id")
      .notNull()
      .references(() => analysisSessions.id, { onDelete: "cascade" }),
    chunkIdentifier: text("chunk_identifier").notNull(),
    lockId: text("lock_id").notNull(),
    workerType: text("worker_type").notNull(),
    workerPid: text("worker_pid"),
    acquiredAt: timestamp("acquired_at").notNull().defaultNow(),
    expiresAt: timestamp("expires_at").notNull(),
    lockPurpose: text("lock_purpose"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    sessionChunkUnique: index("unique_session_chunk_lock").on(
      table.sessionId,
      table.chunkIdentifier,
    ),
    sessionIdx: index("idx_processing_locks_session").on(table.sessionId),
    expiresIdx: index("idx_processing_locks_expires").on(table.expiresAt),
    workerIdx: index("idx_processing_locks_worker").on(table.lockId),
  }),
);

export type ProcessingLock = typeof processingLocks.$inferSelect;
export type NewProcessingLock = typeof processingLocks.$inferInsert;
