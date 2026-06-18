export type DocumentOrigin = "our_firm" | "opposing" | "unknown";

export interface DocumentOriginDetectionInput {
  lawFirmName: string;
  ourClients: string[];
  opposingParties: string[];
  documentType?: string;
  documentAuthor?: string;
  lawFirmNameOverride?: string;
}

function normalizeText(value: string | undefined): string {
  return (value || "").trim().toLowerCase();
}

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => {
    const normalized = normalizeText(needle);
    return normalized.length > 0 && haystack.includes(normalized);
  });
}

export function detectDocumentOrigin(
  input: DocumentOriginDetectionInput,
): DocumentOrigin {
  const author = normalizeText(input.documentAuthor);
  const lawFirm = normalizeText(input.lawFirmNameOverride || input.lawFirmName);
  const docType = normalizeText(input.documentType);

  if (author && lawFirm && author.includes(lawFirm)) {
    return "our_firm";
  }

  if (author && includesAny(author, input.opposingParties)) {
    return "opposing";
  }

  if (author && includesAny(author, input.ourClients)) {
    return "our_firm";
  }

  if (/opposition|opposing|adverse/i.test(docType)) {
    return "opposing";
  }

  if (/our firm|outgoing|propounded|draft/i.test(docType)) {
    return "our_firm";
  }

  return "unknown";
}
