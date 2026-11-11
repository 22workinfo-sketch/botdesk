-- CreateTable
CREATE TABLE "channel_activity_events" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "channelId" TEXT,
    "telegramChatId" TEXT NOT NULL,
    "channelTitle" TEXT,
    "telegramUserId" BIGINT NOT NULL,
    "userFirstName" TEXT,
    "userLastName" TEXT,
    "username" TEXT,
    "actorUserId" BIGINT,
    "actorUsername" TEXT,
    "eventType" TEXT NOT NULL,
    "status" TEXT,
    "source" TEXT NOT NULL,
    "updateId" BIGINT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_activity_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "channel_activity_events_botId_createdAt_idx" ON "channel_activity_events"("botId", "createdAt");

-- CreateIndex
CREATE INDEX "channel_activity_events_channelId_createdAt_idx" ON "channel_activity_events"("channelId", "createdAt");

-- CreateIndex
CREATE INDEX "channel_activity_events_telegramUserId_idx" ON "channel_activity_events"("telegramUserId");

-- CreateIndex
CREATE INDEX "channel_activity_events_eventType_idx" ON "channel_activity_events"("eventType");

-- CreateIndex
CREATE UNIQUE INDEX "channel_activity_events_botId_updateId_key" ON "channel_activity_events"("botId", "updateId");

-- AddForeignKey
ALTER TABLE "channel_activity_events" ADD CONSTRAINT "channel_activity_events_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_activity_events" ADD CONSTRAINT "channel_activity_events_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "bot_channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;
