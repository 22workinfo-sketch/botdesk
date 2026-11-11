import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { getUserAssignedBotIds } from "@/lib/permissions";
import { getAudienceList } from "@/lib/marketing-service";

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
    const observedStatus = (searchParams.get("observedStatus") as any) || "all";
    const dateRange = (searchParams.get("dateRange") as any) || "all";
    const consentStatus = (searchParams.get("consentStatus") as any) || "all";
    const campaignSource = searchParams.get("campaignSource") || "all";
    const search = searchParams.get("search") || "";
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "20", 10);

    const result = await getAudienceList({
      botIds: allowedBotIds,
      channelId,
      observedStatus,
      dateRange,
      consentStatus,
      campaignSource,
      search,
      page,
      limit,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("[Marketing API Audience Error]", error);
    return NextResponse.json(
      { error: "Failed to load audience list" },
      { status: 500 }
    );
  }
}
