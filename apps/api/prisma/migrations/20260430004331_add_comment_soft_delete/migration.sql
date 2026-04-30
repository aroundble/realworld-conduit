-- AlterTable
ALTER TABLE "Comment" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedBy" INTEGER,
ADD COLUMN     "moderationReason" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "role" TEXT;

-- CreateIndex
CREATE INDEX "Comment_deletedAt_idx" ON "Comment"("deletedAt");
