import {
  pgTable,
  text,
  jsonb,
  timestamp,
  boolean,
  index,
  integer,
  serial,
} from "drizzle-orm/pg-core";
import { users, organizations } from "./auth";

/**
 * Workflow Configurations Table
 * Stores user-customized workflow configurations for the 35-step legal analysis
 */
export const workflowConfigs = pgTable(
  "workflow_configs",
  {
    id: serial("id").primaryKey(),

    // User identification - linked to auth system
    userId: integer("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),

    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    // Configuration metadata
    name: text("name").notNull().default("Default Workflow"),
    description: text("description"),

    // The actual workflow configuration (stored as JSON)
    // This matches the WorkflowConfig type from lib/workflow-config.ts
    config: jsonb("config").notNull(),

    // Workflow type to distinguish between different workflow types
    // 'default' = Original bot (/workflow)
    // 'offense' = Offense bot (/workflow/offense)
    // 'discovery-drafting' = Outgoing discovery bot (/workflow/outgoingdiscovery)
    workflowType: text("workflow_type").notNull().default("default"),

    // Version number for tracking configuration history
    // Auto-incremented per workflow type per organization
    version: integer("version").notNull().default(1),

    // Summary of changes made in this version
    changeSummary: text("change_summary"),

    // Active/default configuration
    isActive: boolean("is_active").notNull().default(false),
    isDefault: boolean("is_default").notNull().default(false),

    // Timestamps
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    organizationIdIdx: index("idx_workflow_configs_organization_id").on(
      table.organizationId,
    ),
    userIdIdx: index("idx_workflow_configs_user_id").on(table.userId),
    orgActiveIdx: index("idx_workflow_configs_org_active").on(
      table.organizationId,
      table.isActive,
    ),
    // Index for efficient querying of versions by organization and workflow type
    orgTypeVersionIdx: index("idx_workflow_configs_org_type_version").on(
      table.organizationId,
      table.workflowType,
      table.version,
    ),
    // Index for finding the latest version quickly
    orgTypeUpdatedIdx: index("idx_workflow_configs_org_type_updated").on(
      table.organizationId,
      table.workflowType,
      table.updatedAt,
    ),
  }),
);

export type WorkflowConfigRow = typeof workflowConfigs.$inferSelect;
export type NewWorkflowConfig = typeof workflowConfigs.$inferInsert;

/**
 * Workflow type enum for type safety
 */
export type WorkflowType = "default" | "offense" | "discovery-drafting";
