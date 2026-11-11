import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserAssignedBotIds } from "@/lib/permissions";
import { BotdeskLayout } from "@/components/BotdeskLayout";
import {
  getMarketingOverviewMetrics,
  getAudienceList,
  getMarketingCampaigns,
} from "@/lib/marketing-service";
import {
  MarketingDashboard,
  BotOption,
  ChannelOption,
} from "@/components/marketing/MarketingDashboard";

export default async function MarketingPage() {
  const session = await getAdminSession();
  if (!session) {
    redirect("/login");
  }

  if (session.mustChangePassword) {
    redirect("/login?changePassword=true");
  }

  const assignedIds = await getUserAssignedBotIds(session);

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

  // 3. Initial Metrics
  const initialMetrics = await getMarketingOverviewMetrics({
    botIds: assignedIds,
    dateRange: "all",
  });

  // 4. Initial Audience
  const audienceData = await getAudienceList({
    botIds: assignedIds,
    page: 1,
    limit: 20,
  });

  // 5. Initial Campaigns
  const initialCampaigns = await getMarketingCampaigns(assignedIds);

  return (
    <BotdeskLayout
      userEmail={session.email}
      role={session.role}
      activeNav="marketing"
      breadcrumb="Marketing Intelligence"
    >
      <MarketingDashboard
        bots={bots}
        channels={channels}
        initialMetrics={initialMetrics}
        initialAudience={audienceData.audience}
        initialAudienceTotal={audienceData.total}
        initialAudiencePages={audienceData.totalPages}
        initialCampaigns={initialCampaigns}
        userRole={session.role}
      />
    </BotdeskLayout>
  );
}
