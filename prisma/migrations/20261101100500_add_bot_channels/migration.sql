-- CreateTable
CREATE TABLE "bot_channels" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "telegramChatId" TEXT NOT NULL,
    "inviteLink" TEXT NOT NULL,
    "buttonLabel" TEXT NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bot_channels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bot_channels_botId_idx" ON "bot_channels"("botId");

-- AddForeignKey
ALTER TABLE "bot_channels" ADD CONSTRAINT "bot_channels_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
