import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db/client";
import { analysisSessions, analysisSteps } from "@/db/schema";
import { eq } from "drizzle-orm";
import { generateProfessionalReport } from "@/lib/professional-report-generator";

export const runtime = "nodejs";

/**
 * POST /api/sessions/[id]/export-professional-report
 * Generate and download Document 2 (Professional Report)
 *
 * This endpoint generates a professional legal analysis report containing:
 * - Title page with law firm name and date
 * - Table of contents
 * - Executive Summary (Step 34) with inline citations
 * - Paralegal Action Checklist (Step 35) with inline citations
 * - Table of Authorities grouped by type
 *
 * All citations are rendered as clickable blue superscript hyperlinks.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const sessionId = Number(id);

  try {
    const session = await auth();
    if (!session?.user) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const authenticatedUserId = Number(session.user.id);

    const [analysisSession] = await db
      .select()
      .from(analysisSessions)
      .where(eq(analysisSessions.id, Number(sessionId)))
      .limit(1);

    if (!analysisSession) {
      return new NextResponse("Analysis session not found", { status: 404 });
    }

    if (analysisSession.userId !== authenticatedUserId) {
      return new NextResponse("Forbidden", { status: 403 });
    }

    console.log(
      `[Professional Report] Generating report for session ${sessionId}`,
    );

    const requiredSteps = await db
      .select({
        stepIndex: analysisSteps.stepIndex,
        stepName: analysisSteps.stepName,
        stepId: analysisSteps.stepId,
        analysisText: analysisSteps.analysisText,
      })
      .from(analysisSteps)
      .where(eq(analysisSteps.analysisSessionId, sessionId));

    // Use name-based lookup as primary method (works with any workflow step count)
    // Fall back to legacy indices (33, 34) only if name-based lookup fails
    const executiveSummaryStep =
      requiredSteps.find(
        (s) =>
          s.stepName?.toLowerCase().includes("executive summary") ||
          s.stepName?.toLowerCase().includes("comprehensive summary") ||
          s.stepId?.includes("executive-summary"),
      ) || requiredSteps.find((s) => s.stepIndex === 33);

    // Find Checklist step by name pattern (works with any workflow type)
    // Different workflows have different names:
    // - QA: "Paralegal Action Checklist" (step-35-paralegal-checklist)
    // - Offense: "Response Brief Action Checklist" (offense-step-39-action-checklist)
    // - Discovery Drafting: "Revision Checklist" (discovery-step-21-revision-checklist)
    const paralegalChecklistStep =
      requiredSteps.find(
        (s) =>
          s.stepName?.toLowerCase().includes("paralegal") ||
          s.stepName?.toLowerCase().includes("action checklist") ||
          s.stepName?.toLowerCase().includes("revision checklist") ||
          s.stepId?.includes("paralegal-checklist") ||
          s.stepId?.includes("action-checklist") ||
          s.stepId?.includes("revision-checklist"),
      ) || requiredSteps.find((s) => s.stepIndex === 34);

    const issues: string[] = [];
    if (!executiveSummaryStep) {
      issues.push("Executive Summary step not found");
    } else if (!executiveSummaryStep.analysisText?.length) {
      issues.push("Executive Summary step has no content");
    }

    if (!paralegalChecklistStep) {
      issues.push(
        "Checklist step not found (expected Paralegal Action Checklist, Response Brief Action Checklist, or Revision Checklist)",
      );
    } else if (!paralegalChecklistStep.analysisText?.length) {
      issues.push("Paralegal Action Checklist step has no content");
    }

    if (issues.length > 0) {
      console.error(
        `[Professional Report] Cannot generate report for session ${sessionId}. Status: ${analysisSession.status}, Current step: ${analysisSession.currentStep}/${analysisSession.totalSteps}, Total steps in DB: ${requiredSteps.length}, Issues: ${issues.join(", ")}`,
      );
      return NextResponse.json(
        {
          error: "Analysis incomplete - cannot generate Document 2",
          details: issues.join(". "),
          sessionId,
          currentStep: analysisSession.currentStep,
          totalSteps: analysisSession.totalSteps,
          stepsInDatabase: requiredSteps.length,
        },
        { status: 409 },
      );
    }

    console.log(
      `[Professional Report] Found analysis steps for session ${sessionId}`,
    );
    const startTime = Date.now();

    const buffer = await generateProfessionalReport({
      sessionId,
      includeTableOfContents: true,
      includeTitlePage: true,
    });

    const duration = Date.now() - startTime;
    console.log(
      `[Professional Report] Generated successfully in ${duration}ms (${(buffer.length / 1024).toFixed(2)} KB)`,
    );

    const timestamp = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    const filename = `Professional_Report_${String(sessionId)}_${timestamp}.docx`;

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": buffer.length.toString(),
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    });
  } catch (error) {
    console.error("[Professional Report] Error generating report:", error);

    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    const isValidationError =
      errorMessage.includes("Step 34") ||
      errorMessage.includes("Step 35") ||
      errorMessage.includes("not found");

    return new NextResponse(
      JSON.stringify({
        error: "Failed to generate report",
        details: errorMessage,
        sessionId,
      }),
      {
        status: isValidationError ? 400 : 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}

/**
 * GET /api/sessions/[id]/export-professional-report
 * Check if report can be generated (for UI state)
 *
 * Returns availability status and reason if unavailable.
 * Used by UI to enable/disable the export button.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const sessionId = Number(id);

  try {
    const session = await auth();
    if (!session?.user) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const authenticatedUserId = Number(session.user.id);

    const [analysisSession] = await db
      .select()
      .from(analysisSessions)
      .where(eq(analysisSessions.id, Number(sessionId)))
      .limit(1);

    if (!analysisSession) {
      return NextResponse.json(
        {
          available: false,
          reason: "Session not found",
        },
        { status: 404 },
      );
    }

    if (analysisSession.userId !== authenticatedUserId) {
      return NextResponse.json(
        {
          available: false,
          reason: "Access denied",
        },
        { status: 403 },
      );
    }

    const statusComplete = analysisSession.status === "complete";

    const allSteps = await db
      .select({
        stepIndex: analysisSteps.stepIndex,
        stepName: analysisSteps.stepName,
        stepId: analysisSteps.stepId,
        analysisText: analysisSteps.analysisText,
      })
      .from(analysisSteps)
      .where(eq(analysisSteps.analysisSessionId, sessionId));

    // Use name-based lookup as primary method (works with any workflow step count)
    // Fall back to legacy indices (33, 34) only if name-based lookup fails
    const executiveSummaryStep =
      allSteps.find(
        (s) =>
          s.stepName?.toLowerCase().includes("executive summary") ||
          s.stepName?.toLowerCase().includes("comprehensive summary") ||
          s.stepId?.includes("executive-summary"),
      ) || allSteps.find((s) => s.stepIndex === 33);

    // Find Checklist step by name pattern (works with any workflow type)
    // Different workflows have different names:
    // - QA: "Paralegal Action Checklist" (step-35-paralegal-checklist)
    // - Offense: "Response Brief Action Checklist" (offense-step-39-action-checklist)
    // - Discovery Drafting: "Revision Checklist" (discovery-step-21-revision-checklist)
    const paralegalChecklistStep =
      allSteps.find(
        (s) =>
          s.stepName?.toLowerCase().includes("paralegal") ||
          s.stepName?.toLowerCase().includes("action checklist") ||
          s.stepName?.toLowerCase().includes("revision checklist") ||
          s.stepId?.includes("paralegal-checklist") ||
          s.stepId?.includes("action-checklist") ||
          s.stepId?.includes("revision-checklist"),
      ) || allSteps.find((s) => s.stepIndex === 34);

    const hasExecutiveSummary = !!executiveSummaryStep?.analysisText?.length;
    const hasParalegalChecklist =
      !!paralegalChecklistStep?.analysisText?.length;

    const available =
      statusComplete && hasExecutiveSummary && hasParalegalChecklist;

    let reason = null;
    if (!statusComplete) {
      reason = `Analysis in progress (step ${analysisSession.currentStep}/${analysisSession.totalSteps})`;
    } else if (!hasExecutiveSummary || !hasParalegalChecklist) {
      const missing = [];
      if (!hasExecutiveSummary) missing.push("Executive Summary");
      if (!hasParalegalChecklist) missing.push("Paralegal Checklist");
      reason = `Missing required steps: ${missing.join(", ")}`;
    }

    return NextResponse.json({
      available,
      reason,
      sessionId: analysisSession.id,
      status: analysisSession.status,
    });
  } catch (error) {
    console.error("[Professional Report] Error checking availability:", error);
    return NextResponse.json(
      {
        available: false,
        reason: "Error checking availability",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
