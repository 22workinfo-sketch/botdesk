import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { hasBotAccess, canUserMutate, canUserPublish } from "@/lib/permissions";
import {
  getChannelPosts,
  createDraftPost,
  CreatePostInput,
} from "@/lib/post-service";
import {
  validateAndParseZonedDateTime,
  validateFutureSchedule,
} from "@/lib/schedule-utils";
import { runSchedulerCycle } from "@/worker/scheduler-worker";
import { verifyRequestOrigin } from "@/lib/rate-limit";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string; channelId: string } | Promise<{ id: string; channelId: string }> }
) {
  try {
    const session = await getAdminSession(req);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: botId, channelId } = await Promise.resolve(params);

    const allowed = await hasBotAccess(session, botId);
    if (!allowed) {
      return NextResponse.json(
        { error: "Forbidden: You do not have access to this bot's channel posts." },
        { status: 403 }
      );
    }

    // Opportunistic cycle to process any overdue scheduled posts immediately
    runSchedulerCycle().catch(() => {});

    const posts = await getChannelPosts(botId, channelId);
    return NextResponse.json({ success: true, posts });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch posts";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; channelId: string } | Promise<{ id: string; channelId: string }> }
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

    const { id: botId, channelId } = await Promise.resolve(params);

    const allowed = await canUserMutate(session, botId);
    if (!allowed) {
      return NextResponse.json(
        { error: "Forbidden: You do not have permission to create drafts for this bot." },
        { status: 403 }
      );
    }

    const body = await req.json();

    const input: CreatePostInput = {
      botId,
      channelId,
      postType:
        body.postType === "ALBUM"
          ? "ALBUM"
          : body.postType === "VIDEO"
          ? "VIDEO"
          : body.postType === "IMAGE"
          ? "IMAGE"
          : "TEXT",
      content: body.content || "",
      mediaPath: body.mediaPath || null,
      mediaOriginalName: body.mediaOriginalName || null,
      mediaMimeType: body.mediaMimeType || null,
      mediaSizeBytes: body.mediaSizeBytes || null,
      buttons: body.buttons || body.buttonsConfig || undefined,
      disableNotification: Boolean(body.disableNotification),
      hasSpoiler: Boolean(body.hasSpoiler),
      sendAsDocument: Boolean(body.sendAsDocument),
      albumItems: body.albumItems || undefined,
    };

    if (body.status === "SCHEDULED" || body.action === "SCHEDULE") {
      const allowedPublish = await canUserPublish(session, botId);
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
    }

    const newPost = await createDraftPost(input, session.id);

    return NextResponse.json({ success: true, post: newPost }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create post draft";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
