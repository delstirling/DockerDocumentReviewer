export function sanitizeExtractedText(input: string): string {
  if (!input) {
    return "";
  }

  return input
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function stripToolCallXml(input: string): string {
  if (!input) {
    return "";
  }

  return input
    .replace(/<tool_call[\s\S]*?<\/tool_call>/gi, "")
    .replace(/<tool_result[\s\S]*?<\/tool_result>/gi, "")
    .replace(/<tools>[\s\S]*?<\/tools>/gi, "")
    .trim();
}
