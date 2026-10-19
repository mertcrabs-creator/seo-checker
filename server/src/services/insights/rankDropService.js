import { config } from '../../config.js';
import { query } from '../../db/pool.js';
import { conflict, notFound } from '../../utils/httpError.js';
import { normalizeUrl } from '../audit/pageAnalyzer.js';
import { phraseCount, slugify } from '../audit/keywordExtractor.js';
import { ISSUES } from '../audit/issueCatalog.js';
import { updatesBetween } from '../annotationService.js';
import { GSC_BASE, googleApi } from '../googleService.js';
import { rankDropQueue } from '../jobQueue.js';
import { anyIso2 } from '../rankings/countryLanguages.js';
import { searchLanguage } from '../rankings/keywordInsightService.js';
import { account, serpFeatures } from '../rankings/serpapi.js';
import { keywordVariations } from './autocomplete.js';
import {
  analyzeAll, competitorCandidates, headingGroups, internalLinks, questionList, relatedQueries, targetCountry, termCoverage, titleModifiers, tokenizer,
} from './briefService.js';

/**
 * Sıralama kaybı: Search Console'da son 14 günde, önceki 28 güne göre belirgin sıra kaybeden kelimeler.
 * Her kelime için arka planda detaylı analiz: pozisyon zaman çizelgesi (düşüş günü), o tarihte sayfada / Google'da
 * ne değişti, URL değişimi / yamyamlık, sayfanın canlı teknik durumu ve Google'da üstte kalan rakip sayfalarla
 * içerik karşılaştırması (uzunluk, başlıklar, terimler, sorular, güncellik, yapısal veri). Sonuç: öncelikli öneriler.
 */

const CUR_DAYS = 14;
const PREV_DAYS = 28;
const MAX_COMPETITORS = 6;
const bare = (h) => String(h || '').toLowerCase().replace(/^www\./, '');
const hostOf = (u) => {
  try {
    return bare(new URL(u).hostname);
  } catch {
    return '';
  }
};
const round1 = (v) => (v === null || v === undefined || Number.isNaN(v) ? null : Math.round(v * 10) / 10);
const median = (a) => {
  const s = a.filter((x) => x !== null && x !== undefined).sort((x, y) => x - y);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const daysAgo = (iso) => (iso ? Math.round((Date.now() - Date.parse(iso)) / 86_400_000) : null);
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const pageKey = (u) => (normalizeUrl(u) || u).replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');

// ------------------------------------------------------------------ Liste
export async function rankDrops(domain) {
  const { rows: [b] } = await query('SELECT max(date)::text AS e, min(date)::text AS s FROM gsc_query_daily WHERE domain_id = $1', [domain.id]);
  if (!b.e) return { insufficient: true, rows: [] };
  if (Date.parse(b.e) - Date.parse(b.s) < (CUR_DAYS + PREV_DAYS - 1) * 86_400_000) return { insufficient: true, days: Math.round((Date.parse(b.e) - Date.parse(b.s)) / 86_400_000) + 1, rows: [] };

  const { rows } = await query(
    `WITH b AS (SELECT $2::date AS e),
     agg AS (
       SELECT query,
              SUM(impressions) FILTER (WHERE date > b.e - $3::int) AS cur_imp,
              SUM(clicks) FILTER (WHERE date > b.e - $3::int) AS cur_clicks,
              SUM(position * impressions) FILTER (WHERE date > b.e - $3::int) / NULLIF(SUM(impressions) FILTER (WHERE date > b.e - $3::int), 0) AS cur_pos,
              SUM(impressions) FILTER (WHERE date <= b.e - $3::int) AS prev_imp,
              SUM(clicks) FILTER (WHERE date <= b.e - $3::int) AS prev_clicks,
              SUM(position * impressions) FILTER (WHERE date <= b.e - $3::int) / NULLIF(SUM(impressions) FILTER (WHERE date <= b.e - $3::int), 0) AS prev_pos
         FROM gsc_query_daily, b
        WHERE domain_id = $1 AND date > b.e - ($3::int + $4::int)
        GROUP BY query
     )
     SELECT query, COALESCE(cur_imp, 0)::int AS cur_imp, COALESCE(cur_clicks, 0)::int AS cur_clicks, cur_pos::float AS cur_pos,
            prev_imp::int, COALESCE(prev_clicks, 0)::int AS prev_clicks, prev_pos::float AS prev_pos
       FROM agg
      WHERE prev_imp >= 40 AND prev_pos <= 20
        AND (cur_pos IS NULL OR cur_pos - prev_pos >= 2 OR (prev_pos <= 3 AND cur_pos - prev_pos >= 1.5))`,
    [domain.id, b.e, CUR_DAYS, PREV_DAYS],
  );
  const drops = rows.map((r) => {
    const prevDaily = r.prev_imp / PREV_DAYS;
    const curDaily = r.cur_imp / CUR_DAYS;
    const lostClicks = Math.max(0, Math.round((r.prev_clicks / PREV_DAYS - r.cur_clicks / CUR_DAYS) * 30));
    const lost = r.cur_pos === null || curDaily < prevDaily * 0.1;
    // Düşük hacimli sorgular Search Console'da gürültüyle kaybolur; "kayboldu" demek için yeterli geçmiş gösterim gerekir
    if (lost && r.prev_imp < 100) return null;
    const delta = lost ? null : r.cur_pos - r.prev_pos;
    const severity = lost || (r.prev_pos <= 3 && r.cur_pos > 6) || (r.prev_pos <= 10 && r.cur_pos > 12) ? 'critical' : delta >= 4 ? 'warning' : 'notice';
    return {
      query: r.query, prevPosition: round1(r.prev_pos), position: lost ? null : round1(r.cur_pos), delta: round1(delta), lost,
      prevClicks: Math.round((r.prev_clicks / PREV_DAYS) * 30), clicks: Math.round((r.cur_clicks / CUR_DAYS) * 30), lostClicks,
      prevImpressions: Math.round(prevDaily * 30), impressions: Math.round(curDaily * 30), severity,
    };
  }).filter((d) => d && (d.lost || d.delta / Math.max(1, d.prevPosition) >= 0.2 || d.prevPosition <= 3));
  const order = { critical: 0, warning: 1, notice: 2 };
  drops.sort((x, y) => order[x.severity] - order[y.severity] || y.lostClicks - x.lostClicks || y.prevImpressions - x.prevImpressions);
  const top = drops.slice(0, 200);
  const keys = top.map((d) => d.query);

  const [{ rows: series }, { rows: pages }, { rows: analyses }] = await Promise.all([
    query(
      `SELECT query, date::text, position::float, impressions FROM gsc_query_daily
        WHERE domain_id = $1 AND query = ANY($2::text[]) AND date > $3::date - ($4::int + $5::int) ORDER BY date`,
      [domain.id, keys, b.e, CUR_DAYS, PREV_DAYS],
    ),
    query(
      `SELECT DISTINCT ON (query) query, page FROM gsc_query_page WHERE domain_id = $1 AND query = ANY($2::text[]) ORDER BY query, impressions DESC`,
      [domain.id, keys],
    ),
    query(
      `SELECT DISTINCT ON (keyword) id, keyword, status, created_at FROM rank_drop_analyses WHERE domain_id = $1 AND keyword = ANY($2::text[]) ORDER BY keyword, created_at DESC`,
      [domain.id, keys],
    ),
  ]);
  const byQuery = new Map();
  for (const s of series) {
    if (!byQuery.has(s.query)) byQuery.set(s.query, []);
    byQuery.get(s.query).push({ date: s.date, position: round1(s.position) });
  }
  const pageOf = new Map(pages.map((p) => [p.query, p.page]));
  const analysisOf = new Map(analyses.map((a) => [a.keyword, a]));
  for (const d of top) {
    d.series = byQuery.get(d.query) || [];
    d.page = pageOf.get(d.query) || null;
    d.analysis = analysisOf.get(d.query) || null;
  }
  return {
    insufficient: false,
    range: { cur: [addDays(b.e, -CUR_DAYS + 1), b.e], prev: [addDays(b.e, -CUR_DAYS - PREV_DAYS + 1), addDays(b.e, -CUR_DAYS)] },
    summary: {
      total: drops.length,
      critical: drops.filter((d) => d.severity === 'critical').length,
      lostKeywords: drops.filter((d) => d.lost).length,
      lostClicks: drops.reduce((s, d) => s + d.lostClicks, 0),
    },
    rows: top,
  };
}

// ------------------------------------------------------------------ Analiz işi
export async function createAnalysis(domain, userId, { keyword, country, urls = [], trigger = 'manual' }) {
  const kw = keyword.trim().toLocaleLowerCase('tr');
  const { rows: [running] } = await query(
    "SELECT count(*)::int AS n FROM rank_drop_analyses WHERE domain_id = $1 AND status IN ('queued', 'running')",
    [domain.id],
  );
  if (running.n >= 5) throw conflict('Aynı anda en fazla 5 analiz hazırlanabilir');
  const { rows: [a] } = await query(
    'INSERT INTO rank_drop_analyses (domain_id, keyword, country, trigger) VALUES ($1, $2, $3, $4) RETURNING id, keyword, country, status, trigger, created_at',
    [domain.id, kw, country || null, trigger],
  );
  rankDropQueue.add(a.id, () => runAnalysis(a.id, domain, userId, { keyword: kw, country, urls }));
  return a;
}

async function runAnalysis(id, domain, userId, opts) {
  await query("UPDATE rank_drop_analyses SET status = 'running' WHERE id = $1", [id]);
  try {
    const data = await buildAnalysis(domain, userId, opts);
    await query("UPDATE rank_drop_analyses SET status = 'completed', data = $2, page = $3, country = $4, finished_at = now() WHERE id = $1", [id, JSON.stringify(data), data.ourPage?.url || null, data.country]);
  } catch (err) {
    await query("UPDATE rank_drop_analyses SET status = 'failed', error = $2, finished_at = now() WHERE id = $1", [id, String(err.message).slice(0, 300)]);
  }
}

/** Sync sonrası uyarı: en önemli düşüşler için otomatik analiz (son 7 günde analiz edilmemişse). */
export async function autoAnalyze(domainId, keywords, limit = 3) {
  const { rows: [domain] } = await query('SELECT id, user_id, hostname, gsc_property, business_type FROM domains WHERE id = $1', [domainId]);
  if (!domain?.gsc_property) return [];
  const { rows: recent } = await query(
    `SELECT keyword FROM rank_drop_analyses WHERE domain_id = $1 AND keyword = ANY($2::text[]) AND created_at > now() - interval '7 days'`,
    [domainId, keywords],
  );
  const skip = new Set(recent.map((r) => r.keyword));
  const created = [];
  for (const k of keywords.filter((x) => !skip.has(x)).slice(0, limit)) {
    try {
      created.push(await createAnalysis(domain, domain.user_id, { keyword: k, trigger: 'alert' }));
    } catch (err) {
      console.warn('[rank-drop] otomatik analiz', k, err.message);
      break;
    }
  }
  return created;
}

// ------------------------------------------------------------------ Veri toplama
async function history(domain, keyword) {
  const { rows } = await query(
    `SELECT date::text, position::float, clicks, impressions FROM gsc_query_daily
      WHERE domain_id = $1 AND query = $2 AND date > (SELECT max(date) FROM gsc_query_daily WHERE domain_id = $1) - 90 ORDER BY date`,
    [domain.id, keyword],
  );
  return rows.map((r) => ({ date: r.date, position: round1(r.position), clicks: r.clicks, impressions: r.impressions }));
}

function windowStats(points) {
  const imp = points.reduce((s, p) => s + p.impressions, 0);
  return {
    position: imp ? round1(points.reduce((s, p) => s + p.position * p.impressions, 0) / imp) : null,
    clicks: points.reduce((s, p) => s + p.clicks, 0),
    impressions: imp,
    days: points.length,
  };
}

/** Düşüşün başladığı gün: 3 günlük ortalama, önceki dönem ortalamasının belirgin üstüne çıkıp orada kaldığı ilk gün. */
function dropStart(hist, endDate, baseline, current) {
  if (baseline === null || current === null) return null;
  const threshold = baseline + Math.max(1, (current - baseline) * 0.5);
  const from = addDays(endDate, -(CUR_DAYS + 14));
  const pts = hist.filter((p) => p.date >= from);
  for (let i = 0; i < pts.length; i++) {
    const win = pts.slice(Math.max(0, i - 1), i + 2);
    const avg = win.reduce((s, p) => s + p.position, 0) / win.length;
    const rest = pts.slice(i);
    const restAvg = rest.reduce((s, p) => s + p.position, 0) / rest.length;
    if (avg >= threshold && restAvg >= threshold - 0.5) return pts[i].date;
  }
  return null;
}

/** Canlı Search Console: bu sorguda hangi sayfalarınız, önceki ve son dönemde (URL değişimi / yamyamlık). */
async function pagesByPeriod(domain, userId, keyword, endDate) {
  const api = `${GSC_BASE}/sites/${encodeURIComponent(domain.gsc_property)}/searchAnalytics/query`;
  const body = (startDate, end) => ({
    startDate, endDate: end, dimensions: ['page'], rowLimit: 25, dataState: 'all',
    dimensionFilterGroups: [{ filters: [{ dimension: 'query', operator: 'equals', expression: keyword }] }],
  });
  const curStart = addDays(endDate, -CUR_DAYS + 1);
  const prevEnd = addDays(endDate, -CUR_DAYS);
  const prevStart = addDays(endDate, -CUR_DAYS - PREV_DAYS + 1);
  const [prev, cur] = await Promise.all([
    googleApi(userId, api, { method: 'POST', body: body(prevStart, prevEnd) }),
    googleApi(userId, api, { method: 'POST', body: body(curStart, endDate) }),
  ]);
  const map = (r) => (r.rows || []).map((x) => ({ page: x.keys[0], clicks: x.clicks, impressions: x.impressions, position: round1(x.position) })).sort((a, b) => b.impressions - a.impressions);
  return { prev: map(prev), cur: map(cur) };
}

async function auditInfo(domain, url) {
  const { rows: [audit] } = await query(`SELECT id, created_at FROM audits WHERE domain_id = $1 AND status = 'completed' ORDER BY created_at DESC LIMIT 1`, [domain.id]);
  if (!audit) return null;
  const { rows: pages } = await query(
    `SELECT url, inlinks, depth, onpage_score, in_sitemap, word_count FROM audit_pages WHERE audit_id = $1 AND status_code = 200 AND NOT noindex`,
    [audit.id],
  );
  const page = pages.find((p) => pageKey(p.url) === pageKey(url));
  const { rows: issues } = page
    ? await query('SELECT code, detail FROM audit_issues WHERE audit_id = $1 AND url = $2', [audit.id, page.url])
    : { rows: [] };
  const { rows: anchors } = page
    ? await query('SELECT source_url, anchor FROM audit_links WHERE audit_id = $1 AND target_url = $2 LIMIT 200', [audit.id, page.url])
    : { rows: [] };
  return {
    auditedAt: audit.created_at,
    page: page || null,
    medianInlinks: median(pages.map((p) => p.inlinks)),
    issues: issues.map((i) => ({ code: i.code, detail: i.detail, title: ISSUES[i.code]?.title || i.code, severity: ISSUES[i.code]?.severity || 'notice' })),
    anchors: anchors.map((a) => a.anchor).filter(Boolean),
  };
}

async function pageChanges(domain, url) {
  const { rows } = await query(
    `SELECT url, field, old_value, new_value, severity, created_at::text FROM page_changes
      WHERE domain_id = $1 AND created_at > now() - interval '120 days' ORDER BY created_at DESC LIMIT 500`,
    [domain.id],
  );
  return rows.filter((r) => pageKey(r.url) === pageKey(url)).slice(0, 30);
}

async function pagespeed(domain, url) {
  const { rows } = await query(
    `SELECT url, strategy, performance, metrics, field_data, created_at::text FROM pagespeed_reports
      WHERE domain_id = $1 AND status = 'completed' AND strategy = 'mobile' ORDER BY created_at DESC LIMIT 50`,
    [domain.id],
  );
  return rows.find((r) => pageKey(r.url) === pageKey(url)) || null;
}

async function previousSerp(domain, keyword) {
  const { rows } = await query(
    `SELECT position, url, features, top, checked_at::text FROM serp_snapshots WHERE domain_id = $1 AND keyword = $2 ORDER BY checked_at DESC LIMIT 2`,
    [domain.id, keyword],
  );
  return rows;
}

// ------------------------------------------------------------------ Analiz
export async function buildAnalysis(domain, userId, { keyword, country: forcedCountry, urls = [] }) {
  const notes = [];
  const { rows: [b] } = await query('SELECT max(date)::text AS e FROM gsc_query_daily WHERE domain_id = $1', [domain.id]);
  if (!b.e) throw new Error('Search Console verisi yok');
  const endDate = b.e;
  const hist = await history(domain, keyword);
  const curPts = hist.filter((p) => p.date > addDays(endDate, -CUR_DAYS));
  const prevPts = hist.filter((p) => p.date <= addDays(endDate, -CUR_DAYS) && p.date > addDays(endDate, -CUR_DAYS - PREV_DAYS));
  const baseline = windowStats(prevPts);
  const current = windowStats(curPts);
  const startedAt = dropStart(hist, endDate, baseline.position, current.position);

  const country = forcedCountry || (await targetCountry(domain, keyword));
  const hl = await searchLanguage(domain, country);
  const gl = anyIso2(country)?.toLowerCase() || 'tr';
  const tok = tokenizer(hl);
  const ownHost = bare(domain.hostname);

  // 1) Hangi sayfa sıralanıyor (URL değişimi / yamyamlık)
  let periodPages = null;
  try {
    periodPages = await pagesByPeriod(domain, userId, keyword, endDate);
  } catch (err) {
    notes.push(`Search Console sayfa kırılımı alınamadı (${err.message}); toplam veriler kullanıldı.`);
  }
  const gsc = await relatedQueries(domain, keyword, tok);
  const prevTop = periodPages?.prev[0]?.page || null;
  const curTop = periodPages?.cur[0]?.page || null;
  const ourUrl = curTop || prevTop || gsc.ourPage;
  if (!ourUrl) throw new Error('Bu kelimede sıralanan sayfanız bulunamadı');
  const urlSwitched = Boolean(prevTop && curTop && pageKey(prevTop) !== pageKey(curTop));
  const competingOwn = (periodPages?.cur || []).filter((p) => p.impressions >= Math.max(5, (periodPages.cur[0]?.impressions || 0) * 0.15));

  // 2) Google sonuçları (SerpApi) veya rakip sayfaları
  let serp = null;
  if (config.serpapi.enabled) {
    try {
      const { searchesLeft } = await account();
      if (searchesLeft === null || searchesLeft > config.serpapi.quotaReserve) {
        serp = await serpFeatures({ keyword, gl, hl, device: 'mobile', hostname: domain.hostname });
        await query(
          `INSERT INTO serp_snapshots (domain_id, keyword, country, device, position, url, features, top, questions, related)
           VALUES ($1, $2, $3, 'mobile', $4, $5, $6, $7, $8, $9)`,
          [domain.id, keyword, country, serp.position, serp.url, JSON.stringify(serp.features), JSON.stringify(serp.top), serp.questions, serp.related],
        );
      } else notes.push('SerpApi kotası rezerv seviyesinde; Google sonuçları yerine rakip sayfaları kullanıldı.');
    } catch (err) {
      notes.push(`Google sonuçları alınamadı (${err.message}); rakip sayfaları kullanıldı.`);
    }
  } else notes.push('SERPAPI_KEY tanımlı değil: Google’daki güncel ilk 10 yerine eklediğiniz rakiplerin bu konudaki sayfaları kullanıldı. Daha kesin sonuç için SerpApi anahtarı ekleyin.');
  const snaps = await previousSerp(domain, keyword);
  const prevSnap = serp ? snaps[1] : snaps[0];
  const prevPos = new Map((prevSnap?.top || []).map((t) => [t.link, t.position]));
  const prevDomains = new Map((prevSnap?.top || []).map((t) => [t.domain, t.position]));
  const livePosition = serp ? serp.position : null;

  let candidates;
  if (serp) {
    const ourPos = serp.position || 11;
    candidates = serp.top.filter((t) => !t.own && t.link && t.position < ourPos).map((t) => t.link);
    if (candidates.length < 3) candidates = serp.top.filter((t) => !t.own && t.link).map((t) => t.link);
  } else {
    candidates = await competitorCandidates(domain, keyword, tok);
  }
  const manual = urls.map((u) => normalizeUrl(u)).filter(Boolean);
  candidates = [...new Set([...manual, ...candidates])].filter((u) => hostOf(u) !== ownHost).slice(0, MAX_COMPETITORS);

  // 3) Sayfaların canlı analizi
  const analyzed = await analyzeAll([...candidates, ourUrl], ownHost);
  const oursRaw = analyzed.at(-1);
  const ours = oursRaw && !oursRaw.error ? oursRaw : null;
  const comps = analyzed.slice(0, candidates.length).filter((p) => !p.error && p.words >= 100);
  const failed = analyzed.slice(0, candidates.length).filter((p) => p.error).length;
  if (failed) notes.push(`${failed} rakip sayfa erişilemediği için analiz dışı kaldı.`);

  // 4) Site verileri
  const [audit, changes, speed, updates, variations, links] = await Promise.all([
    auditInfo(domain, ourUrl),
    pageChanges(domain, ourUrl),
    pagespeed(domain, ourUrl),
    updatesBetween(addDays(startedAt || addDays(endDate, -CUR_DAYS), -10), endDate).catch(() => []),
    keywordVariations(keyword, { hl, gl }).catch(() => []),
    internalLinks(domain, keyword, tok, ourUrl).catch(() => []),
  ]);

  // 5) Karşılaştırma
  const headings = comps.length ? headingGroups(comps, tok, ours) : [];
  const terms = comps.length ? termCoverage(comps, ours, hl, keyword, tok) : [];
  const questions = questionList(serp?.questions || [], gsc.queries, variations, ours, tok);
  const brands = [slugify(ownHost.split('.')[0]).replace(/-/g, ''), ...comps.map((p) => slugify(p.domain.split('.')[0]).replace(/-/g, ''))];
  const modifiers = comps.length ? titleModifiers(comps, keyword, tok, brands) : [];
  const words = comps.map((p) => p.words);
  const medWords = median(words);
  const compFreshDays = median(comps.map((p) => daysAgo(p.modifiedAt || p.publishedAt)).filter((x) => x !== null));
  const ourAge = ours ? daysAgo(ours.modifiedAt || ours.publishedAt) : null;
  const schemaCounts = new Map();
  for (const p of comps) for (const t of new Set(p.schemaTypes)) schemaCounts.set(t, (schemaCounts.get(t) || 0) + 1);
  const ourTypes = new Set(ours?.schemaTypes || []);
  const missingSchema = [...schemaCounts.entries()]
    .filter(([t, n]) => n / Math.max(1, comps.length) >= 0.4 && !ourTypes.has(t) && !['WebPage', 'WebSite', 'Organization', 'ImageObject', 'SiteNavigationElement', 'ListItem', 'Person', 'SearchAction', 'EntryPoint', 'ReadAction'].includes(t))
    .map(([type, n]) => ({ type, pages: n }));

  // SERP değişimi: bizi geçen alan adları
  const overtook = serp ? serp.top
    .filter((t) => !t.own && (livePosition === null || t.position < livePosition))
    .map((t) => ({ domain: t.domain, link: t.link, position: t.position, prevPosition: prevPos.get(t.link) ?? prevDomains.get(t.domain) ?? null }))
    .filter((t) => prevSnap && (t.prevPosition === null || t.prevPosition > t.position)) : [];

  // 6) Öneriler
  const recs = [];
  const add = (r) => recs.push(r);
  const statusIssue = ours === null ? oursRaw?.error : null;
  if (statusIssue) {
    add({ priority: 'critical', category: 'technical', title: 'Sayfa şu anda düzgün yanıt vermiyor', detail: `${ourUrl} → ${statusIssue}. Google sayfaya erişemiyorsa sıralama hızla düşer.`, steps: ['Sayfanın 200 döndüğünü, yönlendirme zinciri olmadığını kontrol edin.', 'Düzelttikten sonra Search Console → URL Denetimi ile yeniden tarama isteyin.'] });
  }
  if (ours?.noindex) add({ priority: 'critical', category: 'technical', title: 'Sayfa noindex', detail: 'Sayfada noindex var; Google sayfayı dizinden çıkarır.', steps: ['meta robots / X-Robots-Tag içindeki noindex’i kaldırın.'] });
  if (ours?.canonical && pageKey(ours.canonical) !== pageKey(ours.url)) {
    add({ priority: 'critical', category: 'technical', title: 'Canonical başka bir sayfayı gösteriyor', detail: `Canonical: ${ours.canonical}. Google sıralamayı o sayfaya aktarabilir veya iki sayfa arasında kararsız kalabilir.`, steps: ['Bu sayfa kelime için hedef sayfaysa canonical’ı kendisine verin.'] });
  }
  const critChanges = changes.filter((c) => ['noindex', 'status', 'canonical', 'title', 'h1', 'robots', 'word_count'].some((f) => c.field.includes(f)));
  const nearDrop = startedAt ? critChanges.filter((c) => Math.abs(Date.parse(c.created_at) - Date.parse(startedAt)) <= 21 * 86_400_000) : [];
  if (nearDrop.length) {
    add({
      priority: 'high', category: 'change', title: 'Düşüşten hemen önce/sonra sayfada değişiklik yapılmış',
      detail: nearDrop.slice(0, 4).map((c) => `${c.created_at.slice(0, 10)} · ${c.field}: “${String(c.old_value ?? '').slice(0, 80)}” → “${String(c.new_value ?? '').slice(0, 80)}”`).join('\n'),
      steps: ['Değişiklik bilinçli değilse geri alın; özellikle title/H1’den hedef kelimenin çıkarılması doğrudan sıra kaybettirir.', 'Değişiklik gerekliyse kelimenin title, H1 ve ilk paragrafta kalmasını sağlayın.'],
    });
  }
  if (urlSwitched) {
    add({
      priority: 'high', category: 'cannibalization', title: 'Google bu kelime için farklı bir sayfanızı göstermeye başladı',
      detail: `Önceki dönemde ${prevTop}, son dönemde ${curTop} sıralanıyor. URL değişimi genellikle iki sayfanın aynı niyeti hedeflediğini (yamyamlık) gösterir.`,
      steps: ['Kelime için tek bir hedef sayfa seçin.', 'Diğer sayfayı hedef sayfaya 301 ile yönlendirin, birleştirin veya farklı bir niyete odaklayın.', 'İç bağlantılarda bu kelimeyle hedef sayfaya link verin.'],
    });
  } else if (competingOwn.length >= 2) {
    add({
      priority: 'medium', category: 'cannibalization', title: `${competingOwn.length} sayfanız aynı kelimede gösterim alıyor`,
      detail: competingOwn.slice(0, 4).map((p) => `${p.page} (sıra ${p.position}, ${p.impressions} gösterim)`).join('\n'),
      steps: ['En güçlü sayfayı hedef olarak belirleyin; diğerlerinde bu kelimeyi title/H1’den çıkarın veya içerikleri birleştirin.'],
    });
  }
  // Canlı analizde zaten değerlendirilen başlık sorunları tekrar edilmez
  const liveChecked = ours ? new Set(['title_missing', 'h1_missing', 'canonical_other', 'noindex']) : new Set();
  for (const i of (audit?.issues || []).filter((x) => !liveChecked.has(x.code)).filter((x) => x.severity === 'critical' || ['title_missing', 'h1_missing', 'canonical_other', 'slow_response', 'keyword_cannibalization', 'low_word_count', 'orphan_page', 'broken_internal_link'].includes(x.code)).slice(0, 4)) {
    add({ priority: i.severity === 'critical' ? 'high' : 'medium', category: 'technical', title: `Site taraması: ${i.title}`, detail: i.detail || 'Son site taramasında bu sayfada tespit edildi.', steps: ['Site sağlığı → Sorunlar listesinden ayrıntıları inceleyin.'] });
  }

  if (ours && comps.length) {
    const kwInTitle = phraseCount(ours.title || '', keyword, hl) > 0;
    const kwInH1 = phraseCount(ours.h1 || '', keyword, hl) > 0;
    if (!kwInTitle || !kwInH1) {
      add({
        priority: 'high', category: 'onpage', title: `Hedef kelime ${!kwInTitle && !kwInH1 ? 'title ve H1’de' : !kwInTitle ? 'title’da' : 'H1’de'} geçmiyor`,
        detail: `Title: “${ours.title || '—'}” · H1: “${ours.h1 || '—'}”. Üstteki rakiplerin ${comps.filter((p) => phraseCount(p.title || '', keyword, hl) > 0).length}/${comps.length} tanesinin title’ında kelime geçiyor.`,
        steps: ['Kelimeyi title’ın başına yakın, doğal biçimde ekleyin.', 'H1’i kelimeyi içeren net bir başlıkla güncelleyin.'],
      });
    }
    if (medWords && ours.words < medWords * 0.7) {
      add({
        priority: 'high', category: 'content', title: 'İçerik üstteki rakiplerden belirgin şekilde kısa',
        detail: `Sizin sayfanız ${ours.words} kelime; üstteki rakiplerin medyanı ${Math.round(medWords)} kelime. Kısalık tek başına sorun değildir, ama aşağıdaki eksik başlık ve terimlerle birlikte kapsam eksikliğine işaret eder.`,
        steps: [`İçeriği yaklaşık ${Math.round(medWords * 0.9 / 50) * 50}–${Math.round(medWords * 1.1 / 50) * 50} kelimeye çıkarın; dolgu değil, aşağıdaki eksik alt konularla.`],
      });
    }
    const missH = headings.filter((h) => h.covered === false && h.pages >= Math.max(2, Math.ceil(comps.length * 0.4)));
    if (missH.length) {
      add({ priority: 'high', category: 'content', title: `Rakiplerin çoğunun işlediği ${missH.length} alt konu sayfanızda yok`, detail: 'Google bu kelimede bu alt konuları işleyen sayfaları üstte gösteriyor.', items: missH.slice(0, 12).map((h) => `${h.heading} (${h.pages}/${comps.length} rakip)`), steps: ['Her biri için ayrı bir H2/H3 bölümü ekleyin; başlığın hemen altına kısa, net bir yanıt yazın.'] });
    }
    const missT = terms.filter((t) => t.covered === false);
    if (missT.length >= 3) {
      add({ priority: 'medium', category: 'content', title: `${missT.length} önemli terim sayfanızda geçmiyor`, detail: 'Üstteki sayfaların çoğunda geçen ama sizde olmayan ifadeler; konu kapsamının göstergesidir.', items: missT.slice(0, 20).map((t) => t.term), steps: ['Bu terimleri ilgili bölümlerde doğal biçimde kullanın (anahtar kelime doldurmadan).'] });
    }
    const missQ = questions.filter((q) => q.covered === false);
    if (missQ.length) {
      add({ priority: 'medium', category: 'content', title: `${missQ.length} kullanıcı sorusu sayfada yanıtlanmıyor`, detail: 'Google “Diğer sorular”, Search Console ve otomatik tamamlamadan gelen sorular.', items: missQ.slice(0, 10).map((q) => `${q.question} — ${q.source}`), steps: ['Sayfanın sonuna bir SSS bölümü ekleyin veya soruları ilgili başlıklara yerleştirin.'] });
    }
    if (compFreshDays !== null && compFreshDays < 180 && (ourAge === null || ourAge > 365)) {
      add({
        priority: 'medium', category: 'freshness', title: 'Rakipler daha güncel',
        detail: `Üstteki sayfalar medyan ${compFreshDays} gün önce güncellenmiş; sizin sayfanız ${ourAge === null ? 'tarih bilgisi içermiyor' : `${ourAge} gün önce`}.`,
        steps: ['Bilgileri (fiyat, istatistik, yöntem, yıl) gerçekten güncelleyin.', 'Sayfada görünür bir “Son güncelleme” tarihi ve şemada dateModified kullanın.'],
      });
    }
    const yearMod = modifiers.find((m) => /^20\d{2}$/.test(m.term));
    if (yearMod && !(ours.title || '').includes(yearMod.term)) add({ priority: 'low', category: 'onpage', title: `Rakipler title’da yıl kullanıyor (${yearMod.term})`, detail: `${yearMod.pages}/${comps.length} rakip title’ında güncel yıl var; arama yapan kullanıcıya güncellik sinyali verir.`, steps: ['İçerik gerçekten güncelse title’a yılı ekleyin.'] });
    const otherMods = modifiers.filter((m) => !/^20\d{2}$/.test(m.term) && !tok(ours.title || '').has(m.term)).slice(0, 5);
    if (otherMods.length) add({ priority: 'low', category: 'onpage', title: 'Rakip title’larında sık geçen ifadeler sizde yok', detail: 'Arama niyetine dair ipucu verir.', items: otherMods.map((m) => `${m.term} (${m.pages} rakip)`), steps: ['Uygun olanları title veya meta açıklamaya ekleyin.'] });
    if (missingSchema.length) add({ priority: 'medium', category: 'schema', title: 'Rakiplerin kullandığı yapısal veri sizde yok', items: missingSchema.map((s) => `${s.type} (${s.pages}/${comps.length} rakip)`), detail: 'Zengin sonuç görünümü tıklama oranını, net varlık tanımı ise anlaşılırlığı artırır.', steps: ['Yapısal veri → Şema oluşturucu ile bu sayfa için JSON-LD üretin.'], link: 'schema' });
    const compImages = median(comps.map((p) => p.images || 0));
    if (compImages >= 3 && (ours.images || 0) < compImages * 0.5) add({ priority: 'low', category: 'content', title: 'Görsel kullanımı rakiplerin gerisinde', detail: `Sizde ${ours.images || 0}, rakip medyanı ${compImages} görsel.`, steps: ['Konuyu açıklayan özgün görseller, tablo ve infografikler ekleyin (alt metinleriyle).'] });
    if (ours.geo && ours.geo.questions === 0 && serp?.features?.aiOverview) {
      add({ priority: 'medium', category: 'serp', title: 'Bu kelimede AI Overview var; sayfanız soru-yanıt yapısında değil', detail: `AI Overview kaynakları: ${(serp.features.aiOverview.sources || []).slice(0, 5).join(', ') || '—'}${serp.features.aiOverview.cited ? ' (siz de kaynaksınız)' : ''}.`, steps: ['Başlıkları soru biçiminde yazın ve her başlığın altına 40–60 kelimelik net yanıt ekleyin.', 'Derin analiz → GEO sekmesindeki önerilere bakın.'], link: 'geo' });
    }
  } else if (ours && !comps.length) {
    notes.push('Karşılaştırılacak rakip sayfa bulunamadı. SerpApi anahtarı ekleyin veya Rakipler sekmesinden rakip ekleyin.');
  }
  if (overtook.length) {
    add({ priority: 'medium', category: 'serp', title: `${overtook.length} sonuç sizi geçti`, detail: 'Önceki SERP kaydına göre yükselen veya yeni giren sonuçlar.', items: overtook.map((o) => `${o.domain}: ${o.prevPosition ?? 'yeni'} → ${o.position}`), steps: ['Bu sayfaların neyi farklı yaptığını aşağıdaki rakip tablosunda inceleyin (uzunluk, güncellik, başlıklar).'] });
  }
  const prevFeat = prevSnap?.features || {};
  if (serp && prevSnap) {
    const fresh = [];
    if (serp.features.aiOverview && !prevFeat.aiOverview) fresh.push('AI Overview');
    if (serp.features.featuredSnippet && !prevFeat.featuredSnippet) fresh.push('öne çıkan snippet');
    if (serp.features.video && !prevFeat.video) fresh.push('video');
    if (serp.features.localPack && !prevFeat.localPack) fresh.push('yerel paket');
    if (fresh.length) add({ priority: 'medium', category: 'serp', title: `Sonuç sayfasına yeni özellik eklendi: ${fresh.join(', ')}`, detail: 'Organik sonuçlar aşağı itilmiş olabilir; pozisyon kaybı kısmen bundan kaynaklanabilir.', steps: ['Öne çıkan snippet için soruyu ilk paragrafta 40–50 kelimeyle yanıtlayın; video için konuyla ilgili bir video ekleyip VideoObject işaretleyin.'] });
  }
  if (audit?.page && audit.medianInlinks !== null && audit.page.inlinks < Math.max(2, audit.medianInlinks * 0.5)) {
    add({ priority: 'medium', category: 'links', title: 'Sayfa az iç bağlantı alıyor', detail: `Bu sayfaya ${audit.page.inlinks} iç bağlantı var; site medyanı ${audit.medianInlinks}.`, items: links.slice(0, 6).map((l) => `${l.url} → “${keyword}” bağlantı metniyle`), steps: ['İlgili güçlü sayfalardan, hedef kelimeyi içeren bağlantı metniyle link verin.'] });
  }
  if (speed && speed.performance !== null && speed.performance < 50) {
    add({ priority: 'low', category: 'technical', title: `Mobil performans puanı düşük (${speed.performance})`, detail: 'Core Web Vitals tek başına büyük sıra kaybı yaratmaz ama eşit içerikte belirleyici olabilir.', steps: ['Hız sekmesindeki fırsatlara göre görselleri ve JS’i optimize edin.'] });
  }
  const core = updates.filter((u) => u.kind === 'core' || /core|helpful|review/i.test(u.name));
  const spam = updates.filter((u) => u.kind === 'spam');
  if (core.length) {
    add({ priority: 'info', category: 'algorithm', title: `Düşüş dönemi Google çekirdek güncellemesiyle çakışıyor: ${core.map((u) => u.name).join(', ')}`, detail: 'Çekirdek güncellemelerde düşüş genellikle tek bir teknik hatadan değil, içeriğin rakiplere göre faydası/uzmanlığından kaynaklanır.', steps: ['İçeriği deneyim ve uzmanlık açısından güçlendirin: yazar bilgisi, özgün veri, birinci elden deneyim, kaynaklar.', 'Kısa vadeli düzeltme beklemeyin; iyileşme genellikle bir sonraki çekirdek güncellemede görülür.'] });
  }
  if (spam.length) {
    add({ priority: 'info', category: 'algorithm', title: `Düşüş dönemi Google spam güncellemesiyle çakışıyor: ${spam.map((u) => u.name).join(', ')}`, detail: 'Spam güncellemeleri ölçeklenmiş/otomatik içerik, link satın alma ve site itibarı istismarını hedefler. Düşüş bundan kaynaklanıyorsa genellikle sitenin genelinde görülür; yalnızca bu kelimedeyse tesadüf olabilir.', steps: ['Backlink profilinde satın alınmış/spam bağlantı olup olmadığını kontrol edin.', 'Çok benzer, ölçeklenmiş sayfalar (ör. şehir şehir aynı içerik) varsa birleştirin.'] });
  }
  if (baseline.impressions && current.impressions && current.impressions / CUR_DAYS < (baseline.impressions / PREV_DAYS) * 0.5 && current.position !== null && baseline.position !== null && current.position - baseline.position < 3) {
    add({ priority: 'info', category: 'demand', title: 'Arama talebi de düşmüş', detail: 'Gösterimler yarıdan fazla azalmış; düşüşün bir kısmı mevsimsel veya talep kaynaklı olabilir.', steps: ['Geçen yılın aynı dönemini kontrol edin.'] });
  }
  if (!recs.length) {
    add({ priority: 'info', category: 'other', title: 'Belirgin bir eksik bulunamadı', detail: 'Sayfa teknik olarak sağlam ve içerik kapsamı rakiplerle benzer. Düşüş geçici dalgalanma veya otorite farkından kaynaklanıyor olabilir.', steps: ['1–2 hafta izleyin.', 'Sayfaya yeni, kaliteli dış bağlantılar kazanmaya ve özgün bilgi eklemeye odaklanın.'] });
  }
  const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  recs.sort((x, y) => order[x.priority] - order[y.priority]);

  // Özet teşhis
  const causes = [...new Set(recs.filter((r) => r.priority !== 'low').map((r) => r.category))].slice(0, 4);

  return {
    keyword,
    country,
    language: hl,
    generatedAt: new Date().toISOString(),
    notes,
    source: serp ? 'serp' : manual.length ? 'manual' : 'competitors',
    history: hist,
    baseline,
    current,
    startedAt,
    livePosition,
    updates: updates.map((u) => ({ name: u.name, start: u.start, end: u.end, kind: u.kind })),
    pages: periodPages,
    urlSwitched,
    ourPage: {
      url: ours?.url || ourUrl, error: oursRaw?.error || null, title: ours?.title, h1: ours?.h1, words: ours?.words ?? null,
      modifiedAt: ours?.modifiedAt || ours?.publishedAt || null, schemaTypes: ours?.schemaTypes || [], images: ours?.images ?? null,
      inlinks: audit?.page?.inlinks ?? null, siteMedianInlinks: audit?.medianInlinks ?? null, onpageScore: audit?.page?.onpage_score ?? null,
      issues: audit?.issues || [], anchors: [...new Set(audit?.anchors || [])].slice(0, 10), performance: speed?.performance ?? null, geo: ours?.geo || null,
    },
    changes,
    serp: serp ? {
      features: serp.features, prevFeatures: prevSnap?.features || null, prevCheckedAt: prevSnap?.checked_at || null,
      top: serp.top.map((t) => ({ position: t.position, domain: t.domain, link: t.link, title: t.title, own: t.own, prevPosition: prevSnap ? (prevPos.get(t.link) ?? null) : undefined })),
    } : null,
    competitors: comps.map((p) => ({
      url: p.url, domain: p.domain, title: p.title, words: p.words, h2: p.outline.filter((h) => h.level === 2).length, images: p.images,
      modifiedAt: p.modifiedAt || p.publishedAt, schemaTypes: p.schemaTypes.slice(0, 8), position: serp?.top.find((t) => t.link === p.url)?.position ?? null,
      keywordInTitle: phraseCount(p.title || '', keyword, hl) > 0, questions: p.geo?.questions ?? null,
    })),
    stats: { medianWords: medWords === null ? null : Math.round(medWords), compFreshDays, ourAge },
    gaps: {
      headings: headings.filter((h) => h.covered === false).slice(0, 20),
      terms: terms.filter((t) => t.covered === false).slice(0, 30),
      questions: questions.filter((q) => q.covered === false).slice(0, 15),
      schema: missingSchema,
    },
    internalLinks: links.slice(0, 8),
    causes,
    recommendations: recs,
  };
}

// ------------------------------------------------------------------ Okuma
export async function listAnalyses(domain) {
  const { rows } = await query(
    `SELECT id, keyword, country, page, trigger, status, error, created_at, finished_at FROM rank_drop_analyses WHERE domain_id = $1 ORDER BY created_at DESC LIMIT 100`,
    [domain.id],
  );
  return rows;
}

export async function getAnalysis(domain, id) {
  const { rows: [a] } = await query('SELECT * FROM rank_drop_analyses WHERE id = $1 AND domain_id = $2', [id, domain.id]);
  if (!a) throw notFound('Analiz bulunamadı');
  return a;
}

export async function deleteAnalysis(domain, id) {
  const { rowCount } = await query('DELETE FROM rank_drop_analyses WHERE id = $1 AND domain_id = $2', [id, domain.id]);
  if (!rowCount) throw notFound('Analiz bulunamadı');
}
