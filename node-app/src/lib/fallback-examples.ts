export interface ExampleMatch {
  token: string;
  index: number;
}

const EXAMPLE_PATTERNS = [
  /\[example\]/gi,
  /example output/gi,
  /lorem ipsum/gi,
  /dummy text/gi,
  /sample response/gi,
];

export class StreamingExampleDetector {
  public buffer = "";

  addChunk(chunk: string): ExampleMatch | null {
    this.buffer += chunk;
    const matches = detectAllPieces(this.buffer);
    return matches.length > 0 ? matches[0] : null;
  }
}

export function detectAllPieces(input: string): ExampleMatch[] {
  const matches: ExampleMatch[] = [];
  for (const pattern of EXAMPLE_PATTERNS) {
    pattern.lastIndex = 0;
    let result = pattern.exec(input);
    while (result) {
      matches.push({
        token: result[0],
        index: result.index,
      });
      result = pattern.exec(input);
    }
  }

  return matches.sort((a, b) => a.index - b.index);
}

export function detectExampleFallback(input: string): ExampleMatch | null {
  const matches = detectAllPieces(input);
  return matches.length > 0 ? matches[0] : null;
}

export function generateFallbackErrorMessage(
  firstMatch: ExampleMatch,
  allMatches: ExampleMatch[],
): string {
  return `Model returned placeholder/example content (${allMatches.length} match(es), first token: ${firstMatch.token}).`;
}
