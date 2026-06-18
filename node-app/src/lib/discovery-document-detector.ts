const OUTGOING_DISCOVERY_PATTERNS = [
  /request for production/i,
  /requests for production/i,
  /request for admission/i,
  /requests for admission/i,
  /interrogator(y|ies)/i,
  /subpoena/i,
  /deposition notice/i,
];

export function isOutgoingDiscoveryDocument(documentType: string): boolean {
  if (!documentType) {
    return false;
  }
  return OUTGOING_DISCOVERY_PATTERNS.some((pattern) =>
    pattern.test(documentType),
  );
}

export function identifyDiscoveryType(documentType: string): string {
  const normalized = (documentType || "").toLowerCase();

  if (normalized.includes("admission")) {
    return "requests-for-admission";
  }
  if (normalized.includes("interrogator")) {
    return "interrogatories";
  }
  if (normalized.includes("production")) {
    return "requests-for-production";
  }
  if (normalized.includes("subpoena")) {
    return "subpoena";
  }
  if (normalized.includes("deposition")) {
    return "deposition";
  }

  return "general-discovery";
}
