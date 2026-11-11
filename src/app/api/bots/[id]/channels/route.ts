import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { hasBotAccess, canUserMutate } from "@/lib/permissions";
import { getBotChannels, saveBotChannels } from "@/lib/channel-service";
import { verifyRequestOrigin } from "@/lib/rate-limit";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  try {
    const session = await getAdminSession(req);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await Promise.resolve(params);

    const allowed = await hasBotAccess(session, id);
    if (!allowed) {
      return NextResponse.json(
        { error: "Forbidden: You do not have access to this bot's channels." },
        { status: 403 }
      );
    }

    const channels = await getBotChannels(id);

    return NextResponse.json({
      success: true,
      channels,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch channels";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  try {
    const originCheck = verifyRequestOrigin(req);
    if (!originCheck.isValid) {
      return NextResponse.json(
        { error: originCheck.error || "Forbidden" },
        { status: 403 }
      );
    }

    const session = await getAdminSession(req);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await Promise.resolve(params);

    const allowed = await canUserMutate(session, id);
    if (!allowed) {
      return NextResponse.json(
        { error: "Forbidden: You do not have permission to edit channels for this bot." },
        { status: 403 }
      );
    }

    const body = await req.json();

    if (!body || !Array.isArray(body.channels)) {
      return NextResponse.json(
        { error: "Invalid payload: 'channels' array is required." },
        { status: 400 }
      );
    }

    const saved = await saveBotChannels(id, body.channels, session.id);

    return NextResponse.json({
      success: true,
      channels: saved,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save channels";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
