import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { checkBotChannelPermissions } from "@/lib/post-service";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string; channelId: string } | Promise<{ id: string; channelId: string }> }
) {
  try {
    const session = await getAdminSession(req);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: botId, channelId } = await Promise.resolve(params);
    const result = await checkBotChannelPermissions(botId, channelId);

    return NextResponse.json({ success: true, permission: result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to verify channel permissions";
    return NextResponse.json(
      {
        success: false,
        permission: {
          status: "UNKNOWN",
          message,
          canPost: false,
        },
      },
      { status: 500 }
    );
  }
}
