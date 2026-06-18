export async function computeThreeScoreVerification(
  originalQuote: string,
  extractedQuote: string,
): Promise<{
  alphanumericPercent: number;
  punctuationSpacePercent: number;
  aiVerification: string;
}> {
  const cleanA = (originalQuote || "").replace(/\W+/g, "").toLowerCase();
  const cleanB = (extractedQuote || "").replace(/\W+/g, "").toLowerCase();

  const alphanumericPercent =
    cleanA.length > 0 && cleanA === cleanB ? 100 : cleanB.includes(cleanA) ? 90 : 60;

  return {
    alphanumericPercent,
    punctuationSpacePercent: alphanumericPercent,
    aiVerification:
      alphanumericPercent >= 90 ? "match" : "partial_match",
  };
}
