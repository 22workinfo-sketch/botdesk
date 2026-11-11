import { prisma } from "./prisma";
import {
  encryptBotToken,
  decryptBotToken,
  maskBotToken,
  redactTokens,
  verifyTelegramToken,
  validateTelegramTokenFormat,
} from "./token-encryption";

export interface TelegramProfileInput {
  botId: string;
  telegramId: bigint | number | string;
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
  languageCode?: string | null;
}

export interface TelegramContactInput {
  botId: string;
  senderTelegramId: bigint | number | string;
  contactUserId?: bigint | number | string | null;
  phoneNumber: string;
}

export interface UpdateWelcomeMessageInput {
  botId: string;
  welcomeMessage: string;
  adminUserId?: string;
}

/**
 * Handles Telegram /start command:
 * 1. Validates bot existence.
 * 2. Upserts user profile in PostgreSQL.
 * 3. Retrieves dynamic welcome message and menu configuration.
 */
export async function handleTelegramStart(input: TelegramProfileInput) {
  const telegramIdBigInt = BigInt(input.telegramId);

  // Verify bot existence (enforce bot validation)
  const bot = await prisma.bot.findUnique({
    where: { id: input.botId },
    include: { config: true },
  });

  if (!bot || !bot.isActive) {
    throw new Error(`Bot with ID ${input.botId} not found or inactive`);
  }

  // Upsert user profile (bot-isolated: composite unique [botId, telegramId])
  const user = await prisma.telegramUser.upsert({
    where: {
      botId_telegramId: {
        botId: input.botId,
        telegramId: telegramIdBigInt,
      },
    },
    create: {
      botId: input.botId,
      telegramId: telegramIdBigInt,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      username: input.username ?? null,
      languageCode: input.languageCode ?? null,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    },
    update: {
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      username: input.username ?? null,
      languageCode: input.languageCode ?? null,
      lastSeenAt: new Date(),
    },
  });

  // Fetch active buttons for the bot from PostgreSQL
  const activeButtons = await prisma.botButton.findMany({
    where: { botId: input.botId, isEnabled: true },
    orderBy: { order: "asc" },
  });

  const welcomeMessage =
    bot.config?.welcomeMessage ||
    "Welcome! I am your test Telegram bot. Tap the button below to get started.";

  // If active buttons exist in DB, use them; otherwise fallback to standard default buttons
  const buttonsToReturn =
    activeButtons.length > 0
      ? activeButtons
      : [
          {
            id: "default-1",
            botId: input.botId,
            label: "📱 Share Phone Number",
            actionType: "REQUEST_CONTACT",
            replyText: null,
            autoDeleteReply: false,
            deleteAfterSeconds: 30,
            isEnabled: true,
            order: 0,
          },
          {
            id: "default-2",
            botId: input.botId,
            label: "ℹ️ Help / Info",
            actionType: "SEND_TEXT",
            replyText:
              "ℹ️ Backstage Test Bot Help:\n\n• Send /start to reload your profile and see the welcome message.\n• Tap 'Share Phone Number' to store your contact number in PostgreSQL.\n• The welcome message and menu buttons can be updated live from your local Admin Web Panel!",
            autoDeleteReply: false,
            deleteAfterSeconds: 30,
            isEnabled: true,
            order: 1,
          },
        ];

  return {
    bot,
    user,
    welcomeMessage,
    buttons: buttonsToReturn,
    menuConfig: { buttons: buttonsToReturn },
  };
}

export type ContactValidationResult =
  | { success: true; user: any }
  | {
      success: false;
      reason: "MISSING_CONTACT_USER_ID" | "OWNERSHIP_MISMATCH" | "USER_NOT_FOUND";
    };

/**
 * Handles user sharing their contact / phone number:
 * Validates that contact.user_id matches the sender's Telegram ID.
 * Rejects forwarded or foreign contacts without overwriting existing data.
 * Phone numbers are NEVER written to logs.
 */
export async function handleTelegramContact(
  input: TelegramContactInput
): Promise<ContactValidationResult> {
  const senderIdBigInt = BigInt(input.senderTelegramId);

  // 1. Verify contact.user_id is present
  if (input.contactUserId === undefined || input.contactUserId === null) {
    return { success: false, reason: "MISSING_CONTACT_USER_ID" };
  }

  // 2. Verify contact.user_id exactly matches the sender's Telegram ID
  const contactUserIdBigInt = BigInt(input.contactUserId);
  if (contactUserIdBigInt !== senderIdBigInt) {
    return { success: false, reason: "OWNERSHIP_MISMATCH" };
  }

  // 3. Verify user exists in database for this bot
  const existingUser = await prisma.telegramUser.findUnique({
    where: {
      botId_telegramId: {
        botId: input.botId,
        telegramId: senderIdBigInt,
      },
    },
  });

  if (!existingUser) {
    return { success: false, reason: "USER_NOT_FOUND" };
  }

  // 4. Update the user with verified phone number (never logged)
  const updatedUser = await prisma.telegramUser.update({
    where: {
      botId_telegramId: {
        botId: input.botId,
        telegramId: senderIdBigInt,
      },
    },
    data: {
      telegramPhNo: input.phoneNumber,
      lastSeenAt: new Date(),
    },
  });

  return { success: true, user: updatedUser };
}

/**
 * Retrieves bot details and configuration by botId.
 */
export async function getBotWithConfig(botId: string) {
  return prisma.bot.findUnique({
    where: { id: botId },
    include: {
      config: true,
      _count: {
        select: { users: true },
      },
    },
  });
}

/**
 * Retrieves all registered bots for the backstage dashboard.
 */
export async function getAllBots() {
  return prisma.bot.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      config: true,
      _count: {
        select: { users: true },
      },
    },
  });
}

/**
 * Safely resolves a bot's Telegram Bot token for runtime usage:
 * 1. Checks if bot has an encrypted token stored in DB, decrypts it using AES-256-GCM.
 * 2. Fallbacks to process.env[tokenEnvVar] for backwards-compatible single-bot setups.
 * Returns null if token is not found or is a placeholder.
 */
export function resolveBotToken(bot: {
  tokenEnvVar?: string;
  encryptedToken?: string | null;
}): string | null {
  if (bot.encryptedToken) {
    try {
      const decrypted = decryptBotToken(bot.encryptedToken);
      if (decrypted && decrypted.trim().length > 0) {
        return decrypted.trim();
      }
    } catch (err) {
      console.error(
        "[Token Decryption Error] Failed to decrypt token for bot:",
        err instanceof Error ? err.message : err
      );
      return null;
    }
  }

  const envKey = bot.tokenEnvVar || "TELEGRAM_BOT_TOKEN";
  const envVal = process.env[envKey];
  if (
    envVal &&
    envVal.trim().length > 0 &&
    !envVal.includes("placeholder") &&
    !envVal.includes("your_test_bot_token")
  ) {
    return envVal.trim();
  }

  return null;
}

export interface SafeBotRecord {
  id: string;
  name: string;
  username: string;
  telegramBotId: string | null;
  tokenEnvVar: string;
  hasStoredToken: boolean;
  tokenLast4: string | null;
  description: string | null;
  isActive: boolean;
  connectionStatus: string;
  lastError: string | null;
  lastCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
  config?: {
    welcomeMessage: string;
  } | null;
  _count?: {
    users: number;
  };
}

export function formatSafeBot(bot: any): SafeBotRecord {
  return {
    id: bot.id,
    name: bot.name,
    username: bot.username,
    telegramBotId: bot.telegramBotId != null ? bot.telegramBotId.toString() : null,
    tokenEnvVar: bot.tokenEnvVar,
    hasStoredToken: Boolean(bot.encryptedToken),
    tokenLast4: bot.tokenLast4 || (bot.encryptedToken ? "••••" : null),
    description: bot.description ?? null,
    isActive: Boolean(bot.isActive),
    connectionStatus: bot.connectionStatus || (bot.isActive ? "STANDBY" : "DISCONNECTED"),
    lastError: bot.lastError ?? null,
    lastCheckedAt: bot.lastCheckedAt ? new Date(bot.lastCheckedAt).toISOString() : null,
    createdAt: new Date(bot.createdAt).toISOString(),
    updatedAt: new Date(bot.updatedAt).toISOString(),
    config: bot.config
      ? {
          welcomeMessage: bot.config.welcomeMessage,
        }
      : null,
    _count: bot._count ? { users: bot._count.users || 0 } : undefined,
  };
}

export interface CreateBotInput {
  name: string;
  token: string;
  description?: string;
  adminUserId?: string;
}

/**
 * Creates and registers a new Telegram bot with verified credentials and encrypted storage.
 */
export async function createBot(
  input: CreateBotInput,
  options?: { customFetch?: typeof fetch }
) {
  const trimmedName = (input.name || "").trim();
  if (!trimmedName) {
    throw new Error("Bot name is required.");
  }
  if (trimmedName.length > 64) {
    throw new Error("Bot name cannot exceed 64 characters.");
  }

  const trimmedToken = (input.token || "").trim();
  const formatCheck = validateTelegramTokenFormat(trimmedToken);
  if (!formatCheck.isValid) {
    throw new Error(formatCheck.error);
  }

  // 1. Verify token with Telegram getMe API
  const verifyRes = await verifyTelegramToken(trimmedToken, {
    customFetch: options?.customFetch,
  });

  if (!verifyRes.ok || !verifyRes.botId || !verifyRes.username) {
    throw new Error(
      verifyRes.error ||
        "Could not verify token with Telegram. Please check the token."
    );
  }

  const telegramBotIdBigInt = BigInt(verifyRes.botId);

  // 2. Prevent duplicate bot registration
  const existingWithId = await prisma.bot.findUnique({
    where: { telegramBotId: telegramBotIdBigInt },
  });

  if (existingWithId) {
    throw new Error(
      `Duplicate registration: A bot with Telegram ID ${verifyRes.botId} (@${verifyRes.username}) is already registered as "${existingWithId.name}".`
    );
  }

  // 3. Encrypt the token using AES-256-GCM
  const encryptedToken = encryptBotToken(trimmedToken);
  const tokenLast4 = maskBotToken(trimmedToken);

  // 4. Create bot, default config, default buttons and audit log
  const newBot = await prisma.bot.create({
    data: {
      name: trimmedName,
      username: verifyRes.username,
      telegramBotId: telegramBotIdBigInt,
      encryptedToken,
      tokenLast4,
      description: input.description?.trim() || null,
      isActive: true,
      connectionStatus: "CONNECTED",
      lastCheckedAt: new Date(),
    },
  });

  // Default Welcome Message
  await prisma.botConfig.create({
    data: {
      botId: newBot.id,
      welcomeMessage:
        `Hello! Welcome to ${newBot.name} (@${newBot.username}).\n\n` +
        `This bot is managed live via your BackStage panel.\n` +
        `Tap a menu option below to get started!`,
    },
  });

  // Default Reply Keyboard Buttons
  await prisma.botButton.createMany({
    data: [
      {
        botId: newBot.id,
        label: "📱 Share Phone Number",
        actionType: "REQUEST_CONTACT",
        order: 0,
        isEnabled: true,
      },
      {
        botId: newBot.id,
        label: "ℹ️ Help / Info",
        actionType: "SEND_TEXT",
        replyText:
          `ℹ️ ${newBot.name} Help:\n\n` +
          `• Send /start to reload your profile and see the welcome message.\n` +
          `• Tap 'Share Phone Number' to store your contact number in PostgreSQL.\n` +
          `• You can configure custom buttons and channels in BackStage!`,
        order: 1,
        isEnabled: true,
      },
    ],
  });

  // Audit log (token NEVER stored or logged!)
  await prisma.auditLog.create({
    data: {
      botId: newBot.id,
      adminUserId: input.adminUserId ?? null,
      action: "CREATE_BOT",
      details: {
        botName: newBot.name,
        username: newBot.username,
        telegramBotId: verifyRes.botId,
        tokenHint: tokenLast4,
      },
    },
  });

  const fullBot = await prisma.bot.findUnique({
    where: { id: newBot.id },
    include: {
      config: true,
      _count: { select: { users: true } },
    },
  });

  return formatSafeBot(fullBot);
}

export interface UpdateBotInput {
  name?: string;
  description?: string;
  isActive?: boolean;
  token?: string;
  adminUserId?: string;
}

/**
 * Updates bot settings, active toggle, or token replacement.
 */
export async function updateBot(
  botId: string,
  input: UpdateBotInput,
  options?: { customFetch?: typeof fetch }
) {
  const existing = await prisma.bot.findUnique({
    where: { id: botId },
  });

  if (!existing) {
    throw new Error(`Bot with ID ${botId} not found.`);
  }

  const dataToUpdate: any = {};
  let auditAction = "UPDATE_BOT_SETTINGS";
  const auditDetails: any = {};

  if (input.name !== undefined) {
    const trimmedName = input.name.trim();
    if (!trimmedName) throw new Error("Bot name cannot be empty.");
    if (trimmedName.length > 64) throw new Error("Bot name cannot exceed 64 characters.");
    dataToUpdate.name = trimmedName;
    auditDetails.name = trimmedName;
  }

  if (input.description !== undefined) {
    dataToUpdate.description = input.description.trim() || null;
    auditDetails.descriptionUpdated = true;
  }

  if (input.isActive !== undefined) {
    dataToUpdate.isActive = Boolean(input.isActive);
    if (!input.isActive) {
      dataToUpdate.connectionStatus = "DISCONNECTED";
    }
    auditDetails.isActive = Boolean(input.isActive);
  }

  // Handle Token Replacement
  if (input.token !== undefined && input.token.trim().length > 0) {
    const trimmedToken = input.token.trim();
    const formatCheck = validateTelegramTokenFormat(trimmedToken);
    if (!formatCheck.isValid) {
      throw new Error(formatCheck.error);
    }

    const verifyRes = await verifyTelegramToken(trimmedToken, {
      customFetch: options?.customFetch,
    });

    if (!verifyRes.ok || !verifyRes.botId || !verifyRes.username) {
      throw new Error(
        verifyRes.error ||
          "Could not verify replacement token with Telegram."
      );
    }

    const newTelegramBotId = BigInt(verifyRes.botId);

    // If bot already has a telegramBotId, ensure it's replacing for the same bot or not conflicting
    if (existing.telegramBotId && existing.telegramBotId !== newTelegramBotId) {
      throw new Error(
        `Token replacement mismatch: Token belongs to @${verifyRes.username} (ID: ${verifyRes.botId}), but this record is configured for ID ${existing.telegramBotId.toString()}. You cannot replace a bot's token with a completely different Telegram bot's token.`
      );
    }

    // Check duplicate if existing didn't have telegramBotId
    if (!existing.telegramBotId) {
      const conflict = await prisma.bot.findUnique({
        where: { telegramBotId: newTelegramBotId },
      });
      if (conflict && conflict.id !== botId) {
        throw new Error(
          `Conflict: Telegram bot ID ${verifyRes.botId} is already registered as "${conflict.name}".`
        );
      }
    }

    dataToUpdate.telegramBotId = newTelegramBotId;
    dataToUpdate.username = verifyRes.username;
    dataToUpdate.encryptedToken = encryptBotToken(trimmedToken);
    dataToUpdate.tokenLast4 = maskBotToken(trimmedToken);
    dataToUpdate.connectionStatus = "CONNECTED";
    dataToUpdate.lastError = null;
    dataToUpdate.lastCheckedAt = new Date();

    auditAction = "REPLACE_BOT_TOKEN";
    auditDetails.tokenHint = dataToUpdate.tokenLast4;
    auditDetails.verifiedUsername = verifyRes.username;
  }

  const updated = await prisma.bot.update({
    where: { id: botId },
    data: dataToUpdate,
    include: {
      config: true,
      _count: { select: { users: true } },
    },
  });

  await prisma.auditLog.create({
    data: {
      botId,
      adminUserId: input.adminUserId ?? null,
      action: auditAction,
      details: auditDetails,
    },
  });

  return formatSafeBot(updated);
}

/**
 * Tests connection to Telegram for a specific bot.
 */
export async function testBotConnection(
  botId: string,
  options?: { customFetch?: typeof fetch }
) {
  const bot = await prisma.bot.findUnique({
    where: { id: botId },
  });

  if (!bot) {
    throw new Error(`Bot with ID ${botId} not found.`);
  }

  const token = resolveBotToken(bot);
  if (!token) {
    const updated = await prisma.bot.update({
      where: { id: botId },
      data: {
        connectionStatus: "STANDBY",
        lastError: "Token is not configured or in standby mode.",
        lastCheckedAt: new Date(),
      },
      include: {
        config: true,
        _count: { select: { users: true } },
      },
    });
    return {
      ok: false,
      status: "STANDBY",
      error: "No active token configured. Please supply a valid BotFather token.",
      bot: formatSafeBot(updated),
    };
  }

  const result = await verifyTelegramToken(token, {
    customFetch: options?.customFetch,
  });

  const status = result.ok ? "CONNECTED" : "ERROR";
  const updated = await prisma.bot.update({
    where: { id: botId },
    data: {
      connectionStatus: status,
      lastError: result.error ?? null,
      lastCheckedAt: new Date(),
    },
    include: {
      config: true,
      _count: { select: { users: true } },
    },
  });

  return {
    ok: result.ok,
    status,
    error: result.error,
    botInfo: result.ok
      ? {
          id: result.botId!,
          username: result.username!,
          name: result.firstName!,
        }
      : undefined,
    bot: formatSafeBot(updated),
  };
}

/**
 * Deletes a bot and cascades all associated resources.
 */
export async function deleteBot(botId: string, adminUserId?: string) {
  const bot = await prisma.bot.findUnique({
    where: { id: botId },
  });

  if (!bot) {
    throw new Error(`Bot with ID ${botId} not found.`);
  }

  const totalBots = await prisma.bot.count();
  if (totalBots <= 1) {
    throw new Error("Cannot delete the last remaining bot in the system.");
  }

  await prisma.bot.delete({
    where: { id: botId },
  });

  await prisma.auditLog.create({
    data: {
      adminUserId: adminUserId ?? null,
      action: "DELETE_BOT",
      details: {
        botId,
        botName: bot.name,
        username: bot.username,
      },
    },
  });

  return { success: true };
}

/**
 * Retrieves users strictly isolated by botId.
 * No data leakage between different bots.
 */
export async function getBotUsers(botId: string) {
  return prisma.telegramUser.findMany({
    where: { botId },
    orderBy: { lastSeenAt: "desc" },
  });
}

/**
 * Updates welcome message for a bot and writes an audit log entry.
 */
export async function updateBotWelcomeMessage(input: UpdateWelcomeMessageInput) {
  const trimmedMessage = input.welcomeMessage.trim();
  if (!trimmedMessage) {
    throw new Error("Welcome message cannot be empty");
  }

  // Fetch current config for audit trail
  const currentConfig = await prisma.botConfig.findUnique({
    where: { botId: input.botId },
  });

  const previousMessage = currentConfig?.welcomeMessage ?? "";

  // Upsert the bot configuration
  const updatedConfig = await prisma.botConfig.upsert({
    where: { botId: input.botId },
    create: {
      botId: input.botId,
      welcomeMessage: trimmedMessage,
    },
    update: {
      welcomeMessage: trimmedMessage,
    },
  });

  // Synchronize welcome greeting ONLY with any active draft flow.
  // Published flows MUST remain immutable until explicitly published by an administrator.
  try {
    const draftFlows = await prisma.botFlow.findMany({
      where: {
        botId: input.botId,
        status: "DRAFT",
      },
    });

    for (const flow of draftFlows) {
      const struct = flow.structure as any;
      if (!struct) continue;
      let changed = false;

      // Flow V1 Structure: rootMenu.promptText
      if (struct.rootMenu && typeof struct.rootMenu === "object") {
        struct.rootMenu.promptText = trimmedMessage;
        changed = true;
      }

      // Flow V2 Graph: start / root node
      if (Array.isArray(struct.nodes)) {
        for (const n of struct.nodes) {
          if (n.type === "start" || n.data?.isStart || n.id === "start-node") {
            if (n.data) {
              n.data.content = trimmedMessage;
              changed = true;
            }
          }
        }
      }

      if (changed) {
        await prisma.botFlow.update({
          where: { id: flow.id },
          data: { structure: struct },
        });
      }
    }
  } catch (syncErr) {
    console.warn("[updateBotWelcomeMessage] Error syncing flow greeting:", syncErr);
  }

  // Create audit log record
  await prisma.auditLog.create({
    data: {
      botId: input.botId,
      adminUserId: input.adminUserId ?? null,
      action: "UPDATE_WELCOME_MESSAGE",
      details: {
        previous: previousMessage,
        updated: trimmedMessage,
      },
    },
  });

  return updatedConfig;
}

export interface ButtonInput {
  id?: string;
  label: string;
  actionType: "SEND_TEXT" | "REQUEST_CONTACT" | "JOIN_CHANNELS" | string;
  replyText?: string | null;
  autoDeleteReply?: boolean;
  deleteAfterSeconds?: number;
  isEnabled: boolean;
  order: number;
}

/**
 * Retrieves configured reply keyboard buttons for a bot.
 */
export async function getBotButtons(botId: string, onlyEnabled: boolean = false) {
  return prisma.botButton.findMany({
    where: {
      botId,
      ...(onlyEnabled ? { isEnabled: true } : {}),
    },
    orderBy: { order: "asc" },
  });
}

/**
 * Validates and saves the bot reply keyboard buttons.
 * Enforces bot_id scoping, length restrictions, duplicate label checks, and max button limits.
 */
export async function saveBotButtons(
  botId: string,
  buttons: ButtonInput[],
  adminUserId?: string
) {
  // 1. Max button count validation (keep UI and keyboard manageable)
  if (buttons.length > 12) {
    throw new Error("A bot menu can have a maximum of 12 buttons.");
  }

  // 2. Validate individual buttons and uniqueness of labels
  const seenLabels = new Set<string>();

  for (let i = 0; i < buttons.length; i++) {
    const btn = buttons[i];
    const trimmedLabel = btn.label ? btn.label.trim() : "";

    if (!trimmedLabel) {
      throw new Error(`Button #${i + 1} must have a non-empty label.`);
    }

    if (trimmedLabel.length > 64) {
      throw new Error(
        `Button label "${trimmedLabel}" exceeds the maximum length of 64 characters.`
      );
    }

    const normalizedLabel = trimmedLabel.toLowerCase();
    if (seenLabels.has(normalizedLabel)) {
      throw new Error(
        `Duplicate button label detected: "${trimmedLabel}". Each button label must be unique within the bot.`
      );
    }
    seenLabels.add(normalizedLabel);

    if (
      btn.actionType !== "SEND_TEXT" &&
      btn.actionType !== "REQUEST_CONTACT" &&
      btn.actionType !== "JOIN_CHANNELS"
    ) {
      throw new Error(
        `Button "${trimmedLabel}" has an unsupported action type: ${btn.actionType}. Only SEND_TEXT, REQUEST_CONTACT, and JOIN_CHANNELS are supported.`
      );
    }

    if (btn.actionType === "SEND_TEXT") {
      const trimmedReply = btn.replyText ? btn.replyText.trim() : "";
      if (!trimmedReply) {
        throw new Error(
          `Button "${trimmedLabel}" requires a reply text for the SEND_TEXT action.`
        );
      }
      if (trimmedReply.length > 2000) {
        throw new Error(
          `Reply text for "${trimmedLabel}" exceeds maximum length of 2000 characters.`
        );
      }
      if (btn.autoDeleteReply) {
        const delay =
          btn.deleteAfterSeconds !== undefined
            ? Math.floor(btn.deleteAfterSeconds)
            : 30;
        if (isNaN(delay) || delay < 5 || delay > 86400) {
          throw new Error(
            `Button "${trimmedLabel}" has invalid auto-delete delay: ${btn.deleteAfterSeconds}. Delay must be between 5 and 86400 seconds (24 hours).`
          );
        }
      }
    } else if (btn.actionType === "JOIN_CHANNELS") {
      if (btn.replyText && btn.replyText.trim().length > 2000) {
        throw new Error(
          `Prompt text for "${trimmedLabel}" exceeds maximum length of 2000 characters.`
        );
      }
    }
  }

  // 3. Transactionally sync buttons in PostgreSQL (10s maxWait, 20s timeout, with direct fallback)
  const executeSaveButtons = async (client: typeof prisma | any) => {
    // Collect existing button IDs in payload
    const incomingIds = buttons
      .map((b) => b.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);

    // Delete buttons removed by the admin for this specific bot
    await client.botButton.deleteMany({
      where: {
        botId,
        id: { notIn: incomingIds },
      },
    });

    const results = [];
    for (let index = 0; index < buttons.length; index++) {
      const b = buttons[index];
      const trimmedLabel = b.label.trim();
      const trimmedReply =
        b.actionType === "SEND_TEXT" ? b.replyText?.trim() ?? null : null;
      const autoDeleteReply =
        b.actionType === "SEND_TEXT" ? Boolean(b.autoDeleteReply) : false;
      const deleteAfterSeconds =
        b.actionType === "SEND_TEXT" && b.autoDeleteReply
          ? Math.floor(b.deleteAfterSeconds ?? 30)
          : 30;

      if (b.id) {
        // Use update instead of upsert to avoid Prisma's internal interactive transaction
        try {
          const updated = await client.botButton.update({
            where: { id: b.id },
            data: {
              label: trimmedLabel,
              actionType: b.actionType,
              replyText: trimmedReply,
              autoDeleteReply,
              deleteAfterSeconds,
              isEnabled: b.isEnabled ?? true,
              order: index,
            },
          });
          results.push(updated);
        } catch {
          const created = await client.botButton.create({
            data: {
              id: b.id,
              botId,
              label: trimmedLabel,
              actionType: b.actionType,
              replyText: trimmedReply,
              autoDeleteReply,
              deleteAfterSeconds,
              isEnabled: b.isEnabled ?? true,
              order: index,
            },
          });
          results.push(created);
        }
      } else {
        const created = await client.botButton.create({
          data: {
            botId,
            label: trimmedLabel,
            actionType: b.actionType,
            replyText: trimmedReply,
            autoDeleteReply,
            deleteAfterSeconds,
            isEnabled: b.isEnabled ?? true,
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

    // 4. Record audit log
    await client.auditLog.create({
      data: {
        botId,
        adminUserId: validAdminUserId,
        action: "UPDATE_BOT_MENU",
        details: {
          buttonCount: buttons.length,
          labels: buttons.map((b) => b.label.trim()),
        },
      },
    });

    return results;
  };

  try {
    return await prisma.$transaction((tx) => executeSaveButtons(tx), {
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
        `[BotService] Interactive transaction timed out. Falling back to direct database execution.`
      );
      return await executeSaveButtons(prisma);
    }
    throw err;
  }
}

/**
 * Handles incoming text messages from Telegram users:
 * Checks if the text matches an active SEND_TEXT button for the bot.
 * Gracefully ignores disabled, removed, or unrecognized text.
 */
export async function handleTelegramText(botId: string, text: string) {
  if (!text || typeof text !== "string") {
    return { handled: false };
  }

  const trimmedText = text.trim();

  // Find enabled button for this bot matching the exact label (SEND_TEXT or JOIN_CHANNELS)
  const button = await prisma.botButton.findFirst({
    where: {
      botId,
      label: trimmedText,
      isEnabled: true,
      actionType: { in: ["SEND_TEXT", "JOIN_CHANNELS"] },
    },
  });

  if (!button) {
    return { handled: false };
  }

  if (button.actionType === "SEND_TEXT") {
    if (!button.replyText) return { handled: false };
    return {
      handled: true,
      actionType: "SEND_TEXT",
      replyText: button.replyText,
      button,
    };
  }

  if (button.actionType === "JOIN_CHANNELS") {
    const defaultPrompt =
      "Please join our official channels below, then tap 'Check Joined' to verify your membership.";
    return {
      handled: true,
      actionType: "JOIN_CHANNELS",
      replyText: button.replyText || defaultPrompt,
      button,
    };
  }

  return { handled: false };
}
