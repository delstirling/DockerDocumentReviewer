import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db/client";
import { analysisSessions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { formatErrorWithCause } from "@/lib/session-metadata";

export const maxDuration = 60;

/**
 * POST /api/analysis/resume-proxy
 * Proxy route for UI to trigger resume with user authentication
 * Validates user owns the session, then calls /api/analysis/resume with INTERNAL_API_TOKEN
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      console.log(`[Resume Proxy] Unauthorized - no user session`);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { sessionId } = await req.json();

    if (!sessionId) {
      return NextResponse.json(
        { error: "sessionId is required" },
        { status: 400 },
      );
    }

    const analysisSession = await db.query.analysisSessions.findFirst({
      where: eq(analysisSessions.id, Number(sessionId)),
    });

    if (!analysisSession) {
      console.log(`[Resume Proxy] Session not found: ${sessionId}`);
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    if (analysisSession.userId !== session.user.id) {
      console.log(
        `[Resume Proxy] Unauthorized - user ${session.user.id} does not own session ${sessionId}`,
      );
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    console.log(
      `[Resume Proxy] User ${session.user.id} authorized to resume session ${sessionId}`,
    );

    if (!process.env.INTERNAL_API_TOKEN) {
      console.error(`[Resume Proxy] INTERNAL_API_TOKEN not configured`);
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 },
      );
    }

    const resumeUrl = `${req.nextUrl.origin}/api/analysis/resume`;

    console.log(`[Resume Proxy] Calling resume endpoint: ${resumeUrl}`);

    const response = await fetch(resumeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.INTERNAL_API_TOKEN}`,
        "x-internal-api-token":
          process.env.INTERNAL_API_TOKEN || "",
      },
      body: JSON.stringify({ sessionId }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Resume Proxy] Resume request failed:`, errorText);
      return NextResponse.json(
        { error: "Failed to resume analysis", details: errorText },
        { status: response.status },
      );
    }

    const result = await response.json();
    console.log(
      `[Resume Proxy] Resume triggered successfully for ${sessionId}`,
    );

    return NextResponse.json(result);
  } catch (error: unknown) {
    console.error(`[Resume Proxy] Error: ${formatErrorWithCause(error)}`);
    return NextResponse.json(
      { error: formatErrorWithCause(error) || "Failed to resume analysis" },
      { status: 500 },
    );
  }
}
