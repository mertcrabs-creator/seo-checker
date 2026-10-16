import * as cheerio from 'cheerio';
import { config } from '../../config.js';
import { bulkInsert } from '../../db/bulk.js';
import { query, withTransaction } from '../../db/pool.js';
import { safeFetch } from '../../utils/safeFetch.js';
import { POSITION_BUCKETS } from '../../validation/schemas.js';
import { labsLocations, rankedKeywords, serpPosition } from './dataforseo.js';

/**
 * Lokasyon bazlı Google sıralamaları. Sitenin dili (html lang) tespit edilir ve o dilin
 * DataForSEO'da desteklendiği tüm ülkelerde sıralamalar çekilir. Kullanıcı dil/ülke seçimini daraltabilir.
 */

const primaryLang = (v) => String(v || '').toLowerCase().trim().split(/[-_]/)[0];
const matchesLang = (code, lang) => code === lang || code.startsWith(`${lang}-`);
const bareHost = (h) => h.replace(/^www\./, '');
const escapeLike = (s) => s.replace(/[\\%_]/g, '\\$&');

/** Promise havuzu: en fazla `limit` iş aynı anda. */
async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ------------------------------------------------------------------ Dil ve ülke tespiti
export async function detectLanguages(domain) {
  const { rows } = await query(
    `WITH a AS (SELECT id FROM audits WHERE domain_id = $1 AND status = 'completed' ORDER BY created_at DESC LIMIT 1)
     SELECT lower(split_part(replace(p.lang, '_', '-'), '-', 1)) AS code, count(*)::int AS pages
       FROM audit_pages p JOIN a ON a.id = p.audit_id
      WHERE p.lang IS NOT NULL AND p.lang <> '' GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
    [domain.id],
  );
  if (rows.length) {
    const total = rows.reduce((s, r) => s + r.pages, 0);
    return rows.map((r) => ({ code: r.code, pages: r.pages, share: r.pages / total }));
  }
  // Henüz tarama yoksa ana sayfanın html lang değerine bak
  try {
    const res = await safeFetch(`https://${domain.hostname}/`, { timeoutMs: 15_000, maxBytes: 2 * 1024 * 1024 });
    const lang = primaryLang(cheerio.load(res.body)('html').attr('lang'));
    if (/^[a-z]{2,3}$/.test(lang)) return [{ code: lang, pages: 1, share: 1 }];
  } catch {
    /* siteye ulaşılamadı */
  }
  return [];
}

/** Etkin diller: kullanıcı seçimi yoksa sayfaların en az %10'unda kullanılan diller. */
function effectiveLanguages(domain, detected) {
  if (domain.rank_languages?.length) return domain.rank_languages;
  const auto = detected.filter((d, i) => i === 0 || d.share >= 0.1).map((d) => d.code);
  return auto;
}

/** Dillere uyan tüm ülke+dil kombinasyonları (büyük pazarlar önce). */
function candidateTargets(locations, languages) {
  const targets = [];
  for (const loc of locations) {
    for (const lang of loc.languages) {
      if (!languages.some((l) => matchesLang(lang.code, l))) continue;
      targets.push({
        locationCode: loc.locationCode, locationName: loc.locationName, countryIso: loc.countryIso,
        languageCode: lang.code, languageName: lang.name, keywords: lang.keywords,
      });
    }
  }
  return targets.sort((a, b) => (b.keywords || 0) - (a.keywords || 0));
}

async function resolveTargets(domain) {
  const [locations, detected] = await Promise.all([labsLocations(), detectLanguages(domain)]);
  const languages = effectiveLanguages(domain, detected);
  const candidates = candidateTargets(locations, languages);
  const selected = domain.rank_locations?.length ? candidates.filter((t) => domain.rank_locations.includes(t.locationCode)) : candidates;
  return { locations, detected, languages, candidates, targets: selected.slice(0, config.dataforseo.maxLocations) };
}

export async function getConfig(domain) {
  if (!config.dataforseo.enabled) return { enabled: false };
  const { locations, detected, languages, candidates, targets } = await resolveTargets(domain);
  const langNames = new Map();
  for (const l of locations) for (const lang of l.languages) if (!langNames.has(lang.code)) langNames.set(lang.code, lang.name);
  const selected = new Set(targets.map((t) => `${t.locationCode}:${t.languageCode}`));
  return {
    enabled: true,
    status: domain.rank_status,
    error: domain.rank_error,
    updatedAt: domain.rank_updated_at,
    detected: detected.map((d) => ({ ...d, name: langNames.get(d.code) || null })),
    languages,
    languagesCustom: Boolean(domain.rank_languages?.length),
    locationsCustom: Boolean(domain.rank_locations?.length),
    availableLanguages: [...langNames].map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name)),
    candidates: candidates.map((t) => ({ ...t, selected: selected.has(`${t.locationCode}:${t.languageCode}`) })),
    maxLocations: config.dataforseo.maxLocations,
    checkDepth: config.dataforseo.checkDepth,
  };
}

export async function saveConfig(domain, { languages, locations }) {
  await query('UPDATE domains SET rank_languages = $2, rank_locations = $3 WHERE id = $1', [domain.id, languages, locations]);
}

// ------------------------------------------------------------------ Güncelleme işi
export async function prepareRefresh(domain) {
  const { targets } = await resolveTargets(domain);
  if (!targets.length) return [];
  await query("UPDATE domains SET rank_status = 'running', rank_error = NULL WHERE id = $1", [domain.id]);
  const { rows } = await query(
    `INSERT INTO rank_snapshots (domain_id, location_code, location_name, country_iso, language_code)
     SELECT $1, * FROM unnest($2::int[], $3::text[], $4::text[], $5::text[]) RETURNING id, location_code, language_code`,
    [domain.id, targets.map((t) => t.locationCode), targets.map((t) => t.locationName), targets.map((t) => t.countryIso), targets.map((t) => t.languageCode)],
  );
  return rows;
}

export async function runRefresh(domain, snapshots) {
  const target = bareHost(domain.hostname);
  const outcomes = await pool(snapshots, 3, async (s) => {
    try {
      const r = await rankedKeywords(target, s.location_code, s.language_code);
      await withTransaction(async (client) => {
        await bulkInsert(
          client,
          'rank_keywords',
          ['snapshot_id', 'keyword', 'position', 'position_absolute', 'previous_position', 'is_new', 'url', 'search_volume', 'cpc', 'competition', 'difficulty', 'intent', 'etv'],
          ['uuid', 'text', 'int', 'int', 'int', 'bool', 'text', 'int', 'real', 'real', 'int', 'text', 'real'],
          r.items.map((k) => [s.id, k.keyword, k.position, k.positionAbsolute, k.previousPosition, k.isNew, k.url, k.searchVolume, k.cpc, k.competition, k.difficulty, k.intent, k.etv]),
        );
        await client.query(
          `UPDATE rank_snapshots SET status = 'completed', total_count = $2, etv = $3, metrics = $4, finished_at = now() WHERE id = $1`,
          [s.id, r.totalCount, r.metrics?.etv ?? null, r.metrics ? JSON.stringify(r.metrics) : null],
        );
      });
      return null;
    } catch (err) {
      await query("UPDATE rank_snapshots SET status = 'failed', error = $2, finished_at = now() WHERE id = $1", [s.id, String(err.message).slice(0, 500)]);
      return err.message;
    }
  });
  const errors = outcomes.filter(Boolean);
  const allFailed = errors.length === snapshots.length;
  await query(
    `UPDATE domains SET rank_status = $2, rank_error = $3, rank_updated_at = CASE WHEN $2 = 'idle' THEN now() ELSE rank_updated_at END WHERE id = $1`,
    [domain.id, allFailed ? 'failed' : 'idle', errors.length ? `${errors.length} ülke başarısız: ${errors[0]}`.slice(0, 500) : null],
  );
}

// ------------------------------------------------------------------ Okuma
const LATEST = `
  SELECT DISTINCT ON (location_code, language_code) id, location_code, location_name, country_iso, language_code,
         total_count, etv, metrics, finished_at
    FROM rank_snapshots WHERE domain_id = $1 AND status = 'completed'
   ORDER BY location_code, language_code, created_at DESC`;

export async function summary(domain) {
  const { rows } = await query(
    `WITH latest AS (${LATEST}),
     prev AS (
       SELECT DISTINCT ON (s.location_code, s.language_code) s.location_code, s.language_code, s.total_count
         FROM rank_snapshots s JOIN latest l ON l.location_code = s.location_code AND l.language_code = s.language_code
        WHERE s.domain_id = $1 AND s.status = 'completed' AND s.id <> l.id AND s.created_at < l.finished_at
        ORDER BY s.location_code, s.language_code, s.created_at DESC
     ), stats AS (
       SELECT k.snapshot_id, count(*) FILTER (WHERE k.position <= 3)::int AS top3, count(*) FILTER (WHERE k.position <= 10)::int AS top10,
              count(*) FILTER (WHERE k.position BETWEEN 11 AND 20)::int AS top20, count(*)::int AS fetched
         FROM rank_keywords k JOIN latest l ON l.id = k.snapshot_id GROUP BY k.snapshot_id
     )
     SELECT l.id, l.location_code, l.location_name, l.country_iso, l.language_code, l.total_count, l.etv, l.metrics, l.finished_at,
            p.total_count AS prev_total, COALESCE(st.top3, 0) AS top3, COALESCE(st.top10, 0) AS top10,
            COALESCE(st.top20, 0) AS top20, COALESCE(st.fetched, 0) AS fetched
       FROM latest l LEFT JOIN prev p ON p.location_code = l.location_code AND p.language_code = l.language_code
       LEFT JOIN stats st ON st.snapshot_id = l.id
      ORDER BY l.etv DESC NULLS LAST, l.total_count DESC NULLS LAST`,
    [domain.id],
  );
  const failed = await query(
    `SELECT DISTINCT ON (location_code, language_code) location_name, language_code, error FROM rank_snapshots
      WHERE domain_id = $1 AND status = 'failed' AND created_at > now() - interval '1 day'
      ORDER BY location_code, language_code, created_at DESC LIMIT 20`,
    [domain.id],
  );
  return { locations: rows, failed: failed.rows };
}

const KEYWORD_SORT = {
  position: 'k.position', search_volume: 'k.search_volume', etv: 'k.etv', keyword: 'k.keyword',
  difficulty: 'k.difficulty', cpc: 'k.cpc', change: 'change',
};

export async function keywordList(domain, { locationCode, languageCode, search, bucket, sort, order, page, pageSize }) {
  const params = [domain.id, locationCode, languageCode];
  const filters = [];
  if (search) {
    params.push(`%${escapeLike(search)}%`);
    filters.push(`(k.keyword ILIKE $${params.length} ESCAPE '\\' OR k.url ILIKE $${params.length} ESCAPE '\\')`);
  }
  if (bucket) {
    const [min, max] = POSITION_BUCKETS[bucket];
    params.push(min, max);
    filters.push(`k.position > $${params.length - 1} AND k.position <= $${params.length}`);
  }
  params.push(pageSize, (page - 1) * pageSize);
  const dir = order === 'asc' ? 'ASC' : 'DESC';
  const { rows } = await query(
    `WITH s AS (
       SELECT id FROM rank_snapshots WHERE domain_id = $1 AND location_code = $2 AND language_code = $3 AND status = 'completed'
        ORDER BY created_at DESC LIMIT 1
     )
     SELECT k.keyword, k.position, k.previous_position, k.is_new, k.url, k.search_volume, k.cpc, k.competition, k.difficulty,
            k.intent, round(k.etv::numeric, 1)::float AS etv, (k.previous_position - k.position_absolute) AS change,
            COUNT(*) OVER ()::int AS total
       FROM rank_keywords k JOIN s ON s.id = k.snapshot_id
      ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
      ORDER BY ${KEYWORD_SORT[sort]} ${dir} NULLS LAST, k.search_volume DESC NULLS LAST, k.keyword ASC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { total: rows[0]?.total || 0, rows: rows.map(({ total, ...r }) => r) };
}

/** Ülke karşılaştırması: en çok ülkede sıralanan / en çok aranan kelimelerin ülke bazında pozisyonları. */
export async function matrix(domain, { search, page, pageSize }) {
  const params = [domain.id];
  let filter = '';
  if (search) {
    params.push(`%${escapeLike(search)}%`);
    filter = `WHERE k.keyword ILIKE $${params.length} ESCAPE '\\'`;
  }
  params.push(pageSize, (page - 1) * pageSize);
  const [locations, rows] = await Promise.all([
    query(`WITH latest AS (${LATEST}) SELECT location_code, location_name, country_iso, language_code FROM latest ORDER BY etv DESC NULLS LAST`, [domain.id]),
    query(
      `WITH latest AS (${LATEST})
       SELECT k.keyword, max(k.search_volume)::int AS max_volume, sum(k.etv)::float AS etv, count(*)::int AS locations,
              min(k.position)::int AS best_position,
              json_object_agg(l.location_code || ':' || l.language_code, k.position) AS positions,
              COUNT(*) OVER ()::int AS total
         FROM rank_keywords k JOIN latest l ON l.id = k.snapshot_id
        ${filter}
        GROUP BY k.keyword
        ORDER BY count(*) DESC, sum(k.etv) DESC NULLS LAST, k.keyword
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    ),
  ]);
  return { locations: locations.rows, total: rows.rows[0]?.total || 0, rows: rows.rows.map(({ total, ...r }) => r) };
}

// ------------------------------------------------------------------ Tek kelime kontrolü (canlı SERP)
export const targetsFor = async (domain) => (await resolveTargets(domain)).targets;

export async function checkKeyword(domain, keyword, targets) {
  const results = await pool(targets, 5, async (t) => {
    try {
      const r = await serpPosition(keyword, t.locationCode, t.languageCode, domain.hostname);
      return { ...t, ...r, error: null };
    } catch (err) {
      return { ...t, position: null, url: null, error: String(err.message).slice(0, 300) };
    }
  });
  await query(
    `INSERT INTO rank_checks (domain_id, keyword, location_code, location_name, country_iso, language_code, position, url, error)
     SELECT $1, $2, * FROM unnest($3::int[], $4::text[], $5::text[], $6::text[], $7::int[], $8::text[], $9::text[])`,
    [
      domain.id, keyword, results.map((r) => r.locationCode), results.map((r) => r.locationName), results.map((r) => r.countryIso),
      results.map((r) => r.languageCode), results.map((r) => r.position), results.map((r) => r.url), results.map((r) => r.error),
    ],
  );
  return results.map(({ keywords, ...r }) => r);
}

export async function recentChecks(domain) {
  const { rows } = await query(
    `WITH last AS (
       SELECT keyword, max(checked_at) AS at FROM rank_checks WHERE domain_id = $1 GROUP BY keyword ORDER BY 2 DESC LIMIT 20
     )
     SELECT c.keyword, last.at AS checked_at,
            json_agg(json_build_object('locationCode', c.location_code, 'locationName', c.location_name, 'countryIso', c.country_iso,
                     'languageCode', c.language_code, 'position', c.position, 'url', c.url, 'error', c.error)
                     ORDER BY c.position NULLS LAST) AS results
       FROM rank_checks c JOIN last ON last.keyword = c.keyword AND c.checked_at = last.at
      WHERE c.domain_id = $1
      GROUP BY c.keyword, last.at ORDER BY last.at DESC`,
    [domain.id],
  );
  return rows;
}
