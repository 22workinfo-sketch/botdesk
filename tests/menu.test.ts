import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/lib/prisma";
import {
  handleTelegramStart,
  handleTelegramContact,
  handleTelegramText,
  getBotButtons,
  saveBotButtons,
  updateBotWelcomeMessage,
} from "../src/lib/bot-service";

describe("Bot Menu Builder & Dynamic Keyboard Integration (Real PostgreSQL)", () => {
  const testBotAId = "99999999-menu-1111-1111-111111111111";
  const testBotBId = "99999999-menu-2222-2222-222222222222";

  beforeAll(async () => {
    // 1. Setup isolated test bots
    await prisma.bot.upsert({
      where: { id: testBotAId },
      create: {
        id: testBotAId,
        name: "Test Menu Bot A",
        username: "test_menu_bot_a",
      },
      update: {},
    });

    await prisma.botConfig.upsert({
      where: { botId: testBotAId },
      create: {
        botId: testBotAId,
        welcomeMessage: "Welcome to Bot A! Please choose an option from the menu.",
      },
      update: {},
    });

    await prisma.bot.upsert({
      where: { id: testBotBId },
      create: {
        id: testBotBId,
        name: "Test Menu Bot B",
        username: "test_menu_bot_b",
      },
      update: {},
    });

    await prisma.botConfig.upsert({
      where: { botId: testBotBId },
      create: {
        botId: testBotBId,
        welcomeMessage: "Welcome to Bot B!",
      },
      update: {},
    });
  });

  afterAll(async () => {
    // Clean up test records strictly isolated to our test bots
    const testIds = [testBotAId, testBotBId];
    await prisma.botButton.deleteMany({ where: { botId: { in: testIds } } });
    await prisma.telegramUser.deleteMany({ where: { botId: { in: testIds } } });
    await prisma.auditLog.deleteMany({ where: { botId: { in: testIds } } });
    await prisma.botConfig.deleteMany({ where: { botId: { in: testIds } } });
    await prisma.bot.deleteMany({ where: { id: { in: testIds } } });
    await prisma.$disconnect();
  });

  it("should add and persist configured buttons (SEND_TEXT & REQUEST_CONTACT)", async () => {
    const initialButtons = [
      {
        label: "📱 Share Phone Number",
        actionType: "REQUEST_CONTACT",
        isEnabled: true,
        order: 0,
      },
      {
        label: "ℹ️ Help / Info",
        actionType: "SEND_TEXT",
        replyText: "Here is the help guide for Bot A.",
        isEnabled: true,
        order: 1,
      },
      {
        label: "🕒 Working Hours",
        actionType: "SEND_TEXT",
        replyText: "We are open Monday to Friday, 9am - 6pm.",
        isEnabled: true,
        order: 2,
      },
    ];

    const saved = await saveBotButtons(testBotAId, initialButtons);
    expect(saved).toHaveLength(3);

    const fetched = await getBotButtons(testBotAId);
    expect(fetched).toHaveLength(3);
    expect(fetched[0].label).toBe("📱 Share Phone Number");
    expect(fetched[0].actionType).toBe("REQUEST_CONTACT");
    expect(fetched[1].label).toBe("ℹ️ Help / Info");
    expect(fetched[1].replyText).toBe("Here is the help guide for Bot A.");
    expect(fetched[2].label).toBe("🕒 Working Hours");
  });

  it("should edit an existing button's label and reply text", async () => {
    const current = await getBotButtons(testBotAId);
    expect(current.length).toBeGreaterThanOrEqual(3);

    const updatedPayload = current.map((btn) => {
      if (btn.label === "🕒 Working Hours") {
        return {
          ...btn,
          label: "🕒 Support Schedule",
          replyText: "Our support schedule is now 24/7 online.",
        };
      }
      return btn;
    });

    await saveBotButtons(testBotAId, updatedPayload);

    const refetched = await getBotButtons(testBotAId);
    const updatedBtn = refetched.find((b) => b.label === "🕒 Support Schedule");
    expect(updatedBtn).toBeDefined();
    expect(updatedBtn?.replyText).toBe("Our support schedule is now 24/7 online.");
  });

  it("should disable a button and verify isEnabled is false", async () => {
    const current = await getBotButtons(testBotAId);
    const updatedPayload = current.map((btn) => {
      if (btn.label === "🕒 Support Schedule") {
        return { ...btn, isEnabled: false };
      }
      return btn;
    });

    await saveBotButtons(testBotAId, updatedPayload);

    const allButtons = await getBotButtons(testBotAId);
    const disabledBtn = allButtons.find((b) => b.label === "🕒 Support Schedule");
    expect(disabledBtn?.isEnabled).toBe(false);

    // Only enabled buttons check
    const onlyEnabled = await getBotButtons(testBotAId, true);
    expect(onlyEnabled.some((b) => b.label === "🕒 Support Schedule")).toBe(false);
  });

  it("should reorder buttons and persist the new order indices", async () => {
    const current = await getBotButtons(testBotAId);

    // Swap order: put "ℹ️ Help / Info" first (order 0) and "📱 Share Phone Number" second (order 1)
    const helpBtn = current.find((b) => b.label === "ℹ️ Help / Info")!;
    const phoneBtn = current.find((b) => b.label === "📱 Share Phone Number")!;
    const schedBtn = current.find((b) => b.label === "🕒 Support Schedule")!;

    const reordered = [
      { ...helpBtn, order: 0 },
      { ...phoneBtn, order: 1 },
      { ...schedBtn, order: 2 },
    ];

    await saveBotButtons(testBotAId, reordered);

    const refetched = await getBotButtons(testBotAId);
    expect(refetched[0].label).toBe("ℹ️ Help / Info");
    expect(refetched[1].label).toBe("📱 Share Phone Number");
    expect(refetched[2].label).toBe("🕒 Support Schedule");
  });

  it("should delete a button and remove it from PostgreSQL", async () => {
    const current = await getBotButtons(testBotAId);
    // Remove "🕒 Support Schedule"
    const remaining = current.filter((b) => b.label !== "🕒 Support Schedule");

    await saveBotButtons(testBotAId, remaining);

    const refetched = await getBotButtons(testBotAId);
    expect(refetched).toHaveLength(2);
    expect(refetched.some((b) => b.label === "🕒 Support Schedule")).toBe(false);
  });

  it("should reject duplicate button labels within the same bot", async () => {
    const invalidButtons = [
      { label: "Duplicate Label", actionType: "SEND_TEXT", replyText: "Text 1", isEnabled: true, order: 0 },
      { label: "duplicate label", actionType: "SEND_TEXT", replyText: "Text 2", isEnabled: true, order: 1 },
    ];

    await expect(saveBotButtons(testBotAId, invalidButtons)).rejects.toThrow(
      /Duplicate button label detected/
    );
  });

  it("should reject empty button labels", async () => {
    const invalidButtons = [
      { label: "   ", actionType: "SEND_TEXT", replyText: "Text", isEnabled: true, order: 0 },
    ];

    await expect(saveBotButtons(testBotAId, invalidButtons)).rejects.toThrow(
      /must have a non-empty label/
    );
  });

  it("should reject SEND_TEXT buttons without reply text", async () => {
    const invalidButtons = [
      { label: "Missing Reply", actionType: "SEND_TEXT", replyText: "", isEnabled: true, order: 0 },
    ];

    await expect(saveBotButtons(testBotAId, invalidButtons)).rejects.toThrow(
      /requires a reply text for the SEND_TEXT action/
    );
  });

  it("should enforce strict bot_id scoping so Bot A's menu never leaks to Bot B", async () => {
    // Configure Bot B with different buttons
    await saveBotButtons(testBotBId, [
      {
        label: "Bot B Exclusive Button",
        actionType: "SEND_TEXT",
        replyText: "Welcome to Bot B only!",
        isEnabled: true,
        order: 0,
      },
    ]);

    const botAButtons = await getBotButtons(testBotAId);
    const botBButtons = await getBotButtons(testBotBId);

    const botALabels = botAButtons.map((b) => b.label);
    const botBLabels = botBButtons.map((b) => b.label);

    expect(botALabels).not.toContain("Bot B Exclusive Button");
    expect(botBLabels).toContain("Bot B Exclusive Button");
    expect(botBLabels).not.toContain("ℹ️ Help / Info");
  });

  it("should return latest enabled buttons in correct order during /start", async () => {
    const startResult = await handleTelegramStart({
      botId: testBotAId,
      telegramId: 555666777,
      firstName: "MenuUser",
      username: "menu_user",
    });

    expect(startResult.welcomeMessage).toBe(
      "Welcome to Bot A! Please choose an option from the menu."
    );
    expect(startResult.buttons).toBeDefined();
    expect(startResult.buttons).toHaveLength(2);
    // In our reordering test, Help was set to order 0, Phone was order 1
    expect(startResult.buttons[0].label).toBe("ℹ️ Help / Info");
    expect(startResult.buttons[1].label).toBe("📱 Share Phone Number");
  });

  it("should execute SEND_TEXT and return the configured response", async () => {
    const textResult = await handleTelegramText(testBotAId, "ℹ️ Help / Info");
    expect(textResult.handled).toBe(true);
    expect(textResult.replyText).toBe("Here is the help guide for Bot A.");
  });

  it("should gracefully ignore disabled, deleted, or unrecognized buttons", async () => {
    // Deleted button
    const deletedResult = await handleTelegramText(testBotAId, "🕒 Support Schedule");
    expect(deletedResult.handled).toBe(false);

    // Random user text message
    const randomResult = await handleTelegramText(testBotAId, "Hello how are you?");
    expect(randomResult.handled).toBe(false);
  });

  it("should preserve REQUEST_CONTACT ownership validation and reject foreign contacts", async () => {
    const senderId = 555666777;

    // 1. Valid matching contact
    const validContact = await handleTelegramContact({
      botId: testBotAId,
      senderTelegramId: senderId,
      contactUserId: senderId,
      phoneNumber: "+15551234567",
    });
    expect(validContact.success).toBe(true);
    if (validContact.success) {
      expect(validContact.user.telegramPhNo).toBe("+15551234567");
    }

    // 2. Foreign contact attempt (ownership mismatch)
    const foreignContact = await handleTelegramContact({
      botId: testBotAId,
      senderTelegramId: senderId,
      contactUserId: 999888777, // foreign user ID
      phoneNumber: "+15559999999",
    });
    expect(foreignContact.success).toBe(false);
    if (!foreignContact.success) {
      expect(foreignContact.reason).toBe("OWNERSHIP_MISMATCH");
    }

    // Verify existing verified number was not overwritten
    const dbUser = await prisma.telegramUser.findUnique({
      where: {
        botId_telegramId: {
          botId: testBotAId,
          telegramId: BigInt(senderId),
        },
      },
    });
    expect(dbUser?.telegramPhNo).toBe("+15551234567");
  });

  it("should preserve existing welcome message and user registration functionality", async () => {
    const newWelcomeMessage = "Brand New Custom Welcome for Bot A!";
    await updateBotWelcomeMessage({
      botId: testBotAId,
      welcomeMessage: newWelcomeMessage,
    });

    const startResult = await handleTelegramStart({
      botId: testBotAId,
      telegramId: 555666777,
      firstName: "MenuUserUpdated",
    });

    expect(startResult.welcomeMessage).toBe(newWelcomeMessage);
    expect(startResult.user.firstName).toBe("MenuUserUpdated");
  });
});
