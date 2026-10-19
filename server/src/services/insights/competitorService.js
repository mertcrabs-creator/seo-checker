import { config } from '../../config.js';
import { bulkInsert } from '../../db/bulk.js';
import { query, withTransaction } from '../../db/pool.js';
import * as cheerio from 'cheerio';
import { crawlSite, syncSitemapUrls } from '../audit/auditor.js';
import { createAlert } from '../alertService.js';
import { safeFetch } from '../../utils/safeFetch.js';
import { computeScore } from '../audit/issueCatalog.js';
import { competitorQueue } from '../jobQueue.js';
import { badRequest, conflict, notFound } from '../../utils/httpError.js';

/**
 * Rakip karşılaştırması: rakip site kendi tarayıcımızla (robots.txt'ye uyarak) taranır ve
 * sayfa içi metrikler + hedeflenen konular karşılaştırılır. Ücretli veri sağlayıcı gerektirmez;
 * rakibin trafiği/sıralaması değil, içerik ve teknik yapısı görülür.
 */

export const MAX_COMPETITORS = 5;
const bare = (h) => String(h).toLowerCase().replace(/^www\./, '');

export async function listCompetitors(domain) {
  const { rows } = await query(
    `SELECT id, hostname, status, error, pages_crawled, score, created_at, finished_at FROM competitors
      WHERE domain_id = $1 ORDER BY created_at`,
    [domain.id],
  );
  return rows;
}

function enqueue(id, hostname) {
  competitorQueue.add(id, () => runCompetitor(id, hostname));
}

export async function addCompetitor(domain, hostname) {
  if (bare(hostname) === bare(domain.hostname)) throw badRequest('Kendi alan adınızı rakip olarak ekleyemezsiniz');
  const { rows: [c] } = await query('SELECT count(*)::int AS n FROM competitors WHERE domain_id = $1', [domain.id]);
  if (c.n >= MAX_COMPETITORS) throw badRequest(`En fazla ${MAX_COMPETITORS} rakip eklenebilir`);
  const { rows } = await query(
    `INSERT INTO competitors (domain_id, hostname) VALUES ($1, $2) ON CONFLICT (domain_id, hostname) DO NOTHING
     RETURNING id, hostname, status, created_at`,
    [domain.id, hostname],
  );
  if (!rows[0]) throw conflict('Bu rakip zaten ekli');
  enqueue(rows[0].id, hostname);
  return rows[0];
}

export async function recrawlCompetitor(domain, id) {
  const { rows: [c] } = await query('SELECT id, hostname, status FROM competitors WHERE id = $1 AND domain_id = $2', [id, domain.id]);
  if (!c) throw notFound('Rakip bulunamadı');
  if (competitorQueue.has(id) || ['queued', 'running'].includes(c.status)) throw conflict('Bu rakip zaten taranıyor');
  await query("UPDATE competitors SET status = 'queued', error = NULL WHERE id = $1", [id]);
  enqueue(id, c.hostname);
}

export async function removeCompetitor(domain, id) {
  const { rowCount } = await query('DELETE FROM competitors WHERE id = $1 AND domain_id = $2', [id, domain.id]);
  if (!rowCount) throw notFound('Rakip bulunamadı');
}

const norm = (v) => (v ? String(v).replace(/\s+/g, ' ').trim() : null);

/** Önceki taramayla karşılaştırma: aynı sayfalarda title/H1/içerik/yapısal veri değişiklikleri. */
function diffPages(oldRows, pages) {
  const old = new Map(oldRows.map((r) => [r.url, r]));
  const out = [];
  for (const { record: r } of pages) {
    const p = old.get(r.url);
    if (!p || r.statusCode !== 200 || p.status_code !== 200) continue;
    if (norm(p.title) !== norm(r.title)) out.push({ url: r.url, kind: 'title', oldValue: p.title, newValue: r.title });
    if (norm(p.h1) !== norm(r.h1)) out.push({ url: r.url, kind: 'h1', oldValue: p.h1, newValue: r.h1 });
    if (p.word_count >= 100 && r.wordCount >= p.word_count * 1.3 && r.wordCount - p.word_count >= 200) {
      out.push({ url: r.url, kind: 'content_expanded', oldValue: String(p.word_count), newValue: String(r.wordCount) });
    } else if (p.word_count >= 300 && r.wordCount <= p.word_count * 0.6) {
      out.push({ url: r.url, kind: 'content_reduced', oldValue: String(p.word_count), newValue: String(r.wordCount) });
    }
    const addedTypes = (r.schemaTypes || []).filter((t) => !(p.schema_types || []).includes(t));
    if (addedTypes.length) out.push({ url: r.url, kind: 'schema_added', oldValue: null, newValue: addedTypes.join(', ') });
  }
  return out;
}

/** Taramaya girmemiş yeni sayfaların başlıklarını hafifçe çek (en fazla 15). */
async function fetchTitles(urls) {
  const out = new Map();
  await Promise.all(urls.slice(0, 15).map(async (u) => {
    try {
      const res = await safeFetch(u, { timeoutMs: 12_000, maxBytes: 1024 * 1024 });
      if (res.status === 200) out.set(u, cheerio.load(res.body)('title').first().text().replace(/\s+/g, ' ').trim().slice(0, 300) || null);
    } catch {
      /* başlık alınamadı */
    }
  }));
  return out;
}

export async function runCompetitor(id, hostname) {
  await query("UPDATE competitors SET status = 'running', error = NULL WHERE id = $1", [id]);
  try {
    const { rows: oldRows } = await query('SELECT url, status_code, title, h1, word_count, schema_types FROM competitor_pages WHERE competitor_id = $1', [id]);
    const { pages, siteIssues, siteInfo, sitemapUrls } = await crawlSite(hostname, config.competitorMaxPages);
    const counts = {};
    for (const i of siteIssues) (counts[i.code] ||= new Set()).add('site');
    for (const p of pages) for (const i of p.issues) (counts[i.code] ||= new Set()).add(p.record.url);
    const score = computeScore(Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v.size])), pages.length);
    const info = {
      https: siteInfo.https, finalUrl: siteInfo.finalUrl, sitemapUrls: siteInfo.sitemap?.urlCount || 0, robots: siteInfo.robots?.found || false,
      avgLoadMs: siteInfo.avgLoadMs, statusCodes: siteInfo.statusCodes, templateTerms: siteInfo.templateTerms || [],
      issueCodes: Object.keys(counts), languages: siteInfo.languages || [],
    };
    const changes = diffPages(oldRows, pages);
    let newUrls = [];
    await withTransaction(async (client) => {
      // Rakip silindiyse (tarama sürerken) sessizce bırak
      const { rows: [exists] } = await client.query('SELECT 1 FROM competitors WHERE id = $1 FOR UPDATE', [id]);
      if (!exists) return;
      await client.query('DELETE FROM competitor_pages WHERE competitor_id = $1', [id]);
      await client.query('DELETE FROM competitor_keywords WHERE competitor_id = $1', [id]);
      await bulkInsert(
        client,
        'competitor_pages',
        [
          'competitor_id', 'url', 'status_code', 'title', 'h1', 'meta_description', 'word_count', 'primary_keyword', 'schema_types', 'onpage_score', 'depth',
          'inlinks', 'lang', 'outline', 'published_at', 'modified_at', 'schema_report',
        ],
        ['uuid', 'text', 'int', 'text', 'text', 'text', 'int', 'text', 'text[]', 'int', 'int', 'int', 'text', 'jsonb', 'date', 'date', 'jsonb'],
        pages.map(({ record: r }) => [
          id, r.url, r.statusCode ?? null, r.title ?? null, r.h1 ?? null, r.metaDescription ?? null, r.wordCount ?? null,
          r.primaryKeyword ?? null, r.schemaTypes ?? [], r.onpageScore ?? null, typeof r.depth === 'number' ? r.depth : -1,
          r.inlinks ?? 0, r.lang ?? null, r.outline?.length ? JSON.stringify(r.outline) : null, r.publishedAt ?? null, r.modifiedAt ?? null,
          r.schemaReport ? JSON.stringify(r.schemaReport) : null,
        ]),
      );
      // Site haritası farkı: yeni yayınlanan ve kaldırılan sayfalar (ilk taramada fark üretilmez)
      const diff = await syncSitemapUrls(client, 'competitor_sitemap_urls', 'competitor_id', id, sitemapUrls);
      newUrls = diff.added;
      for (const u of diff.removed.slice(0, 200)) changes.push({ url: u, kind: 'removed_page', oldValue: null, newValue: null });
      await bulkInsert(
        client,
        'competitor_keywords',
        ['competitor_id', 'url', 'keyword', 'score', 'in_title', 'in_h1'],
        ['uuid', 'text', 'text', 'real', 'bool', 'bool'],
        pages.flatMap(({ record: r, keywords }) => keywords.slice(0, 12).map((k) => [id, r.url, k.keyword, k.score, k.inTitle, k.inH1])),
      );
      await client.query(
        "UPDATE competitors SET status = 'completed', score = $2, pages_crawled = $3, site_info = $4, finished_at = now() WHERE id = $1",
        [id, score, pages.length, JSON.stringify(info)],
      );
    });
    await recordChanges(id, hostname, changes, newUrls, pages);
  } catch (err) {
    await query("UPDATE competitors SET status = 'failed', error = $2, finished_at = now() WHERE id = $1", [id, String(err.message).slice(0, 300)]);
    throw err;
  }
}

async function recordChanges(id, hostname, changes, newUrls, pages) {
  try {
    if (newUrls.length) {
      const crawled = new Map(pages.map((p) => [p.record.url, p.record]));
      const titles = await fetchTitles(newUrls.filter((u) => !crawled.get(u)?.title));
      for (const u of newUrls.slice(0, 300)) changes.push({ url: u, kind: 'new_page', oldValue: null, newValue: crawled.get(u)?.title || titles.get(u) || null });
    }
    if (!changes.length) return;
    await query(
      `INSERT INTO competitor_changes (competitor_id, url, kind, old_value, new_value)
       SELECT $1::uuid, * FROM unnest($2::text[], $3::text[], $4::text[], $5::text[])`,
      [id, changes.map((c) => c.url), changes.map((c) => c.kind), changes.map((c) => c.oldValue?.slice(0, 500) ?? null), changes.map((c) => c.newValue?.slice(0, 500) ?? null)],
    );
    const added = changes.filter((c) => c.kind === 'new_page');
    const updated = changes.filter((c) => c.kind === 'content_expanded' || c.kind === 'title');
    if (!added.length && !updated.length) return;
    const { rows: [c] } = await query('SELECT domain_id FROM competitors WHERE id = $1', [id]);
    if (!c) return;
    const parts = [added.length && `${added.length} yeni sayfa`, updated.length && `${updated.length} sayfada güncelleme`].filter(Boolean);
    await createAlert({
      domainId: c.domain_id, type: 'competitor_changes', severity: 'notice', title: `Rakip ${hostname}: ${parts.join(', ')}`,
      detail: [...added.slice(0, 5).map((a) => `• Yeni: ${a.newValue || a.url}`), ...updated.slice(0, 3).map((e) => `• Güncellendi: ${e.url}`)].join('\n'),
      data: { competitorId: id }, dedupeHours: 1,
    });
  } catch (err) {
    console.warn('[competitors] değişiklikler', err.message);
  }
}

export async function competitorChanges(domain, { competitorId, kind, page = 1, pageSize = 50 }) {
  const params = [domain.id];
  const filters = ['c.domain_id = $1'];
  if (competitorId) {
    params.push(competitorId);
    filters.push(`ch.competitor_id = $${params.length}`);
  }
  if (kind) {
    params.push(kind);
    filters.push(`ch.kind = $${params.length}`);
  }
  params.push(pageSize, (page - 1) * pageSize);
  const { rows } = await query(
    `SELECT ch.id, ch.url, ch.kind, ch.old_value, ch.new_value, ch.created_at, c.hostname, COUNT(*) OVER ()::int AS total
       FROM competitor_changes ch JOIN competitors c ON c.id = ch.competitor_id
      WHERE ${filters.join(' AND ')} ORDER BY ch.created_at DESC, ch.kind
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { total: rows[0]?.total || 0, rows: rows.map(({ total, ...r }) => r) };
}

// ------------------------------------------------------------------ Karşılaştırma
const METRICS_SQL = (table, key) => `
  SELECT count(*)::int AS pages,
         count(*) FILTER (WHERE status_code = 200 ${table === 'audit_pages' ? 'AND NOT noindex' : ''})::int AS ok_pages,
         round(avg(word_count) FILTER (WHERE status_code = 200))::int AS avg_words,
         (percentile_cont(0.5) WITHIN GROUP (ORDER BY word_count) FILTER (WHERE status_code = 200))::int AS median_words,
         round(avg(onpage_score) FILTER (WHERE status_code = 200))::int AS avg_onpage,
         avg((cardinality(schema_types) > 0)::int) FILTER (WHERE status_code = 200)::float AS schema_coverage,
         avg((meta_description IS NOT NULL)::int) FILTER (WHERE status_code = 200)::float AS meta_coverage,
         avg((h1 IS NOT NULL)::int) FILTER (WHERE status_code = 200)::float AS h1_coverage,
         round(avg(length(title)) FILTER (WHERE status_code = 200))::int AS avg_title_len,
         count(*) FILTER (WHERE status_code = 200 AND word_count >= 1000)::int AS long_pages,
         (SELECT array_agg(t ORDER BY n DESC) FROM (
            SELECT t, count(*) AS n FROM ${table}, unnest(schema_types) AS t WHERE ${key} = $1 GROUP BY t ORDER BY n DESC LIMIT 6) s) AS schema_types
    FROM ${table} WHERE ${key} = $1`;

/** Her sitenin hedeflediği konular: title veya H1'de geçen (şablon terimleri hariç) kelimeler. */
async function targetedTopics(table, key, id, templateTerms) {
  const { rows } = await query(
    `SELECT k.keyword, max(k.score)::float AS score, count(DISTINCT k.url)::int AS pages,
            (array_agg(k.url ORDER BY k.score DESC))[1] AS url
       FROM ${table} k WHERE k.${key} = $1 AND (k.in_title OR k.in_h1) AND NOT (k.keyword = ANY($2::text[]))
      GROUP BY k.keyword`,
    [id, templateTerms],
  );
  return new Map(rows.map((r) => [r.keyword, r]));
}

export async function compareCompetitors(domain) {
  const competitors = await listCompetitors(domain);
  const { rows: [audit] } = await query(
    `SELECT id, score, pages_crawled, site_info FROM audits WHERE domain_id = $1 AND status = 'completed' ORDER BY created_at DESC LIMIT 1`,
    [domain.id],
  );
  const done = competitors.filter((c) => c.status === 'completed');
  if (!audit || !done.length) return { needsAudit: !audit, competitors, sites: [], gaps: [], shared: [] };

  const { rows: [ours] } = await query(METRICS_SQL('audit_pages', 'audit_id'), [audit.id]);
  const ourTopics = await targetedTopics('audit_keywords', 'audit_id', audit.id, audit.site_info?.templateTerms || []);
  // Hiçbir sayfamızda (gövde dahil) geçmeyen konu gerçek boşluktur; sadece title/H1'de olmayan zayıf kapsamadır
  const { rows: anyKw } = await query('SELECT DISTINCT keyword FROM audit_keywords WHERE audit_id = $1', [audit.id]);
  const ourAny = new Set(anyKw.map((r) => r.keyword));
  const { rows: ourWords } = await query('SELECT url, word_count, title FROM audit_pages WHERE audit_id = $1', [audit.id]);
  const ourPage = new Map(ourWords.map((r) => [r.url, r]));

  const sites = [{
    id: null, hostname: domain.hostname, own: true, score: audit.score, https: audit.site_info?.https ?? null,
    sitemapUrls: audit.site_info?.sitemap?.urlCount ?? null, avgLoadMs: audit.site_info?.avgLoadMs ?? null, topics: ourTopics.size, ...ours,
  }];
  const gapMap = new Map();
  const shared = [];
  for (const c of done) {
    const { rows: [m] } = await query(METRICS_SQL('competitor_pages', 'competitor_id'), [c.id]);
    const { rows: [info] } = await query('SELECT site_info FROM competitors WHERE id = $1', [c.id]);
    const si = info?.site_info || {};
    const topics = await targetedTopics('competitor_keywords', 'competitor_id', c.id, si.templateTerms || []);
    const { rows: theirWords } = await query('SELECT url, word_count, title FROM competitor_pages WHERE competitor_id = $1', [c.id]);
    const theirPage = new Map(theirWords.map((r) => [r.url, r]));
    sites.push({ id: c.id, hostname: c.hostname, own: false, score: c.score, https: si.https ?? null, sitemapUrls: si.sitemapUrls ?? null, avgLoadMs: si.avgLoadMs ?? null, topics: topics.size, ...m });

    for (const [kw, t] of topics) {
      if (kw.length < 4) continue;
      const mine = ourTopics.get(kw);
      if (mine) {
        const a = ourPage.get(mine.url);
        const b = theirPage.get(t.url);
        shared.push({ keyword: kw, competitor: c.hostname, ourUrl: mine.url, ourWords: a?.word_count ?? null, theirUrl: t.url, theirWords: b?.word_count ?? null, theirTitle: b?.title ?? null });
        continue;
      }
      const g = gapMap.get(kw) || { keyword: kw, score: 0, competitors: [], weak: ourAny.has(kw) };
      g.score += t.score;
      g.competitors.push({ hostname: c.hostname, url: t.url, title: theirPage.get(t.url)?.title ?? null, words: theirPage.get(t.url)?.word_count ?? null, pages: t.pages });
      gapMap.set(kw, g);
    }
  }
  // Bir rakip sayfası tek konu olarak sayılır (aynı sayfadan "prp in turkey" + "prp in der" gibi tekrarlar çıkmasın)
  const usedPages = new Set();
  const gaps = [...gapMap.values()]
    .sort((a, b) => b.competitors.length - a.competitors.length || Number(a.weak) - Number(b.weak) || b.score - a.score)
    .filter((g) => {
      const keys = g.competitors.map((c) => c.url);
      if (keys.every((k) => usedPages.has(k))) return false;
      keys.forEach((k) => usedPages.add(k));
      return true;
    })
    .slice(0, 150);
  // Rakibin aynı konuda belirgin şekilde daha kapsamlı içeriği olan sayfalar
  const thinner = shared
    .filter((s) => s.keyword.includes(' ') && s.ourWords !== null && s.theirWords !== null && s.theirWords >= 400 && s.theirWords > s.ourWords * 1.5)
    .sort((a, b) => b.theirWords - b.ourWords - (a.theirWords - a.ourWords))
    .slice(0, 60);
  return { competitors, sites, gaps, thinner, sharedCount: new Set(shared.map((s) => s.keyword)).size };
}
