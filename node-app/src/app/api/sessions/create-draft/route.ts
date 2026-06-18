import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { ensureDefaultOrganizationId } from "@/lib/default-organization";

export async function POST(req: NextRequest) {
  try {
    console.log("[create-draft] Checking authentication");
    const session = await auth();

    if (!session?.user?.id) {
      console.error("[create-draft] No session or user ID found");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.log(`[create-draft] Authenticated user: ${session.user.id}`);

    const now = new Date().toISOString();
    const authenticatedUserId = Number(session.user.id);
    const organizationId = await ensureDefaultOrganizationId();

    console.log("[create-draft] Creating draft session");

    const result = await db.execute(sql`
      INSERT INTO analysis_sessions (
        user_id, organization_id, title, status, ai_mode, 
        our_clients, opposing_parties, metadata, 
        created_at, updated_at
      )
      VALUES (
        ${authenticatedUserId}, ${organizationId}, 'Untitled Document', 'draft', 'tools_and_steps',
        ARRAY[]::text[], ARRAY[]::text[], '{}'::jsonb,
        ${now}::timestamp, ${now}::timestamp
      )
      RETURNING id
    `);

    const newSessionId = (result.rows as Array<{ id: number }>)[0]?.id;

    if (!newSessionId) {
      throw new Error("Failed to get session ID from insert");
    }

    console.log(
      `[create-draft] Draft session created successfully: ${newSessionId}`,
    );

    return NextResponse.json({
      success: true,
      sessionId: newSessionId,
    });
  } catch (error) {
    console.error("[create-draft] Error creating draft session:", error);
    return NextResponse.json(
      { error: "Failed to create draft session" },
      { status: 500 },
    );
  }
}
