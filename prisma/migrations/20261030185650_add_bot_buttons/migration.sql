-- CreateTable
CREATE TABLE "bot_buttons" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "actionType" TEXT NOT NULL DEFAULT 'SEND_TEXT',
    "replyText" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bot_buttons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bot_buttons_botId_idx" ON "bot_buttons"("botId");

-- AddForeignKey
ALTER TABLE "bot_buttons" ADD CONSTRAINT "bot_buttons_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
