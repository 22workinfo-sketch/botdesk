import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { hasBotAccess } from "@/lib/permissions";
import { getStorageProvider } from "@/lib/storage";
import { prisma } from "@/lib/prisma";

export async function GET(
  req: NextRequest,
  { params }: { params: { filename: string } | Promise<{ filename: string }> }
) {
  try {
    const session = await getAdminSession(req);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { filename } = await Promise.resolve(params);

    // Sanitize filename against directory traversal
    if (
      !filename ||
      filename.includes("..") ||
      filename.includes("/") ||
      filename.includes("\\") ||
      !/^[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp|mp4|webm|mov)$/i.test(filename)
    ) {
      return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
    }

    // Access authorization check
    if (session.role !== "SUPER_ADMIN") {
      // Find associated botId from StoredMedia or ChannelPost
      const stored = await prisma.storedMedia.findUnique({
        where: { storageKey: filename },
        select: { botId: true },
      });

      let associatedBotId = stored?.botId;

      if (!associatedBotId) {
        // Fallback: check if referenced in a post or album
        const post = await prisma.channelPost.findFirst({
          where: {
            OR: [
              { mediaPath: filename },
              { albumItems: { some: { filePath: filename } } },
            ],
          },
          select: { botId: true },
        });
        associatedBotId = post?.botId;
      }

      if (associatedBotId) {
        const hasAccess = await hasBotAccess(session, associatedBotId);
        if (!hasAccess) {
          return NextResponse.json(
            { error: "Forbidden: You are not authorized to view media for this bot." },
            { status: 403 }
          );
        }
      }
    }

    const storage = getStorageProvider();
    try {
      const { data, mimeType } = await storage.getObject(filename);

      return new NextResponse(new Uint8Array(data), {
        status: 200,
        headers: {
          "Content-Type": mimeType,
          "Cache-Control": "private, max-age=3600",
        },
      });
    } catch {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load media file";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
