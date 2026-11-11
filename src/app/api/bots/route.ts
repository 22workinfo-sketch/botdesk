import { NextRequest, NextResponse } from "next/server";
import { getAdminSession, enforcePasswordChangeStatus } from "@/lib/auth";
import { isSuperAdmin, getUserAssignedBotIds } from "@/lib/permissions";
import { getAllBots, createBot, formatSafeBot } from "@/lib/bot-service";
import { verifyRequestOrigin } from "@/lib/rate-limit";
import { redactTokens } from "@/lib/token-encryption";

/**
 * GET /api/bots
 * List all bots accessible to the authenticated staff member.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getAdminSession(req);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const pwdCheck = enforcePasswordChangeStatus(session);
    if (pwdCheck) {
      return pwdCheck;
    }

    const assignedIds = await getUserAssignedBotIds(session);
    const allBots = await getAllBots();

    // Filter to accessible bots
    const accessibleBots = allBots.filter((b) => assignedIds.includes(b.id));

    return NextResponse.json({
      success: true,
      bots: accessibleBots.map((b) => formatSafeBot(b)),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to fetch bots";
    return NextResponse.json({ error: redactTokens(msg) }, { status: 500 });
  }
}

/**
 * POST /api/bots
 * Add a new bot using its BotFather token.
 * Restricted strictly to SUPER_ADMIN.
 */
export async function POST(req: NextRequest) {
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

    const pwdCheck = enforcePasswordChangeStatus(session);
    if (pwdCheck) {
      return pwdCheck;
    }

    if (!isSuperAdmin(session)) {
      return NextResponse.json(
        { error: "Forbidden: Only SUPER_ADMIN can add new Telegram bots." },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const { name, token, description } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json(
        { error: "Bot display name is required." },
        { status: 400 }
      );
    }

    if (!token || typeof token !== "string" || !token.trim()) {
      return NextResponse.json(
        { error: "Bot token is required." },
        { status: 400 }
      );
    }

    const newBot = await createBot({
      name,
      token,
      description,
      adminUserId: session.id,
    });

    return NextResponse.json(
      {
        success: true,
        bot: newBot,
      },
      { status: 201 }
    );
  } catch (err: any) {
    const rawMsg = err instanceof Error ? err.message : "Failed to add bot";
    const status = rawMsg.includes("Duplicate") || rawMsg.includes("already registered")
      ? 409
      : rawMsg.includes("Invalid token") || rawMsg.includes("verification failed")
      ? 400
      : 500;

    return NextResponse.json(
      { error: redactTokens(rawMsg) },
      { status }
    );
  }
}
