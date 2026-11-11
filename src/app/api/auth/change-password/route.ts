import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getAdminSession,
  verifyPassword,
  hashPassword,
  createSessionToken,
  COOKIE_NAME,
} from "@/lib/auth";
import { verifyRequestOrigin } from "@/lib/rate-limit";
import { recordAuditLog } from "@/lib/audit";

export async function POST(req: NextRequest) {
  try {
    const originCheck = verifyRequestOrigin(req);
    if (!originCheck.isValid) {
      return NextResponse.json(
        { error: originCheck.error || "Forbidden" },
        { status: 403 }
      );
    }

    const session = await getAdminSession(req, { checkDb: true });
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { oldPassword, newPassword } = body;

    if (!oldPassword || !newPassword) {
      return NextResponse.json(
        { error: "Current password and new password are required." },
        { status: 400 }
      );
    }

    if (typeof newPassword !== "string" || newPassword.length < 8) {
      return NextResponse.json(
        { error: "New password must be at least 8 characters long." },
        { status: 400 }
      );
    }

    if (oldPassword === newPassword) {
      return NextResponse.json(
        { error: "New password must be different from current password." },
        { status: 400 }
      );
    }

    const admin = await prisma.adminUser.findUnique({
      where: { id: session.id },
    });

    if (!admin || !admin.isActive) {
      return NextResponse.json({ error: "User not found or inactive." }, { status: 401 });
    }

    const isOldValid = await verifyPassword(oldPassword, admin.passwordHash);
    if (!isOldValid) {
      return NextResponse.json(
        { error: "Current password is incorrect." },
        { status: 400 }
      );
    }

    const newHash = await hashPassword(newPassword);
    const updatedTokenVersion = admin.tokenVersion + 1;

    const updatedUser = await prisma.adminUser.update({
      where: { id: admin.id },
      data: {
        passwordHash: newHash,
        tokenVersion: updatedTokenVersion,
        mustChangePassword: false,
      },
    });

    await recordAuditLog({
      action: "PASSWORD_CHANGED",
      adminUserId: admin.id,
      details: { email: admin.email },
    });

    // Create fresh session token with updated tokenVersion
    const newToken = await createSessionToken({
      id: updatedUser.id,
      email: updatedUser.email,
      role: updatedUser.role,
      tokenVersion: updatedTokenVersion,
      mustChangePassword: false,
    });

    const res = NextResponse.json({
      success: true,
      message: "Password changed successfully. Existing sessions on other devices have been invalidated.",
    });

    res.cookies.set({
      name: COOKIE_NAME,
      value: newToken,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24,
    });

    return res;
  } catch (err: any) {
    console.error("[Change Password Error]", err);
    return NextResponse.json(
      { error: "Failed to update password." },
      { status: 500 }
    );
  }
}
