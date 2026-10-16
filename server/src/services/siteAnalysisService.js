import { query } from '../db/pool.js';
import { CATEGORIES, ISSUES } from './audit/issueCatalog.js';

/**
 * Search Console'dan bağımsız site analizi: tüm veriler son tamamlanan taramadan
 * (audit_pages / audit_keywords / audit_issues) üretilir.
 * Sıralama kolonları sadece buradaki beyaz listelerden gelir.
 */

const escapeLike = (s) => s.replace(/[\\%_]/g, '\\$&');

export async function latestCompletedAudit(domainId) {
  const { rows } = await query(
    `SELECT id, score, pages_crawled, site_info, finished_at FROM audits
      WHERE domain_id = $1 AND status = 'completed' ORDER BY created_at DESC LIMIT 1`,
    [domainId],
  );
  return rows[0] || null;
}

const templateTerms = (audit) => audit.site_info?.templateTerms || [];

// ------------------------------------------------------------------ Genel bakış
export async function overview(audit) {
  const [stats, keywords, schema, depth, scores] = await Promise.all([
    query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status_code = 200 AND NOT noindex)::int AS indexable,
              count(*) FILTER (WHERE noindex)::int AS noindex,
              count(*) FILTER (WHERE status_code >= 400 OR status_code IS NULL)::int AS errors,
              count(*) FILTER (WHERE status_code BETWEEN 300 AND 399)::int AS redirects,
              round(avg(word_count) FILTER (WHERE status_code = 200))::int AS avg_words,
              count(*) FILTER (WHERE status_code = 200 AND NOT noindex AND word_count < 250)::int AS thin,
              round(avg(onpage_score))::int AS avg_onpage,
              count(*) FILTER (WHERE in_sitemap)::int AS in_sitemap,
              round(avg(inlinks) FILTER (WHERE status_code = 200), 1)::float AS avg_inlinks,
              count(*) FILTER (WHERE status_code = 200 AND cardinality(schema_types) > 0)::int AS with_schema,
              count(DISTINCT primary_keyword)::int AS targeted_keywords
         FROM audit_pages WHERE audit_id = $1`,
      [audit.id],
    ),
    query(
      `SELECT keyword, count(*)::int AS pages, round(sum(score)::numeric, 1)::float AS score,
              count(*) FILTER (WHERE in_title)::int AS title_pages, sum(count)::int AS occurrences
         FROM audit_keywords WHERE audit_id = $1 AND NOT (keyword = ANY($2::text[]))
        GROUP BY keyword HAVING bool_or(in_title OR in_h1)
        ORDER BY sum(score) DESC LIMIT 10`,
      [audit.id, templateTerms(audit)],
    ),
    query(
      `SELECT t AS type, count(*)::int AS pages FROM audit_pages, unnest(schema_types) AS t
        WHERE audit_id = $1 GROUP BY t ORDER BY 2 DESC LIMIT 12`,
      [audit.id],
    ),
    query(
      `SELECT depth, count(*)::int AS pages FROM audit_pages WHERE audit_id = $1 AND depth >= 0
        GROUP BY depth ORDER BY depth LIMIT 10`,
      [audit.id],
    ),
    query(
      `SELECT count(*) FILTER (WHERE onpage_score >= 90)::int AS good,
              count(*) FILTER (WHERE onpage_score >= 50 AND onpage_score < 90)::int AS average,
              count(*) FILTER (WHERE onpage_score < 50)::int AS poor
         FROM audit_pages WHERE audit_id = $1 AND onpage_score IS NOT NULL`,
      [audit.id],
    ),
  ]);
  return {
    audit: { id: audit.id, score: audit.score, finished_at: audit.finished_at, pages_crawled: audit.pages_crawled },
    stats: stats.rows[0],
    scoreDistribution: scores.rows[0],
    topKeywords: keywords.rows,
    schemaTypes: schema.rows,
    depth: depth.rows,
    templateTerms: templateTerms(audit),
  };
}

// ------------------------------------------------------------------ Anahtar kelimeler
const KEYWORD_SORT = { score: 'k.score', pages: 'k.pages', keyword: 'k.keyword', occurrences: 'k.occurrences', title_pages: 'k.title_pages' };

export async function keywordList(audit, { search, sort, order, page, pageSize, view }) {
  const params = [audit.id, templateTerms(audit)];
  const filters = [];
  if (search) {
    params.push(`%${escapeLike(search)}%`);
    filters.push(`k.keyword ILIKE $${params.length} ESCAPE '\\'`);
  }
  if (view === 'targeted') filters.push('(k.title_pages > 0 OR k.h1_pages > 0)');
  if (view === 'cannibal') filters.push('COALESCE(c.n, 0) > 1');
  if (view !== 'template') filters.push('NOT (k.keyword = ANY($2::text[]))');
  else filters.push('k.keyword = ANY($2::text[])');
  params.push(pageSize, (page - 1) * pageSize);
  const dir = order === 'asc' ? 'ASC' : 'DESC';

  const { rows } = await query(
    `WITH k AS (
       SELECT keyword, count(*)::int AS pages, round(sum(score)::numeric, 1)::float AS score, sum(count)::int AS occurrences,
              count(*) FILTER (WHERE in_title)::int AS title_pages, count(*) FILTER (WHERE in_h1)::int AS h1_pages,
              (array_agg(url ORDER BY score DESC))[1] AS best_url, round(max(density)::numeric, 2)::float AS max_density
         FROM audit_keywords WHERE audit_id = $1 GROUP BY keyword
     ), p AS (
       SELECT primary_keyword AS kw, count(*)::int AS n FROM audit_pages
        WHERE audit_id = $1 AND primary_keyword IS NOT NULL GROUP BY 1
     ), c AS (
       SELECT ap.primary_keyword AS kw, count(DISTINCT ap.url)::int AS n
         FROM audit_pages ap JOIN audit_issues i ON i.audit_id = ap.audit_id AND i.url = ap.url AND i.code = 'keyword_cannibalization'
        WHERE ap.audit_id = $1 GROUP BY 1
     )
     SELECT k.*, COALESCE(p.n, 0) AS primary_pages, COALESCE(c.n, 0) AS cannibal_pages, COUNT(*) OVER ()::int AS total
       FROM k LEFT JOIN p ON p.kw = k.keyword LEFT JOIN c ON c.kw = k.keyword
      WHERE ${filters.join(' AND ')}
      ORDER BY ${KEYWORD_SORT[sort]} ${dir} NULLS LAST, k.score DESC, k.keyword ASC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { total: rows[0]?.total || 0, rows: rows.map(({ total, ...r }) => r) };
}

export async function keywordPages(audit, keyword) {
  const { rows } = await query(
    `SELECT k.url, k.score, k.count, k.density, k.in_title, k.in_h1, k.in_meta, k.in_url, k.in_headings,
            p.title, p.onpage_score, p.word_count, p.inlinks, (p.primary_keyword = k.keyword) AS is_primary
       FROM audit_keywords k JOIN audit_pages p ON p.audit_id = k.audit_id AND p.url = k.url
      WHERE k.audit_id = $1 AND k.keyword = $2 ORDER BY k.score DESC LIMIT 200`,
    [audit.id, keyword],
  );
  return rows;
}

// ------------------------------------------------------------------ Sayfalar
const PAGE_SORT = {
  url: 'url', onpage_score: 'onpage_score', word_count: 'word_count', inlinks: 'inlinks',
  issue_count: 'issue_count', load_ms: 'load_ms', depth: 'depth',
};
const PAGE_VIEWS = {
  all: 'TRUE',
  issues: 'onpage_score < 90',
  thin: 'status_code = 200 AND NOT noindex AND word_count < 250',
  weak_links: 'status_code = 200 AND NOT noindex AND inlinks <= 1 AND depth <> 0',
  noindex: 'noindex',
  errors: '(status_code >= 400 OR status_code IS NULL)',
};

export async function pageList(audit, { search, sort, order, page, pageSize, view }) {
  const params = [audit.id];
  const filters = ['audit_id = $1', PAGE_VIEWS[view]];
  if (search) {
    params.push(`%${escapeLike(search)}%`);
    filters.push(`(url ILIKE $${params.length} ESCAPE '\\' OR title ILIKE $${params.length} ESCAPE '\\')`);
  }
  params.push(pageSize, (page - 1) * pageSize);
  const dir = order === 'asc' ? 'ASC' : 'DESC';
  const { rows } = await query(
    `SELECT url, status_code, title, word_count, onpage_score, inlinks, internal_links, primary_keyword, issue_count,
            load_ms, depth, in_sitemap, noindex, COUNT(*) OVER ()::int AS total
       FROM audit_pages WHERE ${filters.join(' AND ')}
      ORDER BY ${PAGE_SORT[sort]} ${dir} NULLS LAST, url ASC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { total: rows[0]?.total || 0, rows: rows.map(({ total, ...r }) => r) };
}

const SEVERITY_ORDER = { critical: 0, warning: 1, notice: 2 };

export async function pageDetail(audit, url) {
  const [page, issues, keywords] = await Promise.all([
    query(
      `SELECT url, status_code, load_ms, bytes, title, meta_description, h1, word_count, depth, issue_count, canonical, noindex,
              lang, h2_count, internal_links, external_links, inlinks, images, images_no_alt, schema_types, in_sitemap,
              onpage_score, primary_keyword
         FROM audit_pages WHERE audit_id = $1 AND url = $2`,
      [audit.id, url],
    ),
    query('SELECT code, detail FROM audit_issues WHERE audit_id = $1 AND url = $2 LIMIT 300', [audit.id, url]),
    query(
      `SELECT keyword, score, count, density, in_title, in_h1, in_meta, in_url, in_headings
         FROM audit_keywords WHERE audit_id = $1 AND url = $2 ORDER BY score DESC`,
      [audit.id, url],
    ),
  ]);
  if (!page.rows[0]) return null;

  // Aynı kuralın birden çok kaydını tek satırda topla
  const grouped = new Map();
  for (const i of issues.rows) {
    const def = ISSUES[i.code];
    if (!def || def.siteLevel) continue;
    const g = grouped.get(i.code) || { code: i.code, ...def, categoryLabel: CATEGORIES[def.category], details: [] };
    if (i.detail && g.details.length < 20) g.details.push(i.detail);
    grouped.set(i.code, g);
  }
  return {
    page: page.rows[0],
    issues: [...grouped.values()].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]),
    keywords: keywords.rows,
  };
}

// ------------------------------------------------------------------ Fırsatlar
export async function opportunities(audit) {
  const [cannibal, orphans, weakLinks, thin, primaryMissing, importantIssues] = await Promise.all([
    query(
      `SELECT ap.primary_keyword AS keyword,
              json_agg(json_build_object('url', ap.url, 'title', ap.title, 'onpage_score', ap.onpage_score, 'inlinks', ap.inlinks)
                       ORDER BY ap.inlinks DESC) AS pages
         FROM audit_pages ap JOIN audit_issues i ON i.audit_id = ap.audit_id AND i.url = ap.url AND i.code = 'keyword_cannibalization'
        WHERE ap.audit_id = $1 AND ap.primary_keyword IS NOT NULL
        GROUP BY ap.primary_keyword ORDER BY count(*) DESC, ap.primary_keyword LIMIT 30`,
      [audit.id],
    ),
    query(
      `SELECT ap.url, ap.title, ap.word_count FROM audit_pages ap
         JOIN audit_issues i ON i.audit_id = ap.audit_id AND i.url = ap.url AND i.code = 'orphan_page'
        WHERE ap.audit_id = $1 ORDER BY ap.word_count DESC NULLS LAST LIMIT 50`,
      [audit.id],
    ),
    query(
      `SELECT url, title, inlinks, word_count FROM audit_pages
        WHERE audit_id = $1 AND status_code = 200 AND NOT noindex AND inlinks <= 1 AND depth <> 0
        ORDER BY word_count DESC NULLS LAST LIMIT 30`,
      [audit.id],
    ),
    query(
      `SELECT url, title, word_count FROM audit_pages
        WHERE audit_id = $1 AND status_code = 200 AND NOT noindex AND word_count < 250
        ORDER BY inlinks DESC, word_count ASC LIMIT 30`,
      [audit.id],
    ),
    query(
      `SELECT p.url, p.title, p.h1, p.primary_keyword AS keyword, k.in_title, k.in_h1, k.in_meta
         FROM audit_pages p JOIN audit_keywords k ON k.audit_id = p.audit_id AND k.url = p.url AND k.keyword = p.primary_keyword
        WHERE p.audit_id = $1 AND p.status_code = 200 AND NOT p.noindex AND (NOT k.in_title OR NOT k.in_h1 OR NOT k.in_meta)
        ORDER BY p.inlinks DESC LIMIT 30`,
      [audit.id],
    ),
    query(
      `SELECT url, title, onpage_score, inlinks, issue_count FROM audit_pages
        WHERE audit_id = $1 AND status_code = 200 AND onpage_score < 80
        ORDER BY inlinks DESC, onpage_score ASC LIMIT 15`,
      [audit.id],
    ),
  ]);
  return {
    cannibalization: cannibal.rows,
    orphans: orphans.rows,
    weakLinks: weakLinks.rows,
    thinContent: thin.rows,
    keywordPlacement: primaryMissing.rows,
    importantPages: importantIssues.rows,
  };
}
