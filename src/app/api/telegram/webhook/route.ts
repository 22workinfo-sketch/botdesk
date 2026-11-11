import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getWebhookBotInstance } from "@/lib/bot-handlers";
import { processDueDeletions } from "@/lib/deletion-service";
import {
  claimTelegramUpdate,
  markTelegramUpdateCompleted,
  markTelegramUpdateFailed,
} from "@/lib/update-tracker";
import type { Bot } from "grammy";

// Timing-safe secret token comparison
function isSecretTokenValid(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  const bufProvided = Buffer.from(provided);
  const bufExpected = Buffer.from(expected);
  if (bufProvided.length !== bufExpected.length) return false;
  return crypto.timingSafeEqual(bufProvided, bufExpected);
}

/**
 * GET /api/telegram/webhook
 * Health check & status endpoint (never exposes tokens or secrets)
 */
export async function GET() {
  const configuredMode = process.env.TELEGRAM_MODE || "polling";
  const hasSecret = Boolean(
    process.env.TELEGRAM_WEBHOOK_SECRET &&
      process.env.TELEGRAM_WEBHOOK_SECRET.trim().length > 0
  );
  const tokenConfigured = Boolean(
    process.env.TELEGRAM_BOT_TOKEN &&
      !process.env.TELEGRAM_BOT_TOKEN.includes("placeholder")
  );

  return NextResponse.json({
    status: "ok",
    service: "telegram-webhook-endpoint",
    mode: configuredMode,
    isWebhookReady: hasSecret && tokenConfigured,
    hasSecretConfigured: hasSecret,
  });
}

/**
 * POST /api/telegram/webhook
 * Secure Telegram Webhook Handler
 */
export async function POST(req: NextRequest) {
  try {
    // 1. Polling Mode Guard: Prevent webhook execution if server is configured for long polling
    const mode = process.env.TELEGRAM_MODE || "polling";
    if (mode === "polling") {
      return NextResponse.json(
        {
          error:
            "Webhook disabled: Server is configured for long polling mode (TELEGRAM_MODE=polling).",
        },
        { status: 503 }
      );
    }

    // 2. Secret Token Verification: Verify X-Telegram-Bot-Api-Secret-Token
    const secretTokenHeader = req.headers.get("x-telegram-bot-api-secret-token") || "";
    const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET || "";

    if (!expectedSecret || !isSecretTokenValid(secretTokenHeader, expectedSecret)) {
      console.warn("[Webhook Guard] Rejected webhook request: Invalid or missing secret token.");
      return NextResponse.json(
        { error: "Unauthorized: Invalid webhook secret token" },
        { status: 403 }
      );
    }

    // 3. Resolve Bot Token & Bot ID (supports ?botId= or default single bot)
    const queryBotId = req.nextUrl?.searchParams?.get("botId");
    let botId =
      queryBotId ||
      process.env.BOT_DEFAULT_ID ||
      "00000000-0000-0000-0000-000000000001";

    let token = process.env.TELEGRAM_BOT_TOKEN;

    if (queryBotId) {
      const { prisma } = await import("@/lib/prisma");
      const { resolveBotToken } = await import("@/lib/bot-service");
      const dbBot = await prisma.bot.findUnique({
        where: { id: queryBotId },
        select: { id: true, encryptedToken: true, tokenEnvVar: true, isActive: true },
      });
      if (dbBot) {
        if (!dbBot.isActive) {
          return NextResponse.json(
            { error: "Bot is inactive in BackStage." },
            { status: 403 }
          );
        }
        const resolved = resolveBotToken(dbBot);
        if (resolved) token = resolved;
      }
    }

    if (!token || token.includes("placeholder") || token.trim() === "") {
      return NextResponse.json(
        { error: "Server error: Telegram bot token not configured." },
        { status: 500 }
      );
    }

    // 4. Parse incoming Telegram Update
    let update: any;
    try {
      update = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Bad Request: Malformed JSON payload" },
        { status: 400 }
      );
    }

    if (!update || typeof update.update_id !== "number") {
      return NextResponse.json(
        { error: "Bad Request: Missing or invalid update_id" },
        { status: 400 }
      );
    }

    // 5. Durable, Bot-Scoped Update Claiming & Concurrency Lock
    const claim = await claimTelegramUpdate(botId, update.update_id);

    if (claim.status === "ALREADY_COMPLETED") {
      console.log(
        `[Webhook] Skipped already completed update_id ${update.update_id} for bot ${botId}`
      );
      return NextResponse.json({ ok: true, duplicate: true });
    }

    if (claim.status === "CONCURRENT_LOCKED") {
      console.warn(
        `[Webhook Guard] Concurrent update in flight for update_id ${update.update_id} (bot ${botId})`
      );
      return NextResponse.json(
        {
          error: "Conflict: Update is currently being processed by another worker",
          duplicate: true,
        },
        { status: 409 }
      );
    }

    // 6. Process the update with grammY bot
    try {
      const bot = getWebhookBotInstance(token, botId);
      await bot.handleUpdate(update);
      await markTelegramUpdateCompleted(botId, update.update_id);
    } catch (processErr: any) {
      const errorMsg = String(
        processErr?.message || processErr || "Unknown processing error"
      );
      await markTelegramUpdateFailed(botId, update.update_id, errorMsg);
      throw processErr;
    }

    // 7. Opportunistic Sweeper: Process any due message deletions while the container is awake
    processDueDeletions({
      botId,
      deleteMessageFn: async (chatId, messageId) => {
        const bot = getWebhookBotInstance(token, botId);
        await bot.api.deleteMessage(chatId, messageId);
      },
    }).catch((sweepErr) => {
      console.error(
        "[Webhook Opportunistic Sweeper Error]",
        sweepErr instanceof Error ? sweepErr.message : sweepErr
      );
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const errorStr = String(err?.message || err || "Internal server error");
    const sanitizedError = errorStr.replace(
      /\d+:[A-Za-z0-9_-]{35}/g,
      "[REDACTED_BOT_TOKEN]"
    );
    console.error("[Webhook Error]", sanitizedError);
    return NextResponse.json({ error: "Webhook processing error" }, { status: 500 });
  }
}
