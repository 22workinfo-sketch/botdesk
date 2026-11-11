import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/lib/prisma";
import {
  recordChannelActivityEvent,
  getChannelActivityEvents,
  cleanupOldActivityEvents,
} from "../src/lib/activity-service";
import {
  checkUserChannelMemberships,
  checkSingleChannelMembership,
} from "../src/lib/channel-service";

describe("Channel Activity Event Collection & Timeline", () => {
  let testBotId: string;
  let testChannelId: string;
  let testAdminId: string;
  const testChatId = "-1009988776655";

  beforeAll(async () => {
    // Upsert a test admin user
    const admin = await prisma.adminUser.upsert({
      where: { email: "activity-test@local.test" },
      update: {},
      create: {
        email: "activity-test@local.test",
        passwordHash: "$2a$10$dummyhashforactivitytesting0000000000000000000000",
        role: "SUPER_ADMIN",
      },
    });
    testAdminId = admin.id;

    // Create a dedicated test bot
    const bot = await prisma.bot.create({
      data: {
        name: "Activity Test Bot",
        username: "activity_test_bot",
        tokenEnvVar: "TEST_ACTIVITY_BOT_TOKEN",
        isActive: true,
      },
    });
    testBotId = bot.id;

    // Create a test channel
    const channel = await prisma.botChannel.create({
      data: {
        botId: testBotId,
        name: "Test Community Channel",
        telegramChatId: testChatId,
        inviteLink: "https://t.me/+testchannelinvite",
        buttonLabel: "📢 Join Test Community",
        isRequired: true,
        isEnabled: true,
        order: 1,
      },
    });
    testChannelId = channel.id;
  });

  afterAll(async () => {
    // Clean up test data
    await prisma.channelActivityEvent.deleteMany({
      where: { botId: testBotId },
    });
    await prisma.botChannel.deleteMany({
      where: { botId: testBotId },
    });
    await prisma.bot.deleteMany({
      where: { id: testBotId },
    });
    await prisma.adminUser.deleteMany({
      where: { id: testAdminId },
    });
  });

  it("1. Successfully records a JOINED channel activity event", async () => {
    const success = await recordChannelActivityEvent({
      botId: testBotId,
      channelId: testChannelId,
      telegramChatId: testChatId,
      channelTitle: "Test Community Channel",
      telegramUserId: 123456789,
      userFirstName: "Alice",
      userLastName: "Wonder",
      username: "alice_w",
      eventType: "JOINED",
      status: "member",
      source: "TELEGRAM_UPDATE",
      updateId: 90001,
      details: { viaInviteLink: true },
    });

    expect(success).toBe(true);

    const query = await getChannelActivityEvents({
      botIds: [testBotId],
      eventType: "JOINED",
    });

    expect(query.total).toBeGreaterThanOrEqual(1);
    const event = query.events.find((e) => e.telegramUserId === "123456789");
    expect(event).toBeDefined();
    expect(event?.userDisplayName).toBe("Alice Wonder");
    expect(event?.channelTitle).toBe("Test Community Channel");
    expect(event?.eventType).toBe("JOINED");
    expect(event?.status).toBe("member");
  });

  it("2. Idempotently ignores duplicate updateId deliveries", async () => {
    // Attempt to record exact same updateId
    const duplicateResult = await recordChannelActivityEvent({
      botId: testBotId,
      telegramChatId: testChatId,
      telegramUserId: 123456789,
      eventType: "JOINED",
      source: "TELEGRAM_UPDATE",
      updateId: 90001, // same updateId as test 1
    });

    expect(duplicateResult).toBe(false);

    // Verify only one record exists with that updateId
    const count = await prisma.channelActivityEvent.count({
      where: { botId: testBotId, updateId: BigInt(90001) },
    });
    expect(count).toBe(1);
  });

  it("3. Correctly distinguishes actor from affected user when kicked by admin", async () => {
    const success = await recordChannelActivityEvent({
      botId: testBotId,
      channelId: testChannelId,
      telegramChatId: testChatId,
      channelTitle: "Test Community Channel",
      telegramUserId: 555555555,
      userFirstName: "Bad",
      userLastName: "Actor",
      username: "spammer",
      actorUserId: 999999999, // Admin who performed the kick
      actorUsername: "mod_admin",
      eventType: "LEFT",
      status: "kicked",
      source: "TELEGRAM_UPDATE",
      updateId: 90002,
      details: { oldStatus: "member", newStatus: "kicked" },
    });

    expect(success).toBe(true);

    const query = await getChannelActivityEvents({
      botIds: [testBotId],
      eventType: "LEFT",
    });

    const event = query.events.find((e) => e.telegramUserId === "555555555");
    expect(event).toBeDefined();
    expect(event?.isActorDifferent).toBe(true);
    expect(event?.actorUsername).toBe("mod_admin");
    expect(event?.actorUserId).toBe("999999999");
    expect(event?.status).toBe("kicked");
  });

  it("4. Automatically records MEMBERSHIP_CHECK events via checkUserChannelMemberships", async () => {
    const mockGetChatMember = async (chatId: string | number, userId: number) => {
      if (userId === 111222333) {
        return { status: "member", is_member: true };
      }
      return { status: "left" };
    };

    const summary = await checkUserChannelMemberships({
      botId: testBotId,
      userId: 111222333,
      getChatMemberFn: mockGetChatMember,
    });

    expect(summary.allRequiredJoined).toBe(true);

    // Verify activity event was created
    const query = await getChannelActivityEvents({
      botIds: [testBotId],
      eventType: "MEMBERSHIP_CHECK",
    });

    const event = query.events.find((e) => e.telegramUserId === "111222333");
    expect(event).toBeDefined();
    expect(event?.status).toBe("joined");
    expect(event?.source).toBe("MANUAL_CHECK");
  });

  it("5. Automatically records MEMBERSHIP_CHECK events via checkSingleChannelMembership", async () => {
    const mockGetChatMember = async () => {
      return { status: "member" };
    };

    const result = await checkSingleChannelMembership(
      testChannelId,
      444333222,
      mockGetChatMember
    );

    expect(result).toBe("joined");

    const query = await getChannelActivityEvents({
      botIds: [testBotId],
      channelId: testChannelId,
    });

    const event = query.events.find((e) => e.telegramUserId === "444333222");
    expect(event).toBeDefined();
    expect(event?.status).toBe("joined");
    expect(event?.source).toBe("FLOW_CHECK");
  });

  it("6. Strips phone numbers and credentials from details (privacy protection)", async () => {
    await recordChannelActivityEvent({
      botId: testBotId,
      telegramChatId: testChatId,
      telegramUserId: 777777777,
      eventType: "CHANNEL_SELECTED",
      source: "FLOW_SELECTION",
      updateId: 90003,
      details: {
        phone_number: "+1234567890",
        token: "secret_telegram_token",
        password: "my_password",
        nodeId: "channel-node-1",
      },
    });

    const query = await getChannelActivityEvents({
      botIds: [testBotId],
      search: "777777777",
    });

    const event = query.events.find((e) => e.telegramUserId === "777777777");
    expect(event).toBeDefined();
    expect(event?.details.nodeId).toBe("channel-node-1");
    expect(event?.details.phone_number).toBeUndefined();
    expect(event?.details.token).toBeUndefined();
    expect(event?.details.password).toBeUndefined();
  });

  it("7. Filters events by search query (username and display name)", async () => {
    const searchAlice = await getChannelActivityEvents({
      botIds: [testBotId],
      search: "Wonder",
    });
    expect(searchAlice.events.some((e) => e.userDisplayName.includes("Alice"))).toBe(true);

    const searchSpammer = await getChannelActivityEvents({
      botIds: [testBotId],
      search: "spammer",
    });
    expect(searchSpammer.events.some((e) => e.username === "spammer")).toBe(true);
  });

  it("8. Scopes queries strictly to authorized bot IDs", async () => {
    const queryNonExistent = await getChannelActivityEvents({
      botIds: ["non-existent-bot-id-12345"],
    });
    expect(queryNonExistent.total).toBe(0);
    expect(queryNonExistent.events.length).toBe(0);
  });

  it("9. Retention cleanup properly leaves recent events intact", async () => {
    const deletedCount = await cleanupOldActivityEvents(90);
    // Recent events created today should NOT be deleted
    const countRemaining = await prisma.channelActivityEvent.count({
      where: { botId: testBotId },
    });
    expect(countRemaining).toBeGreaterThanOrEqual(4);
  });
});
