import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import path from "path";
import fs from "fs";
import { NextRequest } from "next/server";
import { prisma } from "../src/lib/prisma";
import {
  createSessionToken,
  validateSessionWithDatabase,
  COOKIE_NAME,
  hashPassword,
} from "../src/lib/auth";
import {
  hasBotAccess,
  canUserMutate,
  canUserPublish,
  canUserViewPhoneNumbers,
  canDeleteOrDeactivateAdmin,
} from "../src/lib/permissions";
import {
  LocalStorageProvider,
  S3StorageProvider,
  setStorageProviderForTesting,
  recordMediaInDatabase,
} from "../src/lib/storage";
import { GET as staffGET, POST as staffPOST } from "../src/app/api/staff/route";
import { PUT as staffPUT, DELETE as staffDELETE } from "../src/app/api/staff/[id]/route";
import { POST as changePasswordPOST } from "../src/app/api/auth/change-password/route";
import { GET as mediaGET } from "../src/app/api/media/posts/[filename]/route";
import { POST as publishPOST } from "../src/app/api/posts/[id]/publish/route";
import { GET as botUsersGET } from "../src/app/api/bots/[id]/users/route";
import { POST as postsPOST } from "../src/app/api/bots/[id]/channels/[channelId]/posts/route";
import { UPLOADS_POSTS_DIR } from "../src/lib/post-service";

describe("Persistent Storage, Staff Management & Multi-User Access Control", () => {
  const testBotAlphaId = "11111111-bot1-aaaa-aaaa-aaaaaaaaaaaa";
  const testBotBetaId = "22222222-bot2-bbbb-bbbb-bbbbbbbbbbbb";
  const testChannelAlphaId = "33333333-chan-aaaa-aaaa-aaaaaaaaaaaa";
  const testChannelBetaId = "44444444-chan-bbbb-bbbb-bbbbbbbbbbbb";

  let superAdminUser: any;
  let adminUser: any;
  let editorPublishUser: any;
  let editorDraftsOnlyUser: any;
  let viewerUser: any;

  let superAdminToken: string;
  let adminToken: string;
  let editorPublishToken: string;
  let editorDraftsOnlyToken: string;
  let viewerToken: string;

  const testTempFiles: string[] = [];

  beforeAll(async () => {
    // 1. Setup isolated bots and channels
    await prisma.bot.upsert({
      where: { id: testBotAlphaId },
      create: {
        id: testBotAlphaId,
        name: "Alpha Bot",
        username: "alpha_bot",
      },
      update: {},
    });

    await prisma.bot.upsert({
      where: { id: testBotBetaId },
      create: {
        id: testBotBetaId,
        name: "Beta Bot",
        username: "beta_bot",
      },
      update: {},
    });

    await prisma.botChannel.upsert({
      where: { id: testChannelAlphaId },
      create: {
        id: testChannelAlphaId,
        botId: testBotAlphaId,
        name: "Alpha Channel",
        telegramChatId: "@alpha_chan",
        inviteLink: "https://t.me/alpha_chan",
        buttonLabel: "Join Alpha",
      },
      update: {},
    });

    await prisma.botChannel.upsert({
      where: { id: testChannelBetaId },
      create: {
        id: testChannelBetaId,
        botId: testBotBetaId,
        name: "Beta Channel",
        telegramChatId: "@beta_chan",
        inviteLink: "https://t.me/beta_chan",
        buttonLabel: "Join Beta",
      },
      update: {},
    });

    // 2. Setup mock subscribers with phone numbers
    await prisma.telegramUser.upsert({
      where: {
        botId_telegramId: {
          botId: testBotAlphaId,
          telegramId: BigInt(777001),
        },
      },
      create: {
        botId: testBotAlphaId,
        telegramId: BigInt(777001),
        telegramPhNo: "+95912345678",
        firstName: "AlphaSubscriber",
      },
      update: {},
    });

    // 3. Setup staff test users for all 4 roles
    const basePasswordHash = await hashPassword("validPassword123!");

    superAdminUser = await prisma.adminUser.upsert({
      where: { email: "super_tester@backstage.local" },
      create: {
        email: "super_tester@backstage.local",
        passwordHash: basePasswordHash,
        role: "SUPER_ADMIN",
        isActive: true,
        tokenVersion: 1,
      },
      update: { role: "SUPER_ADMIN", isActive: true, tokenVersion: 1 },
    });

    adminUser = await prisma.adminUser.upsert({
      where: { email: "admin_alpha@backstage.local" },
      create: {
        email: "admin_alpha@backstage.local",
        passwordHash: basePasswordHash,
        role: "ADMIN",
        isActive: true,
        tokenVersion: 1,
      },
      update: { role: "ADMIN", isActive: true, tokenVersion: 1 },
    });

    editorPublishUser = await prisma.adminUser.upsert({
      where: { email: "editor_publish@backstage.local" },
      create: {
        email: "editor_publish@backstage.local",
        passwordHash: basePasswordHash,
        role: "EDITOR",
        isActive: true,
        tokenVersion: 1,
      },
      update: { role: "EDITOR", isActive: true, tokenVersion: 1 },
    });

    editorDraftsOnlyUser = await prisma.adminUser.upsert({
      where: { email: "editor_drafts@backstage.local" },
      create: {
        email: "editor_drafts@backstage.local",
        passwordHash: basePasswordHash,
        role: "EDITOR",
        isActive: true,
        tokenVersion: 1,
      },
      update: { role: "EDITOR", isActive: true, tokenVersion: 1 },
    });

    viewerUser = await prisma.adminUser.upsert({
      where: { email: "viewer_alpha@backstage.local" },
      create: {
        email: "viewer_alpha@backstage.local",
        passwordHash: basePasswordHash,
        role: "VIEWER",
        isActive: true,
        tokenVersion: 1,
      },
      update: { role: "VIEWER", isActive: true, tokenVersion: 1 },
    });

    // 4. Setup staff assignments:
    // adminUser assigned to Alpha Bot
    await prisma.staffBotAssignment.upsert({
      where: { userId_botId: { userId: adminUser.id, botId: testBotAlphaId } },
      create: { userId: adminUser.id, botId: testBotAlphaId, canPublish: true },
      update: { canPublish: true },
    });

    // editorPublishUser assigned to Alpha Bot with canPublish: true
    await prisma.staffBotAssignment.upsert({
      where: { userId_botId: { userId: editorPublishUser.id, botId: testBotAlphaId } },
      create: { userId: editorPublishUser.id, botId: testBotAlphaId, canPublish: true },
      update: { canPublish: true },
    });

    // editorDraftsOnlyUser assigned to Alpha Bot with canPublish: false
    await prisma.staffBotAssignment.upsert({
      where: { userId_botId: { userId: editorDraftsOnlyUser.id, botId: testBotAlphaId } },
      create: { userId: editorDraftsOnlyUser.id, botId: testBotAlphaId, canPublish: false },
      update: { canPublish: false },
    });

    // viewerUser assigned to Alpha Bot
    await prisma.staffBotAssignment.upsert({
      where: { userId_botId: { userId: viewerUser.id, botId: testBotAlphaId } },
      create: { userId: viewerUser.id, botId: testBotAlphaId, canPublish: false },
      update: { canPublish: false },
    });

    // 5. Generate tokens
    superAdminToken = await createSessionToken({
      id: superAdminUser.id,
      email: superAdminUser.email,
      role: superAdminUser.role,
      tokenVersion: 1,
    });

    adminToken = await createSessionToken({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      tokenVersion: 1,
    });

    editorPublishToken = await createSessionToken({
      id: editorPublishUser.id,
      email: editorPublishUser.email,
      role: editorPublishUser.role,
      tokenVersion: 1,
    });

    editorDraftsOnlyToken = await createSessionToken({
      id: editorDraftsOnlyUser.id,
      email: editorDraftsOnlyUser.email,
      role: editorDraftsOnlyUser.role,
      tokenVersion: 1,
    });

    viewerToken = await createSessionToken({
      id: viewerUser.id,
      email: viewerUser.email,
      role: viewerUser.role,
      tokenVersion: 1,
    });
  });

  afterAll(async () => {
    // Reset test override
    setStorageProviderForTesting(null);

    // Clean up created files
    for (const f of testTempFiles) {
      try {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      } catch {}
    }

    // Clean up test bots
    await prisma.bot.deleteMany({
      where: { id: { in: [testBotAlphaId, testBotBetaId] } },
    });
  });

  describe("Object Storage Abstraction", () => {
    it("LocalStorageProvider writes, reads, checks existence and deletes files", async () => {
      const provider = new LocalStorageProvider(UPLOADS_POSTS_DIR);
      const testKey = `test-storage-${Date.now()}.png`;
      const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01, 0x02]);

      // 1. Put
      const putRes = await provider.putObject(testKey, buffer, "image/png");
      expect(putRes.key).toBe(testKey);
      expect(putRes.sizeBytes).toBe(buffer.length);
      expect(putRes.storageProvider).toBe("local");

      // 2. Exists
      expect(await provider.exists(testKey)).toBe(true);
      expect(await provider.exists("non-existent-key.png")).toBe(false);

      // 3. Get
      const getRes = await provider.getObject(testKey);
      expect(getRes.data.equals(buffer)).toBe(true);
      expect(getRes.mimeType).toBe("image/png");

      // 4. Local file path resolution
      const localPath = provider.getLocalFilePath(testKey);
      expect(localPath).not.toBeNull();
      expect(fs.existsSync(localPath!)).toBe(true);

      // 5. Delete
      await provider.deleteObject(testKey);
      expect(await provider.exists(testKey)).toBe(false);
    });

    it("LocalStorageProvider strictly rejects directory traversal attacks", async () => {
      const provider = new LocalStorageProvider(UPLOADS_POSTS_DIR);
      const dummyBuf = Buffer.from("hello");

      await expect(provider.putObject("../../../escape.png", dummyBuf, "image/png")).rejects.toThrow(
        "directory traversal"
      );
      await expect(provider.getObject("..\\..\\windows\\system32\\cmd.exe")).rejects.toThrow(
        "directory traversal"
      );
    });

    it("S3StorageProvider works with mock S3Client and executes Put/Get/Delete commands", async () => {
      const mockStorageMap = new Map<string, { body: Buffer; mime: string }>();

      const mockS3Client = {
        send: async (command: any) => {
          const cmdName = command.constructor?.name || command.name;
          if (cmdName === "PutObjectCommand" || command.input?.Body) {
            mockStorageMap.set(command.input.Key, {
              body: command.input.Body,
              mime: command.input.ContentType,
            });
            return {};
          }
          if (cmdName === "GetObjectCommand") {
            const entry = mockStorageMap.get(command.input.Key);
            if (!entry) {
              const err: any = new Error("NoSuchKey");
              err.name = "NoSuchKey";
              throw err;
            }
            return {
              Body: {
                transformToByteArray: async () => new Uint8Array(entry.body),
              },
              ContentType: entry.mime,
            };
          }
          if (cmdName === "HeadObjectCommand") {
            if (!mockStorageMap.has(command.input.Key)) {
              const err: any = new Error("NotFound");
              err.name = "NotFound";
              throw err;
            }
            return {};
          }
          if (cmdName === "DeleteObjectCommand") {
            mockStorageMap.delete(command.input.Key);
            return {};
          }
          return {};
        },
      } as any;

      const s3Provider = new S3StorageProvider({
        bucket: "mock-r2-bucket",
        client: mockS3Client,
      });

      expect(s3Provider.name).toBe("s3");
      expect(s3Provider.getLocalFilePath("any.png")).toBeNull();

      const testBuffer = Buffer.from([0x01, 0x02, 0x03, 0x04]);
      const putResult = await s3Provider.putObject("posts/sample.png", testBuffer, "image/png");
      expect(putResult.key).toBe("posts/sample.png");
      expect(putResult.storageProvider).toBe("s3");

      expect(await s3Provider.exists("posts/sample.png")).toBe(true);
      expect(await s3Provider.exists("posts/unknown.png")).toBe(false);

      const getResult = await s3Provider.getObject("posts/sample.png");
      expect(getResult.data.equals(testBuffer)).toBe(true);
      expect(getResult.mimeType).toBe("image/png");

      await s3Provider.deleteObject("posts/sample.png");
      expect(await s3Provider.exists("posts/sample.png")).toBe(false);
    });

    it("S3StorageProvider throws helpful configuration error when bucket is not provided", () => {
      const origBucket = process.env.S3_BUCKET_NAME;
      delete process.env.S3_BUCKET_NAME;

      expect(() => new S3StorageProvider({ bucket: "" })).toThrow(
        "S3_BUCKET_NAME must be specified"
      );

      if (origBucket) process.env.S3_BUCKET_NAME = origBucket;
    });
  });

  describe("Private Media Access Authorization", () => {
    const testImageKey = `auth_test_media_${Date.now()}.png`;

    beforeAll(async () => {
      // Create local file and register in database for Bot Beta
      const provider = new LocalStorageProvider(UPLOADS_POSTS_DIR);
      await provider.putObject(testImageKey, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0a]), "image/png");
      testTempFiles.push(path.join(UPLOADS_POSTS_DIR, testImageKey));

      await recordMediaInDatabase({
        storageKey: testImageKey,
        storageProvider: "local",
        mimeType: "image/png",
        sizeBytes: 5,
        botId: testBotBetaId, // Belongs strictly to Bot Beta!
      });
    });

    it("GET /api/media/posts/[filename] rejects unauthenticated requests with 401", async () => {
      const req = new NextRequest(`http://127.0.0.1:3000/api/media/posts/${testImageKey}`);
      const res = await mediaGET(req, { params: { filename: testImageKey } });
      expect(res.status).toBe(401);
    });

    it("rejects staff assigned to Bot Alpha from accessing media belonging to Bot Beta (403)", async () => {
      const req = new NextRequest(`http://127.0.0.1:3000/api/media/posts/${testImageKey}`, {
        headers: {
          cookie: `${COOKIE_NAME}=${adminToken}`, // adminToken is assigned to Bot Alpha only
        },
      });

      const res = await mediaGET(req, { params: { filename: testImageKey } });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("Forbidden");
    });

    it("allows SUPER_ADMIN to access media across all bots (200)", async () => {
      const req = new NextRequest(`http://127.0.0.1:3000/api/media/posts/${testImageKey}`, {
        headers: {
          cookie: `${COOKIE_NAME}=${superAdminToken}`,
        },
      });

      const res = await mediaGET(req, { params: { filename: testImageKey } });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
      expect(res.headers.get("cache-control")).toContain("private");
    });
  });

  describe("Role Hierarchy & Least Privilege Authorization", () => {
    it("verifies permissions for all 4 roles on Bot Alpha", async () => {
      // 1. SUPER_ADMIN
      expect(await hasBotAccess({ id: superAdminUser.id, email: superAdminUser.email, role: "SUPER_ADMIN" }, testBotAlphaId)).toBe(true);
      expect(await canUserMutate({ id: superAdminUser.id, email: superAdminUser.email, role: "SUPER_ADMIN" }, testBotAlphaId)).toBe(true);
      expect(await canUserPublish({ id: superAdminUser.id, email: superAdminUser.email, role: "SUPER_ADMIN" }, testBotAlphaId)).toBe(true);

      // 2. ADMIN (Assigned to Alpha)
      expect(await hasBotAccess({ id: adminUser.id, email: adminUser.email, role: "ADMIN" }, testBotAlphaId)).toBe(true);
      expect(await canUserMutate({ id: adminUser.id, email: adminUser.email, role: "ADMIN" }, testBotAlphaId)).toBe(true);
      expect(await canUserPublish({ id: adminUser.id, email: adminUser.email, role: "ADMIN" }, testBotAlphaId)).toBe(true);

      // ADMIN (Not assigned to Beta)
      expect(await hasBotAccess({ id: adminUser.id, email: adminUser.email, role: "ADMIN" }, testBotBetaId)).toBe(false);
      expect(await canUserMutate({ id: adminUser.id, email: adminUser.email, role: "ADMIN" }, testBotBetaId)).toBe(false);
      expect(await canUserPublish({ id: adminUser.id, email: adminUser.email, role: "ADMIN" }, testBotBetaId)).toBe(false);

      // 3. EDITOR with publish permission
      expect(await canUserMutate({ id: editorPublishUser.id, email: editorPublishUser.email, role: "EDITOR" }, testBotAlphaId)).toBe(true);
      expect(await canUserPublish({ id: editorPublishUser.id, email: editorPublishUser.email, role: "EDITOR" }, testBotAlphaId)).toBe(true);

      // 4. EDITOR without publish permission (Drafts only)
      expect(await canUserMutate({ id: editorDraftsOnlyUser.id, email: editorDraftsOnlyUser.email, role: "EDITOR" }, testBotAlphaId)).toBe(true);
      expect(await canUserPublish({ id: editorDraftsOnlyUser.id, email: editorDraftsOnlyUser.email, role: "EDITOR" }, testBotAlphaId)).toBe(false);

      // 5. VIEWER (Read-only)
      expect(await hasBotAccess({ id: viewerUser.id, email: viewerUser.email, role: "VIEWER" }, testBotAlphaId)).toBe(true);
      expect(await canUserMutate({ id: viewerUser.id, email: viewerUser.email, role: "VIEWER" }, testBotAlphaId)).toBe(false);
      expect(await canUserPublish({ id: viewerUser.id, email: viewerUser.email, role: "VIEWER" }, testBotAlphaId)).toBe(false);
    });

    it("prevents Editor without publish permission from publishing a draft (403)", async () => {
      // Create a draft post on Alpha Bot
      const draftPost = await prisma.channelPost.create({
        data: {
          botId: testBotAlphaId,
          channelId: testChannelAlphaId,
          postType: "TEXT",
          content: "Draft to publish test",
          status: "DRAFT",
        },
      });

      const req = new NextRequest(`http://127.0.0.1:3000/api/posts/${draftPost.id}/publish`, {
        method: "POST",
        headers: {
          host: "127.0.0.1:3000",
          origin: "http://127.0.0.1:3000",
          cookie: `${COOKIE_NAME}=${editorDraftsOnlyToken}`,
        },
      });

      const res = await publishPOST(req, { params: { id: draftPost.id } });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("do not have permission to publish");

      // Clean up
      await prisma.channelPost.delete({ where: { id: draftPost.id } });
    });

    it("prevents staff assigned to Alpha Bot from creating drafts on Beta Bot (403)", async () => {
      const req = new NextRequest(
        `http://127.0.0.1:3000/api/bots/${testBotBetaId}/channels/${testChannelBetaId}/posts`,
        {
          method: "POST",
          headers: {
            host: "127.0.0.1:3000",
            origin: "http://127.0.0.1:3000",
            cookie: `${COOKIE_NAME}=${adminToken}`, // Assigned to Alpha only
          },
          body: JSON.stringify({
            postType: "TEXT",
            content: "Unauthorized cross-bot attempt",
          }),
        }
      );

      const res = await postsPOST(req, {
        params: { id: testBotBetaId, channelId: testChannelBetaId },
      });
      expect(res.status).toBe(403);
    });

    it("redacts sensitive personal phone numbers for Editors and Viewers", async () => {
      // 1. Viewer requesting users -> phone number must be [REDACTED]
      const viewerReq = new NextRequest(`http://127.0.0.1:3000/api/bots/${testBotAlphaId}/users`, {
        headers: { cookie: `${COOKIE_NAME}=${viewerToken}` },
      });
      const viewerRes = await botUsersGET(viewerReq, { params: { id: testBotAlphaId } });
      expect(viewerRes.status).toBe(200);
      const viewerData = await viewerRes.json();
      expect(viewerData.phonesRedacted).toBe(true);
      expect(viewerData.users[0].telegramPhNo).toBe("[REDACTED]");

      // 2. Admin assigned to Alpha Bot requesting users -> real phone number is provided
      const adminReq = new NextRequest(`http://127.0.0.1:3000/api/bots/${testBotAlphaId}/users`, {
        headers: { cookie: `${COOKIE_NAME}=${adminToken}` },
      });
      const adminRes = await botUsersGET(adminReq, { params: { id: testBotAlphaId } });
      expect(adminRes.status).toBe(200);
      const adminData = await adminRes.json();
      expect(adminData.phonesRedacted).toBe(false);
      expect(adminData.users[0].telegramPhNo).toBe("+95912345678");
    });
  });

  describe("Staff Management Administration & Guards", () => {
    it("GET /api/staff rejects non-SUPER_ADMIN accounts with 403 Forbidden", async () => {
      const req = new NextRequest("http://127.0.0.1:3000/api/staff", {
        headers: { cookie: `${COOKIE_NAME}=${adminToken}` },
      });
      const res = await staffGET(req);
      expect(res.status).toBe(403);
    });

    it("POST /api/staff allows SUPER_ADMIN to create an account with mustChangePassword=true", async () => {
      const uniqueEmail = `new_editor_${Date.now()}@backstage.local`;
      const req = new NextRequest("http://127.0.0.1:3000/api/staff", {
        method: "POST",
        headers: {
          host: "127.0.0.1:3000",
          origin: "http://127.0.0.1:3000",
          cookie: `${COOKIE_NAME}=${superAdminToken}`,
        },
        body: JSON.stringify({
          email: uniqueEmail,
          initialPassword: "InitialSecurePassword123!",
          role: "EDITOR",
          assignedBotIds: [testBotAlphaId],
          canPublish: false,
        }),
      });

      const res = await staffPOST(req);
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.staff.email).toBe(uniqueEmail);
      expect(data.staff.role).toBe("EDITOR");
      expect(data.staff.mustChangePassword).toBe(true);

      // Verify DB record
      const dbUser = await prisma.adminUser.findUnique({
        where: { email: uniqueEmail },
        include: { staffAssignments: true },
      });
      expect(dbUser).not.toBeNull();
      expect(dbUser?.staffAssignments.length).toBe(1);
      expect(dbUser?.staffAssignments[0].botId).toBe(testBotAlphaId);

      // Clean up
      await prisma.adminUser.delete({ where: { id: dbUser!.id } });
    });

    it("prevents deleting or deactivating the last active SUPER_ADMIN account", async () => {
      // Temporarily deactivate other super admins so superAdminUser is the sole active SUPER_ADMIN
      const otherSuperAdmins = await prisma.adminUser.findMany({
        where: { role: "SUPER_ADMIN", id: { not: superAdminUser.id } },
      });
      await prisma.adminUser.updateMany({
        where: { role: "SUPER_ADMIN", id: { not: superAdminUser.id } },
        data: { isActive: false },
      });

      try {
        const guard = await canDeleteOrDeactivateAdmin(superAdminUser.id);
        expect(guard.canProceed).toBe(false);
        expect(guard.error).toContain("last active SUPER_ADMIN");

        // Verify DELETE /api/staff/[id] enforcement when self-deleting
        const req = new NextRequest(`http://127.0.0.1:3000/api/staff/${superAdminUser.id}`, {
          method: "DELETE",
          headers: {
            host: "127.0.0.1:3000",
            origin: "http://127.0.0.1:3000",
            cookie: `${COOKIE_NAME}=${superAdminToken}`,
          },
        });

        const res = await staffDELETE(req, { params: { id: superAdminUser.id } });
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toContain("cannot delete your own active administrator account");
      } finally {
        // Restore other super admins
        for (const other of otherSuperAdmins) {
          await prisma.adminUser.update({
            where: { id: other.id },
            data: { isActive: other.isActive },
          });
        }
      }
    });
  });

  describe("Password Lifecycle & Immediate Session Invalidation", () => {
    it("updates password, increments tokenVersion, and invalidates old sessions", async () => {
      // Create temporary test admin
      const tempEmail = `pw_tester_${Date.now()}@backstage.local`;
      const originalPassword = "InitialPassword123!";
      const tempAdmin = await prisma.adminUser.create({
        data: {
          email: tempEmail,
          passwordHash: await hashPassword(originalPassword),
          role: "ADMIN",
          isActive: true,
          tokenVersion: 1,
        },
      });

      const originalToken = await createSessionToken({
        id: tempAdmin.id,
        email: tempAdmin.email,
        role: tempAdmin.role,
        tokenVersion: 1,
      });

      // Verify original session is valid
      const validSession = await validateSessionWithDatabase({
        id: tempAdmin.id,
        email: tempAdmin.email,
        role: tempAdmin.role,
        tokenVersion: 1,
      });
      expect(validSession).not.toBeNull();

      // Change password
      const changeReq = new NextRequest("http://127.0.0.1:3000/api/auth/change-password", {
        method: "POST",
        headers: {
          host: "127.0.0.1:3000",
          origin: "http://127.0.0.1:3000",
          cookie: `${COOKIE_NAME}=${originalToken}`,
        },
        body: JSON.stringify({
          oldPassword: originalPassword,
          newPassword: "BrandNewSecurePassword456!",
        }),
      });

      const changeRes = await changePasswordPOST(changeReq);
      expect(changeRes.status).toBe(200);

      // Verify DB tokenVersion has incremented to 2
      const updatedDbAdmin = await prisma.adminUser.findUnique({
        where: { id: tempAdmin.id },
      });
      expect(updatedDbAdmin?.tokenVersion).toBe(2);
      expect(updatedDbAdmin?.mustChangePassword).toBe(false);

      // Old session with tokenVersion: 1 is now REVOKED!
      const revokedSession = await validateSessionWithDatabase({
        id: tempAdmin.id,
        email: tempAdmin.email,
        role: tempAdmin.role,
        tokenVersion: 1, // Stale tokenVersion
      });
      expect(revokedSession).toBeNull();

      // Clean up
      await prisma.adminUser.delete({ where: { id: tempAdmin.id } });
    });
  });
});
