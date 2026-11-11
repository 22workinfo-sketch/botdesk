import { NextRequest, NextResponse } from "next/server";
import { getAdminSession, enforcePasswordChangeStatus } from "@/lib/auth";
import { hasBotAccess } from "@/lib/permissions";
import { testBotConnection } from "@/lib/bot-service";
import { verifyRequestOrigin } from "@/lib/rate-limit";
import { redactTokens } from "@/lib/token-encryption";

/**
 * POST /api/bots/[id]/test-connection
 * Tests getMe connection for the bot using its stored or environment token.
 */
export async function POST(
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

    const allowed = await hasBotAccess(session, id);
    if (!allowed) {
      return NextResponse.json(
        { error: "Forbidden: You do not have access to test this bot." },
        { status: 403 }
      );
    }

    const result = await testBotConnection(id);

    return NextResponse.json({
      success: true,
      result,
    });
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : "Failed to test connection";
    return NextResponse.json({ error: redactTokens(msg) }, { status: 500 });
  }
}
