-- AlterTable
ALTER TABLE "channel_posts" ADD COLUMN     "disableNotification" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "hasSpoiler" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sendAsDocument" BOOLEAN NOT NULL DEFAULT false;
