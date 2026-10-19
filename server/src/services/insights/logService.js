import net from 'node:net';
import { query } from '../../db/pool.js';

/**
 * Sunucu log analizi. Log dosyası tarayıcıda ayrıştırılır (ziyaretçi IP'leri sunucuya hiç gelmez);
 * sunucu sadece bot olduğunu iddia eden IP'leri resmi IP aralıklarıyla doğrular ve tarayıcının
 * gönderdiği bot özetini son taramayla karşılaştırarak tarama bütçesi bulgularını üretir.
 */

const RANGE_SOURCES = {
  google: [
    'https://developers.google.com/static/crawling/ipranges/common-crawlers.json',
    'https://developers.google.com/static/crawling/ipranges/special-crawlers.json',
    'https://developers.google.com/static/crawling/ipranges/user-triggered-fetchers.json',
    'https://developers.google.com/static/crawling/ipranges/user-triggered-fetchers-google.json',
  ],
  bing: ['https://www.bing.com/toolbox/bingbot.json'],
  openai: ['https://openai.com/gptbot.json', 'https://openai.com/searchbot.json'],
  perplexity: ['https://www.perplexity.ai/perplexitybot.json'],
};
export const VERIFIABLE = Object.keys(RANGE_SOURCES);
const CACHE_MS = 24 * 3_600_000;
const ranges = new Map(); // family -> { at, list: BlockList | null }

async function loadRanges(family) {
  const cached = ranges.get(family);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.list;
  const list = new net.BlockList();
  let loaded = 0;
  for (const url of RANGE_SOURCES[family]) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) continue;
      const data = await res.json();
      for (const p of data.prefixes || []) {
        const prefix = p.ipv4Prefix || p.ipv6Prefix;
        if (!prefix) continue;
        const [addr, bits] = prefix.split('/');
        const type = p.ipv4Prefix ? 'ipv4' : 'ipv6';
        if (net.isIP(addr)) {
          list.addSubnet(addr, Number(bits), type);
          loaded++;
        }
      }
    } catch (err) {
      console.warn('[logs] IP aralığı alınamadı', url, err.message);
    }
  }
  const result = loaded ? list : cached?.list || null;
  ranges.set(family, { at: loaded ? Date.now() : Date.now() - CACHE_MS + 15 * 60_000, list: result });
  return result;
}

/** @param {{ip:string, bot:string}[]} items @returns {Record<string, 'verified'|'fake'|'unknown'>} */
export async function verifyIps(items) {
  const out = {};
  const families = [...new Set(items.map((i) => i.bot))];
  const lists = Object.fromEntries(await Promise.all(families.map(async (f) => [f, await loadRanges(f)])));
  for (const { ip, bot } of items) {
    const list = lists[bot];
    const family = net.isIP(ip);
    if (!list || !family) {
      out[`${bot}|${ip}`] = 'unknown';
      continue;
    }
    const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    const ok = mapped ? list.check(mapped[1], 'ipv4') : list.check(ip, family === 4 ? 'ipv4' : 'ipv6');
    out[`${bot}|${ip}`] = ok ? 'verified' : 'fake';
  }
  return out;
}

// ------------------------------------------------------------------ Kaydetme ve zenginleştirme
const pathOf = (u) => {
  try {
    const x = new URL(u);
    return x.pathname + x.search;
  } catch {
    return u;
  }
};
const dominant = (statuses) => Object.entries(statuses || {}).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

async function enrich(domainId, payload) {
  const { rows: [audit] } = await query(
    `SELECT id FROM audits WHERE domain_id = $1 AND status = 'completed' ORDER BY created_at DESC LIMIT 1`,
    [domainId],
  );
  const googleUrls = payload.urls.filter((u) => u.google > 0);
  const crawled = new Map(googleUrls.map((u) => [u.path, u]));
  const result = { audit: Boolean(audit) };

  // Tarama israfı: Googlebot'un vaktini harcadığı parametreli, hatalı, yönlendirilen veya noindex adresler
  const waste = { params: [], errors: [], redirects: [], noindex: [], unknown: [] };
  let auditPages = [];
  if (audit) {
    const { rows } = await query(
      `SELECT url, status_code, noindex, in_sitemap, inlinks, title, depth FROM audit_pages WHERE audit_id = $1`,
      [audit.id],
    );
    auditPages = rows;
  }
  const byPath = new Map(auditPages.map((p) => [pathOf(p.url), p]));
  for (const u of googleUrls) {
    const code = Number(dominant(u.statuses));
    const page = byPath.get(u.path);
    const item = { path: u.path, hits: u.google, status: code || null };
    if (code >= 400) waste.errors.push(item);
    else if (code >= 300 && code < 400) waste.redirects.push(item);
    else if (u.path.includes('?')) waste.params.push(item);
    else if (page?.noindex) waste.noindex.push(item);
    else if (audit && !page && /\.(html?|php|aspx?)$|\/[^.]*$/i.test(u.path.split('?')[0])) waste.unknown.push(item);
  }
  for (const k of Object.keys(waste)) waste[k] = waste[k].sort((a, b) => b.hits - a.hits).slice(0, 100);
  const googleHits = googleUrls.reduce((s, u) => s + u.google, 0) || 1;
  result.waste = waste;
  result.wasteShare = ['params', 'errors', 'redirects', 'noindex'].reduce((s, k) => s + waste[k].reduce((a, i) => a + i.hits, 0), 0) / googleHits;

  // Önemli ama Googlebot'un log döneminde hiç uğramadığı sayfalar
  if (audit) {
    const important = auditPages.filter((p) => p.status_code === 200 && !p.noindex && (p.in_sitemap || p.inlinks > 0));
    const missing = important.filter((p) => !crawled.has(pathOf(p.url)));
    result.coverage = important.length ? (important.length - missing.length) / important.length : null;
    result.importantPages = important.length;
    result.notCrawled = missing.sort((a, b) => b.inlinks - a.inlinks).slice(0, 150).map((p) => ({ url: p.url, title: p.title, inlinks: p.inlinks, inSitemap: p.in_sitemap, depth: p.depth }));
    // Derinlik ile tarama sıklığı ilişkisi: derin sayfalar daha az taranıyorsa site mimarisi sorunlu olabilir
    const depthStats = new Map();
    for (const p of important) {
      const d = p.depth < 0 ? 'Bağlantısız' : p.depth >= 4 ? '4+' : String(p.depth);
      const s = depthStats.get(d) || { depth: d, pages: 0, crawled: 0, hits: 0 };
      s.pages++;
      const c = crawled.get(pathOf(p.url));
      if (c) {
        s.crawled++;
        s.hits += c.google;
      }
      depthStats.set(d, s);
    }
    result.byDepth = [...depthStats.values()].sort((a, b) => String(a.depth).localeCompare(String(b.depth), 'tr', { numeric: true }));
  }
  return result;
}

export async function saveAnalysis(domain, payload) {
  const derived = await enrich(domain.id, payload);
  const summary = { ...payload, derived };
  const { rows } = await query(
    `INSERT INTO log_analyses (domain_id, file_name, range_start, range_end, total_lines, bot_hits, summary)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, created_at`,
    [domain.id, payload.fileName, payload.rangeStart, payload.rangeEnd, payload.totalLines, payload.bots.reduce((s, b) => s + b.hits, 0), JSON.stringify(summary)],
  );
  // Alan adı başına son 10 analiz saklanır
  await query(
    `DELETE FROM log_analyses WHERE domain_id = $1 AND id NOT IN (
       SELECT id FROM log_analyses WHERE domain_id = $1 ORDER BY created_at DESC LIMIT 10)`,
    [domain.id],
  );
  return rows[0];
}

export async function listAnalyses(domain) {
  const { rows } = await query(
    `SELECT id, file_name, range_start, range_end, total_lines, bot_hits, created_at FROM log_analyses
      WHERE domain_id = $1 ORDER BY created_at DESC`,
    [domain.id],
  );
  return rows;
}

export async function getAnalysis(domain, id) {
  const { rows } = await query(
    `SELECT id, file_name, range_start, range_end, total_lines, bot_hits, summary, created_at FROM log_analyses
      WHERE domain_id = $1 AND ($2::uuid IS NULL OR id = $2) ORDER BY created_at DESC LIMIT 1`,
    [domain.id, id || null],
  );
  return rows[0] || null;
}

export async function deleteAnalysis(domain, id) {
  const { rowCount } = await query('DELETE FROM log_analyses WHERE id = $1 AND domain_id = $2', [id, domain.id]);
  return rowCount > 0;
}
