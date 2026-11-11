import { Bot } from "grammy";
import { prisma } from "./prisma";
import { createTelegramBot } from "./bot-handlers";
import { processDueDeletions } from "./deletion-service";
import { resolveBotToken } from "./bot-service";
import { redactTokens } from "./token-encryption";
import { runSchedulerCycle } from "../worker/scheduler-worker";

export interface BotRunnerInstance {
  botId: string;
  botName: string;
  username: string;
  grammyBot: Bot;
  sweeperInterval: NodeJS.Timeout;
  stop: () => Promise<void>;
}

export interface MultiBotRunnerState {
  activeBots: Map<string, BotRunnerInstance>;
  standbyBots: string[];
  failedBots: Map<string, string>;
}

/**
 * Initializes and starts concurrent long-polling workers for all active bots in PostgreSQL.
 * Isolates errors per bot so one failing token does not affect other bots.
 */
export async function startMultiBotRunner(options?: {
  pollIntervalMs?: number;
  onBotStarted?: (botId: string, username: string) => void;
  onBotFailed?: (botId: string, error: string) => void;
  isTestMode?: boolean;
}): Promise<{
  state: MultiBotRunnerState;
  stopAll: () => Promise<void>;
}> {
  const activeInstances = new Map<string, BotRunnerInstance>();
  const standbyBots: string[] = [];
  const failedBots = new Map<string, string>();
  const seenTokens = new Set<string>();

  // Fetch all active bots from PostgreSQL
  const bots = await prisma.bot.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
  });

  console.log(`[Bot Runner] Found ${bots.length} active bot(s) in BackStage.`);

  for (const bot of bots) {
    const token = resolveBotToken(bot);

    if (!token) {
      console.log(
        `[Bot Runner] Bot "${bot.name}" (@${bot.username}) [${bot.id}] is in STANDBY mode (no valid token configured).`
      );
      standbyBots.push(bot.id);
      await prisma.bot
        .update({
          where: { id: bot.id },
          data: { connectionStatus: "STANDBY" },
        })
        .catch(() => {});
      continue;
    }

    // Guard against multiple bots configured with the exact same token
    if (seenTokens.has(token)) {
      const duplicateMsg =
        "Conflict: Another bot is already using this token. Skipping to prevent Telegram 409 conflict.";
      console.warn(
        `[Bot Runner] ⚠️ WARNING for "${bot.name}" (@${bot.username}): ${duplicateMsg}`
      );
      failedBots.set(bot.id, duplicateMsg);
      await prisma.bot
        .update({
          where: { id: bot.id },
          data: { connectionStatus: "ERROR", lastError: duplicateMsg },
        })
        .catch(() => {});
      continue;
    }
    seenTokens.add(token);

    try {
      // 1. Initialize grammY bot
      const grammyBot = createTelegramBot(token, bot.id);

      // 2. Set up dedicated auto-delete sweeper for this bot
      let sweeperBusy = false;
      const sweeperInterval = setInterval(async () => {
        if (sweeperBusy) return;
        sweeperBusy = true;
        try {
          const sweepRes = await processDueDeletions({
            botId: bot.id,
            deleteMessageFn: async (chatId, messageId) => {
              await grammyBot.api.deleteMessage(chatId, messageId);
            },
          });
          if (sweepRes.completedCount > 0 || sweepRes.failedCount > 0) {
            console.log(
              `[AutoDelete Sweeper - ${bot.name}] Batch complete: ${sweepRes.completedCount} deleted, ${sweepRes.failedCount} failed`
            );
          }
        } catch (sweepErr) {
          console.error(
            `[AutoDelete Sweeper Error - ${bot.name}]`,
            redactTokens(sweepErr instanceof Error ? sweepErr.message : String(sweepErr))
          );
        } finally {
          sweeperBusy = false;
        }
      }, options?.pollIntervalMs || 3000);

      // 3. Start long polling (unless in test mode where we mock polling)
      if (!options?.isTestMode) {
        grammyBot.start({
          allowed_updates: [
            "message",
            "callback_query",
            "chat_member",
            "my_chat_member",
          ],
          onStart: async (botInfo) => {
            console.log(
              `[Bot Runner] ✅ Long polling ACTIVE for "${bot.name}" (@${botInfo.username}) [ID: ${bot.id}]`
            );
            await prisma.bot
              .update({
                where: { id: bot.id },
                data: {
                  connectionStatus: "CONNECTED",
                  lastCheckedAt: new Date(),
                  lastError: null,
                },
              })
              .catch(() => {});
            options?.onBotStarted?.(bot.id, botInfo.username);
          },
        }).catch(async (pollingErr: any) => {
          const errMsg = redactTokens(
            pollingErr instanceof Error ? pollingErr.message : String(pollingErr)
          );
          console.error(
            `[Bot Runner Polling Error for "${bot.name}"] Poller stopped:`,
            errMsg
          );
          failedBots.set(bot.id, errMsg);
          await prisma.bot
            .update({
              where: { id: bot.id },
              data: { connectionStatus: "ERROR", lastError: errMsg },
            })
            .catch(() => {});
          options?.onBotFailed?.(bot.id, errMsg);
        });
      } else {
        options?.onBotStarted?.(bot.id, bot.username);
      }

      const instance: BotRunnerInstance = {
        botId: bot.id,
        botName: bot.name,
        username: bot.username,
        grammyBot,
        sweeperInterval,
        stop: async () => {
          clearInterval(sweeperInterval);
          try {
            await grammyBot.stop();
          } catch {}
        },
      };

      activeInstances.set(bot.id, instance);
    } catch (initErr: any) {
      const errMsg = redactTokens(
        initErr instanceof Error ? initErr.message : String(initErr)
      );
      console.error(
        `[Bot Runner Error] Failed to initialize bot "${bot.name}":`,
        errMsg
      );
      failedBots.set(bot.id, errMsg);
      await prisma.bot
        .update({
          where: { id: bot.id },
          data: { connectionStatus: "ERROR", lastError: errMsg },
        })
        .catch(() => {});
      options?.onBotFailed?.(bot.id, errMsg);
    }
  }

  // 4. Background Scheduled Channel Post Dispatcher
  let schedulerInterval: NodeJS.Timeout | null = null;
  if (!options?.isTestMode) {
    let schedulerBusy = false;
    schedulerInterval = setInterval(async () => {
      if (schedulerBusy) return;
      schedulerBusy = true;
      try {
        await runSchedulerCycle({
          workerId: `bot-runner-${process.pid}`,
          batchSize: 5,
        });
      } catch (schedErr) {
        // Suppress scheduled cycle errors in runner loop
      } finally {
        schedulerBusy = false;
      }
    }, 5000);
  }

  const stopAll = async () => {
    console.log("[Bot Runner] Gracefully stopping all active bot instances...");
    if (schedulerInterval) {
      clearInterval(schedulerInterval);
      schedulerInterval = null;
    }
    for (const [id, instance] of activeInstances.entries()) {
      try {
        await instance.stop();
        console.log(`[Bot Runner] Stopped poller for bot ${instance.botName} (${id})`);
      } catch (stopErr) {
        console.error(`[Bot Runner Error stopping ${id}]:`, stopErr);
      }
    }
    activeInstances.clear();
  };

  return {
    state: {
      activeBots: activeInstances,
      standbyBots,
      failedBots,
    },
    stopAll,
  };
}
