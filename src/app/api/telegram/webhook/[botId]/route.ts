import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { getWebhookBotInstance } from "@/lib/bot-handlers";
import { processDueDeletions } from "@/lib/deletion-service";
import { resolveBotToken } from "@/lib/bot-service";
import { redactTokens } from "@/lib/token-encryption";
import {
  claimTelegramUpdate,
  markTelegramUpdateCompleted,
  markTelegramUpdateFailed,
} from "@/lib/update-tracker";

// Timing-safe secret token comparison
function isSecretTokenValid(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  const bufProvided = Buffer.from(provided);
  const bufExpected = Buffer.from(expected);
  if (bufProvided.length !== bufExpected.length) return false;
  return crypto.timingSafeEqual(bufProvided, bufExpected);
}

/**
 * GET /api/telegram/webhook/[botId]
 * Webhook status endpoint for specific bot.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { botId: string } | Promise<{ botId: string }> }
) {
  const { botId } = await Promise.resolve(params);
  const bot = await prisma.bot.findUnique({
    where: { id: botId },
    select: { id: true, name: true, username: true, isActive: true, encryptedToken: true, tokenEnvVar: true },
  });

  if (!bot) {
    return NextResponse.json({ error: "Bot not found" }, { status: 404 });
  }

  const token = resolveBotToken(bot);
  const hasSecret = Boolean(
    process.env.TELEGRAM_WEBHOOK_SECRET &&
      process.env.TELEGRAM_WEBHOOK_SECRET.trim().length > 0
  );

  return NextResponse.json({
    status: "ok",
    service: "telegram-webhook-endpoint",
    botId: bot.id,
    botUsername: bot.username,
    isActive: bot.isActive,
    isWebhookReady: Boolean(hasSecret && token),
    hasSecretConfigured: hasSecret,
  });
}

/**
 * POST /api/telegram/webhook/[botId]
 * Dedicated Telegram Webhook Handler for specific bot ID.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { botId: string } | Promise<{ botId: string }> }
) {
  try {
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

    const { botId } = await Promise.resolve(params);

    // 1. Secret Token Verification
    const secretTokenHeader =
      req.headers.get("x-telegram-bot-api-secret-token") || "";
    const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET || "";

    if (!expectedSecret || !isSecretTokenValid(secretTokenHeader, expectedSecret)) {
      console.warn(
        `[Webhook Guard] Rejected webhook request for bot ${botId}: Invalid or missing secret token.`
      );
      return NextResponse.json(
        { error: "Unauthorized: Invalid webhook secret token" },
        { status: 403 }
      );
    }

    // 2. Fetch bot and resolve token
    const bot = await prisma.bot.findUnique({
      where: { id: botId },
      select: {
        id: true,
        name: true,
        username: true,
        isActive: true,
        encryptedToken: true,
        tokenEnvVar: true,
      },
    });

    if (!bot) {
      return NextResponse.json({ error: "Bot not found" }, { status: 404 });
    }

    if (!bot.isActive) {
      return NextResponse.json(
        { error: "Bot is currently inactive / disabled in BackStage." },
        { status: 403 }
      );
    }

    const token = resolveBotToken(bot) || (process.env.NODE_ENV === "test" ? "test_token" : null);

    if (!token) {
      return NextResponse.json(
        { error: "Server error: Bot token could not be resolved." },
        { status: 500 }
      );
    }

    // 3. Parse incoming Telegram Update
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

    // 4. Durable, Bot-Scoped Update Claiming & Concurrency Lock
    const claim = await claimTelegramUpdate(bot.id, update.update_id);

    if (claim.status === "ALREADY_COMPLETED") {
      console.log(
        `[Webhook] Skipped already completed update_id ${update.update_id} for bot ${bot.id}`
      );
      return NextResponse.json({ ok: true, duplicate: true });
    }

    if (claim.status === "CONCURRENT_LOCKED") {
      console.warn(
        `[Webhook Guard] Concurrent update in flight for update_id ${update.update_id} (bot ${bot.id})`
      );
      return NextResponse.json(
        {
          error: "Conflict: Update is currently being processed by another worker",
          duplicate: true,
        },
        { status: 409 }
      );
    }

    // 5. Process update with grammY bot
    try {
      const grammyBot = getWebhookBotInstance(token, bot.id);
      await grammyBot.handleUpdate(update);
      await markTelegramUpdateCompleted(bot.id, update.update_id);
    } catch (processErr: any) {
      const errorMsg = String(
        processErr?.message || processErr || "Unknown processing error"
      );
      await markTelegramUpdateFailed(bot.id, update.update_id, errorMsg);
      throw processErr;
    }

    // 6. Opportunistic Sweeper for this bot
    processDueDeletions({
      botId: bot.id,
      deleteMessageFn: async (chatId, messageId) => {
        const grammyBot = getWebhookBotInstance(token, bot.id);
        await grammyBot.api.deleteMessage(chatId, messageId);
      },
    }).catch((sweepErr) => {
      console.error(
        `[Webhook Opportunistic Sweeper Error for ${bot.id}]`,
        sweepErr instanceof Error ? sweepErr.message : sweepErr
      );
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const errorStr = String(err?.message || err || "Internal server error");
    const sanitizedError = redactTokens(errorStr);
    console.error("[Webhook Error]", sanitizedError);
    return NextResponse.json({ error: "Webhook processing error" }, { status: 500 });
  }
}
