import {
  pgTable,
  text,
  timestamp,
  jsonb,
  integer,
  numeric,
  boolean,
  index,
  unique,
  serial,
} from "drizzle-orm/pg-core";
import { analysisSessions, documents } from "./analysis";
import { organizations } from "./auth";

/**
 * Propositions Table
 * Stores legal statements/assertions that require citation support
 */
export const propositions = pgTable(
  "propositions",
  {
    id: serial("id").primaryKey(),

    // Session relationship
    analysisSessionId: integer("analysis_session_id")
      .notNull()
      .references(() => analysisSessions.id, { onDelete: "cascade" }),

    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    stepIndex: integer("step_index").notNull(),
    stepId: text("step_id"),
    stepName: text("step_name"),

    text: text("text").notNull(),

    orderIndex: integer("order_index").notNull(),

    // Timestamps
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    sessionIdIdx: index("idx_propositions_session_id").on(
      table.analysisSessionId,
    ),
    organizationIdIdx: index("idx_propositions_organization_id").on(
      table.organizationId,
    ),
    stepIndexIdx: index("idx_propositions_step_index").on(table.stepIndex),
    createdAtIdx: index("idx_propositions_created_at").on(table.createdAt),
  }),
);

/**
 * Citations Table
 * Stores verified quotes with source URLs and verification metadata
 */
export const citations = pgTable(
  "citations",
  {
    id: serial("id").primaryKey(),

    analysisSessionId: integer("analysis_session_id")
      .notNull()
      .references(() => analysisSessions.id, { onDelete: "cascade" }),
    propositionId: integer("proposition_id")
      .notNull()
      .references(() => propositions.id, { onDelete: "cascade" }),

    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    type: text("type").notNull(), // 'legal_authority' | 'documentary_evidence'
    authorityType: text("authority_type"), // 'case_law' | 'statute' | 'regulation' | 'local_rule'

    citationText: text("citation_text").notNull(), // e.g., "Smith v. Jones, 123 Kan. 456"
    url: text("url").notNull(),

    documentId: integer("document_id").references(() => documents.id, {
      onDelete: "set null",
    }),

    quoteText: text("quote_text").notNull(),
    quoteTextNormalized: text("quote_text_normalized").notNull(),
    quoteHash: text("quote_hash").notNull(), // sha256(normalized) for deduplication

    scrollFragment: text("scroll_fragment"), // e.g., "#:~:text=truncated+quote"

    attribution: text("attribution"), // 'our_firm' | 'opposing' | 'neutral'

    status: text("status").notNull().default("pending"), // 'pending' | 'verifying' | 'verified' | 'failed'
    verified: boolean("verified").notNull().default(false),
    verificationConfidence: numeric("verification_confidence"),
    fallbackFlag: boolean("fallback_flag").notNull().default(false),
    retryCount: integer("retry_count").notNull().default(0),
    verifiedAt: timestamp("verified_at"),
    note: text("note"),

    alphanumericPercent: numeric("alphanumeric_percent"), // AN% - alphanumeric match percentage (0-100)
    punctuationSpacePercent: numeric("punctuation_space_percent"), // PS% - punctuation & spacing match percentage (0-100)
    aiVerification: text("ai_verification"), // AI verification result: 'Exact Match' | 'Negligible Mismatch' | 'Material Mismatch'

    metadata: jsonb("metadata"),

    // Timestamps
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    sessionIdIdx: index("idx_citations_session_id").on(table.analysisSessionId),
    propositionIdIdx: index("idx_citations_proposition_id").on(
      table.propositionId,
    ),
    organizationIdIdx: index("idx_citations_organization_id").on(
      table.organizationId,
    ),
    typeIdx: index("idx_citations_type").on(table.type),
    urlIdx: index("idx_citations_url").on(table.url),
    quoteHashIdx: index("idx_citations_quote_hash").on(table.quoteHash),
    verifiedIdx: index("idx_citations_verified").on(table.verified),
    statusIdx: index("idx_citations_status").on(table.status),
    uniqueCitation: unique("unique_citation_per_proposition").on(
      table.propositionId,
      table.url,
      table.quoteHash,
    ),
  }),
);

/**
 * Citation Verification Attempts Table
 * Audit trail of all verification attempts (up to 5 retries)
 */
export const citationVerificationAttempts = pgTable(
  "citation_verification_attempts",
  {
    id: serial("id").primaryKey(),

    citationId: integer("citation_id")
      .notNull()
      .references(() => citations.id, { onDelete: "cascade" }),

    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    attemptNumber: integer("attempt_number").notNull(),
    method: text("method").notNull(), // 'extract' | 'crawl' | 'other'
    matched: boolean("matched").notNull(),
    confidence: numeric("confidence"),

    isImageScan: boolean("is_image_scan").notNull().default(false),
    textLength: integer("text_length"),
    note: text("note"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    citationIdIdx: index("idx_verification_attempts_citation_id").on(
      table.citationId,
    ),
    organizationIdIdx: index("idx_verification_attempts_organization_id").on(
      table.organizationId,
    ),
    attemptNumberIdx: index("idx_verification_attempts_attempt_number").on(
      table.attemptNumber,
    ),
  }),
);

/**
 * Citation Index Assignments Table
 * Stable footnote numbering for Word export (numbers don't change between exports)
 */
export const citationIndexAssignments = pgTable(
  "citation_index_assignments",
  {
    id: serial("id").primaryKey(),

    analysisSessionId: integer("analysis_session_id")
      .notNull()
      .references(() => analysisSessions.id, { onDelete: "cascade" }),
    propositionId: integer("proposition_id")
      .notNull()
      .references(() => propositions.id, { onDelete: "cascade" }),
    citationId: integer("citation_id")
      .notNull()
      .references(() => citations.id, { onDelete: "cascade" }),

    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    number: integer("number").notNull(),
    color: text("color").notNull(), // e.g., "#0B63FF"

    // Timestamps
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    sessionIdIdx: index("idx_citation_index_session_id").on(
      table.analysisSessionId,
    ),
    organizationIdIdx: index("idx_citation_index_organization_id").on(
      table.organizationId,
    ),
    uniqueNumber: unique("unique_footnote_number_per_session").on(
      table.analysisSessionId,
      table.number,
    ),
    uniqueAssignment: unique("unique_citation_assignment_per_session").on(
      table.analysisSessionId,
      table.propositionId,
      table.citationId,
    ),
  }),
);

/**
 * Contextual Analyses Table
 * Stores contextual explanations for each citation (displayed as Word comments)
 */
export const contextualAnalyses = pgTable(
  "contextual_analyses",
  {
    id: serial("id").primaryKey(),

    citationId: integer("citation_id")
      .notNull()
      .references(() => citations.id, { onDelete: "cascade" }),

    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    authorityCitation: text("authority_citation").notNull(),
    authorityType: text("authority_type").notNull(), // 'legal_authority' | 'documentary_evidence'

    statementFunction: text("statement_function").notNull(), // 'holding' | 'reasoning' | 'dicta'
    precedingContextSummary: text("preceding_context_summary").notNull(),
    subsequentDevelopmentSummary: text(
      "subsequent_development_summary",
    ).notNull(),
    qualificationsLimitationsSummary: text(
      "qualifications_limitations_summary",
    ).notNull(),
    alignmentVerification: text("alignment_verification").notNull(),

    // Timestamps
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    citationIdIdx: index("idx_contextual_analyses_citation_id").on(
      table.citationId,
    ),
    organizationIdIdx: index("idx_contextual_analyses_organization_id").on(
      table.organizationId,
    ),
  }),
);

/**
 * Contextual Quotes Table
 * Stores direct quotes used within contextual explanations
 */
export const contextualQuotes = pgTable(
  "contextual_quotes",
  {
    id: serial("id").primaryKey(),

    contextualAnalysisId: integer("contextual_analysis_id")
      .notNull()
      .references(() => contextualAnalyses.id, { onDelete: "cascade" }),

    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    section: text("section").notNull(), // 'preceding' | 'subsequent' | 'qualifications'

    quoteText: text("quote_text").notNull(),
    quoteTextNormalized: text("quote_text_normalized").notNull(),
    quoteHash: text("quote_hash").notNull(),

    verified: boolean("verified").notNull().default(false),

    linkedCitationId: integer("linked_citation_id").references(
      () => citations.id,
      { onDelete: "set null" },
    ),

    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    contextualAnalysisIdIdx: index("idx_contextual_quotes_analysis_id").on(
      table.contextualAnalysisId,
    ),
    organizationIdIdx: index("idx_contextual_quotes_organization_id").on(
      table.organizationId,
    ),
    quoteHashIdx: index("idx_contextual_quotes_quote_hash").on(table.quoteHash),
  }),
);

/**
 * Authority Sources Table (Optional - for caching fetched content)
 * Stores extracted text from authority sources to avoid repeated Tavily calls
 */
export const authoritySources = pgTable(
  "authority_sources",
  {
    id: serial("id").primaryKey(),

    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    url: text("url").notNull(),

    title: text("title"),
    extractedText: text("extracted_text"), // Can be large; consider truncation
    textLength: integer("text_length"),
    isImageScan: boolean("is_image_scan").notNull().default(false),

    lastFetchedAt: timestamp("last_fetched_at").notNull().defaultNow(),
  },
  (table) => ({
    urlIdx: index("idx_authority_sources_url").on(table.url),
    organizationIdIdx: index("idx_authority_sources_organization_id").on(
      table.organizationId,
    ),
    uniqueOrgUrl: unique("unique_authority_source_per_org").on(
      table.organizationId,
      table.url,
    ),
  }),
);

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type Proposition = typeof propositions.$inferSelect;
export type NewProposition = typeof propositions.$inferInsert;

export type Citation = typeof citations.$inferSelect;
export type NewCitation = typeof citations.$inferInsert;

export type CitationVerificationAttempt =
  typeof citationVerificationAttempts.$inferSelect;
export type NewCitationVerificationAttempt =
  typeof citationVerificationAttempts.$inferInsert;

export type CitationIndexAssignment =
  typeof citationIndexAssignments.$inferSelect;
export type NewCitationIndexAssignment =
  typeof citationIndexAssignments.$inferInsert;

export type ContextualAnalysis = typeof contextualAnalyses.$inferSelect;
export type NewContextualAnalysis = typeof contextualAnalyses.$inferInsert;

export type ContextualQuote = typeof contextualQuotes.$inferSelect;
export type NewContextualQuote = typeof contextualQuotes.$inferInsert;

export type AuthoritySource = typeof authoritySources.$inferSelect;
export type NewAuthoritySource = typeof authoritySources.$inferInsert;
