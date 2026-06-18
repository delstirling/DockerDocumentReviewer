import {
  pgTable,
  text,
  timestamp,
  integer,
  index,
  serial,
} from "drizzle-orm/pg-core";
import { analysisSessions, analysisSteps } from "./analysis";

/**
 * Step Tool Availability Table
 * Tracks what tools were offered to the AI at each analysis step
 * Enables quality audit: "what tools were available vs what tools were used"
 */
export const stepToolAvailability = pgTable(
  "step_tool_availability",
  {
    // Primary identifier
    id: serial("id").primaryKey(),

    analysisSessionId: integer("analysis_session_id")
      .notNull()
      .references(() => analysisSessions.id, { onDelete: "cascade" }),

    analysisStepId: integer("analysis_step_id").references(
      () => analysisSteps.id,
      {
        onDelete: "cascade",
      },
    ),

    stepIndex: integer("step_index").notNull(), // Denormalized for quick filtering
    stepName: text("step_name").notNull(), // Denormalized for quick filtering

    toolsOffered: text("tools_offered").array().notNull().default([]),

    toolsUsedCount: integer("tools_used_count").default(0),

    // Timestamps
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    sessionIdIdx: index("idx_step_tool_availability_session_id").on(
      table.analysisSessionId,
    ),
    stepIdIdx: index("idx_step_tool_availability_step_id").on(
      table.analysisStepId,
    ),
    stepIndexIdx: index("idx_step_tool_availability_step_index").on(
      table.stepIndex,
    ),
  }),
);

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type StepToolAvailability = typeof stepToolAvailability.$inferSelect;
export type NewStepToolAvailability = typeof stepToolAvailability.$inferInsert;
