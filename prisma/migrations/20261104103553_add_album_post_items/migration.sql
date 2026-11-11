-- AlterTable
ALTER TABLE "channel_posts" ADD COLUMN     "albumMessageIds" JSONB,
ADD COLUMN     "buttonMessageId" INTEGER;

-- CreateTable
CREATE TABLE "post_album_items" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "originalName" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "order" INTEGER NOT NULL DEFAULT 0,
    "hasSpoiler" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "post_album_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "post_album_items_postId_idx" ON "post_album_items"("postId");

-- CreateIndex
CREATE INDEX "post_album_items_postId_order_idx" ON "post_album_items"("postId", "order");

-- AddForeignKey
ALTER TABLE "post_album_items" ADD CONSTRAINT "post_album_items_postId_fkey" FOREIGN KEY ("postId") REFERENCES "channel_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
