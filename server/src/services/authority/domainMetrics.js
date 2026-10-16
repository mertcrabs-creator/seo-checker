import { config } from '../../config.js';
import { query } from '../../db/pool.js';

/**
 * Herkese açık alan adı otorite metrikleri, 30 gün önbellekli (domain_metrics):
 *  - Open PageRank (Common Crawl bağlantı grafiğinden 0-10 otorite; ücretsiz anahtar, istek başına 100 alan adı)
 *  - Tranco (araştırma amaçlı ilk 1M site sıralaması; anahtarsız, saniyede 1 istek)
 *  - RDAP (alan adı kayıt tarihi -> yaş)
 * İstekler yalnızca bu sabit servis adreslerine gider.
 */
const OPR_URL = 'https://openpagerank.keywordseverywhere.com/api/v1.0/getPageRank';
const TTL = "interval '30 days'";
const bare = (d) => String(d).toLowerCase().replace(/^www\./, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function openPageRank(domains) {
  const out = new Map();
  if (!config.openPageRankKey) return out;
  for (let i = 0; i < domains.length; i += 100) {
    const qs = domains.slice(i, i + 100).map((d) => `domains[]=${encodeURIComponent(d)}`).join('&');
    const data = await fetchJson(`${OPR_URL}?${qs}`, { headers: { 'API-OPR': config.openPageRankKey } });
    for (const r of data.response || []) {
      if (r.status_code === 200) out.set(bare(r.domain), { opr: Number(r.page_rank_decimal) || 0, oprRank: Number(r.rank) || null });
      else out.set(bare(r.domain), { opr: null, oprRank: null });
    }
  }
  return out;
}

async function trancoRank(domain) {
  try {
    const data = await fetchJson(`https://tranco-list.eu/api/ranks/domain/${encodeURIComponent(domain)}`);
    const ranks = (data.ranks || []).map((r) => r.rank).filter(Number.isFinite);
    return ranks.length ? Math.min(...ranks) : null; // ilk 1M dışında: liste boş
  } catch {
    return null;
  }
}

// IANA RDAP dizini: uzantı (TLD) -> kayıt kuruluşunun RDAP adresi (rdap.org yönlendiricisi bot isteklerini engelliyor)
let rdapBootstrap = null;
async function rdapBase(domain) {
  if (!rdapBootstrap) {
    const data = await fetchJson('https://data.iana.org/rdap/dns.json');
    rdapBootstrap = new Map();
    for (const [tlds, urls] of data.services || []) for (const t of tlds) rdapBootstrap.set(t.toLowerCase(), urls.find((u) => u.startsWith('https://')) || urls[0]);
  }
  const labels = domain.split('.');
  // "com.tr" gibi çok parçalı uzantılar önce denenir
  for (let i = 1; i < labels.length; i++) {
    const base = rdapBootstrap.get(labels.slice(i).join('.'));
    if (base) return base.endsWith('/') ? base : `${base}/`;
  }
  return null;
}

async function registrationDate(domain) {
  try {
    const base = await rdapBase(domain);
    if (!base) return null;
    const data = await fetchJson(`${base}domain/${encodeURIComponent(domain)}`, { headers: { Accept: 'application/rdap+json' } });
    const ev = (data.events || []).find((e) => e.eventAction === 'registration');
    return ev?.eventDate ? new Date(ev.eventDate) : null;
  } catch {
    return null; // bazı uzantılar (ör. .com.tr) RDAP sunmaz
  }
}

/**
 * @param {string[]} domains     OPR istenecek alan adları (bağlantı veren siteler dahil)
 * @param {string}   [primary]   Tranco + RDAP de istenecek ana alan adı
 * @returns {Promise<Map<string, {opr:number|null, oprRank:number|null, trancoRank:number|null, registeredAt:Date|null}>>}
 */
export async function getMetrics(domains, primary) {
  const list = [...new Set(domains.map(bare).filter(Boolean))].slice(0, 5000);
  const { rows: cached } = await query(
    `SELECT domain, opr, opr_rank, tranco_rank, registered_at FROM domain_metrics
      WHERE domain = ANY($1::text[]) AND fetched_at > now() - ${TTL}
        AND (opr IS NOT NULL OR NOT $2::boolean)`,
    [list, Boolean(config.openPageRankKey)],
  );
  const result = new Map(cached.map((r) => [r.domain, { opr: r.opr, oprRank: r.opr_rank, trancoRank: r.tranco_rank, registeredAt: r.registered_at }]));
  const missing = list.filter((d) => !result.has(d));
  const p = primary ? bare(primary) : null;
  const primaryStale = p && (!result.has(p) || (result.get(p).trancoRank === null && result.get(p).registeredAt === null));

  let opr = new Map();
  let oprError = null;
  try {
    opr = await openPageRank(missing);
  } catch (err) {
    oprError = err.message;
  }
  const rows = missing.map((d) => ({ domain: d, ...(opr.get(d) || { opr: null, oprRank: null }), trancoRank: null, registeredAt: null }));
  if (primaryStale) {
    const row = rows.find((r) => r.domain === p) || { domain: p, ...(result.get(p) || { opr: null, oprRank: null }) };
    row.trancoRank = await trancoRank(p);
    await sleep(1100);
    row.registeredAt = await registrationDate(p);
    if (!rows.includes(row)) rows.push(row);
  }
  // Anahtar yokken OPR boş kalır; önbelleğe yazıp 30 gün boyunca boşuna tekrar denemeyelim diye sadece başarılı turu yaz
  if (rows.length && (config.openPageRankKey ? !oprError : true)) {
    await query(
      `INSERT INTO domain_metrics (domain, opr, opr_rank, tranco_rank, registered_at, fetched_at)
       SELECT * , now() FROM unnest($1::text[], $2::real[], $3::int[], $4::int[], $5::timestamptz[])
       ON CONFLICT (domain) DO UPDATE SET opr = COALESCE(EXCLUDED.opr, domain_metrics.opr), opr_rank = COALESCE(EXCLUDED.opr_rank, domain_metrics.opr_rank),
         tranco_rank = COALESCE(EXCLUDED.tranco_rank, domain_metrics.tranco_rank), registered_at = COALESCE(EXCLUDED.registered_at, domain_metrics.registered_at),
         fetched_at = now()`,
      [rows.map((r) => r.domain), rows.map((r) => r.opr), rows.map((r) => r.oprRank), rows.map((r) => r.trancoRank), rows.map((r) => r.registeredAt)],
    );
  }
  for (const r of rows) result.set(r.domain, { opr: r.opr, oprRank: r.oprRank, trancoRank: r.trancoRank, registeredAt: r.registeredAt });
  return Object.assign(result, { oprError, oprEnabled: Boolean(config.openPageRankKey) });
}
