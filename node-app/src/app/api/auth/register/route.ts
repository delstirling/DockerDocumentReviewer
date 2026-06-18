import { NextRequest, NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { db } from "@/db/client";
import { users, auditLog, invitationTokens } from "@/db/schema/auth";
import { eq, and } from "drizzle-orm";
import {
  sendWelcomeEmail,
  sendAdminNotification,
  getAdminEmails,
} from "@/lib/email";

export const runtime = "nodejs";

/**
 * User Registration API
 * Creates new user accounts with email/password
 * Supports both regular registration and invitation-based registration
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      name,
      email,
      password,
      invitationToken,
      joinOrganization,
      organizationName,
    } = body;

    const wantsOrganization = Boolean(joinOrganization);
    const requestedOrganizationName =
      typeof organizationName === "string" ? organizationName.trim() : "";

    // Validation
    if (!name || !email || !password) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 },
      );
    }

    if (wantsOrganization && requestedOrganizationName.length === 0) {
      return NextResponse.json(
        { error: "Organization name is required" },
        { status: 400 },
      );
    }

    // If invitation token provided, verify it
    let invitationData = null;
    if (invitationToken) {
      const [invitation] = await db
        .select()
        .from(invitationTokens)
        .where(eq(invitationTokens.token, invitationToken))
        .limit(1);

      if (!invitation) {
        return NextResponse.json(
          { error: "Invalid invitation token" },
          { status: 400 },
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

      if (invitation.email.toLowerCase() !== email.toLowerCase()) {
        return NextResponse.json(
          { error: "Email does not match invitation" },
          { status: 400 },
        );
      }

      invitationData = invitation;
    }

    // Check if user already exists
    const [existingUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existingUser) {
      return NextResponse.json(
        { error: "Email already registered" },
        { status: 409 },
      );
    }

    // Hash password
    const hashedPassword = await hash(password, 12);

    // Determine user role and approval status
    const userRole = invitationData ? invitationData.role : "user";
    const isApproved = invitationData ? true : !wantsOrganization;
    const invitationOrganizationId = invitationData?.organizationId ?? null;

    // Create user
    const [newUser] = await db
      .insert(users)
      .values({
        name,
        email,
        password: hashedPassword,
        role: userRole,
        organizationId: invitationOrganizationId,
        organizationTier: "user",
        isActive: true,
        isApproved,
      })
      .returning();

    // If invitation was used, mark it as used
    if (invitationData) {
      await db
        .update(invitationTokens)
        .set({
          used: true,
          acceptedAt: new Date(),
        })
        .where(eq(invitationTokens.id, invitationData.id));
    }

    // Log registration
    await db.insert(auditLog).values({
      userId: newUser.id,
      action: invitationData
        ? "user_registered_via_invitation"
        : "user_registered",
      details: JSON.stringify({
        email,
        name,
        role: userRole,
        invitedUser: !!invitationData,
        invitationId: invitationData?.id,
        invitationOrganizationId,
        requestedOrganizationJoin: wantsOrganization,
        requestedOrganizationName:
          requestedOrganizationName.length > 0
            ? requestedOrganizationName
            : null,
      }),
      ipAddress:
        request.headers.get("x-forwarded-for") ||
        request.headers.get("x-real-ip") ||
        "unknown",
      userAgent: request.headers.get("user-agent") || "unknown",
    });

    // Send welcome email to user (don't block registration if email fails)
    try {
      await sendWelcomeEmail(email, name);
    } catch (emailError) {
      console.error("Failed to send welcome email (non-blocking):", emailError);
    }

    // Send notification to admins only if NOT invited (invited users are pre-approved)
    if (!invitationData) {
      try {
        const adminEmails = await getAdminEmails();
        for (const adminEmail of adminEmails) {
          try {
            await sendAdminNotification(adminEmail, email, name);
          } catch (notificationError) {
            console.error(
              `Failed to notify admin ${adminEmail} (non-blocking):`,
              notificationError,
            );
          }
        }
      } catch (adminEmailError) {
        console.error(
          "Failed to fetch admin emails (non-blocking):",
          adminEmailError,
        );
      }
    }

    return NextResponse.json(
      {
        success: true,
        message: invitationData || !wantsOrganization
          ? "Account created successfully. You can now sign in."
          : "Account created successfully. Pending admin approval.",
        requiresApproval: wantsOrganization && !invitationData,
        isApproved: newUser.isApproved,
        user: {
          id: newUser.id,
          name: newUser.name,
          email: newUser.email,
          role: newUser.role,
        },
      },
      { status: 201 },
    );
  } catch (error: any) {
    console.error("Registration error:", error);
    console.error("Error stack:", error?.stack);
    console.error("Error message:", error?.message);

    // Return detailed error in development, generic in production
    const isDevelopment = process.env.NODE_ENV === "development";

    return NextResponse.json(
      {
        error: "Internal server error",
        ...(isDevelopment && {
          details: error?.message,
          stack: error?.stack,
        }),
      },
      { status: 500 },
    );
  }
}
