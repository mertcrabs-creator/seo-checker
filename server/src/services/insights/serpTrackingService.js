import { config } from '../../config.js';
import { query } from '../../db/pool.js';
import { badRequest, notFound } from '../../utils/httpError.js';
import { slugify } from '../audit/keywordExtractor.js';
import { anyIso2 } from '../rankings/countryLanguages.js';
import { searchLanguage } from '../rankings/keywordInsightService.js';
import { account, serpFeatures } from '../rankings/serpapi.js';

/**
 * SERP özellikleri ve AI Overview izleme: seçili önemli kelimelerin Google sonuç sayfası düzenli (varsayılan haftalık)
 * kaydedilir. SerpApi kotası korunur: her turdan önce kalan hak kontrol edilir, rezerv altına düşülmez.
 * Görünürlük payı (share of voice): takip edilen kelimelerde hangi alan adı ne kadar tıklama payı topluyor.
 */

const CTR = [0.28, 0.15, 0.1, 0.07, 0.05, 0.04, 0.03, 0.025, 0.02, 0.018];
const bare = (h) => String(h || '').toLowerCase().replace(/^www\./, '');

async function runOne(domain, t) {
  const iso2 = anyIso2(t.country);
  if (!iso2) throw badRequest('Bu ülke için SERP kontrolü yapılamıyor');
  const hl = await searchLanguage(domain, t.country);
  const r = await serpFeatures({ keyword: t.keyword, gl: iso2.toLowerCase(), hl, device: t.device, hostname: domain.hostname });
  await query(
    `INSERT INTO serp_snapshots (domain_id, keyword, country, device, position, url, features, top, questions, related)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [domain.id, t.keyword, t.country, t.device, r.position, r.url, JSON.stringify(r.features), JSON.stringify(r.top), r.questions, r.related],
  );
  await query('UPDATE serp_tracked_keywords SET last_checked_at = now() WHERE id = $1', [t.id]);
  return r.searches;
}

/** Kalan SerpApi hakkı (rezerv düşülmüş). */
async function budget() {
  const { searchesLeft } = await account();
  return searchesLeft === null ? Infinity : searchesLeft - config.serpapi.quotaReserve;
}

/** Vadesi gelen kelimeleri kontrol eder (zamanlayıcı veya "şimdi kontrol et"). */
export async function runChecks(domain, { force = false } = {}) {
  if (!config.serpapi.enabled) return { checked: 0 };
  const { rows } = await query(
    `SELECT id, keyword, country, device FROM serp_tracked_keywords
      WHERE domain_id = $1 AND ($2::boolean OR last_checked_at IS NULL OR last_checked_at < now() - make_interval(days => $3::int))
      ORDER BY last_checked_at NULLS FIRST LIMIT 50`,
    [domain.id, force, config.serpapi.trackIntervalDays],
  );
  let left = await budget();
  let checked = 0;
  for (const t of rows) {
    if (left < 2) break; // AI Overview ek sorgusu için pay bırak
    try {
      left -= await runOne(domain, t);
      checked++;
    } catch (err) {
      console.warn('[serp] kontrol', t.keyword, err.message);
      if (/hak|searches|limit|quota|run out/i.test(err.message)) break;
    }
  }
  return { checked, remaining: Number.isFinite(left) ? left + config.serpapi.quotaReserve : null };
}

export async function addKeywords(domain, items) {
  const { rows: [c] } = await query('SELECT count(*)::int AS n FROM serp_tracked_keywords WHERE domain_id = $1', [domain.id]);
  const room = config.serpapi.trackLimit - c.n;
  if (room <= 0) throw badRequest(`En fazla ${config.serpapi.trackLimit} kelime takip edilebilir (SerpApi kotası)`);
  const list = items.slice(0, room);
  const { rowCount } = await query(
    `INSERT INTO serp_tracked_keywords (domain_id, keyword, country, device)
     SELECT $1::uuid, * FROM unnest($2::text[], $3::text[], $4::text[]) ON CONFLICT DO NOTHING`,
    [domain.id, list.map((i) => i.keyword.toLocaleLowerCase('tr')), list.map((i) => i.country), list.map((i) => i.device)],
  );
  return { added: rowCount, skipped: items.length - list.length };
}

export async function removeKeyword(domain, id) {
  const { rowCount } = await query('DELETE FROM serp_tracked_keywords WHERE id = $1 AND domain_id = $2', [id, domain.id]);
  if (!rowCount) throw notFound('Kelime bulunamadı');
}

/** Takip için öneri: marka dışı, ilk 20'de, en çok gösterim alan sorgular (en çok gösterim aldığı ülkeyle). */
export async function suggestKeywords(domain) {
  if (!domain.gsc_property) return [];
  const brand = slugify(bare(domain.hostname).split('.')[0]).replace(/-/g, '');
  const { rows } = await query(
    `SELECT DISTINCT ON (q.query) q.query, q.country, q.impressions, round(q.position::numeric, 1)::float AS position
       FROM gsc_query_country q
      WHERE q.domain_id = $1 AND q.position <= 20 AND q.impressions >= 30
        AND NOT EXISTS (SELECT 1 FROM serp_tracked_keywords t WHERE t.domain_id = q.domain_id AND t.keyword = q.query)
      ORDER BY q.query, q.impressions DESC`,
    [domain.id],
  );
  return rows
    .filter((r) => brand.length < 4 || !slugify(r.query).replace(/-/g, '').includes(brand))
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 40);
}

/** Her kelimenin son ve bir önceki anlık görüntüsü. */
async function latestSnapshots(domainId) {
  const { rows } = await query(
    `SELECT * FROM (
       SELECT s.*, row_number() OVER (PARTITION BY s.keyword, s.country, s.device ORDER BY s.checked_at DESC) AS rn
         FROM serp_snapshots s WHERE s.domain_id = $1) x
      WHERE rn <= 2`,
    [domainId],
  );
  const map = new Map();
  for (const r of rows) {
    const k = `${r.keyword}|${r.country}|${r.device}`;
    const e = map.get(k) || {};
    if (r.rn === 1) e.last = r;
    else e.prev = r;
    map.set(k, e);
  }
  return map;
}

export async function serpOverview(domain) {
  const [{ rows: tracked }, snaps, { rows: comps }] = await Promise.all([
    query('SELECT id, keyword, country, device, created_at, last_checked_at FROM serp_tracked_keywords WHERE domain_id = $1 ORDER BY created_at', [domain.id]),
    latestSnapshots(domain.id),
    query("SELECT hostname FROM competitors WHERE domain_id = $1", [domain.id]),
  ]);
  const compHosts = new Set(comps.map((c) => bare(c.hostname)));
  const own = bare(domain.hostname);
  const { rows: imp } = await query(
    `SELECT query, country, impressions FROM gsc_query_country WHERE domain_id = $1 AND query = ANY($2::text[])`,
    [domain.id, tracked.map((t) => t.keyword)],
  );
  const impressions = new Map(imp.map((r) => [`${r.query}|${r.country}`, r.impressions]));

  const rows = tracked.map((t) => {
    const s = snaps.get(`${t.keyword}|${t.country}|${t.device}`) || {};
    return {
      ...t,
      impressions: impressions.get(`${t.keyword}|${t.country}`) ?? null,
      position: s.last?.position ?? null,
      prevPosition: s.prev?.position ?? null,
      url: s.last?.url ?? null,
      features: s.last?.features || null,
      top: (s.last?.top || []).map((r) => ({ ...r, competitor: compHosts.has(bare(r.domain)) })),
      questions: s.last?.questions || [],
      related: s.last?.related || [],
      checkedAt: s.last?.checked_at || null,
    };
  });
  const checked = rows.filter((r) => r.features);

  // Görünürlük payı: kelime ağırlığı (gösterim, yoksa 1) × pozisyonun beklenen TO'su
  const sov = new Map();
  let totalW = 0;
  for (const r of checked) {
    const w = Math.max(1, r.impressions || 1);
    totalW += w * CTR.reduce((a, b) => a + b, 0);
    for (const t of r.top.slice(0, 10)) {
      const d = bare(t.domain);
      const e = sov.get(d) || { domain: d, share: 0, keywords: 0, top3: 0, own: d === own || d.endsWith(`.${own}`), competitor: compHosts.has(d) };
      e.share += w * (CTR[t.position - 1] || 0);
      e.keywords++;
      if (t.position <= 3) e.top3++;
      sov.set(d, e);
    }
  }
  const shareOfVoice = [...sov.values()]
    .map((e) => ({ ...e, share: totalW ? e.share / totalW : 0 }))
    .sort((a, b) => b.share - a.share)
    .slice(0, 15);

  // Kullanıcı soruları (SSS kutusu) — içerik fikirleri için tekilleştirilmiş
  const questions = new Map();
  for (const r of checked) for (const q of r.questions) if (!questions.has(q.toLowerCase())) questions.set(q.toLowerCase(), { question: q, keyword: r.keyword });

  let quota = null;
  if (config.serpapi.enabled) {
    try {
      quota = (await account()).searchesLeft;
    } catch {
      quota = null;
    }
  }
  const per = (f) => checked.filter(f).length;
  return {
    enabled: config.serpapi.enabled,
    limit: config.serpapi.trackLimit,
    intervalDays: config.serpapi.trackIntervalDays,
    quota,
    // Aylık tahmini kullanım: kelime × (30 / aralık) × (1 + AI Overview ek sorgu payı)
    monthlyEstimate: Math.round(tracked.length * (30 / config.serpapi.trackIntervalDays) * (config.serpapi.aiOverviewFetch ? 1.4 : 1)),
    summary: {
      tracked: tracked.length,
      checked: checked.length,
      aiOverview: per((r) => r.features.aiOverview),
      aiCited: per((r) => r.features.aiOverview?.cited),
      snippet: per((r) => r.features.featuredSnippet),
      snippetOwned: per((r) => r.features.featuredSnippet?.own),
      paa: per((r) => r.features.peopleAlsoAsk > 0),
      localPack: per((r) => r.features.localPack),
      video: per((r) => r.features.video),
      adsHeavy: per((r) => r.features.ads >= 3),
    },
    shareOfVoice,
    questions: [...questions.values()].slice(0, 100),
    rows,
  };
}

/** CTR anomalisi için: sorgu -> son SERP özellikleri (ülke/cihaz fark etmeksizin en yeni). */
export async function featuresByKeyword(domainId) {
  const { rows } = await query(
    `SELECT DISTINCT ON (keyword) keyword, features, top FROM serp_snapshots WHERE domain_id = $1 ORDER BY keyword, checked_at DESC`,
    [domainId],
  );
  return new Map(rows.map((r) => [r.keyword, r]));
}

/** Zamanlayıcı: SerpApi tanımlıysa vadesi gelen kelimesi olan alan adlarını sırayla kontrol eder. */
export async function dueDomains(limit = 3) {
  if (!config.serpapi.enabled) return [];
  const { rows } = await query(
    `SELECT DISTINCT d.* FROM domains d JOIN serp_tracked_keywords t ON t.domain_id = d.id
      WHERE t.last_checked_at IS NULL OR t.last_checked_at < now() - make_interval(days => $1::int)
      LIMIT $2`,
    [config.serpapi.trackIntervalDays, limit],
  );
  return rows;
}
