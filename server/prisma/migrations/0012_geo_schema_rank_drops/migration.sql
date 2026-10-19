-- AlterTable
ALTER TABLE "audit_pages" ADD COLUMN     "geo" JSONB;

-- AlterTable
ALTER TABLE "domains" ADD COLUMN     "business_type" TEXT;

-- CreateTable
CREATE TABLE "rank_drop_analyses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "domain_id" UUID NOT NULL,
    "keyword" TEXT NOT NULL,
    "country" TEXT,
    "page" TEXT,
    "trigger" TEXT NOT NULL DEFAULT 'manual',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "error" TEXT,
    "data" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),

    CONSTRAINT "rank_drop_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rank_drop_analyses_domain_idx" ON "rank_drop_analyses"("domain_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "rank_drop_analyses" ADD CONSTRAINT "rank_drop_analyses_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "domains"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
