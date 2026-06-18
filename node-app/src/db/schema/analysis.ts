import { processingLocks } from "./processingLocks";
import {
  pgTable,
  text,
  timestamp,
  jsonb,
  integer,
  bigint,
  boolean,
  index,
  real,
  serial,
} from "drizzle-orm/pg-core";
import { users, organizations } from "./auth";
import { workflowConfigs } from "./workflow";

/**
 * Analysis Sessions Table
 * Stores document analysis sessions with unique URLs for each analysis instance
 */
export const analysisSessions = pgTable(
  "analysis_sessions",
  {
    // Primary identifier
    id: serial("id").primaryKey(),

    // User ownership
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    // Session metadata
    title: text("title"), // Auto-generated from subject document name
    status: text("status").notNull().default("draft"), // 'draft' | 'processing' | 'complete' | 'error'

    // Document type and case information
    documentType: text("document_type"), // 'demand_letter', 'contract', 'complaint', etc.
    caseType: text("case_type"), // 'civil_dispute', 'criminal', 'administrative', etc.
    jurisdiction: text("jurisdiction"), // 'Kansas', 'Federal - 10th Circuit', etc.

    // Parties information
    ourClients: text("our_clients").array(), // Array of client names
    opposingParties: text("opposing_parties").array(), // Array of opposing party names

    // Document origin detection (for offensive analysis mode)
    documentOrigin: text("document_origin").default("unknown"), // 'our_firm' | 'opposing' | 'neutral' | 'unknown'

    // Context and summary
    contextSummary: text("context_summary"), // User-provided or AI-generated

    // AI configuration for this session
    aiMode: text("ai_mode").default("tools_and_steps"), // 'none' | 'tools' | 'tools_and_steps'
    workflowConfigId: integer("workflow_config_id").references(
      () => workflowConfigs.id,
      { onDelete: "set null" },
    ),

    // Analysis results (stored as JSONB for flexibility)
    analysisResult: jsonb("analysis_result"), // Full AI analysis output

    // Additional metadata (JSONB for flexibility)
    metadata: jsonb("metadata"), // Flexible metadata field

    // Progress tracking
    currentStep: integer("current_step").default(0),
    totalSteps: integer("total_steps").default(35),
    finalStepCompleted: boolean("final_step_completed").default(false), // Set by orchestrator when all steps complete

    // Chunked analysis tracking
    continuationCount: integer("continuation_count").default(0),
    lastContinuedAt: timestamp("last_continued_at"),
    timeBudgetMs: integer("time_budget_ms").default(770000), // ~12.8 minutes - aligned with STREAM_SOFT_TIMEOUT_MS

    lastActivityAt: timestamp("last_activity_at"), // Heartbeat updated every 10-15s during processing
    isResuming: boolean("is_resuming").default(false), // DEPRECATED - use distributed lock
    processingLockId: text("processing_lock_id"),
    processingLockAcquiredAt: timestamp("processing_lock_acquired_at"),
    processingLockExpiresAt: timestamp("processing_lock_expires_at"),
    processingWorkerType: text("processing_worker_type"),
    lockVersion: integer("lock_version").default(0),

    currentPhase: integer("current_phase").default(0), // Current phase index (0-based)
    totalPhases: integer("total_phases").default(8), // Total number of phases (default 8)
    currentPhaseTurn: integer("current_phase_turn").default(0), // Current turn within phase
    executionMode: text("execution_mode").default("step-based"), // 'step-based' | 'phase-based'

    // Step attempt tracking for applicability check
    lastAttemptedStepId: text("last_attempted_step_id"), // Step ID that was last attempted (e.g., "step-9-jurisdiction")
    lastAttemptedStepOrder: real("last_attempted_step_order"), // Step order that was last attempted (supports decimal values like 10.5 for sub-steps)
    attemptsOnCurrentStep: integer("attempts_on_current_step").default(0), // How many times we've tried this step

    // Timestamps
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),

    // Soft delete (for history retention)
    deletedAt: timestamp("deleted_at"),

    // External integration fields (for chatuserinterface integration)
    externalOrganizationId: text("external_organization_id"), // chatuserinterface organization ID for cross-system tenant isolation
    externalUserId: text("external_user_id"), // chatuserinterface user ID for user-scoped history
    lawFirmNameOverride: text("law_firm_name_override"), // Override law firm name from chatuserinterface org settings
    documentAuthorNameOverride: text("document_author_name_override"), // Override AI author name from chatuserinterface chatbot settings
    sourceSystem: text("source_system").default("documentreviewer"), // 'documentreviewer' | 'chatuserinterface'
  },
  (table) => ({
    // Indexes for performance
    userIdIdx: index("idx_analysis_sessions_user_id").on(table.userId),
    organizationIdIdx: index("idx_analysis_sessions_organization_id").on(
      table.organizationId,
    ),
    statusIdx: index("idx_analysis_sessions_status").on(table.status),
    createdAtIdx: index("idx_analysis_sessions_created_at").on(table.createdAt),
    userCreatedIdx: index("idx_analysis_sessions_user_created").on(
      table.userId,
      table.createdAt,
    ),
    orgCreatedIdx: index("idx_analysis_sessions_org_created").on(
      table.organizationId,
      table.createdAt,
    ),
    // External integration indexes
    externalOrgIdx: index("idx_analysis_sessions_external_org").on(
      table.externalOrganizationId,
    ),
    externalUserIdx: index("idx_analysis_sessions_external_user").on(
      table.externalOrganizationId,
      table.externalUserId,
    ),
  }),
);

/**
 * Documents Table
 * Stores uploaded document metadata and storage references
 */
export const documents = pgTable(
  "documents",
  {
    // Primary identifier
    id: serial("id").primaryKey(),

    // Session relationship
    analysisSessionId: integer("analysis_session_id")
      .notNull()
      .references(() => analysisSessions.id, { onDelete: "cascade" }),

    // Document metadata
    fileName: text("file_name").notNull(),
    fileType: text("file_type").notNull(), // MIME type
    fileSize: bigint("file_size", { mode: "number" }).notNull(), // Size in bytes

    // Document role in analysis
    documentRole: text("document_role").notNull(), // 'subject' | 'context'

    // Storage (supports multiple backends)
    storageType: text("storage_type").notNull().default("local_file"), // 'local_file' | 's3' | 'base64'
    storageUrl: text("storage_url"), // Public or signed URL
    storageKey: text("storage_key"), // Storage provider's key/token

    // Extracted content (for AI processing and search)
    extractedText: text("extracted_text"), // Full text extraction
    extractedTextPreview: text("extracted_text_preview"), // First 1000 chars

    // Extraction metadata
    pageCount: integer("page_count"),
    wordCount: integer("word_count"),
    extractionMethod: text("extraction_method"), // 'pdf-parse' | 'mammoth' | 'fallback'
    extractionStatus: text("extraction_status").default("pending"), // 'pending' | 'success' | 'failed'
    extractionError: text("extraction_error"),

    // Timestamps
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    // Indexes for performance
    sessionIdIdx: index("idx_documents_session_id").on(table.analysisSessionId),
    roleIdx: index("idx_documents_role").on(table.documentRole),
    extractionStatusIdx: index("idx_documents_extraction_status").on(
      table.extractionStatus,
    ),
  }),
);

/**
 * User Preferences Table
 * Stores user-specific defaults and UI state (persisted across devices)
 */
export const userPreferences = pgTable("user_preferences", {
  // One record per user (1:1 relationship with users table)
  userId: integer("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),

  // Default AI settings
  defaultAiMode: text("default_ai_mode").default("tools_and_steps"), // 'none' | 'tools' | 'tools_and_steps'
  defaultWorkflowConfigId: integer("default_workflow_config_id").references(
    () => workflowConfigs.id,
    { onDelete: "set null" },
  ),

  // Default case information (auto-populated in forms)
  defaultJurisdiction: text("default_jurisdiction"),
  defaultCaseType: text("default_case_type"),

  // UI preferences (persisted across devices)
  sidePanelDefaultTab: text("side_panel_default_tab").default("data"), // 'data' | 'history'
  sidePanelCollapsed: boolean("side_panel_collapsed").default(false),
  historyPanelItemsCount: integer("history_panel_items_count").default(20),

  // Timestamps
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type AnalysisSession = typeof analysisSessions.$inferSelect;
export type NewAnalysisSession = typeof analysisSessions.$inferInsert;

export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;

export type UserPreferences = typeof userPreferences.$inferSelect;
export type NewUserPreferences = typeof userPreferences.$inferInsert;

// ============================================================================
// HELPER TYPES FOR APPLICATION USE
// ============================================================================

/**
 * Analysis session status types
 */
export type AnalysisSessionStatus =
  | "draft"
  | "processing"
  | "complete"
  | "error";

/**
 * AI mode types
 */
export type AiMode = "none" | "tools" | "tools_and_steps";

/**
 * Document role types
 */
export type DocumentRole = "subject" | "context";

/**
 * Storage type options
 */
export type StorageType = "local_file" | "s3" | "base64";

/**
 * Extraction status types
 */
export type ExtractionStatus = "pending" | "success" | "failed";

/**
 * Side panel tab types
 */
export type SidePanelTab = "data" | "history";

/**
 * Analysis Steps Table
 * Stores per-step analysis text and metadata for each analysis session
 * Enables queryable step-by-step analysis history
 */
export const analysisSteps = pgTable(
  "analysis_steps",
  {
    // Primary identifier
    id: serial("id").primaryKey(),

    // Session relationship (cascade delete when session is deleted)
    analysisSessionId: integer("analysis_session_id")
      .notNull()
      .references(() => analysisSessions.id, { onDelete: "cascade" }),

    stepIndex: integer("step_index").notNull(), // 0-based index (0-34 for 35 steps)
    stepName: text("step_name").notNull(), // e.g., "Document Identification"
    stepId: text("step_id"), // Optional step ID from workflow config

    analysisText: text("analysis_text").notNull(), // The AI's analysis for this step (post-verification)

    thinkingText: text("thinking_text"), // Extended thinking output (Claude's reasoning breadcrumbs)

    toolCallCount: integer("tool_call_count").default(0), // Number of tool calls in this step
    usage: jsonb("usage"), // Per-step token usage: { promptTokens, completionTokens, totalTokens }

    // Timestamps
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    uniqueSessionStep: index("idx_analysis_steps_unique_session_step").on(
      table.analysisSessionId,
      table.stepIndex,
    ),
    sessionIdIdx: index("idx_analysis_steps_session_id").on(
      table.analysisSessionId,
    ),
  }),
);

// ============================================================================
// TYPE EXPORTS FOR ANALYSIS STEPS
// ============================================================================

export type AnalysisStep = typeof analysisSteps.$inferSelect;
export type NewAnalysisStep = typeof analysisSteps.$inferInsert;

/**
 * Continuation Jobs Table
 * Stores pending continuation work for durable orchestration with watchdog recovery
 */
export const continuationJobs = pgTable(
  "continuation_jobs",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id")
      .notNull()
      .references(() => analysisSessions.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    leaseUntil: timestamp("lease_until"),
    attempts: integer("attempts").notNull().default(0),
    visibleAt: timestamp("visible_at").notNull().defaultNow(),
    lastError: text("last_error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    sessionIdIdx: index("idx_continuation_jobs_session").on(table.sessionId),
    statusVisibleIdx: index("idx_continuation_jobs_status_visible").on(
      table.status,
      table.visibleAt,
    ),
    leaseIdx: index("idx_continuation_jobs_lease").on(table.leaseUntil),
  }),
);

export type ContinuationJob = typeof continuationJobs.$inferSelect;
export type NewContinuationJob = typeof continuationJobs.$inferInsert;
export type ContinuationJobStatus =
  | "pending"
  | "processing"
  | "done"
  | "failed";

/**
 * Phase Turns Table
 * Stores individual agentic turns within each phase of analysis
 */
export const phaseTurns = pgTable(
  "phase_turns",
  {
    id: serial("id").primaryKey(),
    analysisSessionId: integer("analysis_session_id")
      .notNull()
      .references(() => analysisSessions.id, { onDelete: "cascade" }),
    phaseIndex: integer("phase_index").notNull(),
    phaseId: text("phase_id").notNull(),
    phaseName: text("phase_name").notNull(),
    turnIndex: integer("turn_index").notNull(),
    turnText: text("turn_text").notNull(),
    thinkingText: text("thinking_text"),
    toolCalls: jsonb("tool_calls").default([]),
    complete: boolean("complete").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    sessionIdIdx: index("idx_phase_turns_session_id").on(
      table.analysisSessionId,
    ),
    sessionPhaseIdx: index("idx_phase_turns_session_phase").on(
      table.analysisSessionId,
      table.phaseIndex,
    ),
    uniqueSessionPhaseTurnIdx: index(
      "idx_phase_turns_unique_session_phase_turn",
    ).on(table.analysisSessionId, table.phaseIndex, table.turnIndex),
  }),
);

export type PhaseTurn = typeof phaseTurns.$inferSelect;
export type NewPhaseTurn = typeof phaseTurns.$inferInsert;

/**
 * Phase Results Table
 * Stores completed phase results with summaries and recommendations
 */
export const phaseResults = pgTable(
  "phase_results",
  {
    id: serial("id").primaryKey(),
    analysisSessionId: integer("analysis_session_id")
      .notNull()
      .references(() => analysisSessions.id, { onDelete: "cascade" }),
    phaseIndex: integer("phase_index").notNull(),
    phaseId: text("phase_id").notNull(),
    phaseName: text("phase_name").notNull(),
    complete: boolean("complete").notNull().default(false),
    summary: text("summary"),
    confidence: text("confidence"),
    nextPhaseRecommendations: text("next_phase_recommendations"),
    turnCount: integer("turn_count").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at"),
  },
  (table) => ({
    sessionIdIdx: index("idx_phase_results_session_id").on(
      table.analysisSessionId,
    ),
    uniqueSessionPhaseIdx: index("idx_phase_results_unique_session_phase").on(
      table.analysisSessionId,
      table.phaseIndex,
    ),
  }),
);

export type PhaseResult = typeof phaseResults.$inferSelect;
export type NewPhaseResult = typeof phaseResults.$inferInsert;
export type PhaseConfidence = "high" | "medium" | "low";
export type ExecutionMode = "step-based" | "phase-based";

/**
 * Iteration Results Table
 * Stores individual iteration results for iterative step execution
 * Each row represents one iteration of a step across multiple items (e.g., case briefing for each cited case)
 */
export const iterationResults = pgTable(
  "iteration_results",
  {
    id: serial("id").primaryKey(),

    // Multi-tenant isolation
    organizationId: integer("organization_id").notNull(),

    // Link to the analysis step that triggered the iteration
    analysisStepId: integer("analysis_step_id").references(
      () => analysisSteps.id,
      {
        onDelete: "cascade",
      },
    ),

    // Link to the analysis session for easier querying
    analysisSessionId: integer("analysis_session_id")
      .notNull()
      .references(() => analysisSessions.id, { onDelete: "cascade" }),

    // Iteration tracking
    iterationIndex: integer("iteration_index").notNull(), // 0-based index of this iteration
    totalIterations: integer("total_iterations").notNull(), // Total number of iterations planned

    // Item identification
    itemIdentifier: text("item_identifier").notNull(), // Full identifier (e.g., "Smith v. Jones, 123 F.3d 456 (10th Cir. 2020)")
    itemDisplayName: text("item_display_name").notNull(), // Short display name (e.g., "Smith v. Jones")
    itemType: text("item_type"), // Type of item (e.g., "case_law", "statute", "exhibit")
    sourceLocation: text("source_location"), // Where this item appears in the document
    extractedContext: text("extracted_context"), // Relevant context from the document about this item

    // Analysis results
    analysisText: text("analysis_text"), // The AI's analysis for this iteration
    thinkingText: text("thinking_text"), // Extended thinking output for this iteration

    // Execution metadata
    toolCallCount: integer("tool_call_count").default(0), // Number of tool calls in this iteration
    usage: jsonb("usage"), // Token usage for this iteration: { promptTokens, completionTokens, totalTokens }

    // Status tracking
    success: boolean("success").notNull().default(false), // Whether this iteration completed successfully
    errorMessage: text("error_message"), // Error message if iteration failed

    // Timestamps
    createdAt: timestamp("created_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at"),
  },
  (table) => ({
    sessionIdIdx: index("idx_iteration_results_session_id").on(
      table.analysisSessionId,
    ),
    stepIdIdx: index("idx_iteration_results_step_id").on(table.analysisStepId),
    sessionStepIdx: index("idx_iteration_results_session_step").on(
      table.analysisSessionId,
      table.analysisStepId,
    ),
    iterationOrderIdx: index("idx_iteration_results_order").on(
      table.analysisSessionId,
      table.analysisStepId,
      table.iterationIndex,
    ),
  }),
);

export type IterationResult = typeof iterationResults.$inferSelect;
export type NewIterationResult = typeof iterationResults.$inferInsert;
