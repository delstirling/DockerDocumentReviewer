import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TableOfContents,
  TextRun,
} from "docx";
import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { analysisSteps } from "@/db/schema";

interface GenerateProfessionalReportOptions {
  sessionId: number;
  includeTableOfContents?: boolean;
  includeTitlePage?: boolean;
}

interface AnalysisStepRecord {
  stepIndex: number;
  stepName: string | null;
  stepId: string | null;
  analysisText: string | null;
}

const normalizeStepText = (text: string | null | undefined): string => {
  return (text ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

const findStep = (
  steps: AnalysisStepRecord[],
  matcher: (step: AnalysisStepRecord) => boolean,
  fallbackIndex: number,
): AnalysisStepRecord | undefined => {
  return steps.find(matcher) ?? steps.find((step) => step.stepIndex === fallbackIndex);
};

const buildSectionParagraphs = (title: string, content: string): Paragraph[] => {
  const paragraphs = [
    new Paragraph({
      text: title,
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 240, after: 120 },
    }),
  ];

  const bodyParagraphs = content
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map(
      (block) =>
        new Paragraph({
          children: [new TextRun(block)],
          spacing: { after: 160 },
        }),
    );

  return paragraphs.concat(bodyParagraphs);
};

export const generateProfessionalReport = async ({
  sessionId,
  includeTableOfContents = true,
  includeTitlePage = true,
}: GenerateProfessionalReportOptions): Promise<Buffer> => {
  const steps = await db
    .select({
      stepIndex: analysisSteps.stepIndex,
      stepName: analysisSteps.stepName,
      stepId: analysisSteps.stepId,
      analysisText: analysisSteps.analysisText,
    })
    .from(analysisSteps)
    .where(eq(analysisSteps.analysisSessionId, sessionId))
    .orderBy(analysisSteps.stepIndex);

  const executiveSummaryStep = findStep(
    steps,
    (step) =>
      step.stepName?.toLowerCase().includes("executive summary") ||
      step.stepName?.toLowerCase().includes("comprehensive summary") ||
      step.stepId?.includes("executive-summary") ||
      false,
    33,
  );

  const checklistStep = findStep(
    steps,
    (step) =>
      step.stepName?.toLowerCase().includes("paralegal") ||
      step.stepName?.toLowerCase().includes("action checklist") ||
      step.stepName?.toLowerCase().includes("revision checklist") ||
      step.stepId?.includes("paralegal-checklist") ||
      step.stepId?.includes("action-checklist") ||
      step.stepId?.includes("revision-checklist") ||
      false,
    34,
  );

  const executiveSummary = normalizeStepText(executiveSummaryStep?.analysisText);
  const checklist = normalizeStepText(checklistStep?.analysisText);

  if (!executiveSummary || !checklist) {
    throw new Error("Required report sections are unavailable for export");
  }

  const children: Paragraph[] = [];

  if (includeTitlePage) {
    children.push(
      new Paragraph({
        text: "Professional Report",
        heading: HeadingLevel.TITLE,
        spacing: { after: 200 },
      }),
      new Paragraph({
        text: `Analysis Session ${sessionId}`,
        spacing: { after: 120 },
      }),
      new Paragraph({
        text: `Generated ${new Date().toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        })}`,
        spacing: { after: 400 },
      }),
    );
  }

  if (includeTableOfContents) {
    children.push(
      new Paragraph({
        text: "Table of Contents",
        heading: HeadingLevel.HEADING_1,
      }),
      new Paragraph({
        children: [
          new TableOfContents("Contents", {
            hyperlink: true,
            headingStyleRange: "1-3",
          }),
        ],
      }),
    );
  }

  children.push(
    ...buildSectionParagraphs("Executive Summary", executiveSummary),
    ...buildSectionParagraphs("Action Checklist", checklist),
  );

  const doc = new Document({
    sections: [
      {
        properties: {},
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
};