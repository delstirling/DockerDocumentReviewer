import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db/client";
import { organizations, users } from "@/db/schema/auth";
import { isOrganizationFeatureAvailable } from "@/lib/organization-feature";

export const runtime = "nodejs";

type OrganizationTier = "admin" | "user";

async function getCurrentMembership(userId: number) {
  const [membership] = await db
    .select({
      userId: users.id,
      organizationId: users.organizationId,
      organizationTier: users.organizationTier,
      organizationName: organizations.name,
    })
    .from(users)
    .leftJoin(organizations, eq(users.organizationId, organizations.id))
    .where(eq(users.id, userId))
    .limit(1);

  return membership;
}

function isValidTier(value: unknown): value is OrganizationTier {
  return value === "admin" || value === "user";
}

export async function GET() {
  try {
    const session = await auth();
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!(await isOrganizationFeatureAvailable())) {
      return NextResponse.json({ organization: null });
    }

    const record = await getCurrentMembership(userId);

    const members = record?.organizationId
      ? await db
          .select({
            id: users.id,
            name: users.name,
            email: users.email,
            organizationTier: users.organizationTier,
          })
          .from(users)
          .where(eq(users.organizationId, record.organizationId))
      : [];

    return NextResponse.json({
      organization: record?.organizationId
        ? {
            id: record.organizationId,
            name: record.organizationName,
            currentUserTier: record.organizationTier,
          }
        : null,
      members,
    });
  } catch (error) {
    console.error("Failed to load organization:", error);
    return NextResponse.json(
      { error: "Failed to load organization" },
      { status: 500 },
    );
  }
}

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

    if (body?.action === "addMember") {
      const actorMembership = await getCurrentMembership(userId);

      if (!actorMembership?.organizationId) {
        return NextResponse.json(
          { error: "You must belong to an organization to manage members" },
          { status: 400 },
        );
      }

      if (actorMembership.organizationTier !== "admin") {
        return NextResponse.json(
          { error: "Only organization admins can add members" },
          { status: 403 },
        );
      }

      const email = typeof body?.email === "string" ? body.email.trim() : "";
      const tier = body?.tier;

      if (!email) {
        return NextResponse.json(
          { error: "Member email is required" },
          { status: 400 },
        );
      }

      if (!isValidTier(tier)) {
        return NextResponse.json(
          { error: "Tier must be admin or user" },
          { status: 400 },
        );
      }

      const [targetUser] = await db
        .select({
          id: users.id,
          organizationId: users.organizationId,
        })
        .from(users)
        .where(sql`lower(${users.email}) = lower(${email})`)
        .limit(1);

      if (!targetUser) {
        return NextResponse.json(
          { error: "No user found with that email" },
          { status: 404 },
        );
      }

      if (
        targetUser.organizationId &&
        targetUser.organizationId !== actorMembership.organizationId
      ) {
        return NextResponse.json(
          { error: "User already belongs to another organization" },
          { status: 409 },
        );
      }

      await db
        .update(users)
        .set({
          organizationId: actorMembership.organizationId,
          organizationTier: tier,
          updatedAt: new Date(),
        })
        .where(eq(users.id, targetUser.id));

      return NextResponse.json({ success: true });
    }

    const organizationName =
      typeof body?.name === "string" ? body.name.trim() : "";

    if (!organizationName) {
      return NextResponse.json(
        { error: "Organization name is required" },
        { status: 400 },
      );
    }

    if (organizationName.length > 255) {
      return NextResponse.json(
        { error: "Organization name must be 255 characters or fewer" },
        { status: 400 },
      );
    }

    const [existingMembership] = await db
      .select({ organizationId: users.organizationId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (existingMembership?.organizationId) {
      return NextResponse.json(
        { error: "User is already affiliated with an organization" },
        { status: 409 },
      );
    }

    const [existingOrganization] = await db
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .where(sql`lower(${organizations.name}) = lower(${organizationName})`)
      .limit(1);

    const assignedOrganization =
      existingOrganization ??
      (
        await db
          .insert(organizations)
          .values({
            name: organizationName,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning({ id: organizations.id, name: organizations.name })
      )[0];

    const membershipTier: OrganizationTier = existingOrganization
      ? "user"
      : "admin";

    await db
      .update(users)
      .set({
        organizationId: assignedOrganization.id,
        organizationTier: membershipTier,
        updatedAt: new Date(),
      })
      .where(and(eq(users.id, userId), sql`${users.organizationId} is null`));

    return NextResponse.json({
      success: true,
      organization: assignedOrganization,
      joinedExisting: Boolean(existingOrganization),
      membershipTier,
    });
  } catch (error) {
    console.error("Failed to create organization:", error);
    return NextResponse.json(
      { error: "Failed to create organization" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
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

    const actorMembership = await getCurrentMembership(userId);
    if (!actorMembership?.organizationId) {
      return NextResponse.json(
        { error: "You must belong to an organization to manage members" },
        { status: 400 },
      );
    }

    if (actorMembership.organizationTier !== "admin") {
      return NextResponse.json(
        { error: "Only organization admins can update member tiers" },
        { status: 403 },
      );
    }

    const body = await request.json();
    const memberId = Number(body?.memberId);
    const tier = body?.tier;

    if (!Number.isFinite(memberId) || memberId <= 0) {
      return NextResponse.json(
        { error: "Valid memberId is required" },
        { status: 400 },
      );
    }

    if (!isValidTier(tier)) {
      return NextResponse.json(
        { error: "Tier must be admin or user" },
        { status: 400 },
      );
    }

    const [member] = await db
      .select({
        id: users.id,
        organizationId: users.organizationId,
      })
      .from(users)
      .where(eq(users.id, memberId))
      .limit(1);

    if (!member || member.organizationId !== actorMembership.organizationId) {
      return NextResponse.json(
        { error: "Member not found in your organization" },
        { status: 404 },
      );
    }

    if (memberId === userId && tier !== "admin") {
      const [adminCountRecord] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(users)
        .where(
          and(
            eq(users.organizationId, actorMembership.organizationId),
            eq(users.organizationTier, "admin"),
          ),
        );

      if ((adminCountRecord?.count ?? 0) <= 1) {
        return NextResponse.json(
          { error: "Organization must have at least one admin" },
          { status: 400 },
        );
      }
    }

    await db
      .update(users)
      .set({ organizationTier: tier, updatedAt: new Date() })
      .where(eq(users.id, memberId));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to update member tier:", error);
    return NextResponse.json(
      { error: "Failed to update member tier" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
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

    const actorMembership = await getCurrentMembership(userId);
    if (!actorMembership?.organizationId) {
      return NextResponse.json(
        { error: "You must belong to an organization to manage members" },
        { status: 400 },
      );
    }

    if (actorMembership.organizationTier !== "admin") {
      return NextResponse.json(
        { error: "Only organization admins can remove members" },
        { status: 403 },
      );
    }

    const { searchParams } = new URL(request.url);
    const memberId = Number(searchParams.get("memberId"));

    if (!Number.isFinite(memberId) || memberId <= 0) {
      return NextResponse.json(
        { error: "Valid memberId is required" },
        { status: 400 },
      );
    }

    const [member] = await db
      .select({
        id: users.id,
        organizationId: users.organizationId,
        organizationTier: users.organizationTier,
      })
      .from(users)
      .where(eq(users.id, memberId))
      .limit(1);

    if (!member || member.organizationId !== actorMembership.organizationId) {
      return NextResponse.json(
        { error: "Member not found in your organization" },
        { status: 404 },
      );
    }

    if (member.organizationTier === "admin") {
      const [adminCountRecord] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(users)
        .where(
          and(
            eq(users.organizationId, actorMembership.organizationId),
            eq(users.organizationTier, "admin"),
          ),
        );

      if ((adminCountRecord?.count ?? 0) <= 1) {
        return NextResponse.json(
          { error: "Organization must have at least one admin" },
          { status: 400 },
        );
      }
    }

    await db
      .update(users)
      .set({
        organizationId: null,
        organizationTier: "user",
        updatedAt: new Date(),
      })
      .where(eq(users.id, memberId));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to remove member:", error);
    return NextResponse.json(
      { error: "Failed to remove member" },
      { status: 500 },
    );
  }
}
