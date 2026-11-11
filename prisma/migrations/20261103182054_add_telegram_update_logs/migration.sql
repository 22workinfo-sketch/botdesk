-- CreateTable
CREATE TABLE "telegram_update_logs" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "updateId" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telegram_update_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "telegram_update_logs_botId_status_idx" ON "telegram_update_logs"("botId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_update_logs_botId_updateId_key" ON "telegram_update_logs"("botId", "updateId");
