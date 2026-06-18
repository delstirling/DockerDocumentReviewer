import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db/client";
import { organizations, users } from "@/db/schema/auth";
import { isOrganizationFeatureAvailable } from "@/lib/organization-feature";

export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await auth();
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const orgFeatureAvailable = await isOrganizationFeatureAvailable();

    const [record] = orgFeatureAvailable
      ? await db
          .select({
            id: users.id,
            name: users.name,
            email: users.email,
            role: users.role,
            organizationId: users.organizationId,
            organizationName: organizations.name,
          })
          .from(users)
          .leftJoin(organizations, eq(users.organizationId, organizations.id))
          .where(eq(users.id, userId))
          .limit(1)
      : await db
          .select({
            id: users.id,
            name: users.name,
            email: users.email,
            role: users.role,
          })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);

    if (!record) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const organizationId =
      orgFeatureAvailable && "organizationId" in record
        ? (record.organizationId ?? null)
        : null;
    const organizationName =
      orgFeatureAvailable && "organizationName" in record
        ? (record.organizationName ?? null)
        : null;

    return NextResponse.json({
      user: {
        id: record.id,
        name: record.name,
        email: record.email,
        role: record.role,
      },
      organization: organizationId
        ? {
            id: organizationId,
            name: organizationName,
          }
        : null,
    });
  } catch (error) {
    console.error("Failed to load account details:", error);
    return NextResponse.json(
      { error: "Failed to load account details" },
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

    const body = await request.json();
    const nextName = typeof body?.name === "string" ? body.name.trim() : "";

    if (!nextName) {
      return NextResponse.json(
        { error: "Name is required" },
        { status: 400 },
      );
    }

    if (nextName.length > 255) {
      return NextResponse.json(
        { error: "Name must be 255 characters or fewer" },
        { status: 400 },
      );
    }

    const [updated] = await db
      .update(users)
      .set({ name: nextName, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning({ id: users.id, name: users.name });

    return NextResponse.json({
      success: true,
      user: updated,
    });
  } catch (error) {
    console.error("Failed to update account:", error);
    return NextResponse.json(
      { error: "Failed to update account" },
      { status: 500 },
    );
  }
}
