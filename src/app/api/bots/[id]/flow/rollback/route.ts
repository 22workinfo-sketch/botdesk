import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { canUserMutate } from "@/lib/permissions";
import { rollbackFlow } from "@/lib/flow/flow-service";
import { verifyRequestOrigin } from "@/lib/rate-limit";

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

    const { id } = await Promise.resolve(params);

    const allowed = await canUserMutate(session, id);
    if (!allowed) {
      return NextResponse.json(
        { error: "Forbidden: You do not have permission to rollback this bot's flow." },
        { status: 403 }
      );
    }

    const body = await req.json();
    if (!body || typeof body.targetVersion !== "number") {
      return NextResponse.json(
        { error: "Invalid payload: 'targetVersion' (number) is required." },
        { status: 400 }
      );
    }

    const preserveDraft = Boolean(body.preserveDraft);
    const restored = await rollbackFlow(id, body.targetVersion, session.id, {
      preserveDraft,
    });

    return NextResponse.json({
      success: true,
      restored,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to rollback flow";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
