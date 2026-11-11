import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth";
import { getAllBots, getBotUsers } from "@/lib/bot-service";
import { getUserAssignedBotIds, canUserViewPhoneNumbers } from "@/lib/permissions";
import { BotdeskLayout } from "@/components/BotdeskLayout";
import { BotdeskDashboard, BotData, TelegramUserData } from "@/components/BotdeskDashboard";

export default async function DashboardPage() {
  const session = await getAdminSession();
  if (!session) {
    redirect("/login");
  }

  if (session.mustChangePassword) {
    redirect("/login?changePassword=true");
  }

  // Filter bots strictly to assigned resources
  const assignedBotIds = await getUserAssignedBotIds(session);
  const allBots = await getAllBots();
  const rawBots = allBots.filter((b) => assignedBotIds.includes(b.id));

  // Prepare users for each assigned bot strictly isolated
  const usersByBot: Record<string, TelegramUserData[]> = {};
  for (const bot of rawBots) {
    const rawUsers = await getBotUsers(bot.id);
    const allowPhone = await canUserViewPhoneNumbers(session, bot.id);

    usersByBot[bot.id] = rawUsers.map((u) => ({
      id: u.id,
      telegramId: u.telegramId.toString(),
      firstName: u.firstName,
      lastName: u.lastName,
      username: u.username,
      telegramPhNo: allowPhone ? u.telegramPhNo : u.telegramPhNo ? "[REDACTED]" : null,
      firstSeenAt: u.firstSeenAt.toISOString(),
      lastSeenAt: u.lastSeenAt.toISOString(),
    }));
  }

  const botsData: BotData[] = rawBots.map((b) => ({
    id: b.id,
    name: b.name,
    username: b.username,
    telegramBotId: b.telegramBotId != null ? b.telegramBotId.toString() : null,
    isActive: b.isActive,
    tokenEnvVar: b.tokenEnvVar,
    hasStoredToken: Boolean(b.encryptedToken),
    tokenLast4: b.tokenLast4 || (b.encryptedToken ? "••••" : null),
    description: b.description ?? null,
    connectionStatus: b.connectionStatus || (b.isActive ? "STANDBY" : "DISCONNECTED"),
    lastError: b.lastError ?? null,
    lastCheckedAt: b.lastCheckedAt ? b.lastCheckedAt.toISOString() : null,
    createdAt: b.createdAt.toISOString(),
    config: b.config
      ? {
          welcomeMessage: b.config.welcomeMessage,
        }
      : null,
    _count: {
      users: b._count.users,
    },
  }));

  return (
    <BotdeskLayout
      userEmail={session.email}
      role={session.role}
      activeNav="bots"
      breadcrumb="Bots"
    >
      <BotdeskDashboard
        bots={botsData}
        initialUsersByBot={usersByBot}
        isSuperAdmin={session.role === "SUPER_ADMIN"}
      />
    </BotdeskLayout>
  );
}
