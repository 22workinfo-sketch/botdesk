import { NextRequest, NextResponse } from "next/server";
import { getAdminSession, enforcePasswordChangeStatus } from "@/lib/auth";
import { canUserMutate, hasBotAccess } from "@/lib/permissions";
import { getPostById, cancelScheduledPost } from "@/lib/post-service";
import { verifyRequestOrigin } from "@/lib/rate-limit";

/**
 * POST /api/posts/[id]/cancel-schedule
 * Cancels a scheduled post and reverts it back to DRAFT status without deleting it.
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
    if (pwdCheck) return pwdCheck;

    const { id } = await Promise.resolve(params);
    const post = await getPostById(id);

    if (!post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    const hasAccess = await hasBotAccess(session, post.botId);
    if (!hasAccess) {
      return NextResponse.json(
        { error: "Forbidden: You do not have access to this bot." },
        { status: 403 }
      );
    }

    const allowed = await canUserMutate(session, post.botId);
    if (!allowed) {
      return NextResponse.json(
        { error: "Forbidden: You do not have permission to modify posts for this bot." },
        { status: 403 }
      );
    }

    const updated = await cancelScheduledPost(id, post.botId, session.id);

    return NextResponse.json({
      success: true,
      post: updated,
      message: "Scheduled post has been cancelled and returned to Draft status.",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to cancel scheduled post";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
