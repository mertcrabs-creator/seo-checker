-- CreateTable
CREATE TABLE "serp_checks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "domain_id" UUID NOT NULL,
    "keyword" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "device" TEXT NOT NULL DEFAULT 'desktop',
    "position" INTEGER,
    "url" TEXT,
    "corrected_query" TEXT,
    "depth" INTEGER NOT NULL,
    "top" JSONB NOT NULL DEFAULT '[]',
    "checked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "serp_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "serp_checks_domain_idx" ON "serp_checks"("domain_id", "keyword", "checked_at" DESC);

-- AddForeignKey
ALTER TABLE "serp_checks" ADD CONSTRAINT "serp_checks_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "domains"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
