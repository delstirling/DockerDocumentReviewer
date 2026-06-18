import { NextRequest, NextResponse } from "next/server";
import { createHash, randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { passwordResetTokens, users } from "@/db/schema/auth";
import { sendPasswordResetEmail } from "@/lib/email";

export const runtime = "nodejs";

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();
    const normalizedEmail =
      typeof email === "string" ? email.trim().toLowerCase() : "";

    if (!normalizedEmail) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        isActive: users.isActive,
      })
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);

    // Prevent user enumeration by always returning success.
    if (!user || !user.isActive) {
      return NextResponse.json({ success: true });
    }

    const resetToken = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(resetToken).digest("hex");
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

    await db
      .insert(passwordResetTokens)
      .values({
        userId: user.id,
        tokenHash,
        expires: expiresAt,
      });

    const baseUrl =
      process.env.NEXTAUTH_URL || process.env.AUTH_URL || "http://localhost:3000";

    await sendPasswordResetEmail({
      to: user.email,
      name: user.name,
      resetToken,
      baseUrl,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Forgot password error:", error);
    return NextResponse.json(
      { error: "Failed to process forgot password request" },
      { status: 500 },
    );
  }
}
