import path from "path";
import fs from "fs";
import { Api, InlineKeyboard, InputFile } from "grammy";
import { prisma } from "./prisma";
import { getStorageProvider } from "./storage";
import { decryptBotToken, redactTokens } from "./token-encryption";
import { createTelegramApi } from "./telegram-client";
import {
  validateAndParseZonedDateTime,
  validateFutureSchedule,
} from "./schedule-utils";

export interface InlineUrlButton {
  label: string;
  url: string;
  order: number;
}

export type PostType = "TEXT" | "IMAGE" | "VIDEO" | "ALBUM";

export interface AlbumItemInput {
  id?: string;
  mediaType: "IMAGE" | "VIDEO";
  filePath: string;
  originalName?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  order: number;
  hasSpoiler?: boolean;
}

export interface CreatePostInput {
  botId: string;
  channelId: string;
  postType: PostType;
  content: string;
  mediaPath?: string | null;
  mediaOriginalName?: string | null;
  mediaMimeType?: string | null;
  mediaSizeBytes?: number | null;
  albumItems?: AlbumItemInput[];
  buttons?: InlineUrlButton[];
  disableNotification?: boolean;
  hasSpoiler?: boolean;
  sendAsDocument?: boolean;
  status?: string;
  scheduledAt?: Date | string | null;
  scheduledTimezone?: string | null;
}

export interface UpdatePostInput {
  id: string;
  botId: string;
  channelId: string;
  postType: PostType;
  content: string;
  mediaPath?: string | null;
  mediaOriginalName?: string | null;
  mediaMimeType?: string | null;
  mediaSizeBytes?: number | null;
  albumItems?: AlbumItemInput[];
  buttons?: InlineUrlButton[];
  disableNotification?: boolean;
  hasSpoiler?: boolean;
  sendAsDocument?: boolean;
  status?: string;
  scheduledAt?: Date | string | null;
  scheduledTimezone?: string | null;
}

export interface SchedulePostInput {
  postId: string;
  botId: string;
  dateStr: string;
  timeStr: string;
  timeZone: string;
  adminUserId?: string;
}

export interface ChannelPermissionResult {
  status: "CAN_POST" | "CANNOT_POST" | "NOT_ADMIN" | "UNKNOWN";
  message: string;
  canPost: boolean;
  chatTitle?: string;
  chatUsername?: string;
}

export interface PublishResult {
  success: boolean;
  status: "PUBLISHED" | "FAILED" | "UNKNOWN" | "PARTIAL";
  messageId?: number;
  albumMessageIds?: number[];
  buttonMessageId?: number;
  error?: string;
}

export const UPLOADS_POSTS_DIR = path.join(process.cwd(), "uploads", "posts");

/**
 * Resolves an InputFile for grammY whether media is on local disk or in S3/R2 storage.
 */
export async function resolveMediaInputFile(
  mediaKeyOrPath: string,
  originalName?: string | null
): Promise<InputFile> {
  const storage = getStorageProvider();
  if (path.isAbsolute(mediaKeyOrPath) && fs.existsSync(mediaKeyOrPath)) {
    return new InputFile(mediaKeyOrPath, originalName || undefined);
  }

  const localPath = storage.getLocalFilePath
    ? storage.getLocalFilePath(mediaKeyOrPath)
    : path.join(UPLOADS_POSTS_DIR, mediaKeyOrPath);

  if (localPath && fs.existsSync(localPath)) {
    return new InputFile(localPath, originalName || undefined);
  }

  const { data } = await storage.getObject(mediaKeyOrPath);
  return new InputFile(data, originalName || undefined);
}

/**
 * Validates post content according to Telegram Bot API limits.
 */
export function validatePostContent(
  postType: PostType,
  content: string
): string {
  const trimmed = (content || "").trim();

  if (postType === "TEXT") {
    if (!trimmed) {
      throw new Error("Post text content is required for text-only messages.");
    }
    if (trimmed.length > 4096) {
      throw new Error(
        `Post text length (${trimmed.length} chars) exceeds Telegram limit of 4096 characters.`
      );
    }
  } else if (postType === "IMAGE" || postType === "VIDEO" || postType === "ALBUM") {
    if (trimmed.length > 1024) {
      const typeLabel =
        postType === "IMAGE"
          ? "Image"
          : postType === "VIDEO"
          ? "Video"
          : "Album";
      throw new Error(
        `${typeLabel} caption length (${trimmed.length} chars) exceeds Telegram limit of 1024 characters.`
      );
    }
  } else {
    throw new Error(`Unsupported post type: ${postType}`);
  }

  return trimmed;
}

/**
 * Validates album items according to Telegram Bot API media group rules.
 * Requires 2 to 10 photos/videos with valid local files and ordering.
 */
export function validateAlbumItems(
  items?: AlbumItemInput[]
): AlbumItemInput[] {
  if (!items || !Array.isArray(items)) {
    throw new Error("An album requires a list of media items.");
  }

  if (items.length < 2) {
    throw new Error("An album must contain at least 2 media items (minimum Telegram requirement).");
  }

  if (items.length > 10) {
    throw new Error("An album cannot exceed 10 media items (maximum Telegram limit).");
  }

  const sorted = [...items].sort((a, b) => a.order - b.order);

  const validated: AlbumItemInput[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const item = sorted[i];
    if (!item.filePath || typeof item.filePath !== "string") {
      throw new Error(`Album item #${i + 1} is missing a valid file path.`);
    }

    if (item.mediaType !== "IMAGE" && item.mediaType !== "VIDEO") {
      throw new Error(
        `Album item #${i + 1} has invalid media type "${item.mediaType}". Allowed types: IMAGE or VIDEO.`
      );
    }

    const fullPath = path.isAbsolute(item.filePath)
      ? item.filePath
      : path.join(UPLOADS_POSTS_DIR, item.filePath);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`Album item #${i + 1} file not found on local storage: ${item.filePath}`);
    }

    validated.push({
      id: item.id,
      mediaType: item.mediaType,
      filePath: item.filePath,
      originalName: item.originalName || null,
      mimeType: item.mimeType || null,
      sizeBytes: item.sizeBytes || null,
      order: i, // Normalized index 0..N-1
      hasSpoiler: Boolean(item.hasSpoiler),
    });
  }

  return validated;
}

/**
 * Validates combinations of posting options according to Telegram Bot API capabilities.
 */
export function validatePostOptions(
  postType: PostType,
  options: {
    disableNotification?: boolean;
    hasSpoiler?: boolean;
    sendAsDocument?: boolean;
  }
): {
  disableNotification: boolean;
  hasSpoiler: boolean;
  sendAsDocument: boolean;
} {
  const disableNotification = Boolean(options.disableNotification);
  const sendAsDocument = Boolean(options.sendAsDocument);
  const hasSpoiler = Boolean(options.hasSpoiler);

  if (sendAsDocument && (postType === "TEXT" || postType === "ALBUM")) {
    throw new Error(
      `Cannot send a ${postType === "TEXT" ? "text-only message" : "media album"} as a document.`
    );
  }

  if (hasSpoiler && (sendAsDocument || postType === "TEXT")) {
    throw new Error(
      sendAsDocument
        ? "Telegram does not support media spoiler animation when sending files as documents."
        : "Telegram does not support the media spoiler parameter for text-only messages."
    );
  }

  return {
    disableNotification,
    hasSpoiler:
      (postType === "IMAGE" || postType === "VIDEO") && !sendAsDocument
        ? hasSpoiler
        : false,
    sendAsDocument:
      postType === "IMAGE" || postType === "VIDEO" ? sendAsDocument : false,
  };
}

/**
 * Validates inline URL buttons. Rejects non-HTTPS or unsafe links.
 */
export function validateInlineUrlButtons(
  buttons?: InlineUrlButton[]
): InlineUrlButton[] {
  if (!buttons || !Array.isArray(buttons)) {
    return [];
  }

  if (buttons.length > 10) {
    throw new Error("A post can have a maximum of 10 inline buttons.");
  }

  const validated: InlineUrlButton[] = [];

  for (let i = 0; i < buttons.length; i++) {
    const btn = buttons[i];
    const label = (btn.label || "").trim();
    if (!label) {
      throw new Error(`Button #${i + 1} must have a non-empty label.`);
    }
    if (label.length > 64) {
      throw new Error(
        `Button label "${label}" exceeds the maximum length of 64 characters.`
      );
    }

    const rawUrl = (btn.url || "").trim();
    if (!rawUrl) {
      throw new Error(`Button "${label}" must have a valid destination URL.`);
    }

    const lower = rawUrl.toLowerCase();
    const isAllowedScheme =
      lower.startsWith("https://") ||
      lower.startsWith("http://127.0.0.1") ||
      lower.startsWith("http://localhost") ||
      lower.startsWith("tg://");

    if (!isAllowedScheme) {
      throw new Error(
        `Button "${label}" destination URL must be a secure HTTPS link or Telegram link (tg://). Unsafe schemes are rejected.`
      );
    }

    try {
      if (!lower.startsWith("tg://")) {
        new URL(rawUrl);
      }
    } catch {
      throw new Error(`Button "${label}" has an invalid URL format.`);
    }

    validated.push({
      label,
      url: rawUrl,
      order: typeof btn.order === "number" ? btn.order : i,
    });
  }

  return validated.sort((a, b) => a.order - b.order);
}

/**
 * Validates local image file upload constraints (kept for backward compatibility).
 */
export function validateImageUpload(
  mimeType: string,
  sizeBytes: number
): void {
  const allowedMimes = ["image/jpeg", "image/png", "image/webp"];
  if (!allowedMimes.includes(mimeType.toLowerCase())) {
    throw new Error(
      `Unsupported image type "${mimeType}". Allowed formats: JPEG, PNG, WebP.`
    );
  }

  const maxBytes = 10 * 1024 * 1024; // 10 MB
  if (sizeBytes > maxBytes) {
    throw new Error(
      `Image size (${(sizeBytes / (1024 * 1024)).toFixed(2)} MB) exceeds the limit of 10 MB.`
    );
  }
}

/**
 * Comprehensive media upload validator supporting both images and videos.
 * Validates file extension, MIME type, size limits, and magic bytes / signatures.
 */
export function validateMediaUpload(
  mimeType: string,
  sizeBytes: number,
  originalName: string,
  fileHeader?: Buffer
): { mediaType: "IMAGE" | "VIDEO"; extension: string } {
  if (
    !originalName ||
    originalName.includes("..") ||
    originalName.includes("/") ||
    originalName.includes("\\")
  ) {
    throw new Error("Invalid filename: path traversal characters are forbidden.");
  }

  const sanitizedName = path.basename(originalName.trim());
  if (!sanitizedName) {
    throw new Error("Invalid filename: filename cannot be empty.");
  }

  const ext = path.extname(sanitizedName).toLowerCase();
  const lowerMime = (mimeType || "").toLowerCase().trim();

  const allowedImageMimes = ["image/jpeg", "image/png", "image/webp"];
  const allowedImageExts = [".jpg", ".jpeg", ".png", ".webp"];

  const allowedVideoMimes = ["video/mp4", "video/webm", "video/quicktime"];
  const allowedVideoExts = [".mp4", ".webm", ".mov"];

  const isImageMime = allowedImageMimes.includes(lowerMime);
  const isVideoMime = allowedVideoMimes.includes(lowerMime);

  if (!isImageMime && !isVideoMime) {
    throw new Error(
      `Unsupported media MIME type "${mimeType}". Allowed formats: JPEG, PNG, WebP for images; MP4, WebM, MOV for videos.`
    );
  }

  if (isImageMime) {
    if (!allowedImageExts.includes(ext)) {
      throw new Error(
        `File extension "${ext}" does not match image MIME type "${mimeType}".`
      );
    }
    const maxImageBytes = 10 * 1024 * 1024; // 10 MB
    if (sizeBytes > maxImageBytes) {
      throw new Error(
        `Image size (${(sizeBytes / (1024 * 1024)).toFixed(2)} MB) exceeds the maximum limit of 10 MB.`
      );
    }
    if (fileHeader && fileHeader.length >= 4) {
      if (
        lowerMime === "image/jpeg" &&
        (fileHeader[0] !== 0xff ||
          fileHeader[1] !== 0xd8 ||
          fileHeader[2] !== 0xff)
      ) {
        throw new Error("Invalid file content: JPEG header signature mismatch.");
      }
      if (
        lowerMime === "image/png" &&
        (fileHeader[0] !== 0x89 ||
          fileHeader[1] !== 0x50 ||
          fileHeader[2] !== 0x4e ||
          fileHeader[3] !== 0x47)
      ) {
        throw new Error("Invalid file content: PNG header signature mismatch.");
      }
    }
    return { mediaType: "IMAGE", extension: ext === ".jpeg" ? ".jpg" : ext };
  } else {
    // Video
    if (!allowedVideoExts.includes(ext)) {
      throw new Error(
        `File extension "${ext}" does not match video MIME type "${mimeType}".`
      );
    }
    const maxVideoBytes = 25 * 1024 * 1024; // 25 MB local/test limit
    if (sizeBytes > maxVideoBytes) {
      throw new Error(
        `Video size (${(sizeBytes / (1024 * 1024)).toFixed(2)} MB) exceeds the local test limit of 25 MB.`
      );
    }
    if (fileHeader && fileHeader.length >= 8) {
      if (lowerMime === "video/mp4" || lowerMime === "video/quicktime") {
        const ftypBox = fileHeader.toString("latin1", 4, 8);
        if (ftypBox !== "ftyp") {
          throw new Error("Invalid file content: MP4/MOV header box mismatch.");
        }
      } else if (lowerMime === "video/webm") {
        if (
          fileHeader[0] !== 0x1a ||
          fileHeader[1] !== 0x45 ||
          fileHeader[2] !== 0xdf ||
          fileHeader[3] !== 0xa3
        ) {
          throw new Error("Invalid file content: WebM EBML header mismatch.");
        }
      }
    }
    return { mediaType: "VIDEO", extension: ext };
  }
}

/**
 * Resolves a bot's Telegram secret token from encrypted database storage or environment variables.
 * Never logs or returns the token to external callers.
 */
export async function resolveBotToken(botId: string): Promise<{
  token: string;
  bot: { id: string; name: string; username: string; tokenEnvVar: string };
}> {
  const bot = await prisma.bot.findUnique({
    where: { id: botId },
    select: {
      id: true,
      name: true,
      username: true,
      tokenEnvVar: true,
      encryptedToken: true,
    },
  });

  if (!bot) {
    throw new Error(`Bot with ID "${botId}" was not found.`);
  }

  // 1. Try decrypting encrypted token stored in DB (Multi-bot)
  if (bot.encryptedToken) {
    try {
      const decrypted = decryptBotToken(bot.encryptedToken);
      if (decrypted && decrypted.trim().length > 0) {
        return {
          token: decrypted.trim(),
          bot: {
            id: bot.id,
            name: bot.name,
            username: bot.username,
            tokenEnvVar: bot.tokenEnvVar,
          },
        };
      }
    } catch (err) {
      console.error(
        `[Token Decryption Error] Failed to decrypt token for bot "${bot.name}":`,
        err instanceof Error ? err.message : err
      );
    }
  }

  // 2. Fallback to environment variable for legacy single-bot configurations
  const envVar = bot.tokenEnvVar || "TELEGRAM_BOT_TOKEN";
  const token = process.env[envVar];

  if (
    !token ||
    token.trim() === "" ||
    token.includes("placeholder") ||
    token.includes("your_test_bot_token")
  ) {
    throw new Error(
      `Bot token is not configured in environment variable "${envVar}". Configure a live BotFather token in .env.`
    );
  }

  return {
    token: token.trim(),
    bot: {
      id: bot.id,
      name: bot.name,
      username: bot.username,
      tokenEnvVar: bot.tokenEnvVar,
    },
  };
}

/**
 * Checks whether the bot has "Post Messages" permission in a target channel.
 * If permission cannot be verified, returns "UNKNOWN" without fabricating health.
 */
export async function checkBotChannelPermissions(
  botId: string,
  channelId: string,
  customApi?: any
): Promise<ChannelPermissionResult> {
  const channel = await prisma.botChannel.findUnique({
    where: { id: channelId },
  });

  if (!channel || channel.botId !== botId) {
    return {
      status: "UNKNOWN",
      message: "Channel does not belong to the selected bot.",
      canPost: false,
    };
  }

  let api: any = customApi;
  if (!api) {
    try {
      const { token } = await resolveBotToken(botId);
      api = createTelegramApi(token);
    } catch (tokenErr: any) {
      return {
        status: "UNKNOWN",
        message: `Bot token unverified: ${tokenErr.message}`,
        canPost: false,
      };
    }
  }

  try {
    const targetChatId = channel.telegramChatId;
    const chat = await api.getChat(targetChatId);
    const botInfo = await api.getMe();
    const member = await api.getChatMember(targetChatId, botInfo.id);

    if (member.status === "creator") {
      return {
        status: "CAN_POST",
        message: "Bot is the channel Creator (Full administrator permissions).",
        canPost: true,
        chatTitle: chat.title,
        chatUsername: chat.username,
      };
    }

    if (member.status === "administrator") {
      // In channels, can_post_messages determines publishing rights
      if (member.can_post_messages !== false) {
        return {
          status: "CAN_POST",
          message: "Bot is an Administrator with 'Post Messages' permission enabled.",
          canPost: true,
          chatTitle: chat.title,
          chatUsername: chat.username,
        };
      } else {
        return {
          status: "CANNOT_POST",
          message: "Bot is an Administrator but 'Post Messages' permission is Disabled.",
          canPost: false,
          chatTitle: chat.title,
          chatUsername: chat.username,
        };
      }
    }

    return {
      status: "NOT_ADMIN",
      message: `Bot member status is "${member.status}". Bot must be an Administrator to publish.`,
      canPost: false,
      chatTitle: chat.title,
      chatUsername: chat.username,
    };
  } catch (err: any) {
    const rawError = String(err?.message || err || "").toLowerCase();

    if (
      rawError.includes("chat not found") ||
      rawError.includes("bot is not a member") ||
      rawError.includes("forbidden")
    ) {
      return {
        status: "NOT_ADMIN",
        message:
          "Bot is not in the channel or channel was not found. Add your bot as an Administrator in Telegram.",
        canPost: false,
      };
    }

    // Network timeout, rate limit, or unexpected error -> honest UNKNOWN
    return {
      status: "UNKNOWN",
      message: "Unable to verify Telegram permissions at this moment (Status: Unknown).",
      canPost: false,
    };
  }
}

/**
 * Retrieves channel posts scoped to bot and optionally channel.
 */
export async function getChannelPosts(botId: string, channelId?: string) {
  return prisma.channelPost.findMany({
    where: {
      botId,
      ...(channelId ? { channelId } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: {
      channel: {
        select: {
          id: true,
          name: true,
          telegramChatId: true,
        },
      },
      albumItems: {
        orderBy: { order: "asc" },
      },
    },
  });
}

/**
 * Retrieves a single post by ID scoped to botId.
 */
export async function getPostById(postId: string, botId?: string) {
  return prisma.channelPost.findFirst({
    where: {
      id: postId,
      ...(botId ? { botId } : {}),
    },
    include: {
      channel: {
        select: {
          id: true,
          name: true,
          telegramChatId: true,
        },
      },
      albumItems: {
        orderBy: { order: "asc" },
      },
    },
  });
}

/**
 * Creates and saves a new draft post in PostgreSQL.
 */
export async function createDraftPost(
  input: CreatePostInput,
  adminUserId?: string
) {
  // 1. Verify channel belongs to bot
  const channel = await prisma.botChannel.findUnique({
    where: { id: input.channelId },
  });

  if (!channel || channel.botId !== input.botId) {
    throw new Error(
      `Channel with ID "${input.channelId}" does not belong to bot "${input.botId}".`
    );
  }

  // 2. Validate content & buttons & options
  const validatedContent = validatePostContent(input.postType, input.content);
  const validatedButtons = validateInlineUrlButtons(input.buttons);
  const validatedOptions = validatePostOptions(input.postType, input);

  // 3. Verify media requirements
  let validatedAlbumItems: AlbumItemInput[] = [];
  if (input.postType === "ALBUM") {
    validatedAlbumItems = validateAlbumItems(input.albumItems);
  } else if (input.postType === "IMAGE" || input.postType === "VIDEO") {
    if (!input.mediaPath) {
      const typeLabel = input.postType === "IMAGE" ? "Image" : "Video";
      throw new Error(`${typeLabel} post requires an uploaded media file.`);
    }
    const fullPath = path.isAbsolute(input.mediaPath)
      ? input.mediaPath
      : path.join(UPLOADS_POSTS_DIR, input.mediaPath);

    if (!fs.existsSync(fullPath)) {
      throw new Error("Uploaded media file was not found on local storage.");
    }
  }

  // 4. Save draft in PostgreSQL
  const post = await prisma.channelPost.create({
    data: {
      botId: input.botId,
      channelId: input.channelId,
      postType: input.postType,
      content: validatedContent,
      mediaPath: input.postType === "ALBUM" ? null : input.mediaPath || null,
      mediaOriginalName:
        input.postType === "ALBUM" ? null : input.mediaOriginalName || null,
      mediaMimeType:
        input.postType === "ALBUM" ? null : input.mediaMimeType || null,
      mediaSizeBytes:
        input.postType === "ALBUM" ? null : input.mediaSizeBytes || null,
      buttonsConfig:
        validatedButtons.length > 0 ? (validatedButtons as any) : null,
      disableNotification: validatedOptions.disableNotification,
      hasSpoiler: validatedOptions.hasSpoiler,
      sendAsDocument: validatedOptions.sendAsDocument,
      status: input.status === "SCHEDULED" && input.scheduledAt ? "SCHEDULED" : "DRAFT",
      scheduledAt: input.status === "SCHEDULED" && input.scheduledAt ? new Date(input.scheduledAt) : null,
      scheduledTimezone: input.status === "SCHEDULED" ? input.scheduledTimezone || "UTC" : null,
      scheduledByUserId: input.status === "SCHEDULED" ? adminUserId || null : null,
      albumItems:
        validatedAlbumItems.length > 0
          ? {
              create: validatedAlbumItems.map((item) => ({
                mediaType: item.mediaType,
                filePath: item.filePath,
                originalName: item.originalName,
                mimeType: item.mimeType,
                sizeBytes: item.sizeBytes,
                order: item.order,
                hasSpoiler: item.hasSpoiler,
              })),
            }
          : undefined,
    },
    include: {
      channel: {
        select: { id: true, name: true, telegramChatId: true },
      },
      albumItems: {
        orderBy: { order: "asc" },
      },
    },
  });

  // 5. Audit log
  let validAdminUserId: string | null = null;
  if (adminUserId) {
    const adminExists = await prisma.adminUser.findUnique({
      where: { id: adminUserId },
      select: { id: true },
    });
    if (adminExists) validAdminUserId = adminExists.id;
  }

  await prisma.auditLog.create({
    data: {
      botId: input.botId,
      adminUserId: validAdminUserId,
      action: "CREATE_CHANNEL_POST_DRAFT",
      details: {
        postId: post.id,
        channelId: post.channelId,
        postType: post.postType,
        buttonCount: validatedButtons.length,
        albumItemCount: validatedAlbumItems.length,
      },
    },
  });

  return post;
}

/**
 * Updates an existing draft or failed post in PostgreSQL.
 */
export async function updateDraftPost(
  input: UpdatePostInput,
  adminUserId?: string
) {
  const existing = await prisma.channelPost.findUnique({
    where: { id: input.id },
    include: { albumItems: true },
  });

  if (!existing || existing.botId !== input.botId) {
    throw new Error(`Post with ID "${input.id}" was not found.`);
  }

  if (existing.status === "SENDING" || existing.status === "PUBLISHED") {
    throw new Error(
      `Cannot edit a post with status "${existing.status}". Only DRAFT, SCHEDULED, FAILED, or UNKNOWN posts can be modified.`
    );
  }

  const channel = await prisma.botChannel.findUnique({
    where: { id: input.channelId },
  });

  if (!channel || channel.botId !== input.botId) {
    throw new Error(
      `Channel with ID "${input.channelId}" does not belong to bot "${input.botId}".`
    );
  }

  const validatedContent = validatePostContent(input.postType, input.content);
  const validatedButtons = validateInlineUrlButtons(input.buttons);
  const validatedOptions = validatePostOptions(input.postType, input);

  let validatedAlbumItems: AlbumItemInput[] = [];
  if (input.postType === "ALBUM") {
    validatedAlbumItems = validateAlbumItems(input.albumItems);
  } else if (input.postType === "IMAGE" || input.postType === "VIDEO") {
    const mediaPath = input.mediaPath || existing.mediaPath;
    if (!mediaPath) {
      const typeLabel = input.postType === "IMAGE" ? "Image" : "Video";
      throw new Error(`${typeLabel} post requires an uploaded media file.`);
    }
  }

  // Update album items if postType is ALBUM
  if (input.postType === "ALBUM") {
    await prisma.postAlbumItem.deleteMany({ where: { postId: input.id } });
  }

  const updated = await prisma.channelPost.update({
    where: { id: input.id },
    data: {
      channelId: input.channelId,
      postType: input.postType,
      content: validatedContent,
      mediaPath:
        input.postType === "ALBUM"
          ? null
          : input.mediaPath !== undefined
          ? input.mediaPath
          : existing.mediaPath,
      mediaOriginalName:
        input.postType === "ALBUM"
          ? null
          : input.mediaOriginalName !== undefined
          ? input.mediaOriginalName
          : existing.mediaOriginalName,
      mediaMimeType:
        input.postType === "ALBUM"
          ? null
          : input.mediaMimeType !== undefined
          ? input.mediaMimeType
          : existing.mediaMimeType,
      mediaSizeBytes:
        input.postType === "ALBUM"
          ? null
          : input.mediaSizeBytes !== undefined
          ? input.mediaSizeBytes
          : existing.mediaSizeBytes,
      buttonsConfig:
        validatedButtons.length > 0 ? (validatedButtons as any) : null,
      disableNotification: validatedOptions.disableNotification,
      hasSpoiler: validatedOptions.hasSpoiler,
      sendAsDocument: validatedOptions.sendAsDocument,
      status:
        input.status === "SCHEDULED" && input.scheduledAt
          ? "SCHEDULED"
          : input.status === "DRAFT"
          ? "DRAFT"
          : existing.status === "SCHEDULED" && input.scheduledAt !== null
          ? "SCHEDULED"
          : "DRAFT",
      scheduledAt:
        input.status === "SCHEDULED" && input.scheduledAt
          ? new Date(input.scheduledAt)
          : input.status === "DRAFT"
          ? null
          : input.scheduledAt !== undefined
          ? input.scheduledAt
            ? new Date(input.scheduledAt)
            : null
          : existing.scheduledAt,
      scheduledTimezone:
        input.scheduledTimezone !== undefined
          ? input.scheduledTimezone
          : existing.scheduledTimezone,
      scheduledByUserId:
        input.status === "SCHEDULED"
          ? adminUserId || existing.scheduledByUserId
          : existing.scheduledByUserId,
      claimLeaseExpiresAt: null,
      claimWorkerId: null,
      lastError: null,
      albumItems:
        input.postType === "ALBUM" && validatedAlbumItems.length > 0
          ? {
              create: validatedAlbumItems.map((item) => ({
                mediaType: item.mediaType,
                filePath: item.filePath,
                originalName: item.originalName,
                mimeType: item.mimeType,
                sizeBytes: item.sizeBytes,
                order: item.order,
                hasSpoiler: item.hasSpoiler,
              })),
            }
          : undefined,
    },
    include: {
      channel: {
        select: { id: true, name: true, telegramChatId: true },
      },
      albumItems: {
        orderBy: { order: "asc" },
      },
    },
  });

  return updated;
}

/**
 * Deletes a post and cleans up any local uploaded image/video/album files.
 */
export async function deletePost(
  postId: string,
  botId: string,
  _adminUserId?: string
) {
  const post = await prisma.channelPost.findUnique({
    where: { id: postId },
    include: { albumItems: true, channel: true },
  });

  if (!post || post.botId !== botId) {
    throw new Error(`Post with ID "${postId}" was not found.`);
  }

  if (post.status === "SENDING") {
    throw new Error("Cannot delete a post that is currently publishing.");
  }

  // If the post was published, attempt to delete all parts cleanly from Telegram
  if (post.status === "PUBLISHED" || post.status === "PARTIAL") {
    try {
      const bot = await prisma.bot.findUnique({
        where: { id: botId },
      });
      let resolvedToken: string | null = null;
      if (bot?.encryptedToken) {
        resolvedToken = decryptBotToken(bot.encryptedToken);
      }
      if (!resolvedToken && bot?.tokenEnvVar && process.env[bot.tokenEnvVar]) {
        resolvedToken = process.env[bot.tokenEnvVar] || null;
      }

      if (resolvedToken && post.channel?.telegramChatId) {
        const api = createTelegramApi(resolvedToken);
        const chatId = post.channel.telegramChatId;

        const messageIdsToDelete = new Set<number>();
        if (post.telegramMessageId) messageIdsToDelete.add(post.telegramMessageId);
        if (post.buttonMessageId) messageIdsToDelete.add(post.buttonMessageId);
        if (Array.isArray(post.albumMessageIds)) {
          for (const mid of post.albumMessageIds) {
            if (typeof mid === "number") messageIdsToDelete.add(mid);
          }
        }

        for (const msgId of messageIdsToDelete) {
          try {
            await api.deleteMessage(chatId, msgId);
          } catch (delErr) {
            console.warn(`[DeletePost] Failed to delete message ${msgId} from Telegram:`, delErr);
          }
        }
      }
    } catch (cleanupErr) {
      console.warn("[DeletePost] Error while cleaning up Telegram messages:", cleanupErr);
    }
  }

  // Clean up single media file safely (only if not referenced elsewhere)
  if (post.mediaPath) {
    const isReferencedElsewhere = await prisma.channelPost.findFirst({
      where: {
        id: { not: postId },
        mediaPath: post.mediaPath,
      },
    });
    const isReferencedInAlbum = await prisma.postAlbumItem.findFirst({
      where: {
        filePath: post.mediaPath,
      },
    });

    if (!isReferencedElsewhere && !isReferencedInAlbum) {
      try {
        const storage = getStorageProvider();
        await storage.deleteObject(post.mediaPath);
      } catch {
        // Ignore deletion error
      }
    }
  }

  // Clean up album media files safely (only if not referenced elsewhere)
  for (const item of post.albumItems || []) {
    if (item.filePath) {
      const isReferencedInPost = await prisma.channelPost.findFirst({
        where: { mediaPath: item.filePath },
      });
      const isReferencedInOtherAlbum = await prisma.postAlbumItem.findFirst({
        where: {
          postId: { not: postId },
          filePath: item.filePath,
        },
      });

      if (!isReferencedInPost && !isReferencedInOtherAlbum) {
        try {
          const storage = getStorageProvider();
          await storage.deleteObject(item.filePath);
        } catch {
          // Ignore deletion error
        }
      }
    }
  }

  await prisma.channelPost.delete({
    where: { id: postId },
  });

  return { success: true };
}

/**
 * Publishes a channel post to Telegram.
 * Enforces atomic state claiming to prevent concurrent/double-click duplicate sending.
 * Never auto-retries an UNKNOWN result.
 */
export async function publishChannelPost(
  postId: string,
  botId: string,
  adminUserId?: string,
  customApi?: any,
  options?: { isWorkerClaimed?: boolean }
): Promise<PublishResult> {
  // 1. Concurrency Guard: Atomically claim the post for publishing
  if (!options?.isWorkerClaimed) {
    const claimResult = await prisma.channelPost.updateMany({
      where: {
        id: postId,
        botId,
        status: { in: ["DRAFT", "SCHEDULED", "FAILED", "UNKNOWN"] },
      },
      data: {
        status: "SENDING",
        updatedAt: new Date(),
      },
    });

    if (claimResult.count === 0) {
      throw new Error(
        "Post cannot be published: it is already in 'SENDING' status, already 'PUBLISHED', or does not exist."
      );
    }
  }

  // 2. Fetch the claimed post with channel details and album items
  const post = await prisma.channelPost.findUnique({
    where: { id: postId },
    include: {
      channel: true,
      bot: true,
      albumItems: {
        orderBy: { order: "asc" },
      },
    },
  });

  if (!post || !post.channel) {
    await prisma.channelPost.update({
      where: { id: postId },
      data: { status: "FAILED", lastError: "Target channel no longer exists." },
    });
    return { success: false, status: "FAILED", error: "Target channel missing." };
  }

  // 3. Resolve Telegram API instance
  let api: any = customApi;
  if (!api) {
    try {
      const { token } = await resolveBotToken(botId);
      api = createTelegramApi(token);
    } catch (tokenErr: any) {
      await prisma.channelPost.update({
        where: { id: postId },
        data: {
          status: "FAILED",
          lastError: `Bot token error: ${tokenErr.message}`,
        },
      });
      return {
        success: false,
        status: "FAILED",
        error: tokenErr.message,
      };
    }
  }

  // 4. Build inline keyboard
  let replyMarkup: InlineKeyboard | undefined = undefined;
  if (post.buttonsConfig && Array.isArray(post.buttonsConfig)) {
    const rawButtons = post.buttonsConfig as any[];
    if (rawButtons.length > 0) {
      replyMarkup = new InlineKeyboard();
      for (const b of rawButtons) {
        if (b.label && b.url) {
          replyMarkup.url(b.label, b.url).row();
        }
      }
    }
  }

  const targetChatId = post.channel.telegramChatId;
  let sentMessageId: number | undefined;
  let albumMessageIds: number[] | undefined;
  let buttonMessageId: number | undefined;

  // 5. Send message via Telegram Bot API
  try {
    if (post.postType === "TEXT") {
      const res = await api.sendMessage(targetChatId, post.content, {
        reply_markup: replyMarkup,
        disable_notification: post.disableNotification,
      });
      sentMessageId = res.message_id;
    } else if (post.postType === "IMAGE") {
      if (!post.mediaPath) {
        throw new Error("Missing media file path for image post.");
      }
      const inputFile = await resolveMediaInputFile(
        post.mediaPath,
        post.mediaOriginalName
      );

      const res = await api.sendPhoto(
        targetChatId,
        inputFile,
        {
          caption: post.content || undefined,
          reply_markup: replyMarkup,
          disable_notification: post.disableNotification,
          has_spoiler: post.hasSpoiler,
        }
      );
      sentMessageId = res.message_id;
    } else if (post.postType === "VIDEO") {
      if (!post.mediaPath) {
        throw new Error("Missing media file path for video post.");
      }
      const inputFile = await resolveMediaInputFile(
        post.mediaPath,
        post.mediaOriginalName
      );

      if (post.sendAsDocument) {
        // Send video file as uncompressed document
        const res = await api.sendDocument(
          targetChatId,
          inputFile,
          {
            caption: post.content || undefined,
            reply_markup: replyMarkup,
            disable_notification: post.disableNotification,
          }
        );
        sentMessageId = res.message_id;
      } else {
        // Send as regular Telegram video with streaming support
        const res = await api.sendVideo(
          targetChatId,
          inputFile,
          {
            caption: post.content || undefined,
            reply_markup: replyMarkup,
            disable_notification: post.disableNotification,
            has_spoiler: post.hasSpoiler,
            supports_streaming: true,
          }
        );
        sentMessageId = res.message_id;
      }
    } else if (post.postType === "ALBUM") {
      const albumItems = (post.albumItems || []).sort(
        (a, b) => a.order - b.order
      );
      if (albumItems.length < 2) {
        throw new Error("Cannot publish album: requires at least 2 media items.");
      }
      if (albumItems.length > 10) {
        throw new Error("Cannot publish album: exceeds maximum of 10 media items.");
      }

      // Build media group array for grammY sendMediaGroup
      // Note: caption is attached to the first item (index 0) after reordering
      const mediaGroup = await Promise.all(
        albumItems.map(async (item, index) => {
          const inputFile = await resolveMediaInputFile(
            item.filePath,
            item.originalName
          );

          if (item.mediaType === "IMAGE") {
            return {
              type: "photo" as const,
              media: inputFile,
              caption: index === 0 ? post.content || undefined : undefined,
              has_spoiler: Boolean(item.hasSpoiler),
            };
          } else {
            return {
              type: "video" as const,
              media: inputFile,
              caption: index === 0 ? post.content || undefined : undefined,
              has_spoiler: Boolean(item.hasSpoiler),
              supports_streaming: true,
            };
          }
        })
      );

      // 1. Dispatch album via sendMediaGroup
      // Note: sendMediaGroup does NOT accept reply_markup!
      const albumRes = await api.sendMediaGroup(targetChatId, mediaGroup, {
        disable_notification: post.disableNotification,
      });

      // sendMediaGroup returns an array of Message objects
      const rawAlbumIds: number[] = Array.isArray(albumRes)
        ? albumRes.map((m: any) => m.message_id)
        : [(albumRes as any).message_id || 0];

      albumMessageIds = rawAlbumIds;
      sentMessageId = rawAlbumIds[0];

      // 2. If inline URL buttons are configured, dispatch separate follow-up message
      let buttonDispatchError: string | null = null;
      if (replyMarkup) {
        try {
          const btnRes = await api.sendMessage(
            targetChatId,
            "🔗 Links & Actions",
            {
              reply_markup: replyMarkup,
              disable_notification: post.disableNotification,
              reply_parameters: { message_id: sentMessageId },
            }
          );
          buttonMessageId = btnRes.message_id;
        } catch (btnErr: any) {
          buttonDispatchError =
            btnErr.message || "Failed to deliver follow-up inline buttons.";
        }
      }

      // 3. Handle partial success if album is live but buttons failed
      if (buttonDispatchError) {
        await prisma.channelPost.update({
          where: { id: postId },
          data: {
            status: "PARTIAL",
            telegramMessageId: sentMessageId,
            albumMessageIds: albumMessageIds as any,
            buttonMessageId: null,
            sentAt: new Date(),
            claimWorkerId: null,
            claimLeaseExpiresAt: null,
            lastError: `Album published (${albumMessageIds.length} items, Primary Msg #${sentMessageId}), but follow-up buttons failed: ${buttonDispatchError}`,
          },
        });

        return {
          success: false,
          status: "PARTIAL",
          messageId: sentMessageId,
          albumMessageIds,
          error: buttonDispatchError,
        };
      }
    } else {
      throw new Error(`Unsupported post type: ${post.postType}`);
    }

    // 6. Confirmed Full Success -> Update to PUBLISHED
    await prisma.channelPost.update({
      where: { id: postId },
      data: {
        status: "PUBLISHED",
        telegramMessageId: sentMessageId,
        albumMessageIds: albumMessageIds ? (albumMessageIds as any) : undefined,
        buttonMessageId: buttonMessageId || null,
        sentAt: new Date(),
        claimWorkerId: null,
        claimLeaseExpiresAt: null,
        lastError: null,
      },
    });

    // 7. Audit log (Never log private tokens or invite links)
    let validAdminUserId: string | null = null;
    if (adminUserId) {
      const adminExists = await prisma.adminUser.findUnique({
        where: { id: adminUserId },
        select: { id: true },
      });
      if (adminExists) validAdminUserId = adminExists.id;
    }

    await prisma.auditLog.create({
      data: {
        botId,
        adminUserId: validAdminUserId,
        action: "PUBLISH_CHANNEL_POST",
        details: {
          postId,
          channelId: post.channelId,
          telegramChatId: targetChatId,
          messageId: sentMessageId,
          albumMessageIds,
          buttonMessageId,
          postType: post.postType,
        },
      },
    });

    return {
      success: true,
      status: "PUBLISHED",
      messageId: sentMessageId,
      albumMessageIds,
      buttonMessageId,
    };
  } catch (err: any) {
    const errorStr = String(err?.message || err || "Unknown Telegram publishing error");
    const lower = errorStr.toLowerCase();

    // Distinguish between definitive Telegram rejections vs Network/Timeout errors
    const isTimeoutOrNetworkError =
      lower.includes("timeout") ||
      lower.includes("etimedout") ||
      lower.includes("econnreset") ||
      lower.includes("socket hang up") ||
      lower.includes("network error");

    if (isTimeoutOrNetworkError) {
      // Possible delivery: mark UNKNOWN and DO NOT auto-retry!
      const unknownMsg =
        "Network connection timed out while waiting for Telegram response. The post may have been received by Telegram. Please check the channel manually before retrying.";

      await prisma.channelPost.update({
        where: { id: postId },
        data: {
          status: "UNKNOWN",
          claimWorkerId: null,
          claimLeaseExpiresAt: null,
          lastError: unknownMsg,
        },
      });

      return {
        success: false,
        status: "UNKNOWN",
        error: unknownMsg,
      };
    }

    // Definitive API failure (e.g. 400 Bad Request, 403 Forbidden)
    const sanitizedError = redactTokens(errorStr);

    await prisma.channelPost.update({
      where: { id: postId },
      data: {
        status: "FAILED",
        claimWorkerId: null,
        claimLeaseExpiresAt: null,
        lastError: sanitizedError,
      },
    });

    return {
      success: false,
      status: "FAILED",
      error: sanitizedError,
    };
  }
}

/**
 * Safely recovers a post in PARTIAL status by delivering ONLY the follow-up inline buttons,
 * without re-dispatching the album or creating duplicate messages.
 */
export async function publishAlbumButtonsOnly(
  postId: string,
  botId: string,
  adminUserId?: string,
  customApi?: any
): Promise<PublishResult> {
  const post = await prisma.channelPost.findUnique({
    where: { id: postId },
    include: { channel: true, bot: true },
  });

  if (!post || post.botId !== botId) {
    throw new Error(`Post with ID "${postId}" was not found.`);
  }

  if (post.status !== "PARTIAL") {
    throw new Error(
      `Cannot retry buttons on a post with status "${post.status}". Only PARTIAL posts can use button recovery.`
    );
  }

  if (!post.telegramMessageId) {
    throw new Error("Cannot send follow-up buttons: Missing album primary message ID.");
  }

  let replyMarkup: InlineKeyboard | undefined = undefined;
  if (post.buttonsConfig && Array.isArray(post.buttonsConfig)) {
    const rawButtons = post.buttonsConfig as any[];
    if (rawButtons.length > 0) {
      replyMarkup = new InlineKeyboard();
      for (const b of rawButtons) {
        if (b.label && b.url) {
          replyMarkup.url(b.label, b.url).row();
        }
      }
    }
  }

  if (!replyMarkup) {
    throw new Error("No inline buttons configured to deliver.");
  }

  let api: any = customApi;
  if (!api) {
    const { token } = await resolveBotToken(botId);
    api = createTelegramApi(token);
  }

  const targetChatId = post.channel.telegramChatId;
  const btnRes = await api.sendMessage(
    targetChatId,
    "🔗 Links & Actions",
    {
      reply_markup: replyMarkup,
      disable_notification: post.disableNotification,
      reply_parameters: { message_id: post.telegramMessageId },
    }
  );

  const buttonMessageId = btnRes.message_id;

  await prisma.channelPost.update({
    where: { id: postId },
    data: {
      status: "PUBLISHED",
      buttonMessageId,
      lastError: null,
    },
  });

  return {
    success: true,
    status: "PUBLISHED",
    messageId: post.telegramMessageId,
    albumMessageIds: (post.albumMessageIds as any) || [post.telegramMessageId],
    buttonMessageId,
  };
}

/**
 * Schedules an existing post draft for publication at a future date and time.
 */
export async function schedulePost(options: SchedulePostInput) {
  const { postId, botId, dateStr, timeStr, timeZone, adminUserId } = options;

  const post = await prisma.channelPost.findUnique({
    where: { id: postId },
    include: { channel: true, albumItems: true },
  });

  if (!post || post.botId !== botId) {
    throw new Error(`Post with ID "${postId}" was not found.`);
  }

  if (post.status === "SENDING") {
    throw new Error("Cannot schedule a post that is currently in-flight or being published.");
  }

  if (post.status === "PUBLISHED") {
    throw new Error("This post has already been published to the channel.");
  }

  // Validate date, time, timezone, existence, and future constraint
  const parsed = validateAndParseZonedDateTime(dateStr, timeStr, timeZone);
  validateFutureSchedule(parsed.utcDate);

  // Pre-schedule media validation
  if (post.postType === "ALBUM") {
    if (!post.albumItems || post.albumItems.length < 2) {
      throw new Error("Cannot schedule album post: requires at least 2 media items.");
    }
  } else if (post.postType === "IMAGE" || post.postType === "VIDEO") {
    if (!post.mediaPath) {
      throw new Error(`Cannot schedule ${post.postType.toLowerCase()} post: missing media file.`);
    }
  }

  const updated = await prisma.channelPost.update({
    where: { id: postId },
    data: {
      status: "SCHEDULED",
      scheduledAt: parsed.utcDate,
      scheduledTimezone: parsed.timeZone,
      scheduledByUserId: adminUserId || null,
      claimLeaseExpiresAt: null,
      claimWorkerId: null,
      retryCount: 0,
      lastError: null,
    },
    include: {
      channel: { select: { id: true, name: true, telegramChatId: true } },
      albumItems: { orderBy: { order: "asc" } },
    },
  });

  // Audit log
  let validAdminUserId: string | null = null;
  if (adminUserId) {
    const adminExists = await prisma.adminUser.findUnique({
      where: { id: adminUserId },
      select: { id: true },
    });
    if (adminExists) validAdminUserId = adminExists.id;
  }

  await prisma.auditLog.create({
    data: {
      botId,
      adminUserId: validAdminUserId,
      action: "SCHEDULE_CHANNEL_POST",
      details: {
        postId,
        channelId: post.channelId,
        scheduledAt: parsed.isoUtc,
        scheduledTimezone: parsed.timeZone,
        formattedLocal: parsed.formattedLocal,
        postType: post.postType,
      },
    },
  });

  return updated;
}

/**
 * Reschedules a post to a new future date, time, or timezone.
 */
export async function reschedulePost(options: SchedulePostInput) {
  return schedulePost(options);
}

/**
 * Cancels a scheduled post and reverts it safely to DRAFT status without deleting it.
 */
export async function cancelScheduledPost(postId: string, botId: string, adminUserId?: string) {
  const post = await prisma.channelPost.findUnique({
    where: { id: postId },
  });

  if (!post || post.botId !== botId) {
    throw new Error(`Post with ID "${postId}" was not found.`);
  }

  if (post.status === "SENDING") {
    throw new Error("Cannot cancel a post that is currently in-flight or being published by the scheduler.");
  }

  if (post.status !== "SCHEDULED") {
    throw new Error(`Only SCHEDULED posts can be cancelled. Current status is "${post.status}".`);
  }

  const updated = await prisma.channelPost.update({
    where: { id: postId },
    data: {
      status: "DRAFT",
      scheduledAt: null,
      scheduledTimezone: null,
      claimLeaseExpiresAt: null,
      claimWorkerId: null,
      lastError: null,
    },
    include: {
      channel: { select: { id: true, name: true, telegramChatId: true } },
      albumItems: { orderBy: { order: "asc" } },
    },
  });

  let validAdminUserId: string | null = null;
  if (adminUserId) {
    const adminExists = await prisma.adminUser.findUnique({
      where: { id: adminUserId },
      select: { id: true },
    });
    if (adminExists) validAdminUserId = adminExists.id;
  }

  await prisma.auditLog.create({
    data: {
      botId,
      adminUserId: validAdminUserId,
      action: "CANCEL_SCHEDULED_CHANNEL_POST",
      details: {
        postId,
        channelId: post.channelId,
        previousScheduledAt: post.scheduledAt?.toISOString() || null,
      },
    },
  });

  return updated;
}

/**
 * Recovers stalled scheduled posts whose worker lease has expired.
 * Ensures crash resilience if a worker process dies while in SENDING status.
 */
export async function recoverStalledScheduledPosts(options?: {
  maxRetries?: number;
}): Promise<{ recoveredCount: number; failedCount: number }> {
  const now = new Date();
  const maxRetries = options?.maxRetries ?? 3;

  const stalled = await prisma.channelPost.findMany({
    where: {
      status: "SENDING",
      claimLeaseExpiresAt: { lte: now },
    },
  });

  let recoveredCount = 0;
  let failedCount = 0;

  for (const job of stalled) {
    // If telegramMessageId or albumMessageIds exists, the message was already accepted by Telegram!
    if (
      job.telegramMessageId ||
      (job.albumMessageIds && (job.albumMessageIds as any).length > 0)
    ) {
      const finalStatus =
        job.buttonsConfig && !job.buttonMessageId ? "PARTIAL" : "PUBLISHED";
      await prisma.channelPost.update({
        where: { id: job.id },
        data: {
          status: finalStatus,
          claimWorkerId: null,
          claimLeaseExpiresAt: null,
          lastError:
            finalStatus === "PARTIAL"
              ? "Recovered post: Album was sent but follow-up buttons failed."
              : null,
        },
      });
      recoveredCount++;
    } else if (job.retryCount >= maxRetries) {
      // Reached maximum crash recovery attempts
      await prisma.channelPost.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          lastError: `Scheduled post dispatch failed: Worker lease expired after ${maxRetries} retry attempts without Telegram confirmation.`,
          claimWorkerId: null,
          claimLeaseExpiresAt: null,
        },
      });
      failedCount++;
    } else {
      // Safe to recover back to SCHEDULED for retry
      await prisma.channelPost.update({
        where: { id: job.id },
        data: {
          status: "SCHEDULED",
          retryCount: { increment: 1 },
          lastError: "Worker lease expired. Reclaimed for scheduled retry.",
          claimWorkerId: null,
          claimLeaseExpiresAt: null,
        },
      });
      recoveredCount++;
    }
  }

  return { recoveredCount, failedCount };
}

/**
 * Atomically claims due scheduled posts for the calling worker.
 * Prevents concurrent workers from claiming or dispatching the same post simultaneously.
 */
export async function claimDueScheduledPosts(options: {
  workerId: string;
  batchSize?: number;
  leaseDurationMs?: number;
}): Promise<string[]> {
  const now = new Date();
  const batchSize = options.batchSize ?? 10;
  const leaseDurationMs = options.leaseDurationMs ?? 120000; // 2 minutes lease
  const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs);

  const candidates = await prisma.channelPost.findMany({
    where: {
      status: "SCHEDULED",
      scheduledAt: { lte: now },
    },
    take: batchSize,
    orderBy: { scheduledAt: "asc" },
    select: { id: true },
  });

  const claimedPostIds: string[] = [];

  for (const candidate of candidates) {
    const res = await prisma.channelPost.updateMany({
      where: {
        id: candidate.id,
        status: "SCHEDULED",
        scheduledAt: { lte: now },
      },
      data: {
        status: "SENDING",
        claimWorkerId: options.workerId,
        claimLeaseExpiresAt: leaseExpiresAt,
        updatedAt: now,
      },
    });

    if (res.count === 1) {
      claimedPostIds.push(candidate.id);
    }
  }

  return claimedPostIds;
}

/**
 * Executes a claimed scheduled post: performs pre-dispatch validation and dispatches via publishChannelPost.
 */
export async function executeClaimedScheduledPost(
  postId: string,
  workerId: string,
  customApi?: any
): Promise<PublishResult> {
  const post = await prisma.channelPost.findUnique({
    where: { id: postId },
    include: { bot: true, channel: true, albumItems: true },
  });

  if (!post) {
    return { success: false, status: "FAILED", error: "Post record missing." };
  }

  // 1. Verify Bot is active
  if (!post.bot || !post.bot.isActive) {
    const errorMsg = `Scheduled post dispatch cancelled: Bot "${post.bot?.name || post.botId}" is disabled or inactive.`;
    await prisma.channelPost.update({
      where: { id: postId },
      data: { status: "FAILED", lastError: errorMsg, claimWorkerId: null, claimLeaseExpiresAt: null },
    });
    return { success: false, status: "FAILED", error: errorMsg };
  }

  // 2. Verify Channel is assigned and enabled
  if (!post.channel || post.channel.isEnabled === false) {
    const errorMsg = `Scheduled post dispatch cancelled: Target channel "${post.channel?.name || post.channelId}" is disabled or no longer assigned.`;
    await prisma.channelPost.update({
      where: { id: postId },
      data: { status: "FAILED", lastError: errorMsg, claimWorkerId: null, claimLeaseExpiresAt: null },
    });
    return { success: false, status: "FAILED", error: errorMsg };
  }

  // 3. Verify media accessibility before dispatch
  const storage = getStorageProvider();
  if (post.postType === "IMAGE" || post.postType === "VIDEO") {
    if (!post.mediaPath || !(await storage.exists(post.mediaPath))) {
      const errorMsg = `Scheduled post dispatch failed: Attached media file "${post.mediaPath}" not found in storage.`;
      await prisma.channelPost.update({
        where: { id: postId },
        data: { status: "FAILED", lastError: errorMsg, claimWorkerId: null, claimLeaseExpiresAt: null },
      });
      return { success: false, status: "FAILED", error: errorMsg };
    }
  } else if (post.postType === "ALBUM") {
    for (const item of post.albumItems || []) {
      if (!item.filePath || !(await storage.exists(item.filePath))) {
        const errorMsg = `Scheduled post dispatch failed: Album media file "${item.filePath}" not found in storage.`;
        await prisma.channelPost.update({
          where: { id: postId },
          data: { status: "FAILED", lastError: errorMsg, claimWorkerId: null, claimLeaseExpiresAt: null },
        });
        return { success: false, status: "FAILED", error: errorMsg };
      }
    }
  }

  // Dispatch via publishChannelPost with worker claimed flag
  return publishChannelPost(
    postId,
    post.botId,
    post.scheduledByUserId || undefined,
    customApi,
    { isWorkerClaimed: true }
  );
}
