import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db/client";
import { analysisSessions, analysisSteps } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TableOfContents,
  TextRun,
} from "docx";

export const maxDuration = 60;
export const runtime = "nodejs";

/**
 * Inline sanitization of AI contamination from step analysis text.
 * This is defense-in-depth that runs the patterns directly in this file
 * (not behind an import) to ensure they survive build caching.
 */
function sanitizeStepText(text: string): string {
  if (!text) return text;
  return text
    .replace(/^\s*(?:---\s*)?PHASE\s+\d+\s*:.*$/gim, "")
    .replace(/^\s*STEP\s+\d+\s*:.*$/gm, "")
    .replace(/^\s*---\s*$/gm, "")
    .replace(
      /^(?:I'll|I will|Let me|Now (?:let me|I'll|I will|I (?:will|need to|can|have)))\s+[^\n]{0,300}\n?/gim,
      "",
    )
    .replace(
      /\.\s+(?:Let me|I'll|I will|Now I'll|Now I will|Now let me)\s+[^.\n]{0,300}\./gi,
      ".",
    )
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildParagraphs(text: string): Paragraph[] {
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map(
      (block) =>
        new Paragraph({
          children: [new TextRun(block)],
          spacing: { after: 180 },
        }),
    );
}

function buildFilename(timestamp: string, title: string | null): string {
  const date = timestamp.split("T")[0] ?? new Date().toISOString().split("T")[0];
  const safeTitle = (title ?? "Legal Document Analysis Report")
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);

  return `${safeTitle || "Legal_Document_Analysis_Report"}_${date}.docx`;
}

async function generateWordReportBuffer(options: {
  title: string;
  timestamp: string;
  steps: Array<{
    stepIndex: number;
    stepName: string | null;
    analysisText: string | null;
  }>;
}): Promise<Buffer> {
  const children: Paragraph[] = [
    new Paragraph({
      text: options.title,
      heading: HeadingLevel.TITLE,
      spacing: { after: 200 },
    }),
    new Paragraph({
      text: `Generated ${new Date(options.timestamp).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })}`,
      spacing: { after: 300 },
    }),
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
      spacing: { after: 260 },
    }),
  ];

  for (const step of options.steps) {
    const heading = `Step ${step.stepIndex + 1}: ${step.stepName ?? "Untitled Step"}`;
    const cleanedText = sanitizeStepText(step.analysisText ?? "");

    if (!cleanedText) {
      continue;
    }

    children.push(
      new Paragraph({
        text: heading,
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 240, after: 120 },
      }),
      ...buildParagraphs(cleanedText),
    );
  }

  const document = new Document({
    sections: [
      {
        properties: {},
        children,
      },
    ],
  });

  return Packer.toBuffer(document);
}

export async function POST(
  req: NextRequest,
  segmentData: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const authenticatedUserId = Number(session.user.id);
    const params = await segmentData.params;
    const sessionId = Number(params.id);

    const [analysisSession] = await db
      .select()
      .from(analysisSessions)
      .where(eq(analysisSessions.id, Number(sessionId)))
      .limit(1);

    if (!analysisSession) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    if (analysisSession.userId !== authenticatedUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const steps = await db
      .select({
        stepIndex: analysisSteps.stepIndex,
        stepName: analysisSteps.stepName,
        analysisText: analysisSteps.analysisText,
      })
      .from(analysisSteps)
      .where(eq(analysisSteps.analysisSessionId, sessionId))
      .orderBy(analysisSteps.stepIndex);

    const populatedSteps = steps.filter((step) =>
      sanitizeStepText(step.analysisText ?? "").length > 0,
    );

    if (populatedSteps.length === 0) {
      return NextResponse.json(
        {
          error: "No analysis content available for export",
          details:
            "This session does not yet contain any completed analysis steps.",
        },
        { status: 409 },
      );
    }

    const timestamp =
      analysisSession.completedAt?.toISOString() ?? new Date().toISOString();
    const title = analysisSession.title ?? "Legal Document Analysis Report";
    const buffer = await generateWordReportBuffer({
      title,
      timestamp,
      steps: populatedSteps,
    });
    const filename = buildFilename(timestamp, analysisSession.title);

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    console.error("[Export Word] Error:", error);
    const message =
      error instanceof Error ? error.message : "Failed to generate Word document";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
