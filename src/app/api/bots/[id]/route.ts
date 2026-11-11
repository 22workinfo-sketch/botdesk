import { NextRequest, NextResponse } from "next/server";
import { getAdminSession, enforcePasswordChangeStatus } from "@/lib/auth";
import { hasBotAccess, isSuperAdmin } from "@/lib/permissions";
import { getBotWithConfig, updateBot, deleteBot, formatSafeBot } from "@/lib/bot-service";
import { verifyRequestOrigin } from "@/lib/rate-limit";
import { redactTokens } from "@/lib/token-encryption";

/**
 * GET /api/bots/[id]
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  try {
    const session = await getAdminSession(req);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const pwdCheck = enforcePasswordChangeStatus(session);
    if (pwdCheck) {
      return pwdCheck;
    }

    const { id } = await Promise.resolve(params);

    const allowed = await hasBotAccess(session, id);
    if (!allowed) {
      return NextResponse.json(
        { error: "Forbidden: You do not have access to this bot." },
        { status: 403 }
      );
    }

    const bot = await getBotWithConfig(id);
    if (!bot) {
      return NextResponse.json({ error: "Bot not found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      bot: formatSafeBot(bot),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to fetch bot";
    return NextResponse.json({ error: redactTokens(msg) }, { status: 500 });
  }
}

/**
 * PATCH /api/bots/[id]
 * Updates bot display settings, active toggle, or replaces bot token.
 */
export async function PATCH(
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

    const pwdCheck = enforcePasswordChangeStatus(session);
    if (pwdCheck) {
      return pwdCheck;
    }

    const { id } = await Promise.resolve(params);

    // Permission check: token replacement requires SUPER_ADMIN; settings edit requires SUPER_ADMIN or assigned ADMIN
    const body = await req.json().catch(() => ({}));
    const isSuper = isSuperAdmin(session);
    const hasAccess = await hasBotAccess(session, id);

    if (!hasAccess) {
      return NextResponse.json(
        { error: "Forbidden: You do not have access to manage this bot." },
        { status: 403 }
      );
    }

    if (body.token && !isSuper) {
      return NextResponse.json(
        { error: "Forbidden: Only SUPER_ADMIN can replace a bot's Telegram token." },
        { status: 403 }
      );
    }

    if (session.role === "VIEWER" || session.role === "EDITOR") {
      return NextResponse.json(
        { error: "Forbidden: Insufficient privileges to update bot configuration." },
        { status: 403 }
      );
    }

    const updated = await updateBot(id, {
      name: body.name,
      description: body.description,
      isActive: body.isActive,
      token: body.token,
      adminUserId: session.id,
    });

    return NextResponse.json({
      success: true,
      bot: updated,
    });
  } catch (err: any) {
    const rawMsg = err instanceof Error ? err.message : "Failed to update bot";
    const status = rawMsg.includes("Duplicate") || rawMsg.includes("Conflict")
      ? 409
      : rawMsg.includes("Invalid token") || rawMsg.includes("mismatch")
      ? 400
      : 500;

    return NextResponse.json(
      { error: redactTokens(rawMsg) },
      { status }
    );
  }
}

/**
 * DELETE /api/bots/[id]
 * Deletes a bot. Strictly restricted to SUPER_ADMIN.
 */
export async function DELETE(
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

    const pwdCheck = enforcePasswordChangeStatus(session);
    if (pwdCheck) {
      return pwdCheck;
    }

    if (!isSuperAdmin(session)) {
      return NextResponse.json(
        { error: "Forbidden: Only SUPER_ADMIN can delete bots." },
        { status: 403 }
      );
    }

    const { id } = await Promise.resolve(params);

    await deleteBot(id, session.id);

    return NextResponse.json({
      success: true,
      message: "Bot deleted successfully.",
    });
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : "Failed to delete bot";
    return NextResponse.json({ error: redactTokens(msg) }, { status: 400 });
  }
}
