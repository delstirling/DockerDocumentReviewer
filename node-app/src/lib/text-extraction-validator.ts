export interface ValidationResult {
  isValid: boolean;
  issue?: string;
  confidence?: number;
  details?: string;
}

const AI_GIBBERISH_PATTERN = /\b(lorem ipsum|asdfasdf|dummy text)\b/i;

export async function validateExtractedText(
  text: string,
  _fileName: string,
  _validationClient?: unknown,
  _validationModel?: string,
): Promise<ValidationResult> {
  const normalized = (text || "").trim();

  if (normalized.length < 50) {
    return {
      isValid: false,
      issue: "insufficient_text",
      confidence: 0.95,
      details: "Extracted text is too short for reliable analysis.",
    };
  }

  if (AI_GIBBERISH_PATTERN.test(normalized)) {
    return {
      isValid: false,
      issue: "ai_detected_gibberish",
      confidence: 0.9,
      details: "Detected placeholder or gibberish content in extraction.",
    };
  }

  return { isValid: true, confidence: 0.99 };
}

export function generateValidationErrorMessage(
  fileName: string,
  result: ValidationResult,
): string {
  if (result.issue === "ai_detected_gibberish") {
    return `Text extraction for ${fileName} appears to contain AI fallback placeholders and cannot be analyzed reliably.`;
  }

  if (result.issue === "insufficient_text") {
    return `Text extraction for ${fileName} produced insufficient content for analysis.`;
  }

  return `Text extraction validation failed for ${fileName}.`;
}
