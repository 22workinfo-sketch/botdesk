import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/lib/prisma";
import {
  saveBotButtons,
  getBotButtons,
  handleTelegramText,
} from "../src/lib/bot-service";
import {
  scheduleMessageDeletion,
  processDueDeletions,
} from "../src/lib/deletion-service";

describe("Auto-Delete Reply Integration & Deletion Worker (Real PostgreSQL)", () => {
  const testBotId = "88888888-auto-1111-1111-111111111111";
  const testBotOtherId = "88888888-auto-2222-2222-222222222222";

  beforeAll(async () => {
    // Setup isolated test bots
    await prisma.bot.upsert({
      where: { id: testBotId },
      create: {
        id: testBotId,
        name: "Auto-Delete Test Bot",
        username: "test_autodelete_bot",
      },
      update: {},
    });

    await prisma.bot.upsert({
      where: { id: testBotOtherId },
      create: {
        id: testBotOtherId,
        name: "Other Test Bot",
        username: "test_other_bot",
      },
      update: {},
    });
  });

  afterAll(async () => {
    // Cleanup test data strictly for test bots
    const botIds = [testBotId, testBotOtherId];
    await prisma.scheduledDeletion.deleteMany({
      where: { botId: { in: botIds } },
    });
    await prisma.botButton.deleteMany({
      where: { botId: { in: botIds } },
    });
    await prisma.auditLog.deleteMany({
      where: { botId: { in: botIds } },
    });
    await prisma.botConfig.deleteMany({
      where: { botId: { in: botIds } },
    });
    await prisma.bot.deleteMany({
      where: { id: { in: botIds } },
    });
    await prisma.$disconnect();
  });

  it("should configure, validate and save auto-delete settings on SEND_TEXT buttons", async () => {
    // 1. Valid button with auto-delete enabled (45 seconds)
    const buttons = [
      {
        label: "⏳ Ephemeral Info",
        actionType: "SEND_TEXT",
        replyText: "This temporary notice will self-destruct in 45 seconds.",
        autoDeleteReply: true,
        deleteAfterSeconds: 45,
        isEnabled: true,
        order: 0,
      },
      {
        label: "ℹ️ Permanent Info",
        actionType: "SEND_TEXT",
        replyText: "This message stays forever.",
        autoDeleteReply: false,
        deleteAfterSeconds: 30,
        isEnabled: true,
        order: 1,
      },
    ];

    const saved = await saveBotButtons(testBotId, buttons);
    expect(saved).toHaveLength(2);

    const fetched = await getBotButtons(testBotId);
    expect(fetched[0].label).toBe("⏳ Ephemeral Info");
    expect(fetched[0].autoDeleteReply).toBe(true);
    expect(fetched[0].deleteAfterSeconds).toBe(45);

    expect(fetched[1].label).toBe("ℹ️ Permanent Info");
    expect(fetched[1].autoDeleteReply).toBe(false);
  });

  it("should reject invalid auto-delete delay bounds (< 5s or > 86400s)", async () => {
    const tooShort = [
      {
        label: "Too Fast",
        actionType: "SEND_TEXT",
        replyText: "Too fast",
        autoDeleteReply: true,
        deleteAfterSeconds: 3, // less than 5s
        isEnabled: true,
        order: 0,
      },
    ];

    await expect(saveBotButtons(testBotId, tooShort)).rejects.toThrow(
      /invalid auto-delete delay/i
    );

    const tooLong = [
      {
        label: "Too Slow",
        actionType: "SEND_TEXT",
        replyText: "Too slow",
        autoDeleteReply: true,
        deleteAfterSeconds: 90000, // greater than 24 hours (86400s)
        isEnabled: true,
        order: 0,
      },
    ];

    await expect(saveBotButtons(testBotId, tooLong)).rejects.toThrow(
      /invalid auto-delete delay/i
    );
  });

  it("should return autoDeleteReply metadata in handleTelegramText", async () => {
    const result = await handleTelegramText(testBotId, "⏳ Ephemeral Info");
    expect(result.handled).toBe(true);
    expect(result.button?.autoDeleteReply).toBe(true);
    expect(result.button?.deleteAfterSeconds).toBe(45);
  });

  it("should schedule a message deletion job in PostgreSQL with correct deleteAt timestamp", async () => {
    const fakeMessageId = 12345;
    const fakeChatId = "987654321";
    const delaySeconds = 10;

    const before = Date.now();
    const job = await scheduleMessageDeletion({
      botId: testBotId,
      chatId: fakeChatId,
      messageId: fakeMessageId,
      deleteAfterSeconds: delaySeconds,
    });
    const after = Date.now();

    expect(job.id).toBeDefined();
    expect(job.status).toBe("PENDING");
    expect(job.botId).toBe(testBotId);
    expect(job.chatId).toBe(fakeChatId);
    expect(job.messageId).toBe(fakeMessageId);

    const scheduledTime = job.deleteAt.getTime();
    expect(scheduledTime).toBeGreaterThanOrEqual(before + delaySeconds * 1000 - 100);
    expect(scheduledTime).toBeLessThanOrEqual(after + delaySeconds * 1000 + 100);
  });

  it("should NOT process deletions that are not yet due (deleteAt in the future)", async () => {
    // Schedule a future deletion 300 seconds from now
    const job = await scheduleMessageDeletion({
      botId: testBotId,
      chatId: "111222",
      messageId: 55501,
      deleteAfterSeconds: 300,
    });

    const deletedCalls: Array<{ chatId: string; messageId: number }> = [];
    const sweepResult = await processDueDeletions({
      botId: testBotId,
      deleteMessageFn: async (chatId, messageId) => {
        deletedCalls.push({ chatId, messageId });
      },
    });

    expect(sweepResult.claimedCount).toBe(0);
    expect(deletedCalls).toHaveLength(0);

    // Job in database should still be PENDING
    const inDb = await prisma.scheduledDeletion.findUnique({
      where: { id: job.id },
    });
    expect(inDb?.status).toBe("PENDING");
  });

  it("should process due deletions and call deleteMessage on the target message only", async () => {
    // Create an immediately due job (deleteAt in the past)
    const pastJob = await prisma.scheduledDeletion.create({
      data: {
        botId: testBotId,
        chatId: "999888",
        messageId: 77701,
        deleteAt: new Date(Date.now() - 5000), // 5 seconds ago
        status: "PENDING",
      },
    });

    const deletedMessages: Array<{ chatId: string; messageId: number }> = [];
    const sweepResult = await processDueDeletions({
      botId: testBotId,
      deleteMessageFn: async (chatId, messageId) => {
        deletedMessages.push({ chatId, messageId });
      },
    });

    expect(sweepResult.claimedCount).toBeGreaterThanOrEqual(1);
    expect(sweepResult.completedCount).toBeGreaterThanOrEqual(1);
    expect(deletedMessages).toContainEqual({
      chatId: "999888",
      messageId: 77701,
    });

    // Check status in DB is COMPLETED
    const updated = await prisma.scheduledDeletion.findUnique({
      where: { id: pastJob.id },
    });
    expect(updated?.status).toBe("COMPLETED");
  });

  it("should handle already-deleted messages from Telegram gracefully (treat as COMPLETED)", async () => {
    const job = await prisma.scheduledDeletion.create({
      data: {
        botId: testBotId,
        chatId: "999888",
        messageId: 77702,
        deleteAt: new Date(Date.now() - 1000),
        status: "PENDING",
      },
    });

    const sweepResult = await processDueDeletions({
      botId: testBotId,
      deleteMessageFn: async () => {
        throw new Error("Bad Request: message to delete not found");
      },
    });

    expect(sweepResult.completedCount).toBeGreaterThanOrEqual(1);

    const updated = await prisma.scheduledDeletion.findUnique({
      where: { id: job.id },
    });
    expect(updated?.status).toBe("COMPLETED");
    expect(updated?.lastError).toContain("already deleted");
  });

  it("should handle Telegram permanent failure (>48hr limit) without infinite retries", async () => {
    const job = await prisma.scheduledDeletion.create({
      data: {
        botId: testBotId,
        chatId: "999888",
        messageId: 77703,
        deleteAt: new Date(Date.now() - 1000),
        status: "PENDING",
      },
    });

    const sweepResult = await processDueDeletions({
      botId: testBotId,
      deleteMessageFn: async () => {
        throw new Error("Bad Request: message can't be deleted");
      },
    });

    expect(sweepResult.failedCount).toBeGreaterThanOrEqual(1);

    const updated = await prisma.scheduledDeletion.findUnique({
      where: { id: job.id },
    });
    expect(updated?.status).toBe("FAILED");
    expect(updated?.lastError).toContain("message can't be deleted");
  });

  it("should retry transient failures up to 3 times before marking FAILED", async () => {
    const job = await prisma.scheduledDeletion.create({
      data: {
        botId: testBotId,
        chatId: "999888",
        messageId: 77704,
        deleteAt: new Date(Date.now() - 1000),
        status: "PENDING",
        retryCount: 0,
      },
    });

    // Attempt 1: fails with network timeout -> should remain PENDING with retryCount: 1
    await processDueDeletions({
      botId: testBotId,
      deleteMessageFn: async () => {
        throw new Error("ETIMEDOUT: Telegram gateway timeout");
      },
    });

    let check = await prisma.scheduledDeletion.findUnique({
      where: { id: job.id },
    });
    expect(check?.retryCount).toBe(1);
    expect(check?.status).toBe("PENDING");

    // Fast-forward deleteAt to simulate backoff passing
    await prisma.scheduledDeletion.update({
      where: { id: job.id },
      data: { deleteAt: new Date(Date.now() - 1000) },
    });

    // Attempt 2: fails again -> retryCount: 2
    await processDueDeletions({
      botId: testBotId,
      deleteMessageFn: async () => {
        throw new Error("ETIMEDOUT: Telegram gateway timeout");
      },
    });

    check = await prisma.scheduledDeletion.findUnique({
      where: { id: job.id },
    });
    expect(check?.retryCount).toBe(2);
    expect(check?.status).toBe("PENDING");

    // Fast-forward deleteAt
    await prisma.scheduledDeletion.update({
      where: { id: job.id },
      data: { deleteAt: new Date(Date.now() - 1000) },
    });

    // Attempt 3: 3rd failure -> exceeds max attempts, marked FAILED
    const finalSweep = await processDueDeletions({
      botId: testBotId,
      deleteMessageFn: async () => {
        throw new Error("ETIMEDOUT: Telegram gateway timeout");
      },
    });

    expect(finalSweep.failedCount).toBe(1);

    check = await prisma.scheduledDeletion.findUnique({
      where: { id: job.id },
    });
    expect(check?.retryCount).toBe(3);
    expect(check?.status).toBe("FAILED");
  });

  it("should prevent duplicate processing across concurrent workers (atomic claiming)", async () => {
    const job = await prisma.scheduledDeletion.create({
      data: {
        botId: testBotId,
        chatId: "999888",
        messageId: 77705,
        deleteAt: new Date(Date.now() - 1000),
        status: "PENDING",
      },
    });

    let deleteCallCount = 0;
    const workerFn = async () => {
      deleteCallCount++;
      // Simulate slow delete
      await new Promise((resolve) => setTimeout(resolve, 50));
    };

    // Run two sweepers concurrently
    const [res1, res2] = await Promise.all([
      processDueDeletions({ botId: testBotId, deleteMessageFn: workerFn }),
      processDueDeletions({ botId: testBotId, deleteMessageFn: workerFn }),
    ]);

    // Exactly one call should have processed job 77705
    expect(res1.claimedCount + res2.claimedCount).toBe(1);
    expect(deleteCallCount).toBe(1);
  });

  it("should resume pending due jobs on worker restart", async () => {
    // Simulate worker crashing while job was left in PENDING
    const uncompletedJob = await prisma.scheduledDeletion.create({
      data: {
        botId: testBotId,
        chatId: "999888",
        messageId: 77706,
        deleteAt: new Date(Date.now() - 2000),
        status: "PENDING",
      },
    });

    // New worker starts and runs sweep
    const deleted: number[] = [];
    await processDueDeletions({
      botId: testBotId,
      deleteMessageFn: async (_, msgId) => {
        deleted.push(msgId);
      },
    });

    expect(deleted).toContain(77706);

    const check = await prisma.scheduledDeletion.findUnique({
      where: { id: uncompletedJob.id },
    });
    expect(check?.status).toBe("COMPLETED");
  });

  it("should enforce bot data isolation (only delete for the specified botId)", async () => {
    // Schedule job for testBotOtherId
    const otherJob = await prisma.scheduledDeletion.create({
      data: {
        botId: testBotOtherId,
        chatId: "333444",
        messageId: 88801,
        deleteAt: new Date(Date.now() - 1000),
        status: "PENDING",
      },
    });

    // Sweeper running for testBotId
    const deletedForBotA: number[] = [];
    await processDueDeletions({
      botId: testBotId,
      deleteMessageFn: async (_, msgId) => {
        deletedForBotA.push(msgId);
      },
    });

    // Bot A sweeper must NOT process Bot B's message
    expect(deletedForBotA).not.toContain(88801);

    const checkOther = await prisma.scheduledDeletion.findUnique({
      where: { id: otherJob.id },
    });
    expect(checkOther?.status).toBe("PENDING");
  });
});
