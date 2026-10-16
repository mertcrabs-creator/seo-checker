import { config } from '../config.js';
import { query } from '../db/pool.js';
import { googleApi } from './googleService.js';

/**
 * Google URL Inspection API (ücretsiz, mülk başına günde 2000 / dakikada 600 istek):
 * son taramadaki indekslenebilir sayfalar ve site haritası URL'leri tek tek denetlenir.
 */
const INSPECT_URL = 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect';
const CONCURRENCY = 3;

async function pool(items, limit, fn) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/** URL'nin mülke ait olup olmadığı (URL-prefix mülkünde önek, domain mülkünde alan adı eşleşmesi). */
function inProperty(property, url) {
  if (property.startsWith('sc-domain:')) {
    const host = new URL(url).hostname;
    const d = property.slice(10);
    return host === d || host.endsWith(`.${d}`);
  }
  return url.startsWith(property);
}

/** Denetlenecek URL'ler: önce hiç denetlenmemiş, sonra en eski denetlenen; en çok iç bağlantı alan önce. */
async function candidates(domain) {
  const { rows } = await query(
    `WITH a AS (SELECT id FROM audits WHERE domain_id = $1 AND status = 'completed' ORDER BY created_at DESC LIMIT 1)
     SELECT p.url FROM audit_pages p JOIN a ON a.id = p.audit_id
       LEFT JOIN index_inspections i ON i.domain_id = $1 AND i.url = p.url
      WHERE p.status_code = 200
      ORDER BY i.checked_at NULLS FIRST, p.inlinks DESC, p.depth
      LIMIT $2`,
    [domain.id, config.indexInspectLimit * 2],
  );
  return rows.map((r) => r.url).filter((u) => inProperty(domain.gsc_property, u)).slice(0, config.indexInspectLimit);
}

async function inspectOne(domain, userId, url) {
  try {
    const data = await googleApi(userId, INSPECT_URL, {
      method: 'POST',
      body: { inspectionUrl: url, siteUrl: domain.gsc_property, languageCode: 'tr' },
    });
    const r = data.inspectionResult?.indexStatusResult || {};
    const rich = data.inspectionResult?.richResultsResult;
    await query(
      `INSERT INTO index_inspections (domain_id, url, verdict, coverage_state, indexing_state, robots_state, page_fetch_state,
         last_crawl, google_canonical, user_canonical, crawled_as, rich_results, error, checked_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NULL, now())
       ON CONFLICT (domain_id, url) DO UPDATE SET verdict = EXCLUDED.verdict, coverage_state = EXCLUDED.coverage_state,
         indexing_state = EXCLUDED.indexing_state, robots_state = EXCLUDED.robots_state, page_fetch_state = EXCLUDED.page_fetch_state,
         last_crawl = EXCLUDED.last_crawl, google_canonical = EXCLUDED.google_canonical, user_canonical = EXCLUDED.user_canonical,
         crawled_as = EXCLUDED.crawled_as, rich_results = EXCLUDED.rich_results, error = NULL, checked_at = now()`,
      [
        domain.id, url, r.verdict || null, r.coverageState || null, r.indexingState || null, r.robotsTxtState || null,
        r.pageFetchState || null, r.lastCrawlTime || null, r.googleCanonical || null, r.userCanonical || null, r.crawledAs || null,
        rich ? JSON.stringify({ verdict: rich.verdict, types: (rich.detectedItems || []).map((d) => d.richResultType) }) : null,
      ],
    );
  } catch (err) {
    // Kota aşımı tüm işi durdurur; tekil hatalar kaydedilip devam edilir
    if (/quota/i.test(err.message)) throw err;
    await query(
      `INSERT INTO index_inspections (domain_id, url, error, checked_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (domain_id, url) DO UPDATE SET error = EXCLUDED.error, checked_at = now()`,
      [domain.id, url, String(err.message).slice(0, 300)],
    );
  }
}

export async function runInspection(domain, userId) {
  await query("UPDATE domains SET index_status = 'running', index_error = NULL WHERE id = $1", [domain.id]);
  try {
    const urls = await candidates(domain);
    if (!urls.length) throw new Error('Denetlenecek sayfa yok. Önce site taraması yapın.');
    await pool(urls, CONCURRENCY, (u) => inspectOne(domain, userId, u));
    await query("UPDATE domains SET index_status = 'idle', index_updated_at = now() WHERE id = $1", [domain.id]);
  } catch (err) {
    await query("UPDATE domains SET index_status = 'failed', index_error = $2 WHERE id = $1", [domain.id, String(err.message).slice(0, 500)]);
    throw err;
  }
}

export async function summary(domain) {
  const { rows } = await query(
    `SELECT count(*)::int AS inspected,
            count(*) FILTER (WHERE verdict = 'PASS')::int AS indexed,
            count(*) FILTER (WHERE verdict IN ('FAIL', 'NEUTRAL', 'PARTIAL'))::int AS not_indexed,
            count(*) FILTER (WHERE error IS NOT NULL)::int AS errors,
            count(*) FILTER (WHERE google_canonical IS NOT NULL AND user_canonical IS NOT NULL AND google_canonical <> user_canonical)::int AS canonical_mismatch,
            count(*) FILTER (WHERE crawled_as = 'DESKTOP')::int AS desktop_crawled
       FROM index_inspections WHERE domain_id = $1`,
    [domain.id],
  );
  const { rows: states } = await query(
    `SELECT COALESCE(coverage_state, 'Hata') AS state, count(*)::int AS pages FROM index_inspections
      WHERE domain_id = $1 GROUP BY 1 ORDER BY 2 DESC`,
    [domain.id],
  );
  return {
    status: domain.index_status, error: domain.index_error, updatedAt: domain.index_updated_at,
    limit: config.indexInspectLimit, totals: rows[0], states,
  };
}

const FILTERS = {
  all: 'TRUE',
  indexed: "verdict = 'PASS'",
  not_indexed: "verdict IN ('FAIL', 'NEUTRAL', 'PARTIAL')",
  canonical: 'google_canonical IS NOT NULL AND user_canonical IS NOT NULL AND google_canonical <> user_canonical',
  errors: 'error IS NOT NULL',
};

export async function pages(domain, { view, search, page, pageSize }) {
  const params = [domain.id];
  const filters = ['domain_id = $1', FILTERS[view]];
  if (search) {
    params.push(`%${search.replace(/[\\%_]/g, '\\$&')}%`);
    filters.push(`url ILIKE $${params.length} ESCAPE '\\'`);
  }
  params.push(pageSize, (page - 1) * pageSize);
  const { rows } = await query(
    `SELECT url, verdict, coverage_state, indexing_state, robots_state, page_fetch_state, last_crawl, google_canonical,
            user_canonical, crawled_as, rich_results, error, checked_at, COUNT(*) OVER ()::int AS total
       FROM index_inspections WHERE ${filters.join(' AND ')}
      ORDER BY (verdict = 'PASS') NULLS FIRST, checked_at DESC, url
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { total: rows[0]?.total || 0, rows: rows.map(({ total, ...r }) => r) };
}
