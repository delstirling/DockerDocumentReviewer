import { CourtListenerClient } from "@/lib/court-listener";

export interface CitationExtractionResult {
  citations: string[];
  caseLawCount: number;
  statutoryCount: number;
}

const CASE_CITATION_PATTERN = /\b\d+\s+[A-Za-z.]+\s+\d+\b/g;
const STATUTE_PATTERN = /\b(?:\d+\s+U\.S\.C\.|K\.S\.A\.|Fed\.\s*R\.\s*Civ\.\s*P\.)[^\n.;]*/gi;

export async function extractAllCitations(
  text: string,
  _courtListenerClient?: CourtListenerClient,
): Promise<CitationExtractionResult> {
  const caseLaw = text.match(CASE_CITATION_PATTERN) ?? [];
  const statutes = text.match(STATUTE_PATTERN) ?? [];
  const citations = [...new Set([...caseLaw, ...statutes])];

  return {
    citations,
    caseLawCount: caseLaw.length,
    statutoryCount: statutes.length,
  };
}

export function formatCitationListForPrompt(
  result: CitationExtractionResult | null,
): string {
  if (!result || result.citations.length === 0) {
    return "No citations detected in subject document.";
  }

  return [
    `Detected citations (${result.citations.length}):`,
    ...result.citations.slice(0, 100).map((c) => `- ${c}`),
  ].join("\n");
}
