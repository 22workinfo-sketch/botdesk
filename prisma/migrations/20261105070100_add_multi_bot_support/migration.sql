-- AlterTable
ALTER TABLE "bots" ADD COLUMN     "connectionStatus" TEXT NOT NULL DEFAULT 'STANDBY',
ADD COLUMN     "description" TEXT,
ADD COLUMN     "encryptedToken" TEXT,
ADD COLUMN     "lastCheckedAt" TIMESTAMP(3),
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "telegramBotId" BIGINT,
ADD COLUMN     "tokenLast4" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "bots_telegramBotId_key" ON "bots"("telegramBotId");
