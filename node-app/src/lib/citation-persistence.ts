/**
 * Citation Persistence Service
 * Handles database operations for citation tracking system
 * Separates persistence logic from verification logic
 */

import { db } from "@/db/client";
import {
  propositions,
  citations,
  citationVerificationAttempts,
  citationIndexAssignments,
  contextualAnalyses,
  contextualQuotes,
  authoritySources,
  type NewProposition,
  type NewCitation,
  type NewCitationVerificationAttempt,
  type NewCitationIndexAssignment,
  type NewContextualAnalysis,
  type NewContextualQuote,
  type NewAuthoritySource,
} from "@/db/schema/citations";
import { eq, and, inArray } from "drizzle-orm";
import type {
  PropositionAuthority,
  ContextualAnalysis,
  CitationIndex,
} from "./verification-enforcer";

export type { CitationIndex };
import { createHash } from "crypto";

/**
 * Generate SHA-256 hash of normalized quote text for deduplication
 */
export function generateQuoteHash(normalizedQuote: string): string {
  return createHash("sha256").update(normalizedQuote).digest("hex");
}

/**
 * Generate scroll-to-text fragment URL
 */
export function generateScrollFragment(quote: string): string {
  const truncatedQuote = quote.substring(0, 100);
  const encoded = encodeURIComponent(truncatedQuote);
  return `#:~:text=${encoded}`;
}

/**
 * CourtListener base URL constant
 */
export const COURTLISTENER_BASE_URL = "https://www.courtlistener.com";

/**
 * Build a full CourtListener URL from an absolute_url path
 *
 * The CourtListener API returns an `absolute_url` field that contains just the path
 * (e.g., "/opinion/8524323/williamson-v-murray-in-re-murray/").
 * This function combines it with the base URL to create a working URL.
 *
 * @param absoluteUrl - The absolute_url path from CourtListener API (e.g., "/opinion/8524323/case-name/")
 * @returns Full URL (e.g., "https://www.courtlistener.com/opinion/8524323/case-name/")
 *
 * @example
 * buildCourtListenerUrl("/opinion/8524323/williamson-v-murray-in-re-murray/")
 * // Returns: "https://www.courtlistener.com/opinion/8524323/williamson-v-murray-in-re-murray/"
 */
export function buildCourtListenerUrl(absoluteUrl: string): string {
  if (!absoluteUrl) {
    return "";
  }

  // If it's already a full URL, return as-is
  if (absoluteUrl.startsWith("https://") || absoluteUrl.startsWith("http://")) {
    return absoluteUrl;
  }

  // Ensure the path starts with a forward slash
  const path = absoluteUrl.startsWith("/") ? absoluteUrl : `/${absoluteUrl}`;

  return `${COURTLISTENER_BASE_URL}${path}`;
}

/**
 * Normalize a CourtListener URL to ensure it's a valid, full URL
 *
 * Handles various input formats:
 * - Full URLs: returned as-is
 * - Absolute paths: prefixed with base URL
 * - API URLs: converted to opinion URLs if possible
 *
 * @param url - URL or path to normalize
 * @returns Normalized full URL
 *
 * @example
 * normalizeCourtListenerUrl("/opinion/8524323/case-name/")
 * // Returns: "https://www.courtlistener.com/opinion/8524323/case-name/"
 *
 * normalizeCourtListenerUrl("https://www.courtlistener.com/opinion/8524323/case-name/")
 * // Returns: "https://www.courtlistener.com/opinion/8524323/case-name/"
 */
/**
 * Get the canonical URL for a case law authority from provenance.
 * For case law, URLs must ONLY come from provenance.sourceUrl when the provenance
 * is from 'programmatic-quote-extraction' tool (not 'courtlistener-search').
 * This prevents URL/citation mismatches that occur when the AI grabs provenance
 * from the wrong search result in a multi-result array.
 * Returns null if case law authority lacks valid extraction provenance, indicating it should be skipped.
 * For non-case-law authorities, returns the original URL unchanged.
 * This is a pure function with no side effects.
 */
export function getCaseLawUrlFromProvenance(authority: {
  authority_type?: string;
  url?: string;
  provenance?: { sourceUrl?: string; toolName?: string };
}): string | null {
  const isCaseLaw = authority.authority_type === "case_law";
  if (!isCaseLaw) {
    return authority.url ?? null;
  }

  // CRITICAL: Only accept provenance from programmatic-quote-extraction
  // The courtlistener-search tool returns multiple results, and the AI can
  // accidentally attach provenance from the wrong result (e.g., cite Celotex
  // but attach Anderson's URL). The extraction tool operates on a single
  // opinionId, so there's no possibility of mismatch.
  const isValidExtractionProvenance =
    authority.provenance?.toolName === "programmatic-quote-extraction" &&
    authority.provenance?.sourceUrl;

  if (isValidExtractionProvenance) {
    return authority.provenance!.sourceUrl!;
  }

  // No valid extraction provenance for case law - should be skipped
  // This will cause the citation to be blocked by the provenance guardrail
  return null;
}

export function normalizeCourtListenerUrl(url: string): string {
  if (!url) {
    return "";
  }

  // If it's already a full CourtListener URL, return as-is
  if (url.includes("courtlistener.com")) {
    return url;
  }

  // If it's a path starting with /opinion/, /docket/, etc., build full URL
  if (url.startsWith("/")) {
    return buildCourtListenerUrl(url);
  }

  // Return as-is for other URLs
  return url;
}

/**
 * Result from server-side CourtListener resolution
 */
export interface CourtListenerResolutionResult {
  url: string;
  opinionId: string;
  caseName: string;
  citation: string | null;
  confidence: "exact" | "high" | "medium" | "low";
}

/**
 * Normalize case name for comparison by removing common variations
 */
function normalizeCaseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,;:'"()[\]{}]/g, "")
    .replace(/\bv\b\.?/g, "v")
    .replace(/\binc\b\.?/g, "inc")
    .replace(/\bcorp\b\.?/g, "corp")
    .replace(/\bllc\b\.?/g, "llc")
    .replace(/\bet al\b\.?/g, "")
    .replace(/\bin re\b/g, "in re")
    .trim();
}

/**
 * Calculate similarity score between two strings (0-1)
 * Uses Jaccard similarity on word sets
 */
function calculateSimilarity(str1: string, str2: string): number {
  const words1 = new Set(normalizeCaseName(str1).split(" ").filter(Boolean));
  const words2 = new Set(normalizeCaseName(str2).split(" ").filter(Boolean));

  if (words1.size === 0 || words2.size === 0) return 0;

  const intersection = new Set([...words1].filter((x) => words2.has(x)));
  const union = new Set([...words1, ...words2]);

  return intersection.size / union.size;
}

// ============================================================================
// CITATION PARSING AND SEARCH QUERY GENERATION
// ============================================================================

/**
 * Parsed citation structure for handling parallel citations and special formats
 */
export interface ParsedCitation {
  caseName: string;
  primaryCitation: string | null;
  parallelCitations: string[];
  pincite: string | null;
  court: string | null;
  year: string | null;
  fullText: string;
  isSpecialFormat: boolean;
}

/**
 * Reporter patterns for extracting citations from text
 * Order matters - more specific patterns (e.g., F.4th) must come before less specific (e.g., F.)
 */
const REPORTER_PATTERNS: Array<{ regex: RegExp; reporter: string }> = [
  // Federal Supreme Court
  { regex: /(\d+)\s+(U\.S\.)\s+(\d+)/gi, reporter: "U.S." },
  { regex: /(\d+)\s+(S\.\s*Ct\.)\s+(\d+)/gi, reporter: "S. Ct." },
  { regex: /(\d+)\s+(L\.\s*Ed\.\s*2d)\s+(\d+)/gi, reporter: "L. Ed. 2d" },

  // Federal Appellate (order by edition - 4th before 3d before 2d)
  { regex: /(\d+)\s+(F\.4th)\s+(\d+)/gi, reporter: "F.4th" },
  { regex: /(\d+)\s+(F\.3d)\s+(\d+)/gi, reporter: "F.3d" },
  { regex: /(\d+)\s+(F\.2d)\s+(\d+)/gi, reporter: "F.2d" },
  { regex: /(\d+)\s+(F\.)\s+(\d+)/gi, reporter: "F." },

  // Federal District
  { regex: /(\d+)\s+(F\.\s*Supp\.\s*3d)\s+(\d+)/gi, reporter: "F. Supp. 3d" },
  { regex: /(\d+)\s+(F\.\s*Supp\.\s*2d)\s+(\d+)/gi, reporter: "F. Supp. 2d" },
  { regex: /(\d+)\s+(F\.\s*Supp\.)\s+(\d+)/gi, reporter: "F. Supp." },

  // Kansas
  { regex: /(\d+)\s+(Kan\.\s*App\.\s*2d)\s+(\d+)/gi, reporter: "Kan. App. 2d" },
  { regex: /(\d+)\s+(Kan\.)\s+(\d+)/gi, reporter: "Kan." },
  { regex: /(\d+)\s+(P\.3d)\s+(\d+)/gi, reporter: "P.3d" },
  { regex: /(\d+)\s+(P\.2d)\s+(\d+)/gi, reporter: "P.2d" },

  // Other states
  { regex: /(\d+)\s+(Cal\.\s*4th)\s+(\d+)/gi, reporter: "Cal.4th" },
  { regex: /(\d+)\s+(Cal\.\s*3d)\s+(\d+)/gi, reporter: "Cal.3d" },
  { regex: /(\d+)\s+(N\.Y\.\s*3d)\s+(\d+)/gi, reporter: "N.Y.3d" },
  { regex: /(\d+)\s+(So\.\s*3d)\s+(\d+)/gi, reporter: "So.3d" },
  { regex: /(\d+)\s+(S\.W\.\s*3d)\s+(\d+)/gi, reporter: "S.W.3d" },
  { regex: /(\d+)\s+(A\.\s*3d)\s+(\d+)/gi, reporter: "A.3d" },
  { regex: /(\d+)\s+(N\.E\.\s*3d)\s+(\d+)/gi, reporter: "N.E.3d" },
];

/**
 * Extract all citations from text with their positions
 */
function extractAllCitations(text: string): Array<{
  citation: string;
  volume: string;
  reporter: string;
  page: string;
  index: number;
  endIndex: number;
}> {
  const citations: Array<{
    citation: string;
    volume: string;
    reporter: string;
    page: string;
    index: number;
    endIndex: number;
  }> = [];

  for (const { regex, reporter } of REPORTER_PATTERNS) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const [fullMatch, volume, , page] = match;
      citations.push({
        citation: `${volume} ${reporter} ${page}`,
        volume,
        reporter,
        page,
        index: match.index,
        endIndex: match.index + fullMatch.length,
      });
    }
  }

  citations.sort((a, b) => a.index - b.index);

  // Remove overlapping matches (keep the first one found at each position)
  const unique: typeof citations = [];
  for (const c of citations) {
    const overlaps = unique.some(
      (u) =>
        (c.index >= u.index && c.index < u.endIndex) ||
        (u.index >= c.index && u.index < c.endIndex),
    );
    if (!overlaps) unique.push(c);
  }

  return unique;
}

/**
 * Extract case name from citation text, handling special formats
 */
function extractCaseNameFromCitation(text: string): {
  caseName: string;
  isSpecialFormat: boolean;
} {
  // Special formats: "In re X", "Ex parte X", "Matter of X"
  const specialMatch = text.match(
    /^((?:In\s+re:?|Ex\s+parte|Matter\s+of)\s+[^,]+(?:,\s*(?:L\.?L\.?C\.?|Inc\.?|Corp\.?|Co\.?|Ltd\.?))?)/i,
  );
  if (specialMatch) {
    return { caseName: specialMatch[1].trim(), isSpecialFormat: true };
  }

  // Standard "X v. Y" format with corporate suffixes
  const vsPattern =
    /^([^,\d]+?(?:,\s*(?:L\.?L\.?C\.?|Inc\.?|Corp\.?|Co\.?|Ltd\.?))?\s+v\.?\s+[^,\d]+(?:,\s*(?:L\.?L\.?C\.?|Inc\.?|Corp\.?|Co\.?|Ltd\.?))?)/i;
  const vsMatch = text.match(vsPattern);
  if (vsMatch) {
    return {
      caseName: vsMatch[1].trim().replace(/,\s*$/, ""),
      isSpecialFormat: false,
    };
  }

  // Fallback: use text before first citation
  const firstCitation = extractAllCitations(text)[0];
  if (firstCitation) {
    const beforeCitation = text.substring(0, firstCitation.index);
    const caseName = beforeCitation.replace(/,\s*$/, "").trim();
    if (caseName) return { caseName, isSpecialFormat: false };
  }

  return {
    caseName: text.split(",")[0]?.trim() || text.trim(),
    isSpecialFormat: false,
  };
}

/**
 * Parse a full citation string into its components
 * Handles parallel citations (e.g., "227 Kan. 271, 607 P.2d 438")
 * and distinguishes pincites from parallel citations
 *
 * @param fullCitation - The full citation text (e.g., "Nelson v. Miller, 227 Kan. 271, 607 P.2d 438 (1980)")
 * @returns Parsed citation with primary citation, parallel citations, and metadata
 */
export function parseCitation(fullCitation: string): ParsedCitation {
  const result: ParsedCitation = {
    caseName: "",
    primaryCitation: null,
    parallelCitations: [],
    pincite: null,
    court: null,
    year: null,
    fullText: fullCitation,
    isSpecialFormat: false,
  };

  // Extract court and year from parentheses at end
  const courtYearMatch = fullCitation.match(/\(([^)]+)\)\s*$/);
  if (courtYearMatch) {
    const content = courtYearMatch[1];
    const yearMatch = content.match(/(\d{4})/);
    if (yearMatch) {
      result.year = yearMatch[1];
      result.court =
        content.replace(/\d{4}/, "").trim().replace(/[,.]$/, "").trim() || null;
    }
  }

  // Extract case name
  const { caseName, isSpecialFormat } =
    extractCaseNameFromCitation(fullCitation);
  result.caseName = caseName;
  result.isSpecialFormat = isSpecialFormat;

  // Extract all citations
  const allCitations = extractAllCitations(fullCitation);

  if (allCitations.length > 0) {
    result.primaryCitation = allCitations[0].citation;

    // Check for pincite after primary citation
    const primaryEnd = allCitations[0].endIndex;
    const afterPrimary = fullCitation.substring(primaryEnd);
    const pinciteMatch = afterPrimary.match(/^,?\s*(\d+)(?![.\d]|\s+[A-Z])/);

    if (pinciteMatch) {
      const potentialPincite = pinciteMatch[1];
      // Make sure it's not the volume of another citation
      const isAnotherVolume = allCitations.some(
        (c, i) => i > 0 && c.volume === potentialPincite,
      );
      if (!isAnotherVolume) {
        result.pincite = potentialPincite;
      }
    }

    // Remaining citations are parallel citations
    result.parallelCitations = allCitations.slice(1).map((c) => c.citation);
  }

  return result;
}

/**
 * Generate search queries for CourtListener based on parsed citation
 * Returns queries in order of preference (most specific first)
 *
 * @param parsed - Parsed citation from parseCitation()
 * @returns Array of search queries to try in order
 */
export function generateSearchQueries(parsed: ParsedCitation): string[] {
  const queries: string[] = [];

  // Strategy 1: Primary reporter citation (most specific)
  if (parsed.primaryCitation) {
    queries.push(parsed.primaryCitation);
  }

  // Strategy 2: Each parallel citation individually
  for (const parallel of parsed.parallelCitations) {
    queries.push(parallel);
  }

  // Strategy 3: Case name with primary citation
  if (parsed.caseName && parsed.primaryCitation) {
    queries.push(`${parsed.caseName}, ${parsed.primaryCitation}`);
  }

  // Strategy 4: Case name alone
  if (parsed.caseName) {
    queries.push(parsed.caseName);

    // For special formats, also try without prefix
    if (parsed.isSpecialFormat) {
      const withoutPrefix = parsed.caseName
        .replace(/^In\s+re:?\s+/i, "")
        .replace(/^Ex\s+parte\s+/i, "")
        .replace(/^Matter\s+of\s+/i, "");
      if (withoutPrefix !== parsed.caseName) {
        queries.push(withoutPrefix);
      }
    }
  }

  // Remove duplicates while preserving order
  return [...new Set(queries)];
}

// ============================================================================
// MARKDOWN LINK CLEANUP FUNCTIONS
// ============================================================================

/**
 * Fix markdown links where the case name is split between link text and following text.
 *
 * Problem: [Pioneer Ridge](url), L.L.C. v. Ermey
 * Fixed:   [Pioneer Ridge, L.L.C. v. Ermey](url)
 */
export function fixSplitCaseNameLinks(text: string): string {
  // Pattern: [text](url) followed by ", CorpSuffix v. Name" or similar
  // Must contain "v." to be considered a case name continuation
  const splitPattern =
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\),?\s*((?:L\.?L\.?C\.?|Inc\.?|Corp\.?|Co\.?|Ltd\.?)?\s*v\.?\s+[A-Za-z][^,\[\]\d]*?)(?=,?\s*\d|\s*$|\s*\()/gi;

  return text.replace(splitPattern, (match, linkText, url, continuation) => {
    if (/\bv\.?\b/i.test(continuation)) {
      const mergedText = `${linkText}, ${continuation}`
        .trim()
        .replace(/,\s*$/, "");
      return `[${mergedText}](${url})`;
    }
    return match;
  });
}

/**
 * Remove orphaned markdown link closures ("](...)" without matching "[").
 */
export function removeOrphanedLinkClosures(text: string): string {
  let result = text;
  const orphanPattern = /\]\(https?:\/\/[^)]+\)/g;
  const matches = [...text.matchAll(orphanPattern)];

  for (let i = matches.length - 1; i >= 0; i--) {
    const match = matches[i];
    if (match.index === undefined) continue;

    const before = text.substring(0, match.index);
    const lastOpen = before.lastIndexOf("[");
    const lastClose = before.lastIndexOf("]");

    if (lastOpen === -1 || lastClose > lastOpen) {
      result =
        result.substring(0, match.index) +
        result.substring(match.index + match[0].length);
    }
  }

  return result;
}

/**
 * Main cleanup function for markdown links.
 * Fixes split case names and removes orphaned link closures.
 */
export function cleanupMarkdownLinks(text: string): string {
  let result = text;

  // Step 1: Fix split case names
  result = fixSplitCaseNameLinks(result);

  // Step 2: Remove orphaned link closures
  result = removeOrphanedLinkClosures(result);

  // Step 3: Normalize multi-line URLs
  result = result.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)]*(?:\r?\n[^)]*)*)\)/g,
    (match, linkText, url) => `[${linkText}](${url.replace(/\r?\n\s*/g, "")})`,
  );

  // Step 4: Fix nested markdown links inside URLs (balanced parens)
  // Pattern: [text](https://...com/path/[nested](https://...)) → [text](inner-url)
  // This happens when hyperlinkCaseMentionsFromToolLogs wraps text inside an existing URL
  result = result.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]*\[[^\]]+\]\(https?:\/\/[^)]+\)[^\s)]*)\)/g,
    (match, linkText, corruptedUrl) => {
      // Extract the inner URL (which is the correct, complete URL)
      const nestedMatch = corruptedUrl.match(
        /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/,
      );
      if (nestedMatch) {
        return `[${linkText}](${nestedMatch[2]})`;
      }
      return match;
    },
  );

  // Step 5: Fix nested markdown links with unbalanced parens
  // Pattern: [text](https://base/path/[nested](https://inner-url/) ← only 1 closing paren
  // The inner link's ) is consumed as the only ), leaving the outer link unclosed
  // This is the most common corruption pattern from hyperlinkCaseMentionsFromToolLogs
  result = result.replace(
    /\[([^\]]+)\]\(https?:\/\/[^\s[]+\[[^\]]+\]\((https?:\/\/[^\s)]+)\)/g,
    (match, outerText, innerUrl) => {
      // Use the inner URL which is the correct, complete URL
      return `[${outerText}](${innerUrl})`;
    },
  );

  // Step 6: Strip [View Source](undefined#...) markdown links
  // These are generated when citationUrl is undefined and get injected as raw markdown
  // They should be removed entirely since the URL is not available
  result = result.replace(/\s*-?\s*\[View Source\]\(undefined[^)]*\)/g, "");

  // Step 7: Strip leaked (undefined#:~:text=...) URL fragments
  // These appear as plain text when the markdown link wasn't properly formed
  result = result.replace(/\s*\(undefined#[^)]*\)/g, "");

  return result;
}

// ============================================================================
// COURTLISTENER RESOLUTION
// ============================================================================

/**
 * Server-side CourtListener resolution - searches CourtListener using citation text
 * and returns the URL from the best matching result.
 *
 * This removes AI from URL generation entirely. The AI provides citation text,
 * and the backend programmatically searches CourtListener and matches the response's
 * caseName against the citation text to find the correct URL.
 *
 * @param citationText - The citation text from the AI (e.g., "Celotex Corp. v. Catrett, 477 U.S. 317")
 * @returns Resolution result with URL, opinionId, and confidence level, or null if no match found
 */
export async function resolveCourtListenerUrl(
  citationText: string,
): Promise<CourtListenerResolutionResult | null> {
  const apiKey = (process.env.COURTLISTENER_API_KEY || "").trim();

  if (!apiKey) {
    console.error(
      "[resolveCourtListenerUrl] CourtListener API key not configured",
    );
    return null;
  }

  if (!citationText || citationText.trim().length === 0) {
    console.error("[resolveCourtListenerUrl] Empty citation text provided");
    return null;
  }

  console.log(
    `[resolveCourtListenerUrl] Searching CourtListener for: "${citationText}"`,
  );

  // Parse the citation and generate search queries
  const parsed = parseCitation(citationText);
  const searchQueries = generateSearchQueries(parsed);

  console.log(`[resolveCourtListenerUrl] Parsed citation:`, {
    caseName: parsed.caseName,
    primaryCitation: parsed.primaryCitation,
    parallelCitations: parsed.parallelCitations,
    isSpecialFormat: parsed.isSpecialFormat,
  });
  console.log(
    `[resolveCourtListenerUrl] Generated ${searchQueries.length} search queries: ${searchQueries.join(", ")}`,
  );

  const maxRetries = 3;
  const baseDelay = 1000;

  // Try each search query until we get results
  for (const searchQuery of searchQueries) {
    const sanitizedQuery = searchQuery.replace(/[\r\n]/g, "");
    console.log(`[resolveCourtListenerUrl] Trying query: "${sanitizedQuery}"`);

    const params = new URLSearchParams({
      q: sanitizedQuery,
      order_by: "score desc",
      page_size: "10",
    });

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await fetch(
          `https://www.courtlistener.com/api/rest/v4/search/?${params.toString()}`,
          {
            headers: {
              Authorization: `Token ${apiKey}`,
              Accept: "application/json",
              "User-Agent": "DocumentReviewer/1.0",
            },
          },
        );

        if (!response.ok) {
          const bodyText = await response.text();
          console.error(
            `[resolveCourtListenerUrl] HTTP ${response.status}: ${bodyText.substring(0, 200)}`,
          );

          if (response.status === 503 || response.status === 504) {
            if (attempt < maxRetries - 1) {
              const delay = baseDelay * Math.pow(2, attempt);
              console.log(
                `[resolveCourtListenerUrl] Retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`,
              );
              await new Promise((resolve) => setTimeout(resolve, delay));
              continue;
            }
          }
          // Try next query on non-retryable errors
          break;
        }

        const data = await response.json();

        if (!data.results || data.results.length === 0) {
          console.log(
            `[resolveCourtListenerUrl] No results found for query: "${sanitizedQuery}"`,
          );
          // Try next query
          break;
        }

        // Find the best matching result by comparing caseName to citation text
        let bestMatch: {
          result: any;
          similarity: number;
          confidence: "exact" | "high" | "medium" | "low";
        } | null = null;

        for (const result of data.results) {
          const caseName = result.caseName || "";
          const similarity = calculateSimilarity(citationText, caseName);

          // Determine confidence level
          let confidence: "exact" | "high" | "medium" | "low";
          if (similarity >= 0.9) {
            confidence = "exact";
          } else if (similarity >= 0.7) {
            confidence = "high";
          } else if (similarity >= 0.5) {
            confidence = "medium";
          } else {
            confidence = "low";
          }

          // Also check if the citation reporter matches (e.g., "477 U.S. 317")
          const citationStr =
            typeof result.citation === "string" ? result.citation : "";
          const citationMatch =
            citationStr.length > 0 &&
            citationText.toLowerCase().includes(citationStr.toLowerCase());
          if (citationMatch && confidence !== "exact") {
            // Boost confidence if citation matches
            confidence =
              confidence === "low"
                ? "medium"
                : confidence === "medium"
                  ? "high"
                  : "exact";
          }

          if (!bestMatch || similarity > bestMatch.similarity) {
            bestMatch = { result, similarity, confidence };
          }
        }

        if (!bestMatch || bestMatch.confidence === "low") {
          console.log(
            `[resolveCourtListenerUrl] No confident match found for query: "${searchQuery}" (best similarity: ${bestMatch?.similarity.toFixed(2) || 0})`,
          );
          // Try next query
          break;
        }

        // Extract opinionId from absolute_url
        const absoluteUrl = bestMatch.result.absolute_url || "";
        const opinionIdMatch = absoluteUrl.match(/\/opinion\/(\d+)\//);
        const opinionId = opinionIdMatch ? opinionIdMatch[1] : "";

        const url = buildCourtListenerUrl(absoluteUrl);

        console.log(
          `[resolveCourtListenerUrl] Found match: "${bestMatch.result.caseName}" -> ${url} (confidence: ${bestMatch.confidence}, similarity: ${bestMatch.similarity.toFixed(2)}, query: "${searchQuery}")`,
        );

        return {
          url,
          opinionId,
          caseName: bestMatch.result.caseName || "",
          citation: bestMatch.result.citation || null,
          confidence: bestMatch.confidence,
        };
      } catch (error) {
        console.error(
          `[resolveCourtListenerUrl] Error searching CourtListener:`,
          error,
        );

        if (attempt < maxRetries - 1) {
          const delay = baseDelay * Math.pow(2, attempt);
          console.log(
            `[resolveCourtListenerUrl] Retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        // Try next query after exhausting retries
        break;
      }
    }
  }

  console.log(
    `[resolveCourtListenerUrl] No results found after trying all ${searchQueries.length} queries for: "${citationText}"`,
  );
  return null;
}

/**
 * Get the canonical URL for a case law authority.
 * For case law, this function performs server-side CourtListener resolution
 * using the citation text to find the correct URL programmatically.
 * This removes AI from URL generation entirely - the AI provides citation text,
 * and the backend searches CourtListener and matches the response's caseName.
 *
 * For non-case-law authorities, returns the original URL unchanged.
 *
 * @param authority - The authority object containing citation text and type
 * @returns Object with URL and metadata, or null if resolution failed
 */
export async function resolveCaseLawUrl(authority: {
  authority_type?: string;
  citation?: string;
  url?: string;
}): Promise<{
  url: string;
  opinionId?: string;
  resolvedCaseName?: string;
  confidence?: "exact" | "high" | "medium" | "low";
} | null> {
  const isCaseLaw = authority.authority_type === "case_law";

  // For non-case-law authorities, return the original URL
  if (!isCaseLaw) {
    return authority.url ? { url: authority.url } : null;
  }

  // For case law, perform server-side CourtListener resolution
  const citationText = authority.citation;
  if (!citationText) {
    console.error(
      "[resolveCaseLawUrl] No citation text provided for case law authority",
    );
    return null;
  }

  const resolution = await resolveCourtListenerUrl(citationText);
  if (!resolution) {
    console.log(
      `[resolveCaseLawUrl] Could not resolve CourtListener URL for: "${citationText}"`,
    );
    return null;
  }

  return {
    url: resolution.url,
    opinionId: resolution.opinionId,
    resolvedCaseName: resolution.caseName,
    confidence: resolution.confidence,
  };
}

/**
 * Persist a proposition to the database
 */
export async function persistProposition(
  sessionId: string,
  organizationId: string,
  stepIndex: number,
  stepId: string | undefined,
  stepName: string | undefined,
  text: string,
  orderIndex: number,
): Promise<string> {
  const sessionIdNum = Number(sessionId);
  const organizationIdNum = Number(organizationId);
  const [proposition] = await db
    .insert(propositions)
    .values({
      analysisSessionId: sessionIdNum,
      organizationId: organizationIdNum,
      stepIndex,
      stepId,
      stepName,
      text,
      orderIndex,
    })
    .returning();

  return String(proposition.id);
}

/**
 * Upsert a citation (insert or update if exists)
 * Uses unique constraint on (proposition_id, url, quote_hash)
 */
export async function upsertCitation(
  sessionId: string,
  organizationId: string,
  propositionId: string,
  authority: PropositionAuthority,
  quoteTextNormalized: string,
  quoteHash: string,
  documentId?: string,
): Promise<string> {
  const sessionIdNum = Number(sessionId);
  const organizationIdNum = Number(organizationId);
  const propositionIdNum = Number(propositionId);
  const documentIdNum =
    documentId !== undefined ? Number(documentId) : undefined;

  console.log(
    `[upsertCitation] DIAGNOSTIC: Starting upsert for propositionId=${propositionId}, url=${authority.url?.substring(0, 50)}`,
  );

  // Validate required fields before attempting insert
  if (!authority.url) {
    console.error(
      `[upsertCitation] ERROR: authority.url is undefined or null for propositionId=${propositionId}`,
    );
    throw new Error(
      `Cannot insert citation: url is required but was ${authority.url}`,
    );
  }
  if (!authority.citation) {
    console.error(
      `[upsertCitation] ERROR: authority.citation is undefined or null for propositionId=${propositionId}`,
    );
    throw new Error(
      `Cannot insert citation: citation is required but was ${authority.citation}`,
    );
  }
  if (!authority.quote) {
    console.error(
      `[upsertCitation] ERROR: authority.quote is undefined or null for propositionId=${propositionId}`,
    );
    throw new Error(
      `Cannot insert citation: quote is required but was ${authority.quote}`,
    );
  }

  try {
    const existing = await db
      .select()
      .from(citations)
      .where(
        and(
          eq(citations.propositionId, propositionIdNum),
          eq(citations.url, authority.url),
          eq(citations.quoteHash, quoteHash),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      console.log(
        `[upsertCitation] DIAGNOSTIC: Found existing citation ${existing[0].id}, updating status`,
      );
      await db
        .update(citations)
        .set({
          status: "pending",
          updatedAt: new Date(),
        })
        .where(eq(citations.id, existing[0].id));

      return String(existing[0].id);
    }

    console.log(
      `[upsertCitation] DIAGNOSTIC: No existing citation found, inserting new citation`,
    );
    console.log(
      `[upsertCitation] DIAGNOSTIC: Insert values:`,
      JSON.stringify({
        analysisSessionId: sessionId,
        organizationId: organizationIdNum,
        propositionId: propositionIdNum,
        type: authority.type,
        authorityType: authority.authority_type,
        citationText: authority.citation?.substring(0, 50),
        url: authority.url?.substring(0, 80),
        quoteLength: authority.quote?.length,
      }),
    );

    const [citation] = await db
      .insert(citations)
      .values({
        analysisSessionId: sessionIdNum,
        organizationId: organizationIdNum,
        propositionId: propositionIdNum,
        type: authority.type,
        authorityType: authority.authority_type,
        citationText: authority.citation,
        url: authority.url,
        documentId: documentIdNum,
        quoteText: authority.quote,
        quoteTextNormalized,
        quoteHash,
        scrollFragment: generateScrollFragment(authority.quote),
        attribution: authority.attribution,
        status: "pending",
        verified: false,
        fallbackFlag: false,
        retryCount: 0,
      })
      .returning();

    console.log(
      `[upsertCitation] SUCCESS: Inserted citation ${citation.id} for propositionId=${propositionId}`,
    );
    return String(citation.id);
  } catch (error) {
    console.error(
      `[upsertCitation] DATABASE ERROR for propositionId=${propositionId}:`,
      error,
    );
    if (error instanceof Error) {
      console.error(`[upsertCitation] Error stack:`, error.stack);
    }
    throw error; // Re-throw to let caller handle
  }
}

/**
 * Update citation URL when URL case verification finds a corrected URL
 */
export async function updateCitationUrl(
  citationId: string,
  newUrl: string,
): Promise<void> {
  const citationIdNum = Number(citationId);
  console.log(
    `[updateCitationUrl] Updating citation ${citationId} URL to: ${newUrl}`,
  );
  await db
    .update(citations)
    .set({
      url: newUrl,
      updatedAt: new Date(),
    })
    .where(eq(citations.id, citationIdNum));
}

/**
 * Update citation verification status including three-score verification fields
 */
export async function updateCitationVerification(
  citationId: string,
  verified: boolean,
  confidence: number,
  fallbackFlag: boolean,
  retryCount: number,
  note?: string,
  alphanumericPercent?: number,
  punctuationSpacePercent?: number,
  aiVerification?: string,
): Promise<void> {
  const citationIdNum = Number(citationId);
  await db
    .update(citations)
    .set({
      status: verified ? "verified" : fallbackFlag ? "failed" : "verifying",
      verified,
      verificationConfidence: confidence.toString(),
      fallbackFlag,
      retryCount,
      verifiedAt: verified ? new Date() : null,
      note,
      updatedAt: new Date(),
      alphanumericPercent:
        alphanumericPercent !== undefined
          ? alphanumericPercent.toString()
          : null,
      punctuationSpacePercent:
        punctuationSpacePercent !== undefined
          ? punctuationSpacePercent.toString()
          : null,
      aiVerification: aiVerification ?? null,
    })
    .where(eq(citations.id, citationIdNum));
}

/**
 * Persist a verification attempt
 */
export async function persistVerificationAttempt(
  citationId: string,
  organizationId: string,
  attemptNumber: number,
  method: "extract" | "crawl" | "other",
  matched: boolean,
  confidence: number,
  isImageScan: boolean,
  textLength: number,
  note?: string,
): Promise<void> {
  const citationIdNum = Number(citationId);
  const organizationIdNum = Number(organizationId);
  await db.insert(citationVerificationAttempts).values({
    citationId: citationIdNum,
    organizationId: organizationIdNum,
    attemptNumber,
    method,
    matched,
    confidence: confidence.toString(),
    isImageScan,
    textLength,
    note,
  });
}

/**
 * Assign footnote number to citation (stable numbering)
 * Returns the assigned number
 */
export async function assignFootnoteNumber(
  sessionId: string,
  organizationId: string,
  propositionId: string,
  citationId: string,
  color: string,
): Promise<number> {
  const sessionIdNum = Number(sessionId);
  const organizationIdNum = Number(organizationId);
  const propositionIdNum = Number(propositionId);
  const citationIdNum = Number(citationId);
  const existing = await db
    .select()
    .from(citationIndexAssignments)
    .where(
      and(
        eq(citationIndexAssignments.analysisSessionId, sessionIdNum),
        eq(citationIndexAssignments.propositionId, propositionIdNum),
        eq(citationIndexAssignments.citationId, citationIdNum),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    return existing[0].number;
  }

  const maxNumber = await db
    .select()
    .from(citationIndexAssignments)
    .where(eq(citationIndexAssignments.analysisSessionId, sessionIdNum))
    .orderBy(citationIndexAssignments.number);

  const nextNumber =
    maxNumber.length > 0 ? maxNumber[maxNumber.length - 1].number + 1 : 1;

  await db.insert(citationIndexAssignments).values({
    analysisSessionId: sessionIdNum,
    organizationId: organizationIdNum,
    propositionId: propositionIdNum,
    citationId: citationIdNum,
    number: nextNumber,
    color,
  });

  return nextNumber;
}

/**
 * Persist contextual analysis
 */
export async function persistContextualAnalysis(
  citationId: string,
  organizationId: string,
  context: ContextualAnalysis,
): Promise<string> {
  const citationIdNum = Number(citationId);
  const organizationIdNum = Number(organizationId);
  const [analysis] = await db
    .insert(contextualAnalyses)
    .values({
      citationId: citationIdNum,
      organizationId: organizationIdNum,
      authorityCitation: context.authority_citation,
      authorityType: context.authority_type,
      statementFunction: context.statement_function,
      precedingContextSummary: context.preceding_context.summary,
      subsequentDevelopmentSummary: context.subsequent_development.summary,
      qualificationsLimitationsSummary:
        context.qualifications_limitations.summary,
      alignmentVerification: context.alignment_verification,
    })
    .returning();

  return String(analysis.id);
}

/**
 * Persist contextual quotes
 */
export async function persistContextualQuotes(
  contextualAnalysisId: string,
  organizationId: string,
  section: "preceding" | "subsequent" | "qualifications",
  quotes: string[],
  normalizeTextFn: (text: string) => string,
  linkedCitationId?: string,
): Promise<void> {
  const contextualAnalysisIdNum = Number(contextualAnalysisId);
  const organizationIdNum = Number(organizationId);
  const linkedCitationIdNum =
    linkedCitationId !== undefined ? Number(linkedCitationId) : undefined;
  for (const quote of quotes) {
    const normalized = normalizeTextFn(quote);
    const hash = generateQuoteHash(normalized);

    await db.insert(contextualQuotes).values({
      contextualAnalysisId: contextualAnalysisIdNum,
      organizationId: organizationIdNum,
      section,
      quoteText: quote,
      quoteTextNormalized: normalized,
      quoteHash: hash,
      verified: false,
      linkedCitationId: linkedCitationIdNum,
    });
  }
}

/**
 * Cache authority source content
 */
export async function cacheAuthoritySource(
  url: string,
  organizationId: string,
  title: string | undefined,
  extractedText: string,
  textLength: number,
  isImageScan: boolean,
): Promise<void> {
  const organizationIdNum = Number(organizationId);
  const existing = await db
    .select()
    .from(authoritySources)
    .where(
      and(
        eq(authoritySources.url, url),
        eq(authoritySources.organizationId, organizationIdNum),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(authoritySources)
      .set({
        title,
        extractedText,
        textLength,
        isImageScan,
        lastFetchedAt: new Date(),
      })
      .where(eq(authoritySources.id, existing[0].id));
  } else {
    await db.insert(authoritySources).values({
      url,
      organizationId: organizationIdNum,
      title,
      extractedText,
      textLength,
      isImageScan,
    });
  }
}

/**
 * Get cached authority source
 */
export async function getCachedAuthoritySource(
  url: string,
): Promise<{ text: string; isImageScan: boolean } | null> {
  const cached = await db
    .select()
    .from(authoritySources)
    .where(eq(authoritySources.url, url))
    .limit(1);

  if (cached.length === 0) {
    return null;
  }

  return {
    text: cached[0].extractedText || "",
    isImageScan: cached[0].isImageScan,
  };
}

/**
 * Assemble CitationIndex from database for Word export
 * Returns the structure expected by generateWordReport()
 */
export async function assembleCitationIndexFromDB(
  sessionId: string,
): Promise<CitationIndex> {
  const sessionIdNum = Number(sessionId);
  const assignments = await db
    .select({
      number: citationIndexAssignments.number,
      color: citationIndexAssignments.color,
      citationId: citationIndexAssignments.citationId,
      propositionId: citationIndexAssignments.propositionId,
    })
    .from(citationIndexAssignments)
    .where(eq(citationIndexAssignments.analysisSessionId, sessionIdNum))
    .orderBy(citationIndexAssignments.number);

  if (assignments.length === 0) {
    return {
      nextNumber: 1,
      lastColor: null,
      citations: new Map(),
    };
  }

  // Batch-fetch all citations in a single query instead of N+1 queries
  const citationIds = [...new Set(assignments.map((a) => a.citationId))];
  const allCitations = await db
    .select({
      id: citations.id,
      citationText: citations.citationText,
      quoteText: citations.quoteText,
      url: citations.url,
      type: citations.type,
      verified: citations.verified,
    })
    .from(citations)
    .where(inArray(citations.id, citationIds));

  const citationLookup = new Map(allCitations.map((c) => [c.id, c]));

  const citationMap = new Map();
  let lastColor: string | null = null;

  for (const assignment of assignments) {
    const citation = citationLookup.get(assignment.citationId);

    if (citation) {
      citationMap.set(assignment.number, {
        citation: citation.citationText,
        quote: citation.quoteText,
        url: citation.url,
        type: citation.type,
        verified: citation.verified,
        color: assignment.color,
        proposition_id: assignment.propositionId,
      });
      lastColor = assignment.color;
    }
  }

  const maxNumber = Math.max(...Array.from(citationMap.keys()));

  return {
    nextNumber: maxNumber + 1,
    lastColor,
    citations: citationMap,
  };
}

/**
 * Assemble ContextualAnalysis array from database for Word export
 */
export async function assembleContextualAnalysesFromDB(
  sessionId: string,
): Promise<ContextualAnalysis[]> {
  const sessionIdNum = Number(sessionId);
  // Fetch only the columns we need from citations
  const sessionCitationRows = await db
    .select({ id: citations.id })
    .from(citations)
    .where(eq(citations.analysisSessionId, sessionIdNum));

  if (sessionCitationRows.length === 0) {
    return [];
  }

  const citationIds = sessionCitationRows.map((c) => c.id);

  // Batch-fetch all contextual analyses in a single query
  const allAnalyses = await db
    .select()
    .from(contextualAnalyses)
    .where(inArray(contextualAnalyses.citationId, citationIds));

  if (allAnalyses.length === 0) {
    return [];
  }

  // Batch-fetch all contextual quotes for all analyses in a single query
  const analysisIds = allAnalyses.map((a) => a.id);
  const allQuotes = await db
    .select()
    .from(contextualQuotes)
    .where(inArray(contextualQuotes.contextualAnalysisId, analysisIds));

  // Group quotes by analysis ID and section for O(1) lookup
  const quotesByAnalysisAndSection = new Map<number, Map<string, string[]>>();
  for (const quote of allQuotes) {
    let sectionMap = quotesByAnalysisAndSection.get(quote.contextualAnalysisId);
    if (!sectionMap) {
      sectionMap = new Map();
      quotesByAnalysisAndSection.set(quote.contextualAnalysisId, sectionMap);
    }
    const quotes = sectionMap.get(quote.section) || [];
    quotes.push(quote.quoteText);
    sectionMap.set(quote.section, quotes);
  }

  const results: ContextualAnalysis[] = [];

  for (const analysis of allAnalyses) {
    const sectionMap = quotesByAnalysisAndSection.get(analysis.id);
    const precedingQuoteTexts = sectionMap?.get("preceding") || [];
    const subsequentQuoteTexts = sectionMap?.get("subsequent") || [];
    const qualificationsQuoteTexts = sectionMap?.get("qualifications") || [];

    results.push({
      authority_citation: analysis.authorityCitation,
      authority_type: analysis.authorityType as
        | "legal_authority"
        | "documentary_evidence",
      preceding_context: {
        summary: analysis.precedingContextSummary,
        quotes: precedingQuoteTexts,
      },
      statement_function: analysis.statementFunction,
      subsequent_development: {
        summary: analysis.subsequentDevelopmentSummary,
        quotes: subsequentQuoteTexts,
      },
      qualifications_limitations: {
        summary: analysis.qualificationsLimitationsSummary,
        quotes: qualificationsQuoteTexts,
      },
      alignment_verification: analysis.alignmentVerification,
    });
  }

  return results;
}

/**
 * Get all citations for a session with CourtListener opinion URLs
 * Used for normalizing search URLs to opinion URLs in exported documents
 */
export async function getSessionCitationsWithOpinionUrls(
  sessionId: string,
): Promise<Array<{ citationText: string; url: string }>> {
  const sessionIdNum = Number(sessionId);
  const sessionCitations = await db
    .select({
      citationText: citations.citationText,
      url: citations.url,
    })
    .from(citations)
    .where(eq(citations.analysisSessionId, sessionIdNum));

  // Filter to only citations with CourtListener opinion URLs
  return sessionCitations.filter(
    (c) =>
      c.url && c.citationText && c.url.includes("courtlistener.com/opinion/"),
  );
}

/**
 * Normalize CourtListener search URLs to opinion URLs in text
 * Replaces URLs like https://www.courtlistener.com/?q=Case+Name&type=o
 * with verified opinion URLs like https://www.courtlistener.com/opinion/123456/case-name/
 */
export function normalizeCourtListenerUrls(
  text: string,
  citationsWithUrls: Array<{ citationText: string; url: string }>,
): string {
  // Match CourtListener search URLs in markdown links
  // Pattern: (https://www.courtlistener.com/?q=...&type=o) or similar
  const SEARCH_URL_REGEX =
    /\(https:\/\/(?:www\.)?courtlistener\.com\/\?q=([^)&]+)[^)]*\)/g;

  let replacementCount = 0;

  const result = text.replace(SEARCH_URL_REGEX, (fullMatch, encodedQuery) => {
    // Decode the search query to get the case name
    const query = decodeURIComponent(encodedQuery.replace(/\+/g, " ")).trim();
    const queryLower = query.toLowerCase();

    // Find a citation whose citation_text matches the case name
    // We look for partial matches since the search query might be just the case name
    // while citation_text includes the full citation (e.g., "E.F.W. v. St. Stephen's Indian High School, 264 F.3d 1297")
    const match = citationsWithUrls.find((c) => {
      if (!c.citationText || !c.url) return false;
      const citationLower = c.citationText.toLowerCase();

      // Check if the query appears in the citation text
      // or if the citation text contains key parts of the query
      const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 2);
      const matchingWords = queryWords.filter((word) =>
        citationLower.includes(word),
      );

      // Consider it a match if most query words appear in the citation
      return matchingWords.length >= Math.ceil(queryWords.length * 0.6);
    });

    if (match && match.url) {
      replacementCount++;
      console.log(
        `[normalizeCourtListenerUrls] Replaced search URL for "${query}" with opinion URL: ${match.url}`,
      );
      return `(${match.url})`;
    }

    // No match found, keep original
    console.log(
      `[normalizeCourtListenerUrls] No matching citation found for search query: "${query}"`,
    );
    return fullMatch;
  });

  if (replacementCount > 0) {
    console.log(
      `[normalizeCourtListenerUrls] Replaced ${replacementCount} search URLs with opinion URLs`,
    );
  }

  return result;
}

/**
 * Inject CourtListener URLs into text that mentions case names
 * This handles the case where the AI generates plain text case references
 * without any CourtListener URLs, by adding links from the database
 *
 * Looks for patterns like:
 * - "Verify James v. Wadas citation"
 * - "**Verify James v. Wadas citation**"
 * - "James v. Wadas, 724 F.3d 1312"
 *
 * And adds CourtListener links after them
 */
export function injectCourtListenerUrls(
  text: string,
  citationsWithUrls: Array<{ citationText: string; url: string }>,
): string {
  if (!citationsWithUrls || citationsWithUrls.length === 0) {
    return text;
  }

  let injectionCount = 0;
  let result = text;

  for (const citation of citationsWithUrls) {
    if (!citation.citationText || !citation.url) continue;

    // Extract the case name from the citation text (e.g., "James v. Wadas" from "James v. Wadas, 724 F.3d 1312 (10th Cir. 2013)")
    const caseNameMatch = citation.citationText.match(
      /^([A-Za-z][^,]+(?:v\.|vs\.)[^,]+)/i,
    );
    if (!caseNameMatch) continue;

    const caseName = caseNameMatch[1].trim();
    const caseNameEscaped = caseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // Pattern 1: "Verify [Case Name] citation" (with optional bold markers)
    // This pattern matches the checklist format in the Paralegal Action Checklist
    const verifyPattern = new RegExp(
      `(\\*\\*Verify\\s+${caseNameEscaped}\\s+citation\\*\\*:?)(?!\\s*\\[CourtListener\\])`,
      "gi",
    );

    // Pattern 2: Case name followed by citation info but no link
    // e.g., "James v. Wadas, 724 F.3d 1312 (10th Cir. 2013)" without a following link
    const citationPattern = new RegExp(
      `(${caseNameEscaped},?\\s+\\d+\\s+[A-Za-z.]+\\s*(?:\\d+d?)?\\s+\\d+[^\\n\\[]*?)(?=\\n|$)(?!\\s*\\[)`,
      "gi",
    );

    // Apply Pattern 1: Add link after "Verify X citation"
    const beforePattern1 = result;
    result = result.replace(verifyPattern, (match) => {
      injectionCount++;
      return `${match} [CourtListener](${citation.url})`;
    });

    // Apply Pattern 2: Add link after full citation if no link exists
    // Only if Pattern 1 didn't already add a link for this case
    if (result === beforePattern1) {
      result = result.replace(citationPattern, (match) => {
        // Don't add if there's already a link nearby
        if (match.includes("](") || match.includes("CourtListener")) {
          return match;
        }
        injectionCount++;
        return `${match} [CourtListener](${citation.url})`;
      });
    }
  }

  if (injectionCount > 0) {
    console.log(
      `[injectCourtListenerUrls] Injected ${injectionCount} CourtListener URLs into text`,
    );
  }

  return result;
}

/**
 * CourtListener case data extracted from tool call logs
 */
export interface CourtListenerCaseData {
  caseName: string;
  url: string;
  citations: string[];
  opinionId: string;
}

/**
 * Extract CourtListener case URLs from tool call logs
 *
 * This function extracts case data directly from the tool_output of courtlistener-search
 * tool calls, bypassing the AI's citation emission entirely. This ensures URLs are
 * captured programmatically at tool-call time, not dependent on AI behavior.
 *
 * @param toolLogs - Array of tool call log records from the database
 * @returns Array of case data with caseName, url, citations, and opinionId
 */
export function extractCourtListenerUrlsFromToolLogs(
  toolLogs: Array<{
    toolName: string | null;
    toolOutput: unknown;
  }>,
): CourtListenerCaseData[] {
  const caseMap = new Map<string, CourtListenerCaseData>();

  for (const log of toolLogs) {
    if (log.toolName !== "courtlistener-search") continue;

    const output = log.toolOutput as {
      results?: Array<{
        caseName?: string;
        url?: string;
        citation?: string | string[];
        provenance?: {
          opinionId?: string;
          sourceUrl?: string;
        };
      }>;
    } | null;

    if (!output?.results || !Array.isArray(output.results)) continue;

    for (const result of output.results) {
      if (!result.caseName || !result.url) continue;

      const opinionId = result.provenance?.opinionId || "";
      const key = opinionId || result.url;

      // Normalize citations to array
      let citationArray: string[] = [];
      if (Array.isArray(result.citation)) {
        citationArray = result.citation;
      } else if (typeof result.citation === "string") {
        citationArray = [result.citation];
      }

      // Only add if we haven't seen this case before (by opinionId or URL)
      if (!caseMap.has(key)) {
        caseMap.set(key, {
          caseName: result.caseName,
          url: result.url,
          citations: citationArray,
          opinionId,
        });
      }
    }
  }

  const cases = Array.from(caseMap.values());
  console.log(
    `[extractCourtListenerUrlsFromToolLogs] Extracted ${cases.length} unique cases from tool logs`,
  );

  return cases;
}

/**
 * Hyperlink case mentions in text using CourtListener data from tool logs
 *
 * This function scans text for case name mentions and reporter citations,
 * then adds hyperlinks using URLs extracted from tool call logs.
 * This completely removes AI from URL generation - URLs come directly
 * from the CourtListener API responses stored in tool logs.
 *
 * @param text - The text to process (e.g., report content)
 * @param caseData - Array of case data from extractCourtListenerUrlsFromToolLogs
 * @returns Text with case mentions hyperlinked
 */
/**
 * Check if the given offset falls inside a markdown link's URL portion.
 * This prevents Pattern 2 from creating nested markdown links like:
 * [391 F.3d 1226](https://...com/opinion/212170/[caldwell](https://.../))
 * by detecting that 'caldwell' at position X is inside the ](url) part of an existing link.
 */
function isInsideMarkdownLinkUrl(text: string, offset: number): boolean {
  // Scan for all markdown links [text](url) and check if offset falls inside any of them
  const linkRegex = /\[([^\]]*)\]\(([^)]*(?:\([^)]*\))*[^)]*)\)/g;
  let match;
  while ((match = linkRegex.exec(text)) !== null) {
    const linkStart = match.index; // position of '['
    const linkEnd = match.index + match[0].length; // position after ')'

    // If offset falls anywhere inside this markdown link, skip it
    if (offset >= linkStart && offset < linkEnd) {
      return true;
    }

    // Optimization: if we've passed the offset position, no need to keep searching
    if (match.index > offset) {
      break;
    }
  }
  return false;
}

export function hyperlinkCaseMentionsFromToolLogs(
  text: string,
  caseData: CourtListenerCaseData[],
): string {
  if (!caseData || caseData.length === 0) {
    return text;
  }

  let result = text;
  let linkCount = 0;

  // Build lookup maps for efficient matching
  const citationToCase = new Map<string, CourtListenerCaseData>();
  const normalizedNameToCase = new Map<string, CourtListenerCaseData>();

  for (const caseItem of caseData) {
    // Index by reporter citations (highest confidence match)
    for (const citation of caseItem.citations) {
      if (typeof citation !== "string") continue;
      const normalizedCitation = citation.toLowerCase().trim();
      if (!citationToCase.has(normalizedCitation)) {
        citationToCase.set(normalizedCitation, caseItem);
      }
    }

    // Index by normalized case name
    const normalizedName = normalizeCaseName(caseItem.caseName);
    if (!normalizedNameToCase.has(normalizedName)) {
      normalizedNameToCase.set(normalizedName, caseItem);
    }
  }

  // Pattern 1: Match reporter citations (e.g., "477 U.S. 317", "595 U.S. 170")
  // These are high-confidence matches
  // Extended pattern to include more reporter types (P.3d, Kan., etc.)
  const reporterPattern =
    /(\d+)\s+(U\.S\.|S\.\s*Ct\.|L\.\s*Ed\.\s*2d|F\.\d*d?|F\.\s*Supp\.\s*\d*d?|P\.\d*d?|Kan\.|Cal\.\s*\d*d?|N\.Y\.\s*\d*d?|So\.\s*\d*d?)\s+(\d+)/gi;

  result = result.replace(reporterPattern, (match, _p1, _p2, _p3, offset) => {
    const normalizedMatch = match.toLowerCase().replace(/\s+/g, " ").trim();

    // Check if this citation matches any of our cases
    for (const [citation, caseItem] of citationToCase.entries()) {
      if (
        citation.includes(normalizedMatch) ||
        normalizedMatch.includes(citation.split(",")[0]?.trim() || "")
      ) {
        // Check if already linked by looking at the 10 chars before this specific match
        // Use offset parameter from replace callback instead of indexOf
        const beforeMatch = result.substring(Math.max(0, offset - 10), offset);
        // Only skip if we see a markdown link pattern "](" immediately before
        // Don't skip just because there's a "[" - that could be a citation marker [[n]]
        if (beforeMatch.includes("](")) {
          return match;
        }
        // Skip if this match falls inside an existing markdown link's URL
        if (isInsideMarkdownLinkUrl(result, offset)) {
          return match;
        }
        linkCount++;
        return `[${match}](${caseItem.url})`;
      }
    }
    return match;
  });

  // Pattern 2: Match case names (e.g., "Celotex Corp. v. Catrett", "In re Overstock")
  // Lower confidence, but still useful
  for (const caseItem of caseData) {
    // Extract the core case name (parties only, no citation info)
    // IMPORTANT: Check special formats FIRST (In re, Ex parte, Matter of) before "v." patterns
    let caseName = "";

    // Check "In re" patterns FIRST
    const inReMatch = caseItem.caseName.match(/^(In\s+re:?\s+[^,]+)/i);
    // Check "Ex parte" patterns
    const exParteMatch = caseItem.caseName.match(/^(Ex\s+parte\s+[^,]+)/i);
    // Check "Matter of" patterns
    const matterOfMatch = caseItem.caseName.match(/^(Matter\s+of\s+[^,]+)/i);
    // Standard "v." pattern (checked AFTER special formats)
    const vsMatch = caseItem.caseName.match(
      /^([A-Za-z][^,]+(?:v\.|vs\.)[^,]+)/i,
    );

    if (inReMatch) {
      caseName = inReMatch[1].trim();
    } else if (exParteMatch) {
      caseName = exParteMatch[1].trim();
    } else if (matterOfMatch) {
      caseName = matterOfMatch[1].trim();
    } else if (vsMatch) {
      caseName = vsMatch[1].trim();
    } else {
      // Fall back to using the full case name up to the first comma
      const commaIndex = caseItem.caseName.indexOf(",");
      caseName =
        commaIndex > 0
          ? caseItem.caseName.substring(0, commaIndex).trim()
          : caseItem.caseName.trim();
    }

    if (!caseName || caseName.length < 5) continue;

    const caseNameEscaped = caseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // Match the case name when it appears without an existing link
    // Handle both plain text and italic-wrapped case names (*case name* or _case name_)
    // Use word boundary OR markdown formatting boundary
    const caseNamePattern = new RegExp(
      `(\\*|_)?\\b(${caseNameEscaped})\\b(\\*|_)?`,
      "gi",
    );

    result = result.replace(
      caseNamePattern,
      (match, leadingMark, caseMatch, trailingMark, offset) => {
        // Check if already linked by looking at context around this match
        const beforeMatch = result.substring(Math.max(0, offset - 5), offset);
        const afterMatch = result.substring(
          offset + match.length,
          offset + match.length + 5,
        );
        // Skip if this looks like it's already part of a markdown link
        if (beforeMatch.includes("[") || afterMatch.includes("](")) {
          return match;
        }
        // Skip if this match falls inside an existing markdown link URL
        // This prevents nested markdown like [text](url/[casename](url2))
        if (isInsideMarkdownLinkUrl(result, offset)) {
          return match;
        }

        linkCount++;

        // Preserve italic formatting if present
        if (leadingMark && trailingMark) {
          // Case name is wrapped in italic markers - wrap the link in italic
          return `${leadingMark}[${caseMatch}](${caseItem.url})${trailingMark}`;
        }
        return `[${caseMatch}](${caseItem.url})`;
      },
    );
  }

  if (linkCount > 0) {
    console.log(
      `[hyperlinkCaseMentionsFromToolLogs] Added ${linkCount} hyperlinks to case mentions`,
    );
  }

  return result;
}

/**
 * Citation marker injection result
 */
export interface CitationMarkerInjectionResult {
  transformedText: string;
  citationMap: Map<
    number,
    { caseName: string; url: string; citations: string[] }
  >;
  markerCount: number;
}

/**
 * Inject citation markers [[n]] into text based on case name matching from tool logs
 *
 * This function scans text for case name mentions and reporter citations,
 * then injects [[n]] markers after each match. The markers can later be
 * converted to superscript hyperlinks in Word documents.
 *
 * This is specifically designed for reporting steps (Executive Summary,
 * Paralegal Checklist) that don't have verification enabled and thus
 * don't output <CitationsJSON> blocks.
 *
 * @param text - The text to process (e.g., Executive Summary content)
 * @param caseData - Array of case data from extractCourtListenerUrlsFromToolLogs
 * @returns Object with transformedText, citationMap, and markerCount
 */
export function injectCitationMarkersFromToolLogs(
  text: string,
  caseData: CourtListenerCaseData[],
): CitationMarkerInjectionResult {
  if (!caseData || caseData.length === 0) {
    return {
      transformedText: text,
      citationMap: new Map(),
      markerCount: 0,
    };
  }

  let result = text;
  let markerCount = 0;
  let nextCitationNumber = 1;

  // Map to track which citation number was assigned to each case
  const caseToNumber = new Map<string, number>();
  const citationMap = new Map<
    number,
    { caseName: string; url: string; citations: string[] }
  >();

  // Build lookup maps for efficient matching
  const citationToCase = new Map<string, CourtListenerCaseData>();
  const normalizedNameToCase = new Map<string, CourtListenerCaseData>();

  for (const caseItem of caseData) {
    // Index by reporter citations (highest confidence match)
    for (const citation of caseItem.citations) {
      if (typeof citation !== "string") continue;
      const normalizedCitation = citation.toLowerCase().trim();
      if (!citationToCase.has(normalizedCitation)) {
        citationToCase.set(normalizedCitation, caseItem);
      }
    }

    // Index by normalized case name
    const normalizedName = normalizeCaseName(caseItem.caseName);
    if (!normalizedNameToCase.has(normalizedName)) {
      normalizedNameToCase.set(normalizedName, caseItem);
    }
  }

  // Helper function to get or assign citation number for a case
  const getCitationNumber = (caseItem: CourtListenerCaseData): number => {
    const key = caseItem.opinionId || caseItem.url;
    if (caseToNumber.has(key)) {
      return caseToNumber.get(key)!;
    }
    const num = nextCitationNumber++;
    caseToNumber.set(key, num);
    citationMap.set(num, {
      caseName: caseItem.caseName,
      url: caseItem.url,
      citations: caseItem.citations,
    });
    return num;
  };

  // Pattern 1: Match reporter citations (e.g., "477 U.S. 317", "595 U.S. 170")
  // Extended pattern to include more reporter types
  const reporterPattern =
    /(\d+)\s+(U\.S\.|S\.\s*Ct\.|L\.\s*Ed\.\s*2d|F\.\d*d?|F\.\s*Supp\.\s*\d*d?|P\.\d*d?|Kan\.|Cal\.\s*\d*d?|N\.Y\.\s*\d*d?|So\.\s*\d*d?)\s+(\d+)/gi;

  result = result.replace(reporterPattern, (match, _p1, _p2, _p3, offset) => {
    const normalizedMatch = match.toLowerCase().replace(/\s+/g, " ").trim();

    // Check if this citation matches any of our cases
    for (const [citation, caseItem] of citationToCase.entries()) {
      if (
        citation.includes(normalizedMatch) ||
        normalizedMatch.includes(citation.split(",")[0]?.trim() || "")
      ) {
        // Check if already has a marker by looking at context after this match
        const afterMatch = result.substring(
          offset + match.length,
          offset + match.length + 10,
        );
        // Skip if there's already a citation marker [[n]] immediately after
        if (afterMatch.match(/^\s*\[\[\d+\]\]/)) {
          return match;
        }

        const citationNum = getCitationNumber(caseItem);
        markerCount++;
        return `${match}[[${citationNum}]]`;
      }
    }
    return match;
  });

  // Pattern 2: Match case names (e.g., "Celotex Corp. v. Catrett", "In re Overstock")
  for (const caseItem of caseData) {
    // Extract the core case name (parties only, no citation info)
    let caseName = "";

    // Check special formats FIRST (In re, Ex parte, Matter of) before "v." patterns
    const inReMatch = caseItem.caseName.match(/^(In\s+re:?\s+[^,]+)/i);
    const exParteMatch = caseItem.caseName.match(/^(Ex\s+parte\s+[^,]+)/i);
    const matterOfMatch = caseItem.caseName.match(/^(Matter\s+of\s+[^,]+)/i);
    const vsMatch = caseItem.caseName.match(
      /^([A-Za-z][^,]+(?:v\.|vs\.)[^,]+)/i,
    );

    if (inReMatch) {
      caseName = inReMatch[1].trim();
    } else if (exParteMatch) {
      caseName = exParteMatch[1].trim();
    } else if (matterOfMatch) {
      caseName = matterOfMatch[1].trim();
    } else if (vsMatch) {
      caseName = vsMatch[1].trim();
    } else {
      // Fall back to using the full case name up to the first comma
      const commaIndex = caseItem.caseName.indexOf(",");
      caseName =
        commaIndex > 0
          ? caseItem.caseName.substring(0, commaIndex).trim()
          : caseItem.caseName.trim();
    }

    if (!caseName || caseName.length < 5) continue;

    const caseNameEscaped = caseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // Match the case name when it appears without an existing marker
    // Handle both plain text and italic-wrapped case names
    const caseNamePattern = new RegExp(
      `(\\*|_)?\\b(${caseNameEscaped})\\b(\\*|_)?(?!\\s*\\[\\[\\d+\\]\\])`,
      "gi",
    );

    result = result.replace(
      caseNamePattern,
      (match, leadingMark, caseMatch, trailingMark, offset) => {
        // Check if already has a marker by looking at context after this match
        const afterMatch = result.substring(
          offset + match.length,
          offset + match.length + 10,
        );
        // Skip if there's already a citation marker [[n]] immediately after
        if (afterMatch.match(/^\s*\[\[\d+\]\]/)) {
          return match;
        }

        // Check if this is inside a markdown link (skip if so)
        const beforeMatch = result.substring(Math.max(0, offset - 5), offset);
        if (beforeMatch.includes("[") || beforeMatch.includes("](")) {
          return match;
        }

        const citationNum = getCitationNumber(caseItem);
        markerCount++;

        // Preserve italic formatting if present
        if (leadingMark && trailingMark) {
          return `${leadingMark}${caseMatch}${trailingMark}[[${citationNum}]]`;
        }
        return `${caseMatch}[[${citationNum}]]`;
      },
    );
  }

  if (markerCount > 0) {
    console.log(
      `[injectCitationMarkersFromToolLogs] Injected ${markerCount} citation markers for ${citationMap.size} unique cases`,
    );
  }

  return {
    transformedText: result,
    citationMap,
    markerCount,
  };
}
