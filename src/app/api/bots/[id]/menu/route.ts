import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { hasBotAccess, canUserMutate } from "@/lib/permissions";
import { getBotButtons, saveBotButtons } from "@/lib/bot-service";
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
        { error: "Forbidden: You do not have access to this bot's menu." },
        { status: 403 }
      );
    }

    const buttons = await getBotButtons(id);

    return NextResponse.json({
      success: true,
      buttons,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch bot menu";
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
        { error: "Forbidden: You do not have permission to edit this bot's menu." },
        { status: 403 }
      );
    }

    const body = await req.json();

    if (!body || !Array.isArray(body.buttons)) {
      return NextResponse.json(
        { error: "Invalid payload: 'buttons' array is required." },
        { status: 400 }
      );
    }

    // Save menu buttons
    const saved = await saveBotButtons(id, body.buttons, session.id);

    return NextResponse.json({
      success: true,
      buttons: saved,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save bot menu";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
