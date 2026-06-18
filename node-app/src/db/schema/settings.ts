/**
 * Application Settings Schema
 * Stores configurable application settings in database
 * Supports both global settings (userId = null) and user-specific settings
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  index,
  integer,
  serial,
} from "drizzle-orm/pg-core";
import { users } from "./auth";

/**
 * Application settings table
 * Stores key-value pairs for application configuration
 * - Global settings: userId = null (e.g., verification_small_model)
 * - User-specific settings: userId set (e.g., user preferences)
 */
export const appSettings = pgTable(
  "app_settings",
  {
    id: serial("id").primaryKey(),

    userId: integer("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),

    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    userKeyIdx: index("idx_app_settings_user_key").on(table.userId, table.key),
    keyIdx: index("idx_app_settings_key").on(table.key),
  }),
);

export type AppSetting = typeof appSettings.$inferSelect;
export type NewAppSetting = typeof appSettings.$inferInsert;
