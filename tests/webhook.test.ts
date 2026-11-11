import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import {
  GET as webhookGET,
  POST as webhookPOST,
} from "../src/app/api/telegram/webhook/route";
import { POST as loginPOST } from "../src/app/api/auth/login/route";
import { POST as logoutPOST } from "../src/app/api/auth/logout/route";
import { PUT as configPUT } from "../src/app/api/bots/[id]/config/route";
import { PUT as menuPUT } from "../src/app/api/bots/[id]/menu/route";
import { PUT as channelsPUT } from "../src/app/api/bots/[id]/channels/route";
import {
  createTelegramBot,
  _setWebhookBotForTesting,
} from "../src/lib/bot-handlers";
import { _clearRateLimitsForTesting } from "../src/lib/rate-limit";
import {
  claimTelegramUpdate,
  markTelegramUpdateCompleted,
  markTelegramUpdateFailed,
  _clearTelegramUpdateLogsForTesting,
} from "../src/lib/update-tracker";
import { prisma } from "../src/lib/prisma";
import { createSessionToken, COOKIE_NAME } from "../src/lib/auth";

describe("Telegram Webhook Route & Public Hardening Security", () => {
  const originalEnv = { ...process.env };
  const TEST_SECRET = "super_secure_webhook_secret_token_123456789";
  const TEST_BOT_ID = "00000000-0000-0000-0000-000000000001";

  beforeEach(async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = TEST_SECRET;
    process.env.TELEGRAM_MODE = "webhook";
    process.env.TELEGRAM_BOT_TOKEN = "123456789:ABCdefGHIjklMNOpqrSTUvwxYZ_test_mock";
    _clearRateLimitsForTesting();
    await _clearTelegramUpdateLogsForTesting();

    // Setup isolated mock bot that intercepts all Telegram API calls (no outbound HTTP requests)
    const mockBot = createTelegramBot("123456789:mock_token", TEST_BOT_ID);
    mockBot.api.config.use(async (_prev, method, payload) => {
      if (method === "sendMessage") {
        return {
          ok: true,
          result: {
            message_id: 8888,
            date: Math.floor(Date.now() / 1000),
            chat: { id: (payload as any).chat_id, type: "private" },
            text: (payload as any).text,
          },
        } as any;
      }
      return { ok: true, result: true } as any;
    });

    _setWebhookBotForTesting(mockBot);
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    _clearRateLimitsForTesting();
    _setWebhookBotForTesting(null);
    await _clearTelegramUpdateLogsForTesting();
  });

  describe("Webhook Secret & Mode Guards", () => {
    it("GET /api/telegram/webhook returns health info without leaking secret", async () => {
      const res = await webhookGET();
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.status).toBe("ok");
      expect(data.service).toBe("telegram-webhook-endpoint");
      expect(data.mode).toBe("webhook");
      expect(data.hasSecretConfigured).toBe(true);
      expect(data.isWebhookReady).toBe(true);
      // Verify secrets are NEVER exposed in response
      expect(data.secret).toBeUndefined();
      expect(data.token).toBeUndefined();
    });

    it("POST /api/telegram/webhook rejects requests with missing secret token header (403)", async () => {
      const req = new NextRequest("http://127.0.0.1:3000/api/telegram/webhook", {
        method: "POST",
        body: JSON.stringify({ update_id: 1001 }),
      });

      const res = await webhookPOST(req);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("Invalid webhook secret token");
    });

    it("POST /api/telegram/webhook rejects requests with incorrect secret token (403)", async () => {
      const req = new NextRequest("http://127.0.0.1:3000/api/telegram/webhook", {
        method: "POST",
        headers: {
          "x-telegram-bot-api-secret-token": "wrong_token_guess",
        },
        body: JSON.stringify({ update_id: 1002 }),
      });

      const res = await webhookPOST(req);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("Invalid webhook secret token");
    });

    it("POST /api/telegram/webhook rejects requests when bot is configured in polling mode (503)", async () => {
      process.env.TELEGRAM_MODE = "polling";

      const req = new NextRequest("http://127.0.0.1:3000/api/telegram/webhook", {
        method: "POST",
        headers: {
          "x-telegram-bot-api-secret-token": TEST_SECRET,
        },
        body: JSON.stringify({ update_id: 1003 }),
      });

      const res = await webhookPOST(req);
      expect(res.status).toBe(503);
      const data = await res.json();
      expect(data.error).toContain("configured for long polling mode");
    });

    it("POST /api/telegram/webhook rejects malformed JSON or missing update_id (400)", async () => {
      const req = new NextRequest("http://127.0.0.1:3000/api/telegram/webhook", {
        method: "POST",
        headers: {
          "x-telegram-bot-api-secret-token": TEST_SECRET,
        },
        body: JSON.stringify({ message: { text: "hello" } }), // Missing update_id
      });

      const res = await webhookPOST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Missing or invalid update_id");
    });
  });

  describe("Durable Webhook Processing & Concurrency Protection", () => {
    it("handles duplicate update_ids idempotently without re-executing", async () => {
      const updatePayload = {
        update_id: 888123,
        message: {
          message_id: 501,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 99999, type: "private" },
          from: { id: 99999, is_bot: false, first_name: "Test" },
          text: "/start",
        },
      };

      const req1 = new NextRequest("http://127.0.0.1:3000/api/telegram/webhook", {
        method: "POST",
        headers: {
          "x-telegram-bot-api-secret-token": TEST_SECRET,
        },
        body: JSON.stringify(updatePayload),
      });

      const res1 = await webhookPOST(req1);
      expect(res1.status).toBe(200);
      const data1 = await res1.json();
      expect(data1.ok).toBe(true);

      // Verify recorded in PostgreSQL with status COMPLETED
      const log = await prisma.telegramUpdateLog.findUnique({
        where: {
          botId_updateId: {
            botId: TEST_BOT_ID,
            updateId: BigInt(888123),
          },
        },
      });
      expect(log).not.toBeNull();
      expect(log?.status).toBe("COMPLETED");

      // Repeat request with exact same update_id (Telegram retry simulation)
      const req2 = new NextRequest("http://127.0.0.1:3000/api/telegram/webhook", {
        method: "POST",
        headers: {
          "x-telegram-bot-api-secret-token": TEST_SECRET,
        },
        body: JSON.stringify(updatePayload),
      });

      const res2 = await webhookPOST(req2);
      expect(res2.status).toBe(200);
      const data2 = await res2.json();
      expect(data2.ok).toBe(true);
      expect(data2.duplicate).toBe(true);
    });

    it("prevents duplicate execution on same update delivered concurrently (409 Conflict)", async () => {
      // Simulate update currently in PROCESSING within active lease window
      await prisma.telegramUpdateLog.create({
        data: {
          botId: TEST_BOT_ID,
          updateId: BigInt(888200),
          status: "PROCESSING",
        },
      });

      const req = new NextRequest("http://127.0.0.1:3000/api/telegram/webhook", {
        method: "POST",
        headers: {
          "x-telegram-bot-api-secret-token": TEST_SECRET,
        },
        body: JSON.stringify({
          update_id: 888200,
          message: {
            message_id: 502,
            date: Math.floor(Date.now() / 1000),
            chat: { id: 99999, type: "private" },
            from: { id: 99999, is_bot: false, first_name: "Test" },
            text: "/start",
          },
        }),
      });

      const res = await webhookPOST(req);
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.error).toContain("Conflict");
      expect(data.duplicate).toBe(true);
    });

    it("records failure on processing error (500) and recovers on subsequent retry (200)", async () => {
      // Configure mock bot to throw an error
      const failingBot = createTelegramBot("123456789:mock_token", TEST_BOT_ID);
      failingBot.api.config.use(async () => {
        throw new Error("Telegram API transient connection dropped");
      });
      _setWebhookBotForTesting(failingBot);

      const updatePayload = {
        update_id: 888300,
        message: {
          message_id: 503,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 99999, type: "private" },
          from: { id: 99999, is_bot: false, first_name: "Test" },
          text: "/start",
          entities: [{ type: "bot_command", offset: 0, length: 6 }],
        },
      };

      const req1 = new NextRequest("http://127.0.0.1:3000/api/telegram/webhook", {
        method: "POST",
        headers: {
          "x-telegram-bot-api-secret-token": TEST_SECRET,
        },
        body: JSON.stringify(updatePayload),
      });

      // 1. Initial attempt fails -> returns 500, marked FAILED in DB
      const res1 = await webhookPOST(req1);
      expect(res1.status).toBe(500);

      const failedLog = await prisma.telegramUpdateLog.findUnique({
        where: {
          botId_updateId: {
            botId: TEST_BOT_ID,
            updateId: BigInt(888300),
          },
        },
      });
      expect(failedLog?.status).toBe("FAILED");
      expect(failedLog?.lastError).toContain("Telegram API transient connection dropped");

      // 2. Fix the transient error and simulate Telegram retry
      const healthyBot = createTelegramBot("123456789:mock_token", TEST_BOT_ID);
      healthyBot.api.config.use(async () => ({ ok: true, result: true } as any));
      _setWebhookBotForTesting(healthyBot);

      const req2 = new NextRequest("http://127.0.0.1:3000/api/telegram/webhook", {
        method: "POST",
        headers: {
          "x-telegram-bot-api-secret-token": TEST_SECRET,
        },
        body: JSON.stringify(updatePayload),
      });

      const res2 = await webhookPOST(req2);
      expect(res2.status).toBe(200);
      const data2 = await res2.json();
      expect(data2.ok).toBe(true);

      const recoveredLog = await prisma.telegramUpdateLog.findUnique({
        where: {
          botId_updateId: {
            botId: TEST_BOT_ID,
            updateId: BigInt(888300),
          },
        },
      });
      expect(recoveredLog?.status).toBe("COMPLETED");
    });

    it("reclaims expired PROCESSING claims after container crash / timeout (>60s)", async () => {
      // Simulate an uncompleted job stuck in PROCESSING from 75 seconds ago
      const staleTime = new Date(Date.now() - 75 * 1000);
      await prisma.telegramUpdateLog.create({
        data: {
          botId: TEST_BOT_ID,
          updateId: BigInt(888400),
          status: "PROCESSING",
          createdAt: staleTime,
          updatedAt: staleTime,
        },
      });

      const updatePayload = {
        update_id: 888400,
        message: {
          message_id: 504,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 99999, type: "private" },
          from: { id: 99999, is_bot: false, first_name: "Test" },
          text: "/start",
        },
      };

      const req = new NextRequest("http://127.0.0.1:3000/api/telegram/webhook", {
        method: "POST",
        headers: {
          "x-telegram-bot-api-secret-token": TEST_SECRET,
        },
        body: JSON.stringify(updatePayload),
      });

      const res = await webhookPOST(req);
      expect(res.status).toBe(200);

      const log = await prisma.telegramUpdateLog.findUnique({
        where: {
          botId_updateId: {
            botId: TEST_BOT_ID,
            updateId: BigInt(888400),
          },
        },
      });
      expect(log?.status).toBe("COMPLETED");
    });

    it("isolates update IDs across different bots (Bot A vs Bot B)", async () => {
      const botAlpha = "synth-bot-alpha-1111";
      const botBeta = "synth-bot-beta-2222";
      const sharedUpdateId = 999555;

      // Bot Alpha claims update 999555
      const claimA = await claimTelegramUpdate(botAlpha, sharedUpdateId);
      expect(claimA.status).toBe("CLAIMED");
      await markTelegramUpdateCompleted(botAlpha, sharedUpdateId);

      // Bot Beta claims update 999555 with exact same ID
      const claimB = await claimTelegramUpdate(botBeta, sharedUpdateId);
      expect(claimB.status).toBe("CLAIMED");
      await markTelegramUpdateCompleted(botBeta, sharedUpdateId);

      // Verify both exist independently in PostgreSQL
      const logA = await prisma.telegramUpdateLog.findUnique({
        where: { botId_updateId: { botId: botAlpha, updateId: BigInt(sharedUpdateId) } },
      });
      const logB = await prisma.telegramUpdateLog.findUnique({
        where: { botId_updateId: { botId: botBeta, updateId: BigInt(sharedUpdateId) } },
      });

      expect(logA?.status).toBe("COMPLETED");
      expect(logB?.status).toBe("COMPLETED");

      // Cleanup
      await _clearTelegramUpdateLogsForTesting(botAlpha);
      await _clearTelegramUpdateLogsForTesting(botBeta);
    });
  });

  describe("Admin Security & CSRF Origin Protection", () => {
    it("POST /api/auth/logout rejects requests with mismatched origin", async () => {
      const req = new NextRequest("http://127.0.0.1:3000/api/auth/logout", {
        method: "POST",
        headers: {
          host: "127.0.0.1:3000",
          origin: "https://evil-attacker-site.com",
        },
      });

      const res = await logoutPOST(req);
      expect(res.status).toBe(403);
    });

    it("PUT /api/bots/[id]/config rejects requests with mismatched origin", async () => {
      const req = new NextRequest("http://127.0.0.1:3000/api/bots/test-id/config", {
        method: "PUT",
        headers: {
          host: "127.0.0.1:3000",
          origin: "https://evil-attacker-site.com",
        },
        body: JSON.stringify({ welcomeMessage: "hacked" }),
      });

      const res = await configPUT(req, { params: { id: "test-id" } });
      expect(res.status).toBe(403);
    });

    it("PUT /api/bots/[id]/menu rejects requests with mismatched origin", async () => {
      const req = new NextRequest("http://127.0.0.1:3000/api/bots/test-id/menu", {
        method: "PUT",
        headers: {
          host: "127.0.0.1:3000",
          origin: "https://evil-attacker-site.com",
        },
        body: JSON.stringify({ buttons: [] }),
      });

      const res = await menuPUT(req, { params: { id: "test-id" } });
      expect(res.status).toBe(403);
    });

    it("PUT /api/bots/[id]/channels rejects requests with mismatched origin", async () => {
      const req = new NextRequest("http://127.0.0.1:3000/api/bots/test-id/channels", {
        method: "PUT",
        headers: {
          host: "127.0.0.1:3000",
          origin: "https://evil-attacker-site.com",
        },
        body: JSON.stringify({ channels: [] }),
      });

      const res = await channelsPUT(req, { params: { id: "test-id" } });
      expect(res.status).toBe(403);
    });

    it("mutation routes reject VIEWER role with 403 Forbidden", async () => {
      const viewerToken = await createSessionToken({
        id: "viewer-uuid-123",
        email: "viewer@local.test",
        role: "VIEWER",
      });

      const req = new NextRequest("http://127.0.0.1:3000/api/bots/test-id/config", {
        method: "PUT",
        headers: {
          host: "127.0.0.1:3000",
          cookie: `${COOKIE_NAME}=${viewerToken}`,
        },
        body: JSON.stringify({ welcomeMessage: "attempt" }),
      });

      const res = await configPUT(req, { params: { id: "test-id" } });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("Insufficient privileges");
    });
  });

  describe("Login Hardening & Rate Limiting", () => {
    it("rejects login requests when Origin does not match Host (CSRF Guard)", async () => {
      const req = new NextRequest("http://127.0.0.1:3000/api/auth/login", {
        method: "POST",
        headers: {
          host: "127.0.0.1:3000",
          origin: "https://malicious-evil-site.com",
        },
        body: JSON.stringify({ email: "admin@local.test", password: "wrong" }),
      });

      const res = await loginPOST(req);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("Origin verification failed");
    });

    it("enforces brute-force rate limiting after 5 consecutive failed login attempts (429)", async () => {
      const attemptLogin = async () => {
        const req = new NextRequest("http://127.0.0.1:3000/api/auth/login", {
          method: "POST",
          headers: {
            "x-forwarded-for": "198.51.100.42",
          },
          body: JSON.stringify({
            email: "bruteforce@target.test",
            password: "wrong_password_attempt",
          }),
        });
        return loginPOST(req);
      };

      // 1st through 5th failed attempts return 401
      for (let i = 1; i <= 5; i++) {
        const res = await attemptLogin();
        expect(res.status).toBe(401);
      }

      // 6th attempt must be blocked by rate limiter with 429 Too Many Requests
      const blockedRes = await attemptLogin();
      expect(blockedRes.status).toBe(429);
      const data = await blockedRes.json();
      expect(data.error).toContain("Too many failed login attempts");
    });
  });
});
