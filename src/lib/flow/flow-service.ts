import { prisma } from "../prisma";
import {
  FlowStructure,
  BotFlowData,
  FlowVersionSummary,
  FlowButton,
  AnyFlowStructure,
  FlowGraph,
} from "./types";
import { validateFlowStructure } from "./validation";
import { isFlowGraphV2, convertV1ToV2Graph, createDefaultV2FlowGraph } from "./converter";

/**
 * Creates a default starter flow structure, converting existing BotButton records if present.
 */
export async function createDefaultFlowStructure(botId: string): Promise<FlowGraph> {
  const [botConfig, existingButtons] = await Promise.all([
    prisma.botConfig.findUnique({ where: { botId } }),
    prisma.botButton.findMany({
      where: { botId },
      orderBy: { order: "asc" },
    }),
  ]);

  const welcomeMessage =
    botConfig?.welcomeMessage || "Welcome! Please choose an option from the menu.";

  if (existingButtons.length === 0) {
    return createDefaultV2FlowGraph(welcomeMessage);
  }

  // Convert existing BotButtons to V1 and then to V2
  const rootButtons: FlowButton[] = existingButtons.map((btn) => ({
    id: btn.id,
    label: btn.label,
    actionType:
      btn.actionType === "REQUEST_CONTACT"
        ? "REQUEST_CONTACT"
        : btn.actionType === "JOIN_CHANNELS"
        ? "JOIN_CHANNELS"
        : "SEND_TEXT",
    replyText: btn.replyText,
    autoDeleteReply: btn.autoDeleteReply,
    deleteAfterSeconds: btn.deleteAfterSeconds,
    isEnabled: btn.isEnabled,
    order: btn.order,
  }));

  const v1Structure: FlowStructure = {
    rootMenu: {
      id: "root",
      title: "Main Menu",
      promptText: welcomeMessage,
      buttons: rootButtons,
    },
    submenus: {},
  };

  return convertV1ToV2Graph(v1Structure);
}

/**
 * Retrieves the complete flow data for a bot: Draft, Published, and Version History.
 * If no draft exists, auto-initializes a draft from existing buttons or published flow.
 */
export async function getBotFlowData(botId: string): Promise<BotFlowData> {
  // 1. Fetch draft, published, and all versions
  const [draftRecord, publishedRecord, allVersions] = await Promise.all([
    prisma.botFlow.findFirst({
      where: { botId, status: "DRAFT" },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.botFlow.findFirst({
      where: { botId, status: "PUBLISHED" },
      orderBy: { version: "desc" },
    }),
    prisma.botFlow.findMany({
      where: { botId },
      orderBy: { version: "desc" },
      include: {
        publishedBy: {
          select: { email: true },
        },
      },
    }),
  ]);

  let draft = draftRecord;

  // If no draft exists, initialize one from published flow or default buttons
  if (!draft) {
    let initialStructure: AnyFlowStructure;
    if (publishedRecord) {
      initialStructure = publishedRecord.structure as unknown as AnyFlowStructure;
    } else {
      initialStructure = await createDefaultFlowStructure(botId);
    }

    draft = await prisma.botFlow.create({
      data: {
        botId,
        version: 0,
        status: "DRAFT",
        structure: initialStructure as any,
      },
    });
  }

  // Calculate version summaries
  const versions: FlowVersionSummary[] = allVersions.map((v) => {
    const struct = v.structure as any;
    let buttonCount = 0;
    let submenuCount = 0;
    let nodeCount = 0;

    if (isFlowGraphV2(struct)) {
      nodeCount = struct.nodes?.length || 0;
      for (const node of struct.nodes || []) {
        buttonCount += node.data?.buttons?.length || 0;
      }
      submenuCount = (struct.nodes || []).filter(
        (n: any) => n.data?.nodeType === "BUTTON_MENU"
      ).length;
    } else if (struct && struct.rootMenu) {
      const rootCount = struct.rootMenu?.buttons?.length || 0;
      submenuCount = Object.keys(struct.submenus || {}).length;
      buttonCount = rootCount;
      for (const sub of Object.values(struct.submenus || {})) {
        buttonCount += (sub as any)?.buttons?.length || 0;
      }
      nodeCount = 1 + submenuCount;
    }

    return {
      id: v.id,
      version: v.version,
      status: v.status as "DRAFT" | "PUBLISHED" | "ARCHIVED",
      publishedAt: v.publishedAt ? v.publishedAt.toISOString() : null,
      publishedByEmail: v.publishedBy?.email || null,
      buttonCount,
      submenuCount,
      nodeCount,
    };
  });

  const hasUnpublishedChanges =
    Boolean(draft) &&
    Boolean(publishedRecord) &&
    JSON.stringify(draft!.structure) !== JSON.stringify(publishedRecord!.structure);

  return {
    botId,
    draft: draft
      ? {
          id: draft.id,
          version: draft.version,
          status: draft.status,
          structure: draft.structure as unknown as AnyFlowStructure,
          updatedAt: draft.updatedAt.toISOString(),
        }
      : null,
    published: publishedRecord
      ? {
          id: publishedRecord.id,
          version: publishedRecord.version,
          status: publishedRecord.status,
          structure: publishedRecord.structure as unknown as AnyFlowStructure,
          publishedAt: publishedRecord.publishedAt
            ? publishedRecord.publishedAt.toISOString()
            : null,
          publishedById: publishedRecord.publishedById,
        }
      : null,
    versions,
    hasUnpublishedChanges: !publishedRecord || hasUnpublishedChanges,
  };
}

/**
 * Saves changes to the Draft flow. Does NOT affect the published runtime flow.
 */
export async function saveDraftFlow(
  botId: string,
  structure: AnyFlowStructure,
  adminUserId?: string
) {
  const existingDraft = await prisma.botFlow.findFirst({
    where: { botId, status: "DRAFT" },
  });

  let saved;
  if (existingDraft) {
    saved = await prisma.botFlow.update({
      where: { id: existingDraft.id },
      data: {
        structure: structure as any,
        updatedAt: new Date(),
      },
    });
  } else {
    saved = await prisma.botFlow.create({
      data: {
        botId,
        version: 0,
        status: "DRAFT",
        structure: structure as any,
      },
    });
  }

  return saved;
}

/**
 * Validates the draft flow, archives the current published flow, and promotes
 * the draft to PUBLISHED status in an atomic transaction.
 */
export async function publishFlow(botId: string, adminUserId?: string) {
  // 1. Fetch draft
  const draft = await prisma.botFlow.findFirst({
    where: { botId, status: "DRAFT" },
  });

  if (!draft) {
    throw new Error("No draft flow found to publish.");
  }

  const structure = draft.structure as unknown as AnyFlowStructure;

  // 2. Validate entire flow structure
  const validation = validateFlowStructure(structure);
  if (!validation.isValid) {
    const errorMsg = `Flow validation failed:\n• ${validation.errors.join("\n• ")}`;
    const err = new Error(errorMsg);
    (err as any).validationErrors = validation.errors;
    throw err;
  }

  // 3. Perform atomic publish transaction
  const result = await prisma.$transaction(async (tx) => {
    // Archive currently published flow
    await tx.botFlow.updateMany({
      where: { botId, status: "PUBLISHED" },
      data: { status: "ARCHIVED" },
    });

    // Find highest published version
    const maxVer = await tx.botFlow.aggregate({
      where: { botId, status: { in: ["PUBLISHED", "ARCHIVED"] } },
      _max: { version: true },
    });
    const nextVersion = (maxVer._max.version || 0) + 1;

    // Promote draft to published
    const published = await tx.botFlow.update({
      where: { id: draft.id },
      data: {
        status: "PUBLISHED",
        version: nextVersion,
        publishedAt: new Date(),
        publishedById: adminUserId || null,
      },
    });

    // Create a new fresh draft cloned from the newly published flow
    await tx.botFlow.create({
      data: {
        botId,
        version: 0,
        status: "DRAFT",
        structure: structure as any,
      },
    });

    // Count nodes/buttons for audit
    let buttonCount = 0;
    let nodeCount = 0;
    if (isFlowGraphV2(structure)) {
      nodeCount = structure.nodes.length;
      for (const node of structure.nodes) {
        buttonCount += node.data?.buttons?.length || 0;
      }
    } else if (structure.rootMenu) {
      buttonCount =
        structure.rootMenu.buttons.length +
        Object.values(structure.submenus || {}).reduce(
          (acc, s) => acc + s.buttons.length,
          0
        );
      nodeCount = 1 + Object.keys(structure.submenus || {}).length;
    }

    // Audit log
    await tx.auditLog.create({
      data: {
        botId,
        adminUserId: adminUserId || null,
        action: "PUBLISH_FLOW",
        details: {
          flowId: published.id,
          version: nextVersion,
          buttonCount,
          nodeCount,
        },
      },
    });

    return published;
  });

  return result;
}

/**
 * Rolls back to a previous published version in a safe, atomic transaction.
 */
export async function rollbackFlow(
  botId: string,
  targetVersion: number,
  adminUserId?: string,
  options: { preserveDraft?: boolean } = { preserveDraft: false }
) {
  // 1. Find target version flow
  const targetFlow = await prisma.botFlow.findUnique({
    where: {
      botId_version: {
        botId,
        version: targetVersion,
      },
    },
  });

  if (!targetFlow) {
    throw new Error(`Flow version ${targetVersion} not found for this bot.`);
  }

  const structure = targetFlow.structure as unknown as AnyFlowStructure;
  const validation = validateFlowStructure(structure);
  if (!validation.isValid) {
    throw new Error(
      `Cannot rollback to version ${targetVersion}: structure is invalid.`
    );
  }

  // 2. Perform atomic rollback transaction
  const result = await prisma.$transaction(async (tx) => {
    // Archive currently published flow
    await tx.botFlow.updateMany({
      where: { botId, status: "PUBLISHED" },
      data: { status: "ARCHIVED" },
    });

    // Find highest version to avoid unique constraint conflict
    const maxVer = await tx.botFlow.aggregate({
      where: { botId, status: { in: ["PUBLISHED", "ARCHIVED"] } },
      _max: { version: true },
    });
    const nextVersion = (maxVer._max.version || 0) + 1;

    // Create a new PUBLISHED record with the restored structure
    const restored = await tx.botFlow.create({
      data: {
        botId,
        version: nextVersion,
        status: "PUBLISHED",
        name: `Rollback to v${targetVersion}`,
        structure: structure as any,
        publishedAt: new Date(),
        publishedById: adminUserId || null,
      },
    });

    // If preserveDraft is false, update active DRAFT to match restored version.
    // If preserveDraft is true, keep existing working draft untouched!
    if (!options.preserveDraft) {
      const currentDraft = await tx.botFlow.findFirst({
        where: { botId, status: "DRAFT" },
      });
      if (currentDraft) {
        await tx.botFlow.update({
          where: { id: currentDraft.id },
          data: {
            structure: structure as any,
          },
        });
      }
    }

    // Audit log
    await tx.auditLog.create({
      data: {
        botId,
        adminUserId: adminUserId || null,
        action: "ROLLBACK_FLOW",
        details: {
          restoredFromVersion: targetVersion,
          newPublishedVersion: nextVersion,
        },
      },
    });

    return restored;
  });

  return result;
}

/**
 * Fetches the currently active PUBLISHED flow for runtime Telegram execution.
 */
export async function getActivePublishedFlow(botId: string) {
  return prisma.botFlow.findFirst({
    where: { botId, status: "PUBLISHED" },
    orderBy: { version: "desc" },
  });
}
