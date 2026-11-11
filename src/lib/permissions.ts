import { prisma } from "./prisma";
import { AdminSession } from "./auth";

export type StaffRole = "SUPER_ADMIN" | "ADMIN" | "EDITOR" | "VIEWER";

export function isSuperAdmin(session: AdminSession): boolean {
  return session.role === "SUPER_ADMIN";
}

export function canUserManageStaff(session: AdminSession): boolean {
  return isSuperAdmin(session);
}

/**
 * Check if the staff member has access to the specified bot.
 * SUPER_ADMIN has global access across all bots.
 * Other roles require explicit StaffBotAssignment.
 */
export async function hasBotAccess(
  session: AdminSession,
  botId: string
): Promise<boolean> {
  if (session.role === "SUPER_ADMIN") {
    return true;
  }

  const assignment = await prisma.staffBotAssignment.findUnique({
    where: {
      userId_botId: {
        userId: session.id,
        botId,
      },
    },
  });

  return Boolean(assignment);
}

/**
 * Check if staff member can mutate resources (create/edit drafts, upload media, update menus).
 * VIEWER cannot mutate.
 * SUPER_ADMIN can mutate any bot.
 * ADMIN & EDITOR can mutate assigned bots.
 */
export async function canUserMutate(
  session: AdminSession,
  botId: string
): Promise<boolean> {
  if (session.role === "VIEWER") {
    return false;
  }

  if (session.role === "SUPER_ADMIN") {
    return true;
  }

  return hasBotAccess(session, botId);
}

/**
 * Check if staff member can publish channel posts or retry buttons.
 * SUPER_ADMIN can publish to any bot/channel.
 * ADMIN can publish to assigned bots.
 * EDITOR can publish ONLY if granted explicit canPublish on their assignment.
 * VIEWER can NEVER publish.
 */
export async function canUserPublish(
  session: AdminSession,
  botId: string
): Promise<boolean> {
  if (session.role === "VIEWER") {
    return false;
  }

  if (session.role === "SUPER_ADMIN") {
    return true;
  }

  const assignment = await prisma.staffBotAssignment.findUnique({
    where: {
      userId_botId: {
        userId: session.id,
        botId,
      },
    },
  });

  if (!assignment) return false;

  if (session.role === "ADMIN") {
    return true;
  }

  if (session.role === "EDITOR") {
    return Boolean(assignment.canPublish);
  }

  return false;
}

/**
 * Check if staff member can access sensitive personal phone numbers.
 * Restricts to SUPER_ADMIN or assigned ADMIN.
 * EDITOR and VIEWER are prevented from accessing subscriber phone numbers.
 */
export async function canUserViewPhoneNumbers(
  session: AdminSession,
  botId: string
): Promise<boolean> {
  if (session.role === "SUPER_ADMIN") {
    return true;
  }

  if (session.role === "ADMIN") {
    return hasBotAccess(session, botId);
  }

  return false;
}

/**
 * Get all bot IDs accessible to the current staff session.
 */
export async function getUserAssignedBotIds(
  session: AdminSession
): Promise<string[]> {
  if (session.role === "SUPER_ADMIN") {
    const allBots = await prisma.bot.findMany({
      select: { id: true },
    });
    return allBots.map((b) => b.id);
  }

  const assignments = await prisma.staffBotAssignment.findMany({
    where: { userId: session.id },
    select: { botId: true },
  });

  return assignments.map((a) => a.botId);
}

/**
 * Prevent deleting or deactivating the last active SUPER_ADMIN account.
 */
export async function canDeleteOrDeactivateAdmin(
  targetAdminId: string
): Promise<{ canProceed: boolean; error?: string }> {
  const target = await prisma.adminUser.findUnique({
    where: { id: targetAdminId },
  });

  if (!target) {
    return { canProceed: false, error: "Staff account not found." };
  }

  if (target.role === "SUPER_ADMIN") {
    const activeSuperAdmins = await prisma.adminUser.count({
      where: {
        role: "SUPER_ADMIN",
        isActive: true,
      },
    });

    if (activeSuperAdmins <= 1) {
      return {
        canProceed: false,
        error:
          "Operation blocked: Cannot delete or deactivate the last active SUPER_ADMIN account.",
      };
    }
  }

  return { canProceed: true };
}
