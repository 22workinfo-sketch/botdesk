import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/lib/prisma";
import {
  createMarketingCampaign,
  recordCampaignTouch,
  recordMarketingConsent,
  getMarketingOverviewMetrics,
  getAudienceList,
  getMarketingCampaigns,
} from "../src/lib/marketing-service";
import { recordChannelActivityEvent } from "../src/lib/activity-service";

describe("Marketing Data Dashboard, Audience Segments & Attribution", () => {
  let botAId: string;
  let botBId: string;
  let channelA1Id: string;
  let channelA2Id: string;
  let testAdminId: string;

  beforeAll(async () => {
    // 1. Create test admin
    const admin = await prisma.adminUser.upsert({
      where: { email: "marketing-test-admin@local.test" },
      update: {},
      create: {
        email: "marketing-test-admin@local.test",
        passwordHash: "$2a$10$dummyhashformarketingdashboardtests000000000000000",
        role: "SUPER_ADMIN",
      },
    });
    testAdminId = admin.id;

    // 2. Create Bot A & Bot B (for isolation tests)
    const botA = await prisma.bot.create({
      data: {
        name: "Marketing Bot A",
        username: "mkt_bot_a",
        tokenEnvVar: "TEST_MKT_A_TOKEN",
        isActive: true,
      },
    });
    botAId = botA.id;

    const botB = await prisma.bot.create({
      data: {
        name: "Marketing Bot B",
        username: "mkt_bot_b",
        tokenEnvVar: "TEST_MKT_B_TOKEN",
        isActive: true,
      },
    });
    botBId = botB.id;

    // 3. Create Channels for Bot A
    const ch1 = await prisma.botChannel.create({
      data: {
        botId: botAId,
        name: "Bot A Alpha Channel",
        telegramChatId: "-1002222222221",
        inviteLink: "https://t.me/+alpha1",
        buttonLabel: "Join Alpha",
        isRequired: true,
        isEnabled: true,
        order: 1,
      },
    });
    channelA1Id = ch1.id;

    const ch2 = await prisma.botChannel.create({
      data: {
        botId: botAId,
        name: "Bot A Beta Channel",
        telegramChatId: "-1002222222222",
        inviteLink: "https://t.me/+beta2",
        buttonLabel: "Join Beta",
        isRequired: false,
        isEnabled: true,
        order: 2,
      },
    });
    channelA2Id = ch2.id;
  });

  afterAll(async () => {
    // Clean up test data
    await prisma.campaignTouch.deleteMany({
      where: { botId: { in: [botAId, botBId] } },
    });
    await prisma.marketingConsentRecord.deleteMany({
      where: { botId: { in: [botAId, botBId] } },
    });
    await prisma.marketingCampaign.deleteMany({
      where: { botId: { in: [botAId, botBId] } },
    });
    await prisma.channelActivityEvent.deleteMany({
      where: { botId: { in: [botAId, botBId] } },
    });
    await prisma.telegramUser.deleteMany({
      where: { botId: { in: [botAId, botBId] } },
    });
    await prisma.botChannel.deleteMany({
      where: { botId: { in: [botAId, botBId] } },
    });
    await prisma.bot.deleteMany({
      where: { id: { in: [botAId, botBId] } },
    });
    await prisma.adminUser.deleteMany({
      where: { id: testAdminId },
    });
  });

  it("1. Creates marketing campaign tracking link with validation and deep link formatting", async () => {
    const campaign = await createMarketingCampaign({
      botId: botAId,
      name: "Twitter Launch 2026",
      slug: "twitter_launch",
      description: "Organic promo link for Twitter bio",
      targetChannelId: channelA1Id,
      createdById: testAdminId,
    });

    expect(campaign.id).toBeDefined();
    expect(campaign.slug).toBe("twitter_launch");
    expect(campaign.deepLink).toBe("https://t.me/mkt_bot_a?start=c_twitter_launch");
    expect(campaign.clicksCount).toBe(0);
    expect(campaign.uniqueStartsCount).toBe(0);

    // Rejects invalid slug
    await expect(
      createMarketingCampaign({
        botId: botAId,
        name: "Invalid Slug Campaign",
        slug: "invalid slug with spaces!",
      })
    ).rejects.toThrow();

    // Rejects duplicate slug for same bot
    await expect(
      createMarketingCampaign({
        botId: botAId,
        name: "Duplicate Slug Campaign",
        slug: "twitter_launch",
      })
    ).rejects.toThrow();
  });

  it("2. Accurately attributes first-touch vs return-touch campaign interactions", async () => {
    const testUserId = 8800112233;

    // Touch 1: First Touch for new user
    const touch1 = await recordCampaignTouch({
      botId: botAId,
      slug: "twitter_launch",
      telegramUserId: testUserId,
      isNewUser: true,
    });

    expect(touch1.attributed).toBe(true);
    expect(touch1.isNewUser).toBe(true);
    expect(touch1.campaignName).toBe("Twitter Launch 2026");

    // Update TelegramUser profile name
    await prisma.telegramUser.update({
      where: {
        botId_telegramId: {
          botId: botAId,
          telegramId: BigInt(testUserId),
        },
      },
      data: {
        firstName: "Charlie",
        username: "charlie_test",
      },
    });

    // Touch 2: Return Touch by existing user
    const touch2 = await recordCampaignTouch({
      botId: botAId,
      slug: "twitter_launch",
      telegramUserId: testUserId,
      isNewUser: false,
    });

    expect(touch2.attributed).toBe(true);
    expect(touch2.isNewUser).toBe(false);

    // Verify campaign touch counters
    const campaigns = await getMarketingCampaigns([botAId]);
    const camp = campaigns.find((c) => c.slug === "twitter_launch");
    expect(camp?.clicksCount).toBe(2);
    expect(camp?.uniqueStartsCount).toBe(1); // unique start count only incremented once per distinct user
  });

  it("3. Handles missing or inactive campaign source safely without crashing", async () => {
    const res = await recordCampaignTouch({
      botId: botAId,
      slug: "non_existent_campaign_slug",
      telegramUserId: 999111222,
    });

    expect(res.attributed).toBe(false);
  });

  it("4. Tracks marketing consent lifecycle: defaults to UNSPECIFIED, supports /optin, /optout and exclusion", async () => {
    const consentUserId = 7700223344;

    // Create user with default consent
    const user = await prisma.telegramUser.create({
      data: {
        botId: botAId,
        telegramId: BigInt(consentUserId),
        firstName: "Diana",
        username: "diana_mkt",
      },
    });

    expect(user.marketingConsent).toBe("UNSPECIFIED");

    // 1. Opt-in via command
    const optInSuccess = await recordMarketingConsent({
      botId: botAId,
      telegramUserId: consentUserId,
      consentStatus: "OPTED_IN",
      source: "COMMAND_OPTIN",
      purpose: "GENERAL_MARKETING",
    });
    expect(optInSuccess).toBe(true);

    const userOptedIn = await prisma.telegramUser.findUnique({
      where: { id: user.id },
    });
    expect(userOptedIn?.marketingConsent).toBe("OPTED_IN");
    expect(userOptedIn?.marketingConsentSource).toBe("COMMAND_OPTIN");

    // 2. Opt-out via command / withdrawal
    const optOutSuccess = await recordMarketingConsent({
      botId: botAId,
      telegramUserId: consentUserId,
      consentStatus: "OPTED_OUT",
      source: "COMMAND_OPTOUT",
    });
    expect(optOutSuccess).toBe(true);

    const userOptedOut = await prisma.telegramUser.findUnique({
      where: { id: user.id },
    });
    expect(userOptedOut?.marketingConsent).toBe("OPTED_OUT");
  });

  it("5. Computes Marketing Overview metrics: joins, leaves, net joins, unique selectors, and confirmed members", async () => {
    const user1 = 1001;
    const user2 = 1002;
    const user3 = 1003;

    // Create activity events
    // user1 joined channel 1
    await recordChannelActivityEvent({
      botId: botAId,
      channelId: channelA1Id,
      telegramChatId: "-1002222222221",
      telegramUserId: user1,
      eventType: "JOINED",
      source: "TELEGRAM_UPDATE",
      updateId: 91001,
    });

    // user2 joined channel 1
    await recordChannelActivityEvent({
      botId: botAId,
      channelId: channelA1Id,
      telegramChatId: "-1002222222221",
      telegramUserId: user2,
      eventType: "JOINED",
      source: "TELEGRAM_UPDATE",
      updateId: 91002,
    });

    // user1 left channel 1
    await recordChannelActivityEvent({
      botId: botAId,
      channelId: channelA1Id,
      telegramChatId: "-1002222222221",
      telegramUserId: user1,
      eventType: "LEFT",
      source: "TELEGRAM_UPDATE",
      updateId: 91003,
    });

    // user3 clicked channel link (CHANNEL_SELECTED)
    await recordChannelActivityEvent({
      botId: botAId,
      channelId: channelA2Id,
      telegramChatId: "-1002222222222",
      telegramUserId: user3,
      eventType: "CHANNEL_SELECTED",
      source: "FLOW_SELECTION",
    });

    // user2 verified membership (MEMBERSHIP_CHECK)
    await recordChannelActivityEvent({
      botId: botAId,
      channelId: channelA1Id,
      telegramChatId: "-1002222222221",
      telegramUserId: user2,
      eventType: "MEMBERSHIP_CHECK",
      status: "joined",
      source: "MANUAL_CHECK",
    });

    // Calculate metrics for Bot A
    const metrics = await getMarketingOverviewMetrics({
      botIds: [botAId],
      dateRange: "all",
    });

    expect(metrics.observedJoins).toBe(2);
    expect(metrics.observedLeaves).toBe(1);
    expect(metrics.netObservedJoins).toBe(1); // 2 joins - 1 leave = 1
    expect(metrics.uniqueChannelSelectors).toBe(1); // user3
    expect(metrics.uniqueMembershipConfirmed).toBe(1); // user2
    expect(metrics.trackingStartDate).toBeDefined();
    expect(metrics.dataCompletenessNote).toContain("events observed since bot installation");
  });

  it("6. Deduplicates users across multiple channels in audience counts", async () => {
    const multiChannelUser = 500500500;

    // Same user interacts with Channel A1 AND Channel A2
    await recordChannelActivityEvent({
      botId: botAId,
      channelId: channelA1Id,
      telegramChatId: "-1002222222221",
      telegramUserId: multiChannelUser,
      eventType: "JOINED",
      source: "TELEGRAM_UPDATE",
      updateId: 92001,
    });

    await recordChannelActivityEvent({
      botId: botAId,
      channelId: channelA2Id,
      telegramChatId: "-1002222222222",
      telegramUserId: multiChannelUser,
      eventType: "JOINED",
      source: "TELEGRAM_UPDATE",
      updateId: 92002,
    });

    // Upsert user profile
    await prisma.telegramUser.upsert({
      where: {
        botId_telegramId: {
          botId: botAId,
          telegramId: BigInt(multiChannelUser),
        },
      },
      update: {},
      create: {
        botId: botAId,
        telegramId: BigInt(multiChannelUser),
        firstName: "MultiChannel User",
      },
    });

    const audienceRes = await getAudienceList({
      botIds: [botAId],
      search: "500500500",
    });

    // Must be counted as EXACTLY ONE profile in the audience table
    expect(audienceRes.total).toBe(1);
    expect(audienceRes.audience.length).toBe(1);
    const profile = audienceRes.audience[0];
    expect(profile.telegramId).toBe("500500500");
    // But has both channels listed in associatedChannels
    expect(profile.associatedChannels.length).toBe(2);
  });

  it("7. Enforces strict multi-bot isolation (Bot B cannot see Bot A campaigns or audience)", async () => {
    // Bot B queries should return 0 for Bot A's campaigns and audience
    const botBCampaigns = await getMarketingCampaigns([botBId]);
    expect(botBCampaigns.length).toBe(0);

    const botBAudience = await getAudienceList({
      botIds: [botBId],
    });
    expect(botBAudience.total).toBe(0);

    const botBMetrics = await getMarketingOverviewMetrics({
      botIds: [botBId],
    });
    expect(botBMetrics.newBotUsers).toBe(0);
    expect(botBMetrics.observedJoins).toBe(0);
  });

  it("8. Gracefully handles incomplete event history / bots with 0 recorded events", async () => {
    const emptyMetrics = await getMarketingOverviewMetrics({
      botIds: [botBId],
      dateRange: "today",
    });

    expect(emptyMetrics.newBotUsers).toBe(0);
    expect(emptyMetrics.observedJoins).toBe(0);
    expect(emptyMetrics.netObservedJoins).toBe(0);
    expect(emptyMetrics.uniqueChannelSelectors).toBe(0);
    expect(emptyMetrics.uniqueMembershipConfirmed).toBe(0);
    expect(emptyMetrics.growthTrend).toBeDefined();
  });
});
