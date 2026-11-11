import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { canUserMutate } from "@/lib/permissions";
import { applyTemplateToDraft } from "@/lib/flow/template-service";
import { verifyRequestOrigin } from "@/lib/rate-limit";

export async function POST(
  req: NextRequest,
  {
    params,
  }: {
    params:
      | { id: string; templateId: string }
      | Promise<{ id: string; templateId: string }>;
  }
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

    const { id, templateId } = await Promise.resolve(params);

    const allowed = await canUserMutate(session, id);
    if (!allowed) {
      return NextResponse.json(
        { error: "Forbidden: You do not have permission to modify this bot's draft." },
        { status: 403 }
      );
    }

    const draft = await applyTemplateToDraft(id, templateId, session.id);

    return NextResponse.json({
      success: true,
      draft,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to apply template";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
