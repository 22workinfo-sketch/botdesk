import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { canUserMutate, hasBotAccess } from "@/lib/permissions";
import { previewFlowCopy, executeFlowCopy } from "@/lib/flow/template-service";
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

    const { id: sourceBotId } = await Promise.resolve(params);
    const url = new URL(req.url);
    const destinationBotId = url.searchParams.get("targetBotId");

    if (!destinationBotId) {
      return NextResponse.json(
        { error: "Query parameter 'targetBotId' is required." },
        { status: 400 }
      );
    }

    // Verify access to BOTH source and destination bots
    const [hasSourceAccess, hasDestAccess] = await Promise.all([
      hasBotAccess(session, sourceBotId),
      hasBotAccess(session, destinationBotId),
    ]);

    if (!hasSourceAccess || !hasDestAccess) {
      return NextResponse.json(
        { error: "Forbidden: You must have access to both source and destination bots." },
        { status: 403 }
      );
    }

    const preview = await previewFlowCopy(sourceBotId, destinationBotId);

    return NextResponse.json({
      success: true,
      preview,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to generate copy preview";
    return NextResponse.json({ error: message }, { status: 400 });
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

    const { id: sourceBotId } = await Promise.resolve(params);
    const body = await req.json();
    const destinationBotId = body?.targetBotId;
    const channelMapping = body?.channelMapping;

    if (!destinationBotId) {
      return NextResponse.json(
        { error: "Field 'targetBotId' is required in request body." },
        { status: 400 }
      );
    }

    // Verify mutate permission on destination bot and read on source
    const [hasSourceAccess, canMutateDest] = await Promise.all([
      hasBotAccess(session, sourceBotId),
      canUserMutate(session, destinationBotId),
    ]);

    if (!hasSourceAccess || !canMutateDest) {
      return NextResponse.json(
        {
          error:
            "Forbidden: You must have read access on source bot and edit permissions on destination bot.",
        },
        { status: 403 }
      );
    }

    const savedDraft = await executeFlowCopy({
      sourceBotId,
      destinationBotId,
      channelMapping,
      adminUserId: session.id,
    });

    return NextResponse.json({
      success: true,
      draft: savedDraft,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to execute flow copy";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
