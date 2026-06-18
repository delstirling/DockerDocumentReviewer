import { randomBytes } from "crypto";
import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db/client";
import { invitationTokens, organizations, users } from "@/db/schema/auth";
import { sendOrganizationInvitationEmail } from "@/lib/email";
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

    const [actor] = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        organizationId: users.organizationId,
        organizationTier: users.organizationTier,
        organizationName: organizations.name,
      })
      .from(users)
      .leftJoin(organizations, eq(users.organizationId, organizations.id))
      .where(eq(users.id, userId))
      .limit(1);

    if (!actor?.organizationId) {
      return NextResponse.json(
        { error: "You must belong to an organization to send invitations" },
        { status: 400 },
      );
    }

    if (actor.organizationTier !== "admin") {
      return NextResponse.json(
        { error: "Only organization admins can send invitations" },
        { status: 403 },
      );
    }

    const body = await request.json();
    const invitedName =
      typeof body?.name === "string" ? body.name.trim() : "";
    const invitedEmail =
      typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";

    if (!invitedName || !invitedEmail) {
      return NextResponse.json(
        { error: "Name and email are required" },
        { status: 400 },
      );
    }

    const [existingUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = lower(${invitedEmail})`)
      .limit(1);

    if (existingUser) {
      return NextResponse.json(
        { error: "User already exists. Use Add Existing User instead." },
        { status: 409 },
      );
    }

    const [existingPendingInvite] = await db
      .select({ id: invitationTokens.id })
      .from(invitationTokens)
      .where(
        and(
          sql`lower(${invitationTokens.email}) = lower(${invitedEmail})`,
          eq(invitationTokens.organizationId, actor.organizationId),
          eq(invitationTokens.used, false),
          sql`${invitationTokens.expires} > now()`,
        ),
      )
      .limit(1);

    if (existingPendingInvite) {
      return NextResponse.json(
        { error: "An active invitation already exists for this email." },
        { status: 409 },
      );
    }

    const token = randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await db.insert(invitationTokens).values({
      token,
      email: invitedEmail,
      organizationId: actor.organizationId,
      role: "user",
      used: false,
      expires,
      createdAt: new Date(),
    });

    const requestUrl = new URL(request.url);
    const baseUrl =
      process.env.NEXTAUTH_URL ||
      `${requestUrl.protocol}//${requestUrl.host}`;

    await sendOrganizationInvitationEmail({
      to: invitedEmail,
      invitedName,
      inviterName: actor.name || actor.email || "An organization administrator",
      organizationName: actor.organizationName || "your organization",
      invitationToken: token,
      baseUrl,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to send organization invitation:", error);
    return NextResponse.json(
      { error: "Failed to send invitation" },
      { status: 500 },
    );
  }
}
