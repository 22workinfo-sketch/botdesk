import { NextRequest, NextResponse } from "next/server";
import { getAdminSession, enforcePasswordChangeStatus } from "@/lib/auth";
import { canUserPublish } from "@/lib/permissions";
import {
  getPostById,
  publishChannelPost,
  publishAlbumButtonsOnly,
} from "@/lib/post-service";
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

    const pwdCheck = enforcePasswordChangeStatus(session);
    if (pwdCheck) return pwdCheck;

    const { id } = await Promise.resolve(params);
    const post = await getPostById(id);

    if (!post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    const allowed = await canUserPublish(session, post.botId);
    if (!allowed) {
      return NextResponse.json(
        { error: "Forbidden: You do not have permission to publish posts to this channel." },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => ({}));

    // If recovering follow-up buttons for a PARTIAL post
    let result;
    if (body.action === "RETRY_BUTTONS" || (post.status === "PARTIAL" && body.action !== "FORCE_NEW")) {
      result = await publishAlbumButtonsOnly(id, post.botId, session.id);
    } else {
      result = await publishChannelPost(id, post.botId, session.id);
    }

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          status: result.status,
          messageId: result.messageId,
          albumMessageIds: result.albumMessageIds,
          error: result.error,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      status: result.status,
      messageId: result.messageId,
      albumMessageIds: result.albumMessageIds,
      buttonMessageId: result.buttonMessageId,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to publish post";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
