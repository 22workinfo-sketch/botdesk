-- AlterTable
ALTER TABLE "admin_users" ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tokenVersion" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "staff_bot_assignments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "canPublish" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_bot_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stored_media" (
    "id" TEXT NOT NULL,
    "botId" TEXT,
    "storageProvider" TEXT NOT NULL DEFAULT 'local',
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "isPrivate" BOOLEAN NOT NULL DEFAULT true,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stored_media_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "staff_bot_assignments_botId_idx" ON "staff_bot_assignments"("botId");

-- CreateIndex
CREATE INDEX "staff_bot_assignments_userId_idx" ON "staff_bot_assignments"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "staff_bot_assignments_userId_botId_key" ON "staff_bot_assignments"("userId", "botId");

-- CreateIndex
CREATE UNIQUE INDEX "stored_media_storageKey_key" ON "stored_media"("storageKey");

-- CreateIndex
CREATE INDEX "stored_media_botId_idx" ON "stored_media"("botId");

-- CreateIndex
CREATE INDEX "stored_media_uploadedById_idx" ON "stored_media"("uploadedById");

-- AddForeignKey
ALTER TABLE "staff_bot_assignments" ADD CONSTRAINT "staff_bot_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_bot_assignments" ADD CONSTRAINT "staff_bot_assignments_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stored_media" ADD CONSTRAINT "stored_media_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
