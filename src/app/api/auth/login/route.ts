import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPassword, createSessionToken, COOKIE_NAME } from "@/lib/auth";
import { recordAuditLog } from "@/lib/audit";
import {
  getClientIdentifier,
  checkLoginRateLimit,
  recordFailedLogin,
  recordSuccessfulLogin,
  verifyRequestOrigin,
} from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  try {
    // 1. CSRF / Origin Check for state-changing login requests
    const originCheck = verifyRequestOrigin(req);
    if (!originCheck.isValid) {
      return NextResponse.json(
        { error: originCheck.error || "Forbidden" },
        { status: 403 }
      );
    }

    const body = await req.json();
    const { email, password } = body;

    if (!email || !password || typeof email !== "string" || typeof password !== "string") {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    // 2. Rate Limit Check
    const rateLimitKey = getClientIdentifier(req, email);
    const { isBlocked, remainingSec } = await checkLoginRateLimit(rateLimitKey);
    if (isBlocked) {
      return NextResponse.json(
        {
          error: `Too many failed login attempts. Please wait ${remainingSec} seconds before trying again.`,
        },
        { status: 429 }
      );
    }

    // 3. In production, strictly reject default development credentials
    if (process.env.NODE_ENV === "production") {
      const isDefaultEmail = email.toLowerCase().trim() === "admin@local.test";
      const isDefaultPassword = password === "change_me_local_password_123";
      if (isDefaultEmail || isDefaultPassword) {
        await recordFailedLogin(rateLimitKey);
        await recordAuditLog({
          action: "LOGIN_FAILED_DEFAULT_CREDENTIALS_BLOCKED",
          details: { email: email.toLowerCase().trim() },
        });
        return NextResponse.json(
          {
            error:
              "Default development credentials are forbidden in production. Please use your provisioned staff credentials.",
          },
          { status: 403 }
        );
      }
    }

    const admin = await prisma.adminUser.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (!admin || !admin.isActive) {
      await recordFailedLogin(rateLimitKey);
      await recordAuditLog({
        action: "LOGIN_FAILED",
        details: { email: email.toLowerCase().trim(), reason: "USER_NOT_FOUND_OR_INACTIVE" },
      });
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    const isValid = await verifyPassword(password, admin.passwordHash);
    if (!isValid) {
      await recordFailedLogin(rateLimitKey);
      await recordAuditLog({
        action: "LOGIN_FAILED",
        adminUserId: admin.id,
        details: { email: admin.email, reason: "INVALID_PASSWORD" },
      });
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    // Reset failed counter on successful authentication
    await recordSuccessfulLogin(rateLimitKey);

    await recordAuditLog({
      action: "LOGIN_SUCCESS",
      adminUserId: admin.id,
      details: { email: admin.email, role: admin.role },
    });

    const token = await createSessionToken({
      id: admin.id,
      email: admin.email,
      role: admin.role,
      tokenVersion: admin.tokenVersion,
      mustChangePassword: admin.mustChangePassword,
    });

    const response = NextResponse.json({
      success: true,
      user: {
        id: admin.id,
        email: admin.email,
        role: admin.role,
        mustChangePassword: admin.mustChangePassword,
      },
    });

    response.cookies.set({
      name: COOKIE_NAME,
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24, // 24 hours
    });

    return response;
  } catch (error) {
    console.error("[Login Error]", error);
    return NextResponse.json(
      { error: "Authentication service error" },
      { status: 500 }
    );
  }
}
