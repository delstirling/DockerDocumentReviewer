import {
  pgTable,
  text,
  timestamp,
  jsonb,
  integer,
  boolean,
  index,
  serial,
  date,
} from "drizzle-orm/pg-core";
import { organizations } from "./auth";
import { analysisSessions } from "./analysis";

// ============================================================================
// JURISDICTION HIERARCHY
// ============================================================================

/**
 * Jurisdictions Table
 * Hierarchical structure: Federal -> Circuit/State -> District -> County/Local
 */
export const jurisdictions = pgTable(
  "jurisdictions",
  {
    id: serial("id").primaryKey(),

    // Hierarchical structure (self-referencing - parent jurisdiction)
    parentId: integer("parent_id"),
    level: integer("level").notNull(), // 1=Federal, 2=Circuit/State, 3=District, 4=County/Local

    // Identification
    code: text("code").notNull().unique(), // e.g., 'US', 'KS', 'KS-D3', 'KS-D3-SHAWNEE'
    name: text("name").notNull(),
    shortName: text("short_name"),

    // Classification
    jurisdictionType: text("jurisdiction_type").notNull(), // 'federal', 'state', 'district', 'county', 'municipal'
    courtSystem: text("court_system"), // 'federal', 'state', 'tribal'

    // Geography (for district courts)
    stateCode: text("state_code"), // Two-letter state code
    fipsCode: text("fips_code"), // County FIPS code if applicable
    countiesCovered: text("counties_covered").array(), // Array of county names for multi-county districts

    // Metadata
    populationEstimate: integer("population_estimate"), // Helps prioritize which local rules to cache
    isActive: boolean("is_active").default(true),
    notes: text("notes"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    parentIdIdx: index("idx_jurisdictions_parent").on(table.parentId),
    levelIdx: index("idx_jurisdictions_level").on(table.level),
    stateCodeIdx: index("idx_jurisdictions_state").on(table.stateCode),
  }),
);

// ============================================================================
// LEGAL SOURCE TYPES
// ============================================================================

/**
 * Source Types Table
 * Categories of legal sources with staleness thresholds
 */
export const sourceTypes = pgTable("source_types", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),

  // Categorization
  category: text("category").notNull(), // 'statutory', 'regulatory', 'court_rule', 'case_law'
  subcategory: text("subcategory"), // 'civil_procedure', 'criminal_procedure', 'evidence', 'local'

  // Update frequency expectations (for staleness calculations)
  typicalUpdateFrequency: text("typical_update_frequency"), // 'annual', 'session', 'quarterly', 'as_needed'
  stalenessWarningDays: integer("staleness_warning_days").default(365), // Days before flagging as potentially stale

  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ============================================================================
// LEGAL SOURCES (URLs and metadata)
// ============================================================================

/**
 * Legal Sources Table
 * URLs and metadata for legal sources with bot accessibility tracking
 */
export const legalSources = pgTable(
  "legal_sources",
  {
    id: serial("id").primaryKey(),

    // Multi-tenant isolation
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    // Jurisdiction and type linkage
    jurisdictionId: integer("jurisdiction_id")
      .notNull()
      .references(() => jurisdictions.id),
    sourceTypeId: integer("source_type_id")
      .notNull()
      .references(() => sourceTypes.id),

    // Identification
    name: text("name").notNull(),
    shortName: text("short_name"),
    citationFormat: text("citation_format"), // e.g., 'K.S.A. § {section}', 'D. Kan. LR {rule}'

    // Primary URL
    url: text("url"),
    urlVerifiedAt: timestamp("url_verified_at"),
    urlIsOfficial: boolean("url_is_official").default(true),

    // Alternative URLs (for fallback)
    altUrls: jsonb("alt_urls"), // [{url: '', name: 'Cornell LII', is_official: false}, ...]

    // Bot accessibility
    botAccessible: boolean("bot_accessible"), // NULL = unknown, TRUE = tested working, FALSE = blocked
    botTestedAt: timestamp("bot_tested_at"),
    botBlockReason: text("bot_block_reason"), // 'robots_txt', 'captcha', 'login_required', etc.

    // Amendment/update tracking
    showsAmendmentHistory: boolean("shows_amendment_history"), // Does source show when sections were amended?
    amendmentHistoryFormat: text("amendment_history_format"), // Description of how history is displayed

    // Importance/priority
    priority: integer("priority").default(50), // 1-100, higher = more important to keep current

    // Status
    isActive: boolean("is_active").default(true),

    // Metadata
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    organizationIdIdx: index("idx_legal_sources_organization").on(
      table.organizationId,
    ),
    jurisdictionIdIdx: index("idx_legal_sources_jurisdiction").on(
      table.jurisdictionId,
    ),
    sourceTypeIdIdx: index("idx_legal_sources_type").on(table.sourceTypeId),
    botAccessibleIdx: index("idx_legal_sources_bot").on(table.botAccessible),
  }),
);

// ============================================================================
// CACHED CONTENT (for hard-to-find local rules)
// ============================================================================

/**
 * Source Content Cache Table
 * Stores actual content for hard-to-find local rules with staleness tracking
 */
export const sourceContentCache = pgTable(
  "source_content_cache",
  {
    id: serial("id").primaryKey(),

    // Multi-tenant isolation
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    // Link to source
    legalSourceId: integer("legal_source_id")
      .notNull()
      .references(() => legalSources.id),

    // Content identification
    sectionIdentifier: text("section_identifier"), // e.g., 'Rule 5.1', 'Standing Order 2024-1'
    title: text("title"),

    // The actual content
    contentText: text("content_text"), // Plain text version
    contentHtml: text("content_html"), // HTML if available
    contentFormat: text("content_format").notNull(), // 'text', 'html', 'pdf', 'mixed'

    // Dates (CRITICAL for staleness tracking)
    effectiveDate: date("effective_date"), // When this rule/content became effective
    effectiveDateSource: text("effective_date_source"), // Where we got the effective date from
    effectiveDateConfidence: text("effective_date_confidence"), // 'explicit', 'inferred', 'unknown'

    supersededDate: date("superseded_date"), // If this has been replaced
    supersededBy: text("superseded_by"), // Reference to what replaced it

    // Retrieval metadata
    obtainedAt: timestamp("obtained_at").notNull().defaultNow(),
    obtainedFromUrl: text("obtained_from_url"),
    obtainedMethod: text("obtained_method"), // 'web_fetch', 'manual_upload', 'api', 'email_request'

    // Verification
    lastVerifiedCurrentAt: timestamp("last_verified_current_at"), // Last time we confirmed this is still current
    verificationMethod: text("verification_method"), // How we verified

    // Hash for change detection
    contentHash: text("content_hash"), // SHA-256 of content for change detection

    // Status
    isCurrent: boolean("is_current").default(true), // FALSE if superseded or withdrawn
    needsReview: boolean("needs_review").default(false), // Flag for manual review
    reviewReason: text("review_reason"),

    // Metadata
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    organizationIdIdx: index("idx_content_cache_organization").on(
      table.organizationId,
    ),
    legalSourceIdIdx: index("idx_content_cache_source").on(table.legalSourceId),
    isCurrentIdx: index("idx_content_cache_current").on(table.isCurrent),
    effectiveDateIdx: index("idx_content_cache_effective").on(
      table.effectiveDate,
    ),
    obtainedAtIdx: index("idx_content_cache_obtained").on(table.obtainedAt),
  }),
);

// ============================================================================
// STALENESS TRACKING AND ALERTS
// ============================================================================

/**
 * Source Staleness Log Table
 * Tracks staleness checks and actions taken
 */
export const sourceStalenessLog = pgTable(
  "source_staleness_log",
  {
    id: serial("id").primaryKey(),

    // Multi-tenant isolation
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    legalSourceId: integer("legal_source_id").references(() => legalSources.id),
    contentCacheId: integer("content_cache_id").references(
      () => sourceContentCache.id,
    ),

    // Staleness calculation
    checkDate: timestamp("check_date").notNull().defaultNow(),
    daysSinceObtained: integer("days_since_obtained"),
    daysSinceVerified: integer("days_since_verified"),
    stalenessThresholdDays: integer("staleness_threshold_days"),

    // Result
    isStale: boolean("is_stale").notNull(),
    stalenessLevel: text("staleness_level"), // 'current', 'warning', 'stale', 'critical'

    // Action taken
    actionTaken: text("action_taken"), // 'none', 'flagged_for_review', 'auto_refresh_attempted', 'notified_user'
    actionResult: text("action_result"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    organizationIdIdx: index("idx_staleness_organization").on(
      table.organizationId,
    ),
    legalSourceIdIdx: index("idx_staleness_source").on(table.legalSourceId),
    checkDateIdx: index("idx_staleness_date").on(table.checkDate),
  }),
);

// ============================================================================
// DOCUMENT REVIEW INTEGRATION
// ============================================================================

/**
 * Review Source Consultations Table
 * Tracks which sources were consulted for each document review
 */
export const reviewSourceConsultations = pgTable(
  "review_source_consultations",
  {
    id: serial("id").primaryKey(),

    // Multi-tenant isolation
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    // Link to the analysis session
    analysisSessionId: integer("analysis_session_id")
      .notNull()
      .references(() => analysisSessions.id, { onDelete: "cascade" }),

    // Which source was consulted
    legalSourceId: integer("legal_source_id").references(() => legalSources.id),
    contentCacheId: integer("content_cache_id").references(
      () => sourceContentCache.id,
    ),

    // What was looked up
    lookupQuery: text("lookup_query"), // What citation/section was searched for
    lookupResult: text("lookup_result"), // Brief summary of what was found

    // Currency assessment at time of consultation
    sourceObtainedAt: timestamp("source_obtained_at"),
    sourceEffectiveDate: date("source_effective_date"),
    daysSinceObtained: integer("days_since_obtained"),
    currencyWarningGenerated: boolean("currency_warning_generated").default(
      false,
    ),
    currencyWarningText: text("currency_warning_text"),

    // Result
    sourceConfirmedCurrent: boolean("source_confirmed_current"), // Did source confirm doctrine is still current?
    doctrinalShiftDetected: boolean("doctrinal_shift_detected"),
    shiftDescription: text("shift_description"),

    consultedAt: timestamp("consulted_at").notNull().defaultNow(),
  },
  (table) => ({
    organizationIdIdx: index("idx_consultations_organization").on(
      table.organizationId,
    ),
    analysisSessionIdIdx: index("idx_consultations_session").on(
      table.analysisSessionId,
    ),
    legalSourceIdIdx: index("idx_consultations_source").on(table.legalSourceId),
  }),
);

// ============================================================================
// CASE TREATMENT TRACKING (for negative treatment detection)
// ============================================================================

/**
 * Case Treatment Records Table
 * Tracks negative treatment of cases (overruled, abrogated, etc.)
 */
export const caseTreatmentRecords = pgTable(
  "case_treatment_records",
  {
    id: serial("id").primaryKey(),

    // Multi-tenant isolation
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    // Link to analysis session
    analysisSessionId: integer("analysis_session_id")
      .notNull()
      .references(() => analysisSessions.id, { onDelete: "cascade" }),

    // Case identification
    citationText: text("citation_text").notNull(), // e.g., "Smith v. Jones, 123 F.3d 456"
    caseName: text("case_name").notNull(),
    courtListenerOpinionId: text("court_listener_opinion_id"),
    courtListenerUrl: text("court_listener_url"),

    // Treatment information
    treatmentType: text("treatment_type"), // 'overruled', 'abrogated', 'distinguished', 'questioned', 'criticized', 'limited'
    treatmentDescription: text("treatment_description"),
    treatingCaseCitation: text("treating_case_citation"), // Citation of the case that provides the treatment
    treatingCaseDate: date("treating_case_date"),

    // Severity assessment
    severityLevel: text("severity_level"), // 'critical', 'warning', 'informational'
    requiresAttention: boolean("requires_attention").default(false),

    // Verification
    verifiedAt: timestamp("verified_at"),
    verificationSource: text("verification_source"), // 'courtlistener_api', 'manual', 'westlaw', 'lexis'

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    organizationIdIdx: index("idx_case_treatment_organization").on(
      table.organizationId,
    ),
    analysisSessionIdIdx: index("idx_case_treatment_session").on(
      table.analysisSessionId,
    ),
    treatmentTypeIdx: index("idx_case_treatment_type").on(table.treatmentType),
    severityLevelIdx: index("idx_case_treatment_severity").on(
      table.severityLevel,
    ),
  }),
);

/**
 * Statutory Amendment Records Table
 * Tracks amendments to statutes since citing cases were decided
 */
export const statutoryAmendmentRecords = pgTable(
  "statutory_amendment_records",
  {
    id: serial("id").primaryKey(),

    // Multi-tenant isolation
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    // Link to analysis session
    analysisSessionId: integer("analysis_session_id")
      .notNull()
      .references(() => analysisSessions.id, { onDelete: "cascade" }),

    // Statute identification
    statuteCitation: text("statute_citation").notNull(), // e.g., "K.S.A. § 60-101"
    statuteTitle: text("statute_title"),
    jurisdictionCode: text("jurisdiction_code"), // e.g., 'KS', 'US'

    // Amendment information
    amendmentDate: date("amendment_date"),
    amendmentDescription: text("amendment_description"),
    amendmentSource: text("amendment_source"), // Public law number, session law citation, etc.

    // Citing case context
    citingCaseCitation: text("citing_case_citation"), // The case that cited this statute
    citingCaseDate: date("citing_case_date"),

    // Impact assessment
    impactLevel: text("impact_level"), // 'substantive', 'technical', 'unknown'
    impactDescription: text("impact_description"),
    requiresReview: boolean("requires_review").default(false),

    // Verification
    verifiedAt: timestamp("verified_at"),
    verificationSource: text("verification_source"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    organizationIdIdx: index("idx_statutory_amendment_organization").on(
      table.organizationId,
    ),
    analysisSessionIdIdx: index("idx_statutory_amendment_session").on(
      table.analysisSessionId,
    ),
    jurisdictionCodeIdx: index("idx_statutory_amendment_jurisdiction").on(
      table.jurisdictionCode,
    ),
    impactLevelIdx: index("idx_statutory_amendment_impact").on(
      table.impactLevel,
    ),
  }),
);

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type Jurisdiction = typeof jurisdictions.$inferSelect;
export type NewJurisdiction = typeof jurisdictions.$inferInsert;

export type SourceType = typeof sourceTypes.$inferSelect;
export type NewSourceType = typeof sourceTypes.$inferInsert;

export type LegalSource = typeof legalSources.$inferSelect;
export type NewLegalSource = typeof legalSources.$inferInsert;

export type SourceContentCache = typeof sourceContentCache.$inferSelect;
export type NewSourceContentCache = typeof sourceContentCache.$inferInsert;

export type SourceStalenessLog = typeof sourceStalenessLog.$inferSelect;
export type NewSourceStalenessLog = typeof sourceStalenessLog.$inferInsert;

export type ReviewSourceConsultation =
  typeof reviewSourceConsultations.$inferSelect;
export type NewReviewSourceConsultation =
  typeof reviewSourceConsultations.$inferInsert;

export type CaseTreatmentRecord = typeof caseTreatmentRecords.$inferSelect;
export type NewCaseTreatmentRecord = typeof caseTreatmentRecords.$inferInsert;

export type StatutoryAmendmentRecord =
  typeof statutoryAmendmentRecords.$inferSelect;
export type NewStatutoryAmendmentRecord =
  typeof statutoryAmendmentRecords.$inferInsert;

// ============================================================================
// HELPER TYPES
// ============================================================================

export type JurisdictionLevel = 1 | 2 | 3 | 4; // Federal, Circuit/State, District, County/Local

export type JurisdictionType =
  | "federal"
  | "state"
  | "district"
  | "county"
  | "municipal";

export type SourceCategory =
  | "statutory"
  | "regulatory"
  | "court_rule"
  | "case_law";

export type ContentFormat = "text" | "html" | "pdf" | "mixed";

export type EffectiveDateConfidence = "explicit" | "inferred" | "unknown";

export type ObtainedMethod =
  | "web_fetch"
  | "manual_upload"
  | "api"
  | "email_request";

export type StalenessLevel = "current" | "warning" | "stale" | "critical";

export type TreatmentType =
  | "overruled"
  | "abrogated"
  | "distinguished"
  | "questioned"
  | "criticized"
  | "limited"
  | "followed"
  | "cited";

export type SeverityLevel = "critical" | "warning" | "informational";

export type ImpactLevel = "substantive" | "technical" | "unknown";

// ============================================================================
// STALENESS THRESHOLDS (configurable defaults)
// ============================================================================

export const STALENESS_THRESHOLDS = {
  LOCAL_RULE: { warning: 90, stale: 180, critical: 365 },
  JUDGE_PRACTICE: { warning: 60, stale: 90, critical: 180 },
  STANDING_ORDER: { warning: 60, stale: 90, critical: 180 },
  STATUTE: { warning: 270, stale: 365, critical: 730 },
  COURT_RULE: { warning: 270, stale: 365, critical: 730 },
  DEFAULT: { warning: 180, stale: 365, critical: 730 },
} as const;

/**
 * Calculate staleness level based on days since verification and source type
 */
export function calculateStalenessLevel(
  daysSinceVerified: number,
  sourceTypeCode: string,
): StalenessLevel {
  const thresholds =
    STALENESS_THRESHOLDS[sourceTypeCode as keyof typeof STALENESS_THRESHOLDS] ||
    STALENESS_THRESHOLDS.DEFAULT;

  if (daysSinceVerified >= thresholds.critical) return "critical";
  if (daysSinceVerified >= thresholds.stale) return "stale";
  if (daysSinceVerified >= thresholds.warning) return "warning";
  return "current";
}
