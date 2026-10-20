-- CreateTable
CREATE TABLE "tracking_sites" (
    "domain_id" UUID NOT NULL,
    "site_key" TEXT NOT NULL,
    "previous_key" TEXT,
    "previous_key_expires_at" TIMESTAMPTZ(6),
    "allowed_hosts" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_event_at" TIMESTAMPTZ(6),
    "rotated_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tracking_sites_pkey" PRIMARY KEY ("domain_id")
);

-- CreateTable
CREATE TABLE "tracking_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "domain_id" UUID NOT NULL,
    "visitor_hash" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "landing_path" TEXT NOT NULL,
    "exit_path" TEXT,
    "channel" TEXT NOT NULL,
    "source" TEXT,
    "referrer_host" TEXT,
    "utm_source" TEXT,
    "utm_medium" TEXT,
    "utm_campaign" TEXT,
    "utm_term" TEXT,
    "country" TEXT,
    "device" TEXT NOT NULL,
    "language" TEXT,
    "pageviews" INTEGER NOT NULL DEFAULT 0,
    "engaged_ms" INTEGER NOT NULL DEFAULT 0,
    "max_scroll" SMALLINT NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "tracking_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tracking_sessions_channel_check" CHECK ("channel" IN ('organic', 'ai', 'paid', 'social', 'email', 'referral', 'direct')),
    CONSTRAINT "tracking_sessions_device_check" CHECK ("device" IN ('mobile', 'tablet', 'desktop'))
);

-- CreateTable
CREATE TABLE "tracking_pageviews" (
    "domain_id" UUID NOT NULL,
    "pv_id" TEXT NOT NULL,
    "session_id" UUID NOT NULL,
    "path" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "engaged_ms" INTEGER NOT NULL DEFAULT 0,
    "max_scroll" SMALLINT NOT NULL DEFAULT 0,
    "lcp_ms" INTEGER,
    "cls" REAL,
    "inp_ms" INTEGER,

    CONSTRAINT "tracking_pageviews_pkey" PRIMARY KEY ("domain_id","pv_id")
);

-- CreateTable
CREATE TABLE "tracking_conversions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "domain_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT,
    "path" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tracking_conversions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tracking_conversions_kind_check" CHECK ("kind" IN ('phone', 'whatsapp', 'email', 'form', 'custom'))
);

-- CreateIndex
CREATE UNIQUE INDEX "tracking_sites_site_key_key" ON "tracking_sites"("site_key");

-- CreateIndex
CREATE UNIQUE INDEX "tracking_sites_previous_key_key" ON "tracking_sites"("previous_key");

-- CreateIndex
CREATE INDEX "tracking_sessions_domain_started_idx" ON "tracking_sessions"("domain_id", "started_at");

-- CreateIndex
CREATE INDEX "tracking_sessions_visitor_idx" ON "tracking_sessions"("domain_id", "visitor_hash", "last_seen_at");

-- CreateIndex
CREATE INDEX "tracking_pageviews_session_idx" ON "tracking_pageviews"("session_id");

-- CreateIndex
CREATE INDEX "tracking_pageviews_domain_created_idx" ON "tracking_pageviews"("domain_id", "created_at");

-- CreateIndex
CREATE INDEX "tracking_conversions_domain_created_idx" ON "tracking_conversions"("domain_id", "created_at");

-- CreateIndex
CREATE INDEX "tracking_conversions_session_idx" ON "tracking_conversions"("session_id");

-- AddForeignKey
ALTER TABLE "tracking_sites" ADD CONSTRAINT "tracking_sites_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "domains"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "tracking_sessions" ADD CONSTRAINT "tracking_sessions_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "domains"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "tracking_pageviews" ADD CONSTRAINT "tracking_pageviews_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "tracking_sessions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "tracking_conversions" ADD CONSTRAINT "tracking_conversions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "tracking_sessions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
