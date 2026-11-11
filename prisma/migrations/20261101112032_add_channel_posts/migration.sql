-- CreateTable
CREATE TABLE "channel_posts" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "postType" TEXT NOT NULL DEFAULT 'TEXT',
    "content" TEXT NOT NULL,
    "mediaPath" TEXT,
    "mediaOriginalName" TEXT,
    "mediaMimeType" TEXT,
    "mediaSizeBytes" INTEGER,
    "buttonsConfig" JSONB,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "telegramMessageId" INTEGER,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_posts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "channel_posts_botId_idx" ON "channel_posts"("botId");

-- CreateIndex
CREATE INDEX "channel_posts_channelId_idx" ON "channel_posts"("channelId");

-- CreateIndex
CREATE INDEX "channel_posts_status_idx" ON "channel_posts"("status");

-- AddForeignKey
ALTER TABLE "channel_posts" ADD CONSTRAINT "channel_posts_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_posts" ADD CONSTRAINT "channel_posts_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "bot_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
