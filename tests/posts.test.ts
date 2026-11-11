import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import path from "path";
import fs from "fs";
import { prisma } from "../src/lib/prisma";
import {
  validatePostContent,
  validateInlineUrlButtons,
  validateImageUpload,
  validatePostOptions,
  validateMediaUpload,
  validateAlbumItems,
  createDraftPost,
  updateDraftPost,
  deletePost,
  getChannelPosts,
  publishChannelPost,
  publishAlbumButtonsOnly,
  checkBotChannelPermissions,
  resolveBotToken,
  UPLOADS_POSTS_DIR,
} from "../src/lib/post-service";
import { encryptBotToken } from "../src/lib/token-encryption";
import { createTelegramApi } from "../src/lib/telegram-client";
import {
  GET as channelPostsGET,
  POST as channelPostsPOST,
} from "../src/app/api/bots/[id]/channels/[channelId]/posts/route";
import {
  PUT as postPUT,
} from "../src/app/api/posts/[id]/route";
import {
  POST as publishPOST,
} from "../src/app/api/posts/[id]/publish/route";
import {
  POST as uploadPOST,
} from "../src/app/api/posts/upload/route";
import {
  GET as mediaGET,
} from "../src/app/api/media/posts/[filename]/route";
import { NextRequest } from "next/server";
import { createSessionToken, COOKIE_NAME } from "../src/lib/auth";

describe("Channel Post Manager & Publishing Engine", () => {
  const testBotAId = "99999999-post-1111-1111-111111111111";
  const testBotBId = "99999999-post-2222-2222-222222222222";
  const testChannelAId = "88888888-chan-aaaa-aaaa-aaaaaaaaaaaa";
  const testChannelBId = "88888888-chan-bbbb-bbbb-bbbbbbbbbbbb";
  const testImagePath = path.join(UPLOADS_POSTS_DIR, "test-fixture-image.jpg");
  const testVideoPath = path.join(UPLOADS_POSTS_DIR, "test-fixture-video.mp4");

  beforeAll(async () => {
    // 1. Setup isolated test bots and channels in PostgreSQL
    await prisma.bot.upsert({
      where: { id: testBotAId },
      create: {
        id: testBotAId,
        name: "Test Posts Bot A",
        username: "test_posts_bot_a",
      },
      update: {},
    });

    await prisma.bot.upsert({
      where: { id: testBotBId },
      create: {
        id: testBotBId,
        name: "Test Posts Bot B",
        username: "test_posts_bot_b",
      },
      update: {},
    });

    await prisma.botChannel.upsert({
      where: { id: testChannelAId },
      create: {
        id: testChannelAId,
        botId: testBotAId,
        name: "Bot A Channel",
        telegramChatId: "@bot_a_channel",
        inviteLink: "https://t.me/bot_a_channel",
        buttonLabel: "Join A",
        isRequired: true,
        isEnabled: true,
        order: 0,
      },
      update: {},
    });

    await prisma.botChannel.upsert({
      where: { id: testChannelBId },
      create: {
        id: testChannelBId,
        botId: testBotBId,
        name: "Bot B Channel",
        telegramChatId: "@bot_b_channel",
        inviteLink: "https://t.me/bot_b_channel",
        buttonLabel: "Join B",
        isRequired: true,
        isEnabled: true,
        order: 0,
      },
      update: {},
    });

    // Create uploads directory and dummy test media fixtures
    if (!fs.existsSync(UPLOADS_POSTS_DIR)) {
      fs.mkdirSync(UPLOADS_POSTS_DIR, { recursive: true });
    }
    // JPEG magic bytes: FF D8 FF E0
    fs.writeFileSync(
      testImagePath,
      Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])
    );
    // MP4 box header: 00 00 00 18 'ftyp' 'mp42'
    fs.writeFileSync(
      testVideoPath,
      Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32])
    );
  });

  beforeEach(() => {
    if (!fs.existsSync(UPLOADS_POSTS_DIR)) {
      fs.mkdirSync(UPLOADS_POSTS_DIR, { recursive: true });
    }
    if (!fs.existsSync(testImagePath)) {
      fs.writeFileSync(
        testImagePath,
        Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])
      );
    }
    if (!fs.existsSync(testVideoPath)) {
      fs.writeFileSync(
        testVideoPath,
        Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32])
      );
    }
  });

  afterAll(async () => {
    // Clean up isolated test bot records and fixtures
    const testBotIds = [testBotAId, testBotBId];
    await prisma.channelPost.deleteMany({ where: { botId: { in: testBotIds } } });
    await prisma.botChannel.deleteMany({ where: { botId: { in: testBotIds } } });
    await prisma.auditLog.deleteMany({ where: { botId: { in: testBotIds } } });
    await prisma.bot.deleteMany({ where: { id: { in: testBotIds } } });

    if (fs.existsSync(testImagePath)) {
      try {
        fs.unlinkSync(testImagePath);
      } catch {
        // Ignore
      }
    }
    if (fs.existsSync(testVideoPath)) {
      try {
        fs.unlinkSync(testVideoPath);
      } catch {
        // Ignore
      }
    }
    await prisma.$disconnect();
  });

  describe("Validation Logic", () => {
    it("validates text content within Telegram limits", () => {
      expect(validatePostContent("TEXT", "Hello Telegram Channel!")).toBe("Hello Telegram Channel!");
      expect(() => validatePostContent("TEXT", "")).toThrow("Post text content is required");
      expect(() => validatePostContent("TEXT", "   ")).toThrow("Post text content is required");
      expect(() => validatePostContent("TEXT", "a".repeat(4097))).toThrow("exceeds Telegram limit of 4096");
    });

    it("validates image caption limits", () => {
      expect(validatePostContent("IMAGE", "Photo Caption")).toBe("Photo Caption");
      expect(validatePostContent("IMAGE", "")).toBe("");
      expect(() => validatePostContent("IMAGE", "a".repeat(1025))).toThrow("exceeds Telegram limit of 1024");
    });

    it("validates video caption limits", () => {
      expect(validatePostContent("VIDEO", "Video Caption")).toBe("Video Caption");
      expect(validatePostContent("VIDEO", "")).toBe("");
      expect(() => validatePostContent("VIDEO", "a".repeat(1025))).toThrow("exceeds Telegram limit of 1024");
    });

    it("validates delivery options combinations for post types", () => {
      // Valid combinations
      expect(
        validatePostOptions("VIDEO", {
          disableNotification: true,
          hasSpoiler: true,
          sendAsDocument: false,
        })
      ).toEqual({
        disableNotification: true,
        hasSpoiler: true,
        sendAsDocument: false,
      });

      expect(
        validatePostOptions("VIDEO", {
          disableNotification: true,
          sendAsDocument: true,
        })
      ).toEqual({
        disableNotification: true,
        hasSpoiler: false,
        sendAsDocument: true,
      });

      expect(
        validatePostOptions("IMAGE", {
          disableNotification: true,
          hasSpoiler: true,
        })
      ).toEqual({
        disableNotification: true,
        hasSpoiler: true,
        sendAsDocument: false,
      });

      expect(
        validatePostOptions("TEXT", {
          disableNotification: true,
        })
      ).toEqual({
        disableNotification: true,
        hasSpoiler: false,
        sendAsDocument: false,
      });

      // Invalid combinations rejected
      expect(() =>
        validatePostOptions("TEXT", { sendAsDocument: true })
      ).toThrow("Cannot send a text-only message as a document");
      expect(() =>
        validatePostOptions("TEXT", { hasSpoiler: true })
      ).toThrow("Telegram does not support the media spoiler parameter for text-only messages");
      expect(() =>
        validatePostOptions("VIDEO", { sendAsDocument: true, hasSpoiler: true })
      ).toThrow("Telegram does not support media spoiler animation when sending files as documents");
    });

    it("validates video and image uploads with MIME, size, and magic byte detection", () => {
      // Valid video MP4 with ftyp header
      const mp4Header = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]);
      const mp4Res = validateMediaUpload("video/mp4", 10 * 1024 * 1024, "clip.mp4", mp4Header);
      expect(mp4Res.mediaType).toBe("VIDEO");
      expect(mp4Res.extension).toBe(".mp4");

      // Valid WebM with EBML ID
      const webmHeader = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
      const webmRes = validateMediaUpload("video/webm", 5 * 1024 * 1024, "video.webm", webmHeader);
      expect(webmRes.mediaType).toBe("VIDEO");
      expect(webmRes.extension).toBe(".webm");

      // Valid JPEG with SOI
      const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
      const jpegRes = validateMediaUpload("image/jpeg", 2 * 1024 * 1024, "photo.jpg", jpegHeader);
      expect(jpegRes.mediaType).toBe("IMAGE");
      expect(jpegRes.extension).toBe(".jpg");

      // Valid PNG with signature
      const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      const pngRes = validateMediaUpload("image/png", 3 * 1024 * 1024, "image.png", pngHeader);
      expect(pngRes.mediaType).toBe("IMAGE");
      expect(pngRes.extension).toBe(".png");

      // Reject path traversal in originalName
      expect(() => validateMediaUpload("video/mp4", 1000, "../../../etc/passwd.mp4")).toThrow("path traversal");
      expect(() => validateMediaUpload("video/mp4", 1000, "C:\\windows\\win.ini")).toThrow("path traversal");

      // Reject unsupported MIME
      expect(() => validateMediaUpload("application/zip", 1000, "archive.zip")).toThrow("Unsupported media MIME type");

      // Reject mismatched extension
      expect(() => validateMediaUpload("video/mp4", 1000, "movie.avi")).toThrow("does not match video MIME type");

      // Reject oversized video (> 25 MB)
      expect(() => validateMediaUpload("video/mp4", 26 * 1024 * 1024, "huge.mp4")).toThrow("exceeds the local test limit of 25 MB");

      // Reject oversized image (> 10 MB)
      expect(() => validateMediaUpload("image/jpeg", 11 * 1024 * 1024, "huge.jpg")).toThrow("exceeds the maximum limit of 10 MB");

      // Reject corrupt/mismatched magic bytes
      expect(() => validateMediaUpload("video/mp4", 1000, "corrupt.mp4", Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]))).toThrow("MP4/MOV header box mismatch");
      expect(() => validateMediaUpload("image/jpeg", 1000, "fake.jpg", Buffer.from([0x00, 0x00, 0x00, 0x00]))).toThrow("JPEG header signature mismatch");
    });

    it("validates inline URL buttons and rejects unsafe schemes", () => {
      const valid = [
        { label: "Website", url: "https://example.com/news", order: 1 },
        { label: "Community", url: "tg://resolve?domain=mychannel", order: 0 },
      ];
      const res = validateInlineUrlButtons(valid);
      expect(res).toHaveLength(2);
      expect(res[0].label).toBe("Community"); // Sorted by order
      expect(res[1].label).toBe("Website");

      expect(() => validateInlineUrlButtons([{ label: "", url: "https://example.com", order: 0 }])).toThrow("must have a non-empty label");
      expect(() => validateInlineUrlButtons([{ label: "A".repeat(65), url: "https://example.com", order: 0 }])).toThrow("exceeds the maximum length of 64 characters");
      expect(() => validateInlineUrlButtons([{ label: "Bad", url: "javascript:alert(1)", order: 0 }])).toThrow("must be a secure HTTPS link or Telegram link");
      expect(() => validateInlineUrlButtons([{ label: "Bad", url: "data:text/html,bad", order: 0 }])).toThrow("must be a secure HTTPS link or Telegram link");
    });

    it("validates image upload file types and size limits", () => {
      expect(() => validateImageUpload("image/jpeg", 1024 * 1024)).not.toThrow();
      expect(() => validateImageUpload("image/png", 2 * 1024 * 1024)).not.toThrow();
      expect(() => validateImageUpload("image/webp", 500 * 1024)).not.toThrow();

      expect(() => validateImageUpload("application/pdf", 1000)).toThrow("Unsupported image type");
      expect(() => validateImageUpload("image/gif", 1000)).toThrow("Unsupported image type");
      expect(() => validateImageUpload("image/png", 11 * 1024 * 1024)).toThrow("exceeds the limit of 10 MB");
    });

    it("validates album items bounds, file existence, and ordering", () => {
      // Rejects empty / non-array
      expect(() => validateAlbumItems(undefined as any)).toThrow("An album requires a list of media items.");
      expect(() => validateAlbumItems([])).toThrow("An album must contain at least 2 media items");

      // Rejects 1 item (minimum 2)
      expect(() =>
        validateAlbumItems([
          { mediaType: "IMAGE", filePath: testImagePath, order: 0 },
        ])
      ).toThrow("An album must contain at least 2 media items");

      // Rejects > 10 items
      const eleven = Array.from({ length: 11 }, (_, i) => ({
        mediaType: "IMAGE" as const,
        filePath: testImagePath,
        order: i,
      }));
      expect(() => validateAlbumItems(eleven)).toThrow("An album cannot exceed 10 media items");

      // Rejects non-existent file on disk
      expect(() =>
        validateAlbumItems([
          { mediaType: "IMAGE", filePath: testImagePath, order: 0 },
          { mediaType: "IMAGE", filePath: "non-existent-file-12345.jpg", order: 1 },
        ])
      ).toThrow("file not found on local storage");

      // Validates and normalizes ordering
      const normalized = validateAlbumItems([
        { mediaType: "VIDEO", filePath: testVideoPath, order: 10, hasSpoiler: true },
        { mediaType: "IMAGE", filePath: testImagePath, order: 2, hasSpoiler: false },
      ]);
      expect(normalized).toHaveLength(2);
      expect(normalized[0].mediaType).toBe("IMAGE");
      expect(normalized[0].order).toBe(0);
      expect(normalized[1].mediaType).toBe("VIDEO");
      expect(normalized[1].order).toBe(1);
      expect(normalized[1].hasSpoiler).toBe(true);
    });
  });

  describe("Draft Creation & Bot Scoping", () => {
    it("creates a draft text post with inline buttons scoped to bot and channel", async () => {
      const post = await createDraftPost({
        botId: testBotAId,
        channelId: testChannelAId,
        postType: "TEXT",
        content: "Announcing our new feature!",
        buttons: [{ label: "Read More", url: "https://example.com/feature", order: 0 }],
      });

      expect(post.id).toBeDefined();
      expect(post.botId).toBe(testBotAId);
      expect(post.channelId).toBe(testChannelAId);
      expect(post.status).toBe("DRAFT");
      expect(post.content).toBe("Announcing our new feature!");
      expect(post.buttonsConfig).toHaveLength(1);

      // Verify in database
      const fetched = await getChannelPosts(testBotAId, testChannelAId);
      expect(fetched.some((p) => p.id === post.id)).toBe(true);

      // Verify Bot B cannot see Bot A's post
      const botBPosts = await getChannelPosts(testBotBId);
      expect(botBPosts.some((p) => p.id === post.id)).toBe(false);
    });

    it("rejects creating a post for Bot A targeting Bot B's channel", async () => {
      await expect(
        createDraftPost({
          botId: testBotAId,
          channelId: testChannelBId, // Channel belongs to Bot B
          postType: "TEXT",
          content: "Cross-bot attempt",
        })
      ).rejects.toThrow("does not belong to bot");
    });

    it("updates and deletes a draft post cleanly", async () => {
      const draft = await createDraftPost({
        botId: testBotAId,
        channelId: testChannelAId,
        postType: "TEXT",
        content: "Draft to be modified",
      });

      const updated = await updateDraftPost({
        id: draft.id,
        botId: testBotAId,
        channelId: testChannelAId,
        postType: "TEXT",
        content: "Draft has been updated!",
      });

      expect(updated.content).toBe("Draft has been updated!");

      // Delete draft
      const del = await deletePost(draft.id, testBotAId);
      expect(del.success).toBe(true);

      const check = await prisma.channelPost.findUnique({ where: { id: draft.id } });
      expect(check).toBeNull();
    });

    it("creates a single-image draft with local media reference", async () => {
      const draft = await createDraftPost({
        botId: testBotAId,
        channelId: testChannelAId,
        postType: "IMAGE",
        content: "Caption for test photo",
        mediaPath: "test-fixture-image.jpg",
        mediaOriginalName: "test-fixture-image.jpg",
        mediaMimeType: "image/jpeg",
        mediaSizeBytes: 26,
      });

      expect(draft.postType).toBe("IMAGE");
      expect(draft.mediaPath).toBe("test-fixture-image.jpg");
      expect(draft.content).toBe("Caption for test photo");

      await deletePost(draft.id, testBotAId);
    });

    it("creates, updates, and deletes an album post with ordered items and spoilers", async () => {
      const draft = await createDraftPost({
        botId: testBotAId,
        channelId: testChannelAId,
        postType: "ALBUM",
        content: "Album Caption Here",
        disableNotification: true,
        albumItems: [
          {
            mediaType: "IMAGE",
            filePath: testImagePath,
            originalName: "photo1.jpg",
            mimeType: "image/jpeg",
            sizeBytes: 100,
            order: 0,
            hasSpoiler: false,
          },
          {
            mediaType: "VIDEO",
            filePath: testVideoPath,
            originalName: "clip1.mp4",
            mimeType: "video/mp4",
            sizeBytes: 200,
            order: 1,
            hasSpoiler: true,
          },
        ],
      });

      expect(draft.postType).toBe("ALBUM");
      expect(draft.albumItems).toHaveLength(2);
      expect(draft.albumItems[0].mediaType).toBe("IMAGE");
      expect(draft.albumItems[0].order).toBe(0);
      expect(draft.albumItems[1].mediaType).toBe("VIDEO");
      expect(draft.albumItems[1].order).toBe(1);
      expect(draft.albumItems[1].hasSpoiler).toBe(true);

      // Reorder items and update draft
      const updated = await updateDraftPost({
        id: draft.id,
        botId: testBotAId,
        channelId: testChannelAId,
        postType: "ALBUM",
        content: "Updated Album Caption",
        albumItems: [
          {
            mediaType: "VIDEO",
            filePath: testVideoPath,
            originalName: "clip1.mp4",
            mimeType: "video/mp4",
            sizeBytes: 200,
            order: 0, // swapped to first
            hasSpoiler: false,
          },
          {
            mediaType: "IMAGE",
            filePath: testImagePath,
            originalName: "photo1.jpg",
            mimeType: "image/jpeg",
            sizeBytes: 100,
            order: 1, // swapped to second
            hasSpoiler: true,
          },
        ],
      });

      expect(updated.content).toBe("Updated Album Caption");
      expect(updated.albumItems[0].mediaType).toBe("VIDEO");
      expect(updated.albumItems[0].order).toBe(0);
      expect(updated.albumItems[1].mediaType).toBe("IMAGE");
      expect(updated.albumItems[1].order).toBe(1);

      await deletePost(draft.id, testBotAId);
      const check = await prisma.channelPost.findUnique({ where: { id: draft.id } });
      expect(check).toBeNull();
      const checkItems = await prisma.postAlbumItem.findMany({ where: { postId: draft.id } });
      expect(checkItems).toHaveLength(0);
    });
  });

  describe("Publishing Engine & Telegram Dispatch (Mocked Telegram API)", () => {
    it("publishes text post with inline buttons and records messageId", async () => {
      const post = await createDraftPost({
        botId: testBotAId,
        channelId: testChannelAId,
        postType: "TEXT",
        content: "Official Telegram announcement!",
        buttons: [{ label: "Visit Site", url: "https://example.com", order: 0 }],
      });

      let sentChatId = "";
      let sentText = "";
      let sentMarkup: any = null;

      const mockApi = {
        sendMessage: async (chatId: string, text: string, options: any) => {
          sentChatId = chatId;
          sentText = text;
          sentMarkup = options?.reply_markup;
          return { message_id: 12345 };
        },
      };

      const result = await publishChannelPost(post.id, testBotAId, undefined, mockApi);

      expect(result.success).toBe(true);
      expect(result.status).toBe("PUBLISHED");
      expect(result.messageId).toBe(12345);
      expect(sentChatId).toBe("@bot_a_channel");
      expect(sentText).toBe("Official Telegram announcement!");
      expect(sentMarkup).toBeDefined();

      const refreshed = await prisma.channelPost.findUnique({ where: { id: post.id } });
      expect(refreshed?.status).toBe("PUBLISHED");
      expect(refreshed?.telegramMessageId).toBe(12345);
      expect(refreshed?.sentAt).toBeDefined();
    });

    it("prevents duplicate concurrent publishing (Double-submission Guard)", async () => {
      const post = await createDraftPost({
        botId: testBotAId,
        channelId: testChannelAId,
        postType: "TEXT",
        content: "Concurrent test message",
      });

      // Simulate first worker claiming the post
      await prisma.channelPost.update({
        where: { id: post.id },
        data: { status: "SENDING" },
      });

      // Second publish attempt must be rejected
      const mockApi = {
        sendMessage: async () => ({ message_id: 99999 }),
      };

      await expect(
        publishChannelPost(post.id, testBotAId, undefined, mockApi)
      ).rejects.toThrow("already in 'SENDING' status, already 'PUBLISHED'");
    });

    it("records FAILED status on definitive Telegram API errors", async () => {
      const post = await createDraftPost({
        botId: testBotAId,
        channelId: testChannelAId,
        postType: "TEXT",
        content: "Failing test post",
      });

      const mockApi = {
        sendMessage: async () => {
          throw new Error("400 Bad Request: need administrator rights in the channel to post messages");
        },
      };

      const result = await publishChannelPost(post.id, testBotAId, undefined, mockApi);
      expect(result.success).toBe(false);
      expect(result.status).toBe("FAILED");
      expect(result.error).toContain("administrator rights");

      const refreshed = await prisma.channelPost.findUnique({ where: { id: post.id } });
      expect(refreshed?.status).toBe("FAILED");
      expect(refreshed?.lastError).toContain("administrator rights");
    });

    it("records UNKNOWN status on network timeout and does NOT auto-retry", async () => {
      const post = await createDraftPost({
        botId: testBotAId,
        channelId: testChannelAId,
        postType: "TEXT",
        content: "Timeout test post",
      });

      const mockApi = {
        sendMessage: async () => {
          throw new Error("ETIMEDOUT: connect timed out after dispatch");
        },
      };

      const result = await publishChannelPost(post.id, testBotAId, undefined, mockApi);
      expect(result.success).toBe(false);
      expect(result.status).toBe("UNKNOWN");
      expect(result.error).toContain("Network connection timed out");

      const refreshed = await prisma.channelPost.findUnique({ where: { id: post.id } });
      expect(refreshed?.status).toBe("UNKNOWN");
      expect(refreshed?.lastError).toContain("check the channel manually");
    });

    it("publishes video normally via sendVideo with streaming flag, spoiler, and silent delivery", async () => {
      const post = await createDraftPost({
        botId: testBotAId,
        channelId: testChannelAId,
        postType: "VIDEO",
        content: "Check out this feature video!",
        mediaPath: "test-fixture-video.mp4",
        mediaOriginalName: "test-fixture-video.mp4",
        mediaMimeType: "video/mp4",
        mediaSizeBytes: 12,
        disableNotification: true,
        hasSpoiler: true,
        sendAsDocument: false,
        buttons: [{ label: "Learn More", url: "https://example.com/video", order: 0 }],
      });

      let invokedMethod = "";
      let sentChatId = "";
      let sentOptions: any = null;

      const mockApi = {
        sendVideo: async (chatId: string, file: any, options: any) => {
          invokedMethod = "sendVideo";
          sentChatId = chatId;
          sentOptions = options;
          return { message_id: 54321 };
        },
      };

      const result = await publishChannelPost(post.id, testBotAId, undefined, mockApi);
      expect(result.success).toBe(true);
      expect(result.status).toBe("PUBLISHED");
      expect(result.messageId).toBe(54321);
      expect(invokedMethod).toBe("sendVideo");
      expect(sentChatId).toBe("@bot_a_channel");
      expect(sentOptions.caption).toBe("Check out this feature video!");
      expect(sentOptions.supports_streaming).toBe(true);
      expect(sentOptions.has_spoiler).toBe(true);
      expect(sentOptions.disable_notification).toBe(true);
      expect(sentOptions.reply_markup).toBeDefined();

      const refreshed = await prisma.channelPost.findUnique({ where: { id: post.id } });
      expect(refreshed?.status).toBe("PUBLISHED");
      expect(refreshed?.hasSpoiler).toBe(true);
      expect(refreshed?.disableNotification).toBe(true);
      expect(refreshed?.sendAsDocument).toBe(false);
    });

    it("publishes video as document via sendDocument without spoiler but with silent delivery", async () => {
      const post = await createDraftPost({
        botId: testBotAId,
        channelId: testChannelAId,
        postType: "VIDEO",
        content: "Raw uncompressed video attachment",
        mediaPath: "test-fixture-video.mp4",
        mediaOriginalName: "test-fixture-video.mp4",
        mediaMimeType: "video/mp4",
        mediaSizeBytes: 12,
        disableNotification: true,
        hasSpoiler: false,
        sendAsDocument: true,
      });

      let invokedMethod = "";
      let sentChatId = "";
      let sentOptions: any = null;

      const mockApi = {
        sendDocument: async (chatId: string, file: any, options: any) => {
          invokedMethod = "sendDocument";
          sentChatId = chatId;
          sentOptions = options;
          return { message_id: 65432 };
        },
      };

      const result = await publishChannelPost(post.id, testBotAId, undefined, mockApi);
      expect(result.success).toBe(true);
      expect(result.status).toBe("PUBLISHED");
      expect(result.messageId).toBe(65432);
      expect(invokedMethod).toBe("sendDocument");
      expect(sentChatId).toBe("@bot_a_channel");
      expect(sentOptions.caption).toBe("Raw uncompressed video attachment");
      expect(sentOptions.disable_notification).toBe(true);
      expect(sentOptions.has_spoiler).toBeUndefined(); // sendDocument does not take has_spoiler

      const refreshed = await prisma.channelPost.findUnique({ where: { id: post.id } });
      expect(refreshed?.sendAsDocument).toBe(true);
      expect(refreshed?.disableNotification).toBe(true);
    });

    it("publishes photo with spoiler blur and silent notification via sendPhoto", async () => {
      const post = await createDraftPost({
        botId: testBotAId,
        channelId: testChannelAId,
        postType: "IMAGE",
        content: "Spoiler alert photo!",
        mediaPath: "test-fixture-image.jpg",
        mediaOriginalName: "test-fixture-image.jpg",
        mediaMimeType: "image/jpeg",
        mediaSizeBytes: 10,
        disableNotification: true,
        hasSpoiler: true,
      });

      let invokedMethod = "";
      let sentOptions: any = null;

      const mockApi = {
        sendPhoto: async (chatId: string, file: any, options: any) => {
          invokedMethod = "sendPhoto";
          sentOptions = options;
          return { message_id: 77777 };
        },
      };

      const result = await publishChannelPost(post.id, testBotAId, undefined, mockApi);
      expect(result.success).toBe(true);
      expect(invokedMethod).toBe("sendPhoto");
      expect(sentOptions.has_spoiler).toBe(true);
      expect(sentOptions.disable_notification).toBe(true);
      expect(sentOptions.caption).toBe("Spoiler alert photo!");
    });

    it("publishes media album via sendMediaGroup with caption on index 0, slide spoilers, silent flag, and no reply_markup", async () => {
      const post = await createDraftPost({
        botId: testBotAId,
        channelId: testChannelAId,
        postType: "ALBUM",
        content: "Album Caption on Item 0 Only",
        disableNotification: true,
        albumItems: [
          {
            mediaType: "IMAGE",
            filePath: testImagePath,
            originalName: "first-photo.jpg",
            mimeType: "image/jpeg",
            sizeBytes: 10,
            order: 0,
            hasSpoiler: false,
          },
          {
            mediaType: "VIDEO",
            filePath: testVideoPath,
            originalName: "second-video.mp4",
            mimeType: "video/mp4",
            sizeBytes: 20,
            order: 1,
            hasSpoiler: true,
          },
        ],
      });

      let sentChatId = "";
      let sentMediaGroup: any[] = [];
      let sentOptions: any = null;

      const mockApi = {
        sendMediaGroup: async (chatId: string, media: any[], options: any) => {
          sentChatId = chatId;
          sentMediaGroup = media;
          sentOptions = options;
          return [{ message_id: 201 }, { message_id: 202 }];
        },
      };

      const result = await publishChannelPost(post.id, testBotAId, undefined, mockApi);

      expect(result.success).toBe(true);
      expect(result.status).toBe("PUBLISHED");
      expect(result.messageId).toBe(201);
      expect(result.albumMessageIds).toEqual([201, 202]);

      expect(sentChatId).toBe("@bot_a_channel");
      expect(sentMediaGroup).toHaveLength(2);

      // Slide 0: Photo, caption assigned, spoiler false
      expect(sentMediaGroup[0].type).toBe("photo");
      expect(sentMediaGroup[0].caption).toBe("Album Caption on Item 0 Only");
      expect(sentMediaGroup[0].has_spoiler).toBe(false);

      // Slide 1: Video, caption undefined, spoiler true
      expect(sentMediaGroup[1].type).toBe("video");
      expect(sentMediaGroup[1].caption).toBeUndefined();
      expect(sentMediaGroup[1].has_spoiler).toBe(true);

      // Options: silent delivery true, strictly no reply_markup
      expect(sentOptions.disable_notification).toBe(true);
      expect(sentOptions.reply_markup).toBeUndefined();

      // Check DB persistence
      const refreshed = await prisma.channelPost.findUnique({ where: { id: post.id } });
      expect(refreshed?.status).toBe("PUBLISHED");
      expect(refreshed?.telegramMessageId).toBe(201);
      expect(refreshed?.albumMessageIds).toEqual([201, 202]);
      expect(refreshed?.buttonMessageId).toBeNull();
    });

    it("publishes media album with inline buttons via follow-up message reply", async () => {
      const post = await createDraftPost({
        botId: testBotAId,
        channelId: testChannelAId,
        postType: "ALBUM",
        content: "Album with Follow-up Buttons",
        buttons: [
          { label: "Channel Website", url: "https://example.com/album", order: 0 },
        ],
        albumItems: [
          {
            mediaType: "IMAGE",
            filePath: testImagePath,
            originalName: "album-photo.jpg",
            mimeType: "image/jpeg",
            sizeBytes: 15,
            order: 0,
            hasSpoiler: false,
          },
          {
            mediaType: "IMAGE",
            filePath: testImagePath,
            originalName: "album-photo2.jpg",
            mimeType: "image/jpeg",
            sizeBytes: 15,
            order: 1,
            hasSpoiler: false,
          },
        ],
      });

      let sentMediaGroupCalled = false;
      let replyMessageCalled = false;
      let replyOptions: any = null;

      const mockApi = {
        sendMediaGroup: async () => {
          sentMediaGroupCalled = true;
          return [{ message_id: 301 }, { message_id: 302 }];
        },
        sendMessage: async (chatId: string, text: string, options: any) => {
          replyMessageCalled = true;
          replyOptions = options;
          return { message_id: 303 };
        },
      };

      const result = await publishChannelPost(post.id, testBotAId, undefined, mockApi);

      expect(result.success).toBe(true);
      expect(result.status).toBe("PUBLISHED");
      expect(result.messageId).toBe(301);
      expect(result.albumMessageIds).toEqual([301, 302]);
      expect(result.buttonMessageId).toBe(303);

      expect(sentMediaGroupCalled).toBe(true);
      expect(replyMessageCalled).toBe(true);
      expect(replyOptions.reply_parameters?.message_id).toBe(301);
      expect(replyOptions.reply_markup?.inline_keyboard[0]).toHaveLength(1);
      expect(replyOptions.reply_markup?.inline_keyboard[0][0].text).toBe("Channel Website");

      const refreshed = await prisma.channelPost.findUnique({ where: { id: post.id } });
      expect(refreshed?.status).toBe("PUBLISHED");
      expect(refreshed?.telegramMessageId).toBe(301);
      expect(refreshed?.albumMessageIds).toEqual([301, 302]);
      expect(refreshed?.buttonMessageId).toBe(303);
    });

    it("handles partial failure when album succeeds but follow-up buttons fail, and recovers via publishAlbumButtonsOnly", async () => {
      const post = await createDraftPost({
        botId: testBotAId,
        channelId: testChannelAId,
        postType: "ALBUM",
        content: "Album partial test",
        buttons: [
          { label: "Community", url: "https://example.com/chat", order: 0 },
        ],
        albumItems: [
          {
            mediaType: "IMAGE",
            filePath: testImagePath,
            originalName: "album1.jpg",
            mimeType: "image/jpeg",
            sizeBytes: 15,
            order: 0,
            hasSpoiler: false,
          },
          {
            mediaType: "IMAGE",
            filePath: testImagePath,
            originalName: "album2.jpg",
            mimeType: "image/jpeg",
            sizeBytes: 15,
            order: 1,
            hasSpoiler: false,
          },
        ],
      });

      // 1. Initial publish: album succeeds, but follow-up buttons fails
      const failingReplyMockApi = {
        sendMediaGroup: async () => [{ message_id: 401 }, { message_id: 402 }],
        sendMessage: async () => {
          throw new Error("Telegram API connection timeout on follow-up message");
        },
      };

      const partialResult = await publishChannelPost(post.id, testBotAId, undefined, failingReplyMockApi);

      expect(partialResult.success).toBe(false);
      expect(partialResult.status).toBe("PARTIAL");
      expect(partialResult.messageId).toBe(401);
      expect(partialResult.albumMessageIds).toEqual([401, 402]);
      expect(partialResult.error).toContain("Telegram API connection timeout");

      // Verify DB post is marked PARTIAL and preserved albumMessageIds
      const partialDbPost = await prisma.channelPost.findUnique({ where: { id: post.id } });
      expect(partialDbPost?.status).toBe("PARTIAL");
      expect(partialDbPost?.telegramMessageId).toBe(401);
      expect(partialDbPost?.albumMessageIds).toEqual([401, 402]);
      expect(partialDbPost?.buttonMessageId).toBeNull();
      expect(partialDbPost?.lastError).toContain("follow-up buttons failed");

      // 2. Recovery: Admin clicks "Retry Buttons" -> publishAlbumButtonsOnly
      let recoverySendMediaGroupCalled = false;
      let recoverySendMessageCalled = false;

      const recoveryMockApi = {
        sendMediaGroup: async () => {
          recoverySendMediaGroupCalled = true;
          return [];
        },
        sendMessage: async (chatId: string, text: string, options: any) => {
          recoverySendMessageCalled = true;
          expect(options.reply_parameters?.message_id).toBe(401);
          return { message_id: 403 };
        },
      };

      const recoveryResult = await publishAlbumButtonsOnly(post.id, testBotAId, undefined, recoveryMockApi);

      expect(recoveryResult.success).toBe(true);
      expect(recoveryResult.status).toBe("PUBLISHED");
      expect(recoveryResult.buttonMessageId).toBe(403);
      expect(recoverySendMediaGroupCalled).toBe(false); // Album is NEVER duplicated!
      expect(recoverySendMessageCalled).toBe(true);

      // Verify DB post transitioned to PUBLISHED with buttonMessageId
      const recoveredDbPost = await prisma.channelPost.findUnique({ where: { id: post.id } });
      expect(recoveredDbPost?.status).toBe("PUBLISHED");
      expect(recoveredDbPost?.telegramMessageId).toBe(401);
      expect(recoveredDbPost?.albumMessageIds).toEqual([401, 402]);
      expect(recoveredDbPost?.buttonMessageId).toBe(403);
      expect(recoveredDbPost?.lastError).toBeNull();
    });
  });

  describe("Telegram Channel Permission Check", () => {
    it("reports CAN_POST when bot is administrator with can_post_messages", async () => {
      const mockApi = {
        getChat: async () => ({ title: "Test Chat", username: "testchat" }),
        getMe: async () => ({ id: 111111 }),
        getChatMember: async () => ({
          status: "administrator",
          can_post_messages: true,
        }),
      };

      const result = await checkBotChannelPermissions(testBotAId, testChannelAId, mockApi);
      expect(result.status).toBe("CAN_POST");
      expect(result.canPost).toBe(true);
      expect(result.message).toContain("Post Messages");
    });

    it("reports CANNOT_POST when bot is administrator but can_post_messages is false", async () => {
      const mockApi = {
        getChat: async () => ({ title: "Test Chat", username: "testchat" }),
        getMe: async () => ({ id: 111111 }),
        getChatMember: async () => ({
          status: "administrator",
          can_post_messages: false,
        }),
      };

      const result = await checkBotChannelPermissions(testBotAId, testChannelAId, mockApi);
      expect(result.status).toBe("CANNOT_POST");
      expect(result.canPost).toBe(false);
      expect(result.message).toContain("Disabled");
    });

    it("reports UNKNOWN when Telegram API throws an unexpected network error", async () => {
      const mockApi = {
        getChat: async () => {
          throw new Error("502 Bad Gateway");
        },
        getMe: async () => ({ id: 111111 }),
      };

      const result = await checkBotChannelPermissions(testBotAId, testChannelAId, mockApi);
      expect(result.status).toBe("UNKNOWN");
      expect(result.canPost).toBe(false);
      expect(result.message).toContain("Unknown");
    });
  });

  describe("API Security Guards", () => {
    it("GET /api/bots/[id]/channels/[channelId]/posts rejects unauthenticated requests with 401", async () => {
      const req = new NextRequest("http://127.0.0.1:3000/api/bots/fake/channels/fake/posts");
      const res = await channelPostsGET(req, { params: { id: "fake", channelId: "fake" } });
      expect(res.status).toBe(401);
    });

    it("POST /api/bots/[id]/channels/[channelId]/posts rejects unauthenticated requests with 401", async () => {
      const req = new NextRequest("http://127.0.0.1:3000/api/bots/fake/channels/fake/posts", {
        method: "POST",
        body: JSON.stringify({ content: "test" }),
      });
      const res = await channelPostsPOST(req, { params: { id: "fake", channelId: "fake" } });
      expect(res.status).toBe(401);
    });

    it("PUT /api/posts/[id] rejects unauthenticated requests with 401", async () => {
      const req = new NextRequest("http://127.0.0.1:3000/api/posts/fake", {
        method: "PUT",
        body: JSON.stringify({ content: "test" }),
      });
      const res = await postPUT(req, { params: { id: "fake" } });
      expect(res.status).toBe(401);
    });

    it("POST /api/posts/[id]/publish rejects unauthenticated requests with 401", async () => {
      const req = new NextRequest("http://127.0.0.1:3000/api/posts/fake/publish", {
        method: "POST",
      });
      const res = await publishPOST(req, { params: { id: "fake" } });
      expect(res.status).toBe(401);
    });

    it("POST /api/posts/upload rejects unauthenticated requests with 401", async () => {
      const req = new NextRequest("http://127.0.0.1:3000/api/posts/upload", {
        method: "POST",
      });
      const res = await uploadPOST(req);
      expect(res.status).toBe(401);
    });

    it("GET /api/media/posts/[filename] rejects unauthenticated requests with 401", async () => {
      const req = new NextRequest("http://127.0.0.1:3000/api/media/posts/test.jpg");
      const res = await mediaGET(req, { params: { filename: "test.jpg" } });
      expect(res.status).toBe(401);
    });
  });

  describe("Pasted Media Upload & Clipboard Pipeline", () => {
    let adminToken: string;
    const createdFiles: string[] = [];

    beforeAll(async () => {
      adminToken = await createSessionToken({
        id: "admin-clipboard-tester",
        email: "admin@test.local",
        role: "ADMIN",
      });
    });

    afterAll(() => {
      for (const file of createdFiles) {
        try {
          const filePath = path.join(UPLOADS_POSTS_DIR, file);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        } catch {
          // ignore cleanup errors
        }
      }
    });

    it("accepts a pasted PNG blob without a filename and auto-assigns .png extension", async () => {
      const pngBytes = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
        0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      ]);
      const blob = new Blob([pngBytes], { type: "image/png" });
      const formData = new FormData();
      formData.append("file", blob); // no explicit filename, defaults to "blob"

      const req = new NextRequest("http://127.0.0.1:3000/api/posts/upload", {
        method: "POST",
        headers: {
          host: "127.0.0.1:3000",
          origin: "http://127.0.0.1:3000",
          cookie: `${COOKIE_NAME}=${adminToken}`,
        },
        body: formData,
      });

      const res = await uploadPOST(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.mediaType).toBe("IMAGE");
      expect(data.mimeType).toBe("image/png");
      expect(data.filename).toMatch(/\.png$/);
      expect(data.originalName).toMatch(/\.png$/);
      createdFiles.push(data.filename);

      // Verify file is saved in uploads dir
      const savedPath = path.join(UPLOADS_POSTS_DIR, data.filename);
      expect(fs.existsSync(savedPath)).toBe(true);
    });

    it("accepts a pasted MP4 video blob with generic name 'blob' and auto-assigns .mp4 extension", async () => {
      const mp4Bytes = Buffer.from([
        0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32,
        0x00, 0x00, 0x00, 0x00, 0x6d, 0x70, 0x34, 0x32, 0x69, 0x73, 0x6f, 0x6d,
      ]);
      const blob = new Blob([mp4Bytes], { type: "video/mp4" });
      const formData = new FormData();
      formData.append("file", blob, "blob");

      const req = new NextRequest("http://127.0.0.1:3000/api/posts/upload", {
        method: "POST",
        headers: {
          host: "127.0.0.1:3000",
          origin: "http://127.0.0.1:3000",
          cookie: `${COOKIE_NAME}=${adminToken}`,
        },
        body: formData,
      });

      const res = await uploadPOST(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.mediaType).toBe("VIDEO");
      expect(data.mimeType).toBe("video/mp4");
      expect(data.filename).toMatch(/\.mp4$/);
      createdFiles.push(data.filename);

      const savedPath = path.join(UPLOADS_POSTS_DIR, data.filename);
      expect(fs.existsSync(savedPath)).toBe(true);
    });

    it("rejects an upload request with more than 10 files", async () => {
      const formData = new FormData();
      const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      for (let i = 0; i < 11; i++) {
        formData.append("files", new Blob([pngBytes], { type: "image/png" }), `img_${i}.png`);
      }

      const req = new NextRequest("http://127.0.0.1:3000/api/posts/upload", {
        method: "POST",
        headers: {
          host: "127.0.0.1:3000",
          origin: "http://127.0.0.1:3000",
          cookie: `${COOKIE_NAME}=${adminToken}`,
        },
        body: formData,
      });

      const res = await uploadPOST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Cannot upload more than 10 media items");
    });

    it("rejects an upload request with empty files", async () => {
      const formData = new FormData();
      const req = new NextRequest("http://127.0.0.1:3000/api/posts/upload", {
        method: "POST",
        headers: {
          host: "127.0.0.1:3000",
          origin: "http://127.0.0.1:3000",
          cookie: `${COOKIE_NAME}=${adminToken}`,
        },
        body: formData,
      });

      const res = await uploadPOST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("No media file provided");
    });

    it("rejects corrupted magic bytes for pasted image", async () => {
      const corruptedBytes = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00]);
      const blob = new Blob([corruptedBytes], { type: "image/png" });
      const formData = new FormData();
      formData.append("file", blob, "clipboard.png");

      const req = new NextRequest("http://127.0.0.1:3000/api/posts/upload", {
        method: "POST",
        headers: {
          host: "127.0.0.1:3000",
          origin: "http://127.0.0.1:3000",
          cookie: `${COOKIE_NAME}=${adminToken}`,
        },
        body: formData,
      });

      const res = await uploadPOST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("signature mismatch");
    });
  });

  describe("Multi-bot Token Resolution & Network Configuration for Publishing", () => {
    it("resolves encrypted token stored in DB for newly added bots", async () => {
      const encrypted = encryptBotToken("8888999900:AAABBBCCCDDDEEEFFFGGGHHHIIIJJJKKKLL");
      const testEncBot = await prisma.bot.create({
        data: {
          name: "Encrypted Token Test Bot",
          username: "enc_token_test_bot",
          telegramBotId: BigInt(8888999900),
          encryptedToken: encrypted,
          tokenLast4: "KKLL",
          isActive: true,
        },
      });

      const resolved = await resolveBotToken(testEncBot.id);
      expect(resolved.token).toBe("8888999900:AAABBBCCCDDDEEEFFFGGGHHHIIIJJJKKKLL");
      expect(resolved.bot.id).toBe(testEncBot.id);

      await prisma.bot.delete({ where: { id: testEncBot.id } });
    });

    it("falls back to environment variable for legacy single-bot configurations", async () => {
      process.env.TEST_LEGACY_BOT_TOKEN = "1234567890:AAABBBCCCDDDEEEFFFGGGHHHIIIJJJKKKLL";
      const legacyBot = await prisma.bot.create({
        data: {
          name: "Legacy Env Bot",
          username: "legacy_env_bot",
          tokenEnvVar: "TEST_LEGACY_BOT_TOKEN",
          isActive: true,
        },
      });

      const resolved = await resolveBotToken(legacyBot.id);
      expect(resolved.token).toBe("1234567890:AAABBBCCCDDDEEEFFFGGGHHHIIIJJJKKKLL");

      await prisma.bot.delete({ where: { id: legacyBot.id } });
      delete process.env.TEST_LEGACY_BOT_TOKEN;
    });

    it("creates Telegram Api instance configured with IPv4 agent to prevent dual-stack socket hang", () => {
      const api = createTelegramApi("1234567890:AAABBBCCCDDDEEEFFFGGGHHHIIIJJJKKKLL");
      expect(api).toBeDefined();
      expect(typeof api.sendMessage).toBe("function");
      expect(typeof api.sendPhoto).toBe("function");
      expect(typeof api.sendMediaGroup).toBe("function");
    });
  });
});
