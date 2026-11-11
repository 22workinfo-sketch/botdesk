import { prisma } from "./prisma";

export type UpdateClaimStatus =
  | "CLAIMED"
  | "ALREADY_COMPLETED"
  | "CONCURRENT_LOCKED";

export interface ClaimResult {
  status: UpdateClaimStatus;
  message?: string;
}

const DEFAULT_LEASE_TIMEOUT_MS = 60 * 1000; // 60 seconds lease timeout

/**
 * Atomically claims a Telegram update for processing by a specific bot.
 * Guarantees that concurrent webhook requests do not execute duplicate database side effects.
 *
 * - If update has not been seen: Creates a "PROCESSING" record and returns "CLAIMED".
 * - If update was already completed: Returns "ALREADY_COMPLETED".
 * - If update is currently in "PROCESSING" within lease window: Returns "CONCURRENT_LOCKED".
 * - If update was in "PROCESSING" but lease expired (>60s stalled claim / process crash):
 *   Reclaims the lease and returns "CLAIMED".
 * - If update previously "FAILED": Reclaims the record for retry and returns "CLAIMED".
 */
export async function claimTelegramUpdate(
  botId: string,
  updateId: number,
  leaseTimeoutMs: number = DEFAULT_LEASE_TIMEOUT_MS
): Promise<ClaimResult> {
  const updateIdBigInt = BigInt(updateId);

  try {
    // 1. Attempt initial claim insert
    await prisma.telegramUpdateLog.create({
      data: {
        botId,
        updateId: updateIdBigInt,
        status: "PROCESSING",
      },
    });

    return { status: "CLAIMED" };
  } catch (err: any) {
    // P2002: Unique constraint failed on (botId, updateId)
    if (err.code === "P2002") {
      const existing = await prisma.telegramUpdateLog.findUnique({
        where: {
          botId_updateId: {
            botId,
            updateId: updateIdBigInt,
          },
        },
      });

      if (!existing) {
        return {
          status: "CONCURRENT_LOCKED",
          message: "Update is being processed concurrently.",
        };
      }

      // Case A: Already successfully completed
      if (existing.status === "COMPLETED") {
        return { status: "ALREADY_COMPLETED" };
      }

      const now = Date.now();
      const ageMs = now - existing.updatedAt.getTime();

      // Case B: Currently in-flight within lease window
      if (existing.status === "PROCESSING" && ageMs < leaseTimeoutMs) {
        return {
          status: "CONCURRENT_LOCKED",
          message: `Update is currently processing (lease active, age ${Math.round(ageMs / 1000)}s).`,
        };
      }

      // Case C: Stalled PROCESSING (lease expired) or previous FAILED state
      // Optimistic lock on existing.updatedAt to prevent race with another reclaimer
      const reclaimResult = await prisma.telegramUpdateLog.updateMany({
        where: {
          botId,
          updateId: updateIdBigInt,
          updatedAt: existing.updatedAt,
        },
        data: {
          status: "PROCESSING",
          lastError:
            existing.status === "PROCESSING"
              ? "Reclaimed after lease expiration"
              : null,
          updatedAt: new Date(),
        },
      });

      if (reclaimResult.count > 0) {
        return { status: "CLAIMED" };
      }

      // Lost race to another concurrent request
      return {
        status: "CONCURRENT_LOCKED",
        message: "Update claimed by concurrent reclaimer.",
      };
    }

    // Re-throw database connection or unexpected errors
    throw err;
  }
}

/**
 * Marks a Telegram update as successfully completed in PostgreSQL.
 */
export async function markTelegramUpdateCompleted(
  botId: string,
  updateId: number
): Promise<void> {
  await prisma.telegramUpdateLog.update({
    where: {
      botId_updateId: {
        botId,
        updateId: BigInt(updateId),
      },
    },
    data: {
      status: "COMPLETED",
      lastError: null,
      updatedAt: new Date(),
    },
  });
}

/**
 * Marks a Telegram update as failed in PostgreSQL, allowing future retries from Telegram.
 */
export async function markTelegramUpdateFailed(
  botId: string,
  updateId: number,
  errorMessage: string
): Promise<void> {
  try {
    await prisma.telegramUpdateLog.update({
      where: {
        botId_updateId: {
          botId,
          updateId: BigInt(updateId),
        },
      },
      data: {
        status: "FAILED",
        lastError: errorMessage.slice(0, 1000),
        updatedAt: new Date(),
      },
    });
  } catch (err) {
    console.error(
      `[UpdateTracker] Failed to record failure for bot=${botId} update=${updateId}:`,
      err instanceof Error ? err.message : err
    );
  }
}

/**
 * Cleanup helper strictly for isolated test suites.
 */
export async function _clearTelegramUpdateLogsForTesting(
  botId?: string
): Promise<void> {
  if (botId) {
    await prisma.telegramUpdateLog.deleteMany({
      where: { botId },
    });
  } else {
    await prisma.telegramUpdateLog.deleteMany({});
  }
}
