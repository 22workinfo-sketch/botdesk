import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { getUserAssignedBotIds } from "@/lib/permissions";
import {
  createMarketingCampaign,
  getMarketingCampaigns,
} from "@/lib/marketing-service";

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

    const campaigns = await getMarketingCampaigns(allowedBotIds);
    return NextResponse.json({ campaigns });
  } catch (error: any) {
    console.error("[Marketing API Campaigns GET Error]", error);
    return NextResponse.json(
      { error: "Failed to load marketing campaigns" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getAdminSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { botId, name, slug, description, targetChannelId } = body;

    if (!botId || !name || !slug) {
      return NextResponse.json(
        { error: "Bot ID, campaign name, and slug are required." },
        { status: 400 }
      );
    }

    const assignedIds = await getUserAssignedBotIds(session);
    if (session.role !== "SUPER_ADMIN" && !assignedIds.includes(botId)) {
      return NextResponse.json(
        { error: "Forbidden: You are not assigned to this bot." },
        { status: 403 }
      );
    }

    const campaign = await createMarketingCampaign({
      botId,
      name,
      slug,
      description,
      targetChannelId,
      createdById: session.id,
    });

    return NextResponse.json({ campaign }, { status: 201 });
  } catch (error: any) {
    console.error("[Marketing API Campaigns POST Error]", error);
    return NextResponse.json(
      { error: error.message || "Failed to create marketing campaign" },
      { status: 400 }
    );
  }
}
