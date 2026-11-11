import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import path from "path";
import fs from "fs";
import { prisma } from "../src/lib/prisma";
import {
  createDraftPost,
  updateDraftPost,
  schedulePost,
  reschedulePost,
  cancelScheduledPost,
  claimDueScheduledPosts,
  recoverStalledScheduledPosts,
  executeClaimedScheduledPost,
  publishChannelPost,
  UPLOADS_POSTS_DIR,
} from "../src/lib/post-service";
import {
  isValidIanaTimeZone,
  validateAndParseZonedDateTime,
  validateFutureSchedule,
  formatScheduledDisplay,
  COMMON_TIMEZONES,
} from "../src/lib/schedule-utils";
import {
  POST as channelPostsPOST,
} from "../src/app/api/bots/[id]/channels/[channelId]/posts/route";
import {
  PUT as postPUT,
} from "../src/app/api/posts/[id]/route";
import {
  POST as scheduleRoutePOST,
} from "../src/app/api/posts/[id]/schedule/route";
import {
  POST as cancelScheduleRoutePOST,
} from "../src/app/api/posts/[id]/cancel-schedule/route";
import { NextRequest } from "next/server";
import { createSessionToken, COOKIE_NAME } from "../src/lib/auth";

describe("Scheduled Channel Posts & Scheduler Worker Engine", () => {
  const schedBotId = "77777777-schd-1111-1111-111111111111";
  const schedChannelId = "66666666-schd-aaaa-aaaa-aaaaaaaaaaaa";
  const superAdminId = "55555555-schd-0000-0000-000000000001";
  const editorNoPubId = "55555555-schd-0000-0000-000000000002";
  const editorWithPubId = "55555555-schd-0000-0000-000000000003";

  let superAdminToken: string;
  let editorNoPubToken: string;
  let editorWithPubToken: string;

  beforeAll(async () => {
    // 1. Setup isolated test bot and channel
    await prisma.bot.upsert({
      where: { id: schedBotId },
      create: {
        id: schedBotId,
        name: "Scheduled Test Bot",
        username: "scheduled_test_bot",
      },
      update: {},
    });

    await prisma.botChannel.upsert({
      where: { id: schedChannelId },
      create: {
        id: schedChannelId,
        botId: schedBotId,
        name: "Scheduled Broadcast Channel",
        telegramChatId: "@sched_broadcast_channel",
        inviteLink: "https://t.me/sched_broadcast_channel",
        buttonLabel: "Join Sched",
        isRequired: true,
        isEnabled: true,
        order: 0,
      },
      update: {},
    });

    // 2. Setup staff users with different permissions
    await prisma.adminUser.upsert({
      where: { id: superAdminId },
      create: {
        id: superAdminId,
        email: "superadmin_sched@test.local",
        passwordHash: "dummy_hash",
        role: "SUPER_ADMIN",
        isActive: true,
        mustChangePassword: false,
      },
      update: { role: "SUPER_ADMIN", isActive: true, mustChangePassword: false },
    });

    await prisma.adminUser.upsert({
      where: { id: editorNoPubId },
      create: {
        id: editorNoPubId,
        email: "editor_nopub@test.local",
        passwordHash: "dummy_hash",
        role: "EDITOR",
        isActive: true,
        mustChangePassword: false,
      },
      update: { role: "EDITOR", isActive: true, mustChangePassword: false },
    });

    await prisma.adminUser.upsert({
      where: { id: editorWithPubId },
      create: {
        id: editorWithPubId,
        email: "editor_withpub@test.local",
        passwordHash: "dummy_hash",
        role: "EDITOR",
        isActive: true,
        mustChangePassword: false,
      },
      update: { role: "EDITOR", isActive: true, mustChangePassword: false },
    });

    // Bot assignments:
    // editorNoPub has canPublish: false
    await prisma.staffBotAssignment.upsert({
      where: {
        userId_botId: {
          userId: editorNoPubId,
          botId: schedBotId,
        },
      },
      create: {
        userId: editorNoPubId,
        botId: schedBotId,
        canPublish: false,
      },
      update: { canPublish: false },
    });

    // editorWithPub has canPublish: true
    await prisma.staffBotAssignment.upsert({
      where: {
        userId_botId: {
          userId: editorWithPubId,
          botId: schedBotId,
        },
      },
      create: {
        userId: editorWithPubId,
        botId: schedBotId,
        canPublish: true,
      },
      update: { canPublish: true },
    });

    // Generate authenticated session tokens
    superAdminToken = await createSessionToken({
      id: superAdminId,
      email: "superadmin_sched@test.local",
      role: "SUPER_ADMIN",
      tokenVersion: 0,
      mustChangePassword: false,
    });

    editorNoPubToken = await createSessionToken({
      id: editorNoPubId,
      email: "editor_nopub@test.local",
      role: "EDITOR",
      tokenVersion: 0,
      mustChangePassword: false,
    });

    editorWithPubToken = await createSessionToken({
      id: editorWithPubId,
      email: "editor_withpub@test.local",
      role: "EDITOR",
      tokenVersion: 0,
      mustChangePassword: false,
    });

    // Setup uploads directory fixture
    if (!fs.existsSync(UPLOADS_POSTS_DIR)) {
      fs.mkdirSync(UPLOADS_POSTS_DIR, { recursive: true });
    }
  });

  afterAll(async () => {
    // Clean up test data
    await prisma.channelPost.deleteMany({ where: { botId: schedBotId } });
    await prisma.staffBotAssignment.deleteMany({
      where: { botId: schedBotId },
    });
    await prisma.botChannel.deleteMany({ where: { botId: schedBotId } });
    await prisma.adminUser.deleteMany({
      where: { id: { in: [superAdminId, editorNoPubId, editorWithPubId] } },
    });
    await prisma.auditLog.deleteMany({ where: { botId: schedBotId } });
    await prisma.bot.deleteMany({ where: { id: schedBotId } });
    await prisma.$disconnect();
  });

  describe("1. Timezone & Schedule Parsing Utilities", () => {
    it("validates recognized IANA timezones and rejects invalid names", () => {
      expect(isValidIanaTimeZone("Asia/Bangkok")).toBe(true);
      expect(isValidIanaTimeZone("Asia/Yangon")).toBe(true);
      expect(isValidIanaTimeZone("Asia/Singapore")).toBe(true);
      expect(isValidIanaTimeZone("UTC")).toBe(true);
      expect(isValidIanaTimeZone("America/New_York")).toBe(true);

      expect(isValidIanaTimeZone("")).toBe(false);
      expect(isValidIanaTimeZone("Fake/Timezone")).toBe(false);
      expect(isValidIanaTimeZone("GMT+7")).toBe(false);
    });

    it("includes priority Southeast Asia timezones (Bangkok, Yangon, Singapore) in COMMON_TIMEZONES", () => {
      const values = COMMON_TIMEZONES.map((t) => t.value);
      expect(values).toContain("Asia/Bangkok");
      expect(values).toContain("Asia/Yangon");
      expect(values).toContain("Asia/Singapore");
      expect(values).toContain("UTC");
    });

    it("parses Asia/Bangkok (UTC+07:00) with exact precision", () => {
      const parsed = validateAndParseZonedDateTime("2026-12-25", "15:30", "Asia/Bangkok");
      expect(parsed.timeZone).toBe("Asia/Bangkok");
      // Bangkok is UTC+7 -> 15:30 Bangkok = 08:30 UTC
      expect(parsed.utcDate.toISOString()).toBe("2026-12-25T08:30:00.000Z");
      expect(parsed.formattedLocal).toContain("2026");
    });

    it("parses Asia/Yangon (UTC+06:30 non-integer hour offset) with exact minute precision", () => {
      const parsed = validateAndParseZonedDateTime("2026-12-25", "15:30", "Asia/Yangon");
      expect(parsed.timeZone).toBe("Asia/Yangon");
      // Yangon is UTC+6:30 -> 15:30 Yangon = 09:00 UTC
      expect(parsed.utcDate.toISOString()).toBe("2026-12-25T09:00:00.000Z");
    });

    it("parses UTC correctly", () => {
      const parsed = validateAndParseZonedDateTime("2026-12-25", "15:30", "UTC");
      expect(parsed.utcDate.toISOString()).toBe("2026-12-25T15:30:00.000Z");
    });

    it("rejects nonexistent astronomical calendar dates (e.g. Feb 30, April 31)", () => {
      expect(() =>
        validateAndParseZonedDateTime("2026-02-30", "12:00", "Asia/Bangkok")
      ).toThrow();
      expect(() =>
        validateAndParseZonedDateTime("2026-04-31", "12:00", "Asia/Bangkok")
      ).toThrow();
    });

    it("rejects invalid date and time format strings", () => {
      expect(() =>
        validateAndParseZonedDateTime("25-12-2026", "12:00", "Asia/Bangkok")
      ).toThrow("Invalid date format");
      expect(() =>
        validateAndParseZonedDateTime("2026-12-25", "25:00", "Asia/Bangkok")
      ).toThrow();
    });

    it("validateFutureSchedule rejects past dates and times that are too soon", () => {
      const past = new Date(Date.now() - 60_000);
      expect(() => validateFutureSchedule(past)).toThrow("Past dates cannot be scheduled");

      const immediateFuture = new Date(Date.now() + 5_000);
      expect(() => validateFutureSchedule(immediateFuture, 30)).toThrow("too soon");

      const validFuture = new Date(Date.now() + 120_000);
      expect(() => validateFutureSchedule(validFuture, 30)).not.toThrow();
    });

    it("formats scheduled display correctly for users", () => {
      const date = new Date("2026-12-25T08:30:00.000Z");
      const displayBangkok = formatScheduledDisplay(date, "Asia/Bangkok");
      expect(displayBangkok).toContain("Asia/Bangkok");
      expect(displayBangkok).toContain("2026");

      const displayYangon = formatScheduledDisplay(date, "Asia/Yangon");
      expect(displayYangon).toContain("Asia/Yangon");
      expect(displayYangon).toContain("2026");

      expect(formatScheduledDisplay(null)).toBe("Not scheduled");
    });
  });

  describe("2. Staff Roles & Publish Permission Enforcement", () => {
    it("allows SuperAdmin to schedule post via API (POST /api/bots/.../posts)", async () => {
      const req = new NextRequest(
        `http://127.0.0.1:3000/api/bots/${schedBotId}/channels/${schedChannelId}/posts`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: `${COOKIE_NAME}=${superAdminToken}`,
            Origin: "http://127.0.0.1:3000",
            Host: "127.0.0.1:3000",
          },
          body: JSON.stringify({
            postType: "TEXT",
            content: "SuperAdmin scheduled announcement",
            status: "SCHEDULED",
            scheduledDate: "2026-12-25",
            scheduledTime: "12:00",
            scheduledTimezone: "Asia/Bangkok",
          }),
        }
      );

      const res = await channelPostsPOST(req, {
        params: Promise.resolve({ id: schedBotId, channelId: schedChannelId }),
      });
      const data = await res.json();

      expect(res.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.post.status).toBe("SCHEDULED");
      expect(data.post.scheduledTimezone).toBe("Asia/Bangkok");
      expect(data.post.scheduledAt).toBeDefined();
    });

    it("allows Editor with canPublish: true to schedule post via API", async () => {
      const req = new NextRequest(
        `http://127.0.0.1:3000/api/bots/${schedBotId}/channels/${schedChannelId}/posts`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: `${COOKIE_NAME}=${editorWithPubToken}`,
            Origin: "http://127.0.0.1:3000",
            Host: "127.0.0.1:3000",
          },
          body: JSON.stringify({
            postType: "TEXT",
            content: "Editor with publish permission scheduled announcement",
            status: "SCHEDULED",
            scheduledDate: "2026-12-26",
            scheduledTime: "14:00",
            scheduledTimezone: "Asia/Yangon",
          }),
        }
      );

      const res = await channelPostsPOST(req, {
        params: Promise.resolve({ id: schedBotId, channelId: schedChannelId }),
      });
      const data = await res.json();

      expect(res.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.post.status).toBe("SCHEDULED");
      expect(data.post.scheduledTimezone).toBe("Asia/Yangon");
    });

    it("rejects Editor with canPublish: false from scheduling post via creation API (403 Forbidden)", async () => {
      const req = new NextRequest(
        `http://127.0.0.1:3000/api/bots/${schedBotId}/channels/${schedChannelId}/posts`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: `${COOKIE_NAME}=${editorNoPubToken}`,
            Origin: "http://127.0.0.1:3000",
            Host: "127.0.0.1:3000",
          },
          body: JSON.stringify({
            postType: "TEXT",
            content: "Draft-only editor attempting to schedule",
            status: "SCHEDULED",
            scheduledDate: "2026-12-27",
            scheduledTime: "15:00",
            scheduledTimezone: "Asia/Bangkok",
          }),
        }
      );

      const res = await channelPostsPOST(req, {
        params: Promise.resolve({ id: schedBotId, channelId: schedChannelId }),
      });
      const data = await res.json();

      expect(res.status).toBe(403);
      expect(data.error).toContain("Forbidden: You do not have permission to schedule posts");
    });

    it("allows Editor with canPublish: false to save DRAFT post without error", async () => {
      const req = new NextRequest(
        `http://127.0.0.1:3000/api/bots/${schedBotId}/channels/${schedChannelId}/posts`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: `${COOKIE_NAME}=${editorNoPubToken}`,
            Origin: "http://127.0.0.1:3000",
            Host: "127.0.0.1:3000",
          },
          body: JSON.stringify({
            postType: "TEXT",
            content: "Draft-only editor valid draft",
            status: "DRAFT",
          }),
        }
      );

      const res = await channelPostsPOST(req, {
        params: Promise.resolve({ id: schedBotId, channelId: schedChannelId }),
      });
      const data = await res.json();

      expect(res.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.post.status).toBe("DRAFT");
    });

    it("rejects Editor with canPublish: false from scheduling existing draft via PUT /api/posts/[id] (403)", async () => {
      // First create draft as superAdmin
      const draft = await createDraftPost({
        botId: schedBotId,
        channelId: schedChannelId,
        postType: "TEXT",
        content: "Draft to be scheduled",
      });

      const req = new NextRequest(
        `http://127.0.0.1:3000/api/posts/${draft.id}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Cookie: `${COOKIE_NAME}=${editorNoPubToken}`,
            Origin: "http://127.0.0.1:3000",
            Host: "127.0.0.1:3000",
          },
          body: JSON.stringify({
            status: "SCHEDULED",
            scheduledDate: "2026-12-28",
            scheduledTime: "16:00",
            scheduledTimezone: "Asia/Bangkok",
          }),
        }
      );

      const res = await postPUT(req, { params: Promise.resolve({ id: draft.id }) });
      const data = await res.json();

      expect(res.status).toBe(403);
      expect(data.error).toContain("Forbidden: You do not have permission to schedule posts");
    });

    it("rejects Editor with canPublish: false from scheduling draft via POST /api/posts/[id]/schedule (403)", async () => {
      const draft = await createDraftPost({
        botId: schedBotId,
        channelId: schedChannelId,
        postType: "TEXT",
        content: "Draft to be scheduled via schedule endpoint",
      });

      const req = new NextRequest(
        `http://127.0.0.1:3000/api/posts/${draft.id}/schedule`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: `${COOKIE_NAME}=${editorNoPubToken}`,
            Origin: "http://127.0.0.1:3000",
            Host: "127.0.0.1:3000",
          },
          body: JSON.stringify({
            dateStr: "2026-12-29",
            timeStr: "10:00",
            timeZone: "Asia/Bangkok",
          }),
        }
      );

      const res = await scheduleRoutePOST(req, { params: Promise.resolve({ id: draft.id }) });
      const data = await res.json();

      expect(res.status).toBe(403);
      expect(data.error).toContain("Forbidden: You do not have permission to schedule posts");
    });
  });

  describe("3. Post Scheduling, Rescheduling & Cancellation Lifecycle", () => {
    it("schedules an existing DRAFT post using schedulePost service", async () => {
      const draft = await createDraftPost({
        botId: schedBotId,
        channelId: schedChannelId,
        postType: "TEXT",
        content: "Original draft content",
      });

      const scheduled = await schedulePost({
        postId: draft.id,
        botId: schedBotId,
        dateStr: "2026-12-25",
        timeStr: "18:00",
        timeZone: "Asia/Bangkok",
        adminUserId: superAdminId,
      });

      expect(scheduled.status).toBe("SCHEDULED");
      expect(scheduled.scheduledTimezone).toBe("Asia/Bangkok");
      expect(scheduled.scheduledAt).toBeDefined();
      expect(scheduled.scheduledByUserId).toBe(superAdminId);
    });

    it("reschedules an already scheduled post to a new date and time", async () => {
      const post = await createDraftPost({
        botId: schedBotId,
        channelId: schedChannelId,
        postType: "TEXT",
        content: "Reschedulable post",
        status: "SCHEDULED",
        scheduledAt: new Date("2026-12-25T11:00:00.000Z"),
        scheduledTimezone: "Asia/Bangkok",
      });

      const rescheduled = await reschedulePost({
        postId: post.id,
        botId: schedBotId,
        dateStr: "2026-12-30",
        timeStr: "09:30",
        timeZone: "Asia/Yangon",
        adminUserId: superAdminId,
      });

      expect(rescheduled.status).toBe("SCHEDULED");
      expect(rescheduled.scheduledTimezone).toBe("Asia/Yangon");
      // 09:30 Yangon (UTC+6:30) = 03:00 UTC
      expect(rescheduled.scheduledAt?.toISOString()).toBe("2026-12-30T03:00:00.000Z");
    });

    it("cancels a scheduled post and reverts status to DRAFT without deleting it", async () => {
      const post = await createDraftPost({
        botId: schedBotId,
        channelId: schedChannelId,
        postType: "TEXT",
        content: "Post to be cancelled",
        status: "SCHEDULED",
        scheduledAt: new Date("2026-12-25T11:00:00.000Z"),
        scheduledTimezone: "Asia/Bangkok",
      });

      const cancelled = await cancelScheduledPost(post.id, schedBotId, superAdminId);

      expect(cancelled.status).toBe("DRAFT");
      expect(cancelled.scheduledAt).toBeNull();
      expect(cancelled.scheduledTimezone).toBeNull();
      expect(cancelled.claimLeaseExpiresAt).toBeNull();
      expect(cancelled.claimWorkerId).toBeNull();

      // Verify in database
      const dbPost = await prisma.channelPost.findUnique({ where: { id: post.id } });
      expect(dbPost?.status).toBe("DRAFT");
      expect(dbPost?.scheduledAt).toBeNull();
    });

    it("cancels a scheduled post via API route (POST /api/posts/[id]/cancel-schedule)", async () => {
      const post = await createDraftPost({
        botId: schedBotId,
        channelId: schedChannelId,
        postType: "TEXT",
        content: "API Cancellable post",
        status: "SCHEDULED",
        scheduledAt: new Date("2026-12-25T11:00:00.000Z"),
        scheduledTimezone: "Asia/Bangkok",
      });

      const req = new NextRequest(
        `http://127.0.0.1:3000/api/posts/${post.id}/cancel-schedule`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: `${COOKIE_NAME}=${superAdminToken}`,
            Origin: "http://127.0.0.1:3000",
            Host: "127.0.0.1:3000",
          },
        }
      );

      const res = await cancelScheduleRoutePOST(req, { params: Promise.resolve({ id: post.id }) });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.post.status).toBe("DRAFT");
      expect(data.post.scheduledAt).toBeNull();
    });

    it("allows updating draft content of a scheduled post via updateDraftPost without breaking schedule", async () => {
      const scheduledDate = new Date(Date.now() + 86400000);
      const post = await createDraftPost({
        botId: schedBotId,
        channelId: schedChannelId,
        postType: "TEXT",
        content: "Original text",
        status: "SCHEDULED",
        scheduledAt: scheduledDate,
        scheduledTimezone: "Asia/Bangkok",
      });

      const updated = await updateDraftPost({
        id: post.id,
        botId: schedBotId,
        channelId: schedChannelId,
        postType: "TEXT",
        content: "Updated announcement content",
      });

      expect(updated.content).toBe("Updated announcement content");
      expect(updated.status).toBe("SCHEDULED");
      expect(updated.scheduledAt?.toISOString()).toBe(scheduledDate.toISOString());
    });
  });

  describe("4. Worker Atomic Claiming & Concurrency Safety", () => {
    it("claims due posts atomically in chronological order (scheduledAt ASC) without claiming future posts", async () => {
      const pastTime1 = new Date(Date.now() - 300_000); // 5 mins ago
      const pastTime2 = new Date(Date.now() - 100_000); // 1.6 mins ago
      const futureTime = new Date(Date.now() + 3_600_000); // 1 hour in future

      const post1 = await createDraftPost({
        botId: schedBotId,
        channelId: schedChannelId,
        postType: "TEXT",
        content: "Due post 1 (older)",
        status: "SCHEDULED",
        scheduledAt: pastTime1,
        scheduledTimezone: "Asia/Bangkok",
      });

      const post2 = await createDraftPost({
        botId: schedBotId,
        channelId: schedChannelId,
        postType: "TEXT",
        content: "Due post 2 (newer)",
        status: "SCHEDULED",
        scheduledAt: pastTime2,
        scheduledTimezone: "Asia/Bangkok",
      });

      const post3Future = await createDraftPost({
        botId: schedBotId,
        channelId: schedChannelId,
        postType: "TEXT",
        content: "Future post (not due)",
        status: "SCHEDULED",
        scheduledAt: futureTime,
        scheduledTimezone: "Asia/Bangkok",
      });

      const workerIdA = "worker-process-alpha";
      const claimedIds = await claimDueScheduledPosts({
        workerId: workerIdA,
        batchSize: 10,
        leaseDurationMs: 60000,
      });

      expect(claimedIds).toContain(post1.id);
      expect(claimedIds).toContain(post2.id);
      expect(claimedIds).not.toContain(post3Future.id);

      // Verify chronological ordering
      const idx1 = claimedIds.indexOf(post1.id);
      const idx2 = claimedIds.indexOf(post2.id);
      expect(idx1).toBeLessThan(idx2);

      // Verify that database records transitioned to SENDING with worker lease
      const dbPost1 = await prisma.channelPost.findUnique({ where: { id: post1.id } });
      expect(dbPost1?.status).toBe("SENDING");
      expect(dbPost1?.claimWorkerId).toBe(workerIdA);
      expect(dbPost1?.claimLeaseExpiresAt).toBeDefined();
    });

    it("prevents duplicate execution: concurrent worker B receives 0 posts for already claimed posts", async () => {
      const dueTime = new Date(Date.now() - 50_000);
      const post = await createDraftPost({
        botId: schedBotId,
        channelId: schedChannelId,
        postType: "TEXT",
        content: "Contested post",
        status: "SCHEDULED",
        scheduledAt: dueTime,
        scheduledTimezone: "Asia/Bangkok",
      });

      // Worker 1 claims
      const worker1Claims = await claimDueScheduledPosts({
        workerId: "worker-1",
        batchSize: 10,
        leaseDurationMs: 60000,
      });
      expect(worker1Claims).toContain(post.id);

      // Worker 2 attempts to claim simultaneously
      const worker2Claims = await claimDueScheduledPosts({
        workerId: "worker-2",
        batchSize: 10,
        leaseDurationMs: 60000,
      });
      expect(worker2Claims).not.toContain(post.id);
    });

    it("recovers stalled post if worker crashed and lease expired (claimLeaseExpiresAt <= now)", async () => {
      const expiredLease = new Date(Date.now() - 10_000);
      const stalledPost = await prisma.channelPost.create({
        data: {
          botId: schedBotId,
          channelId: schedChannelId,
          postType: "TEXT",
          content: "Stalled in sending after worker crash",
          status: "SENDING",
          scheduledAt: new Date(Date.now() - 120_000),
          scheduledTimezone: "Asia/Bangkok",
          claimWorkerId: "dead-worker",
          claimLeaseExpiresAt: expiredLease,
          retryCount: 0,
        },
      });

      const result = await recoverStalledScheduledPosts();
      expect(result.recoveredCount).toBeGreaterThanOrEqual(1);

      // Post should be returned to SCHEDULED for next worker pickup, with retryCount incremented
      const dbPost = await prisma.channelPost.findUnique({ where: { id: stalledPost.id } });
      expect(dbPost?.status).toBe("SCHEDULED");
      expect(dbPost?.retryCount).toBe(1);
      expect(dbPost?.claimLeaseExpiresAt).toBeNull();
      expect(dbPost?.claimWorkerId).toBeNull();
    });

    it("marks stalled post FAILED if retryCount exceeds maximum threshold (3)", async () => {
      const expiredLease = new Date(Date.now() - 10_000);
      const doomedPost = await prisma.channelPost.create({
        data: {
          botId: schedBotId,
          channelId: schedChannelId,
          postType: "TEXT",
          content: "Post that crashed 3 times",
          status: "SENDING",
          scheduledAt: new Date(Date.now() - 120_000),
          scheduledTimezone: "Asia/Bangkok",
          claimWorkerId: "dead-worker-2",
          claimLeaseExpiresAt: expiredLease,
          retryCount: 3, // Already at max retries
        },
      });

      await recoverStalledScheduledPosts();

      const dbPost = await prisma.channelPost.findUnique({ where: { id: doomedPost.id } });
      expect(dbPost?.status).toBe("FAILED");
      expect(dbPost?.lastError).toContain("Worker lease expired after 3 retry attempts");
    });
  });

  describe("5. Scheduled Post Execution & Telegram Dispatch Edge Cases", () => {
    it("executeClaimedScheduledPost dispatches post to Telegram via mock API and marks PUBLISHED", async () => {
      const post = await prisma.channelPost.create({
        data: {
          botId: schedBotId,
          channelId: schedChannelId,
          postType: "TEXT",
          content: "Worker dispatch message",
          status: "SENDING",
          scheduledAt: new Date(Date.now() - 60_000),
          scheduledTimezone: "Asia/Bangkok",
          claimWorkerId: "active-worker",
          claimLeaseExpiresAt: new Date(Date.now() + 60_000),
        },
      });

      // Mock Telegram client
      const mockApi = {
        sendMessage: async (chatId: string, text: string) => ({
          message_id: 778899,
          chat: { id: chatId },
          text,
          date: Math.floor(Date.now() / 1000),
        }),
      };

      const result = await executeClaimedScheduledPost(post.id, schedBotId, mockApi);
      expect(result.success).toBe(true);
      expect(result.status).toBe("PUBLISHED");
      expect(result.messageId).toBe(778899);

      const dbPost = await prisma.channelPost.findUnique({ where: { id: post.id } });
      expect(dbPost?.status).toBe("PUBLISHED");
      expect(dbPost?.telegramMessageId).toBe(778899);
      expect(dbPost?.sentAt).toBeDefined();
    });

    it("handles Telegram network timeout as UNKNOWN status and NEVER auto-retries", async () => {
      const post = await prisma.channelPost.create({
        data: {
          botId: schedBotId,
          channelId: schedChannelId,
          postType: "TEXT",
          content: "Timeout test post",
          status: "SENDING",
          claimWorkerId: "active-worker",
          claimLeaseExpiresAt: new Date(Date.now() + 60_000),
        },
      });

      const timeoutApi = {
        sendMessage: async () => {
          throw new Error("Telegram API connection timeout (ETIMEDOUT)");
        },
      };

      const result = await executeClaimedScheduledPost(post.id, schedBotId, timeoutApi);
      expect(result.success).toBe(false);
      expect(result.status).toBe("UNKNOWN");
      expect(result.error).toMatch(/timed out/i);

      // Post should be in UNKNOWN status in database, not automatically retried
      const dbPost = await prisma.channelPost.findUnique({ where: { id: post.id } });
      expect(dbPost?.status).toBe("UNKNOWN");
    });
  });
});
