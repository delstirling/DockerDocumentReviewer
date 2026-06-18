type ReportFormat = "json" | "markdown" | "txt" | "docx";

interface ReportSection {
  stepId: string;
  stepName: string;
  content: string;
  toolCalls: number;
}

interface ReportCitation {
  number: number;
  citation: string;
  quote: string;
  url: string;
  color: string;
}

interface ReportContextualAnalysis {
  authority_citation: string;
  preceding_context: {
    summary: string;
    quotes: string[];
  };
  statement_function: string;
  subsequent_development: {
    summary: string;
    quotes: string[];
  };
  qualifications_limitations: {
    summary: string;
    quotes: string[];
  };
  alignment_verification: string;
}

interface ReportData {
  documentType?: string;
  jurisdiction?: string;
  overallStatus?: "compliant" | "needs-review";
  executiveSummary?: string;
  fullAnalysis?: string;
  timestamp?: string;
  steps?: ReportSection[];
  citationIndex?: {
    nextNumber: number;
    lastColor?: string | null;
    citations: ReportCitation[];
  };
  contextualAnalyses?: ReportContextualAnalysis[];
}

const formatLabel = (value: string): string =>
  value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());

const toPrettyJson = (data: ReportData): string => JSON.stringify(data, null, 2);

const buildMarkdown = (data: ReportData): string => {
  const lines: string[] = ["# Legal Analysis Report", ""];

  if (data.timestamp) {
    lines.push(`Generated: ${new Date(data.timestamp).toLocaleString()}`, "");
  }

  if (data.documentType || data.jurisdiction || data.overallStatus) {
    lines.push("## Summary", "");

    if (data.documentType) {
      lines.push(`- Document Type: ${formatLabel(data.documentType)}`);
    }

    if (data.jurisdiction) {
      lines.push(`- Jurisdiction: ${data.jurisdiction}`);
    }

    if (data.overallStatus) {
      lines.push(`- Status: ${formatLabel(data.overallStatus)}`);
    }

    lines.push("");
  }

  if (data.executiveSummary) {
    lines.push("## Executive Summary", "", data.executiveSummary, "");
  }

  if (data.steps && data.steps.length > 0) {
    lines.push("## Steps", "");
    for (const step of data.steps) {
      lines.push(`### ${step.stepName}`, "", step.content, "");
    }
  } else if (data.fullAnalysis) {
    lines.push("## Full Analysis", "", data.fullAnalysis, "");
  }

  if (data.citationIndex?.citations?.length) {
    lines.push("## Citations", "");
    for (const citation of data.citationIndex.citations) {
      lines.push(
        `${citation.number}. ${citation.citation}`,
        citation.quote ? `   Quote: ${citation.quote}` : "",
        citation.url ? `   URL: ${citation.url}` : "",
      );
    }
    lines.push("");
  }

  if (data.contextualAnalyses?.length) {
    lines.push("## Contextual Analyses", "");
    for (const analysis of data.contextualAnalyses) {
      lines.push(`### ${analysis.authority_citation}`, "");
      lines.push(`- Preceding Context: ${analysis.preceding_context.summary}`);
      lines.push(`- Statement Function: ${analysis.statement_function}`);
      lines.push(
        `- Subsequent Development: ${analysis.subsequent_development.summary}`,
      );
      lines.push(
        `- Qualifications / Limitations: ${analysis.qualifications_limitations.summary}`,
      );
      lines.push(`- Alignment Verification: ${analysis.alignment_verification}`, "");
    }
  }

  return lines.filter((line, index, array) => {
    return !(line === "" && array[index - 1] === "" && array[index + 1] === "");
  }).join("\n");
};

export function formatReport(data: ReportData, format: Exclude<ReportFormat, "docx">): string {
  if (format === "json") {
    return toPrettyJson(data);
  }

  const markdown = buildMarkdown(data);
  if (format === "markdown") {
    return markdown;
  }

  return markdown
    .replace(/^###\s+/gm, "")
    .replace(/^##\s+/gm, "")
    .replace(/^#\s+/gm, "")
    .replace(/^-\s+/gm, "- ");
}

export function getFileExtension(format: ReportFormat): string {
  switch (format) {
    case "json":
      return "json";
    case "markdown":
      return "md";
    case "txt":
      return "txt";
    case "docx":
      return "docx";
  }
}

export function getMimeType(format: ReportFormat): string {
  switch (format) {
    case "json":
      return "application/json";
    case "markdown":
      return "text/markdown";
    case "txt":
      return "text/plain";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
}