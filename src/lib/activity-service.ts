import { prisma } from "./prisma";

export interface RecordActivityEventInput {
  botId: string;
  channelId?: string | null;
  telegramChatId: string;
  channelTitle?: string | null;
  telegramUserId: bigint | number | string;
  userFirstName?: string | null;
  userLastName?: string | null;
  username?: string | null;
  actorUserId?: bigint | number | string | null;
  actorUsername?: string | null;
  eventType: "JOINED" | "LEFT" | "MEMBERSHIP_CHECK" | "CHANNEL_SELECTED";
  status?: string | null;
  source: "TELEGRAM_UPDATE" | "FLOW_CHECK" | "FLOW_SELECTION" | "MANUAL_CHECK";
  updateId?: bigint | number | string | null;
  details?: Record<string, any> | null;
}

export interface ActivityFilterOptions {
  botIds?: string[];
  channelId?: string;
  eventType?: string;
  search?: string;
  dateRange?: "all" | "today" | "7d" | "30d";
  page?: number;
  limit?: number;
}

export interface SerializedActivityEvent {
  id: string;
  botId: string;
  botName?: string;
  botUsername?: string;
  channelId: string | null;
  channelName: string | null;
  telegramChatId: string;
  channelTitle: string | null;
  telegramUserId: string;
  userDisplayName: string;
  username: string | null;
  actorUserId: string | null;
  actorUsername: string | null;
  isActorDifferent: boolean;
  eventType: string;
  status: string | null;
  source: string;
  updateId: string | null;
  details: any;
  createdAt: string;
}

/**
 * Records a channel activity event with updateId deduplication.
 * Sanitizes input to protect user privacy (never logs phone numbers).
 */
export async function recordChannelActivityEvent(
  input: RecordActivityEventInput
): Promise<boolean> {
  try {
    const rawUpdateId = input.updateId != null ? BigInt(input.updateId) : null;

    // Idempotent deduplication if updateId is provided
    if (rawUpdateId != null) {
      const existing = await prisma.channelActivityEvent.findFirst({
        where: {
          botId: input.botId,
          updateId: rawUpdateId,
        },
        select: { id: true },
      });
      if (existing) {
        return false; // Already recorded
      }
    }

    // Try linking to registered BotChannel if channelId not supplied
    let resolvedChannelId = input.channelId || null;
    let resolvedChannelTitle = input.channelTitle || null;

    if (!resolvedChannelId && input.telegramChatId) {
      const match = await prisma.botChannel.findFirst({
        where: {
          botId: input.botId,
          telegramChatId: input.telegramChatId,
        },
        select: { id: true, name: true },
      });
      if (match) {
        resolvedChannelId = match.id;
        if (!resolvedChannelTitle) {
          resolvedChannelTitle = match.name;
        }
      }
    }

    // Sanitize details: strip any accidental phone numbers or credentials
    let sanitizedDetails: any = null;
    if (input.details && typeof input.details === "object") {
      const copy = { ...input.details };
      delete copy.phone_number;
      delete copy.phoneNumber;
      delete copy.token;
      delete copy.password;
      sanitizedDetails = copy;
    }

    await prisma.channelActivityEvent.create({
      data: {
        botId: input.botId,
        channelId: resolvedChannelId,
        telegramChatId: input.telegramChatId,
        channelTitle: resolvedChannelTitle,
        telegramUserId: BigInt(input.telegramUserId),
        userFirstName: input.userFirstName || null,
        userLastName: input.userLastName || null,
        username: input.username || null,
        actorUserId: input.actorUserId != null ? BigInt(input.actorUserId) : null,
        actorUsername: input.actorUsername || null,
        eventType: input.eventType,
        status: input.status || null,
        source: input.source,
        updateId: rawUpdateId,
        details: sanitizedDetails,
      },
    });

    return true;
  } catch (err: any) {
    // Unique constraint violation on [botId, updateId] is safely ignored
    if (err?.code === "P2002") {
      return false;
    }
    console.error("[ActivityService] Error recording channel activity event:", err);
    return false;
  }
}

/**
 * Queries channel activity events with filters, search, pagination, and multi-bot RBAC scoping.
 */
export async function getChannelActivityEvents(options: ActivityFilterOptions): Promise<{
  events: SerializedActivityEvent[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> {
  const page = Math.max(1, options.page || 1);
  const limit = Math.min(100, Math.max(1, options.limit || 20));
  const skip = (page - 1) * limit;

  const whereClause: any = {};

  // Scoped bots (for staff permissions)
  if (options.botIds && options.botIds.length > 0) {
    whereClause.botId = { in: options.botIds };
  }

  // Channel filter
  if (options.channelId && options.channelId !== "all") {
    whereClause.channelId = options.channelId;
  }

  // Event type filter
  if (options.eventType && options.eventType !== "all") {
    whereClause.eventType = options.eventType;
  }

  // Date range filter
  if (options.dateRange && options.dateRange !== "all") {
    const now = new Date();
    if (options.dateRange === "today") {
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      whereClause.createdAt = { gte: startOfDay };
    } else if (options.dateRange === "7d") {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      whereClause.createdAt = { gte: sevenDaysAgo };
    } else if (options.dateRange === "30d") {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      whereClause.createdAt = { gte: thirtyDaysAgo };
    }
  }

  // Search filter (display name, username, telegram user ID)
  if (options.search && options.search.trim()) {
    const term = options.search.trim();
    const isNum = /^\d+$/.test(term);
    const searchConditions: any[] = [
      { username: { contains: term, mode: "insensitive" } },
      { userFirstName: { contains: term, mode: "insensitive" } },
      { userLastName: { contains: term, mode: "insensitive" } },
      { channelTitle: { contains: term, mode: "insensitive" } },
    ];
    if (isNum) {
      try {
        searchConditions.push({ telegramUserId: BigInt(term) });
      } catch {}
    }
    whereClause.OR = searchConditions;
  }

  const [total, rawEvents] = await Promise.all([
    prisma.channelActivityEvent.count({ where: whereClause }),
    prisma.channelActivityEvent.findMany({
      where: whereClause,
      include: {
        bot: { select: { id: true, name: true, username: true } },
        channel: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
  ]);

  const events: SerializedActivityEvent[] = rawEvents.map((evt) => {
    const firstName = evt.userFirstName || "";
    const lastName = evt.userLastName || "";
    const fullName = `${firstName} ${lastName}`.trim();
    const userDisplayName = fullName || (evt.username ? `@${evt.username}` : `User ${evt.telegramUserId}`);

    const isActorDifferent =
      evt.actorUserId != null &&
      evt.actorUserId.toString() !== evt.telegramUserId.toString();

    return {
      id: evt.id,
      botId: evt.botId,
      botName: evt.bot.name,
      botUsername: evt.bot.username,
      channelId: evt.channelId,
      channelName: evt.channel?.name || null,
      telegramChatId: evt.telegramChatId,
      channelTitle: evt.channelTitle,
      telegramUserId: evt.telegramUserId.toString(),
      userDisplayName,
      username: evt.username,
      actorUserId: evt.actorUserId ? evt.actorUserId.toString() : null,
      actorUsername: evt.actorUsername,
      isActorDifferent,
      eventType: evt.eventType,
      status: evt.status,
      source: evt.source,
      updateId: evt.updateId ? evt.updateId.toString() : null,
      details: evt.details,
      createdAt: evt.createdAt.toISOString(),
    };
  });

  return {
    events,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
  };
}

/**
 * Retention cleanup: deletes events older than the specified number of days.
 */
export async function cleanupOldActivityEvents(retentionDays = 90): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const result = await prisma.channelActivityEvent.deleteMany({
    where: {
      createdAt: { lt: cutoff },
    },
  });
  return result.count;
}
