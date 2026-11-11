-- AlterTable
ALTER TABLE "telegram_users" ADD COLUMN     "currentNodeId" TEXT,
ADD COLUMN     "flowStepContext" JSONB,
ADD COLUMN     "flowVariables" JSONB;

-- CreateTable
CREATE TABLE "bot_flow_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'GENERAL',
    "structure" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bot_flow_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_flow_events" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "flowVersion" INTEGER NOT NULL,
    "telegramId" BIGINT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "actionLabel" TEXT,
    "updateId" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_flow_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bot_flow_templates_category_idx" ON "bot_flow_templates"("category");

-- CreateIndex
CREATE INDEX "bot_flow_events_botId_flowVersion_idx" ON "bot_flow_events"("botId", "flowVersion");

-- CreateIndex
CREATE INDEX "bot_flow_events_botId_eventType_idx" ON "bot_flow_events"("botId", "eventType");

-- CreateIndex
CREATE INDEX "bot_flow_events_botId_telegramId_idx" ON "bot_flow_events"("botId", "telegramId");

-- CreateIndex
CREATE INDEX "bot_flow_events_botId_updateId_idx" ON "bot_flow_events"("botId", "updateId");

-- CreateIndex
CREATE INDEX "bot_flow_events_createdAt_idx" ON "bot_flow_events"("createdAt");

-- AddForeignKey
ALTER TABLE "bot_flow_templates" ADD CONSTRAINT "bot_flow_templates_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_flow_events" ADD CONSTRAINT "bot_flow_events_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
