import { NextRequest, NextResponse } from "next/server";
import { streamText, generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { getAnalysisProviderConfig } from "@/lib/llm/model-provider";
import {
  DEFAULT_WORKFLOW,
  getEnabledSteps,
  validateWorkflow,
  OFFENSIVE_ANALYSIS_PROMPT,
  type WorkflowConfig,
  type StepConfig,
} from "@/lib/workflow-config";
import {
  OFFENSE_WORKFLOW_CONFIG,
  OFFENSE_SYSTEM_PROMPT,
  getOffenseEnabledSteps,
  validateOffenseWorkflow,
} from "@/lib/offense-workflow-config";
import {
  DISCOVERY_DRAFTING_WORKFLOW_CONFIG,
  DISCOVERY_DRAFTING_SYSTEM_PROMPT,
  getDiscoveryDraftingEnabledSteps,
  validateDiscoveryDraftingWorkflow,
} from "@/lib/discovery-drafting-workflow-config";
import {
  isOutgoingDiscoveryDocument,
  identifyDiscoveryType,
} from "@/lib/discovery-document-detector";
import { detectDocumentOrigin } from "@/lib/document-origin-detector";
import {
  getOrganizationSettingsBySessionId,
  getGlobalTokenOverride,
} from "@/lib/settings-service";
import { identifyReportingSteps } from "@/lib/reporting-step-identifier";
import { getToolsByIds } from "@/lib/ai-tools";
import { VerificationEnforcer } from "@/lib/verification-enforcer";
import {
  StreamingExampleDetector,
  detectAllPieces,
  generateFallbackErrorMessage,
} from "@/lib/fallback-examples";
import { auth } from "@/auth";
import { db } from "@/db/client";
import {
  analysisSessions,
  documents,
  workflowConfigs,
  analysisSteps,
  continuationJobs,
} from "@/db/schema";
import { toolCallLogs } from "@/db/schema/tool-logs";
import { eq, asc, and } from "drizzle-orm";
import {
  acquireLock,
  releaseLock,
  renewLock,
  isLocked,
  cleanupStaleLocks,
  type WorkerType,
} from "@/lib/distributed-lock";
import {
  createContinuationJob,
  failContinuationJob,
} from "@/lib/continuation-jobs";
import {
  persistProposition,
  upsertCitation,
  updateCitationVerification,
  updateCitationUrl,
  persistVerificationAttempt,
  assignFootnoteNumber,
  persistContextualAnalysis,
  persistContextualQuotes,
  cacheAuthoritySource,
  assembleCitationIndexFromDB,
  generateQuoteHash,
  resolveCaseLawUrl,
  extractCourtListenerUrlsFromToolLogs,
  injectCitationMarkersFromToolLogs,
} from "@/lib/citation-persistence";
import type {
  PropositionAuthority,
  PropositionCitation,
  EnforcementResult,
} from "@/lib/verification-enforcer";
import {
  persistAnalysisStep,
  createStepSummary,
  type StepSummary,
} from "@/lib/analysis-steps-persistence";
import { stripToolCallXml } from "@/lib/text-sanitizer";
import {
  ENHANCED_CITATION_ENFORCEMENT_PROMPT,
  CASE_LAW_EXTRACTION_WORKFLOW_PROMPT,
} from "@/lib/citation-enforcement-enhanced";
import {
  AnalysisLogger,
  redactToolArgs,
  redactToolResult,
} from "@/lib/analysis-logger";
import { EnhancedAnalysisLogger } from "@/lib/logging/enhanced-logger";
import {
  getDebugConfig,
  checkPerformanceThreshold,
  PERFORMANCE_THRESHOLDS,
} from "@/lib/logging/config";
import { finalizeSession } from "@/lib/analysis-helpers/finalize-session";
import { logToolCall } from "@/lib/tool-call-logger";
import {
  logStepToolAvailability,
  updateStepToolUsageCount,
} from "@/lib/step-tool-logger";
import { triggerOrchestratorNow, getBaseUrl } from "@/lib/orchestrator-trigger";
import {
  STREAM_HEARTBEAT_INTERVAL_MS,
  STREAM_SOFT_TIMEOUT_MS,
  STALE_LOCK_THRESHOLD_MS,
  ANTHROPIC_CACHE_TTL_MS,
  PRE_STEP_MIN_WINDOW_MS,
  DEFAULT_CHUNK_TIME_BUDGET_MS,
} from "@/lib/time-budgets";
import { executePhaseBasedAnalysis } from "@/lib/phase-based-stream";
import {
  initializeSessionExpense,
  updateSessionExpenseTokens,
  completeSessionExpense,
} from "@/lib/expense-tracking";
import {
  executeIterativeStep,
  extractIterationItemsFromText,
  shouldAutoIterate,
} from "@/lib/iterative-step-executor";
import {
  checkStepApplicability,
  updateStepAttemptState,
  resetStepAttemptState,
  persistSkippedStep,
  advanceToNextStep,
  APPLICABILITY_CHECK_THRESHOLD,
} from "@/lib/step-applicability-check";
import { getModelMaxOutputTokens } from "@/lib/model-config";
import {
  isRateLimitOrOverloadError,
  calculateRateLimitDelay,
  sleepWithHeartbeat,
  hasTimeBudgetForRetry,
  formatRateLimitRetryMessage,
  DEFAULT_RATE_LIMIT_RETRY_CONFIG,
} from "@/lib/rate-limit-retry";
import {
  extractAllCitations,
  formatCitationListForPrompt,
  type CitationExtractionResult,
} from "@/lib/citation-extractor";
import { CourtListenerClient } from "@/lib/court-listener";

export const maxDuration = 800;
export const runtime = "nodejs";

function defer(promise: Promise<unknown>): void {
  promise.catch((error) => {
    console.error("[Defer] Background task failed:", error);
  });
}

/**
 * Handle OPTIONS preflight requests for CORS
 * This fixes the 405 Method Not Allowed error when the browser sends a preflight request
 */
export async function OPTIONS(
  req: NextRequest,
  segmentData: { params: Promise<{ id: string }> },
) {
  const origin = req.headers.get("origin");
  const allowedOrigins = [
    "https://legaldocreview.ai",
    "https://www.legaldocreview.ai",
    "https://v0-ai-legal-agent-21bljom63-juris-tech1.internal.app",
  ];

  const headers: Record<string, string> = {
    Allow: "POST, OPTIONS",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
  };

  // If origin is in allowed list, set CORS header
  if (origin && allowedOrigins.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return new NextResponse(null, { status: 200, headers });
}

/**
 * Persist citations from a completed step to the database
 * Orchestrates proposition persistence, citation upserts, verification attempts, and contextual analyses
 * If enforcementResult is provided, also updates verification status for each citation
 */
async function persistStepCitations(
  sessionId: unknown,
  organizationId: unknown,
  stepIndex: number,
  step: { id: string; name: string },
  stepText: string,
  enforcer: VerificationEnforcer,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  enforcementResult?: EnforcementResult | null,
): Promise<void> {
  const sessionIdText = String(sessionId ?? "");
  const organizationIdText = String(organizationId ?? "");
  console.log(
    `[CitationPersistence] Starting for session=${sessionIdText}, step=${stepIndex} (${step.name}), org=${organizationIdText}`,
  );
  console.log(
    `[CitationPersistence] Step text length: ${stepText.length} chars`,
  );

  const propositions = enforcer.extractPropositions(stepText);

  // DIAGNOSTIC B: Log tag detection results
  controller.enqueue(
    encoder.encode(
      `[DIAGNOSTIC] Extracted ${propositions.size} <Proposition> tags from step text\n`,
    ),
  );
  console.log(
    `[CitationPersistence] Found ${propositions.size} propositions in step ${stepIndex}`,
  );

  if (propositions.size === 0) {
    controller.enqueue(
      encoder.encode(
        `[DIAGNOSTIC] No <Proposition> tags found - skipping citation persistence\n`,
      ),
    );
    console.log(
      `[CitationPersistence] No propositions found - skipping persistence`,
    );
    return;
  }

  controller.enqueue(
    encoder.encode(`\n💾 Persisting ${propositions.size} propositions...\n`),
  );

  const propositionIdMap = new Map<string, string>();

  for (const [propId, propText] of propositions.entries()) {
    try {
      const dbPropositionId = await persistProposition(
        sessionIdText,
        organizationIdText,
        stepIndex,
        step.id,
        step.name,
        propText,
        propositionIdMap.size,
      );
      const normalizedPropId = propId.toLowerCase().trim();
      propositionIdMap.set(normalizedPropId, dbPropositionId);
      console.log(
        `[CitationPersistence] DIAGNOSTIC: Added to propositionIdMap: "${normalizedPropId}" -> "${dbPropositionId}"`,
      );
    } catch (error) {
      console.error(
        `[Citation Persistence] Failed to persist proposition ${propId}:`,
        error,
      );
    }
  }

  // DIAGNOSTIC: Log the complete propositionIdMap
  console.log(
    `[CitationPersistence] DIAGNOSTIC: propositionIdMap has ${propositionIdMap.size} entries:`,
    JSON.stringify(Array.from(propositionIdMap.entries())),
  );
  controller.enqueue(
    encoder.encode(
      `[DIAGNOSTIC] propositionIdMap keys: ${Array.from(propositionIdMap.keys()).join(", ")}\n`,
    ),
  );

  // DIAGNOSTIC: Check if CitationsJSON block exists in the text
  const hasCitationsJSONBlock = stepText.includes("<CitationsJSON>");
  const hasCitationsJSONEndBlock = stepText.includes("</CitationsJSON>");
  console.log(
    `[CitationPersistence] DIAGNOSTIC: stepText contains <CitationsJSON>: ${hasCitationsJSONBlock}, </CitationsJSON>: ${hasCitationsJSONEndBlock}`,
  );
  controller.enqueue(
    encoder.encode(
      `[DIAGNOSTIC] CitationsJSON block present: ${hasCitationsJSONBlock}, end tag: ${hasCitationsJSONEndBlock}\n`,
    ),
  );

  // Log a sample of the text around CitationsJSON if present
  if (hasCitationsJSONBlock) {
    const startIdx = stepText.indexOf("<CitationsJSON>");
    const sample = stepText.substring(startIdx, startIdx + 500);
    console.log(
      `[CitationPersistence] DIAGNOSTIC: CitationsJSON sample (first 500 chars): ${sample}`,
    );
  }

  const citations = enforcer.parseCitationsJSON(stepText);
  console.log(
    `[CitationPersistence] DIAGNOSTIC: parseCitationsJSON returned: ${citations ? citations.length + " citations" : "null"}`,
  );

  if (!citations || citations.length === 0) {
    controller.enqueue(
      encoder.encode(
        `[DIAGNOSTIC] No citations found in CitationsJSON - skipping citation persistence\n`,
      ),
    );
    console.error(
      `[CitationPersistence] CRITICAL: Found ${propositions.size} propositions but NO CitationsJSON block in step ${stepIndex}`,
    );
    console.error(
      `[CitationPersistence] This indicates the AI produced propositions without citations`,
    );
    return;
  }

  controller.enqueue(
    encoder.encode(
      `\n💾 Persisting citations for ${citations.length} propositions...\n`,
    ),
  );
  console.log(
    `[CitationPersistence] Found ${citations.length} citations to persist`,
  );

  const citationIdMap = new Map<string, string>();

  for (const citation of citations) {
    const normalizedCitationPropId = citation.proposition_id
      .toLowerCase()
      .trim();
    console.log(
      `[CitationPersistence] DIAGNOSTIC: Looking up proposition_id="${citation.proposition_id}" (normalized: "${normalizedCitationPropId}")`,
    );
    controller.enqueue(
      encoder.encode(
        `[DIAGNOSTIC] Looking up citation proposition_id="${citation.proposition_id}" (normalized: "${normalizedCitationPropId}")\n`,
      ),
    );
    const dbPropositionId = propositionIdMap.get(normalizedCitationPropId);
    if (!dbPropositionId) {
      console.warn(
        `[Citation Persistence] No DB proposition ID for ${citation.proposition_id} (normalized: ${normalizedCitationPropId})`,
      );
      console.warn(
        `[Citation Persistence] Available proposition IDs: ${Array.from(propositionIdMap.keys()).join(", ")}`,
      );
      controller.enqueue(
        encoder.encode(
          `[DIAGNOSTIC] FAILED: No DB proposition ID found for "${normalizedCitationPropId}". Available keys: ${Array.from(propositionIdMap.keys()).join(", ")}\n`,
        ),
      );
      continue;
    }
    controller.enqueue(
      encoder.encode(
        `[DIAGNOSTIC] SUCCESS: Found DB proposition ID "${dbPropositionId}" for "${normalizedCitationPropId}"\n`,
      ),
    );

    let authorityIndex = 0;
    for (const authority of citation.authorities) {
      try {
        // DIAGNOSTIC: Log authority details before persistence
        console.log(
          `[CitationPersistence] DIAGNOSTIC: Processing authority for ${citation.proposition_id}:`,
          JSON.stringify({
            type: authority.type,
            authority_type: authority.authority_type,
            citation: authority.citation?.substring(0, 50),
            url: authority.url?.substring(0, 80),
            hasQuote: !!authority.quote,
            hasNote: !!authority.note,
            quoteLength: authority.quote?.length || 0,
          }),
        );

        // Define internal reference types that don't require external URLs or quotes
        const internalReferenceTypes = [
          "observation",
          "analysis",
          "document_reference",
          "analytical_observation",
          "primary_document",
          "procedural_observation",
          "strategic_observation",
          "legal_principle",
        ];

        // Check if this is an internal reference type
        const isInternalReference =
          internalReferenceTypes.includes(authority.type) ||
          (authority.authority_type
            ? internalReferenceTypes.includes(authority.authority_type)
            : false);

        // Skip internal references that don't have a quote - they're observations, not citable authorities
        if (isInternalReference && !authority.quote) {
          console.log(
            `[CitationPersistence] SKIPPING internal reference without quote for ${citation.proposition_id}: type=${authority.type}, has note=${!!authority.note}`,
          );
          continue;
        }

        // For external authorities, require quote
        if (!authority.quote) {
          console.warn(
            `[CitationPersistence] SKIPPING authority without quote for ${citation.proposition_id}: type=${authority.type}, citation=${authority.citation?.substring(0, 50)}`,
          );
          continue;
        }

        // CRITICAL FIX: For case law authorities, perform server-side CourtListener resolution
        // This removes AI from URL generation entirely - the backend searches CourtListener
        // using the citation text and matches the response's caseName to find the correct URL
        const resolvedUrl = await resolveCaseLawUrl(authority);
        if (authority.authority_type === "case_law" && !resolvedUrl) {
          // Case law could not be resolved via CourtListener - skip this citation and emit diagnostic
          controller.enqueue(
            encoder.encode(
              `[DIAGNOSTIC] SKIPPED case law citation - could not resolve CourtListener URL for "${authority.citation}" (proposition ${citation.proposition_id})\n`,
            ),
          );
          continue;
        }
        // Create authority object with resolved URL for persistence (avoid mutating original)
        // Also store opinionId and confidence in metadata for future reference
        const authorityForPersistence = resolvedUrl
          ? {
              ...authority,
              url: resolvedUrl.url,
              metadata: {
                ...(authority.metadata as unknown as Record<string, unknown>),
                opinionId: resolvedUrl.opinionId,
                resolvedCaseName: resolvedUrl.resolvedCaseName,
                resolutionConfidence: resolvedUrl.confidence,
              },
            }
          : authority;

        const verifier = enforcer["verifier"] as
          | { normalizeText?: (text: string) => string }
          | undefined;
        const normalizedQuote = verifier?.normalizeText
          ? verifier.normalizeText(authority.quote)
          : authority.quote.toLowerCase().replace(/\s+/g, " ").trim();
        const quoteHash = generateQuoteHash(normalizedQuote);

        console.log(
          `[CitationPersistence] DIAGNOSTIC: Calling upsertCitation with propositionId=${dbPropositionId}, url=${authorityForPersistence.url?.substring(0, 50)}`,
        );

        const citationId = await upsertCitation(
          sessionIdText,
          organizationIdText,
          dbPropositionId,
          authorityForPersistence,
          normalizedQuote,
          quoteHash,
          undefined,
        );

        console.log(
          `[CitationPersistence] DIAGNOSTIC: upsertCitation returned citationId=${citationId}`,
        );
        controller.enqueue(
          encoder.encode(
            `[DIAGNOSTIC] upsertCitation SUCCESS: citationId=${citationId} for proposition ${citation.proposition_id}\n`,
          ),
        );

        const citationKey = `${authorityForPersistence.citation}|${authorityForPersistence.url}|${quoteHash}`;
        citationIdMap.set(citationKey, citationId);

        const color = enforcer.assignColor();
        await assignFootnoteNumber(
          sessionIdText,
          organizationIdText,
          dbPropositionId,
          citationId,
          color,
        );

        console.log(
          `[CitationPersistence] SUCCESS: Persisted citation ${citationId} for proposition ${citation.proposition_id}`,
        );
        controller.enqueue(
          encoder.encode(
            `[DIAGNOSTIC] CITATION PERSISTED: ${authority.citation?.substring(0, 50)}... -> DB ID: ${citationId}\n`,
          ),
        );

        // Update verification status if enforcementResult is provided
        // IMPORTANT: Only look up verification data for legal_authority types because
        // the verification loop in enforceVerification() only processes legal_authority types.
        // Non-legal authorities are skipped in verification, so their indices don't exist in verificationDetails.

        // DIAGNOSTIC: Log verification lookup attempt
        console.log(
          `[CitationPersistence] DIAGNOSTIC: Verification lookup for citation ${citationId}:`,
          {
            hasEnforcementResult: !!enforcementResult,
            hasVerificationDetails: !!enforcementResult?.verificationDetails,
            verificationDetailsSize:
              enforcementResult?.verificationDetails?.size,
            authorityType: authority.type,
            propositionId: citation.proposition_id,
            authorityIndex,
            willAttemptLookup: !!(
              enforcementResult?.verificationDetails &&
              authority.type === "legal_authority"
            ),
          },
        );
        controller.enqueue(
          encoder.encode(
            `[DIAGNOSTIC] Verification lookup: hasEnforcementResult=${!!enforcementResult}, hasVerificationDetails=${!!enforcementResult?.verificationDetails}, size=${enforcementResult?.verificationDetails?.size || 0}, type=${authority.type}, propId=${citation.proposition_id}, authIdx=${authorityIndex}\n`,
          ),
        );

        if (
          enforcementResult?.verificationDetails &&
          authority.type === "legal_authority"
        ) {
          const verificationDetails = enforcementResult.verificationDetails.get(
            citation.proposition_id,
          );

          // DIAGNOSTIC: Log what we found in the map
          console.log(
            `[CitationPersistence] DIAGNOSTIC: verificationDetails.get(${citation.proposition_id}):`,
            {
              found: !!verificationDetails,
              length: verificationDetails?.length,
              authorityIndex,
              dataAtIndex: verificationDetails?.[authorityIndex],
            },
          );

          const verificationData = verificationDetails?.[authorityIndex];
          if (verificationData) {
            console.log(
              `[CitationPersistence] Updating verification for citation ${citationId}: verified=${verificationData.verified}, AN=${verificationData.alphanumericPercent}, PS=${verificationData.punctuationSpacePercent}, AI=${verificationData.aiVerification}`,
            );
            await updateCitationVerification(
              citationId,
              verificationData.verified,
              verificationData.confidenceScore,
              verificationData.fallbackFlag,
              0, // retryCount
              verificationData.note,
              verificationData.alphanumericPercent,
              verificationData.punctuationSpacePercent,
              verificationData.aiVerification,
            );

            // If URL case verification found a corrected URL, persist it to the database
            if (verificationData.correctedUrl) {
              console.log(
                `[CitationPersistence] 🔄 Persisting corrected URL for citation ${citationId}: ${verificationData.correctedUrl}`,
              );
              await updateCitationUrl(
                citationId,
                verificationData.correctedUrl,
              );
              controller.enqueue(
                encoder.encode(
                  `[DIAGNOSTIC] URL CORRECTED: citationId=${citationId}, newUrl=${verificationData.correctedUrl}\n`,
                ),
              );
            }

            controller.enqueue(
              encoder.encode(
                `[DIAGNOSTIC] VERIFICATION UPDATED: citationId=${citationId}, verified=${verificationData.verified}, AN=${verificationData.alphanumericPercent?.toFixed(1)}%, PS=${verificationData.punctuationSpacePercent?.toFixed(1)}%, AI=${verificationData.aiVerification}\n`,
              ),
            );
          } else {
            console.log(
              `[CitationPersistence] No verification data found for citation ${citationId} (proposition=${citation.proposition_id}, authorityIndex=${authorityIndex})`,
            );
          }
          // Only increment authorityIndex for legal_authority types to match the verification loop
          authorityIndex++;
        }
      } catch (error) {
        console.error(
          `[Citation Persistence] FAILED to persist citation for ${citation.proposition_id}:`,
          error,
        );
        // Log the full error stack trace
        if (error instanceof Error) {
          console.error(`[Citation Persistence] Error stack:`, error.stack);
        }
        controller.enqueue(
          encoder.encode(
            `[DIAGNOSTIC] ERROR persisting citation for ${citation.proposition_id}: ${error instanceof Error ? error.message : String(error)}\n`,
          ),
        );
      }
    }
  }

  const contextualAnalyses = enforcer.parseContextJSON(stepText);
  console.log(
    `[CitationPersistence] Found ${contextualAnalyses?.length || 0} contextual analyses`,
  );

  if (contextualAnalyses && contextualAnalyses.length > 0) {
    controller.enqueue(
      encoder.encode(
        `\n💾 Persisting ${contextualAnalyses.length} contextual analyses...\n`,
      ),
    );

    for (const context of contextualAnalyses) {
      try {
        const matchingCitation = citations
          .flatMap((c) => c.authorities)
          .find((a) => a.citation === context.authority_citation);

        if (!matchingCitation) {
          console.warn(
            `[Citation Persistence] No matching citation for contextual analysis: ${context.authority_citation}`,
          );
          continue;
        }

        const verifier = enforcer["verifier"] as
          | { normalizeText?: (text: string) => string }
          | undefined;
        const normalizedQuote = verifier?.normalizeText
          ? verifier.normalizeText(matchingCitation.quote)
          : matchingCitation.quote.toLowerCase().replace(/\s+/g, " ").trim();
        const quoteHash = generateQuoteHash(normalizedQuote);
        const citationKey = `${matchingCitation.citation}|${matchingCitation.url}|${quoteHash}`;
        const citationId = citationIdMap.get(citationKey);

        if (!citationId) {
          console.warn(
            `[Citation Persistence] No citation ID for contextual analysis: ${context.authority_citation}`,
          );
          continue;
        }

        const contextualAnalysisId = await persistContextualAnalysis(
          citationId,
          organizationIdText,
          context,
        );

        const normalizeTextFn = verifier?.normalizeText
          ? verifier.normalizeText.bind(verifier)
          : (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();

        await persistContextualQuotes(
          contextualAnalysisId,
          organizationIdText,
          "preceding",
          context.preceding_context.quotes,
          normalizeTextFn,
        );

        await persistContextualQuotes(
          contextualAnalysisId,
          organizationIdText,
          "subsequent",
          context.subsequent_development.quotes,
          normalizeTextFn,
        );

        await persistContextualQuotes(
          contextualAnalysisId,
          organizationIdText,
          "qualifications",
          context.qualifications_limitations.quotes,
          normalizeTextFn,
        );
      } catch (error) {
        console.error(
          `[Citation Persistence] Failed to persist contextual analysis:`,
          error,
        );
      }
    }
  }

  controller.enqueue(encoder.encode(`\n✅ Citation persistence complete\n`));
  console.log(
    `[CitationPersistence] Complete for session=${sessionId}, step=${stepIndex}: ${propositions.size} propositions, ${citations?.length || 0} citations, ${contextualAnalyses?.length || 0} contextual analyses`,
  );
}

const SYSTEM_PROMPT = `You are an expert legal analyst with deep knowledge of law, legal reasoning, and document analysis. Your role is to provide thorough, accurate, and insightful analysis of legal documents.

Key principles:
1. Be thorough and precise in your analysis
2. Use tools extensively to verify facts and citations
3. Cite legal authorities when making legal arguments
4. Consider multiple perspectives and potential counterarguments
5. Provide actionable insights and recommendations
6. Never use placeholder text or examples - always provide real analysis
7. If you don't have enough information, explicitly state what's missing

CRITICAL TOOL USAGE FOR LEGAL RESEARCH:
- **For case law, court opinions, and legal precedents**: ALWAYS use the courtlistener-search tool. CourtListener is the authoritative database for case law research and should be your PRIMARY tool for finding cases, opinions, and legal precedents.
- **For general web searches, news, and non-case-law research**: Use tavily-search for current events, news articles, general legal information, and web content that is NOT case law.
- **For statutes and regulations**: Use statute-lookup for KSA, USC, CFR, and other statutory/regulatory citations.
- **For court rules**: Use kansas-rules or federal-kansas-rules for procedural rules.

When you need to find supporting case law or verify legal precedents, you MUST use courtlistener-search, not tavily-search. Tavily is for web content; CourtListener is for case law.

When analyzing documents:
- Focus on the subject document as the primary document
- Use context documents to understand background and relationships, but do NOT treat their citations as part of your analysis scope
- When verifying or flagging citations, only analyze citations that appear in the subject document
- Do NOT presume context documents are legally accurate — they may contain errors, misstatements of law, or incomplete analysis. Your review must be independent and rigorous regardless of any conclusions in context documents
- Pay attention to dates, parties, and key terms
- Identify potential issues, risks, and opportunities
- Provide clear, well-structured analysis

CRITICAL CITATION REQUIREMENTS:
When interpreting any legal matter (whether purely legal questions, blending of law and fact, or factual issues), you MUST:

1. **Wrap each analyzable claim with Proposition markers**:
   - Use explicit XML markers: <Proposition id="P1">Your claim here</Proposition>
   - Number propositions sequentially starting from P1 (never restart numbering)
   - Each proposition represents a statement that requires supporting authorities

2. **Provide exact quotes from authoritative sources**:
   - Every legal interpretation must be supported by exact quotes (word-for-word)
   - Include formal legal citation (e.g., "Smith v. Jones, 123 F.3d 456 (10th Cir. 2020)")
   - Include direct URL to the authoritative source

3. **Emit structured CitationsJSON block**:
   After your narrative analysis, you MUST emit a <CitationsJSON> block mapping each proposition to its supporting authorities:
   
   <CitationsJSON>
   [
     {
       "proposition_id": "P1",
       "authorities": [
         {
           "type": "legal_authority",
           "authority_type": "case_law",
           "citation": "Smith v. Jones, 123 F.3d 456 (10th Cir. 2020)",
           "quote": "The exact quote from the case",
           "url": "https://www.courtlistener.com/opinion/..."
         }
       ]
     }
   ]
   </CitationsJSON>

4. **CONTEXTUAL VERIFICATION - Read entire documents before citing**:
   For EACH authority you cite, you MUST provide contextual analysis to prevent out-of-context citations.
   
   After CitationsJSON, emit a <ContextJSON> block with contextual analysis for each authority:
   
   <ContextJSON>
   [
     {
       "authority_citation": "Smith v. Jones, 123 F.3d 456 (10th Cir. 2020)",
       "authority_type": "legal_authority",
       "preceding_context": {
         "summary": "2-3 sentences explaining what led to this statement in the document",
         "quotes": ["Exact quote from preceding passage", "Another preceding quote if relevant"]
       },
       "statement_function": "holding|reasoning|dicta|description_of_other_case|hypothetical",
       "subsequent_development": {
         "summary": "2-3 sentences explaining how the authority develops this point afterward",
         "quotes": ["Exact quote from subsequent passage", "Another subsequent quote if relevant"]
       },
       "qualifications_limitations": {
         "summary": "Any conditions, exceptions, or limiting language",
         "quotes": ["Exact quote showing qualification or limitation"]
       },
       "alignment_verification": "Confirmation that this statement aligns with the authority's ultimate conclusion"
     }
   ]
   </ContextJSON>

5. **Verification requirements**:
   - Use authority-quote-verification tool to verify ALL quotes (primary AND contextual)
   - Every quote in ContextJSON must be verified just like primary quotes
   - If source is a scanned PDF or non-searchable document, the tool will return fallback_flag

6. **Multiple citations per proposition**:
   - A single proposition may require multiple supporting authorities
   - When combining logic from multiple sources, include all authorities in the authorities array
   - Each authority must have its own quote, citation, URL, and contextual analysis`;

async function authenticateRequest(req: NextRequest) {
  let authenticatedUserId: number | null = null;
  let isTestingAuth = false;

  // Check for bypass header/param first (for internal orchestrator calls)
  const bypassHeader = req.headers.get("x-internal-api-token");
  const bypassQuery = new URL(req.url).searchParams.get(
    "x-internal-api-token",
  );

  if (
    (bypassHeader &&
      bypassHeader === process.env.INTERNAL_API_TOKEN) ||
    (bypassQuery && bypassQuery === process.env.INTERNAL_API_TOKEN)
  ) {
    console.log(
      "[Analysis Stream] Authenticated via bypass secret for orchestrator",
    );
    isTestingAuth = true;
    authenticatedUserId = null;
    return { authenticatedUserId, isTestingAuth };
  }

  const authHeader = req.headers.get("authorization");
  const host = req.headers.get("host") || "";

  // Recognize allowed deployment domains for token-based authentication
  const isAllowedDomain =
    host.endsWith(".internal.app") ||
    host === "legaldocreview.ai" ||
    host === "www.legaldocreview.ai";

  if (authHeader && isAllowedDomain) {
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (process.env.INTERNAL_API_TOKEN && token === process.env.INTERNAL_API_TOKEN) {
      console.log(
        `[Analysis Stream] Authenticated via INTERNAL_API_TOKEN for testing on host ${host}`,
      );
      isTestingAuth = true;
      authenticatedUserId = null;
    }
  }

  if (!isTestingAuth) {
    const session = await auth();
    if (!session?.user?.id) {
      console.log("[Analysis Stream] Unauthorized - no user session");
      return {
        error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      };
    }
    authenticatedUserId = Number(session.user.id);
    console.log(`[Analysis Stream] Authenticated user: ${authenticatedUserId}`);
  }

  return { authenticatedUserId, isTestingAuth };
}

async function getAnalysisSessionById(sessionId: string) {
  const analysisSession = await db.query.analysisSessions.findFirst({
    where: eq(analysisSessions.id, Number(sessionId)),
  });
  if (!analysisSession) {
    console.log(`[Analysis Stream] Session not found in DB: ${sessionId}`);
    return {
      error: NextResponse.json({ error: "Session not found" }, { status: 404 }),
    };
  }
  console.log(
    `[Analysis Stream] Found session, owner: ${analysisSession.userId}, status: ${analysisSession.status}, isResuming: ${analysisSession.isResuming}`,
  );
  return { analysisSession };
}

async function handleResumingLock(sessionId: string, analysisSession: unknown) {
  // Check if session is currently locked using distributed lock system
  const lockStatus = await isLocked(sessionId);

  if (lockStatus.locked) {
    // Before returning 409, check if the lock is stale (valid but no recent activity)
    // This catches workers that crashed without releasing their lock
    const staleResult = await cleanupStaleLocks(sessionId);

    if (staleResult.wasStale && staleResult.cleaned > 0) {
      console.log(
        `[Analysis Stream] Session ${sessionId} had stale lock (no activity for ${Math.round((staleResult.staleDurationMs || 0) / 1000)}s) - cleaned and allowing retry`,
      );
      // Lock was stale and has been cleaned - allow processing to continue
      return {};
    }

    console.log(
      `[Analysis Stream] Session ${sessionId} is locked by worker ${lockStatus.lock.workerType} (${lockStatus.lock.lockId}), retry in ${lockStatus.retryAfter}s`,
    );
    return {
      error: NextResponse.json(
        {
          error: "Analysis is currently being processed",
          retryAfter: lockStatus.retryAfter,
          lockedBy: lockStatus.lock.workerType,
        },
        { status: 409 },
      ),
    };
  }

  return {};
}

function authorizeSessionAccess(
  analysisSession: { userId: number; id: number },
  authenticatedUserId: number | null,
  isTestingAuth: boolean,
) {
  if (!isTestingAuth && analysisSession.userId !== authenticatedUserId) {
    console.log(
      `[Analysis Stream] Unauthorized - user ${authenticatedUserId} does not own session ${analysisSession.id}`,
    );
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 403 }),
    };
  }
  return {};
}

async function getSessionDocumentList(sessionId: string) {
  const sessionDocuments = await db.query.documents.findMany({
    where: eq(documents.analysisSessionId, Number(sessionId)),
  });
  if (!sessionDocuments || sessionDocuments.length === 0) {
    console.log(
      `[Analysis Stream] No documents found for session: ${sessionId}`,
    );
    return {
      error: NextResponse.json(
        { error: "No documents found for this session" },
        { status: 404 },
      ),
    };
  }
  return { sessionDocuments };
}

export async function POST(
  req: NextRequest,
  segmentData: { params: Promise<{ id: string }> },
) {
  // DIAGNOSTIC: Track time from POST handler start
  const postHandlerStartTime = Date.now();
  let lockId: string | undefined;
  let sessionId: string | undefined;

  try {
    const params = await segmentData.params;
    sessionId = params.id;

    // Check if this stream is invoked by resume-chunk (to prevent orchestrator loop)
    const invokedBy = req.headers.get("X-Invoked-By");
    const isInvokedByResumeChunk = invokedBy === "resume-chunk";

    console.log(
      `[Analysis Stream] Starting stream for session: ${sessionId}${
        isInvokedByResumeChunk ? " (invoked by resume-chunk)" : ""
      }`,
    );

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: "API key missing" }, { status: 500 });
    }

    const authResult = await authenticateRequest(req);
    if (authResult.error) return authResult.error;
    const { authenticatedUserId, isTestingAuth } = authResult;

    const sessionResult = await getAnalysisSessionById(sessionId);
    if (sessionResult.error) return sessionResult.error;
    const analysisSession = sessionResult.analysisSession;

    const resumeResult = await handleResumingLock(sessionId, analysisSession);
    if (resumeResult.error) return resumeResult.error;

    const authzResult = authorizeSessionAccess(
      analysisSession,
      authenticatedUserId,
      isTestingAuth,
    );
    if (authzResult.error) return authzResult.error;

    const docsResult = await getSessionDocumentList(sessionId);
    if (docsResult.error) return docsResult.error;
    const sessionDocuments = docsResult.sessionDocuments;

    console.log(
      `[Analysis Stream] Found ${sessionDocuments.length} documents, starting analysis...`,
    );

    // Acquire distributed lock BEFORE processing
    const workerType: WorkerType = isTestingAuth ? "test" : "api";
    const lockResult = await acquireLock({
      sessionId: sessionId,
      workerType: workerType,
      workerPid: `stream-${Date.now()}`,
      lockPurpose: "chunk_processing",
      metadata: {
        currentStep: analysisSession.currentStep,
        continuationCount: analysisSession.continuationCount,
      },
    });

    if (!lockResult.success) {
      console.log(
        `[Analysis Stream] Failed to acquire lock: ${lockResult.error}`,
      );
      return NextResponse.json(
        {
          error: lockResult.error,
          retryAfter: lockResult.retryAfter,
        },
        { status: 409 },
      );
    }

    lockId = lockResult.lockId!;
    console.log(
      `[Analysis Stream] Acquired lock ${lockId} for session ${sessionId}`,
    );

    await db
      .update(analysisSessions)
      .set({
        status: "processing",
        updatedAt: new Date(),
      })
      .where(eq(analysisSessions.id, Number(sessionId)));

    const providerConfig = await getAnalysisProviderConfig();
    const anthropic =
      providerConfig.fireworksProvider ||
      providerConfig.anthropicProvider ||
      createAnthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });
    const isAnthropic = providerConfig.isAnthropic;
    console.log(
      `[Analysis Stream] Provider: ${providerConfig.providerType}, Model: ${providerConfig.modelName}, isAnthropic: ${isAnthropic}`,
    );

    const existingMetadata = (analysisSession.metadata ?? {}) as Record<
      string,
      unknown
    >;
    let steps: StepConfig[];
    let workflowSource: string;
    let workflow: WorkflowConfig = DEFAULT_WORKFLOW;

    // Determine offense mode early to select the correct workflow
    let documentOrigin =
      (analysisSession as { documentOrigin?: string }).documentOrigin ||
      "unknown";

    // Server-side document origin detection fallback
    // If documentOrigin is still "unknown", try to detect it from available context
    if (documentOrigin === "unknown") {
      const sessionWithContext = analysisSession as {
        ourClients?: string[];
        opposingParties?: string[];
        lawFirmNameOverride?: string | null;
        documentAuthorNameOverride?: string | null;
        documentType?: string | null;
      };

      // Only attempt detection if we have enough context
      if (
        (sessionWithContext.ourClients?.length ?? 0) > 0 ||
        (sessionWithContext.opposingParties?.length ?? 0) > 0
      ) {
        const detectedOrigin = detectDocumentOrigin({
          lawFirmName: sessionWithContext.lawFirmNameOverride || "",
          ourClients: sessionWithContext.ourClients || [],
          opposingParties: sessionWithContext.opposingParties || [],
          documentType: sessionWithContext.documentType || undefined,
          documentAuthor:
            sessionWithContext.documentAuthorNameOverride || undefined,
          lawFirmNameOverride:
            sessionWithContext.lawFirmNameOverride || undefined,
        });

        if (detectedOrigin !== "unknown") {
          documentOrigin = detectedOrigin;
          console.log(
            `[Analysis Stream] Server-side document origin detection: ${detectedOrigin} for session ${sessionId}`,
          );

          // Persist the detected origin to the database for future reference
          await db
            .update(analysisSessions)
            .set({
              documentOrigin: detectedOrigin,
              updatedAt: new Date(),
            })
            .where(eq(analysisSessions.id, Number(sessionId)));
        }
      }
    }

    const isOffensiveMode = documentOrigin === "opposing";

    // Discovery Drafting Mode: Triggered when document is from our firm AND is outgoing discovery
    // This takes priority over offense mode since it's a more specific condition
    const documentType = analysisSession.documentType || "";
    const isDiscoveryDraftingMode =
      documentOrigin === "our_firm" &&
      isOutgoingDiscoveryDocument(documentType);

    if (isDiscoveryDraftingMode) {
      const discoveryType = identifyDiscoveryType(documentType);
      console.log(
        `[Analysis Stream] DISCOVERY DRAFTING MODE detected: documentOrigin=${documentOrigin}, documentType=${documentType}, discoveryType=${discoveryType}`,
      );
    }

    if (existingMetadata.workflowSnapshot) {
      steps = existingMetadata.workflowSnapshot as StepConfig[];
      workflowSource =
        (existingMetadata.workflowSource as string) || "SNAPSHOT";
      // Reconstruct workflow from snapshot for identifyReportingSteps
      workflow = isDiscoveryDraftingMode
        ? { ...DISCOVERY_DRAFTING_WORKFLOW_CONFIG, steps }
        : isOffensiveMode
          ? { ...OFFENSE_WORKFLOW_CONFIG, steps }
          : { ...DEFAULT_WORKFLOW, steps };
      console.log(
        `[Analysis Stream] Using persisted workflow snapshot: ${steps.length} steps (source: ${workflowSource})`,
      );

      // SAFEGUARD: Reconcile totalSteps with snapshot length if mismatched.
      // This fixes sessions that were created with incorrect totalSteps,
      // preventing them from getting stuck at 100% progress.
      const storedTotalSteps = analysisSession.totalSteps || 0;
      if (steps.length === 0 && storedTotalSteps > 0) {
        // Edge case: snapshot is empty but totalSteps is set - this is data corruption
        // Mark the session as error since we cannot proceed without a valid workflow
        console.error(
          `[Analysis Stream] CRITICAL: Workflow snapshot is empty but storedTotalSteps=${storedTotalSteps}. ` +
            `This indicates data corruption. Marking session ${sessionId} as error.`,
        );
        try {
          await db
            .update(analysisSessions)
            .set({
              status: "error",
              updatedAt: new Date(),
              metadata: {
                ...existingMetadata,
                lastError: {
                  errorMessage: "Workflow snapshot is empty but totalSteps is set - data corruption detected",
                  source: "stream_reconciliation",
                  timestamp: new Date().toISOString(),
                  storedTotalSteps,
                  snapshotLength: 0,
                },
              },
            })
            .where(eq(analysisSessions.id, Number(sessionId)));
        } catch (errorUpdateErr) {
          console.error(
            `[Analysis Stream] Failed to mark session as error:`,
            errorUpdateErr,
          );
        }
        // Return an error response to stop processing
        return NextResponse.json(
          {
            error: "Workflow snapshot is empty - data corruption detected",
            sessionId,
          },
          { status: 500 },
        );
      } else if (steps.length !== storedTotalSteps && steps.length > 0) {
        console.warn(
          `[Analysis Stream] totalSteps mismatch: stored=${storedTotalSteps}, snapshot=${steps.length}. Updating totalSteps.`,
        );
        try {
          await db
            .update(analysisSessions)
            .set({
              totalSteps: steps.length,
              updatedAt: new Date(),
              metadata: {
                ...existingMetadata,
                totalStepsReconciled: {
                  timestamp: new Date().toISOString(),
                  previousTotalSteps: storedTotalSteps,
                  newTotalSteps: steps.length,
                  reason: "Reconciled with workflow snapshot length",
                },
              },
            })
            .where(eq(analysisSessions.id, Number(sessionId)));
          console.log(
            `[Analysis Stream] Updated totalSteps from ${storedTotalSteps} to ${steps.length}`,
          );
        } catch (reconcileErr) {
          console.error(
            `[Analysis Stream] Failed to reconcile totalSteps:`,
            reconcileErr,
          );
        }
      }
    } else if (isDiscoveryDraftingMode) {
      // DISCOVERY DRAFTING MODE: Use the dedicated 21-step discovery drafting workflow
      // This takes priority over offense mode since it's a more specific condition
      const discoveryValidation = validateDiscoveryDraftingWorkflow(
        DISCOVERY_DRAFTING_WORKFLOW_CONFIG,
      );
      if (discoveryValidation.valid) {
        workflow = DISCOVERY_DRAFTING_WORKFLOW_CONFIG;
        workflowSource = `DISCOVERY_DRAFTING_WORKFLOW v${DISCOVERY_DRAFTING_WORKFLOW_CONFIG.version}`;
        steps = structuredClone(getDiscoveryDraftingEnabledSteps(workflow));
        console.log(
          `[Analysis Stream] DISCOVERY DRAFTING MODE: Using dedicated discovery drafting workflow (${steps.length} steps) for session ${sessionId}`,
        );
      } else {
        console.error(
          `[Analysis Stream] DISCOVERY DRAFTING MODE: Discovery drafting workflow validation failed, falling back to DEFAULT_WORKFLOW. Errors:`,
          discoveryValidation.errors,
        );
        workflowSource = "DEFAULT_WORKFLOW (discovery drafting fallback)";
        steps = structuredClone(getEnabledSteps(DEFAULT_WORKFLOW));
      }
    } else if (isOffensiveMode) {
      // OFFENSE MODE: Use the dedicated 50-step offense workflow
      const offenseValidation = validateOffenseWorkflow(
        OFFENSE_WORKFLOW_CONFIG,
      );
      if (offenseValidation.valid) {
        workflow = OFFENSE_WORKFLOW_CONFIG;
        workflowSource = `OFFENSE_WORKFLOW v${OFFENSE_WORKFLOW_CONFIG.version}`;
        steps = structuredClone(getOffenseEnabledSteps(workflow));
        console.log(
          `[Analysis Stream] OFFENSE MODE: Using dedicated offense workflow (${steps.length} steps) for session ${sessionId}`,
        );
      } else {
        console.error(
          `[Analysis Stream] OFFENSE MODE: Offense workflow validation failed, falling back to DEFAULT_WORKFLOW with offensive prompt. Errors:`,
          offenseValidation.errors,
        );
        workflowSource = "DEFAULT_WORKFLOW (offense fallback)";
        steps = structuredClone(getEnabledSteps(DEFAULT_WORKFLOW));
      }
    } else {
      workflowSource = "DEFAULT_WORKFLOW";
      try {
        const activeConfig = await db
          .select()
          .from(workflowConfigs)
          .where(
            and(
              eq(
                workflowConfigs.organizationId,
                analysisSession.organizationId,
              ),
              eq(workflowConfigs.isActive, true),
            ),
          )
          .limit(1);

        if (activeConfig.length > 0 && activeConfig[0].config) {
          const validation = validateWorkflow(
            activeConfig[0].config as WorkflowConfig,
          );
          if (validation.valid) {
            workflow = activeConfig[0].config as WorkflowConfig;
            workflowSource = `DATABASE: ${activeConfig[0].name}`;
            console.log(
              `[Analysis Stream] Using active workflow config for org ${analysisSession.organizationId}: ${activeConfig[0].name}`,
            );
          } else {
            console.warn(
              `[Analysis Stream] Active workflow config is invalid, using DEFAULT_WORKFLOW. Errors:`,
              validation.errors,
            );
          }
        } else {
          console.log(
            `[Analysis Stream] No active workflow config found for org ${analysisSession.organizationId}, using DEFAULT_WORKFLOW`,
          );
        }
      } catch (error) {
        console.error(
          `[Analysis Stream] Error loading workflow config, using DEFAULT_WORKFLOW:`,
          error,
        );
      }

      steps = structuredClone(getEnabledSteps(workflow));
    }

    console.log(
      `[Analysis Stream] DIAGNOSTIC C - Workflow source: ${workflowSource}, Total steps: ${steps.length}`,
    );

    // DIAGNOSTIC: Log verification settings for first 5 steps to understand if they have verificationSettings
    console.log(
      `[Analysis Stream] DIAGNOSTIC D - First 5 steps verification settings:`,
      steps.slice(0, 5).map((s, idx) => ({
        index: idx,
        id: s.id,
        name: s.name,
        hasVerificationSettings: !!s.verificationSettings,
        verificationSettingsKeys: s.verificationSettings
          ? Object.keys(s.verificationSettings)
          : [],
        legalAuthorityEnabled:
          s.verificationSettings?.legalAuthorityVerification?.enabled,
      })),
    );

    const persistedOrigin = existingMetadata.origin;
    const sessionOrigin = persistedOrigin || (isTestingAuth ? "testing" : "ui");

    if (!persistedOrigin) {
      await db
        .update(analysisSessions)
        .set({
          metadata: {
            ...existingMetadata,
            origin: sessionOrigin,
          },
          updatedAt: new Date(),
        })
        .where(eq(analysisSessions.id, Number(sessionId)));
      console.log(
        `[Analysis Stream] Backfilled origin for legacy session: origin=${sessionOrigin} (auth: ${isTestingAuth ? "testing" : "ui"})`,
      );
    }

    if ((analysisSession.currentStep || 0) === 0 && steps.length > 0) {
      const finalStep = steps[steps.length - 1];

      // Identify reporting steps dynamically based on category and reportingRole
      // Pass isOffenseMode and isDiscoveryDraftingMode to enable mode-specific step detection
      const reportingIds = identifyReportingSteps(
        workflow,
        isOffensiveMode,
        isDiscoveryDraftingMode,
      );

      // Determine workflow type for metadata tracking
      const workflowType = isDiscoveryDraftingMode
        ? "discovery-drafting"
        : isOffensiveMode
          ? "offense"
          : "qa";

      await db
        .update(analysisSessions)
        .set({
          metadata: {
            ...existingMetadata,
            workflowSnapshot: steps,
            finalStepId: finalStep.id,
            finalStepName: finalStep.name,
            finalStepOrder: finalStep.order,
            workflowSource,
            origin: sessionOrigin,
            // Track workflow type for all modes
            workflowType,
            offenseWorkflowVersion: isOffensiveMode
              ? OFFENSE_WORKFLOW_CONFIG.version
              : null,
            discoveryDraftingWorkflowVersion: isDiscoveryDraftingMode
              ? DISCOVERY_DRAFTING_WORKFLOW_CONFIG.version
              : null,
            // Store discovery type if in discovery drafting mode
            discoveryType: isDiscoveryDraftingMode
              ? identifyDiscoveryType(documentType)
              : null,
            // Store reporting step identification for dynamic report generation
            executiveSummaryStepId: reportingIds.executiveSummaryStepId,
            executiveSummaryStepIndex: reportingIds.executiveSummaryStepIndex,
            paralegalChecklistStepId: reportingIds.paralegalChecklistStepId,
            paralegalChecklistStepIndex:
              reportingIds.paralegalChecklistStepIndex,
            qualityGateStepId: reportingIds.qualityGateStepId,
            qualityGateStepIndex: reportingIds.qualityGateStepIndex,
            lessonsLearnedStepId: reportingIds.lessonsLearnedStepId,
            lessonsLearnedStepIndex: reportingIds.lessonsLearnedStepIndex,
            reportingStepIds: reportingIds.allReportingStepIds,
          },
          totalSteps: steps.length,
          updatedAt: new Date(),
        })
        .where(eq(analysisSessions.id, Number(sessionId)));
      console.log(
        `[Analysis Stream] Stored workflow snapshot and finalization contract: ${steps.length} steps, finalStepId=${finalStep.id}, finalStepName=${finalStep.name}, order=${finalStep.order}, origin=${sessionOrigin}, workflowType=${workflowType}`,
      );
      console.log(
        `[Analysis Stream] Reporting step identification: executiveSummary=${reportingIds.executiveSummaryStepId} (index ${reportingIds.executiveSummaryStepIndex}), paralegalChecklist=${reportingIds.paralegalChecklistStepId} (index ${reportingIds.paralegalChecklistStepIndex})`,
      );
    }

    // Separate subject and context documents to prevent citation leakage.
    // The AI should analyze citations ONLY from the subject document, while using
    // context documents purely for background understanding.
    const subjectDocs = sessionDocuments.filter(
      (d) => d.documentRole === "subject",
    );
    const contextDocs = sessionDocuments.filter(
      (d) => d.documentRole === "context",
    );

    const subjectDocumentText = subjectDocs
      .map((d) => `=== ${d.fileName} ===\n${d.extractedText}`)
      .join("\n\n");

    const contextDocumentText = contextDocs
      .map((d) => `=== ${d.fileName} ===\n${d.extractedText}`)
      .join("\n\n");

    // Build structured document text with clear section boundaries
    let documentText: string;
    if (contextDocumentText.length > 0) {
      documentText =
        `--- SUBJECT DOCUMENT (PRIMARY FOCUS — analyze and verify citations in this document) ---\n\n` +
        subjectDocumentText +
        `\n\n--- CONTEXT DOCUMENTS (for background understanding ONLY — do NOT flag, verify, or report citations from these documents) ---\n\n` +
        contextDocumentText;
    } else {
      documentText = subjectDocumentText;
    }

    // Extract citations from the SUBJECT document only using eyecite (CourtListener API)
    // and regex patterns for statutory citations. This provides a definitive, programmatic
    // list of citations that exist in the subject document, preventing the AI from
    // treating context document citations as part of its analysis scope.
    let subjectCitationResult: CitationExtractionResult | null = null;
    let subjectCitationSummary = "";
    if (subjectDocumentText.length > 0) {
      try {
        const courtListenerClient = new CourtListenerClient();
        subjectCitationResult = await extractAllCitations(
          subjectDocumentText,
          courtListenerClient,
        );
        subjectCitationSummary = formatCitationListForPrompt(
          subjectCitationResult,
        );
        console.log(
          `[Analysis Stream] Citation extraction from subject document: ${subjectCitationResult.citations.length} citations found (${subjectCitationResult.caseLawCount} case law, ${subjectCitationResult.statutoryCount} statutory)`,
        );
      } catch (error) {
        console.error(
          "[Analysis Stream] Citation extraction failed (non-fatal):",
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    // Note: documentType is already declared above for discovery drafting mode detection
    const caseType = analysisSession.caseType;
    const jurisdiction = analysisSession.jurisdiction;
    const ourClients = analysisSession.ourClients;
    const opposingParties = analysisSession.opposingParties;
    const contextSummary = analysisSession.contextSummary;
    const aiMode = analysisSession.aiMode;

    // Note: effectiveOurClients and effectiveOpposingParties will be computed
    // after isOffensiveMode is determined (see below)
    async function loadAvailableTools(
      aiMode: string,
      steps: { availableTools: string[] }[],
    ) {
      if (aiMode === "none") {
        return { allAvailableTools: {}, allToolIds: new Set<string>() };
      }
      const allToolIds = new Set<string>();
      if (aiMode === "tools") {
        const { TOOL_REGISTRY } = await import("@/lib/ai-tools");
        Object.keys(TOOL_REGISTRY).forEach((id) => allToolIds.add(id));
      } else {
        steps.forEach((step) =>
          step.availableTools.forEach((id) => allToolIds.add(id)),
        );
      }
      const allAvailableTools = getToolsByIds(Array.from(allToolIds));
      return { allAvailableTools, allToolIds };
    }

    const { allAvailableTools } = await loadAvailableTools(aiMode ?? "tools_and_steps", steps);

    const encoder = new TextEncoder();
    let fullAnalysis = "";
    const allToolCalls: unknown[] = [];
    const allToolResults: unknown[] = [];
    let totalUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    };

    const enforcer = new VerificationEnforcer();

    const globalTokenOverride = await getGlobalTokenOverride();
    console.log(
      `[Analysis Stream] Global token override: enabled=${globalTokenOverride.enabled}, maxOutputTokens=${globalTokenOverride.maxOutputTokens}`,
    );

    const existingCitationIndex = await assembleCitationIndexFromDB(sessionId);
    enforcer.setCitationIndex(existingCitationIndex);

    const allContextualAnalyses: unknown[] = [];
    const allVerifiedAuthorities: unknown[] = [];
    const allVerificationStats = {
      total: 0,
      verified: 0,
      failed: 0,
      fallback: 0,
    };

    const auditLog: {
      version: number;
      summary: {
        totalCalls: number;
        byTool: Record<string, number>;
        firstCallAt: string | null;
        lastCallAt: string | null;
      };
      steps: unknown[];
    } = {
      version: 1,
      summary: {
        totalCalls: 0,
        byTool: {} as Record<string, number>,
        firstCallAt: null,
        lastCallAt: null,
      },
      steps: [],
    };

    const stepsSummary: StepSummary[] = [];

    const previousSteps = await db
      .select()
      .from(analysisSteps)
      .where(eq(analysisSteps.analysisSessionId, Number(sessionId)))
      .orderBy(asc(analysisSteps.stepIndex));

    console.log(
      `[Analysis Stream] Loaded ${previousSteps.length} previous steps for context preservation`,
    );

    // Time budget tracking for chunked analysis
    // Always use the centralized constant from lib/time-budgets.ts (770000ms / ~12.8 min).
    // The DB column `time_budget_ms` has a stale default of 540000 (9 min) from migration 0010
    // that was never updated in production (migration 0028 not applied), wasting ~4 min per chunk.
    const timeBudgetMs = DEFAULT_CHUNK_TIME_BUDGET_MS;
    const startTime = Date.now();
    const softTimeoutMs = timeBudgetMs - 30000; // Leave 30s buffer for cleanup

    // DIAGNOSTIC: Log setup time before stream starts
    const setupTimeMs = startTime - postHandlerStartTime;
    console.log(
      `[Analysis Stream] DIAGNOSTIC: Setup completed in ${setupTimeMs}ms (${Math.floor(setupTimeMs / 1000)}s). ` +
        `Time budget: ${timeBudgetMs}ms (${Math.floor(timeBudgetMs / 1000)}s), ` +
        `PRE_STEP_MIN_WINDOW: ${PRE_STEP_MIN_WINDOW_MS}ms (${Math.floor(PRE_STEP_MIN_WINDOW_MS / 1000)}s), ` +
        `Effective budget for steps: ${timeBudgetMs - PRE_STEP_MIN_WINDOW_MS}ms (${Math.floor((timeBudgetMs - PRE_STEP_MIN_WINDOW_MS) / 1000)}s)`,
    );

    let lastHeartbeatUpdate = Date.now();

    const updateHeartbeat = async () => {
      const now = Date.now();
      if (now - lastHeartbeatUpdate >= STREAM_HEARTBEAT_INTERVAL_MS) {
        await db
          .update(analysisSessions)
          .set({
            lastActivityAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(analysisSessions.id, Number(sessionId)));
        lastHeartbeatUpdate = now;
        console.log(
          `[Analysis Stream] Heartbeat updated for session ${sessionId}`,
        );
      }
    };

    const heartbeatIntervalMs = STREAM_HEARTBEAT_INTERVAL_MS;

    // Build dynamic system prompt based on document origin and workflow mode
    let effectiveSystemPrompt = SYSTEM_PROMPT;
    if (isDiscoveryDraftingMode) {
      // DISCOVERY DRAFTING MODE: Use the dedicated discovery drafting system prompt
      effectiveSystemPrompt = DISCOVERY_DRAFTING_SYSTEM_PROMPT;
      console.log(
        `[Analysis Stream] DISCOVERY DRAFTING MODE: Using dedicated discovery drafting system prompt for session ${sessionId} (document_origin: ${documentOrigin}, document_type: ${documentType})`,
      );
    } else if (isOffensiveMode) {
      // OFFENSE MODE: Use the dedicated offense system prompt instead of prepending the old prompt
      effectiveSystemPrompt = OFFENSE_SYSTEM_PROMPT;
      console.log(
        `[Analysis Stream] OFFENSE MODE: Using dedicated offense system prompt for session ${sessionId} (document_origin: ${documentOrigin})`,
      );
    } else {
      console.log(
        `[Analysis Stream] Standard QA Mode for session ${sessionId} (document_origin: ${documentOrigin})`,
      );
    }

    // Compute effective parties based on offense mode
    // In offense mode, the document was authored by opposing counsel, so the AI-extracted
    // "our_clients" are actually the opposing party (from user's perspective) and vice versa.
    // We swap the values so the AI receives the correct user-perspective information.
    let effectiveOurClients = ourClients;
    let effectiveOpposingParties = opposingParties;

    if (isOffensiveMode) {
      // Swap parties: in offense mode, the document's "our_clients" are actually the user's opponents
      effectiveOurClients = opposingParties;
      effectiveOpposingParties = ourClients;
      console.log(
        `[Analysis Stream] Offense Mode Party Swap: Original ourClients=${JSON.stringify(ourClients)}, opposingParties=${JSON.stringify(opposingParties)}`,
      );
      console.log(
        `[Analysis Stream] Offense Mode Party Swap: Effective ourClients=${JSON.stringify(effectiveOurClients)}, opposingParties=${JSON.stringify(effectiveOpposingParties)}`,
      );
    }

    console.log(
      `[Analysis Stream] About to create ReadableStream for session ${sessionId}`,
    );

    const executionMode = analysisSession.executionMode || "step-based";
    console.log(`[Analysis Stream] Execution mode: ${executionMode}`);

    if (executionMode === "phase-based") {
      console.log(
        `[Analysis Stream] Using phase-based execution for session ${sessionId}`,
      );

      const stream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();
          const chunkStartTime = Date.now();

          await executePhaseBasedAnalysis(
            sessionId,
            sessionOrigin,
            req,
            controller,
            encoder,
            analysisSession,
            documentText,
            timeBudgetMs,
            chunkStartTime,
            lockId, // Pass lock ID for lock renewal during processing
          );
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    const stream = new ReadableStream({
      async start(controller) {
        // DIAGNOSTIC: Track time from POST handler start to stream start
        const streamStartTime = Date.now();
        const totalSetupTimeMs = streamStartTime - postHandlerStartTime;
        console.log(
          `[Analysis Stream] DIAGNOSTIC: Stream start() entered. Total setup time: ${totalSetupTimeMs}ms (${Math.floor(totalSetupTimeMs / 1000)}s). ` +
            `Session: ${sessionId}, currentStep: ${analysisSession.currentStep || 0}, continuationCount: ${analysisSession.continuationCount || 0}`,
        );

        console.log(
          `[Analysis Stream] start() entered for session ${sessionId}`,
        );
        const chunkId = `chunk-${Date.now()}`;
        const logger = new AnalysisLogger(
          sessionId,
          chunkId,
          analysisSession.continuationCount || 0,
        );

        const enhancedLogger = new EnhancedAnalysisLogger(
          sessionId,
          chunkId,
          analysisSession.continuationCount || 0,
          workflowSource,
          steps.length,
        );

        const debugConfig = getDebugConfig();

        logger.requestStart({
          continuationCount: analysisSession.continuationCount || 0,
          timeBudgetMs,
          heartbeatIntervalMs,
          currentStep: analysisSession.currentStep || 0,
          totalSteps: steps.length,
          workflowSource,
        });

        enhancedLogger.orchestrationEvent({
          event: "chunk_start",
          currentStep: analysisSession.currentStep || 0,
          remainingSteps: steps.length - (analysisSession.currentStep || 0),
          nextAction: "begin_step_execution",
          elapsedMs: 0,
          attemptNumber: analysisSession.continuationCount || 0,
        });

        if (
          analysisSession.continuationCount &&
          analysisSession.continuationCount > 0
        ) {
          const lastContinuedAt = analysisSession.lastContinuedAt;
          const gapMs = lastContinuedAt
            ? Date.now() - new Date(lastContinuedAt).getTime()
            : 0;
          const cacheStatus = gapMs < ANTHROPIC_CACHE_TTL_MS ? "warm" : "cold";

          enhancedLogger.cacheStatus({
            gapSinceLastChunkMs: gapMs,
            cacheStatus,
          });
        }

        let heartbeatTimer: NodeJS.Timeout | null = null;
        let hardStopTimer: NodeJS.Timeout | null = null;
        const abortController = new AbortController();
        let latestStepIndex = analysisSession.currentStep || 0;

        // Progress-aware heartbeat: Track when actual step work happens.
        // The heartbeat will only renew the lock and update lastActivityAt
        // while progress is being made. If the worker hangs (e.g., stuck on
        // a streamText() call), progress stops being updated, and the heartbeat
        // will stop renewing the lock after HEARTBEAT_PROGRESS_STALE_MS.
        // This allows cleanupExpiredLocks/cleanupStaleLocks to detect and
        // release the stuck lock, breaking the infinite 409 retry loop.
        let lastProgressUpdate = Date.now();
        const HEARTBEAT_PROGRESS_STALE_MS = 10 * 60 * 1000; // 10 minutes

        const startHeartbeat = () => {
          if (heartbeatTimer) clearInterval(heartbeatTimer);
          heartbeatTimer = setInterval(async () => {
            try {
              const progressAge = Date.now() - lastProgressUpdate;
              const isProgressStale =
                progressAge >= HEARTBEAT_PROGRESS_STALE_MS;

              if (isProgressStale) {
                // Worker has made no step progress for too long.
                // STOP renewing the lock and updating lastActivityAt so that:
                // 1. The lock expires naturally after its TTL (5 minutes)
                // 2. cleanupStaleLocks detects stale lastActivityAt
                // This breaks the infinite 409 loop for hung workers.
                console.warn(
                  `[Analysis Stream] Heartbeat: No step progress for ${Math.round(progressAge / 1000)}s - ` +
                    `STOPPING lock renewal and activity updates to allow recovery. ` +
                    `Session: ${sessionId}, lastStepIndex: ${latestStepIndex}`,
                );
                return; // Skip renewal and activity update
              }

              await db
                .update(analysisSessions)
                .set({
                  lastActivityAt: new Date(),
                  updatedAt: new Date(),
                })
                .where(eq(analysisSessions.id, Number(sessionId)));

              const renewed = await renewLock(sessionId, lockId);
              if (renewed) {
                console.log(
                  `[Analysis Stream] Heartbeat: updated activity + renewed lock for session ${sessionId}`,
                );
              } else {
                console.warn(
                  `[Analysis Stream] Heartbeat: updated activity but lock renewal failed for session ${sessionId} (lock may have expired)`,
                );
              }
            } catch (error) {
              console.error(
                `[Analysis Stream] Heartbeat update failed:`,
                error,
              );
            }
          }, heartbeatIntervalMs);
        };

        const stopHeartbeat = () => {
          if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
          }
        };

        const stopHardStopTimer = () => {
          if (hardStopTimer) {
            clearTimeout(hardStopTimer);
            hardStopTimer = null;
          }
        };

        const hardStopMs = 750000; // 12.5 minutes
        hardStopTimer = setTimeout(() => {
          console.log(
            `[Analysis Stream] Hard-stop guard triggered at ${Math.floor(hardStopMs / 1000)}s for session ${sessionId}`,
          );
          abortController.abort(
            new Error("Hard-stop: Approaching maxDuration limit"),
          );
        }, hardStopMs);

        // Array to collect verification diagnostics for batch persistence at end of chunk
        const verificationDiagnosticsArray: Array<{
          stepIndex: number;
          stepId: string;
          stepName: string;
          hasVerificationSettings: boolean;
          hasLegalAuthorityVerification: boolean;
          legalAuthorityEnabled: boolean | undefined;
          verificationSettingsKeys: string[];
          fullVerificationSettings: unknown;
          timestamp: string;
        }> = [];

        try {
          await db
            .update(analysisSessions)
            .set({
              lastActivityAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(analysisSessions.id, Number(sessionId)));

          startHeartbeat();
          controller.enqueue(
            encoder.encode(
              `[Starting analysis with ${steps.length} steps (time budget: ${Math.floor(timeBudgetMs / 1000)}s)...]\n\n`,
            ),
          );

          // DIAGNOSTIC C: Log workflow configuration table
          controller.enqueue(
            encoder.encode(`[DIAGNOSTIC] Workflow source: ${workflowSource}\n`),
          );
          controller.enqueue(
            encoder.encode(`[DIAGNOSTIC] Verification settings by step:\n`),
          );
          for (let i = 0; i < Math.min(steps.length, 10); i++) {
            const step = steps[i];
            const verificationEnabled =
              step.verificationSettings?.legalAuthorityVerification?.enabled ||
              false;
            const maxRetries =
              step.verificationSettings?.legalAuthorityVerification
                ?.maxRetries || 0;
            controller.enqueue(
              encoder.encode(
                `  Step ${i + 1} (${step.name}): verification=${verificationEnabled}, retries=${maxRetries}\n`,
              ),
            );
          }
          if (steps.length > 10) {
            controller.enqueue(
              encoder.encode(`  ... (${steps.length - 10} more steps)\n`),
            );
          }
          controller.enqueue(encoder.encode(`\n`));

          // ============================================================
          // STEP 0: Document Loading Verification (No LLM call - deterministic check)
          // This step verifies documents are loaded and ready for analysis without
          // making an expensive LLM call. The actual document text will be sent
          // to the AI in the analysis steps where it's actually needed.
          // ============================================================
          if ((analysisSession.currentStep || 0) === 0) {
            console.log(
              "[Analysis Stream] Step 0: Verifying documents are loaded",
            );

            controller.enqueue(
              encoder.encode(`\n=== STEP 0: DOCUMENT LOADING ===\n\n`),
            );

            // Deterministic document verification (no LLM call needed)
            const step0SubjectDoc = sessionDocuments.find(
              (d) => d.documentRole === "subject",
            );
            const step0SubjectDocName =
              step0SubjectDoc?.fileName || "the subject document";
            const step0ContextDocs = sessionDocuments.filter(
              (d) => d.documentRole === "context",
            );

            // Verify we have document text
            if (!documentText || documentText.trim().length === 0) {
              console.error(
                "[Analysis Stream] Step 0 failed: No document text available",
              );
              controller.enqueue(
                encoder.encode(
                  `⚠️ Document loading failed: No document text available. Please ensure documents are uploaded correctly.\n\n`,
                ),
              );
            } else {
              // Calculate approximate token count (rough estimate: 4 chars per token)
              const approxTokens = Math.ceil(documentText.length / 4);

              console.log(
                `[Analysis Stream] Step 0 completed: ${sessionDocuments.length} document(s), ${documentText.length.toLocaleString()} characters (~${approxTokens.toLocaleString()} tokens)`,
              );

              controller.enqueue(
                encoder.encode(`✓ Documents verified and ready for analysis\n`),
              );
              controller.enqueue(
                encoder.encode(
                  `  - Subject document: "${step0SubjectDocName}"\n`,
                ),
              );
              if (step0ContextDocs.length > 0) {
                const step0ContextFileNames = step0ContextDocs
                  .map((d) => d.fileName)
                  .join(", ");
                controller.enqueue(
                  encoder.encode(
                    `  - Context documents (${step0ContextDocs.length}): ${step0ContextFileNames}\n`,
                  ),
                );
              }
              controller.enqueue(
                encoder.encode(
                  `  - Total content: ${documentText.length.toLocaleString()} characters (~${approxTokens.toLocaleString()} tokens)\n`,
                ),
              );
              controller.enqueue(
                encoder.encode(
                  `✓ Ready to begin ${steps.length}-step analysis.\n\n`,
                ),
              );
            }

            controller.enqueue(encoder.encode(`\n${"=".repeat(80)}\n`));
            controller.enqueue(
              encoder.encode(`BEGINNING ${steps.length}-STEP ANALYSIS\n`),
            );
            controller.enqueue(encoder.encode(`${"=".repeat(80)}\n\n`));
          }
          // ============================================================
          // ============================================================

          for (
            let i = analysisSession.currentStep || 0;
            i < steps.length;
            i++
          ) {
            const step = steps[i];

            // Check if abort signal is already triggered before starting this step
            // This prevents "No output generated" errors when hard-stop timer fires
            if (abortController.signal.aborted) {
              console.warn(
                `[Analysis Stream] Abort signal already set before starting step ${i + 1}. Stopping chunk early to allow orchestrator continuation.`,
              );

              controller.enqueue(
                encoder.encode(
                  `\n\n⏱️ Time limit reached before step ${i + 1}. Continuing in next chunk...\n`,
                ),
              );

              stopHeartbeat();

              await db
                .update(analysisSessions)
                .set({
                  status: "processing",
                  currentStep: i,
                  isResuming: false,
                  continuationCount:
                    (analysisSession.continuationCount || 0) + 1,
                  lastContinuedAt: new Date(),
                  updatedAt: new Date(),
                })
                .where(eq(analysisSessions.id, Number(sessionId)));

              console.log(
                `[Analysis Stream] Abort signal detected at step ${i}. Chunk complete, triggering orchestrator.`,
              );

              controller.enqueue(
                encoder.encode(
                  `\n✓ Chunk complete. Orchestrator will continue automatically.\n`,
                ),
              );

              const baseUrl = getBaseUrl(req);
              const bypass = process.env.INTERNAL_API_TOKEN;

              if (!isInvokedByResumeChunk) {
                defer(
                  triggerOrchestratorNow(
                    baseUrl,
                    sessionId,
                    sessionOrigin,
                    bypass,
                  ),
                );
              } else {
                // SAFETY NET: Create a continuation job so the watchdog can recover
                // this session if the calling orchestrator dies before self-chaining.
                // The watchdog checks for sessions with PAUSE_INSUFFICIENT_TIME metadata
                // and no processing lock, and will trigger a new orchestrator within 2 min.
                console.log(
                  `[Analysis Stream] Creating continuation job as safety net (invoked by resume-chunk, orchestrator should handle continuation)`,
                );
                try {
                  await createContinuationJob(sessionId);
                } catch (jobErr) {
                  console.error(
                    `[Analysis Stream] Failed to create safety-net continuation job:`,
                    jobErr,
                  );
                }
              }

              try {
                await releaseLock(sessionId, lockId);
                console.log(
                  `[Analysis Stream] Released lock ${lockId} after abort signal at pre-step gate`,
                );
              } catch (lockError) {
                console.error(
                  `[Analysis Stream] Failed to release lock after abort signal at pre-step gate:`,
                  lockError,
                );
              }

              controller.close();
              return;
            }

            const elapsedMs = Date.now() - startTime;
            const remainingMs = timeBudgetMs - elapsedMs;
            const minStepWindowMs = PRE_STEP_MIN_WINDOW_MS;
            const willPause = remainingMs < minStepWindowMs;

            // DIAGNOSTIC: Enhanced pre-step gate logging with all timing details
            console.log(
              `[Analysis Stream] DIAGNOSTIC Pre-step gate for step ${i + 1}/${steps.length}: ` +
                `elapsed=${Math.floor(elapsedMs / 1000)}s, remaining=${Math.floor(remainingMs / 1000)}s, ` +
                `minWindow=${Math.floor(minStepWindowMs / 1000)}s, timeBudget=${Math.floor(timeBudgetMs / 1000)}s, ` +
                `decision=${willPause ? "PAUSE" : "PROCEED"}, stepId=${step.id}, stepName=${step.name}`,
            );

            // DIAGNOSTIC: Persist timing diagnostics to session metadata for debugging
            if (willPause) {
              const timingDiagnostics = {
                preStepGatePause: {
                  timestamp: new Date().toISOString(),
                  stepIndex: i,
                  stepName: step.name,
                  elapsedMs,
                  remainingMs,
                  timeBudgetMs,
                  minStepWindowMs,
                  continuationCount:
                    (analysisSession.continuationCount || 0) + 1,
                  setupTimeMs: setupTimeMs,
                  decision: "PAUSE_INSUFFICIENT_TIME",
                },
              };
              console.log(
                `[Analysis Stream] DIAGNOSTIC: Pre-step gate PAUSING at step ${i + 1}. ` +
                  `Timing: setup=${Math.floor(setupTimeMs / 1000)}s, elapsed=${Math.floor(elapsedMs / 1000)}s, ` +
                  `remaining=${Math.floor(remainingMs / 1000)}s < minWindow=${Math.floor(minStepWindowMs / 1000)}s`,
              );
              // Persist to metadata for later debugging
              try {
                const currentMeta =
                  (analysisSession.metadata as Record<string, unknown>) || {};
                await db
                  .update(analysisSessions)
                  .set({
                    metadata: {
                      ...currentMeta,
                      lastPreStepGateDiagnostics:
                        timingDiagnostics.preStepGatePause,
                    },
                  })
                  .where(eq(analysisSessions.id, Number(sessionId)));
              } catch (metaErr) {
                console.error(
                  `[Analysis Stream] Failed to persist timing diagnostics:`,
                  metaErr,
                );
              }
            }

            console.log(
              `[Analysis Stream] Pre-step gate check for step ${i + 1}: elapsed=${Math.floor(elapsedMs / 1000)}s, remaining=${Math.floor(remainingMs / 1000)}s, minWindow=${Math.floor(minStepWindowMs / 1000)}s, stepId=${step.id}, stepName=${step.name}`,
            );

            logger.preStepGateDecision({
              stepIndex: i + 1,
              remainingMs,
              thresholdMs: minStepWindowMs,
              decision:
                remainingMs < minStepWindowMs ? "pauseAndPersist" : "proceed",
              reason:
                remainingMs < minStepWindowMs ? "insufficient_time" : undefined,
            });

            enhancedLogger.preStepGate({
              stepIndex: i,
              stepName: step.name,
              timeBudgetRemainingMs: remainingMs,
              decision:
                remainingMs < minStepWindowMs ? "pause_and_persist" : "proceed",
              reason:
                remainingMs < minStepWindowMs
                  ? "insufficient_time"
                  : "sufficient_time",
            });

            if (remainingMs < minStepWindowMs) {
              controller.enqueue(
                encoder.encode(
                  `\n\n⏱️ Insufficient time remaining (${Math.floor(remainingMs / 1000)}s) to start step ${i + 1}. Completing chunk...\n`,
                ),
              );

              stopHeartbeat();

              const updateResult = await db
                .update(analysisSessions)
                .set({
                  status: "processing",
                  currentStep: i,
                  isResuming: false,
                  continuationCount:
                    (analysisSession.continuationCount || 0) + 1,
                  lastContinuedAt: new Date(),
                  updatedAt: new Date(),
                })
                .where(eq(analysisSessions.id, Number(sessionId)));

              logger.progressUpdate({
                currentStepBefore: analysisSession.currentStep || 0,
                currentStepAfter: i,
                statusBefore: analysisSession.status,
                statusAfter: "processing",
                rowsUpdated: updateResult.rowCount || 0,
              });

              enhancedLogger.sessionPersistence({
                currentStep: i,
                continuationCount: (analysisSession.continuationCount || 0) + 1,
                persistedFields: {
                  status: "processing",
                  currentStep: i,
                  isResuming: false,
                  continuationCount:
                    (analysisSession.continuationCount || 0) + 1,
                  lastContinuedAt: new Date().toISOString(),
                },
                reason: "pre_step_gate_insufficient_time",
              });

              enhancedLogger.orchestrationEvent({
                event: "chunk_complete",
                currentStep: i,
                remainingSteps: steps.length - i,
                nextAction: "trigger_orchestrator",
                elapsedMs,
                attemptNumber: (analysisSession.continuationCount || 0) + 1,
              });

              console.log(
                `[Analysis Stream] Pre-step gate: Not enough time to start step ${i + 1}. Chunk complete.`,
              );

              controller.enqueue(
                encoder.encode(
                  `\n✓ Chunk complete. Orchestrator will continue automatically.\n`,
                ),
              );

              const baseUrl = getBaseUrl(req);
              const bypass = process.env.INTERNAL_API_TOKEN;

              console.log(
                `[Analysis Stream] Scheduling orchestrator trigger (pre-step gate) for session=${sessionId}`,
              );

              if (!isInvokedByResumeChunk) {
                defer(
                  triggerOrchestratorNow(
                    baseUrl,
                    sessionId,
                    sessionOrigin,
                    bypass,
                  ),
                );
              } else {
                // SAFETY NET: Create a continuation job so the watchdog can recover
                // this session if the calling orchestrator dies before self-chaining.
                // This is the critical fix for orphaned sessions: when a chunk pauses
                // with PAUSE_INSUFFICIENT_TIME, the orchestrator is expected to continue,
                // but if it was killed by the host runtime, the continuation job ensures the
                // watchdog picks it up within 2 minutes.
                console.log(
                  `[Analysis Stream] Creating continuation job as safety net (pre-step gate, invoked by resume-chunk)`,
                );
                try {
                  await createContinuationJob(sessionId);
                } catch (jobErr) {
                  console.error(
                    `[Analysis Stream] Failed to create safety-net continuation job:`,
                    jobErr,
                  );
                }
              }

              try {
                await releaseLock(sessionId, lockId);
                console.log(
                  `[Analysis Stream] Released lock ${lockId} after pre-step gate insufficient time`,
                );
              } catch (lockError) {
                console.error(
                  `[Analysis Stream] Failed to release lock after pre-step gate insufficient time:`,
                  lockError,
                );
              }

              controller.close();
              return;
            }

            if (elapsedMs > softTimeoutMs) {
              controller.enqueue(
                encoder.encode(
                  `\n\n⏱️ Approaching time budget limit (${Math.floor(elapsedMs / 1000)}s elapsed). Continuing in next chunk...\n`,
                ),
              );

              stopHeartbeat();

              await db
                .update(analysisSessions)
                .set({
                  status: "processing",
                  currentStep: i,
                  isResuming: false,
                  continuationCount:
                    (analysisSession.continuationCount || 0) + 1,
                  lastContinuedAt: new Date(),
                  updatedAt: new Date(),
                })
                .where(eq(analysisSessions.id, Number(sessionId)));

              console.log(
                `[Analysis Stream] Time budget reached at step ${i}. Chunk complete.`,
              );

              controller.enqueue(
                encoder.encode(
                  `\n✓ Chunk complete. Orchestrator will continue automatically.\n`,
                ),
              );

              const baseUrl = getBaseUrl(req);
              const bypass = process.env.INTERNAL_API_TOKEN;

              console.log(
                `[Analysis Stream] Scheduling orchestrator trigger (soft timeout) for session=${sessionId}`,
              );

              if (!isInvokedByResumeChunk) {
                defer(
                  triggerOrchestratorNow(
                    baseUrl,
                    sessionId,
                    sessionOrigin,
                    bypass,
                  ),
                );
              } else {
                // SAFETY NET: Create a continuation job for soft timeout path too.
                console.log(
                  `[Analysis Stream] Creating continuation job as safety net (soft timeout, invoked by resume-chunk)`,
                );
                try {
                  await createContinuationJob(sessionId);
                } catch (jobErr) {
                  console.error(
                    `[Analysis Stream] Failed to create safety-net continuation job:`,
                    jobErr,
                  );
                }
              }

              try {
                await releaseLock(sessionId, lockId);
                console.log(
                  `[Analysis Stream] Released lock ${lockId} after soft timeout`,
                );
              } catch (lockError) {
                console.error(
                  `[Analysis Stream] Failed to release lock after soft timeout:`,
                  lockError,
                );
              }

              controller.close();
              return;
            }

            controller.enqueue(
              encoder.encode(
                `\n\n=== STEP ${i + 1}/${steps.length}: ${step.name} ===\n\n`,
              ),
            );

            latestStepIndex = i;
            lastProgressUpdate = Date.now(); // Mark progress for heartbeat staleness check
            logger.setStepIndex(i + 1);

            // Step Applicability Check: Track attempts and check if step should be skipped
            const stepAttemptResult = await updateStepAttemptState(
              sessionId,
              step,
            );
            controller.enqueue(
              encoder.encode(
                `[DIAGNOSTIC] Step attempt tracking: attempts=${stepAttemptResult.attemptsOnCurrentStep}, threshold=${APPLICABILITY_CHECK_THRESHOLD}, shouldCheck=${stepAttemptResult.shouldCheckApplicability}\n`,
              ),
            );

            if (stepAttemptResult.shouldCheckApplicability) {
              controller.enqueue(
                encoder.encode(
                  `\n⚠️ Step ${i + 1} has been attempted ${stepAttemptResult.attemptsOnCurrentStep} times. Checking if step is applicable...\n`,
                ),
              );

              const applicabilityResult = await checkStepApplicability(
                sessionId,
                step,
                documentText,
                {
                  documentType,
                  caseType,
                  jurisdiction,
                  ourClients,
                  opposingParties,
                  contextSummary,
                },
              );

              controller.enqueue(
                encoder.encode(
                  `[DIAGNOSTIC] Applicability check result: isApplicable=${applicabilityResult.isApplicable}, rawResponse="${applicabilityResult.rawResponse}"\n`,
                ),
              );

              if (!applicabilityResult.isApplicable) {
                controller.enqueue(
                  encoder.encode(
                    `\n⏭️ Step ${i + 1} (${step.name}) is NOT applicable to this document. Skipping to next step...\n`,
                  ),
                );

                // Persist a "skipped" record for this step
                await persistSkippedStep(
                  sessionId,
                  i,
                  step,
                  applicabilityResult,
                );

                // Advance to next step
                await advanceToNextStep(sessionId, i);

                // Continue to next step in the loop
                continue;
              } else {
                controller.enqueue(
                  encoder.encode(
                    `\n✓ Step ${i + 1} (${step.name}) IS applicable. Continuing with execution...\n`,
                  ),
                );
              }
            }

            const stepStartTime = Date.now();
            logger.stepStart({
              stepIndex: i + 1,
              stepName: step.name,
              modelParams: {
                temperature: step.modelParams.temperature || 0.7,
                maxTokens: step.modelParams.maxTokens || 4096,
              },
              toolsCount: step.availableTools.length,
            });

            const verificationEnabled =
              step.verificationSettings?.legalAuthorityVerification?.enabled ||
              false;
            const verificationMaxRetries =
              step.verificationSettings?.legalAuthorityVerification
                ?.maxRetries || 0;

            enhancedLogger.stepStart({
              stepIndex: i,
              stepName: step.name,
              stepId: step.id,
              category: step.category,
              modelParams: {
                model: step.modelParams.model || "claude-sonnet-4-20250514",
                temperature: step.modelParams.temperature || 0.7,
                maxTokens: step.modelParams.maxTokens || 4096,
              },
              toolsCount: step.availableTools.length,
              toolsList: debugConfig.enabled ? step.availableTools : undefined,
              verificationEnabled,
              timeBudgetRemainingMs: softTimeoutMs - elapsedMs,
            });
            controller.enqueue(
              encoder.encode(
                `[DIAGNOSTIC] Verification enabled: ${verificationEnabled}, Max retries: ${verificationMaxRetries}\n`,
              ),
            );

            const stepAuditEntry: {
              stepIndex: number;
              stepName: string;
              calls: unknown[];
            } = {
              stepIndex: i + 1,
              stepName: step.name,
              calls: [],
            };

            let stepTools: Record<string, unknown> = {};

            if (aiMode === "tools") {
              stepTools = allAvailableTools;
            } else if (aiMode === "tools_and_steps") {
              stepTools = getToolsByIds(step.availableTools);
            } else if (aiMode === "none") {
              stepTools = {};
            } else {
              stepTools = getToolsByIds(step.availableTools);
            }

            try {
              const subjectDoc = sessionDocuments.find(
                (d) => d.documentRole === "subject",
              );
              const subjectDocName =
                subjectDoc?.fileName || "the subject document";
              const contextDocs = sessionDocuments.filter(
                (d) => d.documentRole === "context",
              );

              let caseContextText = `IMPORTANT: Your primary focus is the analysis of the document with file name '${subjectDocName}' and everything else is context to help you understand the document.\n\n`;

              if (contextDocs.length > 0) {
                const contextFileNames = contextDocs
                  .map((d) => d.fileName)
                  .join(", ");
                caseContextText += `The following document(s) are provided for the express purpose of giving you greater context and understanding of the subject document, which is '${subjectDocName}.' Please read the context documents with that in mind: ${contextFileNames}\n\n`;

                // Check the step-level citation scope restriction setting
                // Default to "subject_only" if not explicitly configured
                const stepCitationScope =
                  step.citationScopeRestriction ?? "subject_only";
                if (stepCitationScope === "subject_only") {
                  caseContextText += `CRITICAL CITATION SCOPE RULE: When checking, verifying, or flagging citations, you must ONLY analyze citations that appear in the SUBJECT document ('${subjectDocName}'). Do NOT flag, verify, or report on citations found in the context documents. The context documents are provided solely to give you background understanding of the case — their citations are NOT part of your analysis scope. Any citation recommendations or verification results you produce must pertain exclusively to the subject document.\n\n`;
                }

                // Bias prevention always applies regardless of citation scope setting
                caseContextText += `CONTEXT DOCUMENT BIAS PREVENTION: The context documents are provided for background understanding ONLY. Do NOT presume that the context documents are legally accurate — they may contain errors, misstatements of law, or incomplete analysis. Your review of the subject document must be independent and rigorous regardless of any conclusions or assertions made in the context documents. Evaluate the subject document on its own merits.\n\n`;
              }

              // If we have programmatically extracted citations from the subject document,
              // include them so the AI knows exactly which citations exist in the subject doc
              if (subjectCitationSummary) {
                caseContextText += `PROGRAMMATICALLY EXTRACTED CITATIONS (eyecite + regex):\n${subjectCitationSummary}\nThe above citations were programmatically extracted from the subject document. When performing citation analysis, focus on these citations. If you identify additional citations in the subject document that were not detected programmatically, you may include those as well, but do NOT include citations that only appear in context documents.\n\n`;
              }

              if (contextSummary) {
                caseContextText += `The following text is a summary that the user has provided for the express purpose of giving you greater context and understanding of the subject document, which is '${subjectDocName}.' Please read the summary with that in mind:\n${contextSummary}\n\n`;
              }

              if (effectiveOurClients && effectiveOurClients.length > 0) {
                caseContextText += `For the sake of context, the user's client(s) are: ${effectiveOurClients.join(", ")}\n\n`;
              }

              if (
                effectiveOpposingParties &&
                effectiveOpposingParties.length > 0
              ) {
                caseContextText += `For the sake of context, the opposing part(ies) in this matter are: ${effectiveOpposingParties.join(", ")}\n\n`;
              }

              const caseContextParts = [];
              if (documentType)
                caseContextParts.push(`Document Type: ${documentType}`);
              if (caseType) caseContextParts.push(`Case Type: ${caseType}`);
              if (jurisdiction)
                caseContextParts.push(`Jurisdiction: ${jurisdiction}`);

              if (caseContextParts.length > 0) {
                caseContextText += `CASE METADATA:\n${caseContextParts.map((part) => `- ${part}`).join("\n")}\n\n`;
              }

              // Note: contextMessage removed - now using documentContextMessage in CAG optimization section below

              let previousStepsContext = "";
              if (previousSteps.length > 0) {
                // Determine if CAG cache is cold (>5 min gap since last activity)
                // When cache is cold, we need to include FULL context from all previous steps
                const lastContinuedAt = analysisSession.lastContinuedAt;
                const gapSinceLastActivity = lastContinuedAt
                  ? Date.now() - new Date(lastContinuedAt).getTime()
                  : 0;
                const isCacheCold =
                  analysisSession.continuationCount &&
                  analysisSession.continuationCount > 0 &&
                  gapSinceLastActivity > ANTHROPIC_CACHE_TTL_MS;

                // When cache is cold, use full context (up to 5000 chars per step)
                // When cache is warm, use truncated context (500 chars) since CAG has the full context
                const maxContextPerStep = isCacheCold ? 5000 : 500;

                if (isCacheCold) {
                  console.log(
                    `[Analysis] Step ${i + 1}: CAG CACHE COLD (gap=${Math.floor(gapSinceLastActivity / 1000)}s > ${Math.floor(ANTHROPIC_CACHE_TTL_MS / 1000)}s) - reinserting FULL context from all previous steps`,
                  );
                  controller.enqueue(
                    encoder.encode(
                      `\n[CAG Cache Cold - Reinserting full context from ${previousSteps.filter((s) => s.stepIndex < i).length} previous steps]\n`,
                    ),
                  );
                }

                previousStepsContext = "\n\nPREVIOUS ANALYSIS STEPS:\n";
                for (const prevStep of previousSteps) {
                  if (prevStep.stepIndex < i) {
                    const analysisText = prevStep.analysisText ?? "";
                    const truncatedText =
                      analysisText.length > maxContextPerStep
                        ? analysisText.substring(0, maxContextPerStep) + "..."
                        : analysisText;
                    previousStepsContext += `\nStep ${prevStep.stepIndex + 1} (${prevStep.stepName}):\n${truncatedText}\n`;
                  }
                }
                console.log(
                  `[Analysis] Step ${i + 1}: Including ${previousSteps.filter((s) => s.stepIndex < i).length} previous steps in context (maxChars=${maxContextPerStep}, cacheCold=${isCacheCold})`,
                );
              }

              let stepInstructions = `\n\nSTEP ${i + 1} of ${steps.length}: ${step.name}\n\n${step.description}\n\n${step.systemPrompt}`;

              if (
                step.verificationSettings?.legalAuthorityVerification?.enabled
              ) {
                console.log(
                  `[Analysis] Step ${i + 1}: Injecting enhanced citation enforcement prompt into user message`,
                );
                controller.enqueue(
                  encoder.encode(
                    `[Analysis] Step ${i + 1}: Citation enforcement enabled\n`,
                  ),
                );
                stepInstructions += `\n\n${ENHANCED_CITATION_ENFORCEMENT_PROMPT}`;
              }

              // Inject case law extraction workflow prompt when both tools are available
              const hasCaseLawTools =
                step.availableTools?.includes("courtlistener-search") &&
                step.availableTools?.includes("programmatic-quote-extraction");
              if (hasCaseLawTools) {
                console.log(
                  `[Analysis] Step ${i + 1}: Injecting case law extraction workflow prompt`,
                );
                controller.enqueue(
                  encoder.encode(
                    `[Analysis] Step ${i + 1}: Case law extraction workflow enabled\n`,
                  ),
                );
                stepInstructions += `\n\n${CASE_LAW_EXTRACTION_WORKFLOW_PROMPT}`;
              }

              if (i + 1 >= 10 && i + 1 <= 30) {
                stepInstructions += `\n\nAnalyze the provided documents according to this step's instructions. Use external tools for legal research, case law verification, and statute lookups as needed.`;
              } else {
                stepInstructions += `\n\nAnalyze the provided documents according to this step's instructions. The document text is already provided above - analyze it directly. Use external tools only if you need additional context or verification.`;
              }

              const modelStartTime = Date.now();
              const analysisModel = providerConfig.modelName;
              const modelMaxTokens = getModelMaxOutputTokens(analysisModel);
              const rawMaxTokens = globalTokenOverride.enabled
                ? globalTokenOverride.maxOutputTokens
                : step.modelParams.maxTokens || 50000;
              // Cap to model's actual max output token limit to avoid API errors
              const effectiveMaxTokens = Math.min(rawMaxTokens, modelMaxTokens);
              logger.modelStart({
                stepIndex: i + 1,
                provider: providerConfig.providerType,
                model: analysisModel,
                maxOutputTokens: effectiveMaxTokens,
                temperature: step.modelParams.temperature || 0.7,
              });

              // NOTE: toolCallTracker and completedToolCalls removed - tool logging now happens after stream completes

              // Reporting step IDs - defined before tool availability logging so
              // pre-emptive tool disable is reflected in telemetry records.
              const REPORTING_STEP_IDS = [
                "step-40-executive-summary",
                "step-41-quality-gate",
                "step-42-paralegal-checklist",
                "step-43-lessons-learned",
              ];
              const REPORTING_MIN_CHARS = 500; // Minimum chars for substantive content

              // Pre-emptive retry mode: if finalization has already rolled back this session
              // for empty reporting steps, OR if a critical step previously errored out,
              // disable tools from the FIRST attempt to avoid the model spending its
              // entire budget on tool calls again.
              // This MUST run before toolsOffered capture so telemetry is accurate.
              const rvRetryCount =
                typeof existingMetadata?.reportingValidationRetryCount ===
                "number"
                  ? existingMetadata.reportingValidationRetryCount
                  : 0;
              const criticalErrorRetryCount =
                typeof existingMetadata?.criticalStepErrorRetries === "number"
                  ? existingMetadata.criticalStepErrorRetries
                  : 0;
              const isRollbackRetry =
                rvRetryCount > 0 || criticalErrorRetryCount > 0;
              const isCriticalStepPreCheck =
                step.id && REPORTING_STEP_IDS.includes(step.id);

              if (isRollbackRetry && isCriticalStepPreCheck) {
                // Pre-emptively disable tools so the model is forced to
                // generate text-only output from the analysis context.
                stepTools = {};
                console.log(
                  `[Analysis] Pre-emptive tool disable for critical step ${i + 1} (${step.name}) — ` +
                    `session was rolled back ${rvRetryCount} time(s) for empty output, ${criticalErrorRetryCount} time(s) for step errors - session ${sessionId}`,
                );

                controller.enqueue(
                  encoder.encode(
                    `\n⚠️ Step ${i + 1} (${step.name}): Using text-only mode (previous attempts produced empty output).\n`,
                  ),
                );
              }

              const toolsOffered = Object.keys(stepTools);
              console.log(
                `[Analysis] Step ${i + 1} tools offered: ${toolsOffered.length > 0 ? toolsOffered.join(", ") : "none"}`,
              );

              logStepToolAvailability(
                sessionId,
                i,
                step.name,
                toolsOffered,
              ).catch((err) => {
                console.error(
                  `[Analysis] Failed to log tools offered for step ${i + 1}:`,
                  err,
                );
              });

              // ============================================================
              // CAG (Cache Augmented Generation) Optimization
              // ============================================================
              // Structure prompts for optimal Anthropic prompt caching:
              // 1. System prompt (stable across all steps) - CACHE BREAKPOINT
              // 2. Document content (large, static) - CACHE BREAKPOINT
              // 3. Previous steps context (grows but prefix is stable)
              // 4. Current step instructions (changes each step)
              //
              // By placing cache breakpoints on stable content, Anthropic can
              // reuse cached tokens across all 50 steps, reducing cost by up to
              // 90% and latency by up to 85%.
              // ============================================================

              // Build the user message with document context and step instructions
              // Document content comes first (largest cacheable block)
              const documentContextMessage = `${caseContextText}DOCUMENTS:\n${documentText}`;

              // Previous steps context comes second (grows but prefix is stable)
              // Current step instructions come last (changes each step)
              const stepUserMessage = previousStepsContext + stepInstructions;

              const maxEnforcementRetries = 3;
              const maxEmptyRetries = 2; // Max retries for empty output detection
              let enforcementAttempt = 0;
              let emptyRetryCount = 0;
              let rateLimitRetryCount = 0; // Track rate limit retries across enforcement attempts
              let stepText = "";
              let iterateStepCalled = false; // Track if iterate-step tool was called to prevent double iteration
              let enforcementResult: any = null;
              let finalResult: any = null;
              let toolCalls: any = null;
              let toolResults: any = null;
              let usage: any = null;

              // Build messages array with cache control breakpoints
              // For Anthropic: enable prompt caching (CAG) via providerOptions.anthropic.cacheControl
              // For non-Anthropic: skip provider-specific options (local models handle caching server-side)
              let conversationMessages: Array<{
                role: "user" | "assistant" | "system";
                content: string;
                providerOptions?: {
                  anthropic?: {
                    cacheControl?: { type: "ephemeral" };
                  };
                };
              }> = [
                {
                  role: "system",
                  content: effectiveSystemPrompt,
                  ...(isAnthropic && {
                    providerOptions: {
                      anthropic: {
                        cacheControl: { type: "ephemeral" },
                      },
                    },
                  }),
                },
                {
                  role: "user",
                  content: documentContextMessage,
                  ...(isAnthropic && {
                    providerOptions: {
                      anthropic: {
                        cacheControl: { type: "ephemeral" },
                      },
                    },
                  }),
                },
                {
                  role: "user",
                  content: stepUserMessage,
                },
              ];

              // Inject directive prompt for critical steps after rollback.
              // This MUST be done after conversationMessages is built (above) because
              // stepUserMessage is constructed before the rollback-retry check and
              // cannot be modified retroactively.
              if (isRollbackRetry && isCriticalStepPreCheck) {
                conversationMessages.push({
                  role: "user",
                  content:
                    `CRITICAL: Previous attempts to generate "${step.name}" produced NO visible text output. ` +
                    `You MUST generate substantive text content for this step. Do NOT attempt to use any tools — ` +
                    `all the analysis from previous steps is already available to you in the conversation context above. ` +
                    `Synthesize a comprehensive ${step.name} based on the analysis already completed. ` +
                    `Your response MUST contain at least 500 characters of substantive content.`,
                });
              }

              while (enforcementAttempt < maxEnforcementRetries) {
                enforcementAttempt++;

                if (enforcementAttempt > 1) {
                  controller.enqueue(
                    encoder.encode(
                      `\n🔄 Retry attempt ${enforcementAttempt}/${maxEnforcementRetries} for step ${i + 1}\n`,
                    ),
                  );
                }

                // Get maxSteps from step config - this enables multi-step tool calling
                // Without maxSteps, the stream ends after the first tool call without continuation
                // Enforce minimum maxSteps for critical reporting steps regardless of workflow config source
                // (DB workflow configs may have stale/low values that cause truncation)
                const CRITICAL_STEP_MIN_MAX_STEPS = 50;
                const isCriticalStep =
                  step.id && REPORTING_STEP_IDS.includes(step.id);
                const configMaxSteps = step.modelParams.maxSteps || 10;
                const stepMaxSteps = isCriticalStep
                  ? Math.max(configMaxSteps, CRITICAL_STEP_MIN_MAX_STEPS)
                  : configMaxSteps;

                // Track NoOutputGeneratedError retries within the enforcement loop
                // When the model exhausts maxSteps doing tool calls without generating text,
                // AI SDK throws NoOutputGeneratedError. We catch it here (inside the
                // while loop) so we can retry with doubled maxSteps instead of letting it
                // propagate to the outer catch which would mark critical steps as permanently failed.
                let noOutputError: Error | null = null;

                // CAG Optimization: System prompt is now in messages array with cacheControl
                // Do NOT use the `system:` parameter - it would duplicate the system prompt
                const result = streamText({
                  model: anthropic(analysisModel),
                  // system: removed - now in messages array with cacheControl for CAG
                  messages: conversationMessages,
                  tools:
                    Object.keys(stepTools).length > 0
                      ? (stepTools as any)
                      : undefined,
                  temperature: step.modelParams.temperature || 0.7,
                  maxOutputTokens: effectiveMaxTokens,
                  abortSignal: abortController.signal,
                  onFinish: async (event: any) => {
                    const usage = event?.usage;
                    const experimental_providerMetadata =
                      event?.experimental_providerMetadata;
                    // Enhanced CAG cache metadata logging
                    const cacheMetadata =
                      experimental_providerMetadata?.anthropic as
                        | {
                            cacheCreationInputTokens?: number;
                            cacheReadInputTokens?: number;
                          }
                        | undefined;

                    if (cacheMetadata) {
                      const cacheHitRate =
                        cacheMetadata.cacheReadInputTokens &&
                        usage?.promptTokens
                          ? (
                              (cacheMetadata.cacheReadInputTokens /
                                usage.promptTokens) *
                              100
                            ).toFixed(1)
                          : "0";

                      console.log(`[Analysis] Step ${i + 1} CAG cache stats:`, {
                        cacheCreationInputTokens:
                          cacheMetadata.cacheCreationInputTokens || 0,
                        cacheReadInputTokens:
                          cacheMetadata.cacheReadInputTokens || 0,
                        totalPromptTokens: usage?.promptTokens || 0,
                        cacheHitRate: `${cacheHitRate}%`,
                      });

                      // Emit cache stats to stream for visibility
                      controller.enqueue(
                        encoder.encode(
                          `\n[CAG] Cache read: ${cacheMetadata.cacheReadInputTokens || 0} tokens, Cache created: ${cacheMetadata.cacheCreationInputTokens || 0} tokens (${cacheHitRate}% hit rate)\n`,
                        ),
                      );
                    }
                  },
                  // NOTE: onChunk removed to fix streaming corruption - tool feedback now appears after stream completes
                });

                stepText = "";
                const exampleDetector = new StreamingExampleDetector();
                noOutputError = null;

                try {
                  for await (const chunk of result.textStream) {
                    stepText += chunk;
                    controller.enqueue(encoder.encode(chunk));

                    await updateHeartbeat();

                    const exampleMatch = exampleDetector.addChunk(chunk);
                    if (exampleMatch) {
                      const allMatches = detectAllPieces(
                        exampleDetector["buffer"],
                      );
                      const errorMsg = generateFallbackErrorMessage(
                        exampleMatch,
                        allMatches,
                      );
                      controller.enqueue(
                        encoder.encode(`\n\n❌ ERROR: ${errorMsg}\n\n`),
                      );
                      throw new Error(
                        `EXAMPLE_FALLBACK_DETECTED: ${exampleMatch.token}`,
                      );
                    }
                  }
                } catch (streamError: unknown) {
                  const err =
                    streamError instanceof Error
                      ? streamError
                      : new Error(String(streamError));

                  // --- Rate Limit / Overload Retry with Exponential Backoff ---
                  // When Anthropic returns 429 (rate limit) or 529 (overload), wait and retry
                  // instead of immediately failing the step. This prevents entire sessions from
                  // failing when concurrent sessions temporarily exceed the rate limit.
                  //
                  // IMPORTANT: Only retry in-place if no text was already streamed to the client.
                  // If partial text was streamed before the error, retrying would duplicate that
                  // text in the client output. In that case, throw to the outer handler so the
                  // orchestrator can resume cleanly from the step boundary.
                  const rateLimitCheck = isRateLimitOrOverloadError(err);
                  if (rateLimitCheck.isTransient && stepText.length === 0) {
                    rateLimitRetryCount++;
                    const maxRateLimitRetries =
                      DEFAULT_RATE_LIMIT_RETRY_CONFIG.maxRetries;

                    if (rateLimitRetryCount <= maxRateLimitRetries) {
                      const retryDelay = calculateRateLimitDelay(
                        rateLimitRetryCount - 1,
                        DEFAULT_RATE_LIMIT_RETRY_CONFIG,
                        rateLimitCheck.retryAfterMs,
                      );

                      // Check if we have enough time budget remaining for a retry
                      if (
                        hasTimeBudgetForRetry(
                          startTime,
                          timeBudgetMs,
                          retryDelay,
                          DEFAULT_RATE_LIMIT_RETRY_CONFIG,
                        )
                      ) {
                        const errorType = rateLimitCheck.isOverload
                          ? "OVERLOAD_529"
                          : "RATE_LIMIT_429";
                        const delaySec = Math.round(retryDelay / 1000);
                        const remainingMs =
                          timeBudgetMs - (Date.now() - startTime);

                        console.warn(
                          `[Analysis] Step ${i + 1} (${step.name}) hit ${errorType} - ` +
                            `waiting ${delaySec}s before retry ${rateLimitRetryCount}/${maxRateLimitRetries} ` +
                            `(time remaining: ${Math.round(remainingMs / 1000)}s) - session ${sessionId}`,
                        );

                        enhancedLogger.warning({
                          message: `Rate limit backoff: retrying step after ${delaySec}s delay`,
                          context: {
                            stepIndex: i,
                            stepName: step.name,
                            errorType,
                            retryAttempt: rateLimitRetryCount,
                            maxRetries: maxRateLimitRetries,
                            delayMs: retryDelay,
                            remainingBudgetMs: remainingMs,
                            retryAfterMs: rateLimitCheck.retryAfterMs,
                          },
                        });

                        // Notify the stream that we're waiting
                        const retryMsg = formatRateLimitRetryMessage(
                          i,
                          step.name,
                          rateLimitRetryCount - 1,
                          maxRateLimitRetries,
                          retryDelay,
                          rateLimitCheck.isOverload,
                        );
                        controller.enqueue(encoder.encode(retryMsg));

                        // Sleep with heartbeats to keep the stream alive and lock renewed
                        await sleepWithHeartbeat(
                          retryDelay,
                          async () => {
                            await updateHeartbeat();
                          },
                          10000,
                        );

                        // Guard: only retry if the enforcement loop has iterations remaining
                        if (enforcementAttempt >= maxEnforcementRetries) {
                          // Reset enforcement attempt to allow exactly one more iteration for the rate limit retry
                          enforcementAttempt = maxEnforcementRetries - 1;
                          console.log(
                            `[Analysis] Reset enforcement counter for rate limit retry of step ${i + 1} (${step.name}) - session ${sessionId}`,
                          );
                        }

                        continue; // Retry within enforcement loop
                      } else {
                        console.warn(
                          `[Analysis] Step ${i + 1} (${step.name}) hit rate limit but insufficient time budget for retry ` +
                            `(remaining: ${Math.round((timeBudgetMs - (Date.now() - startTime)) / 1000)}s, ` +
                            `needed: ${Math.round((retryDelay + DEFAULT_RATE_LIMIT_RETRY_CONFIG.minTimeBudgetForRetryMs) / 1000)}s) - session ${sessionId}`,
                        );
                        // Fall through to let orchestrator handle via resume-chunk
                      }
                    } else {
                      console.error(
                        `[Analysis] Step ${i + 1} (${step.name}) rate limit retries exhausted (${maxRateLimitRetries}/${maxRateLimitRetries}) - session ${sessionId}`,
                      );
                    }
                    // Rate limit retries exhausted or no time budget - throw to outer handler
                    throw err;
                  } else if (
                    rateLimitCheck.isTransient &&
                    stepText.length > 0
                  ) {
                    // Rate limit hit mid-stream: partial text already sent to client.
                    // Cannot retry in-place without duplicating output. Throw to outer
                    // handler so the orchestrator can resume from the step boundary.
                    console.warn(
                      `[Analysis] Step ${i + 1} (${step.name}) hit rate limit mid-stream ` +
                        `(${stepText.length} chars already streamed) - skipping in-place retry ` +
                        `to avoid duplicate output, deferring to orchestrator - session ${sessionId}`,
                    );
                    throw err;
                  }

                  // Check if this is a NoOutputGeneratedError (model exhausted maxSteps
                  // doing tool calls without producing any text output)
                  const isNoOutputError =
                    err.name === "NoOutputGeneratedError" ||
                    err.message?.includes("No output generated");

                  if (isNoOutputError && isCriticalStep) {
                    // For critical steps, we can retry with doubled maxSteps
                    emptyRetryCount++;
                    console.warn(
                      `[Analysis] Step ${i + 1} (${step.name}) threw NoOutputGeneratedError - ` +
                        `model exhausted maxSteps=${stepMaxSteps} during tool calls without generating text. ` +
                        `Attempt ${emptyRetryCount}/${maxEmptyRetries + 1} - session ${sessionId}`,
                    );

                    if (emptyRetryCount <= maxEmptyRetries) {
                      // Double maxSteps for the retry
                      const currentMaxSteps =
                        step.modelParams.maxSteps || stepMaxSteps;
                      const effectiveBase = Math.max(
                        currentMaxSteps,
                        CRITICAL_STEP_MIN_MAX_STEPS,
                      );
                      step.modelParams.maxSteps = effectiveBase * 2;
                      console.log(
                        `[Analysis] Doubling maxSteps from ${effectiveBase} to ${step.modelParams.maxSteps} ` +
                          `for NoOutputGeneratedError retry of step ${i + 1} (${step.name}) - session ${sessionId}`,
                      );

                      // Guard: only retry if the enforcement loop has iterations remaining.
                      // If enforcementAttempt >= maxEnforcementRetries, the while condition
                      // would be false after `continue`, causing the loop to exit silently
                      // without throwing — leaving the step with empty content and no error.
                      if (enforcementAttempt >= maxEnforcementRetries) {
                        console.warn(
                          `[Analysis] Step ${i + 1} (${step.name}) NoOutputGeneratedError retry blocked - ` +
                            `no enforcement iterations remaining (${enforcementAttempt}/${maxEnforcementRetries}) - session ${sessionId}`,
                        );
                        noOutputError = err;
                      } else {
                        // CRITICAL FIX: Disable tools on retry for critical reporting steps.
                        // The model spends its entire maxSteps budget on tool calls
                        // (e.g., kansas-rules lookups) and produces only a brief preamble
                        // (e.g., 97 chars). Without tools, the model is forced to generate
                        // the full text content using the previous analysis steps as context.
                        // Note: isCriticalStep is used here (defined at line 2504) because
                        // isReportingStep is not defined until after the streaming section.
                        if (isCriticalStep) {
                          stepTools = {};
                          console.log(
                            `[Analysis] Disabling tools for NoOutputGeneratedError retry of reporting step ${i + 1} (${step.name}) - ` +
                              `forcing text-only generation - session ${sessionId}`,
                          );
                        }

                        controller.enqueue(
                          encoder.encode(
                            `\n⚠️ Step ${i + 1} (${step.name}) exhausted tool call budget without generating output. ` +
                              `${isCriticalStep ? "Disabling tools and retrying with text-only generation" : `Increasing budget from ${effectiveBase} to ${step.modelParams.maxSteps} and retrying`} ` +
                              `(${emptyRetryCount}/${maxEmptyRetries})...\n`,
                          ),
                        );

                        // Add continuation prompt to help the model produce text output
                        conversationMessages.push({
                          role: "assistant",
                          content:
                            "[No output was generated - tool call budget exhausted]",
                        });
                        conversationMessages.push({
                          role: "user",
                          content:
                            `The previous attempt for "${step.name}" exhausted the tool call budget without generating any visible text output. ` +
                            `${isCriticalStep ? "Tools have been disabled for this retry. You do not need to look up additional rules or cases — all the analysis from previous steps is already available to you in the conversation context above. " : "You have a larger budget now. "}` +
                            `Please complete the step and make sure to generate substantive text content. ` +
                            `Focus on producing the required analysis output.`,
                        });

                        continue; // Retry within enforcement loop
                      }
                    }

                    // Max retries exhausted or no enforcement iterations left - let it propagate to outer catch
                    if (!noOutputError) {
                      noOutputError = err;
                    }
                    console.error(
                      `[Analysis] Step ${i + 1} (${step.name}) NoOutputGeneratedError persists after ${maxEmptyRetries} retries - session ${sessionId}`,
                    );
                  }

                  // For non-NoOutputGeneratedError errors, or if max retries exhausted,
                  // re-throw to the outer catch block for standard error handling
                  if (!noOutputError) {
                    throw err;
                  }
                }

                // If NoOutputGeneratedError persisted after all retries:
                // For critical steps, DON'T throw — let the code fall through to save
                // the step with empty content. Finalization's rollback will handle it
                // gracefully instead of crashing the entire stream.
                if (noOutputError) {
                  if (isCriticalStep) {
                    console.warn(
                      `[Analysis] Step ${i + 1} (${step.name}) NoOutputGeneratedError persisted — ` +
                        `NOT throwing for critical step, deferring to finalization rollback - session ${sessionId}`,
                    );
                    // stepText is empty; the empty output detection below will fire,
                    // and if retries are also exhausted there, the step saves with 0 chars
                    // so finalizeSession can roll back and retry from scratch.
                  } else {
                    throw noOutputError;
                  }
                }

                // Empty record detection: if stepText is empty, retry the step
                const normalizedStepText = stepText.trim();
                if (normalizedStepText.length === 0) {
                  emptyRetryCount++;
                  console.log(
                    `[Analysis] Step ${i + 1} produced empty output (attempt ${emptyRetryCount}/${maxEmptyRetries + 1})`,
                  );

                  if (emptyRetryCount <= maxEmptyRetries) {
                    // Guard: only retry if the enforcement loop has iterations remaining.
                    // Without this check, `continue` would jump to the while condition which
                    // evaluates to false, causing the loop to exit silently with empty content.
                    if (enforcementAttempt >= maxEnforcementRetries) {
                      console.warn(
                        `[Analysis] Step ${i + 1} (${step.name}) empty output retry blocked - ` +
                          `no enforcement iterations remaining (${enforcementAttempt}/${maxEnforcementRetries}) - session ${sessionId}`,
                      );
                      // Fall through to the max retries exceeded branch below
                    } else {
                      // Disable tools on retry for critical steps.
                      // The model often spends its entire budget on tool calls
                      // (e.g., kansas-rules lookups) without generating text.
                      // Without tools, the model is forced to synthesize from
                      // the previous analysis steps already in context.
                      if (isCriticalStep) {
                        stepTools = {};
                        console.log(
                          `[Analysis] Disabling tools for empty output retry of step ${i + 1} (${step.name}) - ` +
                            `forcing text-only generation - session ${sessionId}`,
                        );
                      }

                      controller.enqueue(
                        encoder.encode(
                          `\n⚠️ Step ${i + 1} produced empty output. ${isCriticalStep ? "Disabling tools and retrying" : "Retrying"} (${emptyRetryCount}/${maxEmptyRetries})...\n`,
                        ),
                      );

                      // Add a continuation prompt to help the model produce output
                      conversationMessages.push({
                        role: "assistant",
                        content: "[No output was generated]",
                      });
                      conversationMessages.push({
                        role: "user",
                        content:
                          `The previous attempt for "${step.name}" produced no visible analysis output. ` +
                          `${isCriticalStep ? "Tools have been disabled for this retry. You do not need to look up additional rules or cases — all the analysis from previous steps is already available to you in the conversation context above. " : ""}` +
                          `Please provide a complete response for this step. Make sure to include substantive analysis content.`,
                      });

                      continue; // Retry this step
                    }
                  }
                  // Max retries exceeded or no enforcement iterations left
                  {
                    // Max retries exceeded - log error and continue with empty content
                    controller.enqueue(
                      encoder.encode(
                        `\n❌ Step ${i + 1} still empty after ${maxEmptyRetries} retries. Marking as failed.\n`,
                      ),
                    );
                    console.error(
                      `[Analysis] Step ${i + 1} (${step.name}) empty after ${maxEmptyRetries} retries - session ${sessionId}`,
                    );
                  }
                }

                // Reporting section detection: check if critical reporting steps have substantive content
                // These are the final reporting steps that users expect to see in the output
                // (REPORTING_STEP_IDS and REPORTING_MIN_CHARS defined before enforcement loop above)
                const isReportingStep =
                  step.id && REPORTING_STEP_IDS.includes(step.id);
                const hasSubstantiveContent =
                  normalizedStepText.length >= REPORTING_MIN_CHARS;

                if (
                  isReportingStep &&
                  !hasSubstantiveContent &&
                  normalizedStepText.length > 0
                ) {
                  // Reporting step has some content but not enough - retry
                  emptyRetryCount++;
                  console.log(
                    `[Analysis] Reporting step ${i + 1} (${step.name}) has insufficient content: ${normalizedStepText.length} chars (min: ${REPORTING_MIN_CHARS}) - attempt ${emptyRetryCount}/${maxEmptyRetries + 1}`,
                  );

                  if (emptyRetryCount <= maxEmptyRetries) {
                    // Guard: only retry if the enforcement loop has iterations remaining.
                    // Without this check, `continue` would jump to the while condition which
                    // evaluates to false, causing the loop to exit silently with insufficient content.
                    if (enforcementAttempt >= maxEnforcementRetries) {
                      console.warn(
                        `[Analysis] Reporting step ${i + 1} (${step.name}) insufficient content retry blocked - ` +
                          `no enforcement iterations remaining (${enforcementAttempt}/${maxEnforcementRetries}) - session ${sessionId}`,
                      );
                      // Fall through to the max retries exceeded branch below
                    } else {
                      // CRITICAL FIX: Disable tools on retry for reporting steps.
                      // The model spends its entire maxSteps budget on tool calls
                      // (e.g., kansas-rules lookups) and produces only a brief preamble
                      // (e.g., 97 chars: "Let me conduct the necessary research...").
                      // Without tools, the model is forced to generate the full checklist/
                      // summary content using the previous analysis steps as context.
                      // Evidence: Session ffe8d4ee step 42 produced only 97 chars with
                      // 2 tool calls and 149 completion tokens despite maxSteps=50.
                      const hadTools = Object.keys(stepTools).length > 0;
                      if (hadTools) {
                        stepTools = {};
                        console.log(
                          `[Analysis] Disabling tools for insufficient content retry of reporting step ${i + 1} (${step.name}) - ` +
                            `forcing text-only generation (previous attempt: ${normalizedStepText.length} chars with tools) - session ${sessionId}`,
                        );
                      }

                      controller.enqueue(
                        encoder.encode(
                          `\n⚠️ Reporting step ${i + 1} (${step.name}) has insufficient content (${normalizedStepText.length} chars, min: ${REPORTING_MIN_CHARS}). ` +
                            `${hadTools ? "Disabling tools and retrying with text-only generation" : "Retrying"} (${emptyRetryCount}/${maxEmptyRetries})...\n`,
                        ),
                      );

                      // Add a continuation prompt to help the model produce more content
                      // When tools are disabled, explicitly tell the model it has all
                      // the information it needs from previous analysis steps
                      conversationMessages.push({
                        role: "assistant",
                        content: stepText,
                      });
                      conversationMessages.push({
                        role: "user",
                        content:
                          `The previous response for "${step.name}" was too brief (${normalizedStepText.length} characters). ` +
                          `This is a critical reporting step that requires comprehensive, substantive content. ` +
                          `${hadTools ? "You do not need to look up additional rules or cases — all the analysis from previous steps is already available to you in the conversation context above. " : ""}` +
                          `Please provide a complete, detailed response with at least ${REPORTING_MIN_CHARS} characters. ` +
                          `Generate the full content now without any preamble like "Let me research..." — go directly into the substantive output.`,
                      });

                      continue; // Retry this step
                    }
                  }
                  // Max retries exceeded or no enforcement iterations left
                  {
                    // Max retries exceeded - log warning but continue
                    controller.enqueue(
                      encoder.encode(
                        `\n⚠️ Reporting step ${i + 1} (${step.name}) still has insufficient content after ${maxEmptyRetries} retries.\n`,
                      ),
                    );
                    console.warn(
                      `[Analysis] Reporting step ${i + 1} (${step.name}) has only ${normalizedStepText.length} chars after ${maxEmptyRetries} retries - session ${sessionId}`,
                    );
                  }
                }

                finalResult = await result;
                toolCalls = await finalResult.toolCalls;
                toolResults = await finalResult.toolResults;
                usage = await finalResult.usage;

                // Log tool calls after streaming completes (moved from onChunk to fix streaming corruption)
                if (toolCalls && toolCalls.length > 0) {
                  controller.enqueue(
                    encoder.encode(
                      `\n🔧 Tools used: ${toolCalls.map((tc: { toolName: string }) => tc.toolName).join(", ")}\n`,
                    ),
                  );

                  // Log each tool call for telemetry
                  // Use Promise.all with individual try-catch to ensure all tool calls are logged
                  // even if one fails, and to prevent blocking the main flow
                  const toolLogPromises = toolCalls.map(
                    async (
                      call: {
                        toolName: string;
                        toolCallId: string;
                        args: unknown;
                      },
                      j: number,
                    ) => {
                      try {
                        const callResult = toolResults?.[j];
                        const toolOutput =
                          callResult?.result ?? callResult?.output;

                        // Safely stringify args to prevent "Cannot read properties of undefined (reading 'substring')" errors
                        const argsJson = JSON.stringify(call.args ?? {});
                        enhancedLogger.toolCall({
                          stepIndex: i,
                          toolName: call.toolName,
                          toolCallId: call.toolCallId,
                          category: undefined,
                          argsPreview: argsJson.substring(0, 200),
                          argsSize: argsJson.length,
                        });

                        // Safely stringify toolOutput to prevent "Cannot read properties of undefined (reading 'substring')" errors
                        const outputJson =
                          typeof toolOutput === "string"
                            ? toolOutput
                            : JSON.stringify(toolOutput ?? {});
                        enhancedLogger.toolResult({
                          stepIndex: i,
                          toolName: call.toolName,
                          toolCallId: call.toolCallId,
                          status: "success",
                          durationMs: 0, // Duration tracking removed - not critical
                          resultSize: outputJson.length,
                          resultPreview: outputJson.substring(0, 200),
                        });

                        // Persist to database - use .catch() to prevent failures from blocking other logs
                        await logToolCall(
                          {
                            analysisSessionId: sessionId,
                            stepIndex: i,
                            stepName: step.name,
                          },
                          call.toolName,
                          undefined, // category
                          call.args,
                          toolOutput,
                          new Date(), // startedAt - approximate
                          new Date(), // completedAt - approximate
                          {},
                        );
                        console.log(
                          `[Analysis] Successfully logged tool call ${j + 1}/${toolCalls.length}: ${call.toolName} for step ${i + 1}`,
                        );
                      } catch (err) {
                        console.error(
                          `[Analysis] Failed to log tool call ${j + 1}/${toolCalls.length} (${call.toolName}) for step ${i + 1}:`,
                          err,
                        );
                      }
                    },
                  );

                  // Wait for all tool logs to complete (or fail gracefully)
                  await Promise.all(toolLogPromises);
                  console.log(
                    `[Analysis] Completed logging ${toolCalls.length} tool calls for step ${i + 1}`,
                  );

                  // Update tool usage count
                  updateStepToolUsageCount(
                    sessionId,
                    i,
                    toolCalls.length,
                  ).catch((err) => {
                    console.error(
                      `[Analysis] Failed to update tools used count for step ${i + 1}:`,
                      err,
                    );
                  });
                }

                // Handle iteration markers (moved from onChunk to fix streaming corruption)
                if (toolResults) {
                  for (const callResult of toolResults) {
                    const toolOutput = callResult?.result ?? callResult?.output;

                    if (
                      toolOutput &&
                      typeof toolOutput === "object" &&
                      "__iterationMarker" in toolOutput &&
                      (toolOutput as { __iterationMarker: boolean })
                        .__iterationMarker
                    ) {
                      iterateStepCalled = true;

                      const iterationRequest = toolOutput as {
                        __iterationMarker: boolean;
                        items: Array<{
                          identifier: string;
                          displayName: string;
                          sourceLocation?: string;
                          itemType?: string;
                          extractedContext?: string;
                        }>;
                        iterationInstructions?: string;
                      };

                      console.log(
                        `[Analysis] Iteration requested for ${iterationRequest.items.length} items`,
                      );
                      controller.enqueue(
                        encoder.encode(
                          `\n🔄 Starting iterative analysis for ${iterationRequest.items.length} items...\n`,
                        ),
                      );

                      try {
                        const iterativeResult = await executeIterativeStep(
                          step,
                          iterationRequest.items,
                          documentText,
                          fullAnalysis,
                          iterationRequest.iterationInstructions,
                          (result, index, total) => {
                            const progressMsg = `\n📋 Iteration ${index + 1}/${total}: ${result.itemDisplayName}${result.success ? "" : " (FAILED)"}\n`;
                            controller.enqueue(encoder.encode(progressMsg));
                          },
                        );

                        let iterationResultsText = `\n\n### Iterative Analysis Results\n\n`;
                        iterationResultsText += `Completed ${iterativeResult.successfulItems}/${iterativeResult.totalItems} iterations successfully.\n\n`;

                        for (const ir of iterativeResult.allIterations) {
                          iterationResultsText += `#### ${ir.itemDisplayName}\n`;
                          if (ir.success) {
                            iterationResultsText += `${ir.analysisText}\n\n`;
                          } else {
                            iterationResultsText += `*Analysis failed: ${ir.error}*\n\n`;
                          }
                        }

                        if (iterativeResult.aggregatedSummary) {
                          iterationResultsText += `#### Synthesis\n${iterativeResult.aggregatedSummary}\n\n`;
                        }

                        stepText += iterationResultsText;
                        controller.enqueue(
                          encoder.encode(iterationResultsText),
                        );

                        console.log(
                          `[Analysis] Iteration complete: ${iterativeResult.successfulItems}/${iterativeResult.totalItems} successful`,
                        );
                      } catch (iterationError) {
                        const errorMsg = `\n❌ Iteration execution failed: ${iterationError instanceof Error ? iterationError.message : "Unknown error"}\n`;
                        controller.enqueue(encoder.encode(errorMsg));
                        console.error(
                          "[Analysis] Iteration execution error:",
                          iterationError,
                        );
                      }
                    }
                  }
                }

                const modelDurationMs = Date.now() - modelStartTime;
                const finishReason = await finalResult.finishReason;
                logger.modelFinish({
                  stepIndex: i + 1,
                  durationMs: modelDurationMs,
                  stopReason: finishReason,
                  outputTokens: usage?.outputTokens,
                  inputTokens: usage?.inputTokens,
                  truncated: finishReason === "length",
                  outputPreview: stepText.substring(0, 300),
                });

                if (toolCalls) {
                  allToolCalls.push(...toolCalls);
                }
                if (toolResults) {
                  allToolResults.push(...toolResults);
                }
                if (usage) {
                  totalUsage.promptTokens += usage.inputTokens || 0;
                  totalUsage.completionTokens += usage.outputTokens || 0;
                  totalUsage.totalTokens += usage.totalTokens || 0;
                }

                // DIAGNOSTIC: Log verification settings check for every step
                const verificationDiagnostic = {
                  stepIndex: i + 1,
                  stepId: step.id,
                  stepName: step.name,
                  hasVerificationSettings: !!step.verificationSettings,
                  hasLegalAuthorityVerification:
                    !!step.verificationSettings?.legalAuthorityVerification,
                  legalAuthorityEnabled:
                    step.verificationSettings?.legalAuthorityVerification
                      ?.enabled,
                  verificationSettingsKeys: step.verificationSettings
                    ? Object.keys(step.verificationSettings)
                    : [],
                  fullVerificationSettings: step.verificationSettings,
                  timestamp: new Date().toISOString(),
                };
                console.log(
                  `[Analysis Stream] DIAGNOSTIC: Step ${i + 1} (${step.name}) verification settings check:`,
                  verificationDiagnostic,
                );
                controller.enqueue(
                  encoder.encode(
                    `[DIAGNOSTIC] Step ${i + 1} verification check: hasSettings=${!!step.verificationSettings}, enabled=${step.verificationSettings?.legalAuthorityVerification?.enabled}\n`,
                  ),
                );

                // Collect verification diagnostic for batch persistence at end of chunk
                verificationDiagnosticsArray.push(verificationDiagnostic);

                if (
                  step.verificationSettings?.legalAuthorityVerification?.enabled
                ) {
                  controller.enqueue(
                    encoder.encode(`\n[Verifying citations...]\n`),
                  );

                  try {
                    const maxRetries =
                      step.verificationSettings.legalAuthorityVerification
                        .maxRetries || 5;

                    enforcementResult = await enforcer.enforceVerification(
                      stepText,
                      step.verificationSettings,
                      maxRetries,
                    );

                    console.log(
                      `[Analysis Stream] Step ${i + 1} enforcement result:`,
                      {
                        success: enforcementResult.success,
                        attempts: enforcementResult.attempts,
                        verifiedCount:
                          enforcementResult.verifiedCitations.length,
                        failedCount: enforcementResult.failedCitations.length,
                        retryMessages: enforcementResult.retryMessages.length,
                      },
                    );

                    if (
                      !enforcementResult.success &&
                      enforcementResult.retryMessages.length > 0 &&
                      enforcementAttempt < maxEnforcementRetries
                    ) {
                      controller.enqueue(
                        encoder.encode(
                          `\n❌ ENFORCEMENT FAILURE:\n${enforcementResult.retryMessages.join("\n\n")}\n`,
                        ),
                      );

                      conversationMessages.push({
                        role: "assistant",
                        content: stepText,
                      });
                      conversationMessages.push({
                        role: "user",
                        content: enforcementResult.retryMessages.join("\n\n"),
                      });

                      continue;
                    }

                    if (
                      enforcementResult.contextualAnalyses &&
                      enforcementResult.contextualAnalyses.length > 0
                    ) {
                      allContextualAnalyses.push(
                        ...enforcementResult.contextualAnalyses,
                      );
                    }

                    if (enforcementResult.verifiedCitations.length > 0) {
                      for (const citation of enforcementResult.verifiedCitations) {
                        for (const authority of citation.authorities) {
                          allVerificationStats.total++;
                          allVerificationStats.verified++;
                          allVerifiedAuthorities.push({
                            citation: authority.citation,
                            url: authority.url,
                            verified: true,
                            quote: authority.quote,
                            type: authority.type,
                            attribution: authority.attribution,
                          });
                        }
                      }
                    }

                    if (enforcementResult.failedCitations.length > 0) {
                      for (const citation of enforcementResult.failedCitations) {
                        for (const authority of citation.authorities) {
                          allVerificationStats.total++;
                          allVerificationStats.failed++;
                          allVerifiedAuthorities.push({
                            citation: authority.citation,
                            url: authority.url,
                            verified: false,
                            quote: authority.quote,
                            type: authority.type,
                            attribution: authority.attribution,
                            note: "Failed verification after maximum retries",
                          });
                        }
                      }
                    }

                    if (enforcementResult.success) {
                      break;
                    }
                  } catch (verificationError: unknown) {
                    const errorMessage =
                      verificationError instanceof Error
                        ? verificationError.message
                        : String(verificationError);
                    console.error(
                      `[Analysis Stream] Verification error in step ${i + 1}:`,
                      verificationError,
                    );
                    controller.enqueue(
                      encoder.encode(
                        `\n⚠️ Warning: Citation verification failed: ${errorMessage}\n`,
                      ),
                    );
                  }
                } else {
                  break;
                }

                if (enforcementAttempt >= maxEnforcementRetries) {
                  controller.enqueue(
                    encoder.encode(
                      `\n⚠️ Warning: Maximum enforcement retries (${maxEnforcementRetries}) reached for step ${i + 1}\n`,
                    ),
                  );
                  break;
                }
              }

              // Strip any leaked AI tool call XML (<function_calls>, <invoke>, etc.)
              // from step text before accumulating into fullAnalysis.
              // NOTE: cleanedStepText for DB persistence is computed AFTER the auto-iteration
              // block below, so that iteration results are included in the persisted text.
              fullAnalysis += stripToolCallXml(stepText) + "\n\n";

              // ============================================================
              // AUTOMATIC ITERATION TRIGGERING
              // If step has iterativeConfig.enabled and itemExtractionMode is "ai-identified",
              // automatically extract items from the AI's response and trigger iteration
              // Skip if iterate-step tool was already called (to prevent double iteration)
              // ============================================================
              if (shouldAutoIterate(step) && !iterateStepCalled) {
                console.log(
                  `[Analysis] Step ${i + 1} (${step.name}): Checking for automatic iteration`,
                );

                // Determine item type based on step ID
                let itemType = "cited_authority";
                if (step.id?.includes("adverse")) {
                  itemType = "adverse_authority";
                } else if (step.id?.includes("supportive")) {
                  itemType = "supportive_authority";
                }

                // Fix 4: Slice stepText at "### Iterative Analysis Results" to avoid
                // re-extracting items from previously appended iteration results
                const textForExtraction = stepText.includes(
                  "### Iterative Analysis Results",
                )
                  ? stepText.split("### Iterative Analysis Results")[0]
                  : stepText;

                // Extract items from the AI's initial response (before any iteration results)
                const extractedItems = extractIterationItemsFromText(
                  textForExtraction,
                  itemType,
                );

                if (extractedItems.length > 0) {
                  console.log(
                    `[Analysis] Step ${i + 1}: Found ${extractedItems.length} items for automatic iteration`,
                  );

                  controller.enqueue(
                    encoder.encode(
                      `\n🔄 Auto-iteration: Found ${extractedItems.length} items to brief. Starting iterative analysis...\n`,
                    ),
                  );

                  try {
                    const iterativeResult = await executeIterativeStep(
                      step,
                      extractedItems,
                      documentText,
                      fullAnalysis, // Prior step results
                      undefined, // No additional instructions
                      (result, index, total) => {
                        // Stream iteration progress
                        const progressMsg = `\n📋 Iteration ${index + 1}/${total}: ${result.itemDisplayName}${result.success ? "" : " (FAILED)"}\n`;
                        controller.enqueue(encoder.encode(progressMsg));
                      },
                    );

                    // Add iteration results to step text
                    let iterationResultsText = `\n\n### Iterative Analysis Results\n\n`;
                    iterationResultsText += `Completed ${iterativeResult.successfulItems}/${iterativeResult.totalItems} iterations successfully.\n\n`;

                    for (const ir of iterativeResult.allIterations) {
                      iterationResultsText += `#### ${ir.itemDisplayName || "Unknown Item"}\n`;
                      if (ir.success && ir.analysisText) {
                        iterationResultsText += `${ir.analysisText}\n\n`;
                      } else if (ir.success && !ir.analysisText) {
                        iterationResultsText += `*No analysis text was generated for this item.*\n\n`;
                      } else {
                        iterationResultsText += `*Analysis failed: ${ir.error || "Unknown error"}*\n\n`;
                      }
                    }

                    if (iterativeResult.aggregatedSummary) {
                      iterationResultsText += `#### Synthesis\n${iterativeResult.aggregatedSummary}\n\n`;
                    }

                    // Append to step text and full analysis
                    stepText += iterationResultsText;
                    fullAnalysis += stripToolCallXml(iterationResultsText);
                    controller.enqueue(encoder.encode(iterationResultsText));

                    console.log(
                      `[Analysis] Step ${i + 1}: Auto-iteration complete: ${iterativeResult.successfulItems}/${iterativeResult.totalItems} successful`,
                    );
                  } catch (iterationError) {
                    const errorMsg = `\n❌ Auto-iteration failed: ${iterationError instanceof Error ? iterationError.message : "Unknown error"}\n`;
                    controller.enqueue(encoder.encode(errorMsg));
                    console.error(
                      `[Analysis] Step ${i + 1}: Auto-iteration error:`,
                      iterationError,
                    );
                  }
                } else {
                  console.log(
                    `[Analysis] Step ${i + 1}: No items extracted for iteration (step may not have identified any cases)`,
                  );
                  controller.enqueue(
                    encoder.encode(
                      `\n⚠️ Auto-iteration: No items found to brief in step output.\n`,
                    ),
                  );
                }
              }

              // CRITICAL: Save original stepText BEFORE injectCitations transforms it
              // injectCitations removes <CitationsJSON> blocks from the text, but we need
              // them for persistStepCitations to parse and persist citations to the database
              const originalStepTextForPersistence = stepText;

              // CITATION MARKER FIX: Inject citation markers [[n]] regardless of verification success
              // Markers are anchors that should exist whenever citations are parsed, not just when verified.
              // This allows Word comments to attach to citations even if verification failed.
              // The verification status is stored in the citation record and can influence styling/comments.
              let citationMarkersInjected = false;

              if (enforcementResult) {
                // Combine verified and failed citations for marker injection
                // All citations should get markers, regardless of verification status
                const allCitations = [
                  ...enforcementResult.verifiedCitations,
                  ...enforcementResult.failedCitations,
                ];

                if (allCitations.length > 0) {
                  const { transformedText, referencesSection } =
                    enforcer.injectCitations(
                      stepText,
                      allCitations,
                      enforcementResult.verificationScores,
                    );
                  stepText = transformedText + referencesSection;
                  citationMarkersInjected = true;

                  // Log marker injection for diagnostics
                  console.log(
                    `[Analysis] Step ${i + 1}: Injected citation markers for ${allCitations.length} citations (${enforcementResult.verifiedCitations.length} verified, ${enforcementResult.failedCitations.length} failed)`,
                  );
                  controller.enqueue(
                    encoder.encode(
                      `\n📌 Citation markers: ${allCitations.length} citations marked (${enforcementResult.verifiedCitations.length} verified, ${enforcementResult.failedCitations.length} unverified)\n`,
                    ),
                  );
                }

                // Still warn about failed citations
                if (
                  !enforcementResult.success &&
                  enforcementResult.failedCitations.length > 0
                ) {
                  controller.enqueue(
                    encoder.encode(
                      `\n⚠️ Warning: ${enforcementResult.failedCitations.length} citations failed verification after ${enforcementAttempt} attempts\n`,
                    ),
                  );
                }
              }

              // FALLBACK: Parse and inject citation markers if:
              // 1. Verification is disabled (enforcementResult is null/undefined), OR
              // 2. Verification ran but found no citations (allCitations.length === 0)
              // This handles reporting steps (Executive Summary, Paralegal Checklist) that
              // don't have verification enabled but may still reference citations.
              if (
                !citationMarkersInjected &&
                stepText.includes("<CitationsJSON>")
              ) {
                const fallbackCitations = enforcer.parseCitationsJSON(stepText);
                if (fallbackCitations && fallbackCitations.length > 0) {
                  console.log(
                    `[Analysis] Step ${i + 1}: Fallback citation injection - found ${fallbackCitations.length} citations in output`,
                  );

                  const { transformedText, referencesSection } =
                    enforcer.injectCitations(stepText, fallbackCitations);
                  stepText = transformedText + referencesSection;
                  citationMarkersInjected = true;

                  controller.enqueue(
                    encoder.encode(
                      `\n📌 Citation markers: ${fallbackCitations.length} citations marked (fallback injection)\n`,
                    ),
                  );
                } else {
                  // Safety net: Strip raw CitationsJSON blocks even if parsing failed
                  // to prevent them from appearing in the final Word document
                  console.log(
                    `[Analysis] Step ${i + 1}: Stripping unparseable CitationsJSON block from output`,
                  );
                  stepText = stepText
                    .replace(/<CitationsJSON>[\s\S]*?<\/CitationsJSON>/gi, "")
                    .replace(/<ContextJSON>[\s\S]*?<\/ContextJSON>/gi, "");
                }
              }

              // CASE-NAME-MATCHING CITATION INJECTION FOR REPORTING STEPS
              // For reporting steps (Executive Summary, Paralegal Checklist) that don't have
              // verification enabled and don't output <CitationsJSON> blocks, we inject
              // citation markers by matching case names from CourtListener tool logs.
              const CASE_MATCHING_REPORTING_STEP_IDS = [
                "step-40-executive-summary",
                "step-41-quality-gate",
                "step-42-paralegal-checklist",
                "step-43-lessons-learned",
              ];
              const isCaseMatchingReportingStep =
                step.id && CASE_MATCHING_REPORTING_STEP_IDS.includes(step.id);

              if (!citationMarkersInjected && isCaseMatchingReportingStep) {
                console.log(
                  `[Analysis] Step ${i + 1}: Attempting case-name-matching citation injection for reporting step`,
                );

                try {
                  // Fetch all CourtListener tool logs for this session
                  const sessionToolLogs = await db
                    .select({
                      toolName: toolCallLogs.toolName,
                      toolOutput: toolCallLogs.toolOutput,
                    })
                    .from(toolCallLogs)
                    .where(eq(toolCallLogs.analysisSessionId, Number(sessionId)));

                  // Extract case data from CourtListener tool logs
                  const caseData =
                    extractCourtListenerUrlsFromToolLogs(sessionToolLogs);

                  if (caseData.length > 0) {
                    console.log(
                      `[Analysis] Step ${i + 1}: Found ${caseData.length} cases from tool logs for citation matching`,
                    );

                    // Inject citation markers based on case name matching
                    const injectionResult = injectCitationMarkersFromToolLogs(
                      stepText,
                      caseData,
                    );

                    if (injectionResult.markerCount > 0) {
                      stepText = injectionResult.transformedText;
                      citationMarkersInjected = true;

                      controller.enqueue(
                        encoder.encode(
                          `\n📌 Citation markers: ${injectionResult.markerCount} markers injected for ${injectionResult.citationMap.size} unique cases (case-name matching)\n`,
                        ),
                      );

                      console.log(
                        `[Analysis] Step ${i + 1}: Case-name-matching injection complete - ${injectionResult.markerCount} markers for ${injectionResult.citationMap.size} cases`,
                      );
                    } else {
                      console.log(
                        `[Analysis] Step ${i + 1}: No case name matches found in step text`,
                      );
                    }
                  } else {
                    console.log(
                      `[Analysis] Step ${i + 1}: No CourtListener case data found in tool logs`,
                    );
                  }
                } catch (toolLogError) {
                  console.error(
                    `[Analysis] Step ${i + 1}: Error fetching tool logs for citation injection:`,
                    toolLogError,
                  );
                }
              }

              if (toolCalls && toolResults) {
                for (let j = 0; j < toolCalls.length; j++) {
                  const call = toolCalls[j];
                  const callResult = toolResults[j];
                  const timestamp = new Date().toISOString();

                  const category =
                    call.toolName.includes("courtlistener") ||
                    call.toolName.includes("legal")
                      ? "legal_research"
                      : call.toolName.includes("tavily") ||
                          call.toolName.includes("search")
                        ? "web_search"
                        : "other";

                  const r = callResult?.result ?? callResult?.output;
                  const err = r?.error ?? callResult?.error;
                  const hasError = err ? true : false;

                  if (hasError) {
                    logger.toolError({
                      stepIndex: i + 1,
                      toolName: call.toolName,
                      durationMs: 0,
                      errorName: "ToolExecutionError",
                      errorMessage: String(err || "Unknown error"),
                    });
                  } else {
                    const resultStr = JSON.stringify(r || {});
                    logger.toolFinish({
                      stepIndex: i + 1,
                      toolName: call.toolName,
                      durationMs: 0,
                      resultSize: resultStr.length,
                      truncatedResult: resultStr.length > 1024,
                    });
                  }

                  const auditEntry: any = {
                    callId: `${sessionId}-step${i + 1}-call${j + 1}`,
                    toolName: call.toolName,
                    category,
                    args: call.args || {},
                    result: r || null,
                    startedAt: timestamp,
                    status: hasError ? "error" : "success",
                    error: err || null,
                  };

                  // DIAGNOSTIC A: Log tool result summaries to transcript
                  if (category === "web_search" && r) {
                    auditEntry.resultSummary = {
                      query: r.query || call.args?.query,
                      totalResults: r.total_results || r.results?.length || 0,
                      searchDepth: r.search_depth,
                    };
                    auditEntry.resultSample = r.results
                      ?.slice(0, 3)
                      .map((item: any) => ({
                        title: item.title,
                        url: item.url,
                        score: item.score,
                      }));

                    const resultCount = auditEntry.resultSummary.totalResults;
                    const firstTitle =
                      auditEntry.resultSample?.[0]?.title || "N/A";
                    controller.enqueue(
                      encoder.encode(
                        `[DIAGNOSTIC] ${call.toolName} found ${resultCount} results. First: "${firstTitle.substring(0, 50)}..."\n`,
                      ),
                    );
                  } else if (category === "legal_research" && r) {
                    auditEntry.resultSummary = {
                      query: call.args?.query,
                      count: r.count || r.results?.length || 0,
                    };
                    auditEntry.resultSample = r.results
                      ?.slice(0, 3)
                      .map(
                        (item: {
                          caseName: string;
                          citation: string;
                          court: string;
                          url: string;
                        }) => ({
                          caseName: item.caseName,
                          citation: item.citation,
                          court: item.court,
                          url: item.url,
                        }),
                      );

                    const resultCount = auditEntry.resultSummary.count;
                    const firstCase =
                      auditEntry.resultSample?.[0]?.caseName || "N/A";

                    if (err) {
                      const status = r?.status || "unknown";
                      const errorMsg = String(err).substring(0, 100);
                      controller.enqueue(
                        encoder.encode(
                          `[DIAGNOSTIC] ${call.toolName} ERROR (status ${status}): ${errorMsg}\n`,
                        ),
                      );
                    } else {
                      controller.enqueue(
                        encoder.encode(
                          `[DIAGNOSTIC] ${call.toolName} found ${resultCount} cases. First: "${firstCase}"\n`,
                        ),
                      );
                    }
                  } else {
                    let outcome = "success";
                    let details = "";
                    if (!r) {
                      if (err) {
                        outcome = "error";
                        const statusMatch =
                          String(err).match(/status[:\s]+(\d+)/i);
                        const status = statusMatch ? statusMatch[1] : "unknown";
                        const errorMsg = String(err).substring(0, 50);
                        details = ` (${status}: ${errorMsg})`;
                      } else {
                        outcome = "empty";
                        details = " (no results found)";
                      }
                    } else if (err) {
                      outcome = "error";
                      const status = r?.status || "unknown";
                      const errorMsg = String(err).substring(0, 50);
                      details = ` (status ${status}: ${errorMsg})`;
                    }
                    controller.enqueue(
                      encoder.encode(
                        `[DIAGNOSTIC] ${call.toolName} result: ${outcome}${details}\n`,
                      ),
                    );
                  }

                  stepAuditEntry.calls.push(auditEntry);

                  auditLog.summary.totalCalls++;
                  auditLog.summary.byTool[call.toolName] =
                    (auditLog.summary.byTool[call.toolName] || 0) + 1;
                  if (!auditLog.summary.firstCallAt) {
                    auditLog.summary.firstCallAt = timestamp;
                  }
                  auditLog.summary.lastCallAt = timestamp;
                }
              }

              if (stepAuditEntry.calls.length > 0) {
                auditLog.steps.push(stepAuditEntry);
              }

              controller.enqueue(
                encoder.encode(
                  `\n✅ Step ${i + 1} complete (${toolCalls?.length || 0} tool calls, ${stepText.length} chars)\n`,
                ),
              );

              try {
                // Use originalStepTextForPersistence which still contains <CitationsJSON> blocks
                // (stepText has had them removed by injectCitations)

                // DIAGNOSTIC: Log enforcementResult details before calling persistStepCitations
                console.log(
                  `[Analysis Stream] DIAGNOSTIC: Before persistStepCitations for step ${i + 1}:`,
                  {
                    hasEnforcementResult: !!enforcementResult,
                    enforcementSuccess: enforcementResult?.success,
                    hasVerificationDetails:
                      !!enforcementResult?.verificationDetails,
                    verificationDetailsSize:
                      enforcementResult?.verificationDetails?.size,
                    verificationDetailsKeys:
                      enforcementResult?.verificationDetails
                        ? Array.from(
                            enforcementResult.verificationDetails.keys(),
                          )
                        : [],
                    verifiedCitationsCount:
                      enforcementResult?.verifiedCitations?.length,
                  },
                );
                controller.enqueue(
                  encoder.encode(
                    `[DIAGNOSTIC] enforcementResult: hasResult=${!!enforcementResult}, success=${enforcementResult?.success}, verificationDetailsSize=${enforcementResult?.verificationDetails?.size || 0}, verifiedCitations=${enforcementResult?.verifiedCitations?.length || 0}\n`,
                  ),
                );

                await persistStepCitations(
                  sessionId,
                  analysisSession.organizationId,
                  i,
                  step,
                  originalStepTextForPersistence,
                  enforcer,
                  controller,
                  encoder,
                  enforcementResult,
                );
              } catch (persistError: unknown) {
                const errorMsg = `\n⚠️ Warning: Citation persistence failed for step ${i + 1}: ${(persistError as Error).message}\n`;
                controller.enqueue(encoder.encode(errorMsg));
              }

              // Unconditionally strip internal structured data blocks before persistence.
              // These blocks are parsed earlier for citation/context persistence but must
              // never remain in the step text saved to the database or rendered in reports.
              stepText = stepText
                .replace(/<CitationsJSON>[\s\S]*?<\/CitationsJSON>/gi, "")
                .replace(/<ContextJSON>[\s\S]*?<\/ContextJSON>/gi, "");

              // Strip any leaked AI tool call XML from step text before persisting.
              // This is computed HERE (after the auto-iteration block) so that any
              // iterationResultsText appended to stepText is included in the cleaned output.
              const cleanedStepText = stripToolCallXml(stepText);
              if (cleanedStepText.length !== stepText.length) {
                console.log(
                  `[Analysis] Step ${i + 1} (${step.name}): Stripped ${stepText.length - cleanedStepText.length} chars of tool call XML before persistence`,
                );
              }

              try {
                await persistAnalysisStep({
                  sessionId,
                  stepIndex: i,
                  stepName: step.name,
                  stepId: step.id,
                  analysisText: cleanedStepText,
                  toolCallCount: toolCalls?.length || 0,
                  usage: usage
                    ? {
                        promptTokens: usage.inputTokens || 0,
                        completionTokens: usage.outputTokens || 0,
                        totalTokens: usage.totalTokens || 0,
                      }
                    : undefined,
                });

                const summary = createStepSummary(
                  i,
                  step.name,
                  cleanedStepText,
                  toolCalls?.length || 0,
                );
                stepsSummary.push(summary);

                controller.enqueue(
                  encoder.encode(
                    `💾 Saved step ${i + 1}/${steps.length} to DB\n`,
                  ),
                );
              } catch (persistError: unknown) {
                const errorMsg = `\n⚠️ Warning: Step persistence failed for step ${i + 1}: ${(persistError as Error).message}\n`;
                controller.enqueue(encoder.encode(errorMsg));
              }

              // Update currentStep after completing this step
              try {
                const stepUpdateResult = await db
                  .update(analysisSessions)
                  .set({ currentStep: i + 1, updatedAt: new Date() })
                  .where(eq(analysisSessions.id, Number(sessionId)));

                // Reset step attempt tracking after successful completion
                await resetStepAttemptState(sessionId);
                controller.enqueue(
                  encoder.encode(
                    `[DIAGNOSTIC] Reset step attempt tracking after successful completion of step ${i + 1}\n`,
                  ),
                );

                lastProgressUpdate = Date.now(); // Mark progress for heartbeat staleness check
                const stepDurationMs = Date.now() - stepStartTime;
                logger.stepFinish({
                  stepIndex: i + 1,
                  durationMs: stepDurationMs,
                  persistedRowsUpdated: stepUpdateResult.rowCount || 0,
                  statusAfter: "processing",
                  nextStepIndex: i + 2,
                });

                enhancedLogger.stepFinish({
                  stepIndex: i,
                  stepName: step.name,
                  durationMs: stepDurationMs,
                  tokensUsed: usage?.totalTokens || 0,
                  inputTokens: usage?.inputTokens || 0,
                  outputTokens: usage?.outputTokens || 0,
                  cacheCreationTokens: usage?.cacheCreationInputTokens || 0,
                  cacheReadTokens: usage?.cacheReadInputTokens || 0,
                  toolCallsCount: toolCalls?.length || 0,
                  verificationAttempts: (stepAuditEntry.calls as any[]).filter(
                    (c: any) => c?.toolName === "verify_legal_authority",
                  ).length,
                  status: "success",
                });

                const durationThreshold = checkPerformanceThreshold(
                  "step_duration",
                  stepDurationMs,
                );
                if (durationThreshold.level === "warn") {
                  enhancedLogger.warning({
                    message: `Step ${i + 1} exceeded duration warning threshold`,
                    context: {
                      stepName: step.name,
                      durationMs: stepDurationMs,
                      thresholdMs: PERFORMANCE_THRESHOLDS.STEP_DURATION_WARN_MS,
                    },
                  });
                } else if (durationThreshold.level === "critical") {
                  enhancedLogger.critical({
                    message: `Step ${i + 1} exceeded duration critical threshold`,
                    context: {
                      stepName: step.name,
                      durationMs: stepDurationMs,
                      thresholdMs:
                        PERFORMANCE_THRESHOLDS.STEP_DURATION_CRITICAL_MS,
                    },
                  });
                }

                if (usage?.outputTokens) {
                  const tokenThreshold = checkPerformanceThreshold(
                    "output_tokens",
                    usage.outputTokens,
                  );
                  if (tokenThreshold.level === "warn") {
                    enhancedLogger.warning({
                      message: `Step ${i + 1} high output token usage`,
                      context: {
                        stepName: step.name,
                        outputTokens: usage.outputTokens,
                        thresholdTokens:
                          PERFORMANCE_THRESHOLDS.OUTPUT_TOKENS_WARN,
                      },
                    });
                  } else if (tokenThreshold.level === "critical") {
                    enhancedLogger.critical({
                      message: `Step ${i + 1} critical output token usage`,
                      context: {
                        stepName: step.name,
                        outputTokens: usage.outputTokens,
                        thresholdTokens:
                          PERFORMANCE_THRESHOLDS.OUTPUT_TOKENS_CRITICAL,
                      },
                    });
                  }
                }

                latestStepIndex = i + 1;

                console.log(
                  `[Analysis Stream] Completed step ${i}, updated currentStep to ${i + 1}`,
                );
              } catch (dbError: unknown) {
                console.error(
                  `[Analysis Stream] Failed to update currentStep after step ${i}:`,
                  dbError,
                );
              }
            } catch (stepError: unknown) {
              const stepErr =
                stepError instanceof Error
                  ? stepError
                  : new Error(String(stepError));
              const stepDurationMs = Date.now() - stepStartTime;

              // Check if this is a genuine abort/timeout error (chunk boundary)
              // NoOutputGeneratedError is NOT an abort - it means the AI model
              // failed to produce text (e.g., hit maxSteps doing tool calls).
              // Treating it as a chunk boundary causes infinite retry at the same step.
              const isAbortError =
                stepErr.name === "AbortError" ||
                stepErr.message?.includes("aborted") ||
                abortController.signal.aborted;

              if (isAbortError) {
                console.warn(
                  `[Analysis Stream] Step ${i + 1} interrupted by abort/timeout:`,
                  {
                    errorName: stepErr.name,
                    errorMessage: stepErr.message,
                    elapsedChunkMs: Date.now() - startTime,
                    timeBudgetMs,
                    signalAborted: abortController.signal.aborted,
                  },
                );

                controller.enqueue(
                  encoder.encode(
                    `\n\n⏱️ Step ${i + 1} interrupted by time limit. Will resume in next chunk...\n`,
                  ),
                );

                stopHeartbeat();

                // Persist current progress without marking as error
                await db
                  .update(analysisSessions)
                  .set({
                    status: "processing",
                    currentStep: i,
                    isResuming: false,
                    continuationCount:
                      (analysisSession.continuationCount || 0) + 1,
                    lastContinuedAt: new Date(),
                    updatedAt: new Date(),
                  })
                  .where(eq(analysisSessions.id, Number(sessionId)));

                console.log(
                  `[Analysis Stream] Abort/timeout at step ${i}. Chunk complete, triggering orchestrator.`,
                );

                // CRITICAL: Release lock on abort/timeout so orchestrator can continue immediately
                // Without this, the orchestrator has to wait for the 5-minute lock TTL to expire
                try {
                  await releaseLock(sessionId, lockId);
                  console.log(
                    `[Analysis Stream] Released lock ${lockId} after abort/timeout at step ${i}`,
                  );
                } catch (lockError) {
                  console.error(
                    `[Analysis Stream] Failed to release lock after abort/timeout:`,
                    lockError,
                  );
                }

                controller.enqueue(
                  encoder.encode(
                    `\n✓ Chunk complete. Orchestrator will continue automatically.\n`,
                  ),
                );

                const baseUrl = getBaseUrl(req);
                const bypass = process.env.INTERNAL_API_TOKEN;

                if (!isInvokedByResumeChunk) {
                  defer(
                    triggerOrchestratorNow(
                      baseUrl,
                      sessionId,
                      sessionOrigin,
                      bypass,
                    ),
                  );
                } else {
                  console.log(
                    `[Analysis Stream] Skipping orchestrator trigger (invoked by resume-chunk, orchestrator will handle continuation)`,
                  );
                }

                controller.close();
                return;
              }

              // This is a genuine step error, not an abort/timeout
              logger.analysisError({
                errorName: stepErr.name || "StepError",
                errorMessage: stepErr.message,
                stackPreview: stepErr.stack?.substring(0, 500),
                persistedStatus: "processing",
                rowsUpdated: 0,
              });

              enhancedLogger.stepFinish({
                stepIndex: i,
                stepName: step.name,
                durationMs: stepDurationMs,
                tokensUsed: 0,
                inputTokens: 0,
                outputTokens: 0,
                cacheCreationTokens: 0,
                cacheReadTokens: 0,
                toolCallsCount: 0,
                verificationAttempts: 0,
                status: "error",
                errorMessage: stepErr.message,
              });

              enhancedLogger.critical({
                message: `Step ${i + 1} failed with error`,
                context: {
                  stepIndex: i,
                  stepName: step.name,
                  errorName: stepErr.name || "StepError",
                  errorMessage: stepErr.message,
                  durationMs: stepDurationMs,
                  stackTrace: stepErr.stack?.substring(0, 1000),
                },
              });

              try {
                const stepErrorMetadata = {
                  stepError: {
                    stepIndex: i,
                    stepId: step.id,
                    stepName: step.name,
                    errorName: stepErr.name || "StepError",
                    errorMessage: stepErr.message,
                    stackPreview: stepErr.stack?.substring(0, 500),
                    timestamp: new Date().toISOString(),
                    durationMs: stepDurationMs,
                  },
                };

                const safeMetadata = existingMetadata ?? {};

                await db
                  .update(analysisSessions)
                  .set({
                    metadata: {
                      ...safeMetadata,
                      ...stepErrorMetadata,
                      lastStepError: stepErrorMetadata.stepError,
                    },
                    updatedAt: new Date(),
                  })
                  .where(eq(analysisSessions.id, Number(sessionId)));

                console.log(
                  `[Analysis Stream] Persisted step ${i + 1} error metadata to session`,
                );

                const metadataBreadcrumb = `\n[METADATA_PERSISTED: Step ${i + 1} error captured]\n`;
                controller.enqueue(encoder.encode(metadataBreadcrumb));
              } catch (metadataError) {
                console.error(
                  `[Analysis Stream] Failed to persist step error metadata:`,
                  metadataError,
                );
                const failureBreadcrumb = `\n[METADATA_PERSIST_FAILED: ${metadataError instanceof Error ? metadataError.message : String(metadataError)}]\n`;
                controller.enqueue(encoder.encode(failureBreadcrumb));
              }

              const errorMsg = `\n\n[ERROR in step ${i + 1}: ${stepErr.message}]\n\n`;
              controller.enqueue(encoder.encode(errorMsg));
              fullAnalysis += errorMsg;

              // ============================================================
              // CRITICAL REPORTING STEP FAILURE HANDLING
              // For critical reporting steps (Executive Summary, Quality Gate, etc.),
              // we must NOT silently continue to the next step. These steps are
              // required for the final report and skipping them produces incomplete reports.
              //
              // RETRY LOGIC: Instead of immediately marking the session as "error",
              // allow up to MAX_CRITICAL_STEP_ERROR_RETRIES orchestrator-level retries.
              // On retry, the session stays "processing" and the orchestrator will
              // re-run the failed step (with tools disabled via pre-emptive check above).
              // ============================================================
              const CRITICAL_REPORTING_STEP_IDS = [
                "step-40-executive-summary",
                "step-41-quality-gate",
                "step-42-paralegal-checklist",
              ];

              // Use both ID-based and name-based matching for resilience against
              // step reordering in dynamic workflows (step IDs change when steps
              // are added/deleted, but names remain consistent).
              const CRITICAL_REPORTING_NAME_PATTERNS = [
                "executive summary",
                "quality gate",
                "paralegal",
                "action checklist",
              ];
              const stepNameLower = (step.name || "").toLowerCase();
              const isCriticalReportingStep =
                (step.id && CRITICAL_REPORTING_STEP_IDS.includes(step.id)) ||
                CRITICAL_REPORTING_NAME_PATTERNS.some((pattern) =>
                  stepNameLower.includes(pattern),
                );

              if (isCriticalReportingStep) {
                // Check if we can retry this critical step via the orchestrator
                const MAX_CRITICAL_STEP_ERROR_RETRIES = 2;
                const previousErrorRetries =
                  typeof existingMetadata?.criticalStepErrorRetries === "number"
                    ? existingMetadata.criticalStepErrorRetries
                    : 0;

                if (previousErrorRetries < MAX_CRITICAL_STEP_ERROR_RETRIES) {
                  // RETRY PATH: Keep session processing, let orchestrator retry
                  console.warn(
                    `[Analysis Stream] Critical step ${i + 1} (${step.name}) failed — ` +
                      `scheduling orchestrator retry (${previousErrorRetries + 1}/${MAX_CRITICAL_STEP_ERROR_RETRIES}) - session ${sessionId}`,
                    {
                      errorMessage: stepErr.message,
                      errorName: stepErr.name || "StepError",
                    },
                  );

                  controller.enqueue(
                    encoder.encode(
                      `\n\n⚠️ Critical step "${step.name}" failed: ${stepErr.message}. ` +
                        `Scheduling retry (${previousErrorRetries + 1}/${MAX_CRITICAL_STEP_ERROR_RETRIES})...\n`,
                    ),
                  );

                  // Delete any partial/failed step record so the retry starts clean
                  try {
                    await db
                      .delete(analysisSteps)
                      .where(
                        and(
                          eq(analysisSteps.analysisSessionId, Number(sessionId)),
                          eq(analysisSteps.stepIndex, i),
                        ),
                      );
                  } catch (deleteErr) {
                    console.error(
                      `[Analysis Stream] Failed to delete failed step record for retry:`,
                      deleteErr,
                    );
                  }

                  // Keep session in "processing" state at the failed step index
                  // so the orchestrator will re-run this exact step
                  stopHeartbeat();
                  stopHardStopTimer();

                  await db
                    .update(analysisSessions)
                    .set({
                      status: "processing",
                      currentStep: i,
                      isResuming: false,
                      continuationCount:
                        (analysisSession.continuationCount || 0) + 1,
                      lastContinuedAt: new Date(),
                      processingLockId: null,
                      processingLockAcquiredAt: null,
                      processingLockExpiresAt: null,
                      processingWorkerType: null,
                      metadata: {
                        ...(existingMetadata ?? {}),
                        criticalStepErrorRetries: previousErrorRetries + 1,
                        lastCriticalStepError: {
                          stepIndex: i,
                          stepId: step.id,
                          stepName: step.name,
                          errorMessage: stepErr.message,
                          errorName: stepErr.name || "StepError",
                          retryAttempt: previousErrorRetries + 1,
                          timestamp: new Date().toISOString(),
                        },
                      },
                      updatedAt: new Date(),
                    })
                    .where(eq(analysisSessions.id, Number(sessionId)));

                  // Release lock so orchestrator can acquire it immediately
                  try {
                    await releaseLock(sessionId, lockId);
                    console.log(
                      `[Analysis Stream] Released lock ${lockId} for critical step retry - session ${sessionId}`,
                    );
                  } catch (lockError) {
                    console.error(
                      `[Analysis Stream] Failed to release lock for critical step retry:`,
                      lockError,
                    );
                  }

                  controller.enqueue(
                    encoder.encode(
                      `\n✓ Retry scheduled. Orchestrator will re-run this step with tools disabled.\n`,
                    ),
                  );

                  // Trigger orchestrator to continue
                  const baseUrl = getBaseUrl(req);
                  const bypass = process.env.INTERNAL_API_TOKEN;

                  if (!isInvokedByResumeChunk) {
                    defer(
                      triggerOrchestratorNow(
                        baseUrl,
                        sessionId,
                        sessionOrigin,
                        bypass,
                      ),
                    );
                  } else {
                    console.log(
                      `[Analysis Stream] Skipping orchestrator trigger for critical step retry (invoked by resume-chunk)`,
                    );
                  }

                  controller.close();
                  return;
                }

                // RETRIES EXHAUSTED: Fall through to permanent failure
                console.error(
                  `[Analysis Stream] CRITICAL: Reporting step ${i + 1} (${step.name}) failed after ${MAX_CRITICAL_STEP_ERROR_RETRIES} retries. ` +
                    `Marking session as error - session ${sessionId}`,
                );

                controller.enqueue(
                  encoder.encode(
                    `\n\n❌ CRITICAL ERROR: Required reporting step "${step.name}" failed after ${MAX_CRITICAL_STEP_ERROR_RETRIES} retries. Analysis cannot continue.\n`,
                  ),
                );

                // Persist the failed step with error metadata so we have a record
                try {
                  await persistAnalysisStep({
                    sessionId,
                    stepIndex: i,
                    stepName: step.name,
                    stepId: step.id,
                    analysisText: `[STEP FAILED after ${MAX_CRITICAL_STEP_ERROR_RETRIES} retries: ${stepErr.message}]`,
                    toolCallCount: 0,
                  });
                  console.log(
                    `[Analysis Stream] Persisted failed critical step ${i + 1} to database`,
                  );
                } catch (persistErr) {
                  console.error(
                    `[Analysis Stream] Failed to persist failed critical step:`,
                    persistErr,
                  );
                }

                // Mark session as error and stop processing
                stopHeartbeat();
                stopHardStopTimer();

                await db
                  .update(analysisSessions)
                  .set({
                    status: "error",
                    currentStep: i,
                    metadata: {
                      ...(existingMetadata ?? {}),
                      criticalStepFailure: {
                        stepIndex: i,
                        stepId: step.id,
                        stepName: step.name,
                        errorMessage: stepErr.message,
                        errorName: stepErr.name || "StepError",
                        timestamp: new Date().toISOString(),
                        retriesExhausted: true,
                        totalRetries: MAX_CRITICAL_STEP_ERROR_RETRIES,
                      },
                    },
                    updatedAt: new Date(),
                  })
                  .where(eq(analysisSessions.id, Number(sessionId)));

                // Cancel continuation jobs so watchdog/orchestrator stop re-triggering
                await failContinuationJob(
                  sessionId,
                  `Critical step "${step.name}" failed after ${MAX_CRITICAL_STEP_ERROR_RETRIES} retries`,
                ).catch((fjErr) =>
                  console.error(
                    `[Analysis Stream] Failed to cancel continuation job after critical step failure:`,
                    fjErr,
                  ),
                );

                controller.enqueue(
                  encoder.encode(
                    `\n\n[Analysis stopped due to critical step failure after ${MAX_CRITICAL_STEP_ERROR_RETRIES} retries. Please retry the analysis.]\n`,
                  ),
                );

                controller.close();
                return;
              }

              // For non-critical steps, persist the failed step with error metadata
              // so we have a record of what happened, then continue to next step
              try {
                await persistAnalysisStep({
                  sessionId,
                  stepIndex: i,
                  stepName: step.name,
                  stepId: step.id,
                  analysisText: `[STEP FAILED: ${stepErr.message}]`,
                  toolCallCount: 0,
                });
                console.log(
                  `[Analysis Stream] Persisted failed step ${i + 1} to database`,
                );
              } catch (persistErr) {
                console.error(
                  `[Analysis Stream] Failed to persist failed step:`,
                  persistErr,
                );
              }

              // Advance past the failed step so the next chunk doesn't retry it forever
              latestStepIndex = i + 1;
              try {
                await db
                  .update(analysisSessions)
                  .set({
                    currentStep: i + 1,
                    updatedAt: new Date(),
                  })
                  .where(eq(analysisSessions.id, Number(sessionId)));
                console.log(
                  `[Analysis Stream] Advanced currentStep to ${i + 1} after non-critical step failure`,
                );
              } catch (advanceErr) {
                console.error(
                  `[Analysis Stream] Failed to advance currentStep after step failure:`,
                  advanceErr,
                );
              }
            }
          }

          controller.enqueue(
            encoder.encode(
              `\n\n[Chunk complete! Processed ${steps.length} steps with ${allToolCalls.length} tool calls]\n`,
            ),
          );

          stopHeartbeat();
          stopHardStopTimer();

          const chunkDurationMs = Date.now() - startTime;

          // latestStepIndex represents the next step to process, so subtract 1 to get last completed
          const lastCompletedStepIndex = Math.max(0, latestStepIndex - 1);
          const lastProcessedStep = steps[lastCompletedStepIndex];
          const persistedFinalStepId = existingMetadata.finalStepId;

          // Check if all steps have been processed (latestStepIndex >= steps.length)
          // This works for both full 35-step workflows and dynamic workflows with fewer steps
          const allStepsProcessed = latestStepIndex >= steps.length;
          const isAtFinalStep = allStepsProcessed;

          console.log(`[Analysis Stream] Finalization check:`, {
            sessionId,
            lastCompletedStepIndex,
            latestStepIndex,
            stepsLength: steps.length,
            allStepsProcessed,
            lastProcessedStepId: lastProcessedStep.id,
            lastProcessedStepName: lastProcessedStep.name,
            persistedFinalStepId,
            isAtFinalStep,
            currentStep: latestStepIndex,
            totalSteps: analysisSession.totalSteps,
            reason: isAtFinalStep ? "final_step_reached" : "chunk_boundary",
            willFinalize: isAtFinalStep,
            willTriggerOrchestrator: !isAtFinalStep,
          });

          enhancedLogger.chunkPerformanceSummary({
            chunkId,
            durationMs: chunkDurationMs,
            stepsCompleted: latestStepIndex,
            totalToolCalls: allToolCalls.length,
            totalTokensUsed: totalUsage.totalTokens || 0,
            cacheCreationTokens: totalUsage.cacheCreationInputTokens || 0,
            cacheReadTokens: totalUsage.cacheReadInputTokens || 0,
          });

          enhancedLogger.orchestrationEvent({
            event: "chunk_complete",
            currentStep: latestStepIndex,
            remainingSteps:
              (analysisSession.totalSteps || steps.length) - latestStepIndex,
            nextAction: isAtFinalStep
              ? "finalize_session"
              : "trigger_orchestrator",
            elapsedMs: chunkDurationMs,
            attemptNumber: analysisSession.continuationCount || 0,
          });

          console.log(`[Analysis Stream] Chunk boundary reached:`, {
            sessionId,
            stepsProcessed: latestStepIndex,
            totalSteps: analysisSession.totalSteps,
            lastProcessedStepId: lastProcessedStep.id,
            lastProcessedStepName: lastProcessedStep.name,
            persistedFinalStepId,
            isAtFinalStep,
            timeElapsed: chunkDurationMs,
            timeBudget: timeBudgetMs,
            timeRemaining: timeBudgetMs - chunkDurationMs,
            willTriggerOrchestrator: !isAtFinalStep && sessionOrigin === "ui",
          });

          // Persist verification diagnostics to session metadata (batch write at end of chunk)
          if (verificationDiagnosticsArray.length > 0) {
            try {
              const [currentSession] = await db
                .select({ metadata: analysisSessions.metadata })
                .from(analysisSessions)
                .where(eq(analysisSessions.id, Number(sessionId)))
                .limit(1);

              if (currentSession) {
                const currentMetadata =
                  (currentSession.metadata as Record<string, unknown>) || {};
                const existingDiagnostics = Array.isArray(
                  currentMetadata.verificationDiagnostics,
                )
                  ? currentMetadata.verificationDiagnostics
                  : [];

                await db
                  .update(analysisSessions)
                  .set({
                    metadata: {
                      ...currentMetadata,
                      verificationDiagnostics: [
                        ...existingDiagnostics,
                        ...verificationDiagnosticsArray,
                      ],
                    },
                    updatedAt: new Date(),
                  })
                  .where(eq(analysisSessions.id, Number(sessionId)));

                console.log(
                  `[Analysis Stream] Persisted ${verificationDiagnosticsArray.length} verification diagnostics to session metadata`,
                );
              }
            } catch (diagErr) {
              console.error(
                `[Analysis Stream] Failed to persist verification diagnostics:`,
                diagErr,
              );
            }
          }

          // Update currentStep and analysisResult first
          // If at final step, also set finalStepCompleted flag for finalization guard
          // NOTE: fullAnalysis is intentionally EXCLUDED from analysisResult to avoid
          // exceeding Neon HTTP driver request size limits (~10MiB). The accumulated
          // step text can grow to hundreds of KB by step 30+. Instead, fullAnalysis
          // is compiled on-demand from the analysis_steps table (which already stores
          // each step's text individually via persistAnalysisStep).
          await db
            .update(analysisSessions)
            .set({
              currentStep: latestStepIndex,
              isResuming: false,
              finalStepCompleted: isAtFinalStep, // Set completion flag when all steps done
              analysisResult: {
                stepsSummary,
                toolCalls: allToolCalls.length,
                usage: totalUsage,
                audit: auditLog,
                citationIndex: enforcer.getCitationIndex(),
                contextualAnalyses: allContextualAnalyses,
                verifiedAuthorities: allVerifiedAuthorities,
                verificationStats: allVerificationStats,
              },
              updatedAt: new Date(),
            })
            .where(eq(analysisSessions.id, Number(sessionId)));

          let finalizedSession;
          if (isAtFinalStep) {
            console.log(
              `[Analysis Stream] At final step, calling finalizeSession`,
            );
            finalizedSession = await finalizeSession(sessionId, {
              analysisResult: {
                stepsSummary,
                toolCalls: allToolCalls.length,
                usage: totalUsage,
                audit: auditLog,
                citationIndex: enforcer.getCitationIndex(),
                contextualAnalyses: allContextualAnalyses,
                verifiedAuthorities: allVerifiedAuthorities,
                verificationStats: allVerificationStats,
              },
              completedAt: new Date(),
            });
          } else {
            console.log(
              `[Analysis Stream] Not at final step yet, keeping status=processing`,
            );
            const [session] = await db
              .select()
              .from(analysisSessions)
              .where(eq(analysisSessions.id, Number(sessionId)))
              .limit(1);
            finalizedSession = session;

            const baseUrl = getBaseUrl(req);
            const bypass = process.env.INTERNAL_API_TOKEN;

            console.log(
              `[Analysis Stream] Scheduling orchestrator trigger (chunk complete) for session=${sessionId}`,
            );

            try {
              const result = await createContinuationJob(sessionId);
              if (result.created) {
                console.log(
                  `[Analysis Stream] Created continuation job for session ${sessionId}`,
                );
              } else if (result.error) {
                console.error(
                  `[Analysis Stream] Failed to create continuation job:`,
                  result.error,
                );
              }
            } catch (jobError) {
              console.error(
                `[Analysis Stream] Unexpected error creating continuation job:`,
                jobError,
              );
            }

            if (!isInvokedByResumeChunk) {
              defer(
                triggerOrchestratorNow(
                  baseUrl,
                  sessionId,
                  sessionOrigin,
                  bypass,
                ),
              );
            } else {
              console.log(
                `[Analysis Stream] Skipping orchestrator trigger on completion (invoked by resume-chunk, orchestrator will handle continuation)`,
              );
            }
          }

          // CRITICAL: Release lock after successful chunk completion
          // This allows the orchestrator to continue immediately without waiting for lock TTL
          try {
            await releaseLock(sessionId, lockId);
            console.log(
              `[Analysis Stream] Released lock ${lockId} after successful chunk completion`,
            );
          } catch (lockError) {
            console.error(
              `[Analysis Stream] Error releasing lock after chunk completion:`,
              lockError,
            );
          }

          logger.streamEnd({
            durationMs: Date.now() - startTime,
            finalStatus: finalizedSession.status,
            rowsUpdated: 1,
          });

          console.log(
            `[Analysis Stream] Analysis complete for session ${sessionId}`,
          );
          controller.close();
        } catch (error: unknown) {
          console.error("[Analysis Stream] Error:", error);
          const streamErr =
            error instanceof Error ? error : new Error(String(error));

          stopHeartbeat();
          stopHardStopTimer();

          if (
            streamErr.name === "AbortError" ||
            streamErr.message?.includes("Hard-stop")
          ) {
            controller.enqueue(
              encoder.encode(
                `\n\n⏱️ Hard-stop guard triggered: Approaching maxDuration limit. Persisting state and completing chunk...\n`,
              ),
            );

            const currentStepIndex = latestStepIndex;
            try {
              const hardStopUpdateResult = await db
                .update(analysisSessions)
                .set({
                  status: "processing",
                  currentStep: currentStepIndex,
                  isResuming: false,
                  continuationCount:
                    (analysisSession.continuationCount || 0) + 1,
                  lastContinuedAt: new Date(),
                  updatedAt: new Date(),
                })
                .where(eq(analysisSessions.id, Number(sessionId)));

              logger.hardStopTrigger({
                elapsedMs: Date.now() - startTime,
                persistedFields: {
                  status: "processing",
                  currentStep: currentStepIndex,
                  continuationCount:
                    (analysisSession.continuationCount || 0) + 1,
                },
                rowsUpdated: hardStopUpdateResult.rowCount || 0,
              });

              enhancedLogger.critical({
                message:
                  "Hard-stop guard triggered - approaching maxDuration limit",
                context: {
                  elapsedMs: Date.now() - startTime,
                  currentStep: currentStepIndex,
                  continuationCount:
                    (analysisSession.continuationCount || 0) + 1,
                  reason: "approaching_max_duration",
                },
              });

              enhancedLogger.sessionPersistence({
                currentStep: currentStepIndex,
                continuationCount: (analysisSession.continuationCount || 0) + 1,
                persistedFields: {
                  status: "processing",
                  currentStep: currentStepIndex,
                  isResuming: false,
                  continuationCount:
                    (analysisSession.continuationCount || 0) + 1,
                  lastContinuedAt: new Date().toISOString(),
                },
                reason: "hard_stop_guard_triggered",
              });

              enhancedLogger.orchestrationEvent({
                event: "chunk_complete",
                currentStep: currentStepIndex,
                remainingSteps: steps.length - currentStepIndex,
                nextAction: "trigger_orchestrator",
                elapsedMs: Date.now() - startTime,
                attemptNumber: (analysisSession.continuationCount || 0) + 1,
              });

              console.log(
                `[Analysis Stream] Hard-stop: Gracefully persisted state at step ${currentStepIndex}. Chunk complete.`,
              );

              controller.enqueue(
                encoder.encode(
                  `\n✓ State persisted. Orchestrator will continue automatically.\n`,
                ),
              );

              const baseUrl = getBaseUrl(req);
              const bypass = process.env.INTERNAL_API_TOKEN;

              console.log(
                `[Analysis Stream] Scheduling orchestrator trigger (hard-stop) for session=${sessionId}`,
              );

              try {
                const result = await createContinuationJob(sessionId);
                if (result.created) {
                  console.log(
                    `[Analysis Stream] Created continuation job for session ${sessionId} (hard-stop)`,
                  );
                } else if (result.error) {
                  console.error(
                    `[Analysis Stream] Failed to create continuation job (hard-stop):`,
                    result.error,
                  );
                }
              } catch (jobError) {
                console.error(
                  `[Analysis Stream] Unexpected error creating continuation job (hard-stop):`,
                  jobError,
                );
              }

              if (!isInvokedByResumeChunk) {
                defer(
                  triggerOrchestratorNow(
                    baseUrl,
                    sessionId,
                    sessionOrigin,
                    bypass,
                  ),
                );
              } else {
                console.log(
                  `[Analysis Stream] Skipping orchestrator trigger on hard-stop (invoked by resume-chunk, orchestrator will handle continuation)`,
                );
              }

              // CRITICAL: Release lock on hard-stop so orchestrator can continue immediately
              try {
                await releaseLock(sessionId, lockId);
                console.log(
                  `[Analysis Stream] Released lock ${lockId} after hard-stop`,
                );
              } catch (lockError) {
                console.error(
                  `[Analysis Stream] Error releasing lock after hard-stop:`,
                  lockError,
                );
              }
            } catch (dbError: unknown) {
              console.error(
                `[Analysis Stream] Failed to persist state during hard-stop:`,
                dbError,
              );
            }
          } else {
            controller.enqueue(
              encoder.encode(`\n\n[ERROR: ${streamErr.message}]\n`),
            );

            try {
              // Detect Anthropic API rate limiting and overload errors
              // Uses shared utility for consistent detection across the codebase
              const errorMessage = streamErr.message || "";
              const outerRateLimitCheck = isRateLimitOrOverloadError(streamErr);
              const isRateLimitError =
                outerRateLimitCheck.isTransient &&
                !outerRateLimitCheck.isOverload;
              const isOverloadError = outerRateLimitCheck.isOverload;
              const isAnthropicApiError =
                errorMessage.toLowerCase().includes("anthropic") ||
                errorMessage.toLowerCase().includes("api error") ||
                streamErr.name === "APIError" ||
                streamErr.name === "APIConnectionError";

              // Log rate limiting for monitoring
              if (isRateLimitError || isOverloadError) {
                console.error(
                  `[Analysis Stream] ANTHROPIC API LIMIT DETECTED - Session: ${sessionId}, Step: ${latestStepIndex}, Type: ${isRateLimitError ? "RATE_LIMIT_429" : "OVERLOAD_529"}, Message: ${errorMessage}`,
                );
                enhancedLogger.critical({
                  message:
                    "Anthropic API rate limit or overload detected (retries exhausted or no time budget)",
                  context: {
                    sessionId,
                    stepIndex: latestStepIndex,
                    errorType: isRateLimitError
                      ? "RATE_LIMIT_429"
                      : "OVERLOAD_529",
                    errorMessage,
                    organizationId: analysisSession.organizationId,
                  },
                });
              }

              // For rate limit errors that exhausted inner retries, set status to "processing"
              // instead of "error" so the orchestrator can resume the session in the next chunk.
              // The orchestrator's resume-chunk mechanism will pick up from the failed step.
              const isRetryableByOrchestrator =
                isRateLimitError || isOverloadError;
              const errorStatus = isRetryableByOrchestrator
                ? "processing"
                : "error";

              const errorMetadata = {
                lastError: {
                  stepIndex: latestStepIndex,
                  stepId: steps[latestStepIndex]?.id || "unknown",
                  stepName: steps[latestStepIndex]?.name || "unknown",
                  errorName: streamErr.name || "UnknownError",
                  errorMessage: streamErr.message,
                  stackPreview: streamErr.stack?.substring(0, 500),
                  timestamp: new Date().toISOString(),
                  isRateLimitError,
                  isOverloadError,
                  isAnthropicApiError,
                  rateLimitRetriesExhausted: isRetryableByOrchestrator,
                },
                lastErrorContinuation: analysisSession.continuationCount || 0,
                lastCompletedStep: Math.max(0, latestStepIndex - 1),
              };

              if (isRetryableByOrchestrator) {
                console.log(
                  `[Analysis Stream] Rate limit error - setting status to "processing" for orchestrator retry ` +
                    `(session: ${sessionId}, step: ${latestStepIndex})`,
                );
              }

              const errorUpdateResult = await db
                .update(analysisSessions)
                .set({
                  status: errorStatus,
                  currentStep: latestStepIndex,
                  ...(isRetryableByOrchestrator && {
                    isResuming: false,
                    continuationCount:
                      (analysisSession.continuationCount || 0) + 1,
                    lastContinuedAt: new Date(),
                  }),
                  updatedAt: new Date(),
                  metadata: {
                    ...existingMetadata,
                    ...errorMetadata,
                  },
                })
                .where(eq(analysisSessions.id, Number(sessionId)));

              // Release lock on error
              try {
                await releaseLock(sessionId, lockId);
                console.log(
                  `[Analysis Stream] Released lock ${lockId} after error`,
                );
              } catch (lockError) {
                console.error(
                  `[Analysis Stream] Error releasing lock:`,
                  lockError,
                );
              }

              // For rate limit errors, trigger orchestrator for quick retry
              // (similar to hard-stop path) instead of waiting for watchdog cron
              if (isRetryableByOrchestrator) {
                try {
                  const result = await createContinuationJob(sessionId);
                  if (result.created) {
                    console.log(
                      `[Analysis Stream] Created continuation job for session ${sessionId} (rate-limit-retry)`,
                    );
                  } else if (result.error) {
                    console.error(
                      `[Analysis Stream] Failed to create continuation job (rate-limit-retry):`,
                      result.error,
                    );
                  }
                } catch (jobError) {
                  console.error(
                    `[Analysis Stream] Unexpected error creating continuation job (rate-limit-retry):`,
                    jobError,
                  );
                }

                const baseUrl = getBaseUrl(req);
                const bypass = process.env.INTERNAL_API_TOKEN;
                if (!isInvokedByResumeChunk) {
                  defer(
                    triggerOrchestratorNow(
                      baseUrl,
                      sessionId,
                      sessionOrigin,
                      bypass,
                    ),
                  );
                } else {
                  console.log(
                    `[Analysis Stream] Skipping orchestrator trigger on rate-limit-retry (invoked by resume-chunk, orchestrator will handle continuation)`,
                  );
                }
              }

              logger.analysisError({
                errorName: streamErr.name || "UnknownError",
                errorMessage: streamErr.message,
                stackPreview: streamErr.stack?.substring(0, 500),
                persistedStatus: errorStatus,
                rowsUpdated: errorUpdateResult.rowCount || 0,
              });

              enhancedLogger.critical({
                message: "Analysis stream failed with unhandled error",
                context: {
                  errorName: streamErr.name || "UnknownError",
                  errorMessage: streamErr.message,
                  elapsedMs: Date.now() - startTime,
                  currentStep: latestStepIndex,
                  totalSteps: steps.length,
                },
              });

              if (latestStepIndex < steps.length) {
                logger.suspectSilentFailure({
                  reason: "no-progress-advance",
                  lastCompletedStep: latestStepIndex,
                  expectedStep: steps.length,
                  errorContext: streamErr.message,
                });

                enhancedLogger.warning({
                  message: "Analysis stopped before completing all steps",
                  context: {
                    lastCompletedStep: latestStepIndex,
                    expectedSteps: steps.length,
                    remainingSteps: steps.length - latestStepIndex,
                    errorContext: streamErr.message,
                  },
                });
              }
            } catch (dbError: unknown) {
              console.error(
                `[Analysis Stream] Failed to update error status:`,
                dbError,
              );
            }
          }

          logger.streamEnd({
            durationMs: Date.now() - startTime,
            finalStatus: "error",
            rowsUpdated: 0,
          });

          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked",
        "X-Session-Id": sessionId,
      },
    });
  } catch (error: unknown) {
    console.error("[Analysis Stream] Error:", error);

    // Release lock on top-level error
    try {
      if (lockId) {
        await releaseLock(sessionId, lockId);
        console.log(
          `[Analysis Stream] Released lock ${lockId} after top-level error`,
        );
      }
    } catch (lockError) {
      console.error(
        `[Analysis Stream] Error releasing lock in catch:`,
        lockError,
      );
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to start analysis",
      },
      { status: 500 },
    );
  }
}
