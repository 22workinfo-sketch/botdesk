-- AlterTable
ALTER TABLE "channel_posts" ADD COLUMN "scheduledAt" TIMESTAMP(3),
ADD COLUMN "scheduledTimezone" TEXT,
ADD COLUMN "scheduledByUserId" TEXT,
ADD COLUMN "claimLeaseExpiresAt" TIMESTAMP(3),
ADD COLUMN "claimWorkerId" TEXT,
ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "channel_posts_status_scheduledAt_idx" ON "channel_posts"("status", "scheduledAt");
