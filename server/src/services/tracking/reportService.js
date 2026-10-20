import { config } from '../../config.js';
import { query } from '../../db/pool.js';
import { notFound } from '../../utils/httpError.js';

/**
 * CrabRank raporları. Google aranan kelimeyi siteye göndermez ("not provided"); organik Google oturumlarının
 * kelimesi Search Console verisiyle olasılıksal olarak tahmin edilir:
 *   P(kelime | giriş sayfası, ülke) ∝ ağırlık(kelime, sayfa) × (0,15 + kelimenin o ülkedeki tıklama payı)
 * ağırlık = tıklama + 0,02 × gösterim (tıklaması olmayan sayfalarda da dağılım çıkabilsin diye).
 * Reklam (utm_term) kelimeleri kesindir ve ayrıca listelenir.
 */

const TZ = 'Europe/Istanbul';
const PAGE_SIZE = 50;

/** Tam URL veya yol → karşılaştırılabilir yol: sorgu/parça yok, küçük harf, sonda "/" yok (kök hariç) */
export function normPath(value) {
  let path = String(value || '');
  path = path.replace(/^[a-z]+:\/\/[^/]+/i, '').replace(/[?#].*$/, '') || '/';
  try {
    path = decodeURI(path);
  } catch { /* bozuk kodlama: olduğu gibi */ }
  path = path.toLowerCase();
  return path.length > 1 ? path.replace(/\/+$/, '') || '/' : '/';
}

// ------------------------------------------------------------------ GSC modeli (alan adı başına 10 dk önbellek)
const modelCache = new Map();
const MODEL_MS = 10 * 60_000;

async function gscModel(domainId) {
  const hit = modelCache.get(domainId);
  if (hit && Date.now() - hit.at < MODEL_MS) return hit.model;
  const [{ rows: qp }, { rows: qc }] = await Promise.all([
    query('SELECT query, page, clicks, impressions FROM gsc_query_page WHERE domain_id = $1', [domainId]),
    query('SELECT query, country, clicks, impressions FROM gsc_query_country WHERE domain_id = $1', [domainId]),
  ]);
  let model = null;
  if (qp.length) {
    const pages = new Map();
    for (const r of qp) {
      const w = r.clicks + 0.02 * r.impressions;
      if (!w) continue;
      const path = normPath(r.page);
      if (!pages.has(path)) pages.set(path, []);
      pages.get(path).push({ query: r.query, w });
    }
    const totals = new Map();
    for (const r of qc) totals.set(r.query, (totals.get(r.query) || 0) + r.clicks + 0.02 * r.impressions);
    const share = new Map();
    for (const r of qc) {
      const t = totals.get(r.query);
      if (!t) continue;
      if (!share.has(r.query)) share.set(r.query, new Map());
      share.get(r.query).set(r.country, (r.clicks + 0.02 * r.impressions) / t);
    }
    model = { pages, share };
  }
  if (modelCache.size > 200) modelCache.clear();
  modelCache.set(domainId, { model, at: Date.now() });
  return model;
}

/** Giriş sayfası + ülke için kelime olasılıkları (azalan). */
function distribution(model, path, country) {
  const list = model?.pages.get(normPath(path));
  if (!list) return [];
  let total = 0;
  const scored = list.map(({ query: q, w }) => {
    const s = country ? w * (0.15 + (model.share.get(q)?.get(country) || 0)) : w;
    total += s;
    return { query: q, s };
  });
  return scored.sort((a, b) => b.s - a.s).map((x) => ({ query: x.query, p: x.s / total }));
}

const isGoogleOrganic = (s) => s.channel === 'organic' && s.source === 'google';

// ------------------------------------------------------------------ Özet
export async function summary(domainId, days) {
  const p = [domainId, days];
  const inRange = 'started_at >= now() - make_interval(days => $2)';
  const [totals, daily, channels, sources, landing, conversions, devices, countries, vitals] = await Promise.all([
    query(
      `SELECT count(DISTINCT visitor_hash) FILTER (WHERE cur)::int AS visitors,
              count(*) FILTER (WHERE cur)::int AS sessions,
              COALESCE(SUM(pageviews) FILTER (WHERE cur), 0)::int AS pageviews,
              COALESCE(SUM(conversions) FILTER (WHERE cur), 0)::int AS conversions,
              count(*) FILTER (WHERE cur AND conversions > 0)::int AS converted,
              COALESCE(AVG(engaged_ms) FILTER (WHERE cur), 0)::int AS avg_engaged_ms,
              count(*) FILTER (WHERE cur AND pageviews <= 1 AND engaged_ms < 10000)::int AS bounced,
              count(DISTINCT visitor_hash) FILTER (WHERE NOT cur)::int AS prev_visitors,
              count(*) FILTER (WHERE NOT cur)::int AS prev_sessions,
              COALESCE(SUM(pageviews) FILTER (WHERE NOT cur), 0)::int AS prev_pageviews,
              COALESCE(SUM(conversions) FILTER (WHERE NOT cur), 0)::int AS prev_conversions,
              count(*) FILTER (WHERE NOT cur AND conversions > 0)::int AS prev_converted
         FROM (SELECT *, ${inRange} AS cur FROM tracking_sessions
                WHERE domain_id = $1 AND started_at >= now() - make_interval(days => $2 * 2)) s`,
      p,
    ),
    query(
      `WITH d AS (
         SELECT generate_series((now() AT TIME ZONE '${TZ}')::date - ($2 - 1), (now() AT TIME ZONE '${TZ}')::date, interval '1 day')::date AS date
       ), s AS (
         SELECT (started_at AT TIME ZONE '${TZ}')::date AS date, count(*)::int AS sessions, COALESCE(SUM(conversions), 0)::int AS conversions,
                count(DISTINCT visitor_hash)::int AS visitors
           FROM tracking_sessions WHERE domain_id = $1 AND ${inRange} GROUP BY 1
       )
       SELECT to_char(d.date, 'YYYY-MM-DD') AS date, COALESCE(s.sessions, 0) AS sessions, COALESCE(s.conversions, 0) AS conversions,
              COALESCE(s.visitors, 0) AS visitors
         FROM d LEFT JOIN s USING (date) ORDER BY d.date`,
      p,
    ),
    query(
      `SELECT channel, count(*)::int AS sessions, count(*) FILTER (WHERE conversions > 0)::int AS converted,
              COALESCE(SUM(conversions), 0)::int AS conversions, AVG(engaged_ms)::int AS avg_engaged_ms
         FROM tracking_sessions WHERE domain_id = $1 AND ${inRange} GROUP BY channel ORDER BY sessions DESC`,
      p,
    ),
    query(
      `SELECT channel, COALESCE(source, '') AS source, count(*)::int AS sessions, count(*) FILTER (WHERE conversions > 0)::int AS converted
         FROM tracking_sessions WHERE domain_id = $1 AND ${inRange} AND channel <> 'direct'
        GROUP BY 1, 2 ORDER BY sessions DESC LIMIT 25`,
      p,
    ),
    query(
      `SELECT landing_path AS path, count(*)::int AS sessions, count(*) FILTER (WHERE conversions > 0)::int AS converted,
              AVG(engaged_ms)::int AS avg_engaged_ms, count(*) FILTER (WHERE channel = 'organic')::int AS organic
         FROM tracking_sessions WHERE domain_id = $1 AND ${inRange} GROUP BY 1 ORDER BY sessions DESC LIMIT 25`,
      p,
    ),
    query(
      `SELECT kind, COALESCE(name, '') AS name, count(*)::int AS count, count(DISTINCT session_id)::int AS sessions
         FROM tracking_conversions WHERE domain_id = $1 AND created_at >= now() - make_interval(days => $2)
        GROUP BY 1, 2 ORDER BY count DESC LIMIT 25`,
      p,
    ),
    query(
      `SELECT device, count(*)::int AS sessions, count(*) FILTER (WHERE conversions > 0)::int AS converted
         FROM tracking_sessions WHERE domain_id = $1 AND ${inRange} GROUP BY 1 ORDER BY sessions DESC`,
      p,
    ),
    query(
      `SELECT COALESCE(country, '') AS country, count(*)::int AS sessions, count(*) FILTER (WHERE conversions > 0)::int AS converted
         FROM tracking_sessions WHERE domain_id = $1 AND ${inRange} GROUP BY 1 ORDER BY sessions DESC LIMIT 12`,
      p,
    ),
    // Gerçek kullanıcı Web Vitals (p75, Google'ın eşik yöntemi); ham sayfa görüntülemeleri sınırlı süre tutulur
    query(
      `SELECT percentile_cont(0.75) WITHIN GROUP (ORDER BY lcp_ms) AS lcp, percentile_cont(0.75) WITHIN GROUP (ORDER BY cls) AS cls,
              percentile_cont(0.75) WITHIN GROUP (ORDER BY inp_ms) AS inp,
              count(lcp_ms)::int AS lcp_n, count(cls)::int AS cls_n, count(inp_ms)::int AS inp_n
         FROM tracking_pageviews WHERE domain_id = $1 AND created_at >= now() - make_interval(days => LEAST($2, $3::int))`,
      [domainId, days, config.tracking.pageviewDays],
    ),
  ]);
  return {
    totals: totals.rows[0],
    daily: daily.rows,
    channels: channels.rows,
    sources: sources.rows,
    landing: landing.rows,
    conversions: conversions.rows,
    devices: devices.rows,
    countries: countries.rows,
    vitals: vitals.rows[0],
  };
}

// ------------------------------------------------------------------ Anahtar kelimeler
export async function keywords(domainId, days) {
  const [model, { rows: groups }, { rows: paid }] = await Promise.all([
    gscModel(domainId),
    query(
      `SELECT landing_path, COALESCE(country, '') AS country, count(*)::int AS sessions, count(*) FILTER (WHERE conversions > 0)::int AS converted
         FROM tracking_sessions
        WHERE domain_id = $1 AND started_at >= now() - make_interval(days => $2) AND channel = 'organic' AND source = 'google'
        GROUP BY 1, 2`,
      [domainId, days],
    ),
    query(
      `SELECT lower(utm_term) AS keyword, count(*)::int AS sessions, count(*) FILTER (WHERE conversions > 0)::int AS converted,
              mode() WITHIN GROUP (ORDER BY source) AS source
         FROM tracking_sessions
        WHERE domain_id = $1 AND started_at >= now() - make_interval(days => $2) AND utm_term IS NOT NULL AND utm_term <> ''
        GROUP BY 1 ORDER BY sessions DESC LIMIT 100`,
      [domainId, days],
    ),
  ]);

  const acc = new Map();
  let organic = 0;
  let matched = 0;
  for (const g of groups) {
    organic += g.sessions;
    const dist = distribution(model, g.landing_path, g.country || null);
    if (!dist.length) continue;
    matched += g.sessions;
    for (const { query: q, p } of dist) {
      const row = acc.get(q) || { keyword: q, sessions: 0, converted: 0, pages: new Map() };
      row.sessions += g.sessions * p;
      row.converted += g.converted * p;
      row.pages.set(g.landing_path, (row.pages.get(g.landing_path) || 0) + g.sessions * p);
      acc.set(q, row);
    }
  }
  const estimated = [...acc.values()]
    .filter((r) => r.sessions >= 0.05)
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 200)
    .map((r) => ({
      keyword: r.keyword,
      sessions: Math.round(r.sessions * 10) / 10,
      converted: Math.round(r.converted * 10) / 10,
      conversionRate: r.sessions ? r.converted / r.sessions : 0,
      page: [...r.pages.entries()].sort((a, b) => b[1] - a[1])[0][0],
    }));
  return { gscAvailable: Boolean(model), coverage: { organic, matched }, estimated, paid };
}

// ------------------------------------------------------------------ Oturumlar
export async function sessions(domainId, { days, page, channel, converted }) {
  const params = [domainId, days, PAGE_SIZE, (page - 1) * PAGE_SIZE];
  const where = ['s.domain_id = $1', 's.started_at >= now() - make_interval(days => $2)'];
  if (channel) where.push(`s.channel = $${params.push(channel)}`);
  if (converted !== undefined) where.push(converted ? 's.conversions > 0' : 's.conversions = 0');
  const { rows } = await query(
    `SELECT s.id, s.started_at, s.last_seen_at, s.landing_path, s.exit_path, s.channel, s.source, s.referrer_host, s.utm_term, s.utm_campaign,
            s.country, s.device, s.pageviews, s.engaged_ms, s.max_scroll, s.conversions,
            (SELECT array_agg(DISTINCT c.kind) FROM tracking_conversions c WHERE c.session_id = s.id) AS conversion_kinds,
            count(*) OVER ()::int AS total
       FROM tracking_sessions s WHERE ${where.join(' AND ')}
      ORDER BY s.started_at DESC LIMIT $3 OFFSET $4`,
    params,
  );
  const model = rows.some(isGoogleOrganic) ? await gscModel(domainId) : null;
  return {
    total: rows[0]?.total || 0,
    pageSize: PAGE_SIZE,
    rows: rows.map(({ total, ...s }) => ({
      ...s,
      likelyKeywords: isGoogleOrganic(s) ? distribution(model, s.landing_path, s.country).slice(0, 3) : [],
    })),
  };
}

/** Tek oturumun yolculuğu: sayfalar ve dönüşümler (ham sayfa verisi saklama süresi içinde). */
export async function sessionDetail(domainId, sessionId) {
  const { rows: [s] } = await query(
    `SELECT id, started_at, landing_path, channel, source, country FROM tracking_sessions WHERE id = $1 AND domain_id = $2`,
    [sessionId, domainId],
  );
  if (!s) throw notFound('Oturum bulunamadı');
  const [{ rows: pages }, { rows: conversions }] = await Promise.all([
    query(
      `SELECT path, created_at, engaged_ms, max_scroll, lcp_ms, cls, inp_ms FROM tracking_pageviews
        WHERE session_id = $1 AND domain_id = $2 ORDER BY created_at`,
      [sessionId, domainId],
    ),
    query('SELECT kind, name, path, created_at FROM tracking_conversions WHERE session_id = $1 AND domain_id = $2 ORDER BY created_at', [sessionId, domainId]),
  ]);
  const model = isGoogleOrganic(s) ? await gscModel(domainId) : null;
  return { pages, conversions, likelyKeywords: model ? distribution(model, s.landing_path, s.country).slice(0, 10) : [] };
}
