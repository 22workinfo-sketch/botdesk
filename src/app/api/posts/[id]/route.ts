import { NextRequest, NextResponse } from "next/server";
import { getAdminSession, enforcePasswordChangeStatus } from "@/lib/auth";
import { hasBotAccess, canUserMutate, canUserPublish } from "@/lib/permissions";
import {
  getPostById,
  updateDraftPost,
  deletePost,
  UpdatePostInput,
} from "@/lib/post-service";
import {
  validateAndParseZonedDateTime,
  validateFutureSchedule,
} from "@/lib/schedule-utils";
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

    const pwdCheck = enforcePasswordChangeStatus(session);
    if (pwdCheck) return pwdCheck;

    const { id } = await Promise.resolve(params);
    const post = await getPostById(id);

    if (!post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    const allowed = await hasBotAccess(session, post.botId);
    if (!allowed) {
      return NextResponse.json(
        { error: "Forbidden: You are not authorized to view posts for this bot." },
        { status: 403 }
      );
    }

    return NextResponse.json({ success: true, post });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch post";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

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

    const pwdCheck = enforcePasswordChangeStatus(session);
    if (pwdCheck) return pwdCheck;

    const { id } = await Promise.resolve(params);
    const existing = await getPostById(id);
    if (!existing) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    const hasAccess = await hasBotAccess(session, existing.botId);
    if (!hasAccess) {
      return NextResponse.json(
        { error: "Forbidden: You are not authorized to access this bot." },
        { status: 403 }
      );
    }

    const allowed = await canUserMutate(session, existing.botId);
    if (!allowed) {
      return NextResponse.json(
        { error: "Forbidden: You do not have permission to edit posts for this bot." },
        { status: 403 }
      );
    }

    const body = await req.json();

    const input: UpdatePostInput = {
      id,
      botId: existing.botId,
      channelId: body.channelId || existing.channelId,
      postType:
        body.postType === "ALBUM"
          ? "ALBUM"
          : body.postType === "VIDEO"
          ? "VIDEO"
          : body.postType === "IMAGE"
          ? "IMAGE"
          : "TEXT",
      content: body.content !== undefined ? body.content : existing.content,
      mediaPath: body.mediaPath !== undefined ? body.mediaPath : existing.mediaPath,
      mediaOriginalName: body.mediaOriginalName !== undefined ? body.mediaOriginalName : existing.mediaOriginalName,
      mediaMimeType: body.mediaMimeType !== undefined ? body.mediaMimeType : existing.mediaMimeType,
      mediaSizeBytes: body.mediaSizeBytes !== undefined ? body.mediaSizeBytes : existing.mediaSizeBytes,
      albumItems: body.albumItems !== undefined ? body.albumItems : undefined,
      buttons: body.buttons || body.buttonsConfig || undefined,
      disableNotification:
        body.disableNotification !== undefined
          ? Boolean(body.disableNotification)
          : existing.disableNotification,
      hasSpoiler:
        body.hasSpoiler !== undefined
          ? Boolean(body.hasSpoiler)
          : existing.hasSpoiler,
      sendAsDocument:
        body.sendAsDocument !== undefined
          ? Boolean(body.sendAsDocument)
          : existing.sendAsDocument,
    };

    if (body.status === "SCHEDULED" || body.action === "SCHEDULE") {
      const allowedPublish = await canUserPublish(session, existing.botId);
      if (!allowedPublish) {
        return NextResponse.json(
          {
            error:
              "Forbidden: You do not have permission to schedule posts for publication. Only staff with publish permissions can schedule posts.",
          },
          { status: 403 }
        );
      }

      const dateStr = body.scheduledDate || body.dateStr;
      const timeStr = body.scheduledTime || body.timeStr;
      const timeZone = body.scheduledTimezone || body.timeZone;

      if (!dateStr || !timeStr || !timeZone) {
        return NextResponse.json(
          { error: "Scheduled date, time, and timezone are required to schedule a post." },
          { status: 400 }
        );
      }

      const parsed = validateAndParseZonedDateTime(dateStr, timeStr, timeZone);
      validateFutureSchedule(parsed.utcDate);

      input.status = "SCHEDULED";
      input.scheduledAt = parsed.utcDate;
      input.scheduledTimezone = parsed.timeZone;
    } else if (body.status === "DRAFT" || body.action === "DRAFT") {
      input.status = "DRAFT";
      input.scheduledAt = null;
      input.scheduledTimezone = null;
    }

    const updated = await updateDraftPost(input, session.id);

    return NextResponse.json({ success: true, post: updated });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update post";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
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

    const allowed = await canUserMutate(session, post.botId);
    if (!allowed) {
      return NextResponse.json(
        { error: "Forbidden: You do not have permission to delete posts for this bot." },
        { status: 403 }
      );
    }

    await deletePost(id, post.botId, session.id);

    return NextResponse.json({ success: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to delete post";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
