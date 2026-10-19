-- AlterTable
ALTER TABLE "domains" ADD COLUMN     "monitor_checked_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "audit_pages" ADD COLUMN     "schema_report" JSONB;

-- CreateTable
CREATE TABLE "audit_links" (
    "audit_id" UUID NOT NULL,
    "source_url" TEXT NOT NULL,
    "target_url" TEXT NOT NULL,
    "anchor" TEXT,

    CONSTRAINT "audit_links_pkey" PRIMARY KEY ("audit_id","source_url","target_url")
);

-- CreateTable
CREATE TABLE "page_watch" (
    "domain_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "status_code" INTEGER,
    "noindex" BOOLEAN NOT NULL DEFAULT false,
    "canonical" TEXT,
    "title" TEXT,
    "meta_description" TEXT,
    "h1" TEXT,
    "robots_blocked" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "checked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "page_watch_pkey" PRIMARY KEY ("domain_id","url")
);

-- CreateTable
CREATE TABLE "page_changes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "domain_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "old_value" TEXT,
    "new_value" TEXT,
    "severity" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "page_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gsc_page_monthly" (
    "domain_id" UUID NOT NULL,
    "month" DATE NOT NULL,
    "page" TEXT NOT NULL,
    "clicks" INTEGER NOT NULL,
    "impressions" INTEGER NOT NULL,
    "position" REAL NOT NULL,

    CONSTRAINT "gsc_page_monthly_pkey" PRIMARY KEY ("domain_id","month","page")
);

-- CreateTable
CREATE TABLE "annotations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "domain_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "annotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competitors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "domain_id" UUID NOT NULL,
    "hostname" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "error" TEXT,
    "pages_crawled" INTEGER NOT NULL DEFAULT 0,
    "score" INTEGER,
    "site_info" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),

    CONSTRAINT "competitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competitor_pages" (
    "competitor_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "status_code" INTEGER,
    "title" TEXT,
    "h1" TEXT,
    "meta_description" TEXT,
    "word_count" INTEGER,
    "primary_keyword" TEXT,
    "schema_types" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "onpage_score" INTEGER,
    "depth" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "competitor_pages_pkey" PRIMARY KEY ("competitor_id","url")
);

-- CreateTable
CREATE TABLE "competitor_keywords" (
    "competitor_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "score" REAL NOT NULL,
    "in_title" BOOLEAN NOT NULL,
    "in_h1" BOOLEAN NOT NULL,

    CONSTRAINT "competitor_keywords_pkey" PRIMARY KEY ("competitor_id","url","keyword")
);

-- CreateTable
CREATE TABLE "log_analyses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "domain_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "range_start" TIMESTAMPTZ(6),
    "range_end" TIMESTAMPTZ(6),
    "total_lines" INTEGER NOT NULL,
    "bot_hits" INTEGER NOT NULL,
    "summary" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "log_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_links_target_idx" ON "audit_links"("audit_id", "target_url");

-- CreateIndex
CREATE INDEX "page_changes_domain_idx" ON "page_changes"("domain_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "gsc_page_monthly_page_idx" ON "gsc_page_monthly"("domain_id", "page");

-- CreateIndex
CREATE INDEX "annotations_domain_idx" ON "annotations"("domain_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "competitors_domain_id_hostname_key" ON "competitors"("domain_id", "hostname");

-- CreateIndex
CREATE INDEX "competitor_keywords_keyword_idx" ON "competitor_keywords"("competitor_id", "keyword");

-- CreateIndex
CREATE INDEX "log_analyses_domain_idx" ON "log_analyses"("domain_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "audit_links" ADD CONSTRAINT "audit_links_audit_id_fkey" FOREIGN KEY ("audit_id") REFERENCES "audits"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "page_watch" ADD CONSTRAINT "page_watch_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "domains"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "page_changes" ADD CONSTRAINT "page_changes_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "domains"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "gsc_page_monthly" ADD CONSTRAINT "gsc_page_monthly_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "domains"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "domains"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "domains"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "competitor_pages" ADD CONSTRAINT "competitor_pages_competitor_id_fkey" FOREIGN KEY ("competitor_id") REFERENCES "competitors"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "competitor_keywords" ADD CONSTRAINT "competitor_keywords_competitor_id_fkey" FOREIGN KEY ("competitor_id") REFERENCES "competitors"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "log_analyses" ADD CONSTRAINT "log_analyses_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "domains"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
