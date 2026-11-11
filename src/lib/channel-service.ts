import { prisma } from "./prisma";
import { recordChannelActivityEvent } from "./activity-service";

export interface ChannelInput {
  id?: string;
  name: string;
  telegramChatId: string;
  inviteLink: string;
  buttonLabel: string;
  isRequired: boolean;
  isEnabled: boolean;
  order: number;
}

export interface CheckMembershipOptions {
  botId: string;
  userId: number | bigint | string;
  getChatMemberFn: (chatId: string | number, userId: number) => Promise<any>;
}

export interface ChannelCheckResult {
  channelId: string;
  channelName: string;
  telegramChatId: string;
  buttonLabel: string;
  inviteLink: string;
  isRequired: boolean;
  isEnabled: boolean;
  isJoined: boolean;
  status:
    | "creator"
    | "administrator"
    | "member"
    | "restricted"
    | "left"
    | "kicked"
    | "error";
  errorMessage?: string;
}

export interface MembershipVerificationSummary {
  botId: string;
  userId: number;
  allRequiredJoined: boolean;
  hasErrors: boolean;
  channelsChecked: number;
  requiredCount: number;
  joinedRequiredCount: number;
  details: ChannelCheckResult[];
  message: string;
}

/**
 * Validates a Telegram username (e.g. '@mychannel') or numeric chat ID (e.g. '-1001234567890').
 */
export function validateTelegramChatId(chatId: string): string {
  const trimmed = (chatId || "").trim();
  if (!trimmed) {
    throw new Error(
      "Telegram chat ID or username is required for membership checks."
    );
  }

  // Handle username format: @channel_username (5 to 32 alphanumeric + underscore)
  if (trimmed.startsWith("@")) {
    const handleRegex = /^@[A-Za-z0-9_]{5,32}$/;
    if (!handleRegex.test(trimmed)) {
      throw new Error(
        `Invalid Telegram username "${trimmed}". Must start with @ and contain 5–32 letters, numbers, or underscores.`
      );
    }
    return trimmed;
  }

  // Handle numeric chat ID format: e.g. -1001234567890 or 123456789
  const numericRegex = /^-?\d{5,20}$/;
  if (!numericRegex.test(trimmed)) {
    throw new Error(
      `Invalid Telegram chat identifier "${trimmed}". Must be a channel username (e.g. '@mychannel') or a numeric ID (e.g. '-1001234567890').`
    );
  }

  return trimmed;
}

/**
 * Validates a public or private Telegram invite link.
 * Rejects arbitrary or non-Telegram URLs for security.
 */
export function validateInviteLink(link: string): string {
  const trimmed = (link || "").trim();
  if (!trimmed) {
    throw new Error("Channel invite link is required.");
  }

  // Reject JavaScript, data, or file schemes
  const lower = trimmed.toLowerCase();
  const isTelegramUrl =
    lower.startsWith("https://t.me/") ||
    lower.startsWith("https://telegram.me/");

  if (!isTelegramUrl) {
    throw new Error(
      "Invalid invite link. Must be a valid Telegram URL starting with 'https://t.me/' or 'https://telegram.me/'."
    );
  }

  // Check valid URL structure
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:") {
      throw new Error("Invite link must use secure HTTPS protocol.");
    }
  } catch {
    throw new Error("Invalid URL format for channel invite link.");
  }

  return trimmed;
}

/**
 * Validates an individual channel payload.
 */
export function validateChannelInput(channel: ChannelInput, index: number) {
  const trimmedName = (channel.name || "").trim();
  if (!trimmedName) {
    throw new Error(`Channel #${index + 1} must have a non-empty name.`);
  }
  if (trimmedName.length > 64) {
    throw new Error(
      `Channel name "${trimmedName}" exceeds the maximum length of 64 characters.`
    );
  }

  const trimmedLabel = (channel.buttonLabel || "").trim();
  if (!trimmedLabel) {
    throw new Error(`Channel "${trimmedName}" must have a non-empty button label.`);
  }
  if (trimmedLabel.length > 64) {
    throw new Error(
      `Button label "${trimmedLabel}" exceeds the maximum length of 64 characters.`
    );
  }

  validateTelegramChatId(channel.telegramChatId);
  validateInviteLink(channel.inviteLink);
}

/**
 * Retrieves configured channels for a bot, ordered by display order.
 */
export async function getBotChannels(
  botId: string,
  onlyEnabled: boolean = false
) {
  return prisma.botChannel.findMany({
    where: {
      botId,
      ...(onlyEnabled ? { isEnabled: true } : {}),
    },
    orderBy: { order: "asc" },
  });
}

/**
 * Validates and transactionally synchronizes a bot's channel list in PostgreSQL.
 * Scoped strictly by botId. Private invite links are NEVER written to audit logs.
 */
export async function saveBotChannels(
  botId: string,
  channels: ChannelInput[],
  adminUserId?: string
) {
  // 1. Max channel limit check
  if (channels.length > 20) {
    throw new Error("A bot can have a maximum of 20 channels configured.");
  }

  // 2. Validate individual channels
  for (let i = 0; i < channels.length; i++) {
    validateChannelInput(channels[i], i);
  }

  // 3. Perform update (Interactive transaction with 10s maxWait, 20s timeout, and graceful direct fallback)
  const executeSave = async (client: typeof prisma | any) => {
    const incomingIds = channels
      .map((c) => c.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);

    // Delete channels removed by the admin for this bot
    await client.botChannel.deleteMany({
      where: {
        botId,
        id: { notIn: incomingIds },
      },
    });

    const results = [];
    for (let index = 0; index < channels.length; index++) {
      const c = channels[index];
      const trimmedName = c.name.trim();
      const trimmedChatId = validateTelegramChatId(c.telegramChatId);
      const trimmedLink = validateInviteLink(c.inviteLink);
      const trimmedLabel = c.buttonLabel.trim();
      const isRequired = Boolean(c.isRequired);
      const isEnabled = c.isEnabled !== undefined ? Boolean(c.isEnabled) : true;

      if (c.id) {
        // Use update instead of upsert to avoid Prisma's internal interactive transaction
        try {
          const updated = await client.botChannel.update({
            where: { id: c.id },
            data: {
              name: trimmedName,
              telegramChatId: trimmedChatId,
              inviteLink: trimmedLink,
              buttonLabel: trimmedLabel,
              isRequired,
              isEnabled,
              order: index,
            },
          });
          results.push(updated);
        } catch {
          const created = await client.botChannel.create({
            data: {
              id: c.id,
              botId,
              name: trimmedName,
              telegramChatId: trimmedChatId,
              inviteLink: trimmedLink,
              buttonLabel: trimmedLabel,
              isRequired,
              isEnabled,
              order: index,
            },
          });
          results.push(created);
        }
      } else {
        const created = await client.botChannel.create({
          data: {
            botId,
            name: trimmedName,
            telegramChatId: trimmedChatId,
            inviteLink: trimmedLink,
            buttonLabel: trimmedLabel,
            isRequired,
            isEnabled,
            order: index,
          },
        });
        results.push(created);
      }
    }

    // Verify adminUser exists if provided to prevent foreign key errors
    let validAdminUserId: string | null = null;
    if (adminUserId) {
      const adminExists = await client.adminUser.findUnique({
        where: { id: adminUserId },
        select: { id: true },
      });
      if (adminExists) {
        validAdminUserId = adminExists.id;
      }
    }

    // 4. Record audit log (Invite links are intentionally OMITTED for privacy)
    await client.auditLog.create({
      data: {
        botId,
        adminUserId: validAdminUserId,
        action: "UPDATE_BOT_CHANNELS",
        details: {
          channelCount: channels.length,
          channelNames: channels.map((c) => c.name.trim()),
          requiredCount: channels.filter((c) => c.isRequired).length,
        },
      },
    });

    return results;
  };

  try {
    return await prisma.$transaction((tx) => executeSave(tx), {
      maxWait: 10000,
      timeout: 20000,
    });
  } catch (err: any) {
    const errMsg = String(err?.message || err);
    if (
      errMsg.includes("Transaction API error") ||
      errMsg.includes("Unable to start a transaction") ||
      errMsg.includes("Transaction timed out")
    ) {
      console.warn(
        `[ChannelService] Interactive transaction timed out. Falling back to direct database execution.`
      );
      return await executeSave(prisma);
    }
    throw err;
  }
}

/**
 * Checks a Telegram user's membership across all enabled channels for a bot.
 * Uses Telegram Bot API getChatMember.
 *
 * Distinguishes:
 * - Joined: creator, administrator, member, restricted (with is_member !== false)
 * - Not Joined: left, kicked
 * - Unknown / Error: bot not admin, chat not found, rate limit, network failure
 *
 * Crucial Rule: An API error is NEVER treated as a successful check!
 */
export async function checkUserChannelMemberships(
  options: CheckMembershipOptions
): Promise<MembershipVerificationSummary> {
  const numericUserId = Number(options.userId);
  if (isNaN(numericUserId) || numericUserId <= 0) {
    throw new Error("Invalid Telegram user ID for membership check.");
  }

  // 1. Fetch enabled channels for this bot
  const enabledChannels = await getBotChannels(options.botId, true);

  if (enabledChannels.length === 0) {
    return {
      botId: options.botId,
      userId: numericUserId,
      allRequiredJoined: true,
      hasErrors: false,
      channelsChecked: 0,
      requiredCount: 0,
      joinedRequiredCount: 0,
      details: [],
      message: "No channels are currently required.",
    };
  }

  const results: ChannelCheckResult[] = [];
  let hasErrors = false;

  for (const ch of enabledChannels) {
    try {
      const member = await options.getChatMemberFn(
        ch.telegramChatId,
        numericUserId
      );

      const status = (member?.status || "").toLowerCase();
      let isJoined = false;

      if (
        status === "creator" ||
        status === "administrator" ||
        status === "member"
      ) {
        isJoined = true;
      } else if (status === "restricted") {
        // Restricted members are still in the chat if is_member is not explicitly false
        isJoined = member?.is_member !== false;
      } else if (status === "left" || status === "kicked") {
        isJoined = false;
      } else {
        isJoined = false;
      }

      results.push({
        channelId: ch.id,
        channelName: ch.name,
        telegramChatId: ch.telegramChatId,
        buttonLabel: ch.buttonLabel,
        inviteLink: ch.inviteLink,
        isRequired: ch.isRequired,
        isEnabled: ch.isEnabled,
        isJoined,
        status: (status as any) || "error",
      });
    } catch (err: any) {
      hasErrors = true;
      const rawError = String(err?.message || err || "").toLowerCase();

      let friendlyError = "Failed to query Telegram membership.";
      if (rawError.includes("chat not found") || rawError.includes("chat_not_found")) {
        friendlyError = "Channel not found. Verify username or ID.";
      } else if (
        rawError.includes("bot is not a member") ||
        rawError.includes("user not found") ||
        rawError.includes("not enough rights") ||
        rawError.includes("forbidden")
      ) {
        friendlyError = "Bot is not an administrator in this channel.";
      } else if (rawError.includes("rate limit") || rawError.includes("too many requests")) {
        friendlyError = "Telegram API rate limit. Please try again in a moment.";
      }

      results.push({
        channelId: ch.id,
        channelName: ch.name,
        telegramChatId: ch.telegramChatId,
        buttonLabel: ch.buttonLabel,
        inviteLink: ch.inviteLink,
        isRequired: ch.isRequired,
        isEnabled: ch.isEnabled,
        isJoined: false,
        status: "error",
        errorMessage: friendlyError,
      });
    }
  }

  const requiredChannels = results.filter((r) => r.isRequired);
  const joinedRequired = requiredChannels.filter((r) => r.isJoined);
  const allRequiredJoined =
    requiredChannels.length === 0 ||
    joinedRequired.length === requiredChannels.length;

  let message = "";
  if (allRequiredJoined && !hasErrors) {
    message = "✅ All required channels joined successfully!";
  } else if (hasErrors) {
    message =
      "⚠️ Some channels could not be verified due to Telegram permissions or connectivity issues.";
  } else {
    const missing = requiredChannels.filter((r) => !r.isJoined);
    message = `Please join the required channels: ${missing
      .map((m) => `"${m.channelName}"`)
      .join(", ")}`;
  }

  // Record activity events for each checked channel
  for (const r of results) {
    await recordChannelActivityEvent({
      botId: options.botId,
      channelId: r.channelId,
      telegramChatId: r.telegramChatId,
      channelTitle: r.channelName,
      telegramUserId: numericUserId,
      eventType: "MEMBERSHIP_CHECK",
      status: r.isJoined
        ? "joined"
        : r.status === "error"
        ? "unable_to_verify"
        : "not_joined",
      source: "MANUAL_CHECK",
      details: {
        rawStatus: r.status,
        errorMessage: r.errorMessage || null,
        isRequired: r.isRequired,
      },
    }).catch(() => {});
  }

  return {
    botId: options.botId,
    userId: numericUserId,
    allRequiredJoined,
    hasErrors,
    channelsChecked: results.length,
    requiredCount: requiredChannels.length,
    joinedRequiredCount: joinedRequired.length,
    details: results,
    message,
  };
}

/**
 * Checks a Telegram user's membership for a specific single channel by its DB channel ID.
 * Returns: "joined" | "not_joined" | "verification_error"
 * Never treats an error as joined!
 */
export async function checkSingleChannelMembership(
  channelId: string,
  userId: number | bigint,
  getChatMemberFn: (chatId: string | number, userId: number) => Promise<any>
): Promise<"joined" | "not_joined" | "verification_error"> {
  const numericUserId = Number(userId);
  if (isNaN(numericUserId) || numericUserId <= 0) {
    return "verification_error";
  }

  const channel = await prisma.botChannel.findUnique({
    where: { id: channelId },
  });

  if (!channel) {
    return "verification_error";
  }

  let outcome: "joined" | "not_joined" | "verification_error" = "verification_error";
  let rawStatus: string | null = null;

  try {
    const member = await getChatMemberFn(channel.telegramChatId, numericUserId);
    rawStatus = (member?.status || "").toLowerCase();

    if (
      rawStatus === "creator" ||
      rawStatus === "administrator" ||
      rawStatus === "member"
    ) {
      outcome = "joined";
    } else if (rawStatus === "restricted") {
      outcome = member?.is_member !== false ? "joined" : "not_joined";
    } else if (rawStatus === "left" || rawStatus === "kicked") {
      outcome = "not_joined";
    } else {
      outcome = "verification_error";
    }
  } catch (error) {
    // If bot is not administrator in the channel or cannot access chat, return verification_error
    outcome = "verification_error";
  }

  await recordChannelActivityEvent({
    botId: channel.botId,
    channelId: channel.id,
    telegramChatId: channel.telegramChatId,
    channelTitle: channel.name,
    telegramUserId: numericUserId,
    eventType: "MEMBERSHIP_CHECK",
    status:
      outcome === "joined"
        ? "joined"
        : outcome === "not_joined"
        ? "not_joined"
        : "unable_to_verify",
    source: "FLOW_CHECK",
    details: {
      rawStatus,
    },
  }).catch(() => {});

  return outcome;
}

