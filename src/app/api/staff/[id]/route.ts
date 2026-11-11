import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminSession, hashPassword } from "@/lib/auth";
import { isSuperAdmin, canDeleteOrDeactivateAdmin } from "@/lib/permissions";
import { verifyRequestOrigin } from "@/lib/rate-limit";
import { recordAuditLog } from "@/lib/audit";

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
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
        { error: "Forbidden: Only SUPER_ADMIN can update staff accounts." },
        { status: 403 }
      );
    }

    const { id } = await Promise.resolve(params);
    const body = await req.json();
    const { role, isActive, assignedBotIds, canPublish, resetPassword } = body;

    const targetUser = await prisma.adminUser.findUnique({
      where: { id },
    });

    if (!targetUser) {
      return NextResponse.json({ error: "Staff account not found." }, { status: 404 });
    }

    // Protection check if deactivating or changing role of SUPER_ADMIN
    if (
      (isActive === false && targetUser.isActive) ||
      (role && role !== "SUPER_ADMIN" && targetUser.role === "SUPER_ADMIN")
    ) {
      const guard = await canDeleteOrDeactivateAdmin(id);
      if (!guard.canProceed) {
        return NextResponse.json({ error: guard.error }, { status: 400 });
      }
    }

    const updateData: any = {};
    let shouldIncrementToken = false;

    if (typeof isActive === "boolean") {
      updateData.isActive = isActive;
      if (isActive !== targetUser.isActive) shouldIncrementToken = true;
    }

    if (role && ["SUPER_ADMIN", "ADMIN", "EDITOR", "VIEWER"].includes(role)) {
      updateData.role = role;
      if (role !== targetUser.role) shouldIncrementToken = true;
    }

    if (resetPassword && typeof resetPassword === "string" && resetPassword.length >= 8) {
      updateData.passwordHash = await hashPassword(resetPassword);
      updateData.mustChangePassword = true;
      shouldIncrementToken = true;
    }

    if (shouldIncrementToken) {
      updateData.tokenVersion = targetUser.tokenVersion + 1;
    }

    await prisma.$transaction(async (tx) => {
      if (Object.keys(updateData).length > 0) {
        await tx.adminUser.update({
          where: { id },
          data: updateData,
        });
      }

      // Update bot assignments if provided
      if (Array.isArray(assignedBotIds)) {
        await tx.staffBotAssignment.deleteMany({
          where: { userId: id },
        });

        const effectiveRole = role || targetUser.role;
        if (effectiveRole !== "SUPER_ADMIN") {
          for (const botId of assignedBotIds) {
            await tx.staffBotAssignment.create({
              data: {
                userId: id,
                botId,
                canPublish: effectiveRole === "ADMIN" ? true : Boolean(canPublish),
              },
            });
          }
        }
      }
    });

    await recordAuditLog({
      action: "STAFF_UPDATED",
      adminUserId: session.id,
      details: {
        targetUserId: id,
        changes: {
          role,
          isActive,
          assignedBotIds,
          canPublish,
          passwordReset: Boolean(resetPassword),
        },
      },
    });

    return NextResponse.json({
      success: true,
      message: "Staff account updated successfully.",
    });
  } catch (err: any) {
    console.error("[Staff PUT Error]", err);
    return NextResponse.json(
      { error: "Failed to update staff account." },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
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
        { error: "Forbidden: Only SUPER_ADMIN can delete staff accounts." },
        { status: 403 }
      );
    }

    const { id } = await Promise.resolve(params);

    if (id === session.id) {
      return NextResponse.json(
        { error: "You cannot delete your own active administrator account." },
        { status: 400 }
      );
    }

    const guard = await canDeleteOrDeactivateAdmin(id);
    if (!guard.canProceed) {
      return NextResponse.json({ error: guard.error }, { status: 400 });
    }

    const targetUser = await prisma.adminUser.findUnique({
      where: { id },
      select: { id: true, email: true, role: true },
    });

    if (!targetUser) {
      return NextResponse.json({ error: "Staff account not found." }, { status: 404 });
    }

    await prisma.adminUser.delete({
      where: { id },
    });

    await recordAuditLog({
      action: "STAFF_DELETED",
      adminUserId: session.id,
      details: {
        deletedUserId: targetUser.id,
        email: targetUser.email,
        role: targetUser.role,
      },
    });

    return NextResponse.json({
      success: true,
      message: `Staff account ${targetUser.email} deleted successfully.`,
    });
  } catch (err: any) {
    console.error("[Staff DELETE Error]", err);
    return NextResponse.json(
      { error: "Failed to delete staff account." },
      { status: 500 }
    );
  }
}
