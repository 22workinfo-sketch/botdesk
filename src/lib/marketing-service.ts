import { prisma } from "./prisma";
import { Prisma } from "@prisma/client";

export interface CreateCampaignInput {
  botId: string;
  name: string;
  slug: string;
  description?: string | null;
  targetChannelId?: string | null;
  createdById?: string | null;
}

export interface RecordCampaignTouchInput {
  botId: string;
  slug: string;
  telegramUserId: bigint | number | string;
  isNewUser?: boolean;
}

export interface RecordConsentInput {
  botId: string;
  telegramUserId: bigint | number | string;
  consentStatus: "OPTED_IN" | "OPTED_OUT" | "REVOKED";
  source: string;
  purpose?: string;
  details?: Record<string, any> | null;
}

export interface MarketingMetricsFilter {
  botIds: string[];
  channelId?: string;
  dateRange?: "all" | "today" | "7d" | "30d";
}

export interface AudienceFilterOptions {
  botIds: string[];
  channelId?: string;
  observedStatus?: "all" | "joined" | "left" | "unknown";
  dateRange?: "all" | "today" | "7d" | "30d";
  consentStatus?: "all" | "OPTED_IN" | "OPTED_OUT" | "REVOKED" | "UNSPECIFIED";
  campaignSource?: string;
  search?: string;
  page?: number;
  limit?: number;
}

/**
 * Validates campaign slug format (safe URL path parameter, alphanumeric, hyphens, underscores).
 */
export function validateCampaignSlug(slug: string): string {
  const clean = (slug || "").trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,32}$/.test(clean)) {
    throw new Error(
      "Campaign slug must be 2 to 32 characters, using only lowercase letters, numbers, hyphens, or underscores."
    );
  }
  return clean;
}

/**
 * Creates a new marketing campaign for a bot.
 */
export async function createMarketingCampaign(input: CreateCampaignInput) {
  const cleanSlug = validateCampaignSlug(input.slug);

  // Check if bot exists
  const bot = await prisma.bot.findUnique({
    where: { id: input.botId },
    select: { id: true, username: true },
  });
  if (!bot) {
    throw new Error(`Bot with ID ${input.botId} not found.`);
  }

  // Check duplicate slug for this bot
  const existing = await prisma.marketingCampaign.findUnique({
    where: {
      botId_slug: {
        botId: input.botId,
        slug: cleanSlug,
      },
    },
  });
  if (existing) {
    throw new Error(`A campaign with slug "${cleanSlug}" already exists for this bot.`);
  }

  const campaign = await prisma.marketingCampaign.create({
    data: {
      botId: input.botId,
      name: input.name.trim(),
      slug: cleanSlug,
      description: input.description?.trim() || null,
      targetChannelId: input.targetChannelId || null,
      createdById: input.createdById || null,
    },
    include: {
      bot: { select: { name: true, username: true } },
      targetChannel: { select: { id: true, name: true, telegramChatId: true } },
    },
  });

  const deepLink = `https://t.me/${bot.username}?start=c_${cleanSlug}`;

  return {
    ...campaign,
    deepLink,
  };
}

/**
 * Retrieves all marketing campaigns for given bots.
 */
export async function getMarketingCampaigns(botIds: string[]) {
  const campaigns = await prisma.marketingCampaign.findMany({
    where: {
      botId: { in: botIds },
    },
    include: {
      bot: { select: { id: true, name: true, username: true } },
      targetChannel: { select: { id: true, name: true, telegramChatId: true } },
      _count: {
        select: { touches: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return campaigns.map((c) => ({
    id: c.id,
    botId: c.botId,
    botName: c.bot.name,
    botUsername: c.bot.username,
    name: c.name,
    slug: c.slug,
    description: c.description,
    deepLink: `https://t.me/${c.bot.username}?start=c_${c.slug}`,
    targetChannelId: c.targetChannelId,
    targetChannelName: c.targetChannel?.name || null,
    clicksCount: c.clicksCount,
    uniqueStartsCount: c.uniqueStartsCount,
    totalTouches: c._count.touches,
    isActive: c.isActive,
    createdAt: c.createdAt.toISOString(),
  }));
}

/**
 * Records a campaign touch when a user starts a bot via `?start=c_<slug>`.
 * Follows documented First-Touch & Return-Touch attribution rules.
 */
export async function recordCampaignTouch(input: RecordCampaignTouchInput): Promise<{
  attributed: boolean;
  campaignName?: string;
  isNewUser: boolean;
}> {
  try {
    const cleanSlug = (input.slug || "").trim().toLowerCase();
    const tgUserId = BigInt(input.telegramUserId);

    const campaign = await prisma.marketingCampaign.findUnique({
      where: {
        botId_slug: {
          botId: input.botId,
          slug: cleanSlug,
        },
      },
    });

    if (!campaign || !campaign.isActive) {
      return { attributed: false, isNewUser: false };
    }

    // Determine if this user is new to the bot, ensuring user row exists
    let existingUser = await prisma.telegramUser.findUnique({
      where: {
        botId_telegramId: {
          botId: input.botId,
          telegramId: tgUserId,
        },
      },
      select: { id: true, firstCampaignSource: true },
    });

    const isNewUser = input.isNewUser ?? !existingUser;

    if (!existingUser) {
      existingUser = await prisma.telegramUser.create({
        data: {
          botId: input.botId,
          telegramId: tgUserId,
          firstCampaignSource: cleanSlug,
          lastCampaignSource: cleanSlug,
        },
        select: { id: true, firstCampaignSource: true },
      });
    } else {
      await prisma.telegramUser.update({
        where: { id: existingUser.id },
        data: {
          firstCampaignSource: existingUser.firstCampaignSource || cleanSlug,
          lastCampaignSource: cleanSlug,
        },
      });
    }

    // Check if user has already touched this specific campaign before
    const priorTouch = await prisma.campaignTouch.findFirst({
      where: {
        campaignId: campaign.id,
        telegramUserId: tgUserId,
      },
      select: { id: true },
    });

    // Increment counters on the campaign
    await prisma.marketingCampaign.update({
      where: { id: campaign.id },
      data: {
        clicksCount: { increment: 1 },
        uniqueStartsCount: priorTouch ? undefined : { increment: 1 },
      },
    });

    // Record touch in ledger
    await prisma.campaignTouch.create({
      data: {
        campaignId: campaign.id,
        botId: input.botId,
        telegramUserId: tgUserId,
        isNewUser,
        touchType: isNewUser ? "FIRST_TOUCH" : "RETURN_TOUCH",
      },
    });

    return {
      attributed: true,
      campaignName: campaign.name,
      isNewUser,
    };
  } catch (err) {
    console.error("[MarketingService] Error recording campaign touch:", err);
    return { attributed: false, isNewUser: false };
  }
}

/**
 * Records or updates marketing consent for a Telegram user.
 * Default is UNSPECIFIED.
 */
export async function recordMarketingConsent(input: RecordConsentInput): Promise<boolean> {
  try {
    const tgUserId = BigInt(input.telegramUserId);

    // 1. Ensure TelegramUser exists and update marketing consent
    await prisma.telegramUser.upsert({
      where: {
        botId_telegramId: {
          botId: input.botId,
          telegramId: tgUserId,
        },
      },
      update: {
        marketingConsent: input.consentStatus,
        marketingConsentAt: new Date(),
        marketingConsentSource: input.source,
      },
      create: {
        botId: input.botId,
        telegramId: tgUserId,
        marketingConsent: input.consentStatus,
        marketingConsentAt: new Date(),
        marketingConsentSource: input.source,
      },
    });

    // 2. Record immutable consent history in ledger
    await prisma.marketingConsentRecord.create({
      data: {
        botId: input.botId,
        telegramUserId: tgUserId,
        consentStatus: input.consentStatus,
        purpose: input.purpose || "GENERAL_MARKETING",
        source: input.source,
        details: input.details ? (input.details as any) : Prisma.DbNull,
      },
    });

    return true;
  } catch (err) {
    console.error("[MarketingService] Error updating marketing consent:", err);
    return false;
  }
}

/**
 * Calculates Marketing Overview Dashboard Metrics with strict definitions and honest caveats.
 */
export async function getMarketingOverviewMetrics(filter: MarketingMetricsFilter) {
  const { botIds, channelId, dateRange = "all" } = filter;

  if (!botIds || botIds.length === 0) {
    return {
      newBotUsers: 0,
      observedJoins: 0,
      observedLeaves: 0,
      netObservedJoins: 0,
      uniqueChannelSelectors: 0,
      uniqueMembershipConfirmed: 0,
      marketingConsent: { optedIn: 0, optedOut: 0, unspecified: 0 },
      trackingStartDate: null,
      growthTrend: [],
      dataCompletenessNote: "No active bots assigned.",
    };
  }

  // Calculate Date Cutoff
  let dateCutoff: Date | undefined = undefined;
  const now = new Date();
  if (dateRange === "today") {
    dateCutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  } else if (dateRange === "7d") {
    dateCutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else if (dateRange === "30d") {
    dateCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }

  // Find tracking start date (earliest observed event or bot user in this scope)
  const [earliestEvent, earliestUser] = await Promise.all([
    prisma.channelActivityEvent.findFirst({
      where: { botId: { in: botIds } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    prisma.telegramUser.findFirst({
      where: { botId: { in: botIds } },
      orderBy: { firstSeenAt: "asc" },
      select: { firstSeenAt: true },
    }),
  ]);

  let trackingStartDate: string | null = null;
  if (earliestEvent?.createdAt && earliestUser?.firstSeenAt) {
    trackingStartDate =
      earliestEvent.createdAt < earliestUser.firstSeenAt
        ? earliestEvent.createdAt.toISOString()
        : earliestUser.firstSeenAt.toISOString();
  } else if (earliestEvent?.createdAt) {
    trackingStartDate = earliestEvent.createdAt.toISOString();
  } else if (earliestUser?.firstSeenAt) {
    trackingStartDate = earliestUser.firstSeenAt.toISOString();
  }

  // 1. New Bot Users (in date range)
  const userWhere: any = { botId: { in: botIds } };
  if (dateCutoff) {
    userWhere.firstSeenAt = { gte: dateCutoff };
  }
  const newBotUsers = await prisma.telegramUser.count({ where: userWhere });

  // 2. Channel Activity Base Filter
  const eventWhereBase: any = {
    botId: { in: botIds },
  };
  if (channelId && channelId !== "all") {
    eventWhereBase.channelId = channelId;
  }
  if (dateCutoff) {
    eventWhereBase.createdAt = { gte: dateCutoff };
  }

  // Observed Joins & Leaves
  const [observedJoins, observedLeaves] = await Promise.all([
    prisma.channelActivityEvent.count({
      where: { ...eventWhereBase, eventType: "JOINED" },
    }),
    prisma.channelActivityEvent.count({
      where: { ...eventWhereBase, eventType: "LEFT" },
    }),
  ]);

  const netObservedJoins = observedJoins - observedLeaves;

  // 3. Unique Users Who Selected a Channel
  const uniqueSelectorsRaw = await prisma.channelActivityEvent.findMany({
    where: { ...eventWhereBase, eventType: "CHANNEL_SELECTED" },
    select: { telegramUserId: true },
    distinct: ["telegramUserId"],
  });
  const uniqueChannelSelectors = uniqueSelectorsRaw.length;

  // 4. Unique Users Whose Membership Was Confirmed
  const uniqueConfirmedRaw = await prisma.channelActivityEvent.findMany({
    where: {
      ...eventWhereBase,
      eventType: "MEMBERSHIP_CHECK",
      status: "joined",
    },
    select: { telegramUserId: true },
    distinct: ["telegramUserId"],
  });
  const uniqueMembershipConfirmed = uniqueConfirmedRaw.length;

  // 5. Marketing Consent Breakdown across all users in scoped bots
  const [consentOptedIn, consentOptedOut, consentUnspecified] = await Promise.all([
    prisma.telegramUser.count({
      where: { botId: { in: botIds }, marketingConsent: "OPTED_IN" },
    }),
    prisma.telegramUser.count({
      where: {
        botId: { in: botIds },
        marketingConsent: { in: ["OPTED_OUT", "REVOKED"] },
      },
    }),
    prisma.telegramUser.count({
      where: { botId: { in: botIds }, marketingConsent: "UNSPECIFIED" },
    }),
  ]);

  // 6. Growth Trend Series (daily join vs leave count over the last 14 days or chosen period)
  const trendDays = dateRange === "today" ? 1 : dateRange === "7d" ? 7 : 14;
  const trendStart = new Date(now.getTime() - trendDays * 24 * 60 * 60 * 1000);

  const trendEvents = await prisma.channelActivityEvent.findMany({
    where: {
      botId: { in: botIds },
      channelId: channelId && channelId !== "all" ? channelId : undefined,
      eventType: { in: ["JOINED", "LEFT"] },
      createdAt: { gte: trendStart },
    },
    select: {
      eventType: true,
      createdAt: true,
    },
  });

  const dailyMap: Record<string, { date: string; joins: number; leaves: number }> = {};
  for (let d = 0; d <= trendDays; d++) {
    const day = new Date(trendStart.getTime() + d * 24 * 60 * 60 * 1000);
    const key = day.toISOString().split("T")[0];
    dailyMap[key] = { date: key, joins: 0, leaves: 0 };
  }

  for (const evt of trendEvents) {
    const key = evt.createdAt.toISOString().split("T")[0];
    if (dailyMap[key]) {
      if (evt.eventType === "JOINED") dailyMap[key].joins++;
      if (evt.eventType === "LEFT") dailyMap[key].leaves++;
    }
  }

  const growthTrend = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

  return {
    newBotUsers,
    observedJoins,
    observedLeaves,
    netObservedJoins,
    uniqueChannelSelectors,
    uniqueMembershipConfirmed,
    marketingConsent: {
      optedIn: consentOptedIn,
      optedOut: consentOptedOut,
      unspecified: consentUnspecified,
    },
    trackingStartDate,
    growthTrend,
    dataCompletenessNote:
      "All metrics represent events observed since bot installation. Pre-existing channel members or unmanaged channels are not included in observed joins.",
  };
}

/**
 * Retrieves the authorized Audience list with multi-bot isolation,
 * consent status, channel tags, campaign attribution, and pagination.
 */
export async function getAudienceList(options: AudienceFilterOptions) {
  const page = Math.max(1, options.page || 1);
  const limit = Math.min(100, Math.max(1, options.limit || 20));
  const skip = (page - 1) * limit;

  const whereClause: any = {
    botId: { in: options.botIds },
  };

  // Filter by Marketing Consent
  if (options.consentStatus && options.consentStatus !== "all") {
    whereClause.marketingConsent = options.consentStatus;
  }

  // Filter by Campaign Source
  if (options.campaignSource && options.campaignSource !== "all") {
    whereClause.OR = [
      { firstCampaignSource: options.campaignSource },
      { lastCampaignSource: options.campaignSource },
    ];
  }

  // Filter by Date Range (First Seen)
  if (options.dateRange && options.dateRange !== "all") {
    const now = new Date();
    if (options.dateRange === "today") {
      whereClause.firstSeenAt = {
        gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
      };
    } else if (options.dateRange === "7d") {
      whereClause.firstSeenAt = {
        gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      };
    } else if (options.dateRange === "30d") {
      whereClause.firstSeenAt = {
        gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      };
    }
  }

  // Search filter
  if (options.search && options.search.trim()) {
    const term = options.search.trim();
    const isNum = /^\d+$/.test(term);
    const searchConditions: any[] = [
      { username: { contains: term, mode: "insensitive" } },
      { firstName: { contains: term, mode: "insensitive" } },
      { lastName: { contains: term, mode: "insensitive" } },
    ];
    if (isNum) {
      try {
        searchConditions.push({ telegramId: BigInt(term) });
      } catch {}
    }
    whereClause.AND = [{ OR: searchConditions }];
  }

  // If filtering by channelId, find users who interacted with that channel
  if (options.channelId && options.channelId !== "all") {
    const userIdsInChannel = await prisma.channelActivityEvent.findMany({
      where: {
        botId: { in: options.botIds },
        channelId: options.channelId,
      },
      select: { telegramUserId: true },
      distinct: ["telegramUserId"],
    });

    const ids = userIdsInChannel.map((u) => u.telegramUserId);
    whereClause.telegramId = { in: ids };
  }

  const [total, users] = await Promise.all([
    prisma.telegramUser.count({ where: whereClause }),
    prisma.telegramUser.findMany({
      where: whereClause,
      include: {
        bot: { select: { id: true, name: true, username: true } },
      },
      orderBy: { lastSeenAt: "desc" },
      skip,
      take: limit,
    }),
  ]);

  // For each user, look up their latest observed channel status across channels
  const userTelegramIds = users.map((u) => u.telegramId);

  const channelEvents = await prisma.channelActivityEvent.findMany({
    where: {
      botId: { in: options.botIds },
      telegramUserId: { in: userTelegramIds },
    },
    include: {
      channel: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // Map latest status per (userId, channel)
  const channelStatusMap = new Map<string, Array<{
    channelId: string | null;
    channelName: string;
    latestStatus: string;
    lastObservedAt: string;
  }>>();

  for (const evt of channelEvents) {
    const userKey = `${evt.botId}_${evt.telegramUserId.toString()}`;
    const channelKey = evt.channelId || evt.telegramChatId;
    const chName = evt.channel?.name || evt.channelTitle || "Channel";

    const currentList = channelStatusMap.get(userKey) || [];
    // Only record the latest event for each unique channel
    if (!currentList.some((c) => (c.channelId || c.channelName) === (evt.channelId || chName))) {
      currentList.push({
        channelId: evt.channelId,
        channelName: chName,
        latestStatus: evt.status || (evt.eventType === "JOINED" ? "member" : evt.eventType === "LEFT" ? "left" : "observed"),
        lastObservedAt: evt.createdAt.toISOString(),
      });
      channelStatusMap.set(userKey, currentList);
    }
  }

  const audience = users.map((u) => {
    const userKey = `${u.botId}_${u.telegramId.toString()}`;
    const channels = channelStatusMap.get(userKey) || [];

    const fullName = `${u.firstName || ""} ${u.lastName || ""}`.trim();
    const displayName = fullName || (u.username ? `@${u.username}` : `User ${u.telegramId}`);

    return {
      id: u.id,
      botId: u.botId,
      botName: u.bot.name,
      botUsername: u.bot.username,
      telegramId: u.telegramId.toString(),
      displayName,
      username: u.username,
      firstSeenAt: u.firstSeenAt.toISOString(),
      lastSeenAt: u.lastSeenAt.toISOString(),
      marketingConsent: u.marketingConsent,
      marketingConsentAt: u.marketingConsentAt?.toISOString() || null,
      marketingConsentSource: u.marketingConsentSource,
      firstCampaignSource: u.firstCampaignSource,
      lastCampaignSource: u.lastCampaignSource,
      associatedChannels: channels,
    };
  });

  return {
    audience,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
  };
}
