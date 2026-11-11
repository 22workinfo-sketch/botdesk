import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/lib/prisma";
import {
  validateTelegramChatId,
  validateInviteLink,
  validateChannelInput,
  getBotChannels,
  saveBotChannels,
  checkUserChannelMemberships,
  ChannelInput,
} from "../src/lib/channel-service";
import { GET as channelsGET, PUT as channelsPUT } from "../src/app/api/bots/[id]/channels/route";
import { NextRequest } from "next/server";

describe("Telegram Channel Management & Voluntary Membership Verification", () => {
  const testBotAId = "99999999-chan-1111-1111-111111111111";
  const testBotBId = "99999999-chan-2222-2222-222222222222";

  beforeAll(async () => {
    // 1. Setup isolated test bots in PostgreSQL
    await prisma.bot.upsert({
      where: { id: testBotAId },
      create: {
        id: testBotAId,
        name: "Test Channels Bot A",
        username: "test_channels_bot_a",
      },
      update: {},
    });

    await prisma.bot.upsert({
      where: { id: testBotBId },
      create: {
        id: testBotBId,
        name: "Test Channels Bot B",
        username: "test_channels_bot_b",
      },
      update: {},
    });
  });

  afterAll(async () => {
    // Clean up isolated test bot records
    const testIds = [testBotAId, testBotBId];
    await prisma.botChannel.deleteMany({ where: { botId: { in: testIds } } });
    await prisma.auditLog.deleteMany({ where: { botId: { in: testIds } } });
    await prisma.bot.deleteMany({ where: { id: { in: testIds } } });
    await prisma.$disconnect();
  });

  describe("Validation Utilities", () => {
    it("validates Telegram username or numeric chat ID correctly", () => {
      // Valid usernames
      expect(validateTelegramChatId("@mychannel")).toBe("@mychannel");
      expect(validateTelegramChatId("@Test_Channel_123")).toBe("@Test_Channel_123");
      expect(validateTelegramChatId("  @spaced_channel  ")).toBe("@spaced_channel");

      // Valid numeric IDs
      expect(validateTelegramChatId("-1001234567890")).toBe("-1001234567890");
      expect(validateTelegramChatId("-987654321")).toBe("-987654321");
      expect(validateTelegramChatId("123456789")).toBe("123456789");

      // Invalid inputs
      expect(() => validateTelegramChatId("")).toThrow("Telegram chat ID or username is required");
      expect(() => validateTelegramChatId("   ")).toThrow("Telegram chat ID or username is required");
      expect(() => validateTelegramChatId("mychannel_without_at")).toThrow("Invalid Telegram chat identifier");
      expect(() => validateTelegramChatId("@inv@lid")).toThrow("Invalid Telegram username");
      expect(() => validateTelegramChatId("https://t.me/mychannel")).toThrow("Invalid Telegram chat identifier");
    });

    it("validates Telegram invite links and rejects non-Telegram URLs", () => {
      // Valid URLs
      expect(validateInviteLink("https://t.me/mychannel")).toBe("https://t.me/mychannel");
      expect(validateInviteLink("https://t.me/+AbCdEfGh123")).toBe("https://t.me/+AbCdEfGh123");
      expect(validateInviteLink("https://telegram.me/joinchat/something")).toBe("https://telegram.me/joinchat/something");

      // Invalid URLs
      expect(() => validateInviteLink("")).toThrow("Channel invite link is required");
      expect(() => validateInviteLink("http://t.me/unsecure")).toThrow("Must be a valid Telegram URL starting with 'https://t.me/'");
      expect(() => validateInviteLink("https://evil.com/phish")).toThrow("Must be a valid Telegram URL starting with 'https://t.me/'");
      expect(() => validateInviteLink("javascript:alert(1)")).toThrow("Must be a valid Telegram URL");
    });

    it("validates channel input payload bounds", () => {
      const validPayload: ChannelInput = {
        name: "Official Announcements",
        telegramChatId: "@official_announcements",
        inviteLink: "https://t.me/official_announcements",
        buttonLabel: "📢 Join Announcements",
        isRequired: true,
        isEnabled: true,
        order: 0,
      };

      expect(() => validateChannelInput(validPayload, 0)).not.toThrow();

      // Empty name
      expect(() => validateChannelInput({ ...validPayload, name: " " }, 0)).toThrow(
        "must have a non-empty name"
      );

      // Name too long
      expect(() =>
        validateChannelInput({ ...validPayload, name: "A".repeat(65) }, 0)
      ).toThrow("exceeds the maximum length of 64 characters");

      // Empty label
      expect(() =>
        validateChannelInput({ ...validPayload, buttonLabel: "" }, 0)
      ).toThrow("must have a non-empty button label");
    });
  });

  describe("PostgreSQL Persistence & Scoping", () => {
    it("saves and retrieves channels scoped strictly to the bot", async () => {
      const botAChannels: ChannelInput[] = [
        {
          name: "Main Channel",
          telegramChatId: "@main_channel",
          inviteLink: "https://t.me/main_channel",
          buttonLabel: "📢 Join Main Channel",
          isRequired: true,
          isEnabled: true,
          order: 0,
        },
        {
          name: "VIP Discussion",
          telegramChatId: "-1009876543210",
          inviteLink: "https://t.me/+secretinvitekey",
          buttonLabel: "💬 Join VIP Discussion",
          isRequired: false,
          isEnabled: true,
          order: 1,
        },
      ];

      const saved = await saveBotChannels(testBotAId, botAChannels, "admin-test-user");
      expect(saved).toHaveLength(2);
      expect(saved[0].name).toBe("Main Channel");
      expect(saved[0].isRequired).toBe(true);
      expect(saved[1].name).toBe("VIP Discussion");
      expect(saved[1].isRequired).toBe(false);

      // Retrieve via getBotChannels
      const fetched = await getBotChannels(testBotAId);
      expect(fetched).toHaveLength(2);
      expect(fetched[0].telegramChatId).toBe("@main_channel");
      expect(fetched[1].telegramChatId).toBe("-1009876543210");

      // Strict bot separation: Bot B should have 0 channels
      const botBChannels = await getBotChannels(testBotBId);
      expect(botBChannels).toHaveLength(0);
    });

    it("creates an audit log without leaking private invite links", async () => {
      const logs = await prisma.auditLog.findMany({
        where: { botId: testBotAId, action: "UPDATE_BOT_CHANNELS" },
        orderBy: { createdAt: "desc" },
        take: 1,
      });

      expect(logs).toHaveLength(1);
      const details = (logs[0].details ? JSON.stringify(logs[0].details) : "") || "";
      expect(details).toContain("Main Channel");
      // Sensitive private invite link must NOT be written to audit logs
      expect(details).not.toContain("+secretinvitekey");
    });

    it("updates, reorders, and deletes channels transactionally", async () => {
      const existing = await getBotChannels(testBotAId);
      expect(existing).toHaveLength(2);

      // Keep only VIP discussion, update order to 0, and add a new channel
      const updatedList: ChannelInput[] = [
        {
          id: existing[1].id,
          name: "VIP Community",
          telegramChatId: existing[1].telegramChatId,
          inviteLink: existing[1].inviteLink,
          buttonLabel: "✨ Enter VIP",
          isRequired: true,
          isEnabled: true,
          order: 0,
        },
        {
          name: "News Feed",
          telegramChatId: "@newsfeed",
          inviteLink: "https://t.me/newsfeed",
          buttonLabel: "📰 News Feed",
          isRequired: false,
          isEnabled: false,
          order: 1,
        },
      ];

      await saveBotChannels(testBotAId, updatedList);

      const refreshed = await getBotChannels(testBotAId);
      expect(refreshed).toHaveLength(2);
      expect(refreshed[0].name).toBe("VIP Community");
      expect(refreshed[0].buttonLabel).toBe("✨ Enter VIP");
      expect(refreshed[1].name).toBe("News Feed");
      expect(refreshed[1].isEnabled).toBe(false);

      // Main Channel was removed from the list and should no longer exist in the DB
      const oldMain = refreshed.find((c) => c.name === "Main Channel");
      expect(oldMain).toBeUndefined();

      // Enabled only query should return only the active one
      const enabledOnly = await getBotChannels(testBotAId, true);
      expect(enabledOnly).toHaveLength(1);
      expect(enabledOnly[0].name).toBe("VIP Community");
    });
  });

  describe("Voluntary Membership Verification (getChatMember Simulation)", () => {
    it("reports allRequiredJoined: true when user is creator or member of all required channels", async () => {
      // Configure 1 required and 1 optional channel
      await saveBotChannels(testBotAId, [
        {
          name: "Required Channel 1",
          telegramChatId: "@req_channel_1",
          inviteLink: "https://t.me/req_channel_1",
          buttonLabel: "Join Req 1",
          isRequired: true,
          isEnabled: true,
          order: 0,
        },
        {
          name: "Optional Channel 2",
          telegramChatId: "@opt_channel_2",
          inviteLink: "https://t.me/opt_channel_2",
          buttonLabel: "Join Opt 2",
          isRequired: false,
          isEnabled: true,
          order: 1,
        },
      ]);

      const mockGetChatMember = async (chatId: string | number, _userId: number) => {
        if (chatId === "@req_channel_1") {
          return { status: "member" };
        }
        if (chatId === "@opt_channel_2") {
          return { status: "left" }; // Optional channel not joined
        }
        throw new Error("Chat not found");
      };

      const result = await checkUserChannelMemberships({
        botId: testBotAId,
        userId: 12345678,
        getChatMemberFn: mockGetChatMember,
      });

      expect(result.allRequiredJoined).toBe(true);
      expect(result.requiredCount).toBe(1);
      expect(result.joinedRequiredCount).toBe(1);
      expect(result.hasErrors).toBe(false);
      expect(result.details[0].isJoined).toBe(true);
      expect(result.details[1].isJoined).toBe(false);
      expect(result.message).toContain("All required channels joined");
    });

    it("correctly identifies restricted members with is_member flag", async () => {
      const mockGetChatMember = async (_chatId: string | number, _userId: number) => {
        return { status: "restricted", is_member: true };
      };

      const result = await checkUserChannelMemberships({
        botId: testBotAId,
        userId: 12345678,
        getChatMemberFn: mockGetChatMember,
      });

      expect(result.allRequiredJoined).toBe(true);
      expect(result.details[0].isJoined).toBe(true);
      expect(result.details[0].status).toBe("restricted");
    });

    it("reports allRequiredJoined: false when user has left or been kicked from a required channel", async () => {
      const mockGetChatMember = async (_chatId: string | number, _userId: number) => {
        return { status: "left" };
      };

      const result = await checkUserChannelMemberships({
        botId: testBotAId,
        userId: 12345678,
        getChatMemberFn: mockGetChatMember,
      });

      expect(result.allRequiredJoined).toBe(false);
      expect(result.joinedRequiredCount).toBe(0);
      expect(result.details[0].isJoined).toBe(false);
      expect(result.message).toContain("Please join the required channels");
    });

    it("handles Telegram API errors gracefully and NEVER treats errors as joined", async () => {
      const mockGetChatMember = async (_chatId: string | number, _userId: number) => {
        throw new Error("400 Bad Request: chat not found");
      };

      const result = await checkUserChannelMemberships({
        botId: testBotAId,
        userId: 12345678,
        getChatMemberFn: mockGetChatMember,
      });

      expect(result.allRequiredJoined).toBe(false);
      expect(result.hasErrors).toBe(true);
      expect(result.details[0].isJoined).toBe(false);
      expect(result.details[0].status).toBe("error");
      expect(result.details[0].errorMessage).toContain("Channel not found. Verify username or ID.");
      expect(result.message).toContain("could not be verified");
    });
  });

  describe("Channels API Security Guard", () => {
    it("GET /api/bots/[id]/channels rejects unauthenticated requests with 401", async () => {
      const fakeRequest = new NextRequest("http://127.0.0.1:3000/api/bots/fake-id/channels", {
        method: "GET",
      });

      const response = await channelsGET(fakeRequest, { params: { id: "fake-id" } });
      expect(response.status).toBe(401);

      const body = await response.json();
      expect(body.error).toBe("Unauthorized");
      expect(body.channels).toBeUndefined();
    });

    it("PUT /api/bots/[id]/channels rejects unauthenticated requests with 401", async () => {
      const fakeRequest = new NextRequest("http://127.0.0.1:3000/api/bots/fake-id/channels", {
        method: "PUT",
        body: JSON.stringify({ channels: [] }),
      });

      const response = await channelsPUT(fakeRequest, { params: { id: "fake-id" } });
      expect(response.status).toBe(401);

      const body = await response.json();
      expect(body.error).toBe("Unauthorized");
      expect(body.channels).toBeUndefined();
    });
  });
});
