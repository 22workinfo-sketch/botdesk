import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { canUserMutate } from "@/lib/permissions";
import { updateBotWelcomeMessage } from "@/lib/bot-service";
import { verifyRequestOrigin } from "@/lib/rate-limit";

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
        { error: "Forbidden: Insufficient privileges to configure this bot." },
        { status: 403 }
      );
    }

    const body = await req.json();
    const { welcomeMessage } = body;

    if (!welcomeMessage || typeof welcomeMessage !== "string" || !welcomeMessage.trim()) {
      return NextResponse.json(
        { error: "Welcome message is required and cannot be empty" },
        { status: 400 }
      );
    }

    const updatedConfig = await updateBotWelcomeMessage({
      botId: id,
      welcomeMessage,
      adminUserId: session.id,
    });

    return NextResponse.json({
      success: true,
      config: updatedConfig,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update configuration";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
