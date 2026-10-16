-- CreateTable
CREATE TABLE "gsc_query_country" (
    "domain_id" UUID NOT NULL,
    "query" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "clicks" INTEGER NOT NULL,
    "impressions" INTEGER NOT NULL,
    "position" REAL NOT NULL,
    "prev_clicks" INTEGER,
    "prev_impressions" INTEGER,
    "prev_position" REAL,

    CONSTRAINT "gsc_query_country_pkey" PRIMARY KEY ("domain_id","query","country")
);

-- CreateIndex
CREATE INDEX "gsc_query_country_country_idx" ON "gsc_query_country"("domain_id", "country", "position");

-- AddForeignKey
ALTER TABLE "gsc_query_country" ADD CONSTRAINT "gsc_query_country_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "domains"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
