import { query } from '../db/pool.js';
import { POSITION_BUCKETS } from '../validation/schemas.js';

const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Verideki son günü baz alır (GSC 2-3 gün gecikmeli veri sunar). */
export async function getRange(domainIds, days) {
  const { rows } = await query('SELECT max(date) AS end FROM gsc_daily WHERE domain_id = ANY($1::uuid[])', [domainIds]);
  const end = rows[0].end;
  if (!end) return null;
  const start = addDays(end, -(days - 1));
  return { start, end, prevStart: addDays(start, -days), prevEnd: addDays(start, -1) };
}

const escapeLike = (s) => s.replace(/[\\%_]/g, '\\$&');

const SORT_COLUMNS = {
  clicks: 'c.clicks',
  impressions: 'c.impressions',
  ctr: 'ctr',
  position: 'c.position',
  change: 'change',
  query: 'c.key',
  page: 'c.key',
};

/**
 * Boyut tablolarından (query/page) dönem karşılaştırmalı, filtreli ve sayfalı liste.
 * `table` ve `col` yalnızca bu dosyadaki sabitlerden gelir.
 */
/**
 * Marka araması: kelime (boşluk/tire olmadan) alan adının ana etiketini içeriyor mu (ör. "hair neva" -> hairneva.com).
 * 4 karakterden kısa etiketlerde yanlış eşleşmeyi önlemek için uygulanmaz.
 */
const BRAND_EXPR = `(SELECT length(b) >= 4 AND translate(lower(c.key), ' -', '') LIKE '%' || b || '%'
   FROM (SELECT translate(split_part(regexp_replace(lower(d.hostname), '^www\\.', ''), '.', 1), '-', '') AS b
           FROM domains d WHERE d.id = c.domain_id) x)`;

async function dimensionList({ table, col, domainIds, range, search, bucket, sort, order, page, pageSize, country, minImpressions, brand }) {
  const params = [domainIds, range.start, range.end, range.prevStart, range.prevEnd];
  // Ülke filtresi yalnızca ülke kolonu olan tabloda (gsc_query_country_daily) kullanılır
  let countryFilter = '';
  if (country) {
    params.push(country);
    countryFilter = ` AND country = $${params.length}`;
  }
  const filters = [];
  if (search) {
    params.push(`%${escapeLike(search)}%`);
    filters.push(`c.key ILIKE $${params.length} ESCAPE '\\'`);
  }
  if (bucket) {
    const [min, max] = POSITION_BUCKETS[bucket];
    params.push(min, max);
    filters.push(`c.position > $${params.length - 1} AND c.position <= $${params.length}`);
  }
  if (minImpressions) {
    params.push(minImpressions);
    filters.push(`c.impressions >= $${params.length}`);
  }
  const isBrand = col === 'query' ? BRAND_EXPR : 'false';
  if (brand === 'exclude') filters.push(`NOT COALESCE(${isBrand}, false)`);
  if (brand === 'only') filters.push(`COALESCE(${isBrand}, false)`);
  params.push(pageSize, (page - 1) * pageSize);
  const dir = order === 'asc' ? 'ASC' : 'DESC';

  const sql = `
    WITH cur AS (
      SELECT domain_id, ${col} AS key, SUM(clicks)::int AS clicks, SUM(impressions)::int AS impressions,
             SUM(position * impressions) / NULLIF(SUM(impressions), 0) AS position
        FROM ${table}
       WHERE domain_id = ANY($1::uuid[]) AND date BETWEEN $2 AND $3${countryFilter}
       GROUP BY domain_id, ${col}
    ), prev AS (
      SELECT domain_id, ${col} AS key, SUM(clicks)::int AS clicks,
             SUM(position * impressions) / NULLIF(SUM(impressions), 0) AS position
        FROM ${table}
       WHERE domain_id = ANY($1::uuid[]) AND date BETWEEN $4 AND $5${countryFilter}
       GROUP BY domain_id, ${col}
    )
    SELECT c.domain_id, c.key, c.clicks, c.impressions, ROUND(c.position::numeric, 1)::float AS position,
           c.clicks::float / NULLIF(c.impressions, 0) AS ctr,
           p.clicks AS prev_clicks, ROUND(p.position::numeric, 1)::float AS prev_position,
           (p.position - c.position) AS change, COALESCE(${isBrand}, false) AS is_brand,
           COUNT(*) OVER () AS total
      FROM cur c LEFT JOIN prev p ON p.domain_id = c.domain_id AND p.key = c.key
     ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
     ORDER BY ${SORT_COLUMNS[sort]} ${dir} NULLS LAST, c.clicks DESC, c.key ASC
     LIMIT $${params.length - 1} OFFSET $${params.length}`;

  const { rows } = await query(sql, params);
  return {
    total: rows[0]?.total || 0,
    rows: rows.map(({ total, change, ...r }) => ({ ...r, change: change === null ? null : Number(Number(change).toFixed(1)) })),
  };
}

export async function keywordList(domainIds, opts, range) {
  const table = opts.country ? 'gsc_query_country_daily' : 'gsc_query_daily';
  const result = await dimensionList({ table, col: 'query', domainIds, range, ...opts });
  if (!result.rows.length) return result;
  // Her anahtar kelime için en çok tıklanan sıralanan URL
  const { rows } = await query(
    `SELECT DISTINCT ON (domain_id, query) domain_id, query, page
       FROM gsc_query_page
      WHERE domain_id = ANY($1::uuid[]) AND query = ANY($2::text[])
      ORDER BY domain_id, query, clicks DESC, impressions DESC`,
    [domainIds, result.rows.map((r) => r.key)],
  );
  const map = new Map(rows.map((r) => [`${r.domain_id}|${r.query}`, r.page]));
  result.rows.forEach((r) => (r.url = map.get(`${r.domain_id}|${r.key}`) || null));
  return result;
}

export const pageList = (domainIds, opts, range) =>
  dimensionList({ table: 'gsc_page_daily', col: 'page', domainIds, range, ...opts, bucket: undefined, country: undefined });

async function totals(domainIds, start, end) {
  const { rows } = await query(
    `SELECT COALESCE(SUM(clicks), 0)::int AS clicks, COALESCE(SUM(impressions), 0)::int AS impressions,
            SUM(position * impressions) / NULLIF(SUM(impressions), 0) AS position
       FROM gsc_daily WHERE domain_id = ANY($1::uuid[]) AND date BETWEEN $2 AND $3`,
    [domainIds, start, end],
  );
  const t = rows[0];
  return {
    clicks: t.clicks,
    impressions: t.impressions,
    ctr: t.impressions ? t.clicks / t.impressions : 0,
    position: t.position === null ? null : Number(Number(t.position).toFixed(1)),
  };
}

export async function performance(domainId, range) {
  const [current, previous, daily, keywordCount] = await Promise.all([
    totals([domainId], range.start, range.end),
    totals([domainId], range.prevStart, range.prevEnd),
    query(
      `SELECT date, clicks, impressions, ROUND(position::numeric, 1)::float AS position,
              clicks::float / NULLIF(impressions, 0) AS ctr
         FROM gsc_daily WHERE domain_id = $1 AND date BETWEEN $2 AND $3 ORDER BY date`,
      [domainId, range.start, range.end],
    ),
    query(
      `SELECT COUNT(DISTINCT query)::int AS n FROM gsc_query_daily WHERE domain_id = $1 AND date BETWEEN $2 AND $3`,
      [domainId, range.start, range.end],
    ),
  ]);
  return { range, current: { ...current, keywords: keywordCount.rows[0].n }, previous, daily: daily.rows };
}

export async function breakdown(domainId, range, dimension) {
  const table = dimension === 'country' ? 'gsc_country_daily' : 'gsc_device_daily';
  const { rows } = await query(
    `WITH cur AS (
       SELECT ${dimension} AS key, SUM(clicks)::int AS clicks, SUM(impressions)::int AS impressions,
              SUM(position * impressions) / NULLIF(SUM(impressions), 0) AS position
         FROM ${table} WHERE domain_id = $1 AND date BETWEEN $2 AND $3 GROUP BY ${dimension}
     ), prev AS (
       SELECT ${dimension} AS key, SUM(clicks)::int AS clicks
         FROM ${table} WHERE domain_id = $1 AND date BETWEEN $4 AND $5 GROUP BY ${dimension}
     )
     SELECT c.key, c.clicks, c.impressions, ROUND(c.position::numeric, 1)::float AS position,
            c.clicks::float / NULLIF(c.impressions, 0) AS ctr, p.clicks AS prev_clicks
       FROM cur c LEFT JOIN prev p USING (key)
      ORDER BY c.clicks DESC, c.impressions DESC
      LIMIT 100`,
    [domainId, range.start, range.end, range.prevStart, range.prevEnd],
  );
  return rows;
}

/** Ülke filtresi için seçenekler: dönemde gösterim alan ülkeler (çoktan aza). */
export async function countryList(domainIds, range) {
  const { rows } = await query(
    `SELECT country AS key, SUM(clicks)::int AS clicks, SUM(impressions)::int AS impressions
       FROM gsc_country_daily WHERE domain_id = ANY($1::uuid[]) AND date BETWEEN $2 AND $3
      GROUP BY country ORDER BY SUM(impressions) DESC LIMIT 250`,
    [domainIds, range.start, range.end],
  );
  return rows;
}

export async function positionDistribution(domainIds, range, country) {
  const table = country ? 'gsc_query_country_daily' : 'gsc_query_daily';
  const { rows } = await query(
    `WITH agg AS (
       SELECT domain_id, query, SUM(position * impressions) / NULLIF(SUM(impressions), 0) AS position
         FROM ${table} WHERE domain_id = ANY($1::uuid[]) AND date BETWEEN $2 AND $3
          ${country ? 'AND country = $4' : ''}
        GROUP BY domain_id, query
     )
     SELECT COUNT(*) FILTER (WHERE position <= 3)::int AS top3,
            COUNT(*) FILTER (WHERE position > 3 AND position <= 10)::int AS top10,
            COUNT(*) FILTER (WHERE position > 10 AND position <= 20)::int AS top20,
            COUNT(*) FILTER (WHERE position > 20 AND position <= 50)::int AS top50,
            COUNT(*) FILTER (WHERE position > 50)::int AS rest
       FROM agg`,
    country ? [domainIds, range.start, range.end, country] : [domainIds, range.start, range.end],
  );
  return rows[0];
}

export async function keywordTrend(domainId, keyword, range) {
  const { rows } = await query(
    `SELECT date, clicks, impressions, ROUND(position::numeric, 1)::float AS position
       FROM gsc_query_daily WHERE domain_id = $1 AND query = $2 AND date BETWEEN $3 AND $4 ORDER BY date`,
    [domainId, keyword, range.start, range.end],
  );
  const pages = await query(
    `SELECT page, clicks, impressions, ROUND(position::numeric, 1)::float AS position
       FROM gsc_query_page WHERE domain_id = $1 AND query = $2 ORDER BY clicks DESC, impressions DESC LIMIT 10`,
    [domainId, keyword],
  );
  // Kelimenin her ülkedeki sırası (seçili dönem ve önceki dönem)
  const countries = await query(
    `WITH cur AS (
       SELECT country, SUM(clicks)::int AS clicks, SUM(impressions)::int AS impressions,
              SUM(position * impressions) / NULLIF(SUM(impressions), 0) AS position
         FROM gsc_query_country_daily WHERE domain_id = $1 AND query = $2 AND date BETWEEN $3 AND $4 GROUP BY country
     ), prev AS (
       SELECT country, SUM(position * impressions) / NULLIF(SUM(impressions), 0) AS position
         FROM gsc_query_country_daily WHERE domain_id = $1 AND query = $2 AND date BETWEEN $5 AND $6 GROUP BY country
     )
     SELECT c.country, c.clicks, c.impressions, ROUND(c.position::numeric, 1)::float AS position,
            ROUND(p.position::numeric, 1)::float AS prev_position
       FROM cur c LEFT JOIN prev p USING (country)
      ORDER BY c.impressions DESC LIMIT 250`,
    [domainId, keyword, range.start, range.end, range.prevStart, range.prevEnd],
  );
  return { daily: rows, pages: pages.rows, countries: countries.rows };
}

/** Beklenen CTR (pozisyona göre yaklaşık sektör ortalaması) — düşük CTR fırsatları için. */
const EXPECTED_CTR = [0, 0.28, 0.15, 0.1, 0.07, 0.05, 0.04, 0.03, 0.025, 0.02, 0.018];
const expectedCtr = (pos) => EXPECTED_CTR[Math.min(10, Math.max(1, Math.round(pos)))] ?? 0.01;

export async function opportunities(domainIds, range) {
  const params = [domainIds, range.start, range.end, range.prevStart, range.prevEnd];
  const base = `
    WITH cur AS (
      SELECT domain_id, query, SUM(clicks)::int AS clicks, SUM(impressions)::int AS impressions,
             SUM(position * impressions) / NULLIF(SUM(impressions), 0) AS position
        FROM gsc_query_daily WHERE domain_id = ANY($1::uuid[]) AND date BETWEEN $2 AND $3
       GROUP BY domain_id, query
    ), prev AS (
      SELECT domain_id, query, SUM(clicks)::int AS clicks,
             SUM(position * impressions) / NULLIF(SUM(impressions), 0) AS position
        FROM gsc_query_daily WHERE domain_id = ANY($1::uuid[]) AND date BETWEEN $4 AND $5
       GROUP BY domain_id, query
    )`;
  const cols = `c.domain_id, c.query, c.clicks, c.impressions, ROUND(c.position::numeric, 1)::float AS position,
                c.clicks::float / NULLIF(c.impressions, 0) AS ctr`;

  const [striking, lowCtr, declining, rising] = await Promise.all([
    // 2. sayfanın başı / 1. sayfanın altı: küçük iyileştirmeyle büyük trafik
    query(`${base} SELECT ${cols} FROM cur c WHERE c.position > 4 AND c.position <= 20 AND c.impressions >= 20
           ORDER BY c.impressions DESC LIMIT 25`, params),
    query(`${base} SELECT ${cols} FROM cur c WHERE c.position <= 10 AND c.impressions >= 100
           ORDER BY c.impressions DESC LIMIT 200`, params),
    query(`${base} SELECT ${cols}, p.clicks AS prev_clicks, ROUND(p.position::numeric, 1)::float AS prev_position
           FROM cur c JOIN prev p USING (domain_id, query)
           WHERE p.clicks >= 5 AND c.clicks < p.clicks
           ORDER BY (p.clicks - c.clicks) DESC LIMIT 25`, params),
    query(`${base} SELECT ${cols}, p.clicks AS prev_clicks, ROUND(p.position::numeric, 1)::float AS prev_position
           FROM cur c JOIN prev p USING (domain_id, query)
           WHERE c.clicks > p.clicks AND c.clicks >= 5
           ORDER BY (c.clicks - p.clicks) DESC LIMIT 25`, params),
  ]);

  const low = lowCtr.rows
    .map((r) => ({ ...r, expectedCtr: expectedCtr(r.position) }))
    .filter((r) => r.ctr < r.expectedCtr * 0.5)
    .map((r) => ({ ...r, potentialClicks: Math.round(r.impressions * r.expectedCtr - r.clicks) }))
    .sort((a, b) => b.potentialClicks - a.potentialClicks)
    .slice(0, 25);

  return {
    strikingDistance: striking.rows.map((r) => ({
      ...r,
      potentialClicks: Math.max(0, Math.round(r.impressions * expectedCtr(3) - r.clicks)),
    })),
    lowCtr: low,
    declining: declining.rows,
    rising: rising.rows,
  };
}

export async function domainSummaries(userId) {
  const { rows } = await query(
    `WITH d AS (
       SELECT id, hostname, gsc_property, sync_status, sync_error, last_synced_at, created_at
         FROM domains WHERE user_id = $1
     ), bounds AS (
       SELECT g.domain_id, max(g.date) AS end_d FROM gsc_daily g JOIN d ON d.id = g.domain_id GROUP BY g.domain_id
     ), cur AS (
       SELECT g.domain_id, SUM(g.clicks)::int AS clicks, SUM(g.impressions)::int AS impressions,
              SUM(g.position * g.impressions) / NULLIF(SUM(g.impressions), 0) AS position,
              json_agg(json_build_object('date', g.date, 'clicks', g.clicks) ORDER BY g.date) AS spark
         FROM gsc_daily g JOIN bounds b ON b.domain_id = g.domain_id
        WHERE g.date > b.end_d - 28 GROUP BY g.domain_id
     ), prev AS (
       SELECT g.domain_id, SUM(g.clicks)::int AS clicks, SUM(g.impressions)::int AS impressions
         FROM gsc_daily g JOIN bounds b ON b.domain_id = g.domain_id
        WHERE g.date > b.end_d - 56 AND g.date <= b.end_d - 28 GROUP BY g.domain_id
     ), audit AS (
       SELECT DISTINCT ON (a.domain_id) a.domain_id, a.score, a.status, a.finished_at
         FROM audits a JOIN d ON d.id = a.domain_id
        WHERE a.status IN ('completed', 'running', 'queued')
        ORDER BY a.domain_id, a.created_at DESC
     ), site AS (
       SELECT DISTINCT ON (a.domain_id) a.domain_id, a.pages_crawled,
              (SELECT count(DISTINCT k.keyword) FROM audit_keywords k WHERE k.audit_id = a.id)::int AS site_keywords,
              (SELECT round(avg(ap.onpage_score))::int FROM audit_pages ap WHERE ap.audit_id = a.id) AS avg_onpage
         FROM audits a JOIN d ON d.id = a.domain_id
        WHERE a.status = 'completed'
        ORDER BY a.domain_id, a.created_at DESC
     ), psi AS (
       SELECT DISTINCT ON (p.domain_id) p.domain_id, p.performance
         FROM pagespeed_reports p JOIN d ON d.id = p.domain_id
        WHERE p.status = 'completed' AND p.strategy = 'mobile'
        ORDER BY p.domain_id, p.created_at DESC
     )
     SELECT d.*, cur.clicks, cur.impressions, ROUND(cur.position::numeric, 1)::float AS position, cur.spark,
            prev.clicks AS prev_clicks, prev.impressions AS prev_impressions,
            audit.score AS health_score, audit.status AS audit_status, psi.performance AS mobile_performance,
            site.pages_crawled, site.site_keywords, site.avg_onpage
       FROM d
       LEFT JOIN cur ON cur.domain_id = d.id
       LEFT JOIN prev ON prev.domain_id = d.id
       LEFT JOIN audit ON audit.domain_id = d.id
       LEFT JOIN site ON site.domain_id = d.id
       LEFT JOIN psi ON psi.domain_id = d.id
      ORDER BY cur.clicks DESC NULLS LAST, d.created_at DESC`,
    [userId],
  );
  return rows;
}
