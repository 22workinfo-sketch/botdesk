-- CreateTable
CREATE TABLE "login_rate_limits" (
    "id" TEXT NOT NULL,
    "clientKey" TEXT NOT NULL,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "blockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "login_rate_limits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "login_rate_limits_clientKey_key" ON "login_rate_limits"("clientKey");

-- CreateIndex
CREATE INDEX "login_rate_limits_clientKey_idx" ON "login_rate_limits"("clientKey");
