-- CreateTable
CREATE TABLE "domain_metrics" (
    "domain" TEXT NOT NULL,
    "opr" REAL,
    "opr_rank" INTEGER,
    "tranco_rank" INTEGER,
    "registered_at" TIMESTAMPTZ(6),
    "error" TEXT,
    "fetched_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "domain_metrics_pkey" PRIMARY KEY ("domain")
);

-- CreateTable
CREATE TABLE "authority_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "domain_id" UUID NOT NULL,
    "score" INTEGER NOT NULL,
    "pillars" JSONB NOT NULL,
    "metrics" JSONB NOT NULL,
    "recommendations" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "authority_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "authority_snapshots_domain_idx" ON "authority_snapshots"("domain_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "authority_snapshots" ADD CONSTRAINT "authority_snapshots_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "domains"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
