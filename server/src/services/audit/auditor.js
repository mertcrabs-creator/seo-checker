import * as cheerio from 'cheerio';
import { config } from '../../config.js';
import { bulkInsert } from '../../db/bulk.js';
import { query, withTransaction } from '../../db/pool.js';
import { safeFetch } from '../../utils/safeFetch.js';
import { afterAudit } from '../alertService.js';
import { detectAuditChanges } from '../changeService.js';
import { computeScore, pageScore } from './issueCatalog.js';
import { analyzePage, isCrawlable, normalizeUrl } from './pageAnalyzer.js';
import { isAllowed, parseRobots } from './robots.js';

const CONCURRENCY = 4;
const MAX_SITEMAP_URLS = 10_000;

const tryFetch = (url, opts) => safeFetch(url, opts).catch((error) => ({ error }));
const isHtml = (res) => /text\/html|application\/xhtml/i.test(String(res.headers?.['content-type'] || ''));

/** Site haritasındaki URL'ler -> lastmod (YYYY-MM-DD veya null). */
async function loadSitemaps(urls, siteInfo) {
  const found = new Map();
  const queue = [...urls];
  const visited = new Set();
  while (queue.length && visited.size < 15 && found.size < MAX_SITEMAP_URLS) {
    const url = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);
    const res = await tryFetch(url, { timeoutMs: 20_000, maxBytes: 20 * 1024 * 1024 });
    if (res.error || res.status !== 200) continue;
    siteInfo.sitemap.found = true;
    siteInfo.sitemap.files.push(url);
    const $ = cheerio.load(res.body, { xml: true });
    $('sitemap > loc').each((_, el) => queue.push($(el).text().trim()));
    $('url').each((_, el) => {
      if (found.size >= MAX_SITEMAP_URLS) return;
      const u = normalizeUrl($(el).children('loc').first().text().trim());
      const raw = /^(\d{4}-\d{2}-\d{2})/.exec($(el).children('lastmod').first().text().trim())?.[1];
      // Geçersiz tarih (ör. 2026-02-30) veritabanı yazımını bozmasın
      const lastmod = raw && !Number.isNaN(Date.parse(raw)) && new Date(raw).toISOString().slice(0, 10) === raw ? raw : null;
      if (u) found.set(u, lastmod);
    });
  }
  return found;
}

/**
 * Search Console gerektirmeyen site içi analiz: iç bağlantı grafiği, şablon (marka) terimleri,
 * sayfa başına ana anahtar kelime, yamyamlık, yetim sayfalar ve sayfa içi puan.
 */
function analyzeSiteContent({ pages, okPages, startUrl, sitemapUrls, siteInfo, crawlComplete }) {
  const inlinks = new Map();
  for (const p of pages.values()) {
    for (const l of p.links) {
      if (l === p.record.url) continue;
      if (!inlinks.has(l)) inlinks.set(l, new Set());
      inlinks.get(l).add(p.record.url);
    }
  }

  // Sayfaların yarısından fazlasının title'ında geçen terimler marka/şablon terimidir (ör. "| Marka")
  const titleFreq = new Map();
  for (const p of okPages) for (const k of p.keywords) if (k.inTitle) titleFreq.set(k.keyword, (titleFreq.get(k.keyword) || 0) + 1);
  const threshold = Math.max(3, Math.ceil(okPages.length * 0.5));
  const templateTerms = new Set(okPages.length >= 4 ? [...titleFreq].filter(([, n]) => n >= threshold).map(([k]) => k) : []);
  siteInfo.templateTerms = [...templateTerms].slice(0, 20);

  const targets = new Map();
  for (const p of pages.values()) {
    const r = p.record;
    r.inlinks = inlinks.get(r.url)?.size || 0;
    r.inSitemap = sitemapUrls.has(r.url);
    const candidates = p.keywords.filter((k) => !templateTerms.has(k.keyword));
    const primary = candidates.find((k) => k.inTitle || k.inH1) || candidates[0];
    r.primaryKeyword = primary?.keyword || null;

    const indexable = r.statusCode === 200 && !r.noindex && (!r.canonical || r.canonical === r.url);
    if (indexable && primary?.inTitle && primary?.inH1) {
      if (!targets.has(primary.keyword)) targets.set(primary.keyword, []);
      targets.get(primary.keyword).push(p);
    }
    // Tarama bütçesi dolduysa bağlantı veren sayfa taranmamış olabilir; yanlış pozitif verme
    if (crawlComplete && r.inSitemap && r.inlinks === 0 && r.url !== startUrl && r.statusCode === 200) {
      p.issues.push({ code: 'orphan_page' });
    }
  }
  for (const [keyword, group] of targets) {
    if (group.length > 1) group.forEach((p) => p.issues.push({ code: 'keyword_cannibalization', detail: `"${keyword}" · ${group.length} sayfa` }));
  }
  checkHreflang(pages);
  for (const p of pages.values()) p.record.onpageScore = p.record.statusCode === 200 ? pageScore(p.issues.map((i) => i.code)) : null;
}

/**
 * Hreflang: her alternatif sayfa geri bağlantı vermeli (karşılıklılık), sayfa kendine referans vermeli,
 * hedefler 200 dönmeli ve 2+ dil varsa x-default tanımlı olmalı. Google karşılıksız hreflang'ı yok sayar.
 */
function checkHreflang(pages) {
  const norm = (u) => u.replace(/\/$/, '');
  for (const p of pages.values()) {
    const list = p.record.hreflangs || [];
    if (!list.length || p.record.statusCode !== 200) continue;
    const self = norm(p.record.url);
    if (!list.some((h) => norm(h.href) === self)) p.issues.push({ code: 'hreflang_no_self' });
    if (list.length >= 2 && !list.some((h) => h.lang === 'x-default')) p.issues.push({ code: 'hreflang_no_xdefault' });
    for (const h of list) {
      if (norm(h.href) === self) continue;
      const alt = pages.get(h.href) || pages.get(`${norm(h.href)}/`) || pages.get(norm(h.href));
      if (!alt) continue; // taranmamış: değerlendirilemez
      if (alt.record.statusCode !== 200) {
        p.issues.push({ code: 'hreflang_broken', detail: `${h.lang}: ${h.href} (HTTP ${alt.record.statusCode ?? 'hata'})` });
      } else if (!(alt.record.hreflangs || []).some((x) => norm(x.href) === self)) {
        p.issues.push({ code: 'hreflang_no_return', detail: `${h.lang}: ${h.href}` });
      }
    }
  }
}

/** Site sağlığı taraması: site düzeyi kontroller + BFS ile sayfa taraması. */
export async function crawlSite(hostname, maxPages) {
  const siteIssues = [];
  const siteInfo = {
    https: true,
    robots: { found: false, sitemaps: [] },
    sitemap: { found: false, files: [], urlCount: 0 },
    statusCodes: {},
  };

  // ---------------------------------------------------- Ana sayfa / protokol
  let home = await tryFetch(`https://${hostname}/`);
  if (home.error) {
    siteInfo.https = false;
    siteIssues.push({ code: 'no_https' });
    home = await tryFetch(`http://${hostname}/`);
    if (home.error) throw new Error(`Siteye ulaşılamadı: ${home.error.message}`);
  } else {
    const plainHttp = await tryFetch(`http://${hostname}/`, { method: 'HEAD' });
    if (!plainHttp.error && !plainHttp.finalUrl.startsWith('https://')) siteIssues.push({ code: 'http_not_redirected' });
    if (!home.headers['strict-transport-security']) siteIssues.push({ code: 'hsts_missing' });
  }

  const startUrl = normalizeUrl(home.finalUrl);
  const origin = new URL(startUrl).origin;
  const siteHost = new URL(startUrl).hostname;
  siteInfo.finalUrl = startUrl;
  siteInfo.server = home.headers.server || null;
  siteInfo.homepage = { status: home.status, ttfb: home.ttfb, bytes: home.bytes };

  const altHost = siteHost.startsWith('www.') ? siteHost.slice(4) : `www.${siteHost}`;
  const alt = await tryFetch(`${new URL(startUrl).protocol}//${altHost}/`, { method: 'HEAD', maxRedirects: 0 });
  if (!alt.error && alt.status === 200 && home.status === 200) siteIssues.push({ code: 'www_duplicate', detail: altHost });

  // ---------------------------------------------------- robots.txt & sitemap
  let robots = { rules: [], sitemaps: [], blocksAll: false };
  const robotsRes = await tryFetch(`${origin}/robots.txt`, { maxBytes: 512 * 1024 });
  if (!robotsRes.error && robotsRes.status === 200 && !isHtml(robotsRes)) {
    robots = parseRobots(robotsRes.body);
    siteInfo.robots = { found: true, sitemaps: robots.sitemaps.slice(0, 20) };
    if (robots.blocksAll) siteIssues.push({ code: 'robots_blocks_all' });
  } else {
    siteIssues.push({ code: 'robots_missing' });
  }

  const sitemapUrls = await loadSitemaps(
    robots.sitemaps.length ? robots.sitemaps.slice(0, 10) : [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`],
    siteInfo,
  );
  siteInfo.sitemap.urlCount = sitemapUrls.size;
  if (!siteInfo.sitemap.found) siteIssues.push({ code: 'sitemap_missing' });
  else if (sitemapUrls.size === 0) siteIssues.push({ code: 'sitemap_invalid' });
  if (siteInfo.sitemap.found && siteInfo.robots.found && robots.sitemaps.length === 0) siteIssues.push({ code: 'sitemap_not_in_robots' });

  // ---------------------------------------------------- BFS tarama
  const pages = new Map(); // url -> { record, issues, links }
  const seen = new Set([startUrl]);
  // Ana sayfaya giden yönlendirmeler site düzeyinde değerlendirildi; sayfa kaydına yansımasın
  const queue = [{ url: startUrl, depth: 0, prefetched: { ...home, redirects: [] } }];
  let sitemapSeeded = false;
  let active = 0;

  const enqueue = (url, depth) => {
    if (seen.size >= maxPages * 3 || seen.has(url)) return;
    const u = new URL(url);
    if (u.hostname !== siteHost || !isCrawlable(url) || !isAllowed(robots.rules, u.pathname + u.search)) return;
    seen.add(url);
    queue.push({ url, depth });
  };

  const processItem = async ({ url, depth, prefetched }) => {
    const res = prefetched || (await tryFetch(url));
    const record = { url, depth, statusCode: null, loadMs: null, bytes: null };
    const issues = [];
    let links = [];
    let anchors = null;
    let keywords = [];
    let data = {};

    if (res.error) {
      issues.push({ code: 'fetch_failed', detail: res.error.message });
    } else {
      record.statusCode = res.status;
      record.loadMs = res.totalMs;
      record.bytes = res.bytes;
      record.redirected = res.redirects.length > 0;
      siteInfo.statusCodes[res.status] = (siteInfo.statusCodes[res.status] || 0) + 1;
      if (res.redirects.length > 1 || res.tooManyRedirects) {
        issues.push({ code: 'redirect_chain', detail: `${res.redirects.length} yönlendirme → ${res.finalUrl}` });
      }
      if (res.status >= 500) issues.push({ code: 'http_5xx', detail: String(res.status) });
      else if (res.status >= 400) issues.push({ code: 'http_4xx', detail: String(res.status) });
      else if (res.status === 200 && isHtml(res)) {
        const finalHost = new URL(res.finalUrl).hostname;
        if (finalHost === siteHost) {
          const analysis = analyzePage(res, siteHost);
          issues.push(...analysis.issues);
          links = analysis.links;
          anchors = analysis.anchors;
          keywords = analysis.keywords;
          data = analysis.data;
        }
      }
    }
    if (typeof depth === 'number' && depth >= 4) issues.push({ code: 'deep_page', detail: `${depth} tık` });
    pages.set(url, { record: { ...record, ...data }, issues, links, anchors, keywords });
    for (const link of links) enqueue(link, typeof depth === 'number' ? depth + 1 : null);
  };

  await new Promise((resolve) => {
    const pump = () => {
      while (active < CONCURRENCY && queue.length && pages.size + active < maxPages) {
        const item = queue.shift();
        active++;
        processItem(item)
          .catch((err) => pages.set(item.url, { record: { url: item.url, depth: item.depth }, issues: [{ code: 'fetch_failed', detail: err.message }], links: [], keywords: [] }))
          .finally(() => {
            active--;
            pump();
          });
      }
      if (active > 0) return;
      // Bağlantılarla ulaşılamayan (yetim) sayfaları yakalamak için site haritası en sona eklenir
      if (!sitemapSeeded && !queue.length && pages.size < maxPages) {
        sitemapSeeded = true;
        for (const u of sitemapUrls.keys()) enqueue(u, null);
        if (queue.length) return pump();
      }
      resolve();
    };
    pump();
  });

  // ---------------------------------------------------- Sayfalar arası kontroller
  const okPages = [...pages.values()].filter((p) => p.record.statusCode === 200 && p.record.title !== undefined);
  const dupCheck = (field, code) => {
    const groups = new Map();
    for (const p of okPages) {
      const v = p.record[field];
      if (!v || p.record.noindex) continue;
      const key = v.toLowerCase();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    }
    for (const group of groups.values()) {
      if (group.length > 1) group.forEach((p) => p.issues.push({ code, detail: `${group.length} sayfada aynı` }));
    }
  };
  dupCheck('title', 'title_duplicate');
  dupCheck('metaDescription', 'meta_desc_duplicate');

  for (const p of pages.values()) {
    const broken = p.links.filter((l) => {
      const target = pages.get(l);
      return target && (target.record.statusCode >= 400 || target.issues.some((i) => i.code === 'fetch_failed'));
    });
    broken.slice(0, 20).forEach((l) => p.issues.push({ code: 'broken_internal_link', detail: l }));

    if (p.record.canonical && p.record.canonical !== p.record.url) {
      const target = pages.get(p.record.canonical);
      if (target && target.record.statusCode >= 400) p.issues.push({ code: 'canonical_invalid', detail: `Hatalı sayfa: ${p.record.canonical}` });
    }
    if (sitemapUrls.has(p.record.url)) {
      const reason =
        p.record.statusCode !== 200 ? `HTTP ${p.record.statusCode ?? 'hata'}` : p.record.redirected ? 'Yönlendirme' : p.record.noindex ? 'noindex' : null;
      if (reason) p.issues.push({ code: 'sitemap_bad_urls', detail: reason });
    }
  }

  const homeData = pages.get(startUrl)?.record;
  if (homeData && !homeData.hasFavicon) {
    const fav = await tryFetch(`${origin}/favicon.ico`, { method: 'HEAD' });
    if (fav.error || fav.status !== 200) siteIssues.push({ code: 'favicon_missing' });
  }

  analyzeSiteContent({ pages, okPages, startUrl, sitemapUrls, siteInfo, crawlComplete: pages.size < maxPages });

  const ttfbs = [...pages.values()].map((p) => p.record.loadMs).filter(Number.isFinite);
  siteInfo.avgLoadMs = ttfbs.length ? Math.round(ttfbs.reduce((a, b) => a + b, 0) / ttfbs.length) : null;

  // Sitenin hedeflediği diller (hreflang + sayfa dili): rakip karşılaştırması için
  const langs = new Set();
  for (const p of pages.values()) {
    for (const h of p.record.hreflangs || []) if (h.lang !== 'x-default') langs.add(h.lang.split('-')[0]);
    if (p.record.lang) langs.add(p.record.lang.toLowerCase().split('-')[0]);
  }
  siteInfo.languages = [...langs].slice(0, 60);

  return { startUrl, pages: [...pages.values()], siteIssues, siteInfo, sitemapUrls };
}

/** Site haritası URL'lerini senkronlar: yeniler eklenir (first_seen), lastmod güncellenir, çıkarılanlar silinir. */
export async function syncSitemapUrls(client, table, ownerCol, ownerId, sitemapUrls) {
  const urls = [...sitemapUrls.keys()];
  if (!urls.length) return { added: [], removed: [] };
  const { rows: prev } = await client.query(`SELECT url FROM ${table} WHERE ${ownerCol} = $1`, [ownerId]);
  const before = new Set(prev.map((r) => r.url));
  const added = urls.filter((u) => !before.has(u));
  const removed = [...before].filter((u) => !sitemapUrls.has(u));
  for (let i = 0; i < urls.length; i += 5000) {
    const slice = urls.slice(i, i + 5000);
    await client.query(
      `INSERT INTO ${table} (${ownerCol}, url, lastmod) SELECT $1::uuid, u.url, u.lastmod::date FROM unnest($2::text[], $3::text[]) AS u(url, lastmod)
       ON CONFLICT (${ownerCol}, url) DO UPDATE SET lastmod = EXCLUDED.lastmod`,
      [ownerId, slice, slice.map((u) => sitemapUrls.get(u))],
    );
  }
  if (removed.length) await client.query(`DELETE FROM ${table} WHERE ${ownerCol} = $1 AND url = ANY($2::text[])`, [ownerId, removed]);
  return { added: before.size ? added : [], removed };
}

export async function runAudit(auditId, domainId, hostname) {
  await query("UPDATE audits SET status = 'running', started_at = now() WHERE id = $1", [auditId]);
  try {
    const { startUrl, pages, siteIssues, siteInfo, sitemapUrls } = await crawlSite(hostname, config.auditMaxPages);

    const issueRows = [
      ...siteIssues.map((i) => [auditId, i.code, startUrl, i.detail || null]),
      ...pages.flatMap((p) => p.issues.map((i) => [auditId, i.code, p.record.url, i.detail || null])),
    ];
    const counts = {};
    for (const [, code, url] of issueRows) (counts[code] ||= new Set()).add(url);
    const score = computeScore(Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v.size])), pages.length);

    await withTransaction(async (client) => {
      await bulkInsert(
        client,
        'audit_pages',
        [
          'audit_id', 'url', 'status_code', 'load_ms', 'bytes', 'title', 'meta_description', 'h1', 'word_count', 'depth', 'issue_count',
          'canonical', 'noindex', 'lang', 'h2_count', 'internal_links', 'external_links', 'inlinks', 'images', 'images_no_alt',
          'schema_types', 'in_sitemap', 'onpage_score', 'primary_keyword', 'schema_report', 'outline', 'published_at', 'modified_at',
        ],
        [
          'uuid', 'text', 'int', 'int', 'int', 'text', 'text', 'text', 'int', 'int', 'int',
          'text', 'bool', 'text', 'int', 'int', 'int', 'int', 'int', 'int', 'text[]', 'bool', 'int', 'text', 'jsonb', 'jsonb', 'date', 'date',
        ],
        pages.map(({ record: r, issues }) => [
          auditId, r.url, r.statusCode ?? null, r.loadMs ?? null, r.bytes ?? null,
          r.title ?? null, r.metaDescription ?? null, r.h1 ?? null, r.wordCount ?? null,
          typeof r.depth === 'number' ? r.depth : -1, issues.length,
          r.canonical ?? null, Boolean(r.noindex), r.lang ?? null, r.h2Count ?? null, r.internalLinks ?? null, r.externalLinks ?? null,
          r.inlinks ?? 0, r.images ?? null, r.imagesNoAlt ?? null, r.schemaTypes ?? [], Boolean(r.inSitemap), r.onpageScore ?? null,
          r.primaryKeyword ?? null, r.schemaReport ? JSON.stringify(r.schemaReport) : null,
          r.outline?.length ? JSON.stringify(r.outline) : null, r.publishedAt ?? null, r.modifiedAt ?? null,
        ]),
      );
      // İç bağlantı grafiği: sadece taranan sayfalar arası kenarlar (iç link önerileri ve anchor analizi)
      const crawled = new Set(pages.map((p) => p.record.url));
      await bulkInsert(
        client,
        'audit_links',
        ['audit_id', 'source_url', 'target_url', 'anchor'],
        ['uuid', 'text', 'text', 'text'],
        pages.flatMap(({ record: r, links, anchors }) =>
          links.filter((l) => l !== r.url && crawled.has(l)).map((l) => [auditId, r.url, l, anchors?.get(l) ?? null]),
        ),
      );
      await bulkInsert(
        client,
        'audit_keywords',
        ['audit_id', 'url', 'keyword', 'score', 'count', 'density', 'in_title', 'in_h1', 'in_meta', 'in_url', 'in_headings'],
        ['uuid', 'text', 'text', 'real', 'int', 'real', 'bool', 'bool', 'bool', 'bool', 'bool'],
        pages.flatMap(({ record: r, keywords }) =>
          keywords.map((k) => [auditId, r.url, k.keyword, k.score, k.count, k.density, k.inTitle, k.inH1, k.inMeta, k.inUrl, k.inHeadings]),
        ),
      );
      await bulkInsert(client, 'audit_issues', ['audit_id', 'code', 'url', 'detail'], ['uuid', 'text', 'text', 'text'], issueRows);
      await syncSitemapUrls(client, 'domain_sitemap_urls', 'domain_id', domainId, sitemapUrls);
      await client.query(
        "UPDATE audits SET status = 'completed', score = $2, pages_crawled = $3, site_info = $4, finished_at = now() WHERE id = $1",
        [auditId, score, pages.length, JSON.stringify(siteInfo)],
      );
    });
    await detectAuditChanges(auditId, domainId);
    await afterAudit(auditId, domainId, 'completed');
  } catch (err) {
    await query("UPDATE audits SET status = 'failed', error = $2, finished_at = now() WHERE id = $1", [auditId, String(err.message).slice(0, 500)]);
    await afterAudit(auditId, domainId, 'failed', err.message);
    throw err;
  }
}
