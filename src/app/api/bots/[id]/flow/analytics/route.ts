import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { hasBotAccess } from "@/lib/permissions";
import { getFlowAnalytics } from "@/lib/flow/analytics-service";

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
        { error: "Forbidden: You do not have access to this bot's analytics." },
        { status: 403 }
      );
    }

    const url = new URL(req.url);
    const versionParam = url.searchParams.get("version");
    const dateRangeParam = (url.searchParams.get("range") || "7d") as
      | "24h"
      | "7d"
      | "30d"
      | "all";

    const flowVersion = versionParam ? parseInt(versionParam, 10) : undefined;
    const analytics = await getFlowAnalytics(id, flowVersion, dateRangeParam);

    return NextResponse.json({
      success: true,
      analytics,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch flow analytics";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
