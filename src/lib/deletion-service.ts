import { prisma } from "./prisma";

export interface ScheduleDeletionInput {
  botId: string;
  chatId: string;
  messageId: number;
  deleteAfterSeconds: number;
}

export interface ProcessDeletionsOptions {
  botId?: string;
  deleteMessageFn: (chatId: string, messageId: number) => Promise<void | boolean>;
  maxBatchSize?: number;
}

/**
 * Schedules a message deletion job in PostgreSQL.
 * Starts countdown strictly after the bot confirms the message was sent.
 */
export async function scheduleMessageDeletion(input: ScheduleDeletionInput) {
  const seconds = Math.floor(input.deleteAfterSeconds);

  if (isNaN(seconds) || seconds < 5 || seconds > 86400) {
    throw new Error(
      `Invalid auto-delete delay: ${input.deleteAfterSeconds}. Must be an integer between 5 and 86400 seconds (24 hours).`
    );
  }

  const deleteAt = new Date(Date.now() + seconds * 1000);

  const job = await prisma.scheduledDeletion.create({
    data: {
      botId: input.botId,
      chatId: input.chatId,
      messageId: input.messageId,
      deleteAt,
      status: "PENDING",
      retryCount: 0,
    },
  });

  return job;
}

/**
 * Sweeps and executes due deletion jobs.
 * Uses atomic status claiming to prevent duplicate execution across overlapping sweeps or workers.
 * Resumes pending jobs on worker restart.
 */
export async function processDueDeletions(options: ProcessDeletionsOptions) {
  const now = new Date();
  const batchSize = options.maxBatchSize ?? 25;

  // 0. Recover stalled PROCESSING jobs (abandoned due to crash or container sleep > 5 min)
  const staleThreshold = new Date(Date.now() - 5 * 60 * 1000);
  try {
    await prisma.scheduledDeletion.updateMany({
      where: {
        ...(options.botId ? { botId: options.botId } : {}),
        status: "PROCESSING",
        updatedAt: { lte: staleThreshold },
      },
      data: {
        status: "PENDING",
        retryCount: { increment: 1 },
        lastError: "Reclaimed after stalled processing lease expired",
        updatedAt: now,
      },
    });
  } catch (recoverErr) {
    console.error(
      "[Deletion Recovery Error] Failed to recover stalled jobs:",
      recoverErr instanceof Error ? recoverErr.message : recoverErr
    );
  }

  // 1. Atomically claim due jobs: transition from PENDING to PROCESSING
  const dueJobs = await prisma.scheduledDeletion.findMany({
    where: {
      ...(options.botId ? { botId: options.botId } : {}),
      status: "PENDING",
      deleteAt: { lte: now },
      retryCount: { lt: 3 },
    },
    take: batchSize,
    orderBy: { deleteAt: "asc" },
  });

  if (dueJobs.length === 0) {
    return { claimedCount: 0, completedCount: 0, failedCount: 0 };
  }

  const claimedJobIds: string[] = [];
  for (const job of dueJobs) {
    // Conditional update ensures only one worker claims the job
    const updated = await prisma.scheduledDeletion.updateMany({
      where: {
        id: job.id,
        status: "PENDING",
      },
      data: {
        status: "PROCESSING",
      },
    });

    if (updated.count > 0) {
      claimedJobIds.push(job.id);
    }
  }

  const jobsToProcess = dueJobs.filter((j) => claimedJobIds.includes(j.id));
  let completedCount = 0;
  let failedCount = 0;

  for (const job of jobsToProcess) {
    try {
      await options.deleteMessageFn(job.chatId, job.messageId);

      // Successfully deleted
      await prisma.scheduledDeletion.update({
        where: { id: job.id },
        data: {
          status: "COMPLETED",
          updatedAt: new Date(),
        },
      });
      completedCount++;
    } catch (err: any) {
      const errorMsg = String(err?.message || err || "Unknown deletion failure");

      // Check if message was already deleted or doesn't exist anymore
      const isAlreadyGone =
        errorMsg.toLowerCase().includes("message to delete not found") ||
        errorMsg.toLowerCase().includes("bad request: message to delete not found");

      // Check if message is permanently non-deletable (e.g. >48 hours in Telegram)
      const isPermanentFailure =
        isAlreadyGone ||
        errorMsg.toLowerCase().includes("message can't be deleted") ||
        errorMsg.toLowerCase().includes("chat not found");

      if (isAlreadyGone) {
        // Message is already gone; job goal achieved
        await prisma.scheduledDeletion.update({
          where: { id: job.id },
          data: {
            status: "COMPLETED",
            lastError: "Message was already deleted",
            updatedAt: new Date(),
          },
        });
        completedCount++;
      } else if (isPermanentFailure) {
        // Permanent failure: do not retry indefinitely
        await prisma.scheduledDeletion.update({
          where: { id: job.id },
          data: {
            status: "FAILED",
            lastError: errorMsg.slice(0, 500),
            updatedAt: new Date(),
          },
        });
        failedCount++;
      } else {
        // Temporary failure: bounded retry with backoff
        const newRetryCount = job.retryCount + 1;
        const willRetry = newRetryCount < 3;
        const nextDeleteAt = new Date(Date.now() + newRetryCount * 10 * 1000); // 10s, 20s backoff

        await prisma.scheduledDeletion.update({
          where: { id: job.id },
          data: {
            status: willRetry ? "PENDING" : "FAILED",
            retryCount: newRetryCount,
            deleteAt: willRetry ? nextDeleteAt : job.deleteAt,
            lastError: errorMsg.slice(0, 500),
            updatedAt: new Date(),
          },
        });

        if (!willRetry) failedCount++;
      }
    }
  }

  return {
    claimedCount: claimedJobIds.length,
    completedCount,
    failedCount,
  };
}
