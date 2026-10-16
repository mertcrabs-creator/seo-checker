-- AlterTable
ALTER TABLE "domains" ADD COLUMN     "index_error" TEXT,
ADD COLUMN     "index_status" TEXT NOT NULL DEFAULT 'idle',
ADD COLUMN     "index_updated_at" TIMESTAMPTZ(6),
ADD COLUMN     "ssl_expires_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "alerts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "domain_id" UUID,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMPTZ(6),

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "index_inspections" (
    "domain_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "verdict" TEXT,
    "coverage_state" TEXT,
    "indexing_state" TEXT,
    "robots_state" TEXT,
    "page_fetch_state" TEXT,
    "last_crawl" TIMESTAMPTZ(6),
    "google_canonical" TEXT,
    "user_canonical" TEXT,
    "crawled_as" TEXT,
    "rich_results" JSONB,
    "error" TEXT,
    "checked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "index_inspections_pkey" PRIMARY KEY ("domain_id","url")
);

-- CreateIndex
CREATE INDEX "alerts_user_idx" ON "alerts"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "alerts_domain_type_idx" ON "alerts"("domain_id", "type", "created_at" DESC);

-- CreateIndex
CREATE INDEX "index_inspections_verdict_idx" ON "index_inspections"("domain_id", "verdict");

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "domains"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "index_inspections" ADD CONSTRAINT "index_inspections_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "domains"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
