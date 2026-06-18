import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db/client";
import { analysisSessions, documents } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import {
  updateSessionSchema,
  validateInput,
  UPDATABLE_SESSION_FIELDS,
  filterToWhitelist,
} from "@/lib/validations/session-schemas";

/**
 * Validate testing authentication with additional security checks.
 * Testing auth is only allowed in development or from specific conditions.
 */
function isValidTestingAuth(req: NextRequest): boolean {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return false;

  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (token !== process.env.INTERNAL_API_TOKEN) return false;

  // Additional security: only allow testing auth in development
  // or when explicitly enabled via environment variable
  const isDevEnvironment = process.env.NODE_ENV === "development";
  const isTestingEnabled = process.env.ENABLE_TESTING_AUTH === "true";

  return isDevEnvironment || isTestingEnabled;
}

export async function GET(
  req: NextRequest,
  segmentData: { params: Promise<{ id: string }> },
) {
  try {
    const isTestingAuth = isValidTestingAuth(req);
    let authenticatedUserId: number | null = null;

    if (!isTestingAuth) {
      const session = await auth();
      if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      authenticatedUserId = Number(session.user.id);
    }

    const params = await segmentData.params;
    const sessionId = Number(params.id);

    // Fetch session with documents
    const [analysisSession] = await db
      .select()
      .from(analysisSessions)
      .where(
        isTestingAuth
          ? eq(analysisSessions.id, Number(sessionId))
          : and(
              eq(analysisSessions.id, Number(sessionId)),
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
      .where(eq(documents.analysisSessionId, sessionId));

    return NextResponse.json({
      success: true,
      session: analysisSession,
      documents: sessionDocuments,
    });
  } catch (error) {
    console.error("Error fetching analysis session:", error);
    return NextResponse.json(
      { error: "Failed to fetch session" },
      { status: 500 },
    );
  }
}

export async function PUT(
  req: NextRequest,
  segmentData: { params: Promise<{ id: string }> },
) {
  try {
    const isTestingAuth = isValidTestingAuth(req);
    let authenticatedUserId: number | null = null;

    if (!isTestingAuth) {
      const session = await auth();
      if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      authenticatedUserId = Number(session.user.id);
    }

    const params = await segmentData.params;
    const sessionId = Number(params.id);

    // Parse and validate request body
    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON in request body" },
        { status: 400 },
      );
    }

    // Validate input using Zod schema (prevents mass assignment)
    const validation = validateInput(updateSessionSchema, rawBody);
    if (!validation.success) {
      return NextResponse.json(
        { error: `Validation failed: ${validation.error}` },
        { status: 400 },
      );
    }

    // Additional safeguard: filter to whitelisted fields only
    const safeUpdateData = filterToWhitelist(
      validation.data,
      UPDATABLE_SESSION_FIELDS,
    );

    const [existingSession] = await db
      .select()
      .from(analysisSessions)
      .where(
        isTestingAuth
          ? eq(analysisSessions.id, Number(sessionId))
          : and(
              eq(analysisSessions.id, Number(sessionId)),
              eq(analysisSessions.userId, authenticatedUserId!),
            ),
      )
      .limit(1);

    if (!existingSession) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Update session with validated and whitelisted fields only
    const [updatedSession] = await db
      .update(analysisSessions)
      .set({
        ...safeUpdateData,
        updatedAt: new Date(),
      })
      .where(eq(analysisSessions.id, Number(sessionId)))
      .returning();

    return NextResponse.json({
      success: true,
      session: updatedSession,
    });
  } catch (error) {
    console.error("Error updating analysis session:", error);
    return NextResponse.json(
      { error: "Failed to update session" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  req: NextRequest,
  segmentData: { params: Promise<{ id: string }> },
) {
  try {
    const isTestingAuth = isValidTestingAuth(req);
    let authenticatedUserId: number | null = null;

    if (!isTestingAuth) {
      const session = await auth();
      if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      authenticatedUserId = Number(session.user.id);
    }

    const params = await segmentData.params;
    const sessionId = Number(params.id);

    const [existingSession] = await db
      .select()
      .from(analysisSessions)
      .where(
        isTestingAuth
          ? eq(analysisSessions.id, Number(sessionId))
          : and(
              eq(analysisSessions.id, Number(sessionId)),
              eq(analysisSessions.userId, authenticatedUserId!),
            ),
      )
      .limit(1);

    if (!existingSession) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Delete session (cascades to documents due to FK constraint)
    await db.delete(analysisSessions).where(eq(analysisSessions.id, Number(sessionId)));

    return NextResponse.json({
      success: true,
      message: "Session deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting analysis session:", error);
    return NextResponse.json(
      { error: "Failed to delete session" },
      { status: 500 },
    );
  }
}
