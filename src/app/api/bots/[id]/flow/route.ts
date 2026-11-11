import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { hasBotAccess } from "@/lib/permissions";
import { getBotFlowData } from "@/lib/flow/flow-service";

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
        { error: "Forbidden: You do not have access to this bot's flow." },
        { status: 403 }
      );
    }

    const flowData = await getBotFlowData(id);

    return NextResponse.json({
      success: true,
      ...flowData,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch bot flow";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
