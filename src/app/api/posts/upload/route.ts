import { NextRequest, NextResponse } from "next/server";
import path from "path";
import crypto from "crypto";
import { getAdminSession } from "@/lib/auth";
import { canUserMutate } from "@/lib/permissions";
import { validateMediaUpload } from "@/lib/post-service";
import { verifyRequestOrigin } from "@/lib/rate-limit";
import { getStorageProvider, recordMediaInDatabase } from "@/lib/storage";

export async function POST(req: NextRequest) {
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

    if (session.role === "VIEWER") {
      return NextResponse.json(
        { error: "Forbidden: Read-only accounts cannot upload media." },
        { status: 403 }
      );
    }

    const formData = await req.formData();
    const botId =
      (formData.get("botId") as string | null) ||
      req.nextUrl.searchParams.get("botId");

    // If botId is specified, enforce explicit mutation authorization
    if (botId) {
      const allowed = await canUserMutate(session, botId);
      if (!allowed) {
        return NextResponse.json(
          { error: "Forbidden: You do not have permission to upload media for this bot." },
          { status: 403 }
        );
      }
    }

    const rawFiles = [
      ...formData.getAll("files"),
      ...formData.getAll("file"),
    ].filter((f) => f instanceof Blob) as Blob[];

    if (rawFiles.length === 0) {
      return NextResponse.json(
        { error: "No media file provided in upload request." },
        { status: 400 }
      );
    }

    if (rawFiles.length > 10) {
      return NextResponse.json(
        { error: "Cannot upload more than 10 media items at once." },
        { status: 400 }
      );
    }

    const storage = getStorageProvider();
    const uploadedItems = [];

    for (const file of rawFiles) {
      const mimeType = file.type || "application/octet-stream";
      const sizeBytes = file.size;
      let rawName = (file as any).name || "";
      const currentExt = path.extname(rawName).toLowerCase();
      if (!currentExt || rawName === "blob" || rawName === "image" || rawName === "media.bin") {
        const defaultExt =
          mimeType === "image/jpeg" ? ".jpg"
          : mimeType === "image/png" ? ".png"
          : mimeType === "image/webp" ? ".webp"
          : mimeType === "video/mp4" ? ".mp4"
          : mimeType === "video/webm" ? ".webm"
          : mimeType === "video/quicktime" ? ".mov"
          : "";
        const base =
          rawName && rawName !== "blob" && rawName !== "image" && rawName !== "media.bin"
            ? path.parse(rawName).name
            : `pasted_${Date.now()}`;
        rawName = `${base}${defaultExt || ".bin"}`;
      }

      // Read initial slice for magic byte verification
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const headerSlice = buffer.subarray(0, 16);

      // Validate type, signature, and size constraints
      const { mediaType, extension } = validateMediaUpload(
        mimeType,
        sizeBytes,
        rawName,
        headerSlice
      );

      const safeFilename = `${crypto.randomUUID()}${extension}`;

      // Store via storage abstraction (local or S3/R2)
      await storage.putObject(safeFilename, buffer, mimeType);

      // Record durable object key and metadata in database
      await recordMediaInDatabase({
        storageKey: safeFilename,
        storageProvider: storage.name,
        mimeType,
        sizeBytes,
        originalName: path.basename(rawName),
        botId: botId || null,
        uploadedById: session.id,
      });

      const mediaUrl = `/api/media/posts/${safeFilename}`;
      uploadedItems.push({
        mediaType,
        filename: safeFilename,
        filePath: mediaUrl,
        url: mediaUrl,
        storageKey: safeFilename,
        originalName: path.basename(rawName),
        mimeType,
        sizeBytes,
      });
    }

    if (uploadedItems.length === 1) {
      const single = uploadedItems[0];
      return NextResponse.json({
        success: true,
        mediaType: single.mediaType,
        filename: single.filename,
        filePath: single.filePath,
        url: single.url,
        storageKey: single.storageKey,
        originalName: single.originalName,
        mimeType: single.mimeType,
        sizeBytes: single.sizeBytes,
        items: uploadedItems,
      });
    }

    return NextResponse.json({
      success: true,
      items: uploadedItems,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Media upload failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
