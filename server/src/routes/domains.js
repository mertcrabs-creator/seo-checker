import { Router } from 'express';
import { query, withTransaction } from '../db/pool.js';
import { heavyJobLimiter } from '../middleware/security.js';
import { validate } from '../middleware/validate.js';
import * as analytics from '../services/analyticsService.js';
import { runAudit } from '../services/audit/auditor.js';
import { CATEGORIES, ISSUES } from '../services/audit/issueCatalog.js';
import { auditQueue, indexQueue, pagespeedQueue, syncQueue } from '../services/jobQueue.js';
import { createReport, runReport } from '../services/pagespeedService.js';
import { runSync } from '../services/searchConsoleSync.js';
import * as site from '../services/siteAnalysisService.js';
import { contentGaps } from '../services/contentGapService.js';
import * as authority from '../services/authority/authorityService.js';
import * as indexing from '../services/indexService.js';
import * as insight from '../services/rankings/keywordInsightService.js';
import backlinkRoutes from './backlinks.js';
import insightRoutes from './insights.js';
import rankingRoutes from './rankings.js';
import trackingRoutes from './tracking.js';
import { badRequest, conflict, notFound } from '../utils/httpError.js';
import {
  auditIssueParams, countryCode, createDomainSchema, days, idParam, keywordInsightQuery, keywordTrendQuery, listQuery, serpCheckSchema,
  indexPagesQuery, pagespeedSchema, siteKeywordPagesQuery, siteKeywordQuery, sitePageDetailQuery, sitePageQuery, updateDomainSchema,
} from '../validation/schemas.js';
import { z } from 'zod';
import { accessParams, domainAccess } from '../services/accessService.js';

const router = Router();
const MAX_DOMAINS_PER_USER = 200;
const computing = new Set(); // aynı alan adında eşzamanlı otorite hesaplaması olmasın
const GSC_TABLES = ['gsc_daily', 'gsc_query_daily', 'gsc_page_daily', 'gsc_country_daily', 'gsc_device_daily', 'gsc_query_page', 'gsc_query_country', 'gsc_query_country_daily', 'gsc_page_monthly'];

/**
 * Erişim kontrolü: hesap sahibi tüm alan adlarını, ekip üyesi yalnızca atananları görür; diğerleri 404 (varlık sızdırılmaz).
 * user_id (sahip) Google API çağrılarında kullanılır: Search Console bağlantısı sahibindir.
 */
async function loadDomain(req, _res, next) {
  const { rows } = await query(
    `SELECT d.id, d.user_id, d.hostname, d.gsc_property, d.sync_status, d.sync_error, d.last_synced_at, d.created_at,
            d.rank_languages, d.rank_locations, d.rank_status, d.rank_error, d.rank_updated_at,
            d.backlink_status, d.backlink_error, d.backlink_updated_at, d.index_status, d.index_error, d.index_updated_at, d.ssl_expires_at, d.business_type
       FROM domains d WHERE d.id = $1 AND ${domainAccess('d', 2)}`,
    [req.valid.params.id, ...accessParams(req.user)],
  );
  if (!rows[0]) return next(notFound('Alan adı bulunamadı'));
  req.domain = rows[0];
  next();
}
const withDomain = [validate({ params: idParam }), loadDomain];


const emptyList = { total: 0, rows: [], range: null };

async function startAudit(domain) {
  const { rows: running } = await query(
    "SELECT id FROM audits WHERE domain_id = $1 AND status IN ('queued', 'running') LIMIT 1",
    [domain.id],
  );
  if (running[0] || auditQueue.has(domain.id)) throw conflict('Bu alan adı için tarama zaten devam ediyor');
  const { rows } = await query("INSERT INTO audits (domain_id) VALUES ($1) RETURNING id, status, created_at", [domain.id]);
  const audit = rows[0];
  auditQueue.add(domain.id, () => runAudit(audit.id, domain.id, domain.hostname));
  return audit;
}

async function startPagespeed(domain, url, strategy) {
  const key = `${domain.id}:${strategy}`;
  if (pagespeedQueue.has(key)) throw conflict('Bu test zaten çalışıyor');
  const id = await createReport(domain.id, url, strategy);
  pagespeedQueue.add(key, () => runReport(id, url, strategy));
  return id;
}

/** Site içi analiz uçları son tamamlanan taramayı kullanır; tarama yoksa `audit: null` döner. */
async function loadSiteAudit(req, _res, next) {
  req.audit = await site.latestCompletedAudit(req.domain.id);
  next();
}
const withSite = [...withDomain, loadSiteAudit];

// ------------------------------------------------------------------ CRUD
router.get('/', async (req, res) => {
  res.json({ domains: await analytics.domainSummaries(req.user) });
});

router.post('/', validate({ body: createDomainSchema }), async (req, res) => {
  const { hostname, gscProperty } = req.valid.body;
  const owner = req.user.ownerId;
  const { rows: countRows } = await query('SELECT count(*)::int AS n FROM domains WHERE user_id = $1', [owner]);
  if (countRows[0].n >= MAX_DOMAINS_PER_USER) throw badRequest('Alan adı limitine ulaştınız');
  // Ekip üyesinin eklediği alan adı da hesap sahibine aittir (Google bağlantısı onun); üyeye otomatik atanır
  const domain = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO domains (user_id, hostname, gsc_property) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, hostname) DO NOTHING RETURNING id, hostname, gsc_property, sync_status, created_at`,
      [owner, hostname, gscProperty || null],
    );
    if (!rows[0]) throw conflict('Bu alan adı zaten ekli');
    if (!req.user.fullAccess) await client.query('INSERT INTO domain_members (domain_id, user_id) VALUES ($1, $2)', [rows[0].id, req.user.id]);
    return rows[0];
  });
  if (domain.gsc_property) {
    await query("UPDATE domains SET sync_status = 'running' WHERE id = $1", [domain.id]);
    syncQueue.add(domain.id, () => runSync(domain.id, owner));
  }
  // Search Console bağlı olsun olmasın site analizi ve mobil hız testi hemen başlar
  await startAudit(domain);
  await startPagespeed(domain, `https://${domain.hostname}/`, 'mobile');
  res.status(201).json({ domain });
});

router.get('/:id', withDomain, (req, res) => res.json({ domain: req.domain }));

router.patch('/:id', withDomain, validate({ body: updateDomainSchema }), async (req, res) => {
  const { gscProperty } = req.valid.body;
  if (gscProperty !== req.domain.gsc_property && syncQueue.has(req.domain.id)) throw conflict('Senkronizasyon sürerken mülk değiştirilemez');
  const domain = await withTransaction(async (client) => {
    const { rows } = await client.query(
      'UPDATE domains SET gsc_property = $2 WHERE id = $1 RETURNING id, hostname, gsc_property, sync_status',
      [req.domain.id, gscProperty],
    );
    // Mülk değiştiyse eski mülkün verisi yeni mülkle karışmasın
    if (gscProperty !== req.domain.gsc_property) {
      for (const table of GSC_TABLES) await client.query(`DELETE FROM ${table} WHERE domain_id = $1`, [req.domain.id]);
      await client.query('UPDATE domains SET last_synced_at = NULL WHERE id = $1', [req.domain.id]);
    }
    return rows[0];
  });
  res.json({ domain });
});

router.delete('/:id', withDomain, async (req, res) => {
  await query('DELETE FROM domains WHERE id = $1', [req.domain.id]);
  res.status(204).end();
});

// ------------------------------------------------------------------ Search Console
router.post('/:id/sync', heavyJobLimiter, withDomain, async (req, res) => {
  if (!req.domain.gsc_property) throw badRequest('Önce bir Search Console mülkü seçin');
  if (syncQueue.has(req.domain.id)) throw conflict('Senkronizasyon zaten çalışıyor');
  await query("UPDATE domains SET sync_status = 'running', sync_error = NULL WHERE id = $1", [req.domain.id]);
  syncQueue.add(req.domain.id, () => runSync(req.domain.id, req.domain.user_id));
  res.status(202).json({ status: 'running' });
});

router.get('/:id/performance', withDomain, validate({ query: z.object({ days }) }), async (req, res) => {
  const range = await analytics.getRange([req.domain.id], req.valid.query.days);
  if (!range) return res.json({ range: null, current: null, previous: null, daily: [] });
  res.json(await analytics.performance(req.domain.id, range));
});

router.get('/:id/keywords', withDomain, validate({ query: listQuery }), async (req, res) => {
  const range = await analytics.getRange([req.domain.id], req.valid.query.days);
  if (!range) return res.json(emptyList);
  res.json({ ...(await analytics.keywordList([req.domain.id], req.valid.query, range)), range });
});

router.get('/:id/keywords/trend', withDomain, validate({ query: keywordTrendQuery }), async (req, res) => {
  const range = await analytics.getRange([req.domain.id], req.valid.query.days);
  if (!range) return res.json({ daily: [], pages: [] });
  res.json(await analytics.keywordTrend(req.domain.id, req.valid.query.query, range));
});

/** Tek kelime için en doğru ülke bazlı sıra: canlı Search Console kırılımı (28g/7g/cihaz/güven). */
router.get('/:id/keywords/insight', withDomain, validate({ query: keywordInsightQuery }), async (req, res) => {
  res.json({ countries: await insight.liveInsight(req.domain, req.domain.user_id, req.valid.query.query) });
});

/** Canlı Google sonucu ile doğrulama (SerpApi; arama hakkı harcar). */
router.post('/:id/keywords/serp-check', heavyJobLimiter, withDomain, validate({ body: serpCheckSchema }), async (req, res) => {
  const { query: keyword, country, device } = req.valid.body;
  res.json(await insight.serpCheck(req.domain, { keyword, country, device }));
});

router.get('/:id/keywords/serp-checks', withDomain, validate({ query: keywordInsightQuery }), async (req, res) => {
  res.json({ checks: await insight.serpChecks(req.domain, req.valid.query.query) });
});

router.get('/:id/pages', withDomain, validate({ query: listQuery }), async (req, res) => {
  const range = await analytics.getRange([req.domain.id], req.valid.query.days);
  if (!range) return res.json(emptyList);
  res.json({ ...(await analytics.pageList([req.domain.id], req.valid.query, range)), range });
});

router.get('/:id/breakdown', withDomain, validate({ query: z.object({ days, country: countryCode.optional() }) }), async (req, res) => {
  const range = await analytics.getRange([req.domain.id], req.valid.query.days);
  if (!range) return res.json({ countries: [], devices: [], positions: null });
  const [countries, devices, positions] = await Promise.all([
    analytics.breakdown(req.domain.id, range, 'country'),
    analytics.breakdown(req.domain.id, range, 'device'),
    analytics.positionDistribution([req.domain.id], range, req.valid.query.country),
  ]);
  res.json({ countries, devices, positions, range });
});

router.get('/:id/opportunities', withDomain, validate({ query: z.object({ days }) }), async (req, res) => {
  const range = await analytics.getRange([req.domain.id], req.valid.query.days);
  if (!range) return res.json({ strikingDistance: [], lowCtr: [], declining: [], rising: [] });
  res.json(await analytics.opportunities([req.domain.id], range));
});

// ------------------------------------------------------------------ Site sağlığı
router.post('/:id/audits', heavyJobLimiter, withDomain, async (req, res) => {
  res.status(202).json({ audit: await startAudit(req.domain) });
});

router.get('/:id/audits', withDomain, async (req, res) => {
  const { rows } = await query(
    `SELECT id, status, score, pages_crawled, error, started_at, finished_at, created_at
       FROM audits WHERE domain_id = $1 ORDER BY created_at DESC LIMIT 20`,
    [req.domain.id],
  );
  res.json({ audits: rows });
});

router.get('/:id/audits/latest', withDomain, async (req, res) => {
  const { rows } = await query(
    `SELECT id, status, score, pages_crawled, site_info, error, started_at, finished_at, created_at
       FROM audits WHERE domain_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [req.domain.id],
  );
  const audit = rows[0];
  if (!audit) return res.json({ audit: null });
  if (audit.status !== 'completed') return res.json({ audit });

  const [issues, pages, previous] = await Promise.all([
    query(
      `SELECT code, COUNT(DISTINCT url)::int AS pages, (array_agg(detail) FILTER (WHERE detail IS NOT NULL))[1] AS sample
         FROM audit_issues WHERE audit_id = $1 GROUP BY code`,
      [audit.id],
    ),
    query(
      `SELECT url, status_code, load_ms, bytes, title, meta_description, h1, word_count, depth, issue_count
         FROM audit_pages WHERE audit_id = $1 ORDER BY issue_count DESC, url LIMIT 500`,
      [audit.id],
    ),
    query(
      `SELECT score FROM audits WHERE domain_id = $1 AND status = 'completed' AND created_at < $2
        ORDER BY created_at DESC LIMIT 1`,
      [req.domain.id, audit.created_at],
    ),
  ]);

  const severityOrder = { critical: 0, warning: 1, notice: 2 };
  const issueList = issues.rows
    .filter((i) => ISSUES[i.code])
    .map((i) => ({ ...ISSUES[i.code], code: i.code, categoryLabel: CATEGORIES[ISSUES[i.code].category], pages: i.pages, sample: i.sample }))
    .sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || b.pages - a.pages);

  const summary = { critical: 0, warning: 0, notice: 0 };
  issueList.forEach((i) => (summary[i.severity] += i.pages));

  const categoryScores = Object.entries(CATEGORIES).map(([key, label]) => {
    const list = issueList.filter((i) => i.category === key);
    return { key, label, critical: list.filter((i) => i.severity === 'critical').length, issues: list.length };
  });

  res.json({
    audit: { ...audit, previousScore: previous.rows[0]?.score ?? null },
    summary,
    issues: issueList,
    categories: categoryScores,
    pages: pages.rows,
  });
});

router.get('/:id/audits/:auditId/issues/:code', validate({ params: auditIssueParams }), loadDomain, async (req, res) => {
  const { rows } = await query(
    `SELECT i.url, i.detail FROM audit_issues i JOIN audits a ON a.id = i.audit_id
      WHERE i.audit_id = $1 AND a.domain_id = $2 AND i.code = $3 ORDER BY i.url LIMIT 1000`,
    [req.valid.params.auditId, req.domain.id, req.valid.params.code],
  );
  res.json({ issue: ISSUES[req.valid.params.code] || null, items: rows });
});

// ------------------------------------------------------------------ Site içi analiz (Search Console gerektirmez)
router.get('/:id/site/overview', withSite, async (req, res) => {
  res.json(req.audit ? await site.overview(req.audit) : { audit: null });
});

router.get('/:id/site/keywords', withSite, validate({ query: siteKeywordQuery }), async (req, res) => {
  if (!req.audit) return res.json({ audit: null, total: 0, rows: [] });
  res.json({ audit: { id: req.audit.id }, ...(await site.keywordList(req.audit, req.valid.query)) });
});

router.get('/:id/site/keywords/pages', withSite, validate({ query: siteKeywordPagesQuery }), async (req, res) => {
  res.json({ pages: req.audit ? await site.keywordPages(req.audit, req.valid.query.keyword) : [] });
});

router.get('/:id/site/pages', withSite, validate({ query: sitePageQuery }), async (req, res) => {
  if (!req.audit) return res.json({ audit: null, total: 0, rows: [] });
  res.json({ audit: { id: req.audit.id }, ...(await site.pageList(req.audit, req.valid.query)) });
});

router.get('/:id/site/pages/detail', withSite, validate({ query: sitePageDetailQuery }), async (req, res) => {
  const detail = req.audit ? await site.pageDetail(req.audit, req.valid.query.url) : null;
  if (!detail) throw notFound('Sayfa son taramada bulunamadı');
  res.json(detail);
});

router.get('/:id/site/opportunities', withSite, async (req, res) => {
  res.json(req.audit ? { audit: { id: req.audit.id }, ...(await site.opportunities(req.audit)) } : { audit: null });
});

// ------------------------------------------------------------------ İndekslenme (URL Inspection API)
const requireGsc = (req, _res, next) => next(req.domain.gsc_property ? undefined : badRequest('Bu alan adı için Search Console mülkü seçilmedi'));

router.post('/:id/index/inspect', heavyJobLimiter, withDomain, requireGsc, async (req, res) => {
  if (indexQueue.has(req.domain.id) || req.domain.index_status === 'running') throw conflict('İndeks denetimi zaten sürüyor');
  await query("UPDATE domains SET index_status = 'running', index_error = NULL WHERE id = $1", [req.domain.id]);
  indexQueue.add(req.domain.id, () => indexing.runInspection(req.domain, req.domain.user_id));
  res.status(202).json({ status: 'running' });
});

router.get('/:id/index/summary', withDomain, async (req, res) => {
  res.json(await indexing.summary(req.domain));
});

router.get('/:id/index/pages', withDomain, validate({ query: indexPagesQuery }), async (req, res) => {
  res.json(await indexing.pages(req.domain, req.valid.query));
});

// ------------------------------------------------------------------ Site otoritesi
router.get('/:id/authority', withDomain, async (req, res) => {
  res.json(await authority.latest(req.domain));
});

router.post('/:id/authority/compute', heavyJobLimiter, withDomain, async (req, res) => {
  if (computing.has(req.domain.id)) throw conflict('Otorite zaten hesaplanıyor');
  computing.add(req.domain.id);
  try {
    res.json(await authority.computeAuthority(req.domain));
  } finally {
    computing.delete(req.domain.id);
  }
});

// ------------------------------------------------------------------ İçerik boşlukları (Search Console + tarama)
router.get('/:id/opportunities/content-gaps', withDomain, requireGsc, async (req, res) => {
  res.json(await contentGaps(req.domain));
});

// ------------------------------------------------------------------ Lokasyon bazlı sıralamalar
router.use('/:id/rankings', withDomain, rankingRoutes);
router.use('/:id/backlinks', withDomain, backlinkRoutes);
router.use('/:id/insights', withDomain, insightRoutes);
router.use('/:id/tracking', withDomain, trackingRoutes);

// ------------------------------------------------------------------ PageSpeed
router.post('/:id/pagespeed', heavyJobLimiter, withDomain, validate({ body: pagespeedSchema }), async (req, res) => {
  const { strategy } = req.valid.body;
  const url = req.valid.body.url || `https://${req.domain.hostname}/`;
  const target = new URL(url);
  if (target.hostname !== req.domain.hostname && target.hostname !== `www.${req.domain.hostname}` && `www.${target.hostname}` !== req.domain.hostname) {
    throw badRequest('URL bu alan adına ait olmalı');
  }
  const id = await startPagespeed(req.domain, target.href, strategy);
  res.status(202).json({ id, status: 'running' });
});

router.get('/:id/pagespeed', withDomain, async (req, res) => {
  const { rows } = await query(
    `SELECT DISTINCT ON (strategy) id, url, strategy, status, performance, accessibility, best_practices, seo,
            metrics, field_data, opportunities, diagnostics, error, created_at
       FROM pagespeed_reports WHERE domain_id = $1 ORDER BY strategy, created_at DESC`,
    [req.domain.id],
  );
  const history = await query(
    `SELECT strategy, performance, created_at FROM pagespeed_reports
      WHERE domain_id = $1 AND status = 'completed' ORDER BY created_at DESC LIMIT 30`,
    [req.domain.id],
  );
  res.json({
    mobile: rows.find((r) => r.strategy === 'mobile') || null,
    desktop: rows.find((r) => r.strategy === 'desktop') || null,
    history: history.rows.reverse(),
  });
});

export default router;
