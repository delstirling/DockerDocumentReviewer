import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db/client";
import { invitationTokens, organizations, users } from "@/db/schema/auth";
import { isOrganizationFeatureAvailable } from "@/lib/organization-feature";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const session = await auth();
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!(await isOrganizationFeatureAvailable())) {
      return NextResponse.json(
        {
          error:
            "Organization management is unavailable until the database migration is applied.",
        },
        { status: 503 },
      );
    }

    const body = await request.json();
    const token = typeof body?.token === "string" ? body.token.trim() : "";

    if (!token) {
      return NextResponse.json(
        { error: "Invitation token is required" },
        { status: 400 },
      );
    }

    const [invitation] = await db
      .select({
        id: invitationTokens.id,
        email: invitationTokens.email,
        organizationId: invitationTokens.organizationId,
        used: invitationTokens.used,
        expires: invitationTokens.expires,
      })
      .from(invitationTokens)
      .where(eq(invitationTokens.token, token))
      .limit(1);

    if (!invitation) {
      return NextResponse.json(
        { error: "Invalid invitation token" },
        { status: 404 },
      );
    }

    if (invitation.used) {
      return NextResponse.json(
        { error: "Invitation has already been used" },
        { status: 400 },
      );
    }

    if (invitation.expires && invitation.expires < new Date()) {
      return NextResponse.json(
        { error: "Invitation has expired" },
        { status: 400 },
      );
    }

    if (!invitation.organizationId) {
      return NextResponse.json(
        { error: "Invitation does not have a valid organization" },
        { status: 400 },
      );
    }

    const [currentUser] = await db
      .select({
        id: users.id,
        email: users.email,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!currentUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    await db
      .update(users)
      .set({
        organizationId: invitation.organizationId,
        organizationTier: "user",
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    await db
      .update(invitationTokens)
      .set({
        used: true,
        acceptedAt: new Date(),
      })
      .where(eq(invitationTokens.id, invitation.id));

    return NextResponse.json({
      success: true,
      organizationId: invitation.organizationId,
    });
  } catch (error) {
    console.error("Failed to process invitation:", error);
    return NextResponse.json(
      { error: "Failed to process invitation" },
      { status: 500 },
    );
  }
}
