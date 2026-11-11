import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/lib/prisma";
import {
  FlowGraph,
  FlowGraphNode,
  FlowGraphEdge,
  FlowStructure,
} from "../src/lib/flow/types";
import {
  isFlowGraphV2,
  convertV1ToV2Graph,
  ensureFlowGraph,
  createDefaultV2FlowGraph,
} from "../src/lib/flow/converter";
import {
  validateFlowGraph,
  validateFlowStructure,
} from "../src/lib/flow/validation";
import {
  saveDraftFlow,
  publishFlow,
  rollbackFlow,
  getBotFlowData,
} from "../src/lib/flow/flow-service";
import {
  handleFlowStart,
  handleFlowText,
  handleFlowContact,
} from "../src/lib/flow/flow-engine";
import {
  createFlowTemplate,
  listFlowTemplates,
  applyTemplateToDraft,
  previewFlowCopy,
  executeFlowCopy,
} from "../src/lib/flow/template-service";
import {
  recordFlowEvent,
  getFlowAnalytics,
} from "../src/lib/flow/analytics-service";

describe("Bot Flow Builder V2: Visual Canvas, Engine, Nodes & Safety Suite", () => {
  const botV2A = "88888888-v2aa-1111-1111-111111111111";
  const botV2B = "88888888-v2bb-2222-2222-222222222222";
  const staffAdmin = "88888888-v2ad-3333-3333-333333333333";
  const testChannelId = "88888888-v2ch-4444-4444-444444444444";

  beforeAll(async () => {
    // Clean prior test artifacts
    const testIds = [botV2A, botV2B];
    await prisma.botFlowEvent.deleteMany({ where: { botId: { in: testIds } } });
    await prisma.botFlow.deleteMany({ where: { botId: { in: testIds } } });
    await prisma.telegramUser.deleteMany({ where: { botId: { in: testIds } } });
    await prisma.botChannel.deleteMany({ where: { botId: { in: testIds } } });
    await prisma.bot.deleteMany({ where: { id: { in: testIds } } });

    // Setup Admin User
    await prisma.adminUser.upsert({
      where: { id: staffAdmin },
      create: {
        id: staffAdmin,
        email: "staff_v2_admin@test.local",
        passwordHash: "dummyhash",
        role: "SUPER_ADMIN",
      },
      update: {},
    });

    // Setup Bot A
    await prisma.bot.create({
      data: {
        id: botV2A,
        name: "Flow V2 Bot A",
        username: "flow_v2_bot_a",
      },
    });

    // Setup Bot B
    await prisma.bot.create({
      data: {
        id: botV2B,
        name: "Flow V2 Bot B",
        username: "flow_v2_bot_b",
      },
    });

    // Channel for Bot A
    await prisma.botChannel.create({
      data: {
        id: testChannelId,
        botId: botV2A,
        name: "Official VIP Channel",
        telegramChatId: "-1001234567890",
        inviteLink: "https://t.me/joinchat/testvip",
        buttonLabel: "Join VIP Channel",
        isRequired: true,
        isEnabled: true,
      },
    });
  });

  afterAll(async () => {
    const testIds = [botV2A, botV2B];
    await prisma.botFlowEvent.deleteMany({ where: { botId: { in: testIds } } });
    await prisma.botFlow.deleteMany({ where: { botId: { in: testIds } } });
    await prisma.telegramUser.deleteMany({ where: { botId: { in: testIds } } });
    await prisma.botChannel.deleteMany({ where: { botId: { in: testIds } } });
    await prisma.bot.deleteMany({ where: { id: { in: testIds } } });
    await prisma.adminUser.deleteMany({ where: { id: staffAdmin } });
  });

  // =========================================================================
  // 1. CONVERSION & GRAPH BUILDER
  // =========================================================================
  describe("1. V1 to V2 Conversion & Graph Utilities", () => {
    it("converts a legacy V1 FlowStructure to a modern FlowGraph V2", () => {
      const v1: FlowStructure = {
        rootMenu: {
          id: "root",
          title: "Main Menu",
          promptText: "Welcome to our shop!",
          buttons: [
            {
              id: "btn-sub",
              label: "📦 Products",
              actionType: "OPEN_SUBMENU",
              targetMenuId: "sub-products",
              isEnabled: true,
              order: 0,
            },
            {
              id: "btn-url",
              label: "🌐 Website",
              actionType: "URL",
              url: "https://example.com",
              isEnabled: true,
              order: 1,
            },
          ],
        },
        submenus: {
          "sub-products": {
            id: "sub-products",
            title: "Products Catalog",
            promptText: "Browse catalog:",
            buttons: [
              {
                id: "btn-item-1",
                label: "Digital Item",
                actionType: "SEND_TEXT",
                replyText: "Item details",
                isEnabled: true,
                order: 0,
              },
            ],
          },
        },
      };

      const graph = convertV1ToV2Graph(v1);
      expect(isFlowGraphV2(graph)).toBe(true);
      expect(graph.version).toBe(2);

      // Verify Start node
      const startNode = graph.nodes.find((n) => n.data.nodeType === "START");
      expect(startNode).toBeDefined();

      // Verify Root Menu node
      const rootNode = graph.nodes.find((n) => n.id === "menu-root");
      expect(rootNode).toBeDefined();
      expect(rootNode?.data.title).toBe("Main Menu");

      // Verify Submenu node
      const subNode = graph.nodes.find((n) => n.id === "menu-sub-products");
      expect(subNode).toBeDefined();
      expect(subNode?.data.title).toBe("Products Catalog");

      // Verify Edge from Root to Submenu
      const edge = graph.edges.find((e) => e.source === "menu-root" && e.target === "menu-sub-products");
      expect(edge).toBeDefined();
      expect(edge?.sourceHandle).toBe("btn-sub");
    });

    it("ensures default V2 graph when no structure exists", () => {
      const defaultGraph = createDefaultV2FlowGraph("Welcome to Backstage!");
      expect(isFlowGraphV2(defaultGraph)).toBe(true);
      expect(defaultGraph.nodes.length).toBe(2); // START and Main Menu
      expect(defaultGraph.edges.length).toBe(1);
    });
  });

  // =========================================================================
  // 2. FLOW V2 VALIDATION & LOOP PREVENTION
  // =========================================================================
  describe("2. Flow V2 Validation & Graph Integrity", () => {
    it("rejects graphs without a START node", () => {
      const invalidGraph: FlowGraph = {
        version: 2,
        nodes: [
          {
            id: "node-text",
            position: { x: 0, y: 0 },
            data: { nodeType: "TEXT", text: "Hello world" },
          },
        ],
        edges: [],
      };

      const res = validateFlowGraph(invalidGraph);
      expect(res.isValid).toBe(false);
      expect(res.errors.some((e) => e.includes("exactly one Start node"))).toBe(true);
    });

    it("rejects graphs with multiple START nodes", () => {
      const invalidGraph: FlowGraph = {
        version: 2,
        nodes: [
          { id: "s1", position: { x: 0, y: 0 }, data: { nodeType: "START" } },
          { id: "s2", position: { x: 100, y: 0 }, data: { nodeType: "START" } },
        ],
        edges: [],
      };

      const res = validateFlowGraph(invalidGraph);
      expect(res.isValid).toBe(false);
      expect(res.errors.some((e) => e.includes("Only one Start node is allowed"))).toBe(true);
    });

    it("detects and rejects infinite loops in automatic node transitions", () => {
      // Loop: START -> TEXT1 (no buttons) -> TEXT2 (no buttons) -> TEXT1
      const cyclicGraph: FlowGraph = {
        version: 2,
        nodes: [
          { id: "start", position: { x: 0, y: 0 }, data: { nodeType: "START" } },
          { id: "t1", position: { x: 0, y: 100 }, data: { nodeType: "TEXT", text: "Step 1" } },
          { id: "t2", position: { x: 0, y: 200 }, data: { nodeType: "TEXT", text: "Step 2" } },
        ],
        edges: [
          { id: "e1", source: "start", target: "t1" },
          { id: "e2", source: "t1", target: "t2" },
          { id: "e3", source: "t2", target: "t1" }, // cycle!
        ],
      };

      const res = validateFlowGraph(cyclicGraph);
      expect(res.isValid).toBe(false);
      expect(res.errors.some((e) => e.includes("Infinite loop detected"))).toBe(true);
    });

    it("validates user input node variable name syntax", () => {
      const graphWithBadVar: FlowGraph = {
        version: 2,
        nodes: [
          { id: "start", position: { x: 0, y: 0 }, data: { nodeType: "START" } },
          {
            id: "input-node",
            position: { x: 0, y: 100 },
            data: {
              nodeType: "USER_INPUT",
              inputPrompt: "Enter name:",
              variableName: "invalid-variable-name!", // dashes/punctuation invalid
            },
          },
        ],
        edges: [{ id: "e1", source: "start", target: "input-node" }],
      };

      const res = validateFlowGraph(graphWithBadVar);
      expect(res.isValid).toBe(false);
      expect(res.errors.some((e) => e.includes("must only contain letters, numbers, and underscores"))).toBe(true);
    });
  });

  // =========================================================================
  // 3. RUNTIME EXECUTION: MEDIA, INPUT & NAVIGATION
  // =========================================================================
  describe("3. Telegram Runtime: Media, User Input & Multi-Step Execution", () => {
    let publishedV2Graph: FlowGraph;

    beforeAll(async () => {
      publishedV2Graph = {
        version: 2,
        nodes: [
          {
            id: "node-start",
            position: { x: 200, y: 50 },
            data: { nodeType: "START", title: "Start" },
          },
          {
            id: "node-banner",
            position: { x: 200, y: 150 },
            data: {
              nodeType: "IMAGE",
              title: "Welcome Banner",
              mediaUrl: "https://example.com/banner.jpg",
              caption: "🎉 Welcome to our official test bot!",
            },
          },
          {
            id: "node-main-menu",
            position: { x: 200, y: 300 },
            data: {
              nodeType: "BUTTON_MENU",
              title: "Main Menu",
              text: "Choose what you want to do:",
              buttons: [
                {
                  id: "btn-register",
                  label: "📝 Register",
                  actionType: "TRANSITION",
                  isEnabled: true,
                  order: 0,
                },
                {
                  id: "btn-phone",
                  label: "📱 Share Phone",
                  actionType: "TRANSITION",
                  isEnabled: true,
                  order: 1,
                },
                {
                  id: "btn-vip",
                  label: "👑 VIP Channel",
                  actionType: "TRANSITION",
                  isEnabled: true,
                  order: 2,
                },
              ],
            },
          },
          {
            id: "node-ask-name",
            position: { x: 100, y: 450 },
            data: {
              nodeType: "USER_INPUT",
              title: "Ask Name",
              inputPrompt: "Please reply with your full name:",
              variableName: "fullName",
              minLength: 3,
              maxLength: 50,
            },
          },
          {
            id: "node-greet-user",
            position: { x: 100, y: 600 },
            data: {
              nodeType: "TEXT",
              title: "Greet User",
              text: "Thank you! Your registration has been received.",
              buttons: [
                {
                  id: "btn-home",
                  label: "🏠 Main Menu",
                  actionType: "MAIN_MENU",
                  isEnabled: true,
                  order: 0,
                },
              ],
            },
          },
          {
            id: "node-phone",
            position: { x: 300, y: 450 },
            data: {
              nodeType: "REQUEST_PHONE",
              title: "Collect Phone",
              promptText: "Please tap the button below to share your phone number with staff:",
              buttonLabel: "📱 Share My Phone",
            },
          },
          {
            id: "node-phone-success",
            position: { x: 300, y: 600 },
            data: {
              nodeType: "TEXT",
              title: "Phone Received",
              text: "✅ Phone number recorded successfully!",
              buttons: [
                {
                  id: "btn-home-2",
                  label: "🏠 Main Menu",
                  actionType: "MAIN_MENU",
                  isEnabled: true,
                  order: 0,
                },
              ],
            },
          },
          {
            id: "node-check-vip",
            position: { x: 500, y: 450 },
            data: {
              nodeType: "CONDITION",
              title: "VIP Channel Membership",
              conditionType: "CHANNEL_MEMBERSHIP",
              channelId: testChannelId,
            },
          },
          {
            id: "node-vip-access",
            position: { x: 450, y: 600 },
            data: {
              nodeType: "TEXT",
              title: "VIP Lounge",
              text: "✨ Welcome to the VIP Lounge! Here is your exclusive access.",
              buttons: [
                {
                  id: "btn-home-3",
                  label: "🏠 Main Menu",
                  actionType: "MAIN_MENU",
                  isEnabled: true,
                  order: 0,
                },
              ],
            },
          },
          {
            id: "node-vip-locked",
            position: { x: 600, y: 600 },
            data: {
              nodeType: "TEXT",
              title: "Locked",
              text: "❌ You have not joined our VIP channel yet. Please join to unlock this section.",
              buttons: [
                {
                  id: "btn-home-4",
                  label: "🏠 Main Menu",
                  actionType: "MAIN_MENU",
                  isEnabled: true,
                  order: 0,
                },
              ],
            },
          },
        ],
        edges: [
          { id: "e-start-banner", source: "node-start", target: "node-banner" },
          { id: "e-banner-menu", source: "node-banner", target: "node-main-menu" },
          { id: "e-reg", source: "node-main-menu", target: "node-ask-name", sourceHandle: "btn-register" },
          { id: "e-greet", source: "node-ask-name", target: "node-greet-user" },
          { id: "e-phone", source: "node-main-menu", target: "node-phone", sourceHandle: "btn-phone" },
          { id: "e-phone-done", source: "node-phone", target: "node-phone-success" },
          { id: "e-vip", source: "node-main-menu", target: "node-check-vip", sourceHandle: "btn-vip" },
          { id: "e-vip-joined", source: "node-check-vip", target: "node-vip-access", sourceHandle: "joined" },
          { id: "e-vip-not-joined", source: "node-check-vip", target: "node-vip-locked", sourceHandle: "not_joined" },
        ],
      };

      await saveDraftFlow(botV2A, publishedV2Graph, staffAdmin);
      await publishFlow(botV2A, staffAdmin);
    });

    it("executes /start by emitting Image step followed automatically by Main Menu step", async () => {
      const userA = 70001001;
      const res = await handleFlowStart(botV2A, { telegramId: userA });

      expect(res.hasFlow).toBe(true);
      expect(res.steps).toBeDefined();
      expect(res.steps!.length).toBe(2);

      // Step 1: Banner Image
      expect(res.steps![0].nodeType).toBe("IMAGE");
      expect(res.steps![0].mediaUrl).toBe("https://example.com/banner.jpg");
      expect(res.steps![0].caption).toContain("Welcome to our official test bot");

      // Step 2: Main Menu with buttons
      expect(res.steps![1].nodeType).toBe("BUTTON_MENU");
      expect(res.steps![1].buttons?.map((b) => b.label)).toContain("📝 Register");
      expect(res.steps![1].buttons?.map((b) => b.label)).toContain("📱 Share Phone");

      // Verify user DB state
      const userDb = await prisma.telegramUser.findUnique({
        where: { botId_telegramId: { botId: botV2A, telegramId: BigInt(userA) } },
      });
      expect(userDb?.currentNodeId).toBe("node-main-menu");
    });

    it("handles USER_INPUT step: validates length, saves variable, and advances to next node", async () => {
      const userB = 70001002;
      await handleFlowStart(botV2A, { telegramId: userB });

      // User taps "📝 Register"
      const regStep = await handleFlowText(botV2A, userB, "📝 Register");
      expect(regStep.handled).toBe(true);
      expect(regStep.steps![0].nodeType).toBe("USER_INPUT");
      expect(regStep.steps![0].text).toContain("Please reply with your full name");

      // Verify user state is now waiting for input
      let userDb = await prisma.telegramUser.findUnique({
        where: { botId_telegramId: { botId: botV2A, telegramId: BigInt(userB) } },
      });
      const ctxData = (userDb?.flowStepContext || {}) as any;
      expect(ctxData.waitingForInput).toBe(true);
      expect(ctxData.variableName).toBe("fullName");

      // User sends text that is too short (min length is 3)
      const invalidRes = await handleFlowText(botV2A, userB, "Al");
      expect(invalidRes.actionType).toBe("INPUT_INVALID");
      expect(invalidRes.replyText).toContain("too short");

      // User sends valid name
      const validRes = await handleFlowText(botV2A, userB, "Alice Johnson");
      expect(validRes.actionType).toBe("INPUT_ACCEPTED");
      expect(validRes.steps![0].text).toContain("registration has been received");

      // Check stored variables in PostgreSQL
      userDb = await prisma.telegramUser.findUnique({
        where: { botId_telegramId: { botId: botV2A, telegramId: BigInt(userB) } },
      });
      const vars = (userDb?.flowVariables || {}) as any;
      expect(vars.fullName).toBe("Alice Johnson");
      expect(userDb?.flowStepContext).toBeNull();
    });

    it("handles USER_INPUT cancellation via /cancel command", async () => {
      const userC = 70001003;
      await handleFlowStart(botV2A, { telegramId: userC });
      await handleFlowText(botV2A, userC, "📝 Register");

      const cancelRes = await handleFlowText(botV2A, userC, "/cancel");
      expect(cancelRes.actionType).toBe("INPUT_CANCELLED");
      expect(cancelRes.replyText).toContain("cancelled");

      const userDb = await prisma.telegramUser.findUnique({
        where: { botId_telegramId: { botId: botV2A, telegramId: BigInt(userC) } },
      });
      expect(userDb?.flowStepContext).toBeNull();
    });

    it("handles REQUEST_PHONE: accepts verified contact and rejects spoofed contact", async () => {
      const userD = 70001004;
      await handleFlowStart(botV2A, { telegramId: userD });
      await handleFlowText(botV2A, userD, "📱 Share Phone");

      // Spoofed contact (contact.user_id !== telegramId)
      const spoofRes = await handleFlowContact(botV2A, userD, {
        user_id: 99999999, // Mismatched user_id
        phone_number: "+1234567890",
      });
      expect(spoofRes.handled).toBe(false);

      // Legitimate contact
      const legitRes = await handleFlowContact(botV2A, userD, {
        user_id: userD,
        phone_number: "+1987654321",
      });
      expect(legitRes.handled).toBe(true);
      expect(legitRes.steps![0].text).toContain("Phone number recorded successfully");

      const userDb = await prisma.telegramUser.findUnique({
        where: { botId_telegramId: { botId: botV2A, telegramId: BigInt(userD) } },
      });
      expect(userDb?.telegramPhNo).toBe("+1987654321");
    });
  });

  // =========================================================================
  // 4. CHANNEL MEMBERSHIP CONDITION BRANCHING
  // =========================================================================
  describe("4. Channel Membership Condition Branching", () => {
    it("branches to 'joined' when Telegram returns member status", async () => {
      const userVipMember = 70002001;
      await handleFlowStart(botV2A, { telegramId: userVipMember });

      // Mock getChatMember returning 'member'
      const mockGetChatMember = async () => ({ status: "member" });

      const res = await handleFlowText(
        botV2A,
        userVipMember,
        "👑 VIP Channel",
        { getChatMemberFn: mockGetChatMember }
      );

      expect(res.handled).toBe(true);
      expect(res.steps![0].nodeId).toBe("node-vip-access");
      expect(res.steps![0].text).toContain("Welcome to the VIP Lounge");
    });

    it("branches to 'not_joined' when Telegram returns left status", async () => {
      const userNonMember = 70002002;
      await handleFlowStart(botV2A, { telegramId: userNonMember });

      // Mock getChatMember returning 'left'
      const mockGetChatMember = async () => ({ status: "left" });

      const res = await handleFlowText(
        botV2A,
        userNonMember,
        "👑 VIP Channel",
        { getChatMemberFn: mockGetChatMember }
      );

      expect(res.handled).toBe(true);
      expect(res.steps![0].nodeId).toBe("node-vip-locked");
      expect(res.steps![0].text).toContain("You have not joined our VIP channel yet");
    });

    it("never treats API errors as joined (handles verification_error safely)", async () => {
      const userErrorCase = 70002003;
      await handleFlowStart(botV2A, { telegramId: userErrorCase });

      // Mock getChatMember throwing network / permission error
      const mockGetChatMember = async () => {
        throw new Error("CHAT_ADMIN_REQUIRED: Bot is not an administrator in the channel");
      };

      const res = await handleFlowText(
        botV2A,
        userErrorCase,
        "👑 VIP Channel",
        { getChatMemberFn: mockGetChatMember }
      );

      expect(res.handled).toBe(true);
      // Because no explicit verification_error edge was wired, fallback error notice is displayed
      expect(res.steps![0].text).toContain("unable to verify channel membership");
      expect(res.steps![0].nodeId).not.toBe("node-vip-access"); // NEVER granted access
    });
  });

  // =========================================================================
  // 5. TEMPLATES & COPYING BETWEEN BOTS
  // =========================================================================
  describe("5. Flow Templates & Bot-to-Bot Copying", () => {
    it("creates a template and instantiates a new draft from it", async () => {
      const flowData = await getBotFlowData(botV2A);
      const structure = flowData.published!.structure;

      const template = await createFlowTemplate({
        name: "Standard Onboarding Flow",
        description: "Template with banner, registration input, and phone sharing",
        category: "ONBOARDING",
        structure,
        adminUserId: staffAdmin,
      });

      expect(template.id).toBeDefined();
      expect(template.name).toBe("Standard Onboarding Flow");

      const templates = await listFlowTemplates("ONBOARDING");
      expect(templates.some((t) => t.id === template.id)).toBe(true);

      // Apply to Bot B
      const appliedDraft = await applyTemplateToDraft(botV2B, template.id, staffAdmin);
      expect(appliedDraft.botId).toBe(botV2B);

      const botBFlow = await getBotFlowData(botV2B);
      expect(botBFlow.draft).toBeDefined();
      expect((botBFlow.draft?.structure as any).nodes.length).toBeGreaterThan(0);
    });

    it("previews copying from Bot A to Bot B and flags missing channels", async () => {
      const preview = await previewFlowCopy(botV2A, botV2B);
      expect(preview.canCopy).toBe(true);
      expect(preview.sourceBotId).toBe(botV2A);
      expect(preview.destinationBotId).toBe(botV2B);

      // Destination Bot B does not have the VIP channel yet, so preview warns
      expect(preview.warnings.length).toBeGreaterThan(0);
      expect(preview.channelConditions.some((c) => c.availableInTarget === false)).toBe(true);
    });

    it("copies flow to Bot B's draft without modifying Bot B's published state", async () => {
      // Create destination channel for Bot B
      const destChan = await prisma.botChannel.create({
        data: {
          botId: botV2B,
          name: "Bot B VIP Channel",
          telegramChatId: "-100999888777",
          inviteLink: "https://t.me/joinchat/botbvip",
          buttonLabel: "Join Bot B VIP",
          isRequired: true,
          isEnabled: true,
        },
      });

      const copied = await executeFlowCopy({
        sourceBotId: botV2A,
        destinationBotId: botV2B,
        channelMapping: {
          [testChannelId]: destChan.id,
        },
        adminUserId: staffAdmin,
      });

      expect(copied.botId).toBe(botV2B);
      expect(copied.status).toBe("DRAFT");

      // Verify that channel ID was properly remapped
      const destGraph = copied.structure as any;
      const condNode = destGraph.nodes.find((n: any) => n.data?.nodeType === "CONDITION");
      expect(condNode.data.channelId).toBe(destChan.id);

      // Published flow for Bot B remains completely untouched
      const botBPublished = await prisma.botFlow.findFirst({
        where: { botId: botV2B, status: "PUBLISHED" },
      });
      expect(botBPublished).toBeNull();
    });
  });

  // =========================================================================
  // 6. FLOW ANALYTICS & DEDUPLICATION
  // =========================================================================
  describe("6. Flow Analytics, Deduplication & Privacy", () => {
    it("deduplicates analytics events for the same Telegram updateId", async () => {
      const updateId = 998877;
      const userAnalytics = 70003001;

      // First delivery of update
      const tracked1 = await recordFlowEvent({
        botId: botV2A,
        flowVersion: 1,
        telegramId: userAnalytics,
        nodeId: "node-banner",
        eventType: "NODE_VISIT",
        updateId,
      });
      expect(tracked1).toBe(true);

      // Duplicate delivery from Telegram retry
      const tracked2 = await recordFlowEvent({
        botId: botV2A,
        flowVersion: 1,
        telegramId: userAnalytics,
        nodeId: "node-banner",
        eventType: "NODE_VISIT",
        updateId,
      });
      expect(tracked2).toBe(false); // Skipped duplicate!
    });

    it("aggregates analytics totals, visits, drop-offs and preserves privacy", async () => {
      const analytics = await getFlowAnalytics(botV2A, 1, "all");
      expect(analytics.botId).toBe(botV2A);
      expect(analytics.flowVersion).toBe(1);
      expect(analytics.uniqueUsers).toBeGreaterThan(0);
      expect(analytics.nodeVisits.length).toBeGreaterThan(0);

      // Ensure no raw user input or passwords leaked into recent events
      for (const ev of analytics.recentEvents) {
        if (ev.actionLabel) {
          expect(ev.actionLabel).not.toContain("password");
          expect(ev.actionLabel).not.toContain("secret");
        }
      }
    });
  });
});
