import {
  pgEnum,
  pgTable,
  text,
  varchar,
  boolean,
  timestamp,
  serial,
  integer,
} from "drizzle-orm/pg-core";

export const organizationTierEnum = pgEnum("organization_tier", [
  "user",
  "admin",
]);

export const organizations = pgTable("organizations", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  password: varchar("password", { length: 255 }),
  organizationId: integer("organization_id").references(() => organizations.id, {
    onDelete: "set null",
  }),
  organizationTier: organizationTierEnum("organization_tier")
    .notNull()
    .default("user"),
  role: varchar("role", { length: 50 }).notNull().default("user"),
  isActive: boolean("is_active").notNull().default(true),
  isApproved: boolean("is_approved").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }),
  action: varchar("action", { length: 255 }).notNull(),
  details: text("details"),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const invitationTokens = pgTable("invitation_tokens", {
  id: serial("id").primaryKey(),
  token: varchar("token", { length: 255 }).notNull().unique(),
  email: varchar("email", { length: 255 }).notNull(),
  organizationId: integer("organization_id").references(() => organizations.id, {
    onDelete: "set null",
  }),
  role: varchar("role", { length: 50 }).notNull().default("user"),
  used: boolean("used").notNull().default(false),
  acceptedAt: timestamp("accepted_at"),
  expires: timestamp("expires"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 255 }).notNull().unique(),
  used: boolean("used").notNull().default(false),
  usedAt: timestamp("used_at"),
  expires: timestamp("expires").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
