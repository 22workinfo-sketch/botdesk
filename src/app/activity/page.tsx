import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserAssignedBotIds } from "@/lib/permissions";
import { BotdeskLayout } from "@/components/BotdeskLayout";
import { getChannelActivityEvents } from "@/lib/activity-service";
import {
  ChannelActivityPage,
  BotOption,
  ChannelOption,
  AuditLogItem,
} from "@/components/ChannelActivityPage";

export default async function ActivityPage() {
  const session = await getAdminSession();
  if (!session) {
    redirect("/login");
  }

  if (session.mustChangePassword) {
    redirect("/login?changePassword=true");
  }

  const assignedIds = await getUserAssignedBotIds(session);
  const isSuper = session.role === "SUPER_ADMIN";

  // 1. Fetch bots assigned to this user
  const botsData = await prisma.bot.findMany({
    where: { id: { in: assignedIds }, isActive: true },
    select: { id: true, name: true, username: true },
    orderBy: { name: "asc" },
  });

  const bots: BotOption[] = botsData.map((b) => ({
    id: b.id,
    name: b.name,
    username: b.username,
  }));

  // 2. Fetch channels associated with assigned bots
  const channelsData = await prisma.botChannel.findMany({
    where: { botId: { in: assignedIds }, isEnabled: true },
    select: { id: true, botId: true, name: true, telegramChatId: true },
    orderBy: { name: "asc" },
  });

  const channels: ChannelOption[] = channelsData.map((ch) => ({
    id: ch.id,
    botId: ch.botId,
    name: ch.name,
    telegramChatId: ch.telegramChatId,
  }));

  // 3. Initial Channel Activity Events
  const activityData = await getChannelActivityEvents({
    botIds: assignedIds,
    page: 1,
    limit: 20,
  });

  // 4. Fetch administrative audit logs for secondary tab
  const rawAuditLogs = await prisma.auditLog.findMany({
    where: isSuper
      ? undefined
      : {
          OR: [
            { botId: { in: assignedIds } },
            { adminUserId: session.id },
          ],
        },
    take: 50,
    orderBy: { createdAt: "desc" },
    include: {
      bot: { select: { name: true, username: true } },
      adminUser: { select: { email: true } },
    },
  });

  const auditLogs: AuditLogItem[] = rawAuditLogs.map((log) => ({
    id: log.id,
    action: log.action,
    botName: log.bot?.name || null,
    botUsername: log.bot?.username || null,
    adminEmail: log.adminUser?.email || null,
    createdAt: log.createdAt.toISOString(),
    details: log.details,
  }));

  return (
    <BotdeskLayout
      userEmail={session.email}
      role={session.role}
      activeNav="activity"
      breadcrumb="Channel Activity"
    >
      <ChannelActivityPage
        bots={bots}
        channels={channels}
        initialEvents={activityData.events}
        initialTotal={activityData.total}
        initialTotalPages={activityData.totalPages}
        auditLogs={auditLogs}
        userRole={session.role}
      />
    </BotdeskLayout>
  );
}
