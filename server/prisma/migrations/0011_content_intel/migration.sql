-- AlterTable
ALTER TABLE "audit_pages" ADD COLUMN     "modified_at" DATE,
ADD COLUMN     "outline" JSONB,
ADD COLUMN     "published_at" DATE;

-- AlterTable
ALTER TABLE "competitor_pages" ADD COLUMN     "inlinks" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lang" TEXT,
ADD COLUMN     "modified_at" DATE,
ADD COLUMN     "outline" JSONB,
ADD COLUMN     "published_at" DATE,
ADD COLUMN     "schema_report" JSONB;

-- CreateTable
CREATE TABLE "serp_tracked_keywords" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "domain_id" UUID NOT NULL,
    "keyword" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "device" TEXT NOT NULL DEFAULT 'mobile',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_checked_at" TIMESTAMPTZ(6),

    CONSTRAINT "serp_tracked_keywords_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "serp_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "domain_id" UUID NOT NULL,
    "keyword" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "device" TEXT NOT NULL,
    "position" INTEGER,
    "url" TEXT,
    "features" JSONB NOT NULL DEFAULT '{}',
    "top" JSONB NOT NULL DEFAULT '[]',
    "questions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "related" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "checked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "serp_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crux_history" (
    "origin" TEXT NOT NULL,
    "form_factor" TEXT NOT NULL,
    "data" JSONB,
    "error" TEXT,
    "fetched_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crux_history_pkey" PRIMARY KEY ("origin","form_factor")
);

-- CreateTable
CREATE TABLE "domain_sitemap_urls" (
    "domain_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "lastmod" DATE,
    "first_seen" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "domain_sitemap_urls_pkey" PRIMARY KEY ("domain_id","url")
);

-- CreateTable
CREATE TABLE "competitor_sitemap_urls" (
    "competitor_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "lastmod" DATE,
    "first_seen" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "competitor_sitemap_urls_pkey" PRIMARY KEY ("competitor_id","url")
);

-- CreateTable
CREATE TABLE "competitor_changes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "competitor_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "old_value" TEXT,
    "new_value" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "competitor_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_briefs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "domain_id" UUID NOT NULL,
    "keyword" TEXT NOT NULL,
    "country" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "error" TEXT,
    "data" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),

    CONSTRAINT "content_briefs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "serp_tracked_keywords_domain_id_keyword_country_device_key" ON "serp_tracked_keywords"("domain_id", "keyword", "country", "device");

-- CreateIndex
CREATE INDEX "serp_snapshots_domain_idx" ON "serp_snapshots"("domain_id", "keyword", "checked_at" DESC);

-- CreateIndex
CREATE INDEX "competitor_changes_idx" ON "competitor_changes"("competitor_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "content_briefs_domain_idx" ON "content_briefs"("domain_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "serp_tracked_keywords" ADD CONSTRAINT "serp_tracked_keywords_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "domains"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "serp_snapshots" ADD CONSTRAINT "serp_snapshots_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "domains"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "domain_sitemap_urls" ADD CONSTRAINT "domain_sitemap_urls_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "domains"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "competitor_sitemap_urls" ADD CONSTRAINT "competitor_sitemap_urls_competitor_id_fkey" FOREIGN KEY ("competitor_id") REFERENCES "competitors"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "competitor_changes" ADD CONSTRAINT "competitor_changes_competitor_id_fkey" FOREIGN KEY ("competitor_id") REFERENCES "competitors"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "content_briefs" ADD CONSTRAINT "content_briefs_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "domains"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

