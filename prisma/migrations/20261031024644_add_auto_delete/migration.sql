-- AlterTable
ALTER TABLE "bot_buttons" ADD COLUMN     "autoDeleteReply" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "deleteAfterSeconds" INTEGER NOT NULL DEFAULT 30;

-- CreateTable
CREATE TABLE "scheduled_deletions" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "messageId" INTEGER NOT NULL,
    "deleteAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_deletions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scheduled_deletions_botId_idx" ON "scheduled_deletions"("botId");

-- CreateIndex
CREATE INDEX "scheduled_deletions_status_deleteAt_idx" ON "scheduled_deletions"("status", "deleteAt");

-- AddForeignKey
ALTER TABLE "scheduled_deletions" ADD CONSTRAINT "scheduled_deletions_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
