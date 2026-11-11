import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { canUserMutate } from "@/lib/permissions";
import { publishFlow } from "@/lib/flow/flow-service";
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
        { error: "Forbidden: You do not have permission to publish this bot's flow." },
        { status: 403 }
      );
    }

    const published = await publishFlow(id, session.id);

    return NextResponse.json({
      success: true,
      published,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to publish flow";
    const validationErrors = (error as any)?.validationErrors;

    return NextResponse.json(
      {
        error: message,
        validationErrors: validationErrors || undefined,
      },
      { status: 400 }
    );
  }
}
