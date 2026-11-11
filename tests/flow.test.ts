import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "../src/lib/prisma";
import { validateFlowStructure } from "../src/lib/flow/validation";
import {
  saveDraftFlow,
  publishFlow,
  rollbackFlow,
  getBotFlowData,
  getActivePublishedFlow,
} from "../src/lib/flow/flow-service";
import {
  handleFlowStart,
  handleFlowText,
} from "../src/lib/flow/flow-engine";
import { FlowStructure } from "../src/lib/flow/types";
import { GET as getFlowRoute } from "../src/app/api/bots/[id]/flow/route";
import { PUT as saveDraftRoute } from "../src/app/api/bots/[id]/flow/draft/route";
import { POST as publishFlowRoute } from "../src/app/api/bots/[id]/flow/publish/route";
import { POST as rollbackFlowRoute } from "../src/app/api/bots/[id]/flow/rollback/route";
import { createSessionToken } from "../src/lib/auth";

describe("Bot Flow V1: Engine, Validation, Lifecycle & Multi-Bot State Suite", () => {
  const botAId = "99999999-flow-1111-1111-111111111111";
  const botBId = "99999999-flow-2222-2222-222222222222";
  const staffSuperAdminId = "99999999-flow-admin-1111-111111111111";

  beforeAll(async () => {
    // 0. Clean prior test artifacts
    const testIds = [botAId, botBId];
    await prisma.botFlow.deleteMany({ where: { botId: { in: testIds } } });
    await prisma.telegramUser.deleteMany({ where: { botId: { in: testIds } } });

    // 1. Create test bots
    await prisma.bot.upsert({
      where: { id: botAId },
      create: {
        id: botAId,
        name: "Flow Test Bot A",
        username: "flow_test_bot_a",
      },
      update: {},
    });

    await prisma.botConfig.upsert({
      where: { botId: botAId },
      create: {
        botId: botAId,
        welcomeMessage: "Welcome to Flow Bot A!",
      },
      update: {},
    });

    await prisma.bot.upsert({
      where: { id: botBId },
      create: {
        id: botBId,
        name: "Flow Test Bot B",
        username: "flow_test_bot_b",
      },
      update: {},
    });

    await prisma.botConfig.upsert({
      where: { botId: botBId },
      create: {
        botId: botBId,
        welcomeMessage: "Welcome to Flow Bot B!",
      },
      update: {},
    });

    // 2. Create test admin
    await prisma.adminUser.upsert({
      where: { id: staffSuperAdminId },
      create: {
        id: staffSuperAdminId,
        email: "flow_admin@test.local",
        passwordHash: "$2b$10$abcdefghijklmnopqrstuvwxyz123456",
        role: "SUPER_ADMIN",
      },
      update: {},
    });
  });

  afterAll(async () => {
    const botIds = [botAId, botBId];
    await prisma.botFlow.deleteMany({ where: { botId: { in: botIds } } });
    await prisma.telegramUser.deleteMany({ where: { botId: { in: botIds } } });
    await prisma.auditLog.deleteMany({ where: { botId: { in: botIds } } });
    await prisma.botConfig.deleteMany({ where: { botId: { in: botIds } } });
    await prisma.bot.deleteMany({ where: { id: { in: botIds } } });
    await prisma.adminUser.deleteMany({ where: { id: staffSuperAdminId } });
    await prisma.$disconnect();
  });

  // =========================================================================
  // 1. FLOW VALIDATION TESTS
  // =========================================================================
  describe("1. Flow Structure Pre-flight Validation", () => {
    it("rejects an empty or invalid root structure", () => {
      const res = validateFlowStructure(null as any);
      expect(res.isValid).toBe(false);
      expect(res.errors[0]).toContain("Root structure must be an object");
    });

    it("rejects a flow with no enabled buttons in root menu", () => {
      const invalidStruct: FlowStructure = {
        rootMenu: {
          id: "root",
          title: "Main Menu",
          buttons: [
            {
              id: "btn-1",
              label: "Disabled Button",
              actionType: "SEND_TEXT",
              replyText: "Hi",
              isEnabled: false,
              order: 0,
            },
          ],
        },
        submenus: {},
      };

      const res = validateFlowStructure(invalidStruct);
      expect(res.isValid).toBe(false);
      expect(res.errors).toContain(
        "Main menu must have at least one enabled button."
      );
    });

    it("rejects duplicate button labels within the same menu level", () => {
      const duplicateStruct: FlowStructure = {
        rootMenu: {
          id: "root",
          title: "Main Menu",
          buttons: [
            {
              id: "btn-1",
              label: "Support",
              actionType: "SEND_TEXT",
              replyText: "Contact support",
              isEnabled: true,
              order: 0,
            },
            {
              id: "btn-2",
              label: "support", // Case-insensitive duplicate
              actionType: "SEND_TEXT",
              replyText: "Contact support again",
              isEnabled: true,
              order: 1,
            },
          ],
        },
        submenus: {},
      };

      const res = validateFlowStructure(duplicateStruct);
      expect(res.isValid).toBe(false);
      expect(res.errors.some((e) => e.includes("Duplicate button label"))).toBe(
        true
      );
    });

    it("rejects OPEN_SUBMENU with missing or invalid target menu", () => {
      const missingTargetStruct: FlowStructure = {
        rootMenu: {
          id: "root",
          title: "Main Menu",
          buttons: [
            {
              id: "btn-1",
              label: "Open Submenu",
              actionType: "OPEN_SUBMENU",
              targetMenuId: "non-existent-sub",
              isEnabled: true,
              order: 0,
            },
          ],
        },
        submenus: {},
      };

      const res = validateFlowStructure(missingTargetStruct);
      expect(res.isValid).toBe(false);
      expect(
        res.errors.some((e) => e.includes("Target submenu 'non-existent-sub' does not exist"))
      ).toBe(true);
    });

    it("rejects empty submenus (submenus with zero enabled buttons)", () => {
      const emptySubStruct: FlowStructure = {
        rootMenu: {
          id: "root",
          title: "Main Menu",
          buttons: [
            {
              id: "btn-1",
              label: "Open Sub",
              actionType: "OPEN_SUBMENU",
              targetMenuId: "sub-empty",
              isEnabled: true,
              order: 0,
            },
          ],
        },
        submenus: {
          "sub-empty": {
            id: "sub-empty",
            title: "Empty Submenu",
            buttons: [],
          },
        },
      };

      const res = validateFlowStructure(emptySubStruct);
      expect(res.isValid).toBe(false);
      expect(res.errors.some((e) => e.includes("has no enabled buttons"))).toBe(
        true
      );
    });

    it("rejects invalid URL format for URL action buttons", () => {
      const invalidUrlStruct: FlowStructure = {
        rootMenu: {
          id: "root",
          title: "Main Menu",
          buttons: [
            {
              id: "btn-1",
              label: "Website",
              actionType: "URL",
              url: "not-a-valid-url",
              isEnabled: true,
              order: 0,
            },
          ],
        },
        submenus: {},
      };

      const res = validateFlowStructure(invalidUrlStruct);
      expect(res.isValid).toBe(false);
      expect(res.errors.some((e) => e.includes("Invalid URL format") || e.includes("must start with http"))).toBe(true);
    });

    it("rejects invalid auto-delete timer below 5 seconds or above 86400 seconds", () => {
      const invalidTimerStruct: FlowStructure = {
        rootMenu: {
          id: "root",
          title: "Main Menu",
          buttons: [
            {
              id: "btn-1",
              label: "Fast Delete",
              actionType: "SEND_TEXT",
              replyText: "Will delete",
              autoDeleteReply: true,
              deleteAfterSeconds: 2, // invalid: min is 5
              isEnabled: true,
              order: 0,
            },
          ],
        },
        submenus: {},
      };

      const res = validateFlowStructure(invalidTimerStruct);
      expect(res.isValid).toBe(false);
      expect(
        res.errors.some((e) => e.includes("Auto-delete timer must be an integer between 5 and 86,400"))
      ).toBe(true);
    });

    it("validates a complete, healthy multi-level flow structure", () => {
      const validStruct: FlowStructure = {
        rootMenu: {
          id: "root",
          title: "Main Menu",
          promptText: "Welcome to our store!",
          buttons: [
            {
              id: "btn-prod",
              label: "📁 Products",
              actionType: "OPEN_SUBMENU",
              targetMenuId: "sub-products",
              isEnabled: true,
              order: 0,
            },
            {
              id: "btn-site",
              label: "🌐 Official Site",
              actionType: "URL",
              url: "https://example.com/shop",
              urlLabel: "Visit Shop",
              isEnabled: true,
              order: 1,
            },
            {
              id: "btn-phone",
              label: "📱 Share Phone",
              actionType: "REQUEST_CONTACT",
              isEnabled: true,
              order: 2,
            },
          ],
        },
        submenus: {
          "sub-products": {
            id: "sub-products",
            title: "Products",
            promptText: "Select a category:",
            buttons: [
              {
                id: "btn-p1",
                label: "🎮 Games",
                actionType: "SEND_TEXT",
                replyText: "We offer top games.",
                autoDeleteReply: true,
                deleteAfterSeconds: 60,
                isEnabled: true,
                order: 0,
              },
            ],
          },
        },
      };

      const res = validateFlowStructure(validStruct);
      expect(res.isValid).toBe(true);
      expect(res.errors).toHaveLength(0);
    });
  });

  // =========================================================================
  // 2. DRAFT, PUBLISH AND ROLLBACK LIFECYCLE
  // =========================================================================
  describe("2. Draft, Publish and Rollback Lifecycle", () => {
    const validFlowStructureV1: FlowStructure = {
      rootMenu: {
        id: "root",
        title: "Main Menu",
        promptText: "Bot A Flow v1 Root",
        buttons: [
          {
            id: "btn-sub1",
            label: "📂 Support Menu",
            actionType: "OPEN_SUBMENU",
            targetMenuId: "sub-support",
            isEnabled: true,
            order: 0,
          },
          {
            id: "btn-text1",
            label: "ℹ️ FAQ",
            actionType: "SEND_TEXT",
            replyText: "Here is FAQ v1",
            isEnabled: true,
            order: 1,
          },
        ],
      },
      submenus: {
        "sub-support": {
          id: "sub-support",
          title: "Support Department",
          promptText: "Support Options:",
          buttons: [
            {
              id: "btn-billing",
              label: "💳 Billing Support",
              actionType: "SEND_TEXT",
              replyText: "Billing team replies: Monday to Friday 9-5",
              isEnabled: true,
              order: 0,
            },
          ],
        },
      },
    };

    it("saves draft without affecting published flow", async () => {
      // 1. Initial state: no published flow
      const initialActive = await getActivePublishedFlow(botAId);
      expect(initialActive).toBeNull();

      // 2. Save draft
      await saveDraftFlow(botAId, validFlowStructureV1, staffSuperAdminId);

      // 3. Draft saved in DB, but published flow is still null
      const data = await getBotFlowData(botAId);
      expect(data.draft).not.toBeNull();
      expect((data.draft?.structure as any).rootMenu.promptText).toBe("Bot A Flow v1 Root");
      expect(data.published).toBeNull();

      const activeAfterDraft = await getActivePublishedFlow(botAId);
      expect(activeAfterDraft).toBeNull();
    });

    it("publishes draft to create Version 1 in PostgreSQL", async () => {
      const published = await publishFlow(botAId, staffSuperAdminId);
      expect(published.status).toBe("PUBLISHED");
      expect(published.version).toBe(1);

      const active = await getActivePublishedFlow(botAId);
      expect(active).not.toBeNull();
      expect(active?.version).toBe(1);

      const data = await getBotFlowData(botAId);
      expect(data.published?.version).toBe(1);
      expect(data.versions.length).toBeGreaterThanOrEqual(1);
    });

    it("edits draft, publishes Version 2, and preserves Version 1 in history", async () => {
      // Modify draft to create Version 2
      const modifiedStructureV2: FlowStructure = JSON.parse(
        JSON.stringify(validFlowStructureV1)
      );
      modifiedStructureV2.rootMenu.promptText = "Bot A Flow v2 Root (Updated)";
      modifiedStructureV2.rootMenu.buttons[1].replyText = "Here is FAQ v2 (Updated)";

      await saveDraftFlow(botAId, modifiedStructureV2, staffSuperAdminId);

      // Before publish: live bot still sees v1
      const activeBeforePublish = await getActivePublishedFlow(botAId);
      expect(activeBeforePublish?.version).toBe(1);
      const activeStructBefore = activeBeforePublish?.structure as unknown as FlowStructure;
      expect(activeStructBefore.rootMenu.promptText).toBe("Bot A Flow v1 Root");

      // Publish Version 2
      const publishedV2 = await publishFlow(botAId, staffSuperAdminId);
      expect(publishedV2.version).toBe(2);

      // Live bot now sees v2
      const activeAfterPublish = await getActivePublishedFlow(botAId);
      expect(activeAfterPublish?.version).toBe(2);
      const activeStructAfter = activeAfterPublish?.structure as unknown as FlowStructure;
      expect(activeStructAfter.rootMenu.promptText).toBe("Bot A Flow v2 Root (Updated)");

      // Check version history has v1 (ARCHIVED) and v2 (PUBLISHED)
      const data = await getBotFlowData(botAId);
      const v1Record = data.versions.find((v) => v.version === 1);
      const v2Record = data.versions.find((v) => v.version === 2);
      expect(v1Record?.status).toBe("ARCHIVED");
      expect(v2Record?.status).toBe("PUBLISHED");
    });

    it("rolls back to Version 1 and activates it immediately", async () => {
      const restored = await rollbackFlow(botAId, 1, staffSuperAdminId);
      expect(restored.status).toBe("PUBLISHED");

      const active = await getActivePublishedFlow(botAId);
      expect(active).not.toBeNull();
      const activeStruct = active?.structure as unknown as FlowStructure;
      expect(activeStruct.rootMenu.promptText).toBe("Bot A Flow v1 Root");
    });

    it("preserves working draft during rollback when preserveDraft option is true", async () => {
      // 1. Set draft with work in progress
      const draftWip: FlowStructure = JSON.parse(JSON.stringify(validFlowStructureV1));
      draftWip.rootMenu.promptText = "Unpublished Work in Progress!";
      await saveDraftFlow(botAId, draftWip, staffSuperAdminId);

      // 2. Perform rollback with preserveDraft: true
      await rollbackFlow(botAId, 1, staffSuperAdminId, { preserveDraft: true });

      // 3. Live bot has Version 1, but draft retains "Unpublished Work in Progress!"
      const data = await getBotFlowData(botAId);
      expect((data.draft?.structure as any).rootMenu.promptText).toBe("Unpublished Work in Progress!");
    });
  });

  // =========================================================================
  // 3. RUNTIME FLOW ENGINE EXECUTION & NAVIGATION
  // =========================================================================
  describe("3. Runtime Flow Engine: Multi-Level Navigation, Back, and Main Menu", () => {
    const multiLevelFlow: FlowStructure = {
      rootMenu: {
        id: "root",
        title: "Main Menu",
        promptText: "Root Menu: Choose a service",
        buttons: [
          {
            id: "btn-services",
            label: "🛠 Services",
            actionType: "OPEN_SUBMENU",
            targetMenuId: "sub-services",
            isEnabled: true,
            order: 0,
          },
          {
            id: "btn-info",
            label: "ℹ️ About",
            actionType: "SEND_TEXT",
            replyText: "BackStage Bot Engine v1",
            autoDeleteReply: true,
            deleteAfterSeconds: 30,
            isEnabled: true,
            order: 1,
          },
          {
            id: "btn-url",
            label: "🌐 Web Portal",
            actionType: "URL",
            url: "https://example.com/portal",
            urlLabel: "Open Portal",
            isEnabled: true,
            order: 2,
          },
        ],
      },
      submenus: {
        "sub-services": {
          id: "sub-services",
          title: "Services",
          promptText: "Services List:",
          buttons: [
            {
              id: "btn-deep",
              label: "⚙️ Advanced Settings",
              actionType: "OPEN_SUBMENU",
              targetMenuId: "sub-deep",
              isEnabled: true,
              order: 0,
            },
            {
              id: "btn-service-faq",
              label: "❓ Services FAQ",
              actionType: "SEND_TEXT",
              replyText: "Our services FAQ answers all questions.",
              isEnabled: true,
              order: 1,
            },
          ],
        },
        "sub-deep": {
          id: "sub-deep",
          title: "Advanced Settings",
          promptText: "Deep Level 3 Menu:",
          buttons: [
            {
              id: "btn-deep-action",
              label: "🔒 Security Logs",
              actionType: "SEND_TEXT",
              replyText: "Security logs are encrypted and tamper-proof.",
              isEnabled: true,
              order: 0,
            },
          ],
        },
      },
    };

    beforeAll(async () => {
      await saveDraftFlow(botAId, multiLevelFlow, staffSuperAdminId);
      await publishFlow(botAId, staffSuperAdminId);
    });

    it("resets user to root menu on handleFlowStart", async () => {
      const userAId = 11111111;
      const startResult = await handleFlowStart(botAId, {
        telegramId: userAId,
        firstName: "Alice",
        username: "alice_test",
      });

      expect(startResult.hasFlow).toBe(true);
      expect(startResult.isRoot).toBe(true);
      expect(startResult.welcomeMessage).toBe("Root Menu: Choose a service");
      expect(startResult.buttons).toHaveLength(3);

      const dbUser = await prisma.telegramUser.findUnique({
        where: { botId_telegramId: { botId: botAId, telegramId: BigInt(userAId) } },
      });
      expect(dbUser?.currentMenuId).toBe("root");
      expect(dbUser?.navigationStack).toEqual([]);
    });

    it("navigates from Root -> Submenu (Level 1) upon tapping OPEN_SUBMENU", async () => {
      const userAId = 11111111;
      const res = await handleFlowText(botAId, userAId, "🛠 Services");

      expect(res.hasFlow).toBe(true);
      expect(res.handled).toBe(true);
      expect(res.actionType).toBe("OPEN_SUBMENU");
      expect(res.replyText).toBe("Services List:");
      expect(res.isRoot).toBe(false);
      expect(res.buttons?.map((b) => b.label)).toContain("⚙️ Advanced Settings");

      const dbUser = await prisma.telegramUser.findUnique({
        where: { botId_telegramId: { botId: botAId, telegramId: BigInt(userAId) } },
      });
      expect(dbUser?.currentMenuId).toBe("sub-services");
      expect(dbUser?.navigationStack).toEqual(["root"]);
    });

    it("navigates from Submenu (Level 1) -> Deep Submenu (Level 2)", async () => {
      const userAId = 11111111;
      const res = await handleFlowText(botAId, userAId, "⚙️ Advanced Settings");

      expect(res.handled).toBe(true);
      expect(res.actionType).toBe("OPEN_SUBMENU");
      expect(res.replyText).toBe("Deep Level 3 Menu:");
      expect(res.isRoot).toBe(false);
      expect(res.buttons?.map((b) => b.label)).toContain("🔒 Security Logs");

      const dbUser = await prisma.telegramUser.findUnique({
        where: { botId_telegramId: { botId: botAId, telegramId: BigInt(userAId) } },
      });
      expect(dbUser?.currentMenuId).toBe("sub-deep");
      expect(dbUser?.navigationStack).toEqual(["root", "sub-services"]);
    });

    it("executes SEND_TEXT in Deep Submenu with exact response", async () => {
      const userAId = 11111111;
      const res = await handleFlowText(botAId, userAId, "🔒 Security Logs");

      expect(res.handled).toBe(true);
      expect(res.actionType).toBe("SEND_TEXT");
      expect(res.replyText).toBe("Security logs are encrypted and tamper-proof.");

      // Menu location remains unchanged
      const dbUser = await prisma.telegramUser.findUnique({
        where: { botId_telegramId: { botId: botAId, telegramId: BigInt(userAId) } },
      });
      expect(dbUser?.currentMenuId).toBe("sub-deep");
    });

    it("handles '◀ Back' to pop one level up (Level 2 -> Level 1)", async () => {
      const userAId = 11111111;
      const res = await handleFlowText(botAId, userAId, "◀ Back");

      expect(res.handled).toBe(true);
      expect(res.actionType).toBe("NAVIGATE_BACK");
      expect(res.replyText).toBe("Services List:");
      expect(res.isRoot).toBe(false);
      expect(res.menu?.id).toBe("sub-services");

      const dbUser = await prisma.telegramUser.findUnique({
        where: { botId_telegramId: { botId: botAId, telegramId: BigInt(userAId) } },
      });
      expect(dbUser?.currentMenuId).toBe("sub-services");
      expect(dbUser?.navigationStack).toEqual(["root"]);
    });

    it("handles second '◀ Back' to return to Main Menu (Root)", async () => {
      const userAId = 11111111;
      const res = await handleFlowText(botAId, userAId, "◀ Back");

      expect(res.handled).toBe(true);
      expect(res.actionType).toBe("NAVIGATE_BACK");
      expect(res.isRoot).toBe(true);
      expect(res.menu?.id).toBe("root");

      const dbUser = await prisma.telegramUser.findUnique({
        where: { botId_telegramId: { botId: botAId, telegramId: BigInt(userAId) } },
      });
      expect(dbUser?.currentMenuId).toBe("root");
      expect(dbUser?.navigationStack).toEqual([]);
    });

    it("handles '🏠 Main Menu' to jump directly to Root from any depth", async () => {
      const userAId = 11111111;
      // Navigate to Level 1
      await handleFlowText(botAId, userAId, "🛠 Services");
      // Navigate to Level 2
      await handleFlowText(botAId, userAId, "⚙️ Advanced Settings");

      // Jump directly to Main Menu
      const res = await handleFlowText(botAId, userAId, "🏠 Main Menu");
      expect(res.handled).toBe(true);
      expect(res.actionType).toBe("NAVIGATE_MAIN");
      expect(res.isRoot).toBe(true);
      expect(res.menu?.id).toBe("root");

      const dbUser = await prisma.telegramUser.findUnique({
        where: { botId_telegramId: { botId: botAId, telegramId: BigInt(userAId) } },
      });
      expect(dbUser?.currentMenuId).toBe("root");
      expect(dbUser?.navigationStack).toEqual([]);
    });

    it("executes URL action correctly with inline button details", async () => {
      const userAId = 11111111;
      const res = await handleFlowText(botAId, userAId, "🌐 Web Portal");

      expect(res.handled).toBe(true);
      expect(res.actionType).toBe("URL");
      expect(res.url).toBe("https://example.com/portal");
      expect(res.urlLabel).toBe("Open Portal");
    });
  });

  // =========================================================================
  // 4. MULTI-BOT & MULTI-USER ISOLATION
  // =========================================================================
  describe("4. Multi-Bot & Multi-User State Isolation", () => {
    const flowBotBStructure: FlowStructure = {
      rootMenu: {
        id: "root",
        title: "Bot B Main Menu",
        promptText: "Welcome to Bot B Menu",
        buttons: [
          {
            id: "btn-b-games",
            label: "🎲 Games Hub",
            actionType: "SEND_TEXT",
            replyText: "Welcome to Bot B Games Hub!",
            isEnabled: true,
            order: 0,
          },
        ],
      },
      submenus: {},
    };

    beforeAll(async () => {
      await saveDraftFlow(botBId, flowBotBStructure, staffSuperAdminId);
      await publishFlow(botBId, staffSuperAdminId);
    });

    it("ensures Bot A and Bot B have completely isolated flows and buttons", async () => {
      const userTgId = 55555555;

      // User interacts with Bot A
      const startA = await handleFlowStart(botAId, { telegramId: userTgId });
      expect(startA.buttons?.map((b) => b.label)).toContain("🛠 Services");

      // User interacts with Bot B
      const startB = await handleFlowStart(botBId, { telegramId: userTgId });
      expect(startB.buttons?.map((b) => b.label)).toContain("🎲 Games Hub");

      // Button from Bot A sent to Bot B is unhandled
      const resCross = await handleFlowText(botBId, userTgId, "🛠 Services");
      expect(resCross.handled).toBe(false);

      // Button from Bot B sent to Bot B is handled
      const resValidB = await handleFlowText(botBId, userTgId, "🎲 Games Hub");
      expect(resValidB.handled).toBe(true);
      expect(resValidB.replyText).toBe("Welcome to Bot B Games Hub!");
    });

    it("ensures two users on the same bot maintain independent navigation states", async () => {
      const userAlice = 77770001;
      const userBob = 77770002;

      // Both start at Root on Bot A
      await handleFlowStart(botAId, { telegramId: userAlice });
      await handleFlowStart(botAId, { telegramId: userBob });

      // Alice navigates to "🛠 Services"
      await handleFlowText(botAId, userAlice, "🛠 Services");

      const aliceDb = await prisma.telegramUser.findUnique({
        where: { botId_telegramId: { botId: botAId, telegramId: BigInt(userAlice) } },
      });
      const bobDb = await prisma.telegramUser.findUnique({
        where: { botId_telegramId: { botId: botAId, telegramId: BigInt(userBob) } },
      });

      // Alice is in "sub-services", Bob is still at "root"
      expect(aliceDb?.currentMenuId).toBe("sub-services");
      expect(bobDb?.currentMenuId).toBe("root");

      // Alice can tap "⚙️ Advanced Settings" (which only exists in sub-services)
      const aliceSub = await handleFlowText(botAId, userAlice, "⚙️ Advanced Settings");
      expect(aliceSub.handled).toBe(true);

      // Bob cannot tap "⚙️ Advanced Settings" because he is at "root"
      const bobSub = await handleFlowText(botAId, userBob, "⚙️ Advanced Settings");
      expect(bobSub.handled).toBe(false);
    });
  });

  // =========================================================================
  // 5. RESILIENCE, RESTART & RECOVERY
  // =========================================================================
  describe("5. Deleted Menu Recovery and Crash Resumption", () => {
    it("gracefully recovers user to root menu if their active menu was deleted", async () => {
      const userVictim = 88888888;
      // Put user directly into a hypothetical deleted menu
      await prisma.telegramUser.upsert({
        where: { botId_telegramId: { botId: botAId, telegramId: BigInt(userVictim) } },
        create: {
          botId: botAId,
          telegramId: BigInt(userVictim),
          currentMenuId: "sub-deleted-999",
          navigationStack: ["root", "sub-deleted-999"],
        },
        update: {
          currentMenuId: "sub-deleted-999",
          navigationStack: ["root", "sub-deleted-999"],
        },
      });

      // User sends any message
      const res = await handleFlowText(botAId, userVictim, "Hello bot");

      // Engine detects missing menu, resets user to root, and returns friendly notice
      expect(res.handled).toBe(true);
      expect(res.actionType).toBe("RECOVERED_TO_ROOT");
      expect(res.replyText).toContain("menu has been updated. Returning to the main menu.");
      expect(res.isRoot).toBe(true);

      const dbUser = await prisma.telegramUser.findUnique({
        where: { botId_telegramId: { botId: botAId, telegramId: BigInt(userVictim) } },
      });
      expect(dbUser?.currentMenuId).toBe("root");
      expect(dbUser?.navigationStack).toEqual([]);
    });

    it("resumes user state after process restart without losing navigation location", async () => {
      const userTraveller = 99990001;
      await handleFlowStart(botAId, { telegramId: userTraveller });
      await handleFlowText(botAId, userTraveller, "🛠 Services");

      // Simulate a process reboot by invoking a new handler call directly
      // State is read from PostgreSQL and user can continue immediately
      const res = await handleFlowText(botAId, userTraveller, "❓ Services FAQ");
      expect(res.handled).toBe(true);
      expect(res.actionType).toBe("SEND_TEXT");
      expect(res.replyText).toBe("Our services FAQ answers all questions.");
    });

    it("detects stale keyboard button taps from older versions and refreshes current options", async () => {
      const userStale = 99990002;
      // Setup user in "sub-services", but with an older flowVersion (e.g. version 0)
      await prisma.telegramUser.upsert({
        where: { botId_telegramId: { botId: botAId, telegramId: BigInt(userStale) } },
        create: {
          botId: botAId,
          telegramId: BigInt(userStale),
          currentMenuId: "sub-services",
          navigationStack: ["root"],
          flowVersion: 0,
        },
        update: {
          currentMenuId: "sub-services",
          navigationStack: ["root"],
          flowVersion: 0,
        },
      });

      // User sends an old button label that is no longer in "sub-services"
      const res = await handleFlowText(botAId, userStale, "Old Removed Button");

      expect(res.handled).toBe(true);
      expect(res.actionType).toBe("RECOVERED_TO_ROOT");
      expect(res.replyText).toContain("Menu options have been updated. Here are your current options:");
      expect(res.buttons?.map((b) => b.label)).toContain("⚙️ Advanced Settings");

      const dbUser = await prisma.telegramUser.findUnique({
        where: { botId_telegramId: { botId: botAId, telegramId: BigInt(userStale) } },
      });
      // flowVersion is updated to latest
      expect(dbUser?.flowVersion).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // 6. STAFF AUTHORIZATION, BOT ASSIGNMENT & CSRF API GUARDS
  // =========================================================================
  describe("6. Staff Authorization, Bot Assignment & CSRF API Guards", () => {
    const viewerUserId = "99999999-flow-viewer-1111-111111111111";
    let superAdminToken: string;
    let viewerToken: string;

    beforeAll(async () => {
      await prisma.adminUser.upsert({
        where: { id: viewerUserId },
        create: {
          id: viewerUserId,
          email: "flow_viewer@test.local",
          passwordHash: "$2b$10$abcdefghijklmnopqrstuvwxyz123456",
          role: "VIEWER",
          isActive: true,
        },
        update: {},
      });

      // Assign viewer to botAId so they have read access
      await prisma.staffBotAssignment.upsert({
        where: { userId_botId: { userId: viewerUserId, botId: botAId } },
        create: { userId: viewerUserId, botId: botAId },
        update: {},
      });

      superAdminToken = await createSessionToken({
        id: staffSuperAdminId,
        email: "flow_admin@test.local",
        role: "SUPER_ADMIN",
        tokenVersion: 1,
        mustChangePassword: false,
      });

      viewerToken = await createSessionToken({
        id: viewerUserId,
        email: "flow_viewer@test.local",
        role: "VIEWER",
        tokenVersion: 1,
        mustChangePassword: false,
      });
    });

    afterAll(async () => {
      await prisma.staffBotAssignment.deleteMany({
        where: { userId: viewerUserId },
      });
      await prisma.adminUser.deleteMany({
        where: { id: viewerUserId },
      });
    });

    it("GET /api/bots/[id]/flow rejects unauthenticated requests with 401", async () => {
      const req = new NextRequest(`http://127.0.0.1:3000/api/bots/${botAId}/flow`, {
        method: "GET",
      });
      const res = await getFlowRoute(req, { params: { id: botAId } });
      expect(res.status).toBe(401);
    });

    it("GET /api/bots/[id]/flow allows authorized staff and returns flow data", async () => {
      const req = new NextRequest(`http://127.0.0.1:3000/api/bots/${botAId}/flow`, {
        method: "GET",
        headers: { Cookie: `backstage_session=${superAdminToken}` },
      });
      const res = await getFlowRoute(req, { params: { id: botAId } });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.botId).toBe(botAId);
    });

    it("PUT /api/bots/[id]/flow/draft rejects cross-origin requests with 403 (CSRF Protection)", async () => {
      const req = new NextRequest(`http://127.0.0.1:3000/api/bots/${botAId}/flow/draft`, {
        method: "PUT",
        headers: {
          Cookie: `backstage_session=${superAdminToken}`,
          Origin: "http://attacker-site.com",
          Host: "127.0.0.1:3000",
        },
        body: JSON.stringify({ structure: {} }),
      });
      const res = await saveDraftRoute(req, { params: { id: botAId } });
      expect(res.status).toBe(403);
    });

    it("PUT /api/bots/[id]/flow/draft rejects VIEWER role with 403 Forbidden", async () => {
      const req = new NextRequest(`http://127.0.0.1:3000/api/bots/${botAId}/flow/draft`, {
        method: "PUT",
        headers: {
          Cookie: `backstage_session=${viewerToken}`,
          Origin: "http://127.0.0.1:3000",
          Host: "127.0.0.1:3000",
        },
        body: JSON.stringify({ structure: {} }),
      });
      const res = await saveDraftRoute(req, { params: { id: botAId } });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("Forbidden");
    });

    it("POST /api/bots/[id]/flow/publish rejects VIEWER role with 403 Forbidden", async () => {
      const req = new NextRequest(`http://127.0.0.1:3000/api/bots/${botAId}/flow/publish`, {
        method: "POST",
        headers: {
          Cookie: `backstage_session=${viewerToken}`,
          Origin: "http://127.0.0.1:3000",
          Host: "127.0.0.1:3000",
        },
      });
      const res = await publishFlowRoute(req, { params: { id: botAId } });
      expect(res.status).toBe(403);
    });

    it("POST /api/bots/[id]/flow/rollback rejects VIEWER role with 403 Forbidden", async () => {
      const req = new NextRequest(`http://127.0.0.1:3000/api/bots/${botAId}/flow/rollback`, {
        method: "POST",
        headers: {
          Cookie: `backstage_session=${viewerToken}`,
          Origin: "http://127.0.0.1:3000",
          Host: "127.0.0.1:3000",
        },
        body: JSON.stringify({ targetVersion: 1 }),
      });
      const res = await rollbackFlowRoute(req, { params: { id: botAId } });
      expect(res.status).toBe(403);
    });
  });

  describe("7. Draft vs Published Flow Immutability & Welcome Message Isolation", () => {
    it("updateBotWelcomeMessage modifies draft flow structure without altering published flow", async () => {
      // 1. Establish published flow with version and known promptText
      const initialFlow = {
        version: 1,
        rootMenu: {
          id: "root",
          title: "Original Title",
          promptText: "Original Published Welcome Message",
          buttons: [
            {
              id: "b-1",
              label: "Option 1",
              actionType: "SEND_TEXT",
              replyText: "Hello",
              isEnabled: true,
              order: 0,
            },
          ],
        },
        submenus: {},
      };

      await saveDraftFlow(botAId, initialFlow as any, staffSuperAdminId);
      await publishFlow(botAId, staffSuperAdminId);

      // 2. Create a subsequent draft
      const draftStructure = {
        ...initialFlow,
        rootMenu: {
          ...initialFlow.rootMenu,
          promptText: "Draft Prompt Before Welcome Update",
        },
      };
      await saveDraftFlow(botAId, draftStructure as any, staffSuperAdminId);

      // 3. Update the bot's welcome message
      const { updateBotWelcomeMessage } = await import("@/lib/bot-service");
      await updateBotWelcomeMessage({
        botId: botAId,
        welcomeMessage: "Updated Brand New Greeting",
        adminUserId: staffSuperAdminId,
      });

      // 4. Verify PUBLISHED flow remained immutable
      const activePublished = await prisma.botFlow.findFirst({
        where: { botId: botAId, status: "PUBLISHED" },
      });
      const publishedStruct = activePublished?.structure as any;
      expect(publishedStruct.rootMenu?.promptText).toBe("Original Published Welcome Message");
      expect(publishedStruct.rootMenu?.promptText).not.toBe("Updated Brand New Greeting");

      // 5. Verify DRAFT flow received the updated welcome greeting
      const activeDraft = await prisma.botFlow.findFirst({
        where: { botId: botAId, status: "DRAFT" },
      });
      const draftStruct = activeDraft?.structure as any;
      expect(draftStruct.rootMenu?.promptText).toBe("Updated Brand New Greeting");

      // 6. Verify Telegram bot runtime executes the PUBLISHED flow
      const startResult = await handleFlowStart(botAId, {
        telegramId: 98765432,
        firstName: "RunnerTest",
      });
      expect(startResult.welcomeMessage).toBe("Original Published Welcome Message");
    });
  });
});
