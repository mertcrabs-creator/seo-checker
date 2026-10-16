-- AlterTable
ALTER TABLE "domains" ADD COLUMN     "rank_error" TEXT,
ADD COLUMN     "rank_languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "rank_locations" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "rank_status" TEXT NOT NULL DEFAULT 'idle',
ADD COLUMN     "rank_updated_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "rank_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "domain_id" UUID NOT NULL,
    "location_code" INTEGER NOT NULL,
    "location_name" TEXT NOT NULL,
    "country_iso" TEXT,
    "language_code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "total_count" INTEGER,
    "etv" REAL,
    "metrics" JSONB,
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),

    CONSTRAINT "rank_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rank_keywords" (
    "snapshot_id" UUID NOT NULL,
    "keyword" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "position_absolute" INTEGER,
    "previous_position" INTEGER,
    "is_new" BOOLEAN NOT NULL DEFAULT false,
    "url" TEXT,
    "search_volume" INTEGER,
    "cpc" REAL,
    "competition" REAL,
    "difficulty" INTEGER,
    "intent" TEXT,
    "etv" REAL,

    CONSTRAINT "rank_keywords_pkey" PRIMARY KEY ("snapshot_id","keyword")
);

-- CreateTable
CREATE TABLE "rank_checks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "domain_id" UUID NOT NULL,
    "keyword" TEXT NOT NULL,
    "location_code" INTEGER NOT NULL,
    "location_name" TEXT NOT NULL,
    "country_iso" TEXT,
    "language_code" TEXT NOT NULL,
    "position" INTEGER,
    "url" TEXT,
    "error" TEXT,
    "checked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rank_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rank_snapshots_domain_idx" ON "rank_snapshots"("domain_id", "location_code", "language_code", "created_at" DESC);

-- CreateIndex
CREATE INDEX "rank_keywords_position_idx" ON "rank_keywords"("snapshot_id", "position");

-- CreateIndex
CREATE INDEX "rank_checks_domain_idx" ON "rank_checks"("domain_id", "keyword", "checked_at" DESC);

-- AddForeignKey
ALTER TABLE "rank_snapshots" ADD CONSTRAINT "rank_snapshots_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "domains"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "rank_keywords" ADD CONSTRAINT "rank_keywords_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "rank_snapshots"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "rank_checks" ADD CONSTRAINT "rank_checks_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "domains"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
