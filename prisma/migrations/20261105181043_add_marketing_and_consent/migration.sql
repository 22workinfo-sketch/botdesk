-- AlterTable
ALTER TABLE "telegram_users" ADD COLUMN     "firstCampaignSource" TEXT,
ADD COLUMN     "lastCampaignSource" TEXT,
ADD COLUMN     "marketingConsent" TEXT NOT NULL DEFAULT 'UNSPECIFIED',
ADD COLUMN     "marketingConsentAt" TIMESTAMP(3),
ADD COLUMN     "marketingConsentSource" TEXT;

-- CreateTable
CREATE TABLE "marketing_campaigns" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "targetChannelId" TEXT,
    "clicksCount" INTEGER NOT NULL DEFAULT 0,
    "uniqueStartsCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketing_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_touches" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "telegramUserId" BIGINT NOT NULL,
    "isNewUser" BOOLEAN NOT NULL DEFAULT false,
    "touchType" TEXT NOT NULL DEFAULT 'FIRST_TOUCH',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_touches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_consent_records" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "telegramUserId" BIGINT NOT NULL,
    "consentStatus" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'GENERAL_MARKETING',
    "source" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketing_consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "marketing_campaigns_botId_idx" ON "marketing_campaigns"("botId");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_campaigns_botId_slug_key" ON "marketing_campaigns"("botId", "slug");

-- CreateIndex
CREATE INDEX "campaign_touches_campaignId_createdAt_idx" ON "campaign_touches"("campaignId", "createdAt");

-- CreateIndex
CREATE INDEX "campaign_touches_botId_telegramUserId_idx" ON "campaign_touches"("botId", "telegramUserId");

-- CreateIndex
CREATE INDEX "marketing_consent_records_botId_telegramUserId_idx" ON "marketing_consent_records"("botId", "telegramUserId");

-- CreateIndex
CREATE INDEX "marketing_consent_records_botId_consentStatus_idx" ON "marketing_consent_records"("botId", "consentStatus");

-- AddForeignKey
ALTER TABLE "marketing_campaigns" ADD CONSTRAINT "marketing_campaigns_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_campaigns" ADD CONSTRAINT "marketing_campaigns_targetChannelId_fkey" FOREIGN KEY ("targetChannelId") REFERENCES "bot_channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_campaigns" ADD CONSTRAINT "marketing_campaigns_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_touches" ADD CONSTRAINT "campaign_touches_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "marketing_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_touches" ADD CONSTRAINT "campaign_touches_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_touches" ADD CONSTRAINT "campaign_touches_botId_telegramUserId_fkey" FOREIGN KEY ("botId", "telegramUserId") REFERENCES "telegram_users"("botId", "telegramId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_consent_records" ADD CONSTRAINT "marketing_consent_records_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_consent_records" ADD CONSTRAINT "marketing_consent_records_botId_telegramUserId_fkey" FOREIGN KEY ("botId", "telegramUserId") REFERENCES "telegram_users"("botId", "telegramId") ON DELETE CASCADE ON UPDATE CASCADE;
