import { prisma } from "../prisma";
import {
  AnyFlowStructure,
  FlowGraph,
  FlowTemplateSummary,
  FlowCopyPreview,
} from "./types";
import { isFlowGraphV2, ensureFlowGraph } from "./converter";
import { saveDraftFlow, getBotFlowData } from "./flow-service";
import { validateFlowStructure } from "./validation";

/**
 * List all available flow templates, optionally filtered by category.
 */
export async function listFlowTemplates(category?: string): Promise<FlowTemplateSummary[]> {
  const where = category && category !== "ALL" ? { category } : {};
  const templates = await prisma.botFlowTemplate.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      createdBy: {
        select: { email: true },
      },
    },
  });

  return templates.map((t) => {
    const struct = t.structure as any;
    let nodeCount = 0;
    if (isFlowGraphV2(struct)) {
      nodeCount = struct.nodes.length;
    } else if (struct?.rootMenu) {
      nodeCount = 1 + Object.keys(struct.submenus || {}).length;
    }

    return {
      id: t.id,
      name: t.name,
      description: t.description,
      category: t.category,
      createdAt: t.createdAt.toISOString(),
      createdByEmail: t.createdBy?.email || null,
      nodeCount,
    };
  });
}

/**
 * Save an existing flow as a reusable template.
 */
export async function createFlowTemplate(params: {
  name: string;
  description?: string;
  category?: string;
  structure: AnyFlowStructure;
  adminUserId?: string;
}) {
  if (!params.name || !params.name.trim()) {
    throw new Error("Template name is required.");
  }

  const validation = validateFlowStructure(params.structure);
  if (!validation.isValid) {
    throw new Error(`Cannot save invalid flow as template: ${validation.errors.join("; ")}`);
  }

  // Ensure template is saved in standardized V2 graph format
  const v2Graph = ensureFlowGraph(params.structure);

  const template = await prisma.botFlowTemplate.create({
    data: {
      name: params.name.trim(),
      description: params.description?.trim() || null,
      category: params.category || "GENERAL",
      structure: v2Graph as any,
      createdById: params.adminUserId || null,
    },
  });

  return template;
}

/**
 * Applies a template to a bot's working draft.
 * Never modifies the active published flow.
 */
export async function applyTemplateToDraft(
  botId: string,
  templateId: string,
  adminUserId?: string
) {
  const template = await prisma.botFlowTemplate.findUnique({
    where: { id: templateId },
  });

  if (!template) {
    throw new Error("Flow template not found.");
  }

  const structure = template.structure as unknown as AnyFlowStructure;
  const draft = await saveDraftFlow(botId, structure, adminUserId);

  await prisma.auditLog.create({
    data: {
      botId,
      adminUserId: adminUserId || null,
      action: "APPLY_FLOW_TEMPLATE",
      details: {
        templateId,
        templateName: template.name,
      },
    },
  });

  return draft;
}

/**
 * Generates a pre-flight preview of copying a flow from source bot to destination bot.
 * Flags missing or unmapped channels and media requirements.
 */
export async function previewFlowCopy(
  sourceBotId: string,
  destinationBotId: string
): Promise<FlowCopyPreview> {
  if (sourceBotId === destinationBotId) {
    throw new Error("Source and destination bot cannot be the same.");
  }

  const [sourceBot, destBot, sourceFlowData, destChannels, sourceChannels] =
    await Promise.all([
      prisma.bot.findUnique({ where: { id: sourceBotId } }),
      prisma.bot.findUnique({ where: { id: destinationBotId } }),
      getBotFlowData(sourceBotId),
      prisma.botChannel.findMany({ where: { botId: destinationBotId } }),
      prisma.botChannel.findMany({ where: { botId: sourceBotId } }),
    ]);

  if (!sourceBot) throw new Error("Source bot not found.");
  if (!destBot) throw new Error("Destination bot not found.");

  // Use draft if present and has changes, else published flow
  const rawStructure =
    sourceFlowData.draft?.structure || sourceFlowData.published?.structure;

  if (!rawStructure) {
    throw new Error("Source bot has no flow to copy.");
  }

  const graph = ensureFlowGraph(rawStructure);
  const warnings: string[] = [];

  // Channel condition nodes analysis
  const channelConditions: FlowCopyPreview["channelConditions"] = [];
  const destChatIds = new Set(destChannels.map((c) => c.telegramChatId));
  const sourceChannelMap = new Map(sourceChannels.map((c) => [c.id, c]));

  for (const node of graph.nodes) {
    if (node.data?.nodeType === "CONDITION" && node.data.channelId) {
      const srcChan = sourceChannelMap.get(node.data.channelId);
      const isAvailableInTarget = srcChan
        ? destChatIds.has(srcChan.telegramChatId)
        : false;

      channelConditions.push({
        nodeId: node.id,
        nodeTitle: node.data.title || "Channel Condition",
        channelId: node.data.channelId,
        channelName: srcChan?.name,
        availableInTarget: isAvailableInTarget,
      });

      if (!isAvailableInTarget) {
        warnings.push(
          `Channel '${srcChan?.name || node.data.channelId}' used in node '${node.data.title || node.id}' is not linked to destination bot '${destBot.name}'. Please map it to an available channel.`
        );
      }
    }
  }

  // Media nodes analysis
  const mediaNodes: FlowCopyPreview["mediaNodes"] = [];
  for (const node of graph.nodes) {
    if (
      (node.data?.nodeType === "IMAGE" || node.data?.nodeType === "VIDEO") &&
      (node.data.mediaStorageKey || node.data.mediaUrl)
    ) {
      mediaNodes.push({
        nodeId: node.id,
        nodeTitle: node.data.title || node.data.nodeType,
        storageKey: node.data.mediaStorageKey || undefined,
        mediaUrl: node.data.mediaUrl || undefined,
      });
    }
  }

  return {
    sourceBotId,
    sourceBotName: sourceBot.name,
    destinationBotId,
    destinationBotName: destBot.name,
    nodeCount: graph.nodes.length,
    channelConditions,
    mediaNodes,
    warnings,
    canCopy: true,
  };
}

/**
 * Copies a flow from source bot to destination bot's DRAFT.
 * Applies channel mappings if provided.
 * Never directly modifies or publishes to destination bot's live flow.
 */
export async function executeFlowCopy(params: {
  sourceBotId: string;
  destinationBotId: string;
  channelMapping?: Record<string, string>; // { [sourceChannelId]: destChannelId }
  adminUserId?: string;
}) {
  const { sourceBotId, destinationBotId, channelMapping, adminUserId } = params;

  if (sourceBotId === destinationBotId) {
    throw new Error("Source and destination bot cannot be the same.");
  }

  const [sourceFlowData, destChannels] = await Promise.all([
    getBotFlowData(sourceBotId),
    prisma.botChannel.findMany({ where: { botId: destinationBotId } }),
  ]);

  const rawStructure =
    sourceFlowData.draft?.structure || sourceFlowData.published?.structure;

  if (!rawStructure) {
    throw new Error("Source bot has no flow to copy.");
  }

  const graph = JSON.parse(JSON.stringify(ensureFlowGraph(rawStructure))) as FlowGraph;
  const destChannelIds = new Set(destChannels.map((c) => c.id));

  // Remap channel condition nodes
  for (const node of graph.nodes) {
    if (node.data?.nodeType === "CONDITION" && node.data.channelId) {
      const mappedId = channelMapping?.[node.data.channelId];
      if (mappedId) {
        if (!destChannelIds.has(mappedId)) {
          throw new Error(
            `Mapped channel '${mappedId}' does not belong to destination bot.`
          );
        }
        node.data.channelId = mappedId;
      }
    }
  }

  // Save to destination bot's draft
  const savedDraft = await saveDraftFlow(destinationBotId, graph, adminUserId);

  await prisma.auditLog.create({
    data: {
      botId: destinationBotId,
      adminUserId: adminUserId || null,
      action: "COPY_FLOW_FROM_BOT",
      details: {
        sourceBotId,
        nodeCount: graph.nodes.length,
        channelMapping,
      },
    },
  });

  return savedDraft;
}
