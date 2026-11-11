import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { hasBotAccess, canUserMutate } from "@/lib/permissions";
import { listFlowTemplates, createFlowTemplate } from "@/lib/flow/template-service";
import { getBotFlowData } from "@/lib/flow/flow-service";
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
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const url = new URL(req.url);
    const category = url.searchParams.get("category") || undefined;
    const templates = await listFlowTemplates(category);

    return NextResponse.json({
      success: true,
      templates,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to list templates";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

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
        { error: "Forbidden: You do not have permission to create templates." },
        { status: 403 }
      );
    }

    const body = await req.json();
    const { name, description, category, structure } = body || {};

    let flowStructure = structure;
    if (!flowStructure) {
      const flowData = await getBotFlowData(id);
      flowStructure = flowData.draft?.structure || flowData.published?.structure;
    }

    if (!flowStructure) {
      return NextResponse.json(
        { error: "No flow structure provided or found on bot." },
        { status: 400 }
      );
    }

    const template = await createFlowTemplate({
      name,
      description,
      category,
      structure: flowStructure,
      adminUserId: session.id,
    });

    return NextResponse.json({
      success: true,
      template,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create template";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
