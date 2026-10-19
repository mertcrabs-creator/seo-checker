import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .default('false')
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  DATABASE_URL: z.string().url(),
  DATABASE_SSL: bool,
  CLIENT_ORIGIN: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET en az 32 karakter olmalı'),
  ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/i, 'ENCRYPTION_KEY 64 hex karakter olmalı'),
  ACCESS_TOKEN_TTL_MIN: z.coerce.number().int().min(1).max(60).default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(60).default(7),
  COOKIE_SECURE: bool,
  ALLOW_REGISTRATION: bool,
  GOOGLE_CLIENT_ID: z.string().optional().default(''),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(''),
  GOOGLE_REDIRECT_URI: z.string().optional().default(''),
  PAGESPEED_API_KEY: z.string().optional().default(''),
  GSC_SYNC_DAYS: z.coerce.number().int().min(7).max(480).default(90),
  AUDIT_MAX_PAGES: z.coerce.number().int().min(1).max(500).default(100),
  DATAFORSEO_LOGIN: z.string().optional().default(''),
  DATAFORSEO_PASSWORD: z.string().optional().default(''),
  RANK_KEYWORDS_LIMIT: z.coerce.number().int().min(10).max(1000).default(1000),
  RANK_CHECK_DEPTH: z.coerce.number().int().min(10).max(200).default(100),
  RANK_MAX_LOCATIONS: z.coerce.number().int().min(1).max(200).default(60),
  SERPAPI_KEY: z.string().optional().default(''),
  SERP_CHECK_PAGES: z.coerce.number().int().min(1).max(10).default(2),
  BING_WEBMASTER_API_KEY: z.string().optional().default(''),
  BACKLINK_VERIFY_LIMIT: z.coerce.number().int().min(10).max(20_000).default(1500),
  TELEGRAM_BOT_TOKEN: z.string().optional().default(''),
  TELEGRAM_CHAT_ID: z.string().optional().default(''),
  SCHEDULER_ENABLED: z.enum(['true', 'false', '1', '0']).default('true').transform((v) => v === 'true' || v === '1'),
  INDEX_INSPECT_LIMIT: z.coerce.number().int().min(1).max(2000).default(200),
  OPEN_PAGERANK_API_KEY: z.string().optional().default(''),
  MONITOR_PAGES: z.coerce.number().int().min(1).max(100).default(25),
  MONITOR_INTERVAL_HOURS: z.coerce.number().int().min(1).max(168).default(6),
  COMPETITOR_MAX_PAGES: z.coerce.number().int().min(10).max(500).default(100),
  CRUX_API_KEY: z.string().optional().default(''),
  SERP_TRACK_LIMIT: z.coerce.number().int().min(1).max(200).default(20),
  SERP_TRACK_INTERVAL_DAYS: z.coerce.number().int().min(1).max(60).default(7),
  SERP_QUOTA_RESERVE: z.coerce.number().int().min(0).max(1000).default(20),
  SERP_AI_OVERVIEW_FETCH: z.enum(['true', 'false', '1', '0']).default('true').transform((v) => v === 'true' || v === '1'),
  AUTOCOMPLETE_ENABLED: z.enum(['true', 'false', '1', '0']).default('true').transform((v) => v === 'true' || v === '1'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Geçersiz ortam değişkenleri:');
  for (const issue of parsed.error.issues) console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  process.exit(1);
}

const env = parsed.data;

if (env.NODE_ENV === 'production' && !env.COOKIE_SECURE) {
  console.error('Production ortamında COOKIE_SECURE=true olmalı.');
  process.exit(1);
}

export const config = Object.freeze({
  env: env.NODE_ENV,
  isProd: env.NODE_ENV === 'production',
  port: env.PORT,
  trustProxy: env.TRUST_PROXY,
  db: { url: env.DATABASE_URL, ssl: env.DATABASE_SSL },
  clientOrigins: env.CLIENT_ORIGIN.split(',').map((o) => o.trim().replace(/\/$/, '')),
  jwt: {
    accessSecret: env.JWT_ACCESS_SECRET,
    accessTtlSec: env.ACCESS_TOKEN_TTL_MIN * 60,
    issuer: 'cr-seo-checker',
    audience: 'cr-seo-checker-client',
  },
  refreshTtlMs: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  cookieSecure: env.COOKIE_SECURE,
  encryptionKey: Buffer.from(env.ENCRYPTION_KEY, 'hex'),
  allowRegistration: env.ALLOW_REGISTRATION,
  google: {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: env.GOOGLE_REDIRECT_URI,
    enabled: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REDIRECT_URI),
  },
  pagespeedApiKey: env.PAGESPEED_API_KEY,
  gscSyncDays: env.GSC_SYNC_DAYS,
  auditMaxPages: env.AUDIT_MAX_PAGES,
  dataforseo: {
    login: env.DATAFORSEO_LOGIN,
    password: env.DATAFORSEO_PASSWORD,
    enabled: Boolean(env.DATAFORSEO_LOGIN && env.DATAFORSEO_PASSWORD),
    keywordsLimit: env.RANK_KEYWORDS_LIMIT,
    checkDepth: env.RANK_CHECK_DEPTH,
    maxLocations: env.RANK_MAX_LOCATIONS,
  },
  serpapi: {
    key: env.SERPAPI_KEY, enabled: Boolean(env.SERPAPI_KEY), pages: env.SERP_CHECK_PAGES,
    trackLimit: env.SERP_TRACK_LIMIT, trackIntervalDays: env.SERP_TRACK_INTERVAL_DAYS, quotaReserve: env.SERP_QUOTA_RESERVE,
    aiOverviewFetch: env.SERP_AI_OVERVIEW_FETCH,
  },
  bing: { key: env.BING_WEBMASTER_API_KEY, enabled: Boolean(env.BING_WEBMASTER_API_KEY) },
  backlinkVerifyLimit: env.BACKLINK_VERIFY_LIMIT,
  telegram: { token: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_CHAT_ID, enabled: Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) },
  schedulerEnabled: env.SCHEDULER_ENABLED,
  indexInspectLimit: env.INDEX_INSPECT_LIMIT,
  openPageRankKey: env.OPEN_PAGERANK_API_KEY,
  monitorPages: env.MONITOR_PAGES,
  monitorIntervalHours: env.MONITOR_INTERVAL_HOURS,
  competitorMaxPages: env.COMPETITOR_MAX_PAGES,
  // CrUX History API anahtarı (yoksa PageSpeed anahtarı denenir; ikisi aynı Google Cloud projesinden olabilir)
  cruxKey: env.CRUX_API_KEY || env.PAGESPEED_API_KEY,
  autocompleteEnabled: env.AUTOCOMPLETE_ENABLED,
});
