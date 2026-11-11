import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { getUserAssignedBotIds } from "@/lib/permissions";
import {
  getChannelActivityEvents,
  cleanupOldActivityEvents,
} from "@/lib/activity-service";

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
    const eventType = searchParams.get("eventType") || "all";
    const search = searchParams.get("search") || "";
    const dateRange = (searchParams.get("dateRange") as any) || "all";
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "20", 10);

    const result = await getChannelActivityEvents({
      botIds: allowedBotIds,
      channelId,
      eventType,
      search,
      dateRange,
      page,
      limit,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("[Activity API Error]", error);
    return NextResponse.json(
      { error: "Failed to load channel activity events" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getAdminSession();
    if (!session || session.role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const days = parseInt(searchParams.get("days") || "90", 10);
    const deletedCount = await cleanupOldActivityEvents(days);

    return NextResponse.json({
      success: true,
      message: `Cleaned up ${deletedCount} activity events older than ${days} days.`,
      deletedCount,
    });
  } catch (error: any) {
    console.error("[Activity API Cleanup Error]", error);
    return NextResponse.json(
      { error: "Failed to clean up activity events" },
      { status: 500 }
    );
  }
}
