import crypto from "crypto";
import dotenv from "dotenv";
import {
  recoverStalledScheduledPosts,
  claimDueScheduledPosts,
  executeClaimedScheduledPost,
} from "../lib/post-service";
import { redactTokens } from "../lib/token-encryption";

dotenv.config();

export interface SchedulerWorkerOptions {
  workerId?: string;
  pollIntervalMs?: number;
  batchSize?: number;
  leaseDurationMs?: number;
  maxRetries?: number;
  customApi?: any;
}

/**
 * Executes a single complete cycle of the post scheduler:
 * 1. Recovers stalled SENDING leases (crash resilience).
 * 2. Atomically claims due posts.
 * 3. Dispatches claimed posts to Telegram channels.
 */
export async function runSchedulerCycle(options?: SchedulerWorkerOptions): Promise<{
  recoveredCount: number;
  claimedCount: number;
  dispatchedSuccess: number;
  dispatchedFailed: number;
}> {
  const workerId =
    options?.workerId ||
    `worker-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  const batchSize = options?.batchSize || 10;
  const leaseDurationMs = options?.leaseDurationMs || 120000;
  const maxRetries = options?.maxRetries || 3;

  // 1. Recover stalled leases from crashed workers
  const { recoveredCount } = await recoverStalledScheduledPosts({
    maxRetries,
  });

  if (recoveredCount > 0) {
    console.log(
      `[Scheduler Worker] Reclaimed ${recoveredCount} stalled post lease(s).`
    );
  }

  // 2. Atomically claim due posts
  const claimedPostIds = await claimDueScheduledPosts({
    workerId,
    batchSize,
    leaseDurationMs,
  });

  let dispatchedSuccess = 0;
  let dispatchedFailed = 0;

  // 3. Process claimed posts
  for (const postId of claimedPostIds) {
    try {
      console.log(
        `[Scheduler Worker] Dispatching scheduled post "${postId}" (Worker: ${workerId})...`
      );
      const result = await executeClaimedScheduledPost(
        postId,
        workerId,
        options?.customApi
      );

      if (result.success) {
        dispatchedSuccess++;
        console.log(
          `[Scheduler Worker] Successfully published post "${postId}" (Telegram Msg #${result.messageId}).`
        );
      } else {
        dispatchedFailed++;
        console.warn(
          `[Scheduler Worker] Post "${postId}" dispatch ended in ${result.status}: ${redactTokens(result.error || "Unknown error")}`
        );
      }
    } catch (err: any) {
      dispatchedFailed++;
      console.error(
        `[Scheduler Worker] Unexpected error dispatching post "${postId}":`,
        redactTokens(err?.message || String(err))
      );
    }
  }

  return {
    recoveredCount,
    claimedCount: claimedPostIds.length,
    dispatchedSuccess,
    dispatchedFailed,
  };
}

/**
 * Starts a continuous scheduler background worker process.
 */
export async function startSchedulerWorker(options?: SchedulerWorkerOptions): Promise<{
  stop: () => Promise<void>;
}> {
  const pollIntervalMs = options?.pollIntervalMs || Number(process.env.SCHEDULER_POLL_INTERVAL_MS) || 5000;
  const workerId =
    options?.workerId ||
    `worker-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;

  let isRunning = true;
  let isCycleActive = false;

  console.log(`[Scheduler Worker] Initializing worker "${workerId}" (Poll interval: ${pollIntervalMs}ms)...`);

  const intervalTimer = setInterval(async () => {
    if (!isRunning || isCycleActive) return;
    isCycleActive = true;
    try {
      await runSchedulerCycle({ ...options, workerId });
    } catch (err) {
      console.error(
        "[Scheduler Worker] Uncaught cycle error:",
        redactTokens(err instanceof Error ? err.message : String(err))
      );
    } finally {
      isCycleActive = false;
    }
  }, pollIntervalMs);

  // Run initial cycle immediately
  isCycleActive = true;
  runSchedulerCycle({ ...options, workerId })
    .catch((err) => {
      console.error(
        "[Scheduler Worker] Initial cycle error:",
        redactTokens(err instanceof Error ? err.message : String(err))
      );
    })
    .finally(() => {
      isCycleActive = false;
    });

  const stop = async () => {
    console.log(`[Scheduler Worker] Stopping worker "${workerId}"...`);
    isRunning = false;
    clearInterval(intervalTimer);
    let waitCount = 0;
    while (isCycleActive && waitCount < 20) {
      await new Promise((r) => setTimeout(r, 200));
      waitCount++;
    }
    console.log(`[Scheduler Worker] Worker "${workerId}" stopped gracefully.`);
  };

  return { stop };
}

// Standalone execution when run directly via CLI (e.g. `npm run scheduler`)
if (require.main === module) {
  startSchedulerWorker().then(({ stop }) => {
    const handleExit = async () => {
      await stop();
      process.exit(0);
    };

    process.on("SIGINT", handleExit);
    process.on("SIGTERM", handleExit);
  });
}
