CREATE EXTENSION IF NOT EXISTS citext;

-- ---------------------------------------------------------------- Kullanıcılar
CREATE TABLE users (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 citext NOT NULL UNIQUE CHECK (length(email) <= 254),
  name                  text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  password_hash         text NOT NULL,
  role                  text NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  failed_login_attempts int NOT NULL DEFAULT 0,
  locked_until          timestamptz,
  password_changed_at   timestamptz NOT NULL DEFAULT now(),
  last_login_at         timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id   uuid NOT NULL,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  user_agent  text,
  ip          inet,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);

-- ---------------------------------------------------------------- Google entegrasyonu
CREATE TABLE google_connections (
  user_id            uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  google_email       text,
  access_token_enc   text NOT NULL,
  refresh_token_enc  text NOT NULL,
  token_expires_at   timestamptz NOT NULL,
  scope              text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE oauth_states (
  state_hash         text PRIMARY KEY,
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_verifier_enc  text NOT NULL,
  expires_at         timestamptz NOT NULL
);

-- ---------------------------------------------------------------- Alan adları
CREATE TABLE domains (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hostname        text NOT NULL CHECK (length(hostname) <= 253),
  gsc_property    text CHECK (length(gsc_property) <= 300),
  sync_status     text NOT NULL DEFAULT 'idle' CHECK (sync_status IN ('idle', 'running', 'failed')),
  sync_error      text,
  last_synced_at  timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, hostname)
);

-- ---------------------------------------------------------------- Search Console verisi
CREATE TABLE gsc_daily (
  domain_id    uuid NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  date         date NOT NULL,
  clicks       int NOT NULL,
  impressions  int NOT NULL,
  position     real NOT NULL,
  PRIMARY KEY (domain_id, date)
);

CREATE TABLE gsc_query_daily (
  domain_id    uuid NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  date         date NOT NULL,
  query        text NOT NULL,
  clicks       int NOT NULL,
  impressions  int NOT NULL,
  position     real NOT NULL,
  PRIMARY KEY (domain_id, date, query)
);

CREATE TABLE gsc_page_daily (
  domain_id    uuid NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  date         date NOT NULL,
  page         text NOT NULL,
  clicks       int NOT NULL,
  impressions  int NOT NULL,
  position     real NOT NULL,
  PRIMARY KEY (domain_id, date, page)
);

CREATE TABLE gsc_country_daily (
  domain_id    uuid NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  date         date NOT NULL,
  country      text NOT NULL,
  clicks       int NOT NULL,
  impressions  int NOT NULL,
  position     real NOT NULL,
  PRIMARY KEY (domain_id, date, country)
);

CREATE TABLE gsc_device_daily (
  domain_id    uuid NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  date         date NOT NULL,
  device       text NOT NULL,
  clicks       int NOT NULL,
  impressions  int NOT NULL,
  position     real NOT NULL,
  PRIMARY KEY (domain_id, date, device)
);

-- Anahtar kelime -> sıralanan URL eşleşmesi (son 28 gün toplamı)
CREATE TABLE gsc_query_page (
  domain_id    uuid NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  query        text NOT NULL,
  page         text NOT NULL,
  clicks       int NOT NULL,
  impressions  int NOT NULL,
  position     real NOT NULL,
  PRIMARY KEY (domain_id, query, page)
);

-- ---------------------------------------------------------------- Site sağlığı
CREATE TABLE audits (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id      uuid NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  status         text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  score          int,
  pages_crawled  int NOT NULL DEFAULT 0,
  site_info      jsonb NOT NULL DEFAULT '{}'::jsonb,
  error          text,
  started_at     timestamptz,
  finished_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audits_domain_idx ON audits (domain_id, created_at DESC);

CREATE TABLE audit_pages (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id          uuid NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  url               text NOT NULL,
  status_code       int,
  load_ms           int,
  bytes             int,
  title             text,
  meta_description  text,
  h1                text,
  word_count        int,
  depth             int NOT NULL DEFAULT 0,
  issue_count       int NOT NULL DEFAULT 0,
  UNIQUE (audit_id, url)
);

CREATE TABLE audit_issues (
  audit_id  uuid NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  code      text NOT NULL,
  url       text NOT NULL,
  detail    text
);
CREATE INDEX audit_issues_audit_code_idx ON audit_issues (audit_id, code);

-- ---------------------------------------------------------------- PageSpeed
CREATE TABLE pagespeed_reports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id       uuid NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  url             text NOT NULL,
  strategy        text NOT NULL CHECK (strategy IN ('mobile', 'desktop')),
  status          text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  performance     int,
  accessibility   int,
  best_practices  int,
  seo             int,
  metrics         jsonb NOT NULL DEFAULT '{}'::jsonb,
  field_data      jsonb,
  opportunities   jsonb NOT NULL DEFAULT '[]'::jsonb,
  diagnostics     jsonb NOT NULL DEFAULT '[]'::jsonb,
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pagespeed_domain_idx ON pagespeed_reports (domain_id, strategy, created_at DESC);
