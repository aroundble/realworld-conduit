-- CreateTable
CREATE TABLE "RateLimit" (
    "id" SERIAL NOT NULL,
    "bucket" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "windowStart" INTEGER NOT NULL,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RateLimit_updatedAt_idx" ON "RateLimit"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RateLimit_bucket_key_windowStart_key" ON "RateLimit"("bucket", "key", "windowStart");
