import { query } from '../../db/pool.js';
import { POSITION_BUCKETS } from '../../validation/schemas.js';
import { countriesForLanguages, countryIso2, countryLanguages } from './countryLanguages.js';
import { detectLanguages } from './rankingService.js';

/**
 * Search Console'dan ücretsiz lokasyon bazlı sıralamalar (gsc_query_country, son 28 gün).
 * Hedef pazar = sitenin dilinin konuşulduğu ülkeler; kullanıcı dili ayarlardan değiştirebilir.
 */

const escapeLike = (s) => s.replace(/[\\%_]/g, '\\$&');

export async function targetLanguages(domain) {
  if (domain.rank_languages?.length) return { languages: domain.rank_languages, detected: await detectLanguages(domain), custom: true };
  const detected = await detectLanguages(domain);
  return { languages: detected.filter((d, i) => i === 0 || d.share >= 0.1).map((d) => d.code), detected, custom: false };
}

async function targetCountries(domain) {
  const lang = await targetLanguages(domain);
  return { ...lang, countries: countriesForLanguages(lang.languages) };
}

const withCountry = (r) => ({ ...r, iso2: countryIso2(r.country), languages: countryLanguages(r.country) });

export async function summary(domain, scope) {
  const t = await targetCountries(domain);
  const { rows } = await query(
    `SELECT country, count(*)::int AS keywords,
            count(*) FILTER (WHERE position <= 3)::int AS top3,
            count(*) FILTER (WHERE position <= 10)::int AS top10,
            count(*) FILTER (WHERE position > 10 AND position <= 20)::int AS top20,
            sum(clicks)::int AS clicks, sum(impressions)::int AS impressions,
            sum(prev_clicks)::int AS prev_clicks,
            round((sum(position * impressions) / NULLIF(sum(impressions), 0))::numeric, 1)::float AS position
       FROM gsc_query_country WHERE domain_id = $1
        AND ($2::boolean = false OR country = ANY($3::text[]))
      GROUP BY country ORDER BY sum(impressions) DESC LIMIT 250`,
    [domain.id, scope === 'target', t.countries],
  );
  const target = new Set(t.countries);
  return {
    languages: t.languages,
    languagesCustom: t.custom,
    detected: t.detected,
    synced: Boolean(domain.last_synced_at),
    countries: rows.map((r) => ({ ...withCountry(r), isTarget: target.has(r.country) })),
  };
}

const SORT = {
  position: 'q.position', clicks: 'q.clicks', impressions: 'q.impressions', ctr: 'ctr', query: 'q.query', change: 'change',
};

export async function keywords(domain, { country, search, bucket, sort, order, page, pageSize }) {
  const params = [domain.id, country];
  const filters = ['q.domain_id = $1', 'q.country = $2'];
  if (search) {
    params.push(`%${escapeLike(search)}%`);
    filters.push(`q.query ILIKE $${params.length} ESCAPE '\\'`);
  }
  if (bucket) {
    const [min, max] = POSITION_BUCKETS[bucket];
    params.push(min, max);
    filters.push(`q.position > $${params.length - 1} AND q.position <= $${params.length}`);
  }
  params.push(pageSize, (page - 1) * pageSize);
  const dir = order === 'asc' ? 'ASC' : 'DESC';
  const { rows } = await query(
    `SELECT q.query, round(q.position::numeric, 1)::float AS position, round(q.prev_position::numeric, 1)::float AS prev_position,
            round((q.prev_position - q.position)::numeric, 1)::float AS change,
            q.clicks, q.impressions, q.prev_clicks, q.clicks::float / NULLIF(q.impressions, 0) AS ctr,
            (SELECT p.page FROM gsc_query_page p WHERE p.domain_id = q.domain_id AND p.query = q.query
              ORDER BY p.clicks DESC, p.impressions DESC LIMIT 1) AS page,
            COUNT(*) OVER ()::int AS total
       FROM gsc_query_country q
      WHERE ${filters.join(' AND ')}
      ORDER BY ${SORT[sort]} ${dir} NULLS LAST, q.impressions DESC, q.query ASC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { total: rows[0]?.total || 0, rows: rows.map(({ total, ...r }) => r) };
}

/** Ülke karşılaştırması: hedef ülkelerde (en çok gösterim alan 15 ülke) kelime pozisyonları. */
export async function matrix(domain, { scope, search, page, pageSize }) {
  const t = await targetCountries(domain);
  const { rows: countries } = await query(
    `SELECT country FROM gsc_query_country WHERE domain_id = $1 AND ($2::boolean = false OR country = ANY($3::text[]))
      GROUP BY country ORDER BY sum(impressions) DESC LIMIT 15`,
    [domain.id, scope === 'target', t.countries],
  );
  const list = countries.map((c) => c.country);
  if (!list.length) return { countries: [], total: 0, rows: [] };
  const params = [domain.id, list];
  let filter = '';
  if (search) {
    params.push(`%${escapeLike(search)}%`);
    filter = `AND query ILIKE $${params.length} ESCAPE '\\'`;
  }
  params.push(pageSize, (page - 1) * pageSize);
  const { rows } = await query(
    `SELECT query, count(*)::int AS countries, sum(impressions)::int AS impressions, sum(clicks)::int AS clicks,
            round(min(position)::numeric, 1)::float AS best_position,
            json_object_agg(country, round(position::numeric, 1)) AS positions,
            COUNT(*) OVER ()::int AS total
       FROM gsc_query_country WHERE domain_id = $1 AND country = ANY($2::text[]) ${filter}
      GROUP BY query ORDER BY count(*) DESC, sum(impressions) DESC, query
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return {
    countries: list.map((c) => ({ country: c, iso2: countryIso2(c) })),
    total: rows[0]?.total || 0,
    rows: rows.map(({ total, ...r }) => r),
  };
}

/** Tek kelime: tüm ülkelerdeki pozisyonu + kelimeyi içeren benzer sorgular. */
export async function lookup(domain, keyword) {
  const t = await targetCountries(domain);
  const target = new Set(t.countries);
  const [exact, related] = await Promise.all([
    query(
      `SELECT country, round(position::numeric, 1)::float AS position, round(prev_position::numeric, 1)::float AS prev_position,
              clicks, impressions FROM gsc_query_country
        WHERE domain_id = $1 AND lower(query) = lower($2) ORDER BY impressions DESC LIMIT 250`,
      [domain.id, keyword],
    ),
    query(
      `SELECT query, count(*)::int AS countries, sum(impressions)::int AS impressions, sum(clicks)::int AS clicks,
              round((sum(position * impressions) / NULLIF(sum(impressions), 0))::numeric, 1)::float AS position
         FROM gsc_query_country WHERE domain_id = $1 AND query ILIKE $2 ESCAPE '\\' AND lower(query) <> lower($3)
        GROUP BY query ORDER BY sum(impressions) DESC LIMIT 20`,
      [domain.id, `%${escapeLike(keyword)}%`, keyword],
    ),
  ]);
  return {
    keyword,
    countries: exact.rows.map((r) => ({ ...withCountry(r), isTarget: target.has(r.country) })),
    related: related.rows,
  };
}
