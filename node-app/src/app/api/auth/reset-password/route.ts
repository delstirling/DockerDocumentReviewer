import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { hash } from "bcryptjs";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db/client";
import { passwordResetTokens, users } from "@/db/schema/auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const { token, password, confirmPassword } = await request.json();

    if (!token || !password || !confirmPassword) {
      return NextResponse.json(
        { error: "Token, password, and confirmation are required" },
        { status: 400 },
      );
    }

    if (password !== confirmPassword) {
      return NextResponse.json(
        { error: "Passwords do not match" },
        { status: 400 },
      );
    }

    if (String(password).length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 },
      );
    }

    const tokenHash = createHash("sha256").update(String(token)).digest("hex");

    const [resetRecord] = await db
      .select({
        id: passwordResetTokens.id,
        userId: passwordResetTokens.userId,
      })
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.tokenHash, tokenHash),
          eq(passwordResetTokens.used, false),
          gt(passwordResetTokens.expires, new Date()),
        ),
      )
      .limit(1);

    if (!resetRecord) {
      return NextResponse.json(
        { error: "Invalid or expired reset token" },
        { status: 400 },
      );
    }

    const newPasswordHash = await hash(String(password), 12);

    await db
      .update(users)
      .set({
        password: newPasswordHash,
        updatedAt: new Date(),
      })
      .where(eq(users.id, resetRecord.userId));

    await db
      .update(passwordResetTokens)
      .set({
        used: true,
        usedAt: new Date(),
      })
      .where(eq(passwordResetTokens.id, resetRecord.id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Reset password error:", error);
    return NextResponse.json(
      { error: "Failed to reset password" },
      { status: 500 },
    );
  }
}
