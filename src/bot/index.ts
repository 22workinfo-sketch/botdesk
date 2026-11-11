import dotenv from "dotenv";
import { startMultiBotRunner } from "../lib/multi-bot-runner";
import { startSchedulerWorker } from "../worker/scheduler-worker";

dotenv.config();

// Mode guard: Warn if TELEGRAM_MODE is explicitly set to webhook
if (process.env.TELEGRAM_MODE === "webhook") {
  console.warn(
    "⚠️ WARNING: TELEGRAM_MODE is set to 'webhook'. Running long polling simultaneously will conflict with webhook delivery. Stop this process if a webhook is active."
  );
}

console.log("=============================================================");
console.log(" [BackStage Multi-Bot Service Runner & Post Scheduler]");
console.log("=============================================================");
console.log("Initializing concurrent Telegram bot pollers & post scheduler...");

async function main() {
  // 1. Start the Background Post Scheduler Worker
  const scheduler = await startSchedulerWorker();

  // 2. Start Concurrent Multi-Bot Polling Workers
  const runner = await startMultiBotRunner({
    onBotStarted: (botId, username) => {
      console.log(`[Bot Ready] Bot @${username} (${botId}) is now listening for messages.`);
    },
    onBotFailed: (botId, error) => {
      console.error(`[Bot Error] Bot (${botId}) encountered an error: ${error}`);
    },
  });

  const activeCount = runner.state.activeBots.size;
  const standbyCount = runner.state.standbyBots.length;
  const failedCount = runner.state.failedBots.size;

  console.log("-------------------------------------------------------------");
  console.log(`[Bot Runner Summary] ${activeCount} active, ${standbyCount} standby, ${failedCount} failed`);
  console.log("[Scheduler Worker] Monitoring PostgreSQL every 5s for due scheduled posts.");

  if (activeCount === 0 && standbyCount > 0) {
    console.log("");
    console.log("ℹ️ No bots are currently actively polling with a live token.");
    console.log("You can add bot tokens in two ways:");
    console.log("  1. In the BackStage Dashboard: Click '+ Add bot' and paste your BotFather token.");
    console.log("  2. In your local .env file: Set TELEGRAM_BOT_TOKEN=\"<token>\".");
    console.log("Press Ctrl+C to stop.");
  } else {
    console.log("Ready to receive Telegram messages & dispatch posts. Press Ctrl+C to stop.");
  }
  console.log("=============================================================");

  const shutdown = async () => {
    console.log("\n[Bot Runner] Stopping scheduler and bot workers gracefully...");
    await scheduler.stop();
    await runner.stopAll();
    process.exit(0);
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[Fatal Bot Runner Error]", err);
  process.exit(1);
});
