import { prisma } from "../prisma";
import { FlowAnalyticsSummary, FlowNodeType } from "./types";
import { getActivePublishedFlow } from "./flow-service";
import { isFlowGraphV2 } from "./converter";

export interface RecordEventParams {
  botId: string;
  flowVersion: number;
  telegramId: bigint | number;
  nodeId: string;
  eventType: "START" | "NODE_VISIT" | "BUTTON_CLICK" | "INPUT_SUBMIT" | "COMPLETE" | "DROP_OFF";
  actionLabel?: string | null;
  updateId?: bigint | number | null;
}

/**
 * Records a flow analytics event safely.
 * Includes deduplication against duplicate Telegram update deliveries.
 * Strictly avoids recording raw user text or phone numbers for privacy.
 */
export async function recordFlowEvent(params: RecordEventParams): Promise<boolean> {
  const { botId, flowVersion, telegramId, nodeId, eventType, actionLabel, updateId } = params;
  const tgIdBigInt = BigInt(telegramId);
  const upIdBigInt = updateId != null ? BigInt(updateId) : null;

  // 1. Deduplication check if updateId is present
  if (upIdBigInt != null) {
    const existing = await prisma.botFlowEvent.findFirst({
      where: {
        botId,
        updateId: upIdBigInt,
        eventType,
        nodeId,
      },
      select: { id: true },
    });

    if (existing) {
      return false; // Already tracked for this update
    }
  }

  // 2. Sanitize actionLabel: truncate to 128 chars, never include full text dumps
  const sanitizedLabel = actionLabel ? actionLabel.slice(0, 128) : null;

  await prisma.botFlowEvent.create({
    data: {
      botId,
      flowVersion,
      telegramId: tgIdBigInt,
      nodeId,
      eventType,
      actionLabel: sanitizedLabel,
      updateId: upIdBigInt,
    },
  });

  return true;
}

/**
 * Retrieves aggregated flow analytics for a bot and flow version.
 */
export async function getFlowAnalytics(
  botId: string,
  flowVersion?: number,
  dateRange: "24h" | "7d" | "30d" | "all" = "7d"
): Promise<FlowAnalyticsSummary> {
  // If flowVersion not specified, resolve from active published flow
  let version = flowVersion;
  if (!version) {
    const active = await getActivePublishedFlow(botId);
    version = active?.version || 1;
  }

  // Calculate date filter
  let dateFilter: Date | undefined;
  const now = Date.now();
  if (dateRange === "24h") {
    dateFilter = new Date(now - 24 * 60 * 60 * 1000);
  } else if (dateRange === "7d") {
    dateFilter = new Date(now - 7 * 24 * 60 * 60 * 1000);
  } else if (dateRange === "30d") {
    dateFilter = new Date(now - 30 * 24 * 60 * 60 * 1000);
  }

  const whereClause: any = {
    botId,
    flowVersion: version,
  };
  if (dateFilter) {
    whereClause.createdAt = { gte: dateFilter };
  }

  // Fetch all events for the period
  const [events, publishedFlow] = await Promise.all([
    prisma.botFlowEvent.findMany({
      where: whereClause,
      orderBy: { createdAt: "desc" },
    }),
    prisma.botFlow.findUnique({
      where: {
        botId_version: {
          botId,
          version,
        },
      },
    }),
  ]);

  // Aggregate high-level totals
  const uniqueUsersSet = new Set<string>();
  let totalStarted = 0;
  let completedCount = 0;

  for (const ev of events) {
    uniqueUsersSet.add(ev.telegramId.toString());
    if (ev.eventType === "START") totalStarted++;
    if (ev.eventType === "COMPLETE") completedCount++;
  }

  const completionRate =
    totalStarted > 0 ? Math.round((completedCount / totalStarted) * 100) : 0;

  // Aggregate by node
  const nodeVisitMap = new Map<string, { count: number; users: Set<string> }>();
  const buttonClickMap = new Map<string, Map<string, number>>();
  const inputMap = new Map<string, number>();

  // For drop-off calculation: Track each user's latest event
  const userLatestEvent = new Map<string, { nodeId: string; eventType: string; time: number }>();

  for (const ev of events) {
    const uid = ev.telegramId.toString();
    const evTime = ev.createdAt.getTime();

    if (!userLatestEvent.has(uid) || userLatestEvent.get(uid)!.time < evTime) {
      userLatestEvent.set(uid, {
        nodeId: ev.nodeId,
        eventType: ev.eventType,
        time: evTime,
      });
    }

    if (ev.eventType === "NODE_VISIT" || ev.eventType === "START") {
      if (!nodeVisitMap.has(ev.nodeId)) {
        nodeVisitMap.set(ev.nodeId, { count: 0, users: new Set() });
      }
      const item = nodeVisitMap.get(ev.nodeId)!;
      item.count++;
      item.users.add(uid);
    }

    if (ev.eventType === "BUTTON_CLICK" && ev.actionLabel) {
      if (!buttonClickMap.has(ev.nodeId)) {
        buttonClickMap.set(ev.nodeId, new Map());
      }
      const btnMap = buttonClickMap.get(ev.nodeId)!;
      btnMap.set(ev.actionLabel, (btnMap.get(ev.actionLabel) || 0) + 1);
    }

    if (ev.eventType === "INPUT_SUBMIT" && ev.actionLabel) {
      inputMap.set(ev.actionLabel, (inputMap.get(ev.actionLabel) || 0) + 1);
    }
  }

  // Calculate drop-offs per node:
  // Inactivity window is 24 hours. A user whose latest event was >24h ago at a non-END node is considered dropped off.
  const dropOffMap = new Map<string, number>();
  const inactivityThreshold = now - 24 * 60 * 60 * 1000;

  for (const [, latest] of userLatestEvent.entries()) {
    if (latest.eventType !== "COMPLETE" && latest.time <= inactivityThreshold) {
      dropOffMap.set(latest.nodeId, (dropOffMap.get(latest.nodeId) || 0) + 1);
    }
  }

  // Map known nodes from published flow
  const struct = publishedFlow?.structure as any;
  const nodeVisits: FlowAnalyticsSummary["nodeVisits"] = [];

  if (isFlowGraphV2(struct)) {
    for (const node of struct.nodes) {
      const stats = nodeVisitMap.get(node.id) || { count: 0, users: new Set() };
      const dropOffCount = dropOffMap.get(node.id) || 0;
      const dropOffRate =
        stats.users.size > 0 ? Math.round((dropOffCount / stats.users.size) * 100) : 0;

      nodeVisits.push({
        nodeId: node.id,
        nodeTitle: node.data?.title || node.id,
        nodeType: node.data?.nodeType as FlowNodeType,
        visitCount: stats.count,
        uniqueUsers: stats.users.size,
        dropOffCount,
        dropOffRate,
      });
    }
  } else {
    // Legacy fallback
    for (const [nodeId, stats] of nodeVisitMap.entries()) {
      const dropOffCount = dropOffMap.get(nodeId) || 0;
      nodeVisits.push({
        nodeId,
        nodeTitle: nodeId,
        nodeType: "BUTTON_MENU",
        visitCount: stats.count,
        uniqueUsers: stats.users.size,
        dropOffCount,
        dropOffRate: stats.users.size > 0 ? Math.round((dropOffCount / stats.users.size) * 100) : 0,
      });
    }
  }

  // Button click items
  const buttonClicks: FlowAnalyticsSummary["buttonClicks"] = [];
  for (const [nodeId, map] of buttonClickMap.entries()) {
    for (const [label, count] of map.entries()) {
      buttonClicks.push({
        nodeId,
        actionLabel: label,
        clickCount: count,
      });
    }
  }

  // Input submission items
  const inputSubmissions: FlowAnalyticsSummary["inputSubmissions"] = [];
  for (const [label, count] of inputMap.entries()) {
    inputSubmissions.push({
      nodeId: label,
      variableName: label,
      submissionCount: count,
    });
  }

  const recentEvents = events.slice(0, 25).map((e) => ({
    id: e.id,
    eventType: e.eventType,
    nodeId: e.nodeId,
    actionLabel: e.actionLabel,
    createdAt: e.createdAt.toISOString(),
  }));

  return {
    botId,
    flowVersion: version,
    totalStarted,
    uniqueUsers: uniqueUsersSet.size,
    completedCount,
    completionRate,
    nodeVisits,
    buttonClicks,
    inputSubmissions,
    recentEvents,
  };
}

/**
 * Data retention policy: Delete analytics records older than specified days.
 */
export async function deleteFlowAnalytics(botId: string, olderThanDays: number = 90) {
  const threshold = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  return prisma.botFlowEvent.deleteMany({
    where: {
      botId,
      createdAt: { lt: threshold },
    },
  });
}
