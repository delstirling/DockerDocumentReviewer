export interface ClaudeExtractResult {
  success: boolean;
  text: string;
  error?: string;
}

export async function extractTextWithClaude(
  _buffer: Buffer,
  _fileName: string,
  _mimeType: string,
): Promise<ClaudeExtractResult> {
  return {
    success: false,
    text: "",
    error: "Claude extraction is unavailable in this build configuration.",
  };
}
