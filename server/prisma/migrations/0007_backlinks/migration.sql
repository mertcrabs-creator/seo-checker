-- AlterTable
ALTER TABLE "domains" ADD COLUMN     "backlink_error" TEXT,
ADD COLUMN     "backlink_status" TEXT NOT NULL DEFAULT 'idle',
ADD COLUMN     "backlink_updated_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "backlinks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "domain_id" UUID NOT NULL,
    "source_url" TEXT NOT NULL,
    "source_domain" TEXT NOT NULL,
    "target_url" TEXT,
    "anchor" TEXT,
    "rel" TEXT,
    "status" TEXT NOT NULL DEFAULT 'unverified',
    "http_status" INTEGER,
    "source_noindex" BOOLEAN NOT NULL DEFAULT false,
    "outbound_links" INTEGER,
    "risk_score" INTEGER NOT NULL DEFAULT 0,
    "risk_reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sources" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "error" TEXT,
    "first_seen" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen" TIMESTAMPTZ(6),
    "last_checked" TIMESTAMPTZ(6),
    "lost_at" TIMESTAMPTZ(6),

    CONSTRAINT "backlinks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "backlinks_source_domain_idx" ON "backlinks"("domain_id", "source_domain");

-- CreateIndex
CREATE INDEX "backlinks_status_idx" ON "backlinks"("domain_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "backlinks_domain_id_source_url_key" ON "backlinks"("domain_id", "source_url");

-- AddForeignKey
ALTER TABLE "backlinks" ADD CONSTRAINT "backlinks_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "domains"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
