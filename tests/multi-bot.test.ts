import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "../src/lib/prisma";
import {
  encryptBotToken,
  decryptBotToken,
  maskBotToken,
  redactTokens,
  validateTelegramTokenFormat,
  verifyTelegramToken,
} from "../src/lib/token-encryption";
import {
  createBot,
  updateBot,
  deleteBot,
  testBotConnection,
  formatSafeBot,
  resolveBotToken,
  handleTelegramStart,
  handleTelegramContact,
} from "../src/lib/bot-service";
import { hasBotAccess, canUserMutate } from "../src/lib/permissions";
import { startMultiBotRunner } from "../src/lib/multi-bot-runner";
import { GET as getBotsRoute, POST as createBotRoute } from "../src/app/api/bots/route";
import { PATCH as updateBotRoute, GET as getBotRoute } from "../src/app/api/bots/[id]/route";
import { POST as webhookBotRoute } from "../src/app/api/telegram/webhook/[botId]/route";
import { _setWebhookBotForTesting } from "../src/lib/bot-handlers";
import { NextRequest } from "next/server";

describe("Multi-Bot Management, Token Security & Isolation Suite", () => {
  const BOT1_RAW_TOKEN = "11111111:AAABBBcccDDDeeeFFFggghhhiiijjjkkk";
  const BOT1_TELEGRAM_ID = "11111111";
  const BOT1_USERNAME = "alpha_test_bot";

  const BOT2_RAW_TOKEN = "22222222:ZZZYYYxxxWWWvvvuuutttsssrrrqqqppp";
  const BOT2_TELEGRAM_ID = "22222222";
  const BOT2_USERNAME = "beta_test_bot";

  // Mock Telegram API fetch function
  const mockTelegramFetch = vi.fn(async (url: string | URL | Request) => {
    const urlStr = String(url);
    if (urlStr.includes(BOT1_RAW_TOKEN)) {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          result: {
            id: Number(BOT1_TELEGRAM_ID),
            is_bot: true,
            first_name: "Alpha Bot",
            username: BOT1_USERNAME,
          },
        }),
      } as any;
    }
    if (urlStr.includes(BOT2_RAW_TOKEN)) {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          result: {
            id: Number(BOT2_TELEGRAM_ID),
            is_bot: true,
            first_name: "Beta Bot",
            username: BOT2_USERNAME,
          },
        }),
      } as any;
    }
    return {
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      json: async () => ({
        ok: false,
        error_code: 401,
        description: "Unauthorized: Invalid bot token",
      }),
    } as any;
  });

  // Cleanup helper
  const cleanTestBots = async () => {
    await prisma.bot.deleteMany({
      where: {
        username: { in: [BOT1_USERNAME, BOT2_USERNAME, "gamma_test_bot"] },
      },
    });
  };

  beforeEach(async () => {
    await cleanTestBots();
  });

  afterEach(async () => {
    await cleanTestBots();
    _setWebhookBotForTesting(null);
  });

  describe("1. Token Security, AES-256-GCM Encryption & Redaction", () => {
    it("securely encrypts and decrypts bot tokens using AES-256-GCM authenticated cipher", () => {
      const plaintext = "987654321:XYZabc1234567890abcdefghijklmnopqrst";
      const encrypted = encryptBotToken(plaintext);

      expect(encrypted).toContain("enc:v1:");
      const parts = encrypted.split(":");
      expect(parts.length).toBe(5); // ["enc", "v1", iv, tag, ciphertext]

      // Ciphertext must not contain the plaintext token
      expect(encrypted).not.toContain(plaintext);

      const decrypted = decryptBotToken(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it("rejects tampered or corrupted encrypted token payloads with authentication failure", () => {
      const plaintext = "123456789:ValidTokenExample1234567890abcdefgh";
      const encrypted = encryptBotToken(plaintext);
      const parts = encrypted.split(":");

      // Tamper with the ciphertext component
      parts[4] = "deadbeef" + parts[4].slice(8);
      const tampered = parts.join(":");

      expect(() => decryptBotToken(tampered)).toThrow(
        /Authentication tag mismatch|corrupted/i
      );
    });

    it("masks bot token safely for user interface without revealing token secret", () => {
      const token = "123456789:ABCdefGHIjklMNOpqrSTUvwxYZ";
      const masked = maskBotToken(token);

      expect(masked).toBe("••••wxYZ");
      expect(masked).not.toContain("123456789");
      expect(masked).not.toContain("ABCdef");
    });

    it("redacts bot tokens from error messages, audit descriptions, and stack traces", () => {
      const secret = "9288996910:AAFq9_zK4fIuH0Q5nCNQA6ByjqDtHYsChqk";
      const rawLog = `Telegram API connection to https://api.telegram.org/bot${secret}/getMe failed: 504 Gateway Timeout`;

      const sanitized = redactTokens(rawLog);
      expect(sanitized).not.toContain(secret);
      expect(sanitized).toContain("[REDACTED_BOT_TOKEN]");
    });

    it("validates Telegram bot token format syntax without network calls", () => {
      expect(validateTelegramTokenFormat("").isValid).toBe(false);
      expect(validateTelegramTokenFormat("not_a_token").isValid).toBe(false);
      expect(validateTelegramTokenFormat("123:short").isValid).toBe(false);
      expect(validateTelegramTokenFormat(BOT1_RAW_TOKEN).isValid).toBe(true);
    });
  });

  describe("2. Multi-Bot Registration & Duplicate Prevention", () => {
    it("successfully creates two distinct bots with encrypted token storage and isolated configs", async () => {
      const bot1 = await createBot(
        {
          name: "Alpha Bot Service",
          token: BOT1_RAW_TOKEN,
          description: "Customer service bot for Myanmar users",
        },
        { customFetch: mockTelegramFetch as any }
      );

      const bot2 = await createBot(
        {
          name: "Beta Bot Service",
          token: BOT2_RAW_TOKEN,
          description: "VIP subscriber community bot",
        },
        { customFetch: mockTelegramFetch as any }
      );

      expect(bot1.id).toBeDefined();
      expect(bot2.id).toBeDefined();
      expect(bot1.id).not.toBe(bot2.id);

      expect(bot1.name).toBe("Alpha Bot Service");
      expect(bot1.username).toBe(BOT1_USERNAME);
      expect(bot1.telegramBotId).toBe(BOT1_TELEGRAM_ID);

      expect(bot2.name).toBe("Beta Bot Service");
      expect(bot2.username).toBe(BOT2_USERNAME);
      expect(bot2.telegramBotId).toBe(BOT2_TELEGRAM_ID);

      // Verify DB storage: encryptedToken must be set and NOT plaintext
      const dbBot1 = await prisma.bot.findUnique({ where: { id: bot1.id } });
      expect(dbBot1?.encryptedToken).toMatch(/^enc:v1:/);
      expect(dbBot1?.encryptedToken).not.toContain(BOT1_RAW_TOKEN);

      // Verify token resolution
      const resolved1 = resolveBotToken(dbBot1!);
      expect(resolved1).toBe(BOT1_RAW_TOKEN);

      // formatSafeBot must never expose encryptedToken
      expect((bot1 as any).encryptedToken).toBeUndefined();
    });

    it("rejects duplicate registration when attempting to register the same Telegram bot ID twice", async () => {
      // Register first time
      await createBot(
        {
          name: "Alpha Bot First",
          token: BOT1_RAW_TOKEN,
        },
        { customFetch: mockTelegramFetch as any }
      );

      // Attempt second registration with same token / bot ID
      await expect(
        createBot(
          {
            name: "Alpha Bot Second Duplicate",
            token: BOT1_RAW_TOKEN,
          },
          { customFetch: mockTelegramFetch as any }
        )
      ).rejects.toThrow(/Duplicate registration/i);
    });

    it("rejects invalid or unauthorized tokens with safe sanitized error messages", async () => {
      const invalidToken = "99999999:BadTokenHereThatDoesNotWorkAtAll12345";
      await expect(
        createBot(
          {
            name: "Failing Bot",
            token: invalidToken,
          },
          { customFetch: mockTelegramFetch as any }
        )
      ).rejects.toThrow(/Token verification failed|Unauthorized/i);
    });
  });

  describe("3. Data Isolation Across Multiple Bots", () => {
    it("maintains separate welcome messages and reply keyboard menus for each bot", async () => {
      const bot1 = await createBot(
        { name: "Alpha Bot", token: BOT1_RAW_TOKEN },
        { customFetch: mockTelegramFetch as any }
      );
      const bot2 = await createBot(
        { name: "Beta Bot", token: BOT2_RAW_TOKEN },
        { customFetch: mockTelegramFetch as any }
      );

      // Customize Bot 1 welcome message
      await prisma.botConfig.update({
        where: { botId: bot1.id },
        data: { welcomeMessage: "Welcome to Alpha Bot!" },
      });

      // Customize Bot 2 welcome message
      await prisma.botConfig.update({
        where: { botId: bot2.id },
        data: { welcomeMessage: "Welcome to Beta Bot Exclusive!" },
      });

      const res1 = await handleTelegramStart({
        botId: bot1.id,
        telegramId: "555111",
        username: "user_alpha",
      });

      const res2 = await handleTelegramStart({
        botId: bot2.id,
        telegramId: "555222",
        username: "user_beta",
      });

      expect(res1.welcomeMessage).toBe("Welcome to Alpha Bot!");
      expect(res2.welcomeMessage).toBe("Welcome to Beta Bot Exclusive!");
    });

    it("isolates Telegram users, phone numbers, and contacts strictly by botId", async () => {
      const bot1 = await createBot(
        { name: "Alpha Bot", token: BOT1_RAW_TOKEN },
        { customFetch: mockTelegramFetch as any }
      );
      const bot2 = await createBot(
        { name: "Beta Bot", token: BOT2_RAW_TOKEN },
        { customFetch: mockTelegramFetch as any }
      );

      const telegramUserId = 777888999;

      // User interacts with Bot 1 and shares phone number
      await handleTelegramStart({
        botId: bot1.id,
        telegramId: telegramUserId,
        username: "shared_user",
      });
      await handleTelegramContact({
        botId: bot1.id,
        senderTelegramId: telegramUserId,
        contactUserId: telegramUserId,
        phoneNumber: "+959111222333",
      });

      // Same user interacts with Bot 2 but DOES NOT share phone number
      await handleTelegramStart({
        botId: bot2.id,
        telegramId: telegramUserId,
        username: "shared_user",
      });

      // Query Bot 1 record
      const bot1User = await prisma.telegramUser.findUnique({
        where: {
          botId_telegramId: {
            botId: bot1.id,
            telegramId: BigInt(telegramUserId),
          },
        },
      });

      // Query Bot 2 record
      const bot2User = await prisma.telegramUser.findUnique({
        where: {
          botId_telegramId: {
            botId: bot2.id,
            telegramId: BigInt(telegramUserId),
          },
        },
      });

      expect(bot1User?.telegramPhNo).toBe("+959111222333");
      expect(bot2User?.telegramPhNo).toBeNull();
    });

    it("isolates channel posts, channels, and prevent cross-bot post attachment", async () => {
      const bot1 = await createBot(
        { name: "Alpha Bot", token: BOT1_RAW_TOKEN },
        { customFetch: mockTelegramFetch as any }
      );
      const bot2 = await createBot(
        { name: "Beta Bot", token: BOT2_RAW_TOKEN },
        { customFetch: mockTelegramFetch as any }
      );

      // Add channel to Bot 1
      const chan1 = await prisma.botChannel.create({
        data: {
          botId: bot1.id,
          name: "Alpha News",
          telegramChatId: "@alphanews",
          inviteLink: "https://t.me/alphanews",
          buttonLabel: "Join Alpha",
          order: 0,
        },
      });

      // Add channel to Bot 2
      const chan2 = await prisma.botChannel.create({
        data: {
          botId: bot2.id,
          name: "Beta VIP",
          telegramChatId: "@betavip",
          inviteLink: "https://t.me/betavip",
          buttonLabel: "Join Beta",
          order: 0,
        },
      });

      const { createDraftPost } = await import("../src/lib/post-service");

      // Attempt to create a draft for Bot 1 using Bot 2's channel
      await expect(
        createDraftPost({
          botId: bot1.id,
          channelId: chan2.id, // Bot 2 channel
          postType: "TEXT",
          content: "Malicious cross-bot post injection",
        })
      ).rejects.toThrow(/Channel.*does not belong to bot/i);

      // Safe creation for matching bot
      const validDraft = await createDraftPost({
        botId: bot1.id,
        channelId: chan1.id,
        postType: "TEXT",
        content: "Valid Bot 1 post",
      });
      expect(validDraft.id).toBeDefined();
    });
  });

  describe("4. Staff Access & Cross-Bot Security Authorization", () => {
    it("enforces least privilege so staff assigned to Bot A cannot access or mutate Bot B", async () => {
      const bot1 = await createBot(
        { name: "Alpha Bot", token: BOT1_RAW_TOKEN },
        { customFetch: mockTelegramFetch as any }
      );
      const bot2 = await createBot(
        { name: "Beta Bot", token: BOT2_RAW_TOKEN },
        { customFetch: mockTelegramFetch as any }
      );

      // Create an Editor staff user assigned ONLY to Bot 1
      const editorEmail = `editor_${Date.now()}@backstage.local`;
      const staffUser = await prisma.adminUser.create({
        data: {
          email: editorEmail,
          passwordHash: "dummyhash",
          role: "EDITOR",
          isActive: true,
        },
      });

      await prisma.staffBotAssignment.create({
        data: {
          userId: staffUser.id,
          botId: bot1.id,
          canPublish: true,
        },
      });

      const editorSession = {
        id: staffUser.id,
        email: staffUser.email,
        role: "EDITOR" as const,
        tokenVersion: 1,
      };

      // Check Bot 1 access
      expect(await hasBotAccess(editorSession, bot1.id)).toBe(true);
      expect(await canUserMutate(editorSession, bot1.id)).toBe(true);

      // Check Bot 2 access (MUST BE REJECTED)
      expect(await hasBotAccess(editorSession, bot2.id)).toBe(false);
      expect(await canUserMutate(editorSession, bot2.id)).toBe(false);

      // Cleanup staff user
      await prisma.adminUser.delete({ where: { id: staffUser.id } });
    });
  });

  describe("5. Multi-Bot Runner Concurrency & Fault Tolerance", () => {
    it("starts concurrent workers and isolates failure so an invalid token in Bot B does not halt Bot A", async () => {
      const bot1 = await createBot(
        { name: "Alpha Bot", token: BOT1_RAW_TOKEN },
        { customFetch: mockTelegramFetch as any }
      );
      const bot2 = await createBot(
        { name: "Beta Bot", token: BOT2_RAW_TOKEN },
        { customFetch: mockTelegramFetch as any }
      );

      // Deliberately corrupt Bot 2's token to simulate invalid credentials
      await prisma.bot.update({
        where: { id: bot2.id },
        data: { encryptedToken: "enc:v1:corrupted_iv:corrupted_tag:corrupted_ciphertext" },
      });

      const startedBots: string[] = [];
      const failedBots: string[] = [];

      const runner = await startMultiBotRunner({
        isTestMode: true,
        onBotStarted: (id) => startedBots.push(id),
        onBotFailed: (id) => failedBots.push(id),
      });

      // Bot 1 must have started successfully
      expect(runner.state.activeBots.has(bot1.id)).toBe(true);

      // Bot 2 must have failed gracefully without throwing unhandled exceptions
      expect(runner.state.activeBots.has(bot2.id)).toBe(false);
      expect(runner.state.standbyBots.includes(bot2.id)).toBe(true);

      await runner.stopAll();
    });
  });

  describe("6. Bot Settings, Disabling & Token Replacement", () => {
    it("enables and disables bots safely with immediate connection status update", async () => {
      const bot1 = await createBot(
        { name: "Alpha Bot", token: BOT1_RAW_TOKEN },
        { customFetch: mockTelegramFetch as any }
      );

      // Disable bot
      const disabled = await updateBot(bot1.id, { isActive: false });
      expect(disabled.isActive).toBe(false);
      expect(disabled.connectionStatus).toBe("DISCONNECTED");

      // Re-enable bot
      const reenabled = await updateBot(bot1.id, { isActive: true });
      expect(reenabled.isActive).toBe(true);
    });

    it("safely replaces a bot token after validating against the same Telegram bot ID", async () => {
      const bot1 = await createBot(
        { name: "Alpha Bot", token: BOT1_RAW_TOKEN },
        { customFetch: mockTelegramFetch as any }
      );

      const replacementToken = "11111111:NEW_SECRET_REPLACEMENT_TOKEN_1234567";
      const customFetch = vi.fn(async () => ({
        ok: true,
        json: async () => ({
          ok: true,
          result: {
            id: Number(BOT1_TELEGRAM_ID),
            is_bot: true,
            first_name: "Alpha Bot Refreshed",
            username: BOT1_USERNAME,
          },
        }),
      })) as any;

      const updated = await updateBot(
        bot1.id,
        { token: replacementToken },
        { customFetch }
      );

      expect(updated.hasStoredToken).toBe(true);
      expect(updated.tokenLast4).toBe("••••4567");

      const dbBot = await prisma.bot.findUnique({ where: { id: bot1.id } });
      const resolved = resolveBotToken(dbBot!);
      expect(resolved).toBe(replacementToken);
    });

    it("rejects token replacement if the new token belongs to an entirely different Telegram bot ID", async () => {
      const bot1 = await createBot(
        { name: "Alpha Bot", token: BOT1_RAW_TOKEN },
        { customFetch: mockTelegramFetch as any }
      );

      // Attempt to replace Bot 1's token with Bot 2's token (different Telegram bot ID)
      await expect(
        updateBot(
          bot1.id,
          { token: BOT2_RAW_TOKEN },
          { customFetch: mockTelegramFetch as any }
        )
      ).rejects.toThrow(/Token replacement mismatch/i);
    });
  });

  describe("7. Webhook Per-Bot Routing & Update Isolation", () => {
    it("routes incoming webhook updates strictly to the targeted bot ID", async () => {
      const bot1 = await createBot(
        { name: "Alpha Bot", token: BOT1_RAW_TOKEN },
        { customFetch: mockTelegramFetch as any }
      );

      process.env.TELEGRAM_MODE = "webhook";
      process.env.TELEGRAM_WEBHOOK_SECRET = "secure_webhook_secret_key_12345";

      const mockBot = {
        handleUpdate: vi.fn(async () => {}),
        api: { deleteMessage: vi.fn(async () => {}) },
      } as any;

      _setWebhookBotForTesting(mockBot, bot1.id);

      const payload = {
        update_id: 999111222,
        message: {
          message_id: 1,
          from: { id: 8888, first_name: "Test" },
          chat: { id: 8888, type: "private" },
          text: "/start",
        },
      };

      const req = new NextRequest(`http://127.0.0.1:3000/api/telegram/webhook/${bot1.id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-telegram-bot-api-secret-token": "secure_webhook_secret_key_12345",
        },
        body: JSON.stringify(payload),
      });

      const res = await webhookBotRoute(req, { params: { botId: bot1.id } });
      expect(res.status).toBe(200);
      expect(mockBot.handleUpdate).toHaveBeenCalledWith(payload);

      // Verify update claim logged in database for this specific bot
      const log = await prisma.telegramUpdateLog.findUnique({
        where: {
          botId_updateId: {
            botId: bot1.id,
            updateId: BigInt(999111222),
          },
        },
      });
      expect(log?.status).toBe("COMPLETED");

      // Reset mode
      process.env.TELEGRAM_MODE = "polling";
    });
  });
});
