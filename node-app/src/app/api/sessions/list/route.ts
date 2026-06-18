import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db/client";
import { analysisSessions } from "@/db/schema";
import { eq, desc, ilike, and } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    // Check authentication
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const authenticatedUserId = Number(session.user.id);

    // Parse query parameters
    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");
    const search = searchParams.get("search") || "";

    const offset = (page - 1) * limit;

    // Build query conditions
    const conditions = [eq(analysisSessions.userId, authenticatedUserId)];

    if (search) {
      conditions.push(ilike(analysisSessions.title, `%${search}%`));
    }

    // Fetch sessions
    const sessions = await db
      .select({
        id: analysisSessions.id,
        title: analysisSessions.title,
        status: analysisSessions.status,
        createdAt: analysisSessions.createdAt,
        updatedAt: analysisSessions.updatedAt,
        documentType: analysisSessions.documentType,
        jurisdiction: analysisSessions.jurisdiction,
      })
      .from(analysisSessions)
      .where(and(...conditions))
      .orderBy(desc(analysisSessions.updatedAt))
      .limit(limit + 1) // Fetch one extra to check if there are more
      .offset(offset);

    // Check if there are more results
    const hasMore = sessions.length > limit;
    const returnSessions = hasMore ? sessions.slice(0, limit) : sessions;

    return NextResponse.json({
      success: true,
      sessions: returnSessions,
      hasMore,
      page,
      limit,
    });
  } catch (error) {
    console.error("Error fetching analysis sessions:", error);
    return NextResponse.json(
      { error: "Failed to fetch sessions" },
      { status: 500 },
    );
  }
}
