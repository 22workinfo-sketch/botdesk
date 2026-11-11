import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminSession, hashPassword } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/permissions";
import { verifyRequestOrigin } from "@/lib/rate-limit";
import { recordAuditLog } from "@/lib/audit";

export async function GET(req: NextRequest) {
  try {
    const session = await getAdminSession(req, { checkDb: true });
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isSuperAdmin(session)) {
      return NextResponse.json(
        { error: "Forbidden: Only SUPER_ADMIN can view staff accounts." },
        { status: 403 }
      );
    }

    const staff = await prisma.adminUser.findMany({
      select: {
        id: true,
        email: true,
        role: true,
        isActive: true,
        mustChangePassword: true,
        createdAt: true,
        updatedAt: true,
        staffAssignments: {
          select: {
            id: true,
            botId: true,
            canPublish: true,
            bot: {
              select: {
                id: true,
                name: true,
                username: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    const allBots = await prisma.bot.findMany({
      where: { isActive: true },
      select: { id: true, name: true, username: true },
      orderBy: { name: "asc" },
    });

    return NextResponse.json({ staff, allBots });
  } catch (err: any) {
    console.error("[Staff GET Error]", err);
    return NextResponse.json(
      { error: "Failed to load staff list." },
      { status: 500 }
    );
  }
}

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

    if (!isSuperAdmin(session)) {
      return NextResponse.json(
        { error: "Forbidden: Only SUPER_ADMIN can add staff accounts." },
        { status: 403 }
      );
    }

    const body = await req.json();
    const { email, initialPassword, role, assignedBotIds, canPublish } = body;

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return NextResponse.json(
        { error: "A valid email address is required." },
        { status: 400 }
      );
    }

    if (
      !initialPassword ||
      typeof initialPassword !== "string" ||
      initialPassword.length < 8
    ) {
      return NextResponse.json(
        { error: "Initial password must be at least 8 characters long." },
        { status: 400 }
      );
    }

    const validRoles = ["SUPER_ADMIN", "ADMIN", "EDITOR", "VIEWER"];
    const targetRole = role || "EDITOR";
    if (!validRoles.includes(targetRole)) {
      return NextResponse.json(
        { error: `Invalid role. Allowed roles: ${validRoles.join(", ")}` },
        { status: 400 }
      );
    }

    const normalizedEmail = email.toLowerCase().trim();
    const existing = await prisma.adminUser.findUnique({
      where: { email: normalizedEmail },
    });

    if (existing) {
      return NextResponse.json(
        { error: "An account with this email already exists." },
        { status: 409 }
      );
    }

    const passwordHash = await hashPassword(initialPassword);

    const newStaff = await prisma.$transaction(async (tx) => {
      const created = await tx.adminUser.create({
        data: {
          email: normalizedEmail,
          passwordHash,
          role: targetRole,
          isActive: true,
          mustChangePassword: true,
          tokenVersion: 1,
        },
      });

      if (
        Array.isArray(assignedBotIds) &&
        assignedBotIds.length > 0 &&
        targetRole !== "SUPER_ADMIN"
      ) {
        for (const botId of assignedBotIds) {
          await tx.staffBotAssignment.create({
            data: {
              userId: created.id,
              botId,
              canPublish: targetRole === "ADMIN" ? true : Boolean(canPublish),
            },
          });
        }
      }

      return created;
    });

    await recordAuditLog({
      action: "STAFF_CREATED",
      adminUserId: session.id,
      details: {
        createdUserId: newStaff.id,
        email: newStaff.email,
        role: newStaff.role,
        assignedBotIds: assignedBotIds || [],
        canPublish: Boolean(canPublish),
      },
    });

    return NextResponse.json(
      {
        success: true,
        staff: {
          id: newStaff.id,
          email: newStaff.email,
          role: newStaff.role,
          isActive: newStaff.isActive,
          mustChangePassword: newStaff.mustChangePassword,
        },
      },
      { status: 201 }
    );
  } catch (err: any) {
    console.error("[Staff POST Error]", err);
    return NextResponse.json(
      { error: "Failed to create staff account." },
      { status: 500 }
    );
  }
}
