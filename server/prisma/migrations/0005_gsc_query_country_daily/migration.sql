-- CreateTable
CREATE TABLE "gsc_query_country_daily" (
    "domain_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "query" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "clicks" INTEGER NOT NULL,
    "impressions" INTEGER NOT NULL,
    "position" REAL NOT NULL,

    CONSTRAINT "gsc_query_country_daily_pkey" PRIMARY KEY ("domain_id","date","query","country")
);

-- CreateIndex
CREATE INDEX "gsc_query_country_daily_country_idx" ON "gsc_query_country_daily"("domain_id", "country", "date");

-- CreateIndex
CREATE INDEX "gsc_query_country_daily_query_idx" ON "gsc_query_country_daily"("domain_id", "query", "date");

-- AddForeignKey
ALTER TABLE "gsc_query_country_daily" ADD CONSTRAINT "gsc_query_country_daily_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "domains"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
