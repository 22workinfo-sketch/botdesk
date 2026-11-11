import { prisma } from "../prisma";
import { Prisma } from "@prisma/client";
import {
  FlowStructure,
  FlowMenu,
  FlowButton,
  FlowGraph,
  FlowGraphNode,
  FlowGraphEdge,
  FlowNodeButton,
  FlowNodeType,
  AnyFlowStructure,
} from "./types";
import { getActivePublishedFlow } from "./flow-service";
import { isFlowGraphV2 } from "./converter";
import { checkSingleChannelMembership } from "../channel-service";
import { recordFlowEvent } from "./analytics-service";

export interface FlowExecutionStep {
  nodeId: string;
  nodeType: FlowNodeType;
  title?: string;
  text?: string;
  mediaUrl?: string | null;
  mediaStorageKey?: string | null;
  mediaType?: "IMAGE" | "VIDEO" | null;
  caption?: string | null;
  buttons?: FlowNodeButton[];
  urlButtons?: Array<{ text: string; url: string }>;
  requestContact?: boolean;
  contactPrompt?: string;
  waitingForInput?: {
    variableName: string;
    isRequired?: boolean;
    minLength?: number;
    maxLength?: number;
  };
  autoDeleteReply?: boolean;
  deleteAfterSeconds?: number;
  isEnd?: boolean;
  isRoot?: boolean;
}

export interface FlowStartResult {
  hasFlow: boolean;
  welcomeMessage?: string;
  menu?: FlowMenu;
  buttons?: FlowButton[];
  isRoot?: boolean;
  steps?: FlowExecutionStep[];
  currentNodeId?: string;
}

export interface FlowTextResult {
  hasFlow: boolean;
  handled: boolean;
  actionType?:
    | "SEND_TEXT"
    | "OPEN_SUBMENU"
    | "URL"
    | "REQUEST_CONTACT"
    | "JOIN_CHANNELS"
    | "NAVIGATE_BACK"
    | "NAVIGATE_MAIN"
    | "RECOVERED_TO_ROOT"
    | "V2_STEP"
    | "INPUT_ACCEPTED"
    | "INPUT_INVALID"
    | "INPUT_CANCELLED";
  replyText?: string;
  url?: string;
  urlLabel?: string;
  menu?: FlowMenu;
  buttons?: FlowButton[];
  button?: FlowButton;
  autoDeleteReply?: boolean;
  deleteAfterSeconds?: number;
  isRoot?: boolean;
  contactLabel?: string;
  steps?: FlowExecutionStep[];
  currentNodeId?: string;
}

export interface FlowEngineOptions {
  getChatMemberFn?: (chatId: string | number, userId: number) => Promise<any>;
  updateId?: bigint | number | null;
}

/**
 * Handles /start command in the context of Bot Flow.
 * Automatically delegates to Flow V2 graph engine or legacy Flow V1.
 */
export async function handleFlowStart(
  botId: string,
  telegramUser: {
    telegramId: number | bigint;
    firstName?: string | null;
    lastName?: string | null;
    username?: string | null;
    languageCode?: string | null;
  },
  options?: FlowEngineOptions
): Promise<FlowStartResult> {
  const publishedFlow = await getActivePublishedFlow(botId);
  if (!publishedFlow) {
    return { hasFlow: false };
  }

  const structure = publishedFlow.structure as unknown as AnyFlowStructure;

  if (isFlowGraphV2(structure)) {
    return handleFlowStartV2(botId, telegramUser, publishedFlow, structure, options);
  }

  return handleFlowStartV1(botId, telegramUser, publishedFlow, structure as FlowStructure);
}

/**
 * Handles incoming text messages in the context of Bot Flow.
 * Automatically delegates to Flow V2 graph engine or legacy Flow V1.
 */
export async function handleFlowText(
  botId: string,
  telegramId: number | bigint,
  text: string,
  options?: FlowEngineOptions
): Promise<FlowTextResult> {
  const publishedFlow = await getActivePublishedFlow(botId);
  if (!publishedFlow) {
    return { hasFlow: false, handled: false };
  }

  const structure = publishedFlow.structure as unknown as AnyFlowStructure;

  if (isFlowGraphV2(structure)) {
    return handleFlowTextV2(botId, telegramId, text, publishedFlow, structure, options);
  }

  return handleFlowTextV1(botId, telegramId, text, publishedFlow, structure as FlowStructure);
}

/**
 * Handles contact sharing event in Flow V2.
 */
export async function handleFlowContact(
  botId: string,
  telegramId: number | bigint,
  contact: { user_id?: number; phone_number: string },
  options?: FlowEngineOptions
): Promise<{ handled: boolean; steps?: FlowExecutionStep[] }> {
  const publishedFlow = await getActivePublishedFlow(botId);
  if (!publishedFlow) {
    return { handled: false };
  }

  const structure = publishedFlow.structure as unknown as AnyFlowStructure;
  if (!isFlowGraphV2(structure)) {
    return { handled: false };
  }

  const tgIdBigInt = BigInt(telegramId);
  if (contact.user_id !== Number(telegramId)) {
    return { handled: false };
  }

  // Update verified phone
  const user = await prisma.telegramUser.update({
    where: { botId_telegramId: { botId, telegramId: tgIdBigInt } },
    data: { telegramPhNo: contact.phone_number, lastSeenAt: new Date() },
  });

  const currentNodeId = user.currentNodeId;
  if (!currentNodeId) return { handled: true };

  const currentNode = structure.nodes.find((n) => n.id === currentNodeId);
  if (currentNode?.data?.nodeType === "REQUEST_PHONE") {
    // Follow outgoing edge from phone node
    const edge = structure.edges.find((e) => e.source === currentNode.id);
    if (edge) {
      const traversal = await traverseGraphNodes({
        botId,
        graph: structure,
        startNodeId: edge.target,
        telegramId: tgIdBigInt,
        flowVersion: publishedFlow.version,
        getChatMemberFn: options?.getChatMemberFn,
        updateId: options?.updateId,
      });

      await prisma.telegramUser.update({
        where: { id: user.id },
        data: {
          currentNodeId: traversal.finalNodeId,
          flowStepContext: traversal.waitingForInput
            ? { waitingForInput: true, ...traversal.waitingForInput }
            : null,
          lastSeenAt: new Date(),
        },
      });

      return { handled: true, steps: traversal.steps };
    }
  }

  return { handled: true };
}

// =========================================================================
// FLOW V2 GRAPH RUNTIME ENGINE
// =========================================================================

async function handleFlowStartV2(
  botId: string,
  telegramUser: {
    telegramId: number | bigint;
    firstName?: string | null;
    lastName?: string | null;
    username?: string | null;
    languageCode?: string | null;
  },
  publishedFlow: any,
  graph: FlowGraph,
  options?: FlowEngineOptions
): Promise<FlowStartResult> {
  const startNode = graph.nodes.find((n) => n.data?.nodeType === "START");
  if (!startNode) {
    return { hasFlow: false };
  }

  const tgIdBigInt = BigInt(telegramUser.telegramId);

  // Record START in analytics
  await recordFlowEvent({
    botId,
    flowVersion: publishedFlow.version,
    telegramId: tgIdBigInt,
    nodeId: startNode.id,
    eventType: "START",
    updateId: options?.updateId,
  });

  // Find first node connected to START
  const initialEdge = graph.edges.find((e) => e.source === startNode.id);
  const initialNodeId = initialEdge ? initialEdge.target : startNode.id;

  const traversal = await traverseGraphNodes({
    botId,
    graph,
    startNodeId: initialNodeId,
    telegramId: tgIdBigInt,
    flowVersion: publishedFlow.version,
    getChatMemberFn: options?.getChatMemberFn,
    updateId: options?.updateId,
  });

  // Upsert user state in database
  await prisma.telegramUser.upsert({
    where: {
      botId_telegramId: {
        botId,
        telegramId: tgIdBigInt,
      },
    },
    create: {
      botId,
      telegramId: tgIdBigInt,
      firstName: telegramUser.firstName || null,
      lastName: telegramUser.lastName || null,
      username: telegramUser.username || null,
      languageCode: telegramUser.languageCode || null,
      currentNodeId: traversal.finalNodeId,
      navigationStack: [],
      flowVersion: publishedFlow.version,
      flowVariables: {},
      flowStepContext: traversal.waitingForInput
        ? { waitingForInput: true, ...traversal.waitingForInput }
        : null,
      lastSeenAt: new Date(),
    },
    update: {
      firstName: telegramUser.firstName || null,
      lastName: telegramUser.lastName || null,
      username: telegramUser.username || null,
      languageCode: telegramUser.languageCode || null,
      currentNodeId: traversal.finalNodeId,
      navigationStack: [],
      flowVersion: publishedFlow.version,
      flowStepContext: traversal.waitingForInput
        ? { waitingForInput: true, ...traversal.waitingForInput }
        : null,
      lastSeenAt: new Date(),
    },
  });

  // Extract primary welcome/prompt message and buttons from steps for backwards compatibility
  const lastStep = traversal.steps[traversal.steps.length - 1];
  const buttons: FlowButton[] = (lastStep?.buttons || []).map((b) => ({
    id: b.id,
    label: b.label,
    actionType:
      b.actionType === "REQUEST_CONTACT"
        ? "REQUEST_CONTACT"
        : b.actionType === "URL"
        ? "URL"
        : "SEND_TEXT",
    replyText: b.replyText,
    url: b.url,
    autoDeleteReply: b.autoDeleteReply,
    deleteAfterSeconds: b.deleteAfterSeconds,
    isEnabled: b.isEnabled,
    order: b.order,
  }));

  return {
    hasFlow: true,
    welcomeMessage: lastStep?.text || "Welcome!",
    buttons,
    isRoot: traversal.finalNodeId === initialNodeId,
    steps: traversal.steps,
    currentNodeId: traversal.finalNodeId,
  };
}

async function handleFlowTextV2(
  botId: string,
  telegramId: number | bigint,
  text: string,
  publishedFlow: any,
  graph: FlowGraph,
  options?: FlowEngineOptions
): Promise<FlowTextResult> {
  const tgIdBigInt = BigInt(telegramId);
  const trimmed = (text || "").trim();

  let user = await prisma.telegramUser.findUnique({
    where: { botId_telegramId: { botId, telegramId: tgIdBigInt } },
  });

  if (!user) {
    // If user not in database, start from start node
    const startRes = await handleFlowStartV2(
      botId,
      { telegramId },
      publishedFlow,
      graph,
      options
    );
    return {
      hasFlow: true,
      handled: true,
      actionType: "RECOVERED_TO_ROOT",
      replyText: startRes.welcomeMessage,
      buttons: startRes.buttons,
      steps: startRes.steps,
      currentNodeId: startRes.currentNodeId,
    };
  }

  const flowContext = (user.flowStepContext || {}) as any;
  const flowVars = (user.flowVariables || {}) as Record<string, string>;
  let stack = (Array.isArray(user.navigationStack) ? user.navigationStack : []) as string[];

  // 1. Check if user is in an active USER_INPUT step
  if (flowContext?.waitingForInput) {
    const inputNodeId = flowContext.nodeId;
    const varName = flowContext.variableName || "response";

    // Handle cancel command or cancel button
    if (
      trimmed === "/cancel" ||
      trimmed === "❌ Cancel" ||
      trimmed === "◀ Back"
    ) {
      await prisma.telegramUser.update({
        where: { id: user.id },
        data: {
          flowStepContext: Prisma.DbNull,
          lastSeenAt: new Date(),
        },
      });

      return {
        hasFlow: true,
        handled: true,
        actionType: "INPUT_CANCELLED",
        replyText: "Input cancelled. Returning to main menu.",
        buttons: [{ id: "btn-main", label: "🏠 Main Menu", actionType: "SEND_TEXT", isEnabled: true, order: 0 }],
      };
    }

    // Input validation
    if (flowContext.minLength != null && trimmed.length < flowContext.minLength) {
      return {
        hasFlow: true,
        handled: true,
        actionType: "INPUT_INVALID",
        replyText: `⚠️ Input is too short. Please provide at least ${flowContext.minLength} characters:`,
      };
    }

    if (flowContext.maxLength != null && trimmed.length > flowContext.maxLength) {
      return {
        hasFlow: true,
        handled: true,
        actionType: "INPUT_INVALID",
        replyText: `⚠️ Input is too long. Maximum allowed is ${flowContext.maxLength} characters:`,
      };
    }

    // Input is valid! Save to user variables
    const updatedVars = { ...flowVars, [varName]: trimmed };

    await recordFlowEvent({
      botId,
      flowVersion: publishedFlow.version,
      telegramId: tgIdBigInt,
      nodeId: inputNodeId,
      eventType: "INPUT_SUBMIT",
      actionLabel: varName,
      updateId: options?.updateId,
    });

    // Find outgoing edge from the USER_INPUT node
    const edge = graph.edges.find((e) => e.source === inputNodeId);
    if (!edge) {
      await prisma.telegramUser.update({
        where: { id: user.id },
        data: {
          flowVariables: updatedVars,
          flowStepContext: Prisma.DbNull,
          lastSeenAt: new Date(),
        },
      });

      return {
        hasFlow: true,
        handled: true,
        actionType: "INPUT_ACCEPTED",
        replyText: "✅ Response saved.",
      };
    }

    // Traverse from next node
    const traversal = await traverseGraphNodes({
      botId,
      graph,
      startNodeId: edge.target,
      telegramId: tgIdBigInt,
      flowVersion: publishedFlow.version,
      getChatMemberFn: options?.getChatMemberFn,
      updateId: options?.updateId,
    });

    await prisma.telegramUser.update({
      where: { id: user.id },
      data: {
        currentNodeId: traversal.finalNodeId,
        flowVariables: updatedVars,
        flowStepContext: traversal.waitingForInput
          ? { waitingForInput: true, ...traversal.waitingForInput }
          : Prisma.DbNull,
        lastSeenAt: new Date(),
      },
    });

    return {
      hasFlow: true,
      handled: true,
      actionType: "INPUT_ACCEPTED",
      replyText: traversal.steps[traversal.steps.length - 1]?.text || "Response accepted.",
      steps: traversal.steps,
      currentNodeId: traversal.finalNodeId,
    };
  }

  // 2. Normal Button Navigation in V2
  let currentNodeId = user.currentNodeId;
  let currentNode = currentNodeId ? graph.nodes.find((n) => n.id === currentNodeId) : null;

  // Graceful recovery if node no longer exists (e.g. edited after publishing)
  if (!currentNode) {
    const startRes = await handleFlowStartV2(
      botId,
      { telegramId },
      publishedFlow,
      graph,
      options
    );
    return {
      hasFlow: true,
      handled: true,
      actionType: "RECOVERED_TO_ROOT",
      replyText:
        "⚠️ The flow menu has been updated. Returning to the start of the flow.",
      buttons: startRes.buttons,
      steps: startRes.steps,
      currentNodeId: startRes.currentNodeId,
    };
  }

  // Handle Global Navigation: Main Menu
  if (trimmed === "🏠 Main Menu") {
    const startRes = await handleFlowStartV2(
      botId,
      { telegramId },
      publishedFlow,
      graph,
      options
    );
    return {
      hasFlow: true,
      handled: true,
      actionType: "NAVIGATE_MAIN",
      replyText: startRes.welcomeMessage,
      buttons: startRes.buttons,
      steps: startRes.steps,
      currentNodeId: startRes.currentNodeId,
    };
  }

  // Handle Global Navigation: Back
  if (trimmed === "◀ Back") {
    const prevNodeId = stack.pop();
    if (!prevNodeId) {
      const startRes = await handleFlowStartV2(
        botId,
        { telegramId },
        publishedFlow,
        graph,
        options
      );
      return {
        hasFlow: true,
        handled: true,
        actionType: "NAVIGATE_MAIN",
        replyText: startRes.welcomeMessage,
        buttons: startRes.buttons,
        steps: startRes.steps,
        currentNodeId: startRes.currentNodeId,
      };
    }

    const traversal = await traverseGraphNodes({
      botId,
      graph,
      startNodeId: prevNodeId,
      telegramId: tgIdBigInt,
      flowVersion: publishedFlow.version,
      getChatMemberFn: options?.getChatMemberFn,
      updateId: options?.updateId,
    });

    await prisma.telegramUser.update({
      where: { id: user.id },
      data: {
        currentNodeId: traversal.finalNodeId,
        navigationStack: stack,
        lastSeenAt: new Date(),
      },
    });

    return {
      hasFlow: true,
      handled: true,
      actionType: "NAVIGATE_BACK",
      replyText: traversal.steps[traversal.steps.length - 1]?.text,
      steps: traversal.steps,
      currentNodeId: traversal.finalNodeId,
    };
  }

  // Match button on current node
  const nodeButtons = (currentNode.data?.buttons || []).filter((b) => b.isEnabled);
  const matchedButton = nodeButtons.find((b) => b.label.trim() === trimmed);

  if (!matchedButton) {
    // Unmatched text: re-prompt current node
    return {
      hasFlow: true,
      handled: false,
      replyText: "Please choose an option from the menu buttons below:",
    };
  }

  // Button matched! Record analytics
  await recordFlowEvent({
    botId,
    flowVersion: publishedFlow.version,
    telegramId: tgIdBigInt,
    nodeId: currentNode.id,
    eventType: "BUTTON_CLICK",
    actionLabel: matchedButton.label,
    updateId: options?.updateId,
  });

  // Action: URL
  if (matchedButton.actionType === "URL") {
    return {
      hasFlow: true,
      handled: true,
      actionType: "URL",
      replyText: matchedButton.replyText || "Please visit the official link below:",
      url: matchedButton.url || "",
      urlLabel: matchedButton.label,
      button: {
        id: matchedButton.id,
        label: matchedButton.label,
        actionType: "URL",
        replyText: matchedButton.replyText,
        url: matchedButton.url,
        isEnabled: true,
        order: matchedButton.order,
      },
    };
  }

  // Action: REQUEST_CONTACT
  if (matchedButton.actionType === "REQUEST_CONTACT") {
    return {
      hasFlow: true,
      handled: true,
      actionType: "REQUEST_CONTACT",
      replyText:
        matchedButton.replyText ||
        "Please tap 'Share Phone Number' below to securely share your contact with support.",
      contactLabel: matchedButton.label,
    };
  }

  // Action: TRANSITION
  // Find outgoing edge matching button ID or fallback to general node edge
  const edge =
    graph.edges.find((e) => e.source === currentNode!.id && e.sourceHandle === matchedButton.id) ||
    graph.edges.find((e) => e.source === currentNode!.id);

  if (!edge) {
    // No target edge configured: send reply text if available
    return {
      hasFlow: true,
      handled: true,
      actionType: "SEND_TEXT",
      replyText: matchedButton.replyText || "Action completed.",
      autoDeleteReply: matchedButton.autoDeleteReply,
      deleteAfterSeconds: matchedButton.deleteAfterSeconds,
    };
  }

  // Push to navigation stack
  const newStack = [...stack, currentNode.id];

  const traversal = await traverseGraphNodes({
    botId,
    graph,
    startNodeId: edge.target,
    telegramId: tgIdBigInt,
    flowVersion: publishedFlow.version,
    getChatMemberFn: options?.getChatMemberFn,
    updateId: options?.updateId,
  });

  await prisma.telegramUser.update({
    where: { id: user.id },
    data: {
      currentNodeId: traversal.finalNodeId,
      navigationStack: newStack,
      flowStepContext: traversal.waitingForInput
        ? { waitingForInput: true, ...traversal.waitingForInput }
        : null,
      lastSeenAt: new Date(),
    },
  });

  const lastStep = traversal.steps[traversal.steps.length - 1];
  const legacyButtons: FlowButton[] = (lastStep?.buttons || []).map((b) => ({
    id: b.id,
    label: b.label,
    actionType:
      b.actionType === "REQUEST_CONTACT"
        ? "REQUEST_CONTACT"
        : b.actionType === "URL"
        ? "URL"
        : "SEND_TEXT",
    replyText: b.replyText,
    url: b.url,
    autoDeleteReply: b.autoDeleteReply,
    deleteAfterSeconds: b.deleteAfterSeconds,
    isEnabled: b.isEnabled,
    order: b.order,
  }));

  return {
    hasFlow: true,
    handled: true,
    actionType: "V2_STEP",
    replyText: lastStep?.text || matchedButton.replyText || "Choose an option:",
    buttons: legacyButtons,
    steps: traversal.steps,
    currentNodeId: traversal.finalNodeId,
    autoDeleteReply: matchedButton.autoDeleteReply,
    deleteAfterSeconds: matchedButton.deleteAfterSeconds,
  };
}

/**
 * Traverses consecutive automatic nodes in a V2 FlowGraph until an interactive
 * pause node is reached (BUTTON_MENU, TEXT with buttons, REQUEST_PHONE, USER_INPUT, or END).
 */
async function traverseGraphNodes(params: {
  botId: string;
  graph: FlowGraph;
  startNodeId: string;
  telegramId: bigint;
  flowVersion: number;
  getChatMemberFn?: (chatId: string | number, userId: number) => Promise<any>;
  updateId?: bigint | number | null;
}): Promise<{
  steps: FlowExecutionStep[];
  finalNodeId: string;
  isEnd: boolean;
  waitingForInput?: any;
}> {
  const { botId, graph, startNodeId, telegramId, flowVersion, getChatMemberFn, updateId } = params;
  const steps: FlowExecutionStep[] = [];
  let currId = startNodeId;
  let loopCount = 0;
  const maxLoops = 15; // Strict bound on automatic transitions to avoid infinite loops

  while (currId && loopCount < maxLoops) {
    loopCount++;
    const node = graph.nodes.find((n) => n.id === currId);
    if (!node) break;

    const data = node.data || ({} as any);
    const type: FlowNodeType = data.nodeType;

    // Track node visit in analytics
    await recordFlowEvent({
      botId,
      flowVersion,
      telegramId,
      nodeId: node.id,
      eventType: "NODE_VISIT",
      updateId,
    });

    switch (type) {
      case "START": {
        const edge = graph.edges.find((e) => e.source === node.id);
        if (edge) {
          currId = edge.target;
          continue;
        }
        return { steps, finalNodeId: node.id, isEnd: false };
      }

      case "IMAGE": {
        const enabledButtons = (data.buttons || []).filter((b: any) => b.isEnabled);
        const step: FlowExecutionStep = {
          nodeId: node.id,
          nodeType: "IMAGE",
          title: data.title,
          mediaUrl: data.mediaUrl,
          mediaStorageKey: data.mediaStorageKey,
          mediaType: "IMAGE",
          caption: data.caption,
          autoDeleteReply: data.autoDeleteReply,
          deleteAfterSeconds: data.deleteAfterSeconds,
        };

        if (enabledButtons.length > 0) {
          step.buttons = enabledButtons;
          steps.push(step);
          return { steps, finalNodeId: node.id, isEnd: false };
        }

        steps.push(step);
        const edge = graph.edges.find((e) => e.source === node.id);
        if (edge) {
          currId = edge.target;
          continue;
        }
        return { steps, finalNodeId: node.id, isEnd: false };
      }

      case "VIDEO": {
        const enabledButtons = (data.buttons || []).filter((b: any) => b.isEnabled);
        const step: FlowExecutionStep = {
          nodeId: node.id,
          nodeType: "VIDEO",
          title: data.title,
          mediaUrl: data.mediaUrl,
          mediaStorageKey: data.mediaStorageKey,
          mediaType: "VIDEO",
          caption: data.caption,
          autoDeleteReply: data.autoDeleteReply,
          deleteAfterSeconds: data.deleteAfterSeconds,
        };

        if (enabledButtons.length > 0) {
          step.buttons = enabledButtons;
          steps.push(step);
          return { steps, finalNodeId: node.id, isEnd: false };
        }

        steps.push(step);
        const edge = graph.edges.find((e) => e.source === node.id);
        if (edge) {
          currId = edge.target;
          continue;
        }
        return { steps, finalNodeId: node.id, isEnd: false };
      }

      case "TEXT": {
        const enabledButtons = (data.buttons || []).filter((b: any) => b.isEnabled);
        const step: FlowExecutionStep = {
          nodeId: node.id,
          nodeType: "TEXT",
          title: data.title,
          text: data.text,
          autoDeleteReply: data.autoDeleteReply,
          deleteAfterSeconds: data.deleteAfterSeconds,
        };

        if (enabledButtons.length > 0) {
          step.buttons = enabledButtons;
          steps.push(step);
          return { steps, finalNodeId: node.id, isEnd: false };
        }

        steps.push(step);
        const edge = graph.edges.find((e) => e.source === node.id);
        if (edge) {
          currId = edge.target;
          continue;
        }
        return { steps, finalNodeId: node.id, isEnd: false };
      }

      case "BUTTON_MENU": {
        const enabledButtons = (data.buttons || []).filter((b: any) => b.isEnabled);
        steps.push({
          nodeId: node.id,
          nodeType: "BUTTON_MENU",
          title: data.title,
          text: data.text || "Please choose an option:",
          buttons: enabledButtons,
          isRoot: node.id === "menu-root" || node.id === "node-main-menu",
        });
        return { steps, finalNodeId: node.id, isEnd: false };
      }

      case "REQUEST_PHONE": {
        steps.push({
          nodeId: node.id,
          nodeType: "REQUEST_PHONE",
          title: data.title,
          text:
            data.promptText ||
            "Please tap 'Share Phone Number' below to securely share your contact with support:",
          requestContact: true,
          buttons: [
            {
              id: "btn-phone-req",
              label: data.buttonLabel || "📱 Share Phone Number",
              actionType: "REQUEST_CONTACT",
              isEnabled: true,
              order: 0,
            },
            {
              id: "btn-phone-cancel",
              label: "❌ Cancel",
              actionType: "MAIN_MENU",
              isEnabled: true,
              order: 1,
            },
          ],
        });
        return { steps, finalNodeId: node.id, isEnd: false };
      }

      case "USER_INPUT": {
        const varName = data.variableName || "input";
        steps.push({
          nodeId: node.id,
          nodeType: "USER_INPUT",
          title: data.title,
          text: data.inputPrompt || "Please reply with your text response (or send /cancel to exit):",
          waitingForInput: {
            variableName: varName,
            isRequired: data.isRequired !== false,
            minLength: data.minLength,
            maxLength: data.maxLength,
          },
        });
        return {
          steps,
          finalNodeId: node.id,
          isEnd: false,
          waitingForInput: {
            nodeId: node.id,
            variableName: varName,
            minLength: data.minLength,
            maxLength: data.maxLength,
            isRequired: data.isRequired !== false,
          },
        };
      }

      case "CONDITION": {
        // Channel membership condition evaluation
        let outcome: "joined" | "not_joined" | "verification_error" = "verification_error";
        if (data.channelId && getChatMemberFn) {
          outcome = await checkSingleChannelMembership(
            data.channelId,
            telegramId,
            getChatMemberFn
          );
        }

        // Record condition branch in analytics
        await recordFlowEvent({
          botId,
          flowVersion,
          telegramId,
          nodeId: node.id,
          eventType: "NODE_VISIT",
          actionLabel: `condition:${outcome}`,
          updateId,
        });

        // Find edge for outcome handle
        const outcomeEdge = graph.edges.find(
          (e) => e.source === node.id && e.sourceHandle === outcome
        );

        if (outcomeEdge) {
          currId = outcomeEdge.target;
          continue;
        }

        // Fallback edge only if an edge without specific outcome handle is wired
        const fallbackEdge = graph.edges.find(
          (e) =>
            e.source === node.id &&
            (!e.sourceHandle ||
              e.sourceHandle === "default" ||
              e.sourceHandle === "next")
        );
        if (fallbackEdge) {
          currId = fallbackEdge.target;
          continue;
        }

        // Built-in recovery steps if no outgoing edge is wired
        if (outcome === "not_joined") {
          const ch = data.channelId
            ? await prisma.botChannel.findUnique({ where: { id: data.channelId } })
            : null;

          steps.push({
            nodeId: node.id,
            nodeType: "CONDITION",
            text: `Please join our required channel "${ch?.name || "Official Channel"}" before continuing.`,
            urlButtons: [
              { text: "📢 Join Channel", url: ch?.inviteLink || "https://t.me" },
            ],
            buttons: [
              {
                id: "btn-check-joined",
                label: "🔄 Check Joined",
                actionType: "TRANSITION",
                isEnabled: true,
                order: 0,
              },
            ],
          });
          return { steps, finalNodeId: node.id, isEnd: false };
        }

        if (outcome === "verification_error") {
          steps.push({
            nodeId: node.id,
            nodeType: "CONDITION",
            text: "⚠️ We are currently unable to verify channel membership with Telegram. Please try again shortly.",
            buttons: [
              {
                id: "btn-retry-check",
                label: "🔄 Try Again",
                actionType: "TRANSITION",
                isEnabled: true,
                order: 0,
              },
              {
                id: "btn-main-menu",
                label: "🏠 Main Menu",
                actionType: "MAIN_MENU",
                isEnabled: true,
                order: 1,
              },
            ],
          });
          return { steps, finalNodeId: node.id, isEnd: false };
        }

        return { steps, finalNodeId: node.id, isEnd: false };
      }

      case "END": {
        await recordFlowEvent({
          botId,
          flowVersion,
          telegramId,
          nodeId: node.id,
          eventType: "COMPLETE",
          updateId,
        });

        steps.push({
          nodeId: node.id,
          nodeType: "END",
          title: data.title,
          text: data.endMessage || "Thank you! The flow is now complete.",
          isEnd: true,
          buttons: [
            {
              id: "btn-restart",
              label: "🏠 Main Menu",
              actionType: "MAIN_MENU",
              isEnabled: true,
              order: 0,
            },
          ],
        });
        return { steps, finalNodeId: node.id, isEnd: true };
      }

      default:
        return { steps, finalNodeId: node.id, isEnd: false };
    }
  }

  return {
    steps,
    finalNodeId: currId || startNodeId,
    isEnd: false,
  };
}

// =========================================================================
// FLOW V1 LEGACY ENGINE (PRESERVED FOR BACKWARDS COMPATIBILITY)
// =========================================================================

async function handleFlowStartV1(
  botId: string,
  telegramUser: {
    telegramId: number | bigint;
    firstName?: string | null;
    lastName?: string | null;
    username?: string | null;
    languageCode?: string | null;
  },
  publishedFlow: any,
  structure: FlowStructure
): Promise<FlowStartResult> {
  const rootMenu = structure.rootMenu;
  if (!rootMenu) {
    return { hasFlow: false };
  }

  const tgIdBigInt = BigInt(telegramUser.telegramId);

  await prisma.telegramUser.upsert({
    where: {
      botId_telegramId: {
        botId,
        telegramId: tgIdBigInt,
      },
    },
    create: {
      botId,
      telegramId: tgIdBigInt,
      firstName: telegramUser.firstName || null,
      lastName: telegramUser.lastName || null,
      username: telegramUser.username || null,
      languageCode: telegramUser.languageCode || null,
      currentMenuId: "root",
      navigationStack: [],
      flowVersion: publishedFlow.version,
      lastSeenAt: new Date(),
    },
    update: {
      firstName: telegramUser.firstName || null,
      lastName: telegramUser.lastName || null,
      username: telegramUser.username || null,
      languageCode: telegramUser.languageCode || null,
      currentMenuId: "root",
      navigationStack: [],
      flowVersion: publishedFlow.version,
      lastSeenAt: new Date(),
    },
  });

  return {
    hasFlow: true,
    welcomeMessage:
      rootMenu.promptText || "Welcome! Please choose an option from the menu.",
    menu: rootMenu,
    buttons: (rootMenu.buttons || []).filter((b) => b.isEnabled),
    isRoot: true,
  };
}

async function handleFlowTextV1(
  botId: string,
  telegramId: number | bigint,
  text: string,
  publishedFlow: any,
  structure: FlowStructure
): Promise<FlowTextResult> {
  const tgIdBigInt = BigInt(telegramId);
  const trimmedText = (text || "").trim();

  let user = await prisma.telegramUser.findUnique({
    where: {
      botId_telegramId: {
        botId,
        telegramId: tgIdBigInt,
      },
    },
  });

  if (!user) {
    user = await prisma.telegramUser.create({
      data: {
        botId,
        telegramId: tgIdBigInt,
        currentMenuId: "root",
        navigationStack: [],
        flowVersion: publishedFlow.version,
      },
    });
  }

  let currentMenuId = user.currentMenuId || "root";
  let stack = (Array.isArray(user.navigationStack)
    ? user.navigationStack
    : []) as string[];

  let currentMenu: FlowMenu | null = null;
  if (currentMenuId === "root") {
    currentMenu = structure.rootMenu;
  } else {
    currentMenu = structure.submenus?.[currentMenuId] || null;
  }

  if (!currentMenu) {
    await prisma.telegramUser.update({
      where: { id: user.id },
      data: {
        currentMenuId: "root",
        navigationStack: [],
        lastSeenAt: new Date(),
      },
    });

    return {
      hasFlow: true,
      handled: true,
      actionType: "RECOVERED_TO_ROOT",
      replyText:
        "⚠️ The menu has been updated. Returning to the main menu.",
      menu: structure.rootMenu,
      buttons: (structure.rootMenu.buttons || []).filter((b) => b.isEnabled),
      isRoot: true,
    };
  }

  const isRoot = currentMenuId === "root";

  if (!isRoot) {
    if (trimmedText === "🏠 Main Menu") {
      await prisma.telegramUser.update({
        where: { id: user.id },
        data: {
          currentMenuId: "root",
          navigationStack: [],
          lastSeenAt: new Date(),
        },
      });

      return {
        hasFlow: true,
        handled: true,
        actionType: "NAVIGATE_MAIN",
        replyText:
          structure.rootMenu.promptText || "Welcome! Please choose an option:",
        menu: structure.rootMenu,
        buttons: (structure.rootMenu.buttons || []).filter((b) => b.isEnabled),
        isRoot: true,
      };
    }

    if (trimmedText === "◀ Back") {
      const parentMenuId = stack.pop() || "root";
      let parentMenu: FlowMenu | null = null;
      if (parentMenuId === "root") {
        parentMenu = structure.rootMenu;
      } else {
        parentMenu = structure.submenus?.[parentMenuId] || structure.rootMenu;
      }

      await prisma.telegramUser.update({
        where: { id: user.id },
        data: {
          currentMenuId: parentMenu.id,
          navigationStack: stack,
          lastSeenAt: new Date(),
        },
      });

      const isParentRoot = parentMenu.id === "root";
      return {
        hasFlow: true,
        handled: true,
        actionType: "NAVIGATE_BACK",
        replyText: parentMenu.promptText || `📂 ${parentMenu.title}`,
        menu: parentMenu,
        buttons: (parentMenu.buttons || []).filter((b) => b.isEnabled),
        isRoot: isParentRoot,
      };
    }
  }

  const enabledButtons = (currentMenu.buttons || []).filter((b) => b.isEnabled);
  let matchedButton = enabledButtons.find((b) => b.label.trim() === trimmedText);

  if (!matchedButton) {
    // If user is navigating on an older flowVersion and taps a stale button, refresh options
    if (user.flowVersion != null && user.flowVersion < publishedFlow.version) {
      await prisma.telegramUser.update({
        where: { id: user.id },
        data: {
          flowVersion: publishedFlow.version,
          lastSeenAt: new Date(),
        },
      });

      return {
        hasFlow: true,
        handled: true,
        actionType: "RECOVERED_TO_ROOT",
        replyText:
          "Menu options have been updated. Here are your current options:",
        menu: currentMenu,
        buttons: (currentMenu.buttons || []).filter((b) => b.isEnabled),
        isRoot: currentMenuId === "root",
      };
    }

    return {
      hasFlow: true,
      handled: false,
    };
  }

  await prisma.telegramUser.update({
    where: { id: user.id },
    data: { lastSeenAt: new Date() },
  });

  switch (matchedButton.actionType) {
    case "OPEN_SUBMENU": {
      const targetSubmenuId = matchedButton.targetMenuId;
      const targetSubmenu = targetSubmenuId
        ? structure.submenus?.[targetSubmenuId]
        : null;

      if (!targetSubmenu) {
        await prisma.telegramUser.update({
          where: { id: user.id },
          data: {
            currentMenuId: "root",
            navigationStack: [],
            lastSeenAt: new Date(),
          },
        });
        return {
          hasFlow: true,
          handled: true,
          actionType: "RECOVERED_TO_ROOT",
          replyText:
            "⚠️ This submenu is currently unavailable. Returning to the main menu.",
          menu: structure.rootMenu,
          buttons: (structure.rootMenu.buttons || []).filter((b) => b.isEnabled),
          isRoot: true,
        };
      }

      const newStack = [...stack, currentMenuId];
      await prisma.telegramUser.update({
        where: { id: user.id },
        data: {
          currentMenuId: targetSubmenu.id,
          navigationStack: newStack,
          lastSeenAt: new Date(),
        },
      });

      return {
        hasFlow: true,
        handled: true,
        actionType: "OPEN_SUBMENU",
        replyText: targetSubmenu.promptText || `📂 ${targetSubmenu.title}`,
        menu: targetSubmenu,
        buttons: (targetSubmenu.buttons || []).filter((b) => b.isEnabled),
        isRoot: false,
      };
    }

    case "SEND_TEXT":
      return {
        hasFlow: true,
        handled: true,
        actionType: "SEND_TEXT",
        replyText: matchedButton.replyText || "",
        autoDeleteReply: matchedButton.autoDeleteReply,
        deleteAfterSeconds: matchedButton.deleteAfterSeconds,
        button: matchedButton,
      };

    case "URL":
      return {
        hasFlow: true,
        handled: true,
        actionType: "URL",
        replyText:
          matchedButton.replyText || "Please visit the official link below:",
        url: matchedButton.url || "",
        urlLabel: matchedButton.urlLabel || matchedButton.label,
        button: matchedButton,
      };

    case "REQUEST_CONTACT":
      return {
        hasFlow: true,
        handled: true,
        actionType: "REQUEST_CONTACT",
        replyText:
          matchedButton.replyText ||
          "Please tap 'Share Phone Number' below to securely share your contact with support.",
        contactLabel: matchedButton.label,
        button: matchedButton,
      };

    case "JOIN_CHANNELS":
      return {
        hasFlow: true,
        handled: true,
        actionType: "JOIN_CHANNELS",
        replyText:
          matchedButton.replyText ||
          "Please join our official channels below, then tap 'Check Joined' to verify your membership.",
        button: matchedButton,
      };

    default:
      return { hasFlow: true, handled: false };
  }
}
