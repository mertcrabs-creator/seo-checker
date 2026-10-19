import { z } from 'zod';
import { domainToASCII } from 'node:url';

export const email = z
  .string({ required_error: 'E-posta zorunlu' })
  .trim()
  .toLowerCase()
  .max(254)
  .email('Geçerli bir e-posta girin');

export const password = z
  .string({ required_error: 'Şifre zorunlu' })
  .min(10, 'Şifre en az 10 karakter olmalı')
  .max(128, 'Şifre en fazla 128 karakter olabilir')
  .refine((v) => /[a-zçğıöşü]/.test(v) && /[A-ZÇĞİÖŞÜ]/.test(v) && /\d/.test(v), {
    message: 'Şifre büyük harf, küçük harf ve rakam içermeli',
  });

export const registerSchema = z.object({
  name: z.string().trim().min(2, 'Ad en az 2 karakter olmalı').max(100),
  email,
  password,
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Şifre zorunlu').max(128),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: password,
});

/** "https://www.Örnek.com/yol" -> "www.xn--rnek-1oa.com" */
export const hostname = z
  .string({ required_error: 'Alan adı zorunlu' })
  .trim()
  .max(300)
  .transform((v, ctx) => {
    let raw = v.toLowerCase();
    if (!/^[a-z]+:\/\//.test(raw)) raw = `https://${raw}`;
    let host;
    try {
      host = new URL(raw).hostname;
    } catch {
      host = '';
    }
    host = domainToASCII(host).replace(/\.$/, '');
    const labels = host.split('.');
    const valid =
      host.length > 0 &&
      host.length <= 253 &&
      labels.length >= 2 &&
      labels.every((l) => /^(?!-)[a-z0-9-]{1,63}(?<!-)$/.test(l)) &&
      /^([a-z]{2,63}|xn--[a-z0-9-]{2,59})$/.test(labels.at(-1));
    if (!valid) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Geçerli bir alan adı girin (örn. ornek.com)' });
      return z.NEVER;
    }
    return host;
  });

export const gscProperty = z
  .string()
  .trim()
  .max(300)
  .regex(/^(sc-domain:[a-z0-9.-]+|https?:\/\/[^\s]+)$/i, 'Geçersiz Search Console mülkü');

export const createDomainSchema = z.object({
  hostname,
  gscProperty: gscProperty.optional().nullable(),
});

export const updateDomainSchema = z.object({
  gscProperty: gscProperty.nullable(),
});

export const idParam = z.object({ id: z.string().uuid('Geçersiz kimlik') });

const DAY_OPTIONS = [7, 28, 90, 180, 365, 480];
export const days = z.coerce
  .number()
  .int()
  .refine((d) => DAY_OPTIONS.includes(d), 'Geçersiz tarih aralığı')
  .default(28);

export const POSITION_BUCKETS = {
  top3: [0, 3],
  top10: [3, 10],
  top20: [10, 20],
  top50: [20, 50],
  rest: [50, 10_000],
};

/** Search Console ülke kodu (ISO 3166-1 alpha-3, ör. TUR) */
export const countryCode = z.string().trim().regex(/^[a-z]{3}$/i, 'Geçersiz ülke').transform((v) => v.toUpperCase());

export const listQuery = z.object({
  days,
  country: countryCode.optional(),
  search: z.string().trim().max(200).optional(),
  sort: z.enum(['clicks', 'impressions', 'ctr', 'position', 'change', 'query', 'page']).default('clicks'),
  order: z.enum(['asc', 'desc']).default('desc'),
  bucket: z.enum(Object.keys(POSITION_BUCKETS)).optional(),
  // Az gösterimli kelimelerde ortalama pozisyon yanıltıcıdır; güvenilir sonuçlar için alt sınır
  minImpressions: z.coerce.number().int().min(0).max(100_000).default(0),
  brand: z.enum(['all', 'exclude', 'only']).default('all'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(5).max(200).default(50),
});

export const globalKeywordQuery = listQuery.extend({
  domainId: z.string().uuid().optional(),
});

export const pagespeedSchema = z.object({
  strategy: z.enum(['mobile', 'desktop']).default('mobile'),
  url: z.string().trim().url().max(2000).optional(),
});

export const auditIssueParams = z.object({
  id: z.string().uuid(),
  auditId: z.string().uuid(),
  code: z.string().regex(/^[a-z0-9_]{1,64}$/),
});

// ------------------------------------------------------------------ Site içi analiz (Search Console'suz)
const paging = {
  search: z.string().trim().max(200).optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(5).max(200).default(50),
};

export const siteKeywordQuery = z.object({
  ...paging,
  sort: z.enum(['score', 'pages', 'keyword', 'occurrences', 'title_pages']).default('score'),
  view: z.enum(['all', 'targeted', 'cannibal', 'template']).default('all'),
});

export const sitePageQuery = z.object({
  ...paging,
  sort: z.enum(['url', 'onpage_score', 'word_count', 'inlinks', 'issue_count', 'load_ms', 'depth']).default('onpage_score'),
  view: z.enum(['all', 'issues', 'thin', 'weak_links', 'noindex', 'errors']).default('all'),
});

export const siteKeywordPagesQuery = z.object({ keyword: z.string().trim().min(1).max(200) });
export const sitePageDetailQuery = z.object({ url: z.string().trim().url().max(2000) });

export const analyzeSchema = z.object({
  url: z
    .string({ required_error: 'URL zorunlu' })
    .trim()
    .max(2000)
    .transform((v) => (/^[a-z]+:\/\//i.test(v) ? v : `https://${v}`))
    .pipe(z.string().url('Geçerli bir URL girin')),
  keyword: z.string().trim().max(100).optional().transform((v) => v || undefined),
});

// ------------------------------------------------------------------ Lokasyon bazlı sıralamalar
const langCode = z.string().trim().toLowerCase().regex(/^[a-z]{2,3}(-[a-z0-9]{2,4})?$/, 'Geçersiz dil kodu');

export const rankConfigSchema = z.object({
  languages: z.array(langCode).max(20).default([]),
  locations: z.array(z.coerce.number().int().positive().max(99_999_999)).max(300).default([]),
});

export const rankKeywordQuery = z.object({
  ...paging,
  location: z.coerce.number().int().positive(),
  language: langCode,
  sort: z.enum(['position', 'search_volume', 'etv', 'keyword', 'difficulty', 'cpc', 'change']).default('etv'),
  bucket: z.enum(Object.keys(POSITION_BUCKETS)).optional(),
});

export const rankMatrixQuery = z.object({
  search: paging.search,
  page: paging.page,
  pageSize: z.coerce.number().int().min(5).max(100).default(50),
});

// Search Console kaynaklı (ücretsiz) lokasyon bazlı sıralamalar
const gscScope = z.enum(['target', 'all']).default('target');
export const rankLanguagesSchema = z.object({ languages: z.array(langCode).max(20).default([]) });
export const gscRankSummaryQuery = z.object({ scope: gscScope });
export const gscRankKeywordQuery = z.object({
  ...paging,
  country: z.string().trim().regex(/^[a-z]{3}$/i, 'Geçersiz ülke').transform((v) => v.toUpperCase()),
  sort: z.enum(['position', 'clicks', 'impressions', 'ctr', 'query', 'change']).default('impressions'),
  bucket: z.enum(Object.keys(POSITION_BUCKETS)).optional(),
});
export const gscRankMatrixQuery = z.object({
  scope: gscScope,
  search: paging.search,
  page: paging.page,
  pageSize: z.coerce.number().int().min(5).max(100).default(50),
});
export const gscRankLookupQuery = z.object({ keyword: z.string().trim().min(1, 'Kelime girin').max(200) });

export const rankCheckSchema = z.object({ keyword: z.string().trim().min(1, 'Kelime girin').max(200) });

const keywordText = z.string().trim().min(1, 'Kelime girin').max(500);
export const keywordInsightQuery = z.object({ query: keywordText });
export const serpCheckSchema = z.object({
  query: keywordText,
  country: z.string().trim().regex(/^[a-z]{3}$/i, 'Geçersiz ülke').transform((v) => v.toUpperCase()),
  device: z.enum(['desktop', 'mobile']).default('desktop'),
});

export const keywordTrendQuery = z.object({
  days,
  query: z.string().trim().min(1).max(500),
});

// ------------------------------------------------------------------ Backlink'ler
export const backlinkListQuery = z.object({
  ...paging,
  status: z.enum(['all', 'active', 'lost', 'pending', 'not_found', 'risky']).default('active'),
  rel: z.enum(['dofollow', 'nofollow', 'ugc', 'sponsored']).optional(),
  sort: z.enum(['first_seen', 'last_checked', 'source_domain', 'risk_score', 'outbound_links']).default('first_seen'),
});

export const backlinkDomainsQuery = z.object({ search: paging.search, page: paging.page, pageSize: paging.pageSize });

const importItem = z.object({
  source: z.string().trim().max(2000),
  target: z.string().trim().max(2000).optional().nullable(),
  anchor: z.string().trim().max(500).optional().nullable(),
});
export const backlinkImportSchema = z
  .object({
    // İstemci büyük CSV'leri parçalara bölerek gönderir (gövde sınırı 100 KB)
    urls: z.array(z.string().trim().max(2000)).max(500).optional(),
    items: z.array(importItem).max(300).optional(),
    source: z.enum(['gsc', 'bing', 'manual']).default('manual'),
  })
  .refine((v) => (v.urls?.length || 0) + (v.items?.length || 0) > 0, 'URL bulunamadı');

export const backlinkIdParam = z.object({ backlinkId: z.string().uuid() });

// ------------------------------------------------------------------ Uyarılar, indekslenme
export const alertListQuery = z.object({
  unread: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
  page: paging.page,
  pageSize: z.coerce.number().int().min(5).max(100).default(30),
});
export const alertReadSchema = z.object({ id: z.string().uuid().optional() });
export const indexPagesQuery = z.object({
  search: paging.search,
  page: paging.page,
  pageSize: paging.pageSize,
  view: z.enum(['all', 'indexed', 'not_indexed', 'canonical', 'errors']).default('all'),
});

// ------------------------------------------------------------------ Analiz derinleştirme
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Geçersiz tarih').refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Geçersiz tarih');

export const changesQuery = z.object({
  search: paging.search,
  severity: z.enum(['critical', 'warning', 'notice']).optional(),
  field: z.enum(['status_code', 'noindex', 'canonical', 'title', 'h1', 'meta_description', 'word_count', 'robots_blocked']).optional(),
  days: z.coerce.number().int().min(1).max(365).default(30),
  page: paging.page,
  pageSize: paging.pageSize,
});

export const decayPageQuery = z.object({
  url: z.string().trim().url().max(2000),
  peakMonth: z.string().regex(/^\d{4}-\d{2}-01$/, 'Geçersiz ay'),
});

export const annotationRangeQuery = z
  .object({ start: isoDay, end: isoDay })
  .refine((v) => v.start <= v.end, 'Başlangıç bitişten sonra olamaz');
export const annotationSchema = z.object({
  date: isoDay,
  title: z.string().trim().min(1, 'Başlık girin').max(120),
  detail: z.string().trim().max(500).optional().nullable(),
});
export const annotationIdParam = z.object({ annotationId: z.string().uuid() });

export const competitorSchema = z.object({ hostname });
export const competitorIdParam = z.object({ competitorId: z.string().uuid() });
export const logIdParam = z.object({ logId: z.string().uuid() });

// ------------------------------------------------------------------ İçerik ve rakip istihbaratı
const alpha3 = z.string().trim().regex(/^[a-z]{3}$/i, 'Geçersiz ülke').transform((v) => v.toUpperCase());
export const serpTrackSchema = z.object({
  items: z.array(z.object({
    keyword: z.string().trim().min(1, 'Kelime girin').max(200),
    country: alpha3,
    device: z.enum(['mobile', 'desktop']).default('mobile'),
  })).min(1).max(50),
});
export const serpTrackIdParam = z.object({ trackId: z.string().uuid() });
export const briefSchema = z.object({
  keyword: z.string().trim().min(2, 'Kelime girin').max(200),
  country: alpha3.optional(),
  urls: z.array(z.string().trim().url().max(2000)).max(8).default([]),
});
export const briefIdParam = z.object({ briefId: z.string().uuid() });
export const competitorChangesQuery = z.object({
  competitorId: z.string().uuid().optional(),
  kind: z.enum(['new_page', 'removed_page', 'title', 'h1', 'content_expanded', 'content_reduced', 'schema_added']).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(50),
});
export const logLatestQuery = z.object({ id: z.string().uuid().optional() });

// Geçersiz IP tüm isteği reddetmesin: doğrulama servisi IP olmayan değerleri "unknown" sayar
const ipText = z.string().trim().max(45);
const botFamily = z.enum(['google', 'bing', 'openai', 'perplexity']);
export const logVerifySchema = z.object({
  ips: z.array(z.object({ ip: ipText, bot: botFamily })).min(1).max(5000),
});

const count = z.number().int().min(0).max(1e9);
const counts = z.record(z.string().max(10), count).refine((o) => Object.keys(o).length <= 60, 'Çok fazla anahtar');
const logPath = z.string().max(2000);
/** Tarayıcıda ayrıştırılan log özeti; sadece bot istatistikleri (ziyaretçi verisi yok). */
export const logSummarySchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  format: z.string().max(40),
  totalLines: count,
  parsedLines: count,
  rangeStart: z.string().datetime({ offset: true }).nullable(),
  rangeEnd: z.string().datetime({ offset: true }).nullable(),
  bots: z.array(z.object({
    key: z.string().max(40), label: z.string().max(80), group: z.enum(['google', 'bing', 'ai', 'seo', 'other']),
    hits: count, verified: count, fake: count, unverified: count,
  })).max(60),
  daily: z.array(z.object({ date: isoDay, google: count, bing: count, ai: count, seo: count, other: count })).max(400),
  statuses: z.array(z.object({ code: z.string().max(5), google: count, all: count })).max(80),
  fileTypes: z.array(z.object({ type: z.string().max(20), hits: count })).max(30),
  urls: z.array(z.object({
    path: logPath, hits: count, google: count, bing: count, ai: count, statuses: counts, lastGoogle: z.string().datetime({ offset: true }).nullable(),
  })).max(5000),
  fake: z.array(z.object({ ip: ipText, bot: botFamily, hits: count })).max(200),
  ai: z.array(z.object({ bot: z.string().max(40), hits: count, urls: count, topPaths: z.array(z.object({ path: logPath, hits: count })).max(10) })).max(30),
});
