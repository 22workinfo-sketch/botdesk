import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/lib/prisma";
import {
  handleTelegramStart,
  handleTelegramContact,
  updateBotWelcomeMessage,
  getBotUsers,
} from "../src/lib/bot-service";

describe("Bot Service Core & Contact Security (Real PostgreSQL)", () => {
  const testBotId = "11111111-1111-1111-1111-111111111111";
  const secondBotId = "22222222-2222-2222-2222-222222222222";

  beforeAll(async () => {
    // Setup test bot 1
    await prisma.bot.upsert({
      where: { id: testBotId },
      create: {
        id: testBotId,
        name: "Test Unit Bot 1",
        username: "test_unit_bot_1",
      },
      update: {},
    });

    await prisma.botConfig.upsert({
      where: { botId: testBotId },
      create: {
        botId: testBotId,
        welcomeMessage: "Original Initial Welcome Message",
      },
      update: {
        welcomeMessage: "Original Initial Welcome Message",
      },
    });

    // Setup test bot 2 (for data isolation testing)
    await prisma.bot.upsert({
      where: { id: secondBotId },
      create: {
        id: secondBotId,
        name: "Test Unit Bot 2",
        username: "test_unit_bot_2",
      },
      update: {},
    });
  });

  afterAll(async () => {
    // Clean up test records
    await prisma.telegramUser.deleteMany({
      where: { botId: { in: [testBotId, secondBotId] } },
    });
    await prisma.auditLog.deleteMany({
      where: { botId: { in: [testBotId, secondBotId] } },
    });
    await prisma.botConfig.deleteMany({
      where: { botId: { in: [testBotId, secondBotId] } },
    });
    await prisma.bot.deleteMany({
      where: { id: { in: [testBotId, secondBotId] } },
    });
    await prisma.$disconnect();
  });

  it("should process /start and provide menu without requiring a phone number", async () => {
    const telegramId = 987654321;
    const startResult = await handleTelegramStart({
      botId: testBotId,
      telegramId,
      firstName: "SyntheticAlice",
      lastName: "TestUser",
      username: "synthetic_alice",
      languageCode: "en",
    });

    // Verification: /start works and phone is null initially
    expect(startResult.welcomeMessage).toBe("Original Initial Welcome Message");
    expect(startResult.user.telegramId).toBe(BigInt(telegramId));
    expect(startResult.user.telegramPhNo).toBeNull();
    expect(startResult.menuConfig).toBeDefined();

    // Verify in database
    const dbUser = await prisma.telegramUser.findUnique({
      where: {
        botId_telegramId: {
          botId: testBotId,
          telegramId: BigInt(telegramId),
        },
      },
    });
    expect(dbUser).not.toBeNull();
    expect(dbUser?.telegramPhNo).toBeNull();
  });

  it("should accept and store contact when contact.user_id matches sender ID", async () => {
    const telegramId = 987654321;
    const syntheticPhone = "+15550001111"; // Synthetic test number

    const result = await handleTelegramContact({
      botId: testBotId,
      senderTelegramId: telegramId,
      contactUserId: telegramId, // Exactly matches sender
      phoneNumber: syntheticPhone,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.user.telegramPhNo).toBe(syntheticPhone);
    }

    // Verify persisted in PostgreSQL
    const dbUser = await prisma.telegramUser.findUnique({
      where: {
        botId_telegramId: {
          botId: testBotId,
          telegramId: BigInt(telegramId),
        },
      },
    });
    expect(dbUser?.telegramPhNo).toBe(syntheticPhone);
  });

  it("should reject contact when contact.user_id belongs to another person and NOT overwrite verified number", async () => {
    const telegramId = 987654321;
    const foreignUserId = 111222333; // Different user ID (e.g. forwarded contact)
    const foreignPhone = "+15559998888";

    const result = await handleTelegramContact({
      botId: testBotId,
      senderTelegramId: telegramId,
      contactUserId: foreignUserId,
      phoneNumber: foreignPhone,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe("OWNERSHIP_MISMATCH");
    }

    // CRITICAL: Ensure existing verified phone number was NOT overwritten
    const dbUser = await prisma.telegramUser.findUnique({
      where: {
        botId_telegramId: {
          botId: testBotId,
          telegramId: BigInt(telegramId),
        },
      },
    });
    expect(dbUser?.telegramPhNo).toBe("+15550001111"); // Still previous verified number!
    expect(dbUser?.telegramPhNo).not.toBe(foreignPhone);
  });

  it("should reject contact when contact.user_id is missing and NOT overwrite verified number", async () => {
    const telegramId = 987654321;
    const anonymousPhone = "+15557776666";

    const result = await handleTelegramContact({
      botId: testBotId,
      senderTelegramId: telegramId,
      contactUserId: null, // Missing user_id
      phoneNumber: anonymousPhone,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe("MISSING_CONTACT_USER_ID");
    }

    // Verify existing number is preserved
    const dbUser = await prisma.telegramUser.findUnique({
      where: {
        botId_telegramId: {
          botId: testBotId,
          telegramId: BigInt(telegramId),
        },
      },
    });
    expect(dbUser?.telegramPhNo).toBe("+15550001111");
  });

  it("should update welcome message and create audit log", async () => {
    const newWelcomeMessage = "Updated Welcome Greeting via Backstage Admin!";

    const updatedConfig = await updateBotWelcomeMessage({
      botId: testBotId,
      welcomeMessage: newWelcomeMessage,
    });

    expect(updatedConfig.welcomeMessage).toBe(newWelcomeMessage);

    // Check audit log
    const audit = await prisma.auditLog.findFirst({
      where: { botId: testBotId, action: "UPDATE_WELCOME_MESSAGE" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).not.toBeNull();
    expect(audit?.action).toBe("UPDATE_WELCOME_MESSAGE");

    // Verify subsequent /start gets the updated message
    const subsequentStart = await handleTelegramStart({
      botId: testBotId,
      telegramId: 987654321,
    });
    expect(subsequentStart.welcomeMessage).toBe(newWelcomeMessage);
  });

  it("should enforce bot-level data isolation strictly", async () => {
    // Add users to Bot 1
    await handleTelegramStart({
      botId: testBotId,
      telegramId: 1001,
      firstName: "User1_Bot1",
      username: "user1_bot1",
    });
    await handleTelegramStart({
      botId: testBotId,
      telegramId: 1002,
      firstName: "User2_Bot1",
      username: "user2_bot1",
    });

    // Add user to Bot 2
    await handleTelegramStart({
      botId: secondBotId,
      telegramId: 2001,
      firstName: "User1_Bot2",
      username: "user1_bot2",
    });

    // Query Bot 1 users
    const bot1Users = await getBotUsers(testBotId);
    const bot1TelegramIds = bot1Users.map((u) => Number(u.telegramId));
    expect(bot1TelegramIds).toContain(1001);
    expect(bot1TelegramIds).toContain(1002);
    expect(bot1TelegramIds).not.toContain(2001); // NEVER leaks Bot 2 user

    // Query Bot 2 users
    const bot2Users = await getBotUsers(secondBotId);
    const bot2TelegramIds = bot2Users.map((u) => Number(u.telegramId));
    expect(bot2TelegramIds).toContain(2001);
    expect(bot2TelegramIds).not.toContain(1001); // NEVER leaks Bot 1 user
    expect(bot2TelegramIds).not.toContain(1002);
  });
});
