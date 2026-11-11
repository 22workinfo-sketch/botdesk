import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { canUserMutate } from "@/lib/permissions";
import { saveDraftFlow } from "@/lib/flow/flow-service";
import { verifyRequestOrigin } from "@/lib/rate-limit";
import { FlowStructure } from "@/lib/flow/types";

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
        { error: "Forbidden: You do not have permission to edit this bot's flow." },
        { status: 403 }
      );
    }

    const body = await req.json();
    if (!body || !body.structure) {
      return NextResponse.json(
        { error: "Invalid payload: 'structure' is required." },
        { status: 400 }
      );
    }

    const saved = await saveDraftFlow(id, body.structure as FlowStructure, session.id);

    return NextResponse.json({
      success: true,
      draft: saved,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save draft flow";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
