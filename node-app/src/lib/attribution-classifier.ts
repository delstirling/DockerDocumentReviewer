export interface AttributionContext {
  ourClients?: string[];
  opposingParties?: string[];
  lawFirmName?: string;
}

export class AttributionClassifier {
  classifyAttribution(
    citationOrQuote: string,
    context?: AttributionContext,
  ): "our_firm" | "opposing" | "neutral" {
    const text = (citationOrQuote || "").toLowerCase();

    if (
      context?.ourClients?.some((name) =>
        text.includes((name || "").toLowerCase()),
      )
    ) {
      return "our_firm";
    }

    if (
      context?.opposingParties?.some((name) =>
        text.includes((name || "").toLowerCase()),
      )
    ) {
      return "opposing";
    }

    return "neutral";
  }
}
