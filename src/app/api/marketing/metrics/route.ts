import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { getUserAssignedBotIds } from "@/lib/permissions";
import { getMarketingOverviewMetrics } from "@/lib/marketing-service";

export async function GET(req: NextRequest) {
  try {
    const session = await getAdminSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const assignedIds = await getUserAssignedBotIds(session);

    const requestedBotId = searchParams.get("botId");
    let allowedBotIds = assignedIds;

    if (requestedBotId && requestedBotId !== "all") {
      if (session.role !== "SUPER_ADMIN" && !assignedIds.includes(requestedBotId)) {
        return NextResponse.json(
          { error: "Forbidden: You are not assigned to this bot." },
          { status: 403 }
        );
      }
      allowedBotIds = [requestedBotId];
    }

    const channelId = searchParams.get("channelId") || "all";
    const dateRange = (searchParams.get("dateRange") as any) || "all";

    const metrics = await getMarketingOverviewMetrics({
      botIds: allowedBotIds,
      channelId,
      dateRange,
    });

    return NextResponse.json(metrics);
  } catch (error: any) {
    console.error("[Marketing API Metrics Error]", error);
    return NextResponse.json(
      { error: "Failed to load marketing metrics" },
      { status: 500 }
    );
  }
}
