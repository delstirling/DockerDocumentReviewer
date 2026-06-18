import { QuoteVerifier, type VerificationResult } from "./quote-verification";
import type { VerificationSettings } from "./workflow-config";
import {
  AttributionClassifier,
  type AttributionContext,
} from "./attribution-classifier";
import { detectExampleFallback, detectAllPieces } from "./fallback-examples";
import {
  UrlCaseVerifier,
  extractCaseNameFromCitation,
  extractJurisdictionFromCitation,
  type CaseVerificationResult,
} from "./url-case-verification";
import { CourtListenerClient } from "./court-listener";

/**
 * Provenance tracking for programmatically extracted quotes.
 * This enables the guardrail that blocks AI-generated quotes and requires code extraction.
 */
export interface QuoteProvenance {
  /** Source type - only "courtlistener_programmatic" is trusted for case law */
  sourceType:
    | "courtlistener_programmatic"
    | "uploaded_document"
    | "ai_generated"
    | "unknown";
  /** Name of the tool that extracted the quote */
  toolName?: string;
  /** CourtListener opinion ID */
  opinionId?: string;
  /** Source URL from the extraction (should match authority.url) */
  sourceUrl?: string;
  /** How the text was extracted */
  extractionMethod?: "api_plain_text" | "api_html_stripped";
  /** ISO timestamp of when extraction occurred */
  extractedAt?: string;
}

export interface PropositionAuthority {
  type: "legal_authority" | "documentary_evidence";
  authority_type?: "case_law" | "statute" | "regulation" | "local_rule";
  citation: string;
  quote: string;
  note?: string;
  url: string;
  metadata?: Record<string, unknown>;
  attribution?: "our_firm" | "opposing" | "neutral";
  /** Provenance tracking for programmatic quote extraction guardrail */
  provenance?: QuoteProvenance;
}

export interface PropositionCitation {
  proposition_id: string;
  authorities: PropositionAuthority[];
}

export interface ContextualQuote {
  summary: string;
  quotes: string[];
}

export interface ContextualAnalysis {
  authority_citation: string;
  authority_type: "legal_authority" | "documentary_evidence";
  preceding_context: ContextualQuote;
  statement_function: string;
  subsequent_development: ContextualQuote;
  qualifications_limitations: ContextualQuote;
  alignment_verification: string;
}

export interface EnforcementResult {
  success: boolean;
  attempts: number;
  verifiedCitations: PropositionCitation[];
  failedCitations: PropositionCitation[];
  opponentCitationErrors: PropositionCitation[];
  retryMessages: string[];
  contextualAnalyses?: ContextualAnalysis[];
  /** Citations that were blocked due to missing provenance (AI-generated without code extraction) */
  provenanceBlockedCitations?: PropositionCitation[];
  verificationScores?: Map<
    string,
    Array<{
      alphanumericPercent?: number;
      punctuationSpacePercent?: number;
      aiVerification?: string;
    }>
  >;
  verificationDetails?: Map<
    string,
    Array<{
      verified: boolean;
      fallbackFlag: boolean;
      confidenceScore: number;
      note?: string;
      alphanumericPercent?: number;
      punctuationSpacePercent?: number;
      aiVerification?: string;
      correctedUrl?: string;
    }>
  >;
}

export interface CitationIndex {
  nextNumber: number;
  lastColor: string | null;
  citations: Map<
    number,
    {
      citation: string;
      quote: string;
      url: string;
      type: string;
      verified: boolean;
      color: string;
      proposition_id: string;
      alphanumericPercent?: number;
      punctuationSpacePercent?: number;
      aiVerification?: string;
    }
  >;
}

const CITATION_COLORS = ["#0B63FF", "#2E7D32", "#CC5500"]; // blue, green, burnt orange

export class VerificationEnforcer {
  private verifier: QuoteVerifier;
  private citationIndex: CitationIndex;
  private attributionClassifier: AttributionClassifier;
  private attributionContext?: AttributionContext;
  private urlCaseVerifier: UrlCaseVerifier;

  constructor(attributionContext?: AttributionContext) {
    this.verifier = new QuoteVerifier();
    this.attributionClassifier = new AttributionClassifier();
    this.urlCaseVerifier = new UrlCaseVerifier();
    this.attributionContext = attributionContext;
    this.citationIndex = {
      nextNumber: 1,
      lastColor: null,
      citations: new Map(),
    };
  }

  /**
   * Set attribution context for classification
   */
  setAttributionContext(context: AttributionContext): void {
    this.attributionContext = context;
  }

  /**
   * Validate CitationsJSON structure against schema
   */
  private validateCitationsJSON(citations: any[]): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if (!Array.isArray(citations)) {
      errors.push("CitationsJSON must be an array");
      return { valid: false, errors };
    }

    citations.forEach((citation, index) => {
      if (!citation.proposition_id) {
        errors.push(`Citation ${index}: missing proposition_id`);
      }

      if (!citation.authorities || !Array.isArray(citation.authorities)) {
        errors.push(`Citation ${index}: missing or invalid authorities array`);
        return;
      }

      if (citation.authorities.length === 0) {
        errors.push(`Citation ${index}: authorities array is empty`);
      }

      citation.authorities.forEach((authority: any, authIndex: number) => {
        if (!authority.type) {
          errors.push(
            `Citation ${index}, Authority ${authIndex}: missing type`,
          );
        }

        // Define authority types that don't require external URLs
        // These are internal references, analytical observations, or document references
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

        // URL patterns that indicate internal/document references (not external URLs)
        // These patterns detect when the AI references uploaded documents or makes observations
        const internalUrlPatterns = [
          "n/a",
          "subject document",
          "context document",
          "referenced in",
          "primary document",
          "see exhibit",
          "document -",
          "strategic assessment",
          "risk assessment",
          "procedural practice",
        ];

        // Check if this is an internal reference type (doesn't need external URL)
        const urlLower = authority.url?.toLowerCase() || "";
        const isInternalReference =
          internalReferenceTypes.includes(authority.type) ||
          internalReferenceTypes.includes(authority.authority_type) ||
          internalUrlPatterns.some((pattern) => urlLower.includes(pattern)) ||
          (authority.url && !authority.url.startsWith("http"));

        if (authority.type === "observation" || isInternalReference) {
          // Internal reference types only need type and either note or quote
          // These are used for analytical observations or document references that don't cite external sources
          if (!authority.note && !authority.quote) {
            errors.push(
              `Citation ${index}, Authority ${authIndex}: internal reference type missing note or quote`,
            );
          }
        } else {
          // External authorities require citation and quote
          // For case law, URL comes from provenance.sourceUrl (not AI-typed)
          // For statutes/rules, URL is provided directly
          if (!authority.citation) {
            errors.push(
              `Citation ${index}, Authority ${authIndex}: missing citation`,
            );
          }
          if (!authority.quote) {
            errors.push(
              `Citation ${index}, Authority ${authIndex}: missing quote`,
            );
          }
          // Only require URL for non-case-law authorities
          // Case law URLs come from provenance.sourceUrl via programmatic extraction
          const isCaseLaw =
            authority.authority_type === "case_law" ||
            !authority.authority_type;
          if (!isCaseLaw && !authority.url) {
            errors.push(
              `Citation ${index}, Authority ${authIndex}: missing url`,
            );
          }
        }
      });
    });

    return { valid: errors.length === 0, errors };
  }

  /**
   * Parse CitationsJSON block from AI output with validation
   */
  parseCitationsJSON(text: string): PropositionCitation[] | null {
    console.log(
      "[VerificationEnforcer] 🔍 CHECKPOINT: Parsing CitationsJSON block",
    );
    const match = text.match(/<CitationsJSON>([\s\S]*?)<\/CitationsJSON>/i);
    if (!match) {
      console.log(
        "[VerificationEnforcer] ⚠️  No CitationsJSON block found in text",
      );
      return null;
    }

    try {
      const jsonText = match[1].trim();
      console.log(
        `[VerificationEnforcer] 📄 Found CitationsJSON block (${jsonText.length} chars)`,
      );

      const parsed = JSON.parse(jsonText);
      console.log(
        `[VerificationEnforcer] DIAGNOSTIC: Parsed JSON has ${parsed.length} items`,
      );
      // Log first citation structure for debugging
      if (parsed.length > 0) {
        console.log(
          `[VerificationEnforcer] DIAGNOSTIC: First citation structure:`,
          JSON.stringify(parsed[0], null, 2).substring(0, 500),
        );
        if (parsed[0].authorities && parsed[0].authorities.length > 0) {
          console.log(
            `[VerificationEnforcer] DIAGNOSTIC: First authority type: "${parsed[0].authorities[0].type}"`,
          );
        }
      }

      const validation = this.validateCitationsJSON(parsed);
      console.log(
        `[VerificationEnforcer] DIAGNOSTIC: Validation result: valid=${validation.valid}, errors=${validation.errors.length}`,
      );

      if (!validation.valid) {
        console.error(
          "[VerificationEnforcer] ❌ CitationsJSON validation failed:",
          validation.errors,
        );
        // Log all validation errors for debugging
        validation.errors.forEach((err, idx) => {
          console.error(
            `[VerificationEnforcer] Validation error ${idx}: ${err}`,
          );
        });
        return null;
      }

      console.log(
        `[VerificationEnforcer] ✅ Successfully parsed and validated ${parsed.length} citations`,
      );
      const citations = parsed as PropositionCitation[];
      return citations;
    } catch (error) {
      console.error(
        "[VerificationEnforcer] ❌ Failed to parse CitationsJSON:",
        error,
      );
      return null;
    }
  }

  /**
   * Validate ContextJSON structure against schema
   */
  private validateContextJSON(contexts: any[]): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if (!Array.isArray(contexts)) {
      errors.push("ContextJSON must be an array");
      return { valid: false, errors };
    }

    contexts.forEach((context, index) => {
      if (!context.authority_citation) {
        errors.push(`Context ${index}: missing authority_citation`);
      }
      if (!context.authority_type) {
        errors.push(`Context ${index}: missing authority_type`);
      }
      if (!context.statement_function) {
        errors.push(`Context ${index}: missing statement_function`);
      }
      if (!context.alignment_verification) {
        errors.push(`Context ${index}: missing alignment_verification`);
      }

      // Accept BOTH flat format (preceding_context_summary + preceding_quotes)
      // AND nested format (preceding_context: { summary, quotes[] }) that matches
      // the ContextualAnalysis interface. The AI may produce either structure.
      const hasFlatPreceding =
        context.preceding_context_summary ||
        Array.isArray(context.preceding_quotes);
      const hasNestedPreceding =
        context.preceding_context?.summary ||
        Array.isArray(context.preceding_context?.quotes);
      if (!hasFlatPreceding && !hasNestedPreceding) {
        errors.push(
          `Context ${index}: missing preceding_context_summary or preceding_context.summary`,
        );
      }
      if (
        !Array.isArray(context.preceding_quotes) &&
        !Array.isArray(context.preceding_context?.quotes)
      ) {
        errors.push(
          `Context ${index}: preceding_quotes must be an array (flat or nested)`,
        );
      }

      const hasFlatSubsequent =
        context.subsequent_development_summary ||
        Array.isArray(context.subsequent_quotes);
      const hasNestedSubsequent =
        context.subsequent_development?.summary ||
        Array.isArray(context.subsequent_development?.quotes);
      if (!hasFlatSubsequent && !hasNestedSubsequent) {
        errors.push(
          `Context ${index}: missing subsequent_development_summary or subsequent_development.summary`,
        );
      }
      if (
        !Array.isArray(context.subsequent_quotes) &&
        !Array.isArray(context.subsequent_development?.quotes)
      ) {
        errors.push(
          `Context ${index}: subsequent_quotes must be an array (flat or nested)`,
        );
      }

      const hasFlatQualifications =
        context.qualifications_limitations_summary ||
        Array.isArray(context.qualifications_quotes);
      const hasNestedQualifications =
        context.qualifications_limitations?.summary ||
        Array.isArray(context.qualifications_limitations?.quotes);
      if (!hasFlatQualifications && !hasNestedQualifications) {
        errors.push(
          `Context ${index}: missing qualifications_limitations_summary or qualifications_limitations.summary`,
        );
      }
      if (
        !Array.isArray(context.qualifications_quotes) &&
        !Array.isArray(context.qualifications_limitations?.quotes)
      ) {
        errors.push(
          `Context ${index}: qualifications_quotes must be an array (flat or nested)`,
        );
      }
    });

    return { valid: errors.length === 0, errors };
  }

  /**
   * Parse ContextJSON block from AI output with validation
   */
  parseContextJSON(text: string): ContextualAnalysis[] | null {
    console.log(
      "[VerificationEnforcer] 🔍 CHECKPOINT: Parsing ContextJSON block",
    );
    const match = text.match(/<ContextJSON>([\s\S]*?)<\/ContextJSON>/i);
    if (!match) {
      console.log(
        "[VerificationEnforcer] ⚠️  No ContextJSON block found in text",
      );
      return null;
    }

    try {
      const jsonText = match[1].trim();
      console.log(
        `[VerificationEnforcer] 📄 Found ContextJSON block (${jsonText.length} chars)`,
      );

      const parsed = JSON.parse(jsonText);
      const validation = this.validateContextJSON(parsed);

      if (!validation.valid) {
        console.error(
          "[VerificationEnforcer] ❌ ContextJSON validation failed:",
          validation.errors,
        );
        return null;
      }

      // Normalize flat format into nested ContextualAnalysis structure.
      // The AI may produce flat fields (preceding_context_summary, preceding_quotes)
      // instead of the nested format (preceding_context: { summary, quotes[] }).
      const normalized = (parsed as any[]).map((ctx) => {
        if (!ctx.preceding_context) {
          ctx.preceding_context = {
            summary: ctx.preceding_context_summary || "",
            quotes: ctx.preceding_quotes || [],
          };
        }
        if (!ctx.subsequent_development) {
          ctx.subsequent_development = {
            summary: ctx.subsequent_development_summary || "",
            quotes: ctx.subsequent_quotes || [],
          };
        }
        if (!ctx.qualifications_limitations) {
          ctx.qualifications_limitations = {
            summary: ctx.qualifications_limitations_summary || "",
            quotes: ctx.qualifications_quotes || [],
          };
        }
        return ctx;
      });

      console.log(
        `[VerificationEnforcer] ✅ Successfully parsed and validated ${normalized.length} contextual analyses`,
      );
      const contexts = normalized as ContextualAnalysis[];
      return contexts;
    } catch (error) {
      console.error(
        "[VerificationEnforcer] ❌ Failed to parse ContextJSON:",
        error,
      );
      return null;
    }
  }

  /**
   * Verify all contextual quotes in a ContextualAnalysis
   */
  async verifyContextualQuotes(
    context: ContextualAnalysis,
    authorityUrl: string,
  ): Promise<{
    verified: boolean;
    failedQuotes: string[];
  }> {
    const allQuotes: string[] = [
      ...context.preceding_context.quotes,
      ...context.subsequent_development.quotes,
      ...context.qualifications_limitations.quotes,
    ];

    const failedQuotes: string[] = [];

    for (const quote of allQuotes) {
      if (!quote || quote.trim().length === 0) continue;

      const result = await this.verifier.verifyQuote({
        citation: context.authority_citation,
        quote: quote,
        url: authorityUrl,
        authority_type:
          context.authority_type === "legal_authority"
            ? "case_law"
            : "case_law",
      });

      if (!result.verified && !result.fallback_flag) {
        failedQuotes.push(quote);
      }
    }

    return {
      verified: failedQuotes.length === 0,
      failedQuotes,
    };
  }

  /**
   * Extract Proposition markers from text
   */
  extractPropositions(text: string): Map<string, string> {
    const propositions = new Map<string, string>();
    const regex = /<Proposition\s+id="([^"]+)">([^<]+)<\/Proposition>/gi;
    let match;

    while ((match = regex.exec(text)) !== null) {
      const [, id, content] = match;
      propositions.set(id, content);
    }

    return propositions;
  }

  /**
   * Get canonical URL from provenance.sourceUrl if available.
   * This ensures we use the correct URL from the CourtListener API instead of
   * trusting whatever URL the AI typed.
   * Returns the canonical URL if provenance is valid and has sourceUrl, otherwise returns original URL.
   * This is a pure function with no side effects.
   */
  private getCanonicalUrlFromProvenance(
    authority: PropositionAuthority,
    hasValidProvenance: boolean,
  ): string | undefined {
    const provenanceUrl = authority.provenance?.sourceUrl;
    if (
      hasValidProvenance &&
      provenanceUrl &&
      authority.url !== provenanceUrl
    ) {
      return provenanceUrl;
    }
    return authority.url;
  }

  /**
   * Classify attribution for an authority
   */
  private classifyAuthority(
    authority: PropositionAuthority,
  ): "our_firm" | "opposing" | "neutral" {
    if (!this.attributionContext) {
      return "neutral";
    }

    return this.attributionClassifier.classifyAttribution(
      authority.citation,
      this.attributionContext,
    );
  }

  /**
   * GUARDRAIL: Check if case law citations have proper provenance from programmatic extraction.
   * This blocks AI-generated quotes and forces retry with programmatic quote extraction tools.
   *
   * @param citations - The citations to check for provenance
   * @returns Object with blocked citations and retry message if any citations lack provenance
   */
  private checkProvenanceGuardrail(citations: PropositionCitation[]): {
    hasBlockedCitations: boolean;
    blockedCitations: PropositionCitation[];
    retryMessage: string | null;
  } {
    const blockedCitations: PropositionCitation[] = [];
    const missingProvenanceDetails: string[] = [];

    for (const citation of citations) {
      const authoritiesWithoutProvenance: string[] = [];

      for (const authority of citation.authorities) {
        // Only check case law authorities for provenance
        // Statutes, regulations, and other authority types don't require CourtListener extraction
        const effectiveAuthorityType = authority.authority_type || "case_law";
        const isCaseLaw = effectiveAuthorityType === "case_law";

        // Skip provenance check for non-case-law authorities
        if (!isCaseLaw) {
          continue;
        }

        // Check if this case law citation has proper provenance from programmatic extraction
        // CRITICAL: Only accept provenance from 'programmatic-quote-extraction' tool
        // The 'courtlistener-search' tool returns multiple results, and the AI can
        // accidentally attach provenance from the wrong result (e.g., cite Celotex
        // but attach Anderson's URL). The extraction tool operates on a single
        // opinionId, so there's no possibility of mismatch.
        const hasValidProvenance: boolean =
          authority.provenance?.sourceType === "courtlistener_programmatic" &&
          authority.provenance?.toolName === "programmatic-quote-extraction" &&
          !!authority.provenance?.extractedAt;

        // Get canonical URL from provenance if available (without mutating authority)
        const canonicalUrl = this.getCanonicalUrlFromProvenance(
          authority,
          hasValidProvenance,
        );

        if (!hasValidProvenance) {
          authoritiesWithoutProvenance.push(
            `  - Citation: "${authority.citation}"\n` +
              `    Quote: "${authority.quote?.substring(0, 100)}${authority.quote && authority.quote.length > 100 ? "..." : ""}"\n` +
              `    URL: ${canonicalUrl || "NO URL"}\n` +
              `    Provenance: ${authority.provenance ? JSON.stringify(authority.provenance) : "MISSING"}`,
          );
        }
      }

      if (authoritiesWithoutProvenance.length > 0) {
        blockedCitations.push(citation);
        missingProvenanceDetails.push(
          `Proposition ${citation.proposition_id}:\n${authoritiesWithoutProvenance.join("\n\n")}`,
        );
      }
    }

    if (blockedCitations.length === 0) {
      return {
        hasBlockedCitations: false,
        blockedCitations: [],
        retryMessage: null,
      };
    }

    // Generate detailed retry message instructing AI to use programmatic extraction
    const retryMessage =
      `🚫 PROVENANCE GUARDRAIL BLOCKED: ${blockedCitations.length} citation(s) lack proper provenance from programmatic quote extraction.\n\n` +
      `The following case law citations were generated by AI without using the programmatic quote extraction tools:\n\n` +
      `${missingProvenanceDetails.join("\n\n")}\n\n` +
      `⚠️ REQUIRED ACTION: You MUST use the programmatic quote extraction tools to get case law quotes.\n\n` +
      `STEP 1: Search for the case using 'courtlistener-search' tool\n` +
      `STEP 2: Extract the quote using 'programmatic-quote-extraction' tool with the opinion ID\n` +
      `STEP 3: Include the COMPLETE provenance object from the extraction result in your CitationsJSON\n\n` +
      `The provenance object contains the sourceUrl from the CourtListener API which will be used as the canonical URL.\n` +
      `You do not need to construct URLs manually - the system will use provenance.sourceUrl automatically.\n\n` +
      `EXAMPLE of correct CitationsJSON with provenance:\n` +
      `<CitationsJSON>\n` +
      `[{\n` +
      `  "proposition_id": "p1",\n` +
      `  "authorities": [{\n` +
      `    "type": "legal_authority",\n` +
      `    "authority_type": "case_law",\n` +
      `    "citation": "Case Name, Citation",\n` +
      `    "quote": "Exact quote from programmatic extraction",\n` +
      `    "provenance": {\n` +
      `      "sourceType": "courtlistener_programmatic",\n` +
      `      "toolName": "programmatic-quote-extraction",\n` +
      `      "opinionId": "12345",\n` +
      `      "sourceUrl": "https://www.courtlistener.com/opinion/12345/case-name/",\n` +
      `      "extractionMethod": "api_plain_text",\n` +
      `      "extractedAt": "2025-01-01T00:00:00.000Z"\n` +
      `    }\n` +
      `  }]\n` +
      `}]\n` +
      `</CitationsJSON>\n\n` +
      `DO NOT generate quotes from memory. DO NOT fabricate provenance.\n` +
      `Use the tools to extract quotes programmatically - the URL will be taken from provenance.sourceUrl.`;

    console.log(
      `[VerificationEnforcer] 🚫 PROVENANCE GUARDRAIL: Blocked ${blockedCitations.length} citations without proper provenance`,
    );

    return {
      hasBlockedCitations: true,
      blockedCitations,
      retryMessage,
    };
  }

  /**
   * Verify all authorities in a citation
   */
  async verifyCitation(citation: PropositionCitation): Promise<{
    verified: boolean;
    results: Array<{
      verified: boolean;
      fallback_flag: boolean;
      confidence_score: number;
      attribution: "our_firm" | "opposing" | "neutral";
      alphanumericPercent?: number;
      punctuationSpacePercent?: number;
      aiVerification?: string;
      urlCaseVerification?: CaseVerificationResult;
    }>;
  }> {
    const results: Array<{
      verified: boolean;
      fallback_flag: boolean;
      confidence_score: number;
      attribution: "our_firm" | "opposing" | "neutral";
      alphanumericPercent?: number;
      punctuationSpacePercent?: number;
      aiVerification?: string;
      urlCaseVerification?: CaseVerificationResult;
    }> = [];
    let allVerified = true;

    for (const authority of citation.authorities) {
      const attribution = this.classifyAuthority(authority);
      authority.attribution = attribution;

      if (authority.type === "legal_authority") {
        // Guard: skip Tavily verification if URL is missing or invalid.
        // The AI sometimes omits the url field for case_law authorities,
        // which causes Tavily to return 422 Unprocessable Entity.
        if (
          !authority.url ||
          authority.url === "undefined" ||
          !authority.url.startsWith("http")
        ) {
          console.warn(
            `[VerificationEnforcer] Skipping quote verification for "${authority.citation}" — missing or invalid URL: ${authority.url}`,
          );
          results.push({
            verified: false,
            fallback_flag: true,
            confidence_score: 0,
            attribution,
          });
          allVerified = false;
          continue;
        }

        const result = await this.verifier.verifyQuote({
          citation: authority.citation,
          quote: authority.quote,
          url: authority.url,
          authority_type: authority.authority_type || "case_law",
          attribution,
        });

        let alphanumericPercent: number | undefined;
        let punctuationSpacePercent: number | undefined;
        let aiVerification: string | undefined;
        let urlCaseVerification: CaseVerificationResult | undefined;

        if (result.metadata?.extracted_quote) {
          try {
            const { computeThreeScoreVerification } =
              await import("./ai-quote-verification");
            const threeScores = await computeThreeScoreVerification(
              authority.quote,
              result.metadata.extracted_quote,
            );
            alphanumericPercent = threeScores.alphanumericPercent;
            punctuationSpacePercent = threeScores.punctuationSpacePercent;
            aiVerification = threeScores.aiVerification;

            console.log(
              `[VerificationEnforcer] Three-score verification: AN=${alphanumericPercent}%, PS=${punctuationSpacePercent}%, AI=${aiVerification}`,
            );
          } catch (error) {
            console.error(
              "[VerificationEnforcer] Failed to compute three-score verification:",
              error instanceof Error ? error.message : String(error),
            );
          }
        }

        // URL Case Verification: Verify that the URL actually contains the expected case
        // Run for all case law citations (including when authority_type is missing but defaults to case_law)
        const effectiveAuthorityType = authority.authority_type || "case_law";
        const isCourtListenerUrl = authority.url?.includes("courtlistener.com");

        if (
          effectiveAuthorityType === "case_law" &&
          authority.url &&
          isCourtListenerUrl
        ) {
          try {
            console.log(
              `[VerificationEnforcer] 🔍 Starting URL case verification for: ${authority.citation}`,
            );
            const expectedCaseName = extractCaseNameFromCitation(
              authority.citation,
            );
            const expectedJurisdiction = extractJurisdictionFromCitation(
              authority.citation,
            );

            // CRITICAL FIX: First, use CourtListener API to verify case identity
            // This catches the bug where AI combines wrong opinion ID with case name slug
            // The opinion ID is authoritative on CourtListener - the slug is cosmetic
            const courtListenerClient = new CourtListenerClient();
            const caseIdentityResult =
              await courtListenerClient.verifyCaseIdentity(
                authority.url,
                expectedCaseName,
              );

            if (!caseIdentityResult.verified) {
              console.error(
                `[VerificationEnforcer] 🚨 CASE IDENTITY MISMATCH DETECTED!`,
              );
              console.error(
                `[VerificationEnforcer]   Expected case: "${caseIdentityResult.expectedCaseName}"`,
              );
              console.error(
                `[VerificationEnforcer]   Actual case: "${caseIdentityResult.actualCaseName}"`,
              );
              console.error(
                `[VerificationEnforcer]   Similarity: ${(caseIdentityResult.similarityScore * 100).toFixed(1)}%`,
              );
              console.error(
                `[VerificationEnforcer]   Opinion ID: ${caseIdentityResult.opinionId}`,
              );
              console.error(
                `[VerificationEnforcer]   Correct URL would be: ${caseIdentityResult.correctUrl}`,
              );

              // Set URL case verification result to indicate mismatch
              urlCaseVerification = {
                verified: false,
                confidence: "none",
                actualCaseName: caseIdentityResult.actualCaseName,
                mismatchReason: `URL points to wrong case! Expected "${caseIdentityResult.expectedCaseName}" but URL points to "${caseIdentityResult.actualCaseName}" (opinion ID ${caseIdentityResult.opinionId}). The AI combined the wrong opinion ID with the case name slug. On CourtListener, the opinion ID is authoritative - the slug is cosmetic and ignored.`,
                extractionMethod: "browserless",
              };

              // Mark as not verified to trigger retry loop
              allVerified = false;
            } else {
              // Case identity verified via API - now do the full URL case verification
              // with Browserless for additional confidence
              urlCaseVerification =
                await this.urlCaseVerifier.verifyCaseUrlWithRetry({
                  url: authority.url,
                  expectedCaseName,
                  expectedJurisdiction,
                  expectedCitation: authority.citation,
                });

              console.log(
                `[VerificationEnforcer] URL case verification result: verified=${urlCaseVerification.verified}, confidence=${urlCaseVerification.confidence}`,
              );

              // If URL case verification found a corrected URL, apply it to the authority
              if (urlCaseVerification.correctedUrl) {
                console.log(
                  `[VerificationEnforcer] 🔄 Applying corrected URL: ${authority.url} -> ${urlCaseVerification.correctedUrl}`,
                );
                authority.url = urlCaseVerification.correctedUrl;
              }

              // If URL case verification fails with high confidence mismatch and no correction found,
              // mark the citation as not verified to trigger retry
              if (
                !urlCaseVerification.verified &&
                urlCaseVerification.confidence === "none" &&
                !urlCaseVerification.correctedUrl
              ) {
                console.warn(
                  `[VerificationEnforcer] ⚠️ URL case verification FAILED (no correction found): ${urlCaseVerification.mismatchReason || urlCaseVerification.error}`,
                );
                // Mark as not verified to trigger retry loop
                allVerified = false;
              }
            }
          } catch (error) {
            console.error(
              "[VerificationEnforcer] Failed to perform URL case verification:",
              error instanceof Error ? error.message : String(error),
            );
            // Don't fail the entire verification if URL case verification throws an error
            // Just log the error and continue (the quote verification result will still apply)
          }
        }

        results.push({
          verified: result.verified || false,
          fallback_flag: result.fallback_flag || false,
          confidence_score: result.confidence_score || 0,
          attribution,
          alphanumericPercent,
          punctuationSpacePercent,
          aiVerification,
          urlCaseVerification,
        });

        if (!result.verified && !result.fallback_flag) {
          allVerified = false;
        }
      }
    }

    return { verified: allVerified, results };
  }

  /**
   * Verify all citations with attribution-aware retry logic
   */
  async enforceVerification(
    stepText: string,
    settings: VerificationSettings,
    maxRetries: number = 5,
  ): Promise<EnforcementResult> {
    console.log(
      "[VerificationEnforcer] 🚀 CHECKPOINT: Starting citation verification enforcement",
    );
    console.log(
      `[VerificationEnforcer] ⚙️  Settings: maxRetries=${maxRetries}, enabled=${settings.legalAuthorityVerification?.enabled}`,
    );

    const result: EnforcementResult = {
      success: false,
      attempts: 0,
      verifiedCitations: [],
      failedCitations: [],
      opponentCitationErrors: [],
      retryMessages: [],
      contextualAnalyses: [],
    };

    if (!settings.legalAuthorityVerification?.enabled) {
      console.log("[VerificationEnforcer] ⏭️  Verification disabled, skipping");
      result.success = true;
      return result;
    }

    const propositions = this.extractPropositions(stepText);
    const citations = this.parseCitationsJSON(stepText);

    if (propositions.size > 0 && (!citations || citations.length === 0)) {
      console.error(
        `[VerificationEnforcer] ❌ ENFORCEMENT FAILURE: Found ${propositions.size} <Proposition> tags but NO <CitationsJSON> block`,
      );
      result.success = false;
      result.attempts = 1;
      result.retryMessages.push(
        `CRITICAL ERROR: You produced ${propositions.size} <Proposition> tags but did NOT provide a <CitationsJSON> block with citation data.\n\n` +
          `REQUIRED FORMAT:\n` +
          `1. Wrap statements requiring citation in <Proposition id="p1">statement</Proposition> tags\n` +
          `2. Provide a <CitationsJSON> block with citation data for EACH proposition:\n\n` +
          `<CitationsJSON>\n` +
          `[{\n` +
          `  "proposition_id": "p1",\n` +
          `  "authorities": [{\n` +
          `    "type": "legal_authority",\n` +
          `    "authority_type": "case_law",\n` +
          `    "citation": "Case Name, Citation",\n` +
          `    "quote": "Exact quote from the case",\n` +
          `    "url": "https://www.courtlistener.com/..."\n` +
          `  }]\n` +
          `}]\n` +
          `</CitationsJSON>\n\n` +
          `BOTH are REQUIRED. You cannot have propositions without citations. Please retry with the complete markup.`,
      );
      return result;
    }

    if (!citations || citations.length === 0) {
      console.log(
        "[VerificationEnforcer] ℹ️  No citations found (and no propositions), skipping verification",
      );
      result.success = true;
      return result;
    }

    console.log(
      `[VerificationEnforcer] 📊 CHECKPOINT: Found ${citations.length} citations to verify`,
    );

    // PROVENANCE GUARDRAIL: Check if case law citations have proper provenance
    // This blocks AI-generated quotes and forces retry with programmatic extraction tools
    const provenanceCheck = this.checkProvenanceGuardrail(citations);
    if (provenanceCheck.hasBlockedCitations) {
      console.log(
        `[VerificationEnforcer] 🚫 PROVENANCE GUARDRAIL TRIGGERED: ${provenanceCheck.blockedCitations.length} citations blocked`,
      );
      result.success = false;
      result.attempts = 1;
      result.provenanceBlockedCitations = provenanceCheck.blockedCitations;
      if (provenanceCheck.retryMessage) {
        result.retryMessages.push(provenanceCheck.retryMessage);
      }
      return result;
    }

    console.log(
      `[VerificationEnforcer] ✅ PROVENANCE GUARDRAIL PASSED: All case law citations have valid provenance`,
    );

    for (const citation of citations) {
      for (const authority of citation.authorities) {
        const allMatches = detectAllPieces(
          authority.citation + " " + authority.quote + " " + authority.url,
        );
        if (allMatches.length > 0) {
          const match = allMatches[0];
          result.success = false;
          const piecesList = allMatches
            .map((m) => `"${m.token}"`)
            .join(", ");
          result.retryMessages.push(
            `EXAMPLE FALLBACK DETECTED in authority: "${match.token}". Detected pieces: ${piecesList}. This indicates document extraction may have failed. Please verify your uploaded documents are readable.`,
          );
          return result;
        }
      }
    }

    const contextualAnalyses = this.parseContextJSON(stepText);
    if (contextualAnalyses) {
      console.log(
        `[VerificationEnforcer] 📊 CHECKPOINT: Found ${contextualAnalyses.length} contextual analyses`,
      );
      result.contextualAnalyses = contextualAnalyses;

      for (const analysis of contextualAnalyses) {
        const allQuotes = [
          analysis.authority_citation,
          ...analysis.preceding_context.quotes,
          ...analysis.subsequent_development.quotes,
          ...analysis.qualifications_limitations.quotes,
        ];
        const allMatches = detectAllPieces(allQuotes.join(" "));
        if (allMatches.length > 0) {
          const match = allMatches[0];
          console.error(
            `[VerificationEnforcer] ❌ CHECKPOINT: Example fallback detected in contextual analysis`,
          );
          result.success = false;
          const piecesList = allMatches
            .map((m) => `"${m.token}"`)
            .join(", ");
          result.retryMessages.push(
            `EXAMPLE FALLBACK DETECTED in contextual analysis: "${match.token}". Detected pieces: ${piecesList}. This indicates document extraction may have failed.`,
          );
          return result;
        }
      }
    } else {
      console.log("[VerificationEnforcer] ℹ️  No contextual analyses found");
    }

    let remainingCitations = [...citations];
    let attempt = 0;
    const verificationScoresMap = new Map<
      string,
      Array<{
        alphanumericPercent?: number;
        punctuationSpacePercent?: number;
        aiVerification?: string;
      }>
    >();

    const verificationDetailsMap = new Map<
      string,
      Array<{
        verified: boolean;
        fallbackFlag: boolean;
        confidenceScore: number;
        alphanumericPercent?: number;
        punctuationSpacePercent?: number;
        aiVerification?: string;
        correctedUrl?: string;
      }>
    >();

    while (attempt < maxRetries && remainingCitations.length > 0) {
      attempt++;
      result.attempts = attempt;
      console.log(
        `[VerificationEnforcer] 🔄 CHECKPOINT: Verification attempt ${attempt}/${maxRetries} for ${remainingCitations.length} citations`,
      );

      const failedThisAttempt: PropositionCitation[] = [];

      for (const citation of remainingCitations) {
        console.log(
          `[VerificationEnforcer] 🔍 Verifying citation for proposition ${citation.proposition_id}`,
        );
        const { verified, results: verificationResults } =
          await this.verifyCitation(citation);
        console.log(
          `[VerificationEnforcer] ${verified ? "✅" : "❌"} Citation verification result: ${verified}`,
        );

        verificationScoresMap.set(
          citation.proposition_id,
          verificationResults.map((vr) => ({
            alphanumericPercent: vr.alphanumericPercent,
            punctuationSpacePercent: vr.punctuationSpacePercent,
            aiVerification: vr.aiVerification,
          })),
        );

        verificationDetailsMap.set(
          citation.proposition_id,
          verificationResults.map((vr) => ({
            verified: vr.verified,
            fallbackFlag: vr.fallback_flag,
            confidenceScore: vr.confidence_score,
            alphanumericPercent: vr.alphanumericPercent,
            punctuationSpacePercent: vr.punctuationSpacePercent,
            aiVerification: vr.aiVerification,
            correctedUrl: vr.urlCaseVerification?.correctedUrl,
          })),
        );

        // DIAGNOSTIC: Log verificationDetailsMap population
        console.log(
          `[VerificationEnforcer] DIAGNOSTIC: verificationDetailsMap.set() called for proposition ${citation.proposition_id}:`,
          {
            resultsCount: verificationResults.length,
            resultsData: verificationResults.map((vr, idx) => ({
              index: idx,
              verified: vr.verified,
              AN: vr.alphanumericPercent,
              PS: vr.punctuationSpacePercent,
              AI: vr.aiVerification,
            })),
          },
        );

        let contextualVerified = true;
        const contextualFailures: string[] = [];

        if (contextualAnalyses && verified) {
          for (const authority of citation.authorities) {
            const contextAnalysis = contextualAnalyses.find(
              (ca) => ca.authority_citation === authority.citation,
            );

            if (contextAnalysis) {
              const { verified: ctxVerified, failedQuotes } =
                await this.verifyContextualQuotes(
                  contextAnalysis,
                  authority.url,
                );

              if (!ctxVerified) {
                contextualVerified = false;
                contextualFailures.push(
                  `Authority "${authority.citation}" has ${failedQuotes.length} failed contextual quotes:\n${failedQuotes.map((q) => `  - "${q.substring(0, 100)}..."`).join("\n")}`,
                );
              }
            }
          }
        }

        if (verified && contextualVerified) {
          console.log(
            `[VerificationEnforcer] ✅ CHECKPOINT: Citation ${citation.proposition_id} verified successfully`,
          );
          result.verifiedCitations.push(citation);
        } else {
          console.log(
            `[VerificationEnforcer] ❌ Citation ${citation.proposition_id} failed verification`,
          );
          const hasOpposingErrors = verificationResults.some(
            (vr) =>
              vr.attribution === "opposing" &&
              !vr.verified &&
              !vr.fallback_flag,
          );

          if (hasOpposingErrors) {
            result.opponentCitationErrors.push(citation);

            const opposingErrors = citation.authorities
              .map((auth, idx) => {
                const vr = verificationResults[idx];
                if (
                  vr &&
                  vr.attribution === "opposing" &&
                  !vr.verified &&
                  !vr.fallback_flag
                ) {
                  return `- Citation: "${auth.citation}"
  Quote: "${auth.quote}"
  URL: ${auth.url}
  ⚠️ OPPONENT CITATION ERROR: Quote not found in source (confidence: ${vr.confidence_score}%)
  This is a potential vulnerability in opposing counsel's argument.`;
                }
                return null;
              })
              .filter(Boolean)
              .join("\n\n");

            if (opposingErrors) {
              result.retryMessages.push(
                `Proposition ${citation.proposition_id} contains opposing counsel citation errors:\n\n${opposingErrors}`,
              );
            }

            continue;
          }

          const hasOurFirmErrors = verificationResults.some(
            (vr) =>
              vr.attribution === "our_firm" &&
              !vr.verified &&
              !vr.fallback_flag,
          );

          if (hasOurFirmErrors || !contextualVerified) {
            failedThisAttempt.push(citation);

            const failedAuthorities = citation.authorities
              .map((auth, idx) => {
                const vr = verificationResults[idx];
                if (
                  vr &&
                  vr.attribution === "our_firm" &&
                  !vr.verified &&
                  !vr.fallback_flag
                ) {
                  return `- Citation: "${auth.citation}"
  Quote: "${auth.quote}"
  URL: ${auth.url}
  Error: Quote not found in source (confidence: ${vr.confidence_score}%)`;
                }
                return null;
              })
              .filter(Boolean)
              .join("\n\n");

            let errorMessage = "";
            if (failedAuthorities) {
              errorMessage += `Proposition ${citation.proposition_id} has failed verification:\n\n${failedAuthorities}`;
            }

            if (contextualFailures.length > 0) {
              if (errorMessage) errorMessage += "\n\n";
              errorMessage += `Contextual verification failures:\n\n${contextualFailures.join("\n\n")}`;
            }

            if (errorMessage) {
              result.retryMessages.push(errorMessage);
            }
          }
        }
      }

      remainingCitations = failedThisAttempt;

      if (remainingCitations.length === 0) {
        console.log(
          `[VerificationEnforcer] ✅ CHECKPOINT: All citations verified after ${attempt} attempts`,
        );
        result.success = true;
        break;
      } else {
        console.log(
          `[VerificationEnforcer] ⚠️  ${remainingCitations.length} citations still need verification`,
        );
      }
    }

    result.failedCitations = remainingCitations;
    result.success = remainingCitations.length === 0;
    result.verificationScores = verificationScoresMap;
    result.verificationDetails = verificationDetailsMap;

    // DIAGNOSTIC: Log final verificationDetailsMap state
    console.log(
      `[VerificationEnforcer] DIAGNOSTIC: Final verificationDetailsMap state:`,
      {
        size: verificationDetailsMap.size,
        keys: Array.from(verificationDetailsMap.keys()),
        entries: Array.from(verificationDetailsMap.entries()).map(
          ([key, value]) => ({
            proposition_id: key,
            resultsCount: value.length,
            hasVerificationData: value.some(
              (v) =>
                v.alphanumericPercent !== undefined ||
                v.punctuationSpacePercent !== undefined ||
                v.aiVerification !== undefined,
            ),
          }),
        ),
      },
    );

    if (result.success) {
      console.log(
        `[VerificationEnforcer] 🎉 CHECKPOINT: Verification enforcement completed successfully`,
      );
      console.log(
        `[VerificationEnforcer] 📊 Final stats: ${result.verifiedCitations.length} verified, ${result.opponentCitationErrors.length} opponent errors`,
      );
    } else {
      console.error(
        `[VerificationEnforcer] ❌ CHECKPOINT: Verification enforcement failed after ${maxRetries} attempts`,
      );
      console.error(
        `[VerificationEnforcer] 📊 Final stats: ${result.verifiedCitations.length} verified, ${result.failedCitations.length} failed`,
      );
    }

    return result;
  }

  /**
   * Assign color to a proposition (rotating through colors, avoiding adjacent duplicates)
   */
  assignColor(): string {
    if (!this.citationIndex.lastColor) {
      this.citationIndex.lastColor = CITATION_COLORS[0];
      return CITATION_COLORS[0];
    }

    const lastIndex = CITATION_COLORS.indexOf(this.citationIndex.lastColor);
    const nextIndex = (lastIndex + 1) % CITATION_COLORS.length;
    this.citationIndex.lastColor = CITATION_COLORS[nextIndex];
    return CITATION_COLORS[nextIndex];
  }

  /**
   * Inject citation numbers and colors into text
   */
  injectCitations(
    text: string,
    citations: PropositionCitation[],
    verificationResultsMap?: Map<
      string,
      Array<{
        alphanumericPercent?: number;
        punctuationSpacePercent?: number;
        aiVerification?: string;
      }>
    >,
  ): { transformedText: string; referencesSection: string } {
    let transformedText = text;
    const references: string[] = [];

    for (const citation of citations) {
      const color = this.assignColor();
      const citationNumbers: number[] = [];
      const verificationResults = verificationResultsMap?.get(
        citation.proposition_id,
      );

      for (let i = 0; i < citation.authorities.length; i++) {
        const authority = citation.authorities[i];
        const citationNumber = this.citationIndex.nextNumber++;
        citationNumbers.push(citationNumber);

        const verificationScores = verificationResults?.[i];

        this.citationIndex.citations.set(citationNumber, {
          citation: authority.citation,
          quote: authority.quote,
          url: authority.url,
          type: authority.type,
          verified: true,
          color,
          proposition_id: citation.proposition_id,
          alphanumericPercent: verificationScores?.alphanumericPercent,
          punctuationSpacePercent: verificationScores?.punctuationSpacePercent,
          aiVerification: verificationScores?.aiVerification,
        });

        const scrollToTextUrl = this.generateScrollToTextUrl(
          authority.url,
          authority.quote,
        );
        references.push(
          `[${citationNumber}]: ${authority.citation} - "${authority.quote.substring(0, 100)}${authority.quote.length > 100 ? "..." : ""}" - [View Source](${scrollToTextUrl})`,
        );
      }

      const citationLinks = citationNumbers
        .map((num) => {
          const scrollToTextUrl = this.generateScrollToTextUrl(
            citation.authorities[citationNumbers.indexOf(num)].url,
            citation.authorities[citationNumbers.indexOf(num)].quote,
          );
          return `[[${num}]](${scrollToTextUrl})`;
        })
        .join("");

      const propositionRegex = new RegExp(
        `<Proposition\\s+id="${citation.proposition_id}">([^<]+)</Proposition>`,
        "gi",
      );
      transformedText = transformedText.replace(
        propositionRegex,
        `<span style="color: ${color};">$1</span> ${citationLinks}`,
      );
    }

    transformedText = transformedText.replace(
      /<CitationsJSON>[\s\S]*?<\/CitationsJSON>/gi,
      "",
    );

    transformedText = transformedText.replace(
      /<ContextJSON>[\s\S]*?<\/ContextJSON>/gi,
      "",
    );

    const referencesSection =
      references.length > 0
        ? `\n\n### References\n\n${references.join("\n\n")}`
        : "";

    return { transformedText, referencesSection };
  }

  /**
   * Generate scroll-to-text fragment URL
   */
  private generateScrollToTextUrl(baseUrl: string, quote: string): string {
    const truncatedQuote = quote.substring(0, 100);
    const encoded = encodeURIComponent(truncatedQuote);
    return `${baseUrl}#:~:text=${encoded}`;
  }

  /**
   * Get current citation index (for persistence)
   */
  getCitationIndex(): CitationIndex {
    return this.citationIndex;
  }

  /**
   * Set citation index (for restoration)
   */
  setCitationIndex(index: CitationIndex): void {
    this.citationIndex = index;
  }
}
