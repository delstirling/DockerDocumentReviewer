CREATE TYPE "public"."organization_tier" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TABLE "analysis_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"organization_id" integer NOT NULL,
	"title" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"document_type" text,
	"case_type" text,
	"jurisdiction" text,
	"our_clients" text[],
	"opposing_parties" text[],
	"document_origin" text DEFAULT 'unknown',
	"context_summary" text,
	"ai_mode" text DEFAULT 'tools_and_steps',
	"workflow_config_id" integer,
	"analysis_result" jsonb,
	"metadata" jsonb,
	"current_step" integer DEFAULT 0,
	"total_steps" integer DEFAULT 35,
	"final_step_completed" boolean DEFAULT false,
	"continuation_count" integer DEFAULT 0,
	"last_continued_at" timestamp,
	"time_budget_ms" integer DEFAULT 770000,
	"last_activity_at" timestamp,
	"is_resuming" boolean DEFAULT false,
	"processing_lock_id" text,
	"processing_lock_acquired_at" timestamp,
	"processing_lock_expires_at" timestamp,
	"processing_worker_type" text,
	"lock_version" integer DEFAULT 0,
	"current_phase" integer DEFAULT 0,
	"total_phases" integer DEFAULT 8,
	"current_phase_turn" integer DEFAULT 0,
	"execution_mode" text DEFAULT 'step-based',
	"last_attempted_step_id" text,
	"last_attempted_step_order" real,
	"attempts_on_current_step" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"deleted_at" timestamp,
	"external_organization_id" text,
	"external_user_id" text,
	"law_firm_name_override" text,
	"document_author_name_override" text,
	"source_system" text DEFAULT 'documentreviewer'
);
--> statement-breakpoint
CREATE TABLE "analysis_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"analysis_session_id" integer NOT NULL,
	"step_index" integer NOT NULL,
	"step_name" text NOT NULL,
	"step_id" text,
	"analysis_text" text NOT NULL,
	"thinking_text" text,
	"tool_call_count" integer DEFAULT 0,
	"usage" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "continuation_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"lease_until" timestamp,
	"attempts" integer DEFAULT 0 NOT NULL,
	"visible_at" timestamp DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"analysis_session_id" integer NOT NULL,
	"file_name" text NOT NULL,
	"file_type" text NOT NULL,
	"file_size" bigint NOT NULL,
	"document_role" text NOT NULL,
	"storage_type" text DEFAULT 'local_file' NOT NULL,
	"storage_url" text,
	"storage_key" text,
	"extracted_text" text,
	"extracted_text_preview" text,
	"page_count" integer,
	"word_count" integer,
	"extraction_method" text,
	"extraction_status" text DEFAULT 'pending',
	"extraction_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iteration_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"analysis_step_id" integer,
	"analysis_session_id" integer NOT NULL,
	"iteration_index" integer NOT NULL,
	"total_iterations" integer NOT NULL,
	"item_identifier" text NOT NULL,
	"item_display_name" text NOT NULL,
	"item_type" text,
	"source_location" text,
	"extracted_context" text,
	"analysis_text" text,
	"thinking_text" text,
	"tool_call_count" integer DEFAULT 0,
	"usage" jsonb,
	"success" boolean DEFAULT false NOT NULL,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "phase_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"analysis_session_id" integer NOT NULL,
	"phase_index" integer NOT NULL,
	"phase_id" text NOT NULL,
	"phase_name" text NOT NULL,
	"complete" boolean DEFAULT false NOT NULL,
	"summary" text,
	"confidence" text,
	"next_phase_recommendations" text,
	"turn_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "phase_turns" (
	"id" serial PRIMARY KEY NOT NULL,
	"analysis_session_id" integer NOT NULL,
	"phase_index" integer NOT NULL,
	"phase_id" text NOT NULL,
	"phase_name" text NOT NULL,
	"turn_index" integer NOT NULL,
	"turn_text" text NOT NULL,
	"thinking_text" text,
	"tool_calls" jsonb DEFAULT '[]'::jsonb,
	"complete" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"default_ai_mode" text DEFAULT 'tools_and_steps',
	"default_workflow_config_id" integer,
	"default_jurisdiction" text,
	"default_case_type" text,
	"side_panel_default_tab" text DEFAULT 'data',
	"side_panel_collapsed" boolean DEFAULT false,
	"history_panel_items_count" integer DEFAULT 20,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"token_hash" varchar(255) NOT NULL,
	"used" boolean DEFAULT false NOT NULL,
	"used_at" timestamp,
	"expires" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "password_reset_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "authority_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"url" text NOT NULL,
	"title" text,
	"extracted_text" text,
	"text_length" integer,
	"is_image_scan" boolean DEFAULT false NOT NULL,
	"last_fetched_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_authority_source_per_org" UNIQUE("organization_id","url")
);
--> statement-breakpoint
CREATE TABLE "citation_index_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"analysis_session_id" integer NOT NULL,
	"proposition_id" integer NOT NULL,
	"citation_id" integer NOT NULL,
	"organization_id" integer NOT NULL,
	"number" integer NOT NULL,
	"color" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_footnote_number_per_session" UNIQUE("analysis_session_id","number"),
	CONSTRAINT "unique_citation_assignment_per_session" UNIQUE("analysis_session_id","proposition_id","citation_id")
);
--> statement-breakpoint
CREATE TABLE "citation_verification_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"citation_id" integer NOT NULL,
	"organization_id" integer NOT NULL,
	"attempt_number" integer NOT NULL,
	"method" text NOT NULL,
	"matched" boolean NOT NULL,
	"confidence" numeric,
	"is_image_scan" boolean DEFAULT false NOT NULL,
	"text_length" integer,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "citations" (
	"id" serial PRIMARY KEY NOT NULL,
	"analysis_session_id" integer NOT NULL,
	"proposition_id" integer NOT NULL,
	"organization_id" integer NOT NULL,
	"type" text NOT NULL,
	"authority_type" text,
	"citation_text" text NOT NULL,
	"url" text NOT NULL,
	"document_id" integer,
	"quote_text" text NOT NULL,
	"quote_text_normalized" text NOT NULL,
	"quote_hash" text NOT NULL,
	"scroll_fragment" text,
	"attribution" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"verification_confidence" numeric,
	"fallback_flag" boolean DEFAULT false NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"verified_at" timestamp,
	"note" text,
	"alphanumeric_percent" numeric,
	"punctuation_space_percent" numeric,
	"ai_verification" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_citation_per_proposition" UNIQUE("proposition_id","url","quote_hash")
);
--> statement-breakpoint
CREATE TABLE "contextual_analyses" (
	"id" serial PRIMARY KEY NOT NULL,
	"citation_id" integer NOT NULL,
	"organization_id" integer NOT NULL,
	"authority_citation" text NOT NULL,
	"authority_type" text NOT NULL,
	"statement_function" text NOT NULL,
	"preceding_context_summary" text NOT NULL,
	"subsequent_development_summary" text NOT NULL,
	"qualifications_limitations_summary" text NOT NULL,
	"alignment_verification" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contextual_quotes" (
	"id" serial PRIMARY KEY NOT NULL,
	"contextual_analysis_id" integer NOT NULL,
	"organization_id" integer NOT NULL,
	"section" text NOT NULL,
	"quote_text" text NOT NULL,
	"quote_text_normalized" text NOT NULL,
	"quote_hash" text NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"linked_citation_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "propositions" (
	"id" serial PRIMARY KEY NOT NULL,
	"analysis_session_id" integer NOT NULL,
	"organization_id" integer NOT NULL,
	"step_index" integer NOT NULL,
	"step_id" text,
	"step_name" text,
	"text" text NOT NULL,
	"order_index" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_expenses" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"organization_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"username" text,
	"session_start_time" timestamp,
	"session_completion_time" timestamp,
	"model_1_name" text,
	"model_1_input_tokens" integer DEFAULT 0,
	"model_1_output_tokens" integer DEFAULT 0,
	"model_1_cache_creation_tokens" integer DEFAULT 0,
	"model_1_cache_read_tokens" integer DEFAULT 0,
	"model_1_cost_usd" numeric(10, 6) DEFAULT '0',
	"model_2_name" text,
	"model_2_input_tokens" integer DEFAULT 0,
	"model_2_output_tokens" integer DEFAULT 0,
	"model_2_cache_creation_tokens" integer DEFAULT 0,
	"model_2_cache_read_tokens" integer DEFAULT 0,
	"model_2_cost_usd" numeric(10, 6) DEFAULT '0',
	"model_3_name" text,
	"model_3_input_tokens" integer DEFAULT 0,
	"model_3_output_tokens" integer DEFAULT 0,
	"model_3_cache_creation_tokens" integer DEFAULT 0,
	"model_3_cache_read_tokens" integer DEFAULT 0,
	"model_3_cost_usd" numeric(10, 6) DEFAULT '0',
	"total_cost_usd" numeric(10, 6) DEFAULT '0',
	"tavily_credits_used" integer DEFAULT 0,
	"tavily_cost_usd" numeric(10, 6) DEFAULT '0',
	"grand_total_cost_usd" numeric(10, 6) DEFAULT '0',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"organization_id" integer NOT NULL,
	"name" text DEFAULT 'Default Workflow' NOT NULL,
	"description" text,
	"config" jsonb NOT NULL,
	"workflow_type" text DEFAULT 'default' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"change_summary" text,
	"is_active" boolean DEFAULT false NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processing_locks" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"chunk_identifier" text NOT NULL,
	"lock_id" text NOT NULL,
	"worker_type" text NOT NULL,
	"worker_pid" text,
	"acquired_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"lock_purpose" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_call_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"analysis_session_id" integer NOT NULL,
	"analysis_step_id" integer,
	"step_index" integer,
	"step_name" text,
	"tool_name" text NOT NULL,
	"tool_category" text,
	"tool_input" jsonb NOT NULL,
	"tool_output" jsonb,
	"http_method" text,
	"http_url" text,
	"http_status_code" integer,
	"http_response_size" bigint,
	"started_at" timestamp NOT NULL,
	"completed_at" timestamp,
	"elapsed_ms" integer,
	"error_category" text,
	"error_message" text,
	"error_stack" text,
	"is_empty_input" boolean DEFAULT false,
	"is_empty_output" boolean DEFAULT false,
	"is_timeout" boolean DEFAULT false,
	"is_rate_limited" boolean DEFAULT false,
	"is_network_error" boolean DEFAULT false,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "step_tool_availability" (
	"id" serial PRIMARY KEY NOT NULL,
	"analysis_session_id" integer NOT NULL,
	"analysis_step_id" integer,
	"step_index" integer NOT NULL,
	"step_name" text NOT NULL,
	"tools_offered" text[] DEFAULT '{}' NOT NULL,
	"tools_used_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_treatment_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"analysis_session_id" integer NOT NULL,
	"citation_text" text NOT NULL,
	"case_name" text NOT NULL,
	"court_listener_opinion_id" text,
	"court_listener_url" text,
	"treatment_type" text,
	"treatment_description" text,
	"treating_case_citation" text,
	"treating_case_date" date,
	"severity_level" text,
	"requires_attention" boolean DEFAULT false,
	"verified_at" timestamp,
	"verification_source" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jurisdictions" (
	"id" serial PRIMARY KEY NOT NULL,
	"parent_id" integer,
	"level" integer NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"short_name" text,
	"jurisdiction_type" text NOT NULL,
	"court_system" text,
	"state_code" text,
	"fips_code" text,
	"counties_covered" text[],
	"population_estimate" integer,
	"is_active" boolean DEFAULT true,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "jurisdictions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "legal_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"jurisdiction_id" integer NOT NULL,
	"source_type_id" integer NOT NULL,
	"name" text NOT NULL,
	"short_name" text,
	"citation_format" text,
	"url" text,
	"url_verified_at" timestamp,
	"url_is_official" boolean DEFAULT true,
	"alt_urls" jsonb,
	"bot_accessible" boolean,
	"bot_tested_at" timestamp,
	"bot_block_reason" text,
	"shows_amendment_history" boolean,
	"amendment_history_format" text,
	"priority" integer DEFAULT 50,
	"is_active" boolean DEFAULT true,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_source_consultations" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"analysis_session_id" integer NOT NULL,
	"legal_source_id" integer,
	"content_cache_id" integer,
	"lookup_query" text,
	"lookup_result" text,
	"source_obtained_at" timestamp,
	"source_effective_date" date,
	"days_since_obtained" integer,
	"currency_warning_generated" boolean DEFAULT false,
	"currency_warning_text" text,
	"source_confirmed_current" boolean,
	"doctrinal_shift_detected" boolean,
	"shift_description" text,
	"consulted_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_content_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"legal_source_id" integer NOT NULL,
	"section_identifier" text,
	"title" text,
	"content_text" text,
	"content_html" text,
	"content_format" text NOT NULL,
	"effective_date" date,
	"effective_date_source" text,
	"effective_date_confidence" text,
	"superseded_date" date,
	"superseded_by" text,
	"obtained_at" timestamp DEFAULT now() NOT NULL,
	"obtained_from_url" text,
	"obtained_method" text,
	"last_verified_current_at" timestamp,
	"verification_method" text,
	"content_hash" text,
	"is_current" boolean DEFAULT true,
	"needs_review" boolean DEFAULT false,
	"review_reason" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_staleness_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"legal_source_id" integer,
	"content_cache_id" integer,
	"check_date" timestamp DEFAULT now() NOT NULL,
	"days_since_obtained" integer,
	"days_since_verified" integer,
	"staleness_threshold_days" integer,
	"is_stale" boolean NOT NULL,
	"staleness_level" text,
	"action_taken" text,
	"action_result" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text NOT NULL,
	"subcategory" text,
	"typical_update_frequency" text,
	"staleness_warning_days" integer DEFAULT 365,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "source_types_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "statutory_amendment_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"analysis_session_id" integer NOT NULL,
	"statute_citation" text NOT NULL,
	"statute_title" text,
	"jurisdiction_code" text,
	"amendment_date" date,
	"amendment_description" text,
	"amendment_source" text,
	"citing_case_citation" text,
	"citing_case_date" date,
	"impact_level" text,
	"impact_description" text,
	"requires_review" boolean DEFAULT false,
	"verified_at" timestamp,
	"verification_source" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invitation_tokens" ADD COLUMN "organization_id" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "organization_id" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "organization_tier" "organization_tier" DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "analysis_sessions" ADD CONSTRAINT "analysis_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_sessions" ADD CONSTRAINT "analysis_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_sessions" ADD CONSTRAINT "analysis_sessions_workflow_config_id_workflow_configs_id_fk" FOREIGN KEY ("workflow_config_id") REFERENCES "public"."workflow_configs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_steps" ADD CONSTRAINT "analysis_steps_analysis_session_id_analysis_sessions_id_fk" FOREIGN KEY ("analysis_session_id") REFERENCES "public"."analysis_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "continuation_jobs" ADD CONSTRAINT "continuation_jobs_session_id_analysis_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."analysis_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_analysis_session_id_analysis_sessions_id_fk" FOREIGN KEY ("analysis_session_id") REFERENCES "public"."analysis_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iteration_results" ADD CONSTRAINT "iteration_results_analysis_step_id_analysis_steps_id_fk" FOREIGN KEY ("analysis_step_id") REFERENCES "public"."analysis_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iteration_results" ADD CONSTRAINT "iteration_results_analysis_session_id_analysis_sessions_id_fk" FOREIGN KEY ("analysis_session_id") REFERENCES "public"."analysis_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phase_results" ADD CONSTRAINT "phase_results_analysis_session_id_analysis_sessions_id_fk" FOREIGN KEY ("analysis_session_id") REFERENCES "public"."analysis_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phase_turns" ADD CONSTRAINT "phase_turns_analysis_session_id_analysis_sessions_id_fk" FOREIGN KEY ("analysis_session_id") REFERENCES "public"."analysis_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_default_workflow_config_id_workflow_configs_id_fk" FOREIGN KEY ("default_workflow_config_id") REFERENCES "public"."workflow_configs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authority_sources" ADD CONSTRAINT "authority_sources_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citation_index_assignments" ADD CONSTRAINT "citation_index_assignments_analysis_session_id_analysis_sessions_id_fk" FOREIGN KEY ("analysis_session_id") REFERENCES "public"."analysis_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citation_index_assignments" ADD CONSTRAINT "citation_index_assignments_proposition_id_propositions_id_fk" FOREIGN KEY ("proposition_id") REFERENCES "public"."propositions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citation_index_assignments" ADD CONSTRAINT "citation_index_assignments_citation_id_citations_id_fk" FOREIGN KEY ("citation_id") REFERENCES "public"."citations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citation_index_assignments" ADD CONSTRAINT "citation_index_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citation_verification_attempts" ADD CONSTRAINT "citation_verification_attempts_citation_id_citations_id_fk" FOREIGN KEY ("citation_id") REFERENCES "public"."citations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citation_verification_attempts" ADD CONSTRAINT "citation_verification_attempts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citations" ADD CONSTRAINT "citations_analysis_session_id_analysis_sessions_id_fk" FOREIGN KEY ("analysis_session_id") REFERENCES "public"."analysis_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citations" ADD CONSTRAINT "citations_proposition_id_propositions_id_fk" FOREIGN KEY ("proposition_id") REFERENCES "public"."propositions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citations" ADD CONSTRAINT "citations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citations" ADD CONSTRAINT "citations_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contextual_analyses" ADD CONSTRAINT "contextual_analyses_citation_id_citations_id_fk" FOREIGN KEY ("citation_id") REFERENCES "public"."citations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contextual_analyses" ADD CONSTRAINT "contextual_analyses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contextual_quotes" ADD CONSTRAINT "contextual_quotes_contextual_analysis_id_contextual_analyses_id_fk" FOREIGN KEY ("contextual_analysis_id") REFERENCES "public"."contextual_analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contextual_quotes" ADD CONSTRAINT "contextual_quotes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contextual_quotes" ADD CONSTRAINT "contextual_quotes_linked_citation_id_citations_id_fk" FOREIGN KEY ("linked_citation_id") REFERENCES "public"."citations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "propositions" ADD CONSTRAINT "propositions_analysis_session_id_analysis_sessions_id_fk" FOREIGN KEY ("analysis_session_id") REFERENCES "public"."analysis_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "propositions" ADD CONSTRAINT "propositions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_expenses" ADD CONSTRAINT "session_expenses_session_id_analysis_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."analysis_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_expenses" ADD CONSTRAINT "session_expenses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_expenses" ADD CONSTRAINT "session_expenses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_configs" ADD CONSTRAINT "workflow_configs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_configs" ADD CONSTRAINT "workflow_configs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_locks" ADD CONSTRAINT "processing_locks_session_id_analysis_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."analysis_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_call_logs" ADD CONSTRAINT "tool_call_logs_analysis_session_id_analysis_sessions_id_fk" FOREIGN KEY ("analysis_session_id") REFERENCES "public"."analysis_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_call_logs" ADD CONSTRAINT "tool_call_logs_analysis_step_id_analysis_steps_id_fk" FOREIGN KEY ("analysis_step_id") REFERENCES "public"."analysis_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_tool_availability" ADD CONSTRAINT "step_tool_availability_analysis_session_id_analysis_sessions_id_fk" FOREIGN KEY ("analysis_session_id") REFERENCES "public"."analysis_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_tool_availability" ADD CONSTRAINT "step_tool_availability_analysis_step_id_analysis_steps_id_fk" FOREIGN KEY ("analysis_step_id") REFERENCES "public"."analysis_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_treatment_records" ADD CONSTRAINT "case_treatment_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_treatment_records" ADD CONSTRAINT "case_treatment_records_analysis_session_id_analysis_sessions_id_fk" FOREIGN KEY ("analysis_session_id") REFERENCES "public"."analysis_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_sources" ADD CONSTRAINT "legal_sources_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_sources" ADD CONSTRAINT "legal_sources_jurisdiction_id_jurisdictions_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."jurisdictions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_sources" ADD CONSTRAINT "legal_sources_source_type_id_source_types_id_fk" FOREIGN KEY ("source_type_id") REFERENCES "public"."source_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_source_consultations" ADD CONSTRAINT "review_source_consultations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_source_consultations" ADD CONSTRAINT "review_source_consultations_analysis_session_id_analysis_sessions_id_fk" FOREIGN KEY ("analysis_session_id") REFERENCES "public"."analysis_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_source_consultations" ADD CONSTRAINT "review_source_consultations_legal_source_id_legal_sources_id_fk" FOREIGN KEY ("legal_source_id") REFERENCES "public"."legal_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_source_consultations" ADD CONSTRAINT "review_source_consultations_content_cache_id_source_content_cache_id_fk" FOREIGN KEY ("content_cache_id") REFERENCES "public"."source_content_cache"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_content_cache" ADD CONSTRAINT "source_content_cache_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_content_cache" ADD CONSTRAINT "source_content_cache_legal_source_id_legal_sources_id_fk" FOREIGN KEY ("legal_source_id") REFERENCES "public"."legal_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_staleness_log" ADD CONSTRAINT "source_staleness_log_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_staleness_log" ADD CONSTRAINT "source_staleness_log_legal_source_id_legal_sources_id_fk" FOREIGN KEY ("legal_source_id") REFERENCES "public"."legal_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_staleness_log" ADD CONSTRAINT "source_staleness_log_content_cache_id_source_content_cache_id_fk" FOREIGN KEY ("content_cache_id") REFERENCES "public"."source_content_cache"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statutory_amendment_records" ADD CONSTRAINT "statutory_amendment_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statutory_amendment_records" ADD CONSTRAINT "statutory_amendment_records_analysis_session_id_analysis_sessions_id_fk" FOREIGN KEY ("analysis_session_id") REFERENCES "public"."analysis_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_analysis_sessions_user_id" ON "analysis_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_analysis_sessions_organization_id" ON "analysis_sessions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_analysis_sessions_status" ON "analysis_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_analysis_sessions_created_at" ON "analysis_sessions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_analysis_sessions_user_created" ON "analysis_sessions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_analysis_sessions_org_created" ON "analysis_sessions" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_analysis_sessions_external_org" ON "analysis_sessions" USING btree ("external_organization_id");--> statement-breakpoint
CREATE INDEX "idx_analysis_sessions_external_user" ON "analysis_sessions" USING btree ("external_organization_id","external_user_id");--> statement-breakpoint
CREATE INDEX "idx_analysis_steps_unique_session_step" ON "analysis_steps" USING btree ("analysis_session_id","step_index");--> statement-breakpoint
CREATE INDEX "idx_analysis_steps_session_id" ON "analysis_steps" USING btree ("analysis_session_id");--> statement-breakpoint
CREATE INDEX "idx_continuation_jobs_session" ON "continuation_jobs" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_continuation_jobs_status_visible" ON "continuation_jobs" USING btree ("status","visible_at");--> statement-breakpoint
CREATE INDEX "idx_continuation_jobs_lease" ON "continuation_jobs" USING btree ("lease_until");--> statement-breakpoint
CREATE INDEX "idx_documents_session_id" ON "documents" USING btree ("analysis_session_id");--> statement-breakpoint
CREATE INDEX "idx_documents_role" ON "documents" USING btree ("document_role");--> statement-breakpoint
CREATE INDEX "idx_documents_extraction_status" ON "documents" USING btree ("extraction_status");--> statement-breakpoint
CREATE INDEX "idx_iteration_results_session_id" ON "iteration_results" USING btree ("analysis_session_id");--> statement-breakpoint
CREATE INDEX "idx_iteration_results_step_id" ON "iteration_results" USING btree ("analysis_step_id");--> statement-breakpoint
CREATE INDEX "idx_iteration_results_session_step" ON "iteration_results" USING btree ("analysis_session_id","analysis_step_id");--> statement-breakpoint
CREATE INDEX "idx_iteration_results_order" ON "iteration_results" USING btree ("analysis_session_id","analysis_step_id","iteration_index");--> statement-breakpoint
CREATE INDEX "idx_phase_results_session_id" ON "phase_results" USING btree ("analysis_session_id");--> statement-breakpoint
CREATE INDEX "idx_phase_results_unique_session_phase" ON "phase_results" USING btree ("analysis_session_id","phase_index");--> statement-breakpoint
CREATE INDEX "idx_phase_turns_session_id" ON "phase_turns" USING btree ("analysis_session_id");--> statement-breakpoint
CREATE INDEX "idx_phase_turns_session_phase" ON "phase_turns" USING btree ("analysis_session_id","phase_index");--> statement-breakpoint
CREATE INDEX "idx_phase_turns_unique_session_phase_turn" ON "phase_turns" USING btree ("analysis_session_id","phase_index","turn_index");--> statement-breakpoint
CREATE INDEX "idx_authority_sources_url" ON "authority_sources" USING btree ("url");--> statement-breakpoint
CREATE INDEX "idx_authority_sources_organization_id" ON "authority_sources" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_citation_index_session_id" ON "citation_index_assignments" USING btree ("analysis_session_id");--> statement-breakpoint
CREATE INDEX "idx_citation_index_organization_id" ON "citation_index_assignments" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_verification_attempts_citation_id" ON "citation_verification_attempts" USING btree ("citation_id");--> statement-breakpoint
CREATE INDEX "idx_verification_attempts_organization_id" ON "citation_verification_attempts" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_verification_attempts_attempt_number" ON "citation_verification_attempts" USING btree ("attempt_number");--> statement-breakpoint
CREATE INDEX "idx_citations_session_id" ON "citations" USING btree ("analysis_session_id");--> statement-breakpoint
CREATE INDEX "idx_citations_proposition_id" ON "citations" USING btree ("proposition_id");--> statement-breakpoint
CREATE INDEX "idx_citations_organization_id" ON "citations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_citations_type" ON "citations" USING btree ("type");--> statement-breakpoint
CREATE INDEX "idx_citations_url" ON "citations" USING btree ("url");--> statement-breakpoint
CREATE INDEX "idx_citations_quote_hash" ON "citations" USING btree ("quote_hash");--> statement-breakpoint
CREATE INDEX "idx_citations_verified" ON "citations" USING btree ("verified");--> statement-breakpoint
CREATE INDEX "idx_citations_status" ON "citations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_contextual_analyses_citation_id" ON "contextual_analyses" USING btree ("citation_id");--> statement-breakpoint
CREATE INDEX "idx_contextual_analyses_organization_id" ON "contextual_analyses" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_contextual_quotes_analysis_id" ON "contextual_quotes" USING btree ("contextual_analysis_id");--> statement-breakpoint
CREATE INDEX "idx_contextual_quotes_organization_id" ON "contextual_quotes" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_contextual_quotes_quote_hash" ON "contextual_quotes" USING btree ("quote_hash");--> statement-breakpoint
CREATE INDEX "idx_propositions_session_id" ON "propositions" USING btree ("analysis_session_id");--> statement-breakpoint
CREATE INDEX "idx_propositions_organization_id" ON "propositions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_propositions_step_index" ON "propositions" USING btree ("step_index");--> statement-breakpoint
CREATE INDEX "idx_propositions_created_at" ON "propositions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_session_expenses_session_id" ON "session_expenses" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_session_expenses_organization_id" ON "session_expenses" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_session_expenses_user_id" ON "session_expenses" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_session_expenses_completion_time" ON "session_expenses" USING btree ("session_completion_time");--> statement-breakpoint
CREATE INDEX "idx_session_expenses_org_completion" ON "session_expenses" USING btree ("organization_id","session_completion_time");--> statement-breakpoint
CREATE INDEX "idx_workflow_configs_organization_id" ON "workflow_configs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_workflow_configs_user_id" ON "workflow_configs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_workflow_configs_org_active" ON "workflow_configs" USING btree ("organization_id","is_active");--> statement-breakpoint
CREATE INDEX "idx_workflow_configs_org_type_version" ON "workflow_configs" USING btree ("organization_id","workflow_type","version");--> statement-breakpoint
CREATE INDEX "idx_workflow_configs_org_type_updated" ON "workflow_configs" USING btree ("organization_id","workflow_type","updated_at");--> statement-breakpoint
CREATE INDEX "unique_session_chunk_lock" ON "processing_locks" USING btree ("session_id","chunk_identifier");--> statement-breakpoint
CREATE INDEX "idx_processing_locks_session" ON "processing_locks" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_processing_locks_expires" ON "processing_locks" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_processing_locks_worker" ON "processing_locks" USING btree ("lock_id");--> statement-breakpoint
CREATE INDEX "idx_tool_call_logs_session_id" ON "tool_call_logs" USING btree ("analysis_session_id");--> statement-breakpoint
CREATE INDEX "idx_tool_call_logs_step_id" ON "tool_call_logs" USING btree ("analysis_step_id");--> statement-breakpoint
CREATE INDEX "idx_tool_call_logs_tool_name" ON "tool_call_logs" USING btree ("tool_name");--> statement-breakpoint
CREATE INDEX "idx_tool_call_logs_error_category" ON "tool_call_logs" USING btree ("error_category");--> statement-breakpoint
CREATE INDEX "idx_tool_call_logs_diagnostic" ON "tool_call_logs" USING btree ("is_empty_input","is_empty_output","is_timeout","is_rate_limited");--> statement-breakpoint
CREATE INDEX "idx_tool_call_logs_started_at" ON "tool_call_logs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "idx_step_tool_availability_session_id" ON "step_tool_availability" USING btree ("analysis_session_id");--> statement-breakpoint
CREATE INDEX "idx_step_tool_availability_step_id" ON "step_tool_availability" USING btree ("analysis_step_id");--> statement-breakpoint
CREATE INDEX "idx_step_tool_availability_step_index" ON "step_tool_availability" USING btree ("step_index");--> statement-breakpoint
CREATE INDEX "idx_app_settings_user_key" ON "app_settings" USING btree ("user_id","key");--> statement-breakpoint
CREATE INDEX "idx_app_settings_key" ON "app_settings" USING btree ("key");--> statement-breakpoint
CREATE INDEX "idx_case_treatment_organization" ON "case_treatment_records" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_case_treatment_session" ON "case_treatment_records" USING btree ("analysis_session_id");--> statement-breakpoint
CREATE INDEX "idx_case_treatment_type" ON "case_treatment_records" USING btree ("treatment_type");--> statement-breakpoint
CREATE INDEX "idx_case_treatment_severity" ON "case_treatment_records" USING btree ("severity_level");--> statement-breakpoint
CREATE INDEX "idx_jurisdictions_parent" ON "jurisdictions" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "idx_jurisdictions_level" ON "jurisdictions" USING btree ("level");--> statement-breakpoint
CREATE INDEX "idx_jurisdictions_state" ON "jurisdictions" USING btree ("state_code");--> statement-breakpoint
CREATE INDEX "idx_legal_sources_organization" ON "legal_sources" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_legal_sources_jurisdiction" ON "legal_sources" USING btree ("jurisdiction_id");--> statement-breakpoint
CREATE INDEX "idx_legal_sources_type" ON "legal_sources" USING btree ("source_type_id");--> statement-breakpoint
CREATE INDEX "idx_legal_sources_bot" ON "legal_sources" USING btree ("bot_accessible");--> statement-breakpoint
CREATE INDEX "idx_consultations_organization" ON "review_source_consultations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_consultations_session" ON "review_source_consultations" USING btree ("analysis_session_id");--> statement-breakpoint
CREATE INDEX "idx_consultations_source" ON "review_source_consultations" USING btree ("legal_source_id");--> statement-breakpoint
CREATE INDEX "idx_content_cache_organization" ON "source_content_cache" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_content_cache_source" ON "source_content_cache" USING btree ("legal_source_id");--> statement-breakpoint
CREATE INDEX "idx_content_cache_current" ON "source_content_cache" USING btree ("is_current");--> statement-breakpoint
CREATE INDEX "idx_content_cache_effective" ON "source_content_cache" USING btree ("effective_date");--> statement-breakpoint
CREATE INDEX "idx_content_cache_obtained" ON "source_content_cache" USING btree ("obtained_at");--> statement-breakpoint
CREATE INDEX "idx_staleness_organization" ON "source_staleness_log" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_staleness_source" ON "source_staleness_log" USING btree ("legal_source_id");--> statement-breakpoint
CREATE INDEX "idx_staleness_date" ON "source_staleness_log" USING btree ("check_date");--> statement-breakpoint
CREATE INDEX "idx_statutory_amendment_organization" ON "statutory_amendment_records" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_statutory_amendment_session" ON "statutory_amendment_records" USING btree ("analysis_session_id");--> statement-breakpoint
CREATE INDEX "idx_statutory_amendment_jurisdiction" ON "statutory_amendment_records" USING btree ("jurisdiction_code");--> statement-breakpoint
CREATE INDEX "idx_statutory_amendment_impact" ON "statutory_amendment_records" USING btree ("impact_level");--> statement-breakpoint
ALTER TABLE "invitation_tokens" ADD CONSTRAINT "invitation_tokens_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;