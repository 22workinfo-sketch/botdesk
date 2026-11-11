import { NextRequest, NextResponse } from "next/server";
import { getAdminSession, enforcePasswordChangeStatus } from "@/lib/auth";
import { canUserPublish, hasBotAccess } from "@/lib/permissions";
import { getPostById, schedulePost } from "@/lib/post-service";
import { verifyRequestOrigin } from "@/lib/rate-limit";

/**
 * POST /api/posts/[id]/schedule
 * Schedules or reschedules an existing post draft for publication at a future date and time.
 * Requires explicit publish permission on the target bot.
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

    // Bot Scoping & Permission Check
    const hasAccess = await hasBotAccess(session, post.botId);
    if (!hasAccess) {
      return NextResponse.json(
        { error: "Forbidden: You do not have access to this bot." },
        { status: 403 }
      );
    }

    const canPublish = await canUserPublish(session, post.botId);
    if (!canPublish) {
      return NextResponse.json(
        {
          error:
            "Forbidden: You do not have permission to schedule posts for publication. Only staff with publish permissions can schedule posts.",
        },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const { dateStr, timeStr, timeZone } = body;

    if (!dateStr || !timeStr || !timeZone) {
      return NextResponse.json(
        { error: "Scheduled date (YYYY-MM-DD), time (HH:mm), and IANA timezone are all required." },
        { status: 400 }
      );
    }

    const updated = await schedulePost({
      postId: id,
      botId: post.botId,
      dateStr,
      timeStr,
      timeZone,
      adminUserId: session.id,
    });

    return NextResponse.json({
      success: true,
      post: updated,
      message: `Post successfully scheduled for ${updated.scheduledTimezone || timeZone}.`,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to schedule post";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
