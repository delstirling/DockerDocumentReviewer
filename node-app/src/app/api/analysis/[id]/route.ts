import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db/client";
import { analysisSessions, documents } from "@/db/schema";
import { eq, and } from "drizzle-orm";

/**
 * Handle OPTIONS preflight requests for CORS
 * This fixes the 405 Method Not Allowed error when the browser sends a preflight request
 */
export async function OPTIONS(
  req: NextRequest,
  segmentData: { params: Promise<{ id: string }> },
) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      Allow: "GET, POST, OPTIONS",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Credentials": "true",
    },
  });
}

/**
 * GET /api/analysis/[id]
 * Fetch analysis session data with documents
 * This endpoint provides the same functionality as /api/sessions/[id]
 * but under the /api/analysis namespace for consistency
 */
export async function GET(
  req: NextRequest,
  segmentData: { params: Promise<{ id: string }> },
) {
  try {
    const authHeader = req.headers.get("authorization");
    const isTestingAuth =
      authHeader &&
      authHeader.replace(/^Bearer\s+/i, "") === process.env.INTERNAL_API_TOKEN;

    let authenticatedUserId: number | null = null;

    if (!isTestingAuth) {
      const session = await auth();
      if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      authenticatedUserId = Number(session.user.id);
    }

    const params = await segmentData.params;
    const sessionId = params.id;
    const sessionIdNum = Number(sessionId);

    if (!Number.isFinite(sessionIdNum) || sessionIdNum <= 0) {
      return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
    }

    // Fetch session with documents
    const [analysisSession] = await db
      .select()
      .from(analysisSessions)
      .where(
        isTestingAuth
          ? eq(analysisSessions.id, sessionIdNum)
          : and(
              eq(analysisSessions.id, sessionIdNum),
              eq(analysisSessions.userId, authenticatedUserId!),
            ),
      )
      .limit(1);

    if (!analysisSession) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Fetch associated documents
    const sessionDocuments = await db
      .select()
      .from(documents)
      .where(eq(documents.analysisSessionId, sessionIdNum));

    return NextResponse.json({
      success: true,
      session: analysisSession,
      documents: sessionDocuments,
    });
  } catch (error) {
    console.error(
      "[API /api/analysis/[id]] Error fetching analysis session:",
      error,
    );
    return NextResponse.json(
      { error: "Failed to fetch session" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/analysis/[id]
 * Redirect to the streaming endpoint
 * This ensures backward compatibility if any client code calls the base route
 */
export async function POST(
  req: NextRequest,
  segmentData: { params: Promise<{ id: string }> },
) {
  const params = await segmentData.params;
  const sessionId = params.id;

  console.log(
    `[API /api/analysis/[id]] POST request received, redirecting to /api/analysis/${sessionId}/stream`,
  );

  return NextResponse.redirect(
    new URL(`/api/analysis/${sessionId}/stream`, req.url),
    307,
  );
}
