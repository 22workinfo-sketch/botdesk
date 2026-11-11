-- AlterTable
ALTER TABLE "telegram_users" ADD COLUMN     "currentMenuId" TEXT,
ADD COLUMN     "flowVersion" INTEGER,
ADD COLUMN     "navigationStack" JSONB;

-- CreateTable
CREATE TABLE "bot_flows" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "name" TEXT,
    "structure" JSONB NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "publishedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bot_flows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bot_flows_botId_status_idx" ON "bot_flows"("botId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "bot_flows_botId_version_key" ON "bot_flows"("botId", "version");

-- AddForeignKey
ALTER TABLE "bot_flows" ADD CONSTRAINT "bot_flows_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_flows" ADD CONSTRAINT "bot_flows_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
