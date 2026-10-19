import { Router } from 'express';
import { heavyJobLimiter } from '../middleware/security.js';
import { validate } from '../middleware/validate.js';
import * as annotations from '../services/annotationService.js';
import * as changes from '../services/changeService.js';
import { ctrAnomalies } from '../services/insights/ctrService.js';
import { keywordClusters } from '../services/insights/clusterService.js';
import * as competitors from '../services/insights/competitorService.js';
import { contentDecay, decayPageQueries } from '../services/insights/decayService.js';
import { linkSuggestions } from '../services/insights/linkSuggestionService.js';
import * as logs from '../services/insights/logService.js';
import { schemaReport } from '../services/insights/schemaReportService.js';
import { geoReport } from '../services/insights/geoService.js';
import { generateSchema, schemaPlan, setSector } from '../services/insights/schemaGenerator.js';
import * as rankDrops from '../services/insights/rankDropService.js';
import { monitorQueue, serpQueue } from '../services/jobQueue.js';
import * as briefs from '../services/insights/briefService.js';
import { contentIdeas } from '../services/insights/contentIdeasService.js';
import { competitorIntel } from '../services/insights/competitorIntelService.js';
import { domainCrux } from '../services/insights/cruxService.js';
import * as serp from '../services/insights/serpTrackingService.js';
import { badRequest, conflict, notFound } from '../utils/httpError.js';
import {
  annotationIdParam, annotationRangeQuery, annotationSchema, changesQuery, competitorIdParam, competitorSchema, decayPageQuery,
  logIdParam, logLatestQuery, logSummarySchema, logVerifySchema, briefIdParam, briefSchema, competitorChangesQuery, serpTrackIdParam, serpTrackSchema,
  rankDropAnalysisSchema, rankDropIdParam, schemaGenerateSchema, schemaSectorSchema,
} from '../validation/schemas.js';

/** /api/domains/:id/insights — alan adı sahipliği üst router'da (loadDomain) doğrulanır. */
const router = Router({ mergeParams: true });
const requireGsc = (req, _res, next) => next(req.domain.gsc_property ? undefined : badRequest('Bu analiz için Search Console bağlantısı gerekli'));

// ------------------------------------------------------------------ Sayfa değişiklikleri
router.get('/changes', validate({ query: changesQuery }), async (req, res) => {
  res.json(await changes.listChanges(req.domain.id, req.valid.query));
});

router.get('/changes/watch', async (req, res) => {
  res.json({ ...(await changes.watchList(req.domain)), running: monitorQueue.has(req.domain.id) });
});

router.post('/changes/check', heavyJobLimiter, async (req, res) => {
  if (monitorQueue.has(req.domain.id)) throw conflict('Kontrol zaten sürüyor');
  monitorQueue.add(req.domain.id, () => changes.runMonitor(req.domain));
  res.status(202).json({ status: 'running' });
});

// ------------------------------------------------------------------ Search Console analizleri
router.get('/decay', requireGsc, async (req, res) => {
  res.json(await contentDecay(req.domain));
});

router.get('/decay/queries', heavyJobLimiter, requireGsc, validate({ query: decayPageQuery }), async (req, res) => {
  res.json(await decayPageQueries(req.domain, req.user.id, req.valid.query));
});

router.get('/ctr', requireGsc, async (req, res) => {
  res.json(await ctrAnomalies(req.domain));
});

// ------------------------------------------------------------------ Tarama tabanlı analizler (GSC opsiyonel)
router.get('/clusters', async (req, res) => {
  res.json(await keywordClusters(req.domain));
});

router.get('/links', async (req, res) => {
  res.json(await linkSuggestions(req.domain));
});

router.get('/schema', async (req, res) => {
  res.json(await schemaReport(req.domain));
});

// ------------------------------------------------------------------ Şema oluşturucu (sektör + sayfa türü)
router.get('/schema/plan', async (req, res) => {
  res.json(await schemaPlan(req.domain));
});

router.put('/schema/sector', validate({ body: schemaSectorSchema }), async (req, res) => {
  res.json(await setSector(req.domain, req.valid.body.businessType));
});

router.post('/schema/generate', heavyJobLimiter, validate({ body: schemaGenerateSchema }), async (req, res) => {
  res.json(await generateSchema(req.domain, req.valid.body));
});

// ------------------------------------------------------------------ GEO (yapay zekâ aramaları)
router.get('/geo', async (req, res) => {
  res.json(await geoReport(req.domain));
});

// ------------------------------------------------------------------ Sıralama kayıpları
router.get('/rank-drops', requireGsc, async (req, res) => {
  res.json(await rankDrops.rankDrops(req.domain));
});

router.get('/rank-drops/analyses', async (req, res) => {
  res.json({ analyses: await rankDrops.listAnalyses(req.domain) });
});

router.post('/rank-drops/analyses', heavyJobLimiter, requireGsc, validate({ body: rankDropAnalysisSchema }), async (req, res) => {
  res.status(202).json({ analysis: await rankDrops.createAnalysis(req.domain, req.user.id, req.valid.body) });
});

router.get('/rank-drops/analyses/:analysisId', validate({ params: rankDropIdParam }), async (req, res) => {
  res.json({ analysis: await rankDrops.getAnalysis(req.domain, req.valid.params.analysisId) });
});

router.delete('/rank-drops/analyses/:analysisId', validate({ params: rankDropIdParam }), async (req, res) => {
  await rankDrops.deleteAnalysis(req.domain, req.valid.params.analysisId);
  res.status(204).end();
});

// ------------------------------------------------------------------ Grafik notları
router.get('/annotations', validate({ query: annotationRangeQuery }), async (req, res) => {
  res.json(await annotations.listAnnotations(req.domain.id, req.valid.query));
});

router.post('/annotations', validate({ body: annotationSchema }), async (req, res) => {
  const note = await annotations.createAnnotation(req.domain.id, req.valid.body);
  if (!note) throw badRequest('Not sınırına ulaşıldı (500)');
  res.status(201).json({ note });
});

router.delete('/annotations/:annotationId', validate({ params: annotationIdParam }), async (req, res) => {
  if (!(await annotations.deleteAnnotation(req.domain.id, req.valid.params.annotationId))) throw notFound('Not bulunamadı');
  res.status(204).end();
});

// ------------------------------------------------------------------ Rakipler
router.get('/competitors', async (req, res) => {
  res.json(await competitors.compareCompetitors(req.domain));
});

router.post('/competitors', heavyJobLimiter, validate({ body: competitorSchema }), async (req, res) => {
  res.status(201).json({ competitor: await competitors.addCompetitor(req.domain, req.valid.body.hostname) });
});

router.post('/competitors/:competitorId/crawl', heavyJobLimiter, validate({ params: competitorIdParam }), async (req, res) => {
  await competitors.recrawlCompetitor(req.domain, req.valid.params.competitorId);
  res.status(202).json({ status: 'queued' });
});

router.delete('/competitors/:competitorId', validate({ params: competitorIdParam }), async (req, res) => {
  await competitors.removeCompetitor(req.domain, req.valid.params.competitorId);
  res.status(204).end();
});

router.get('/competitors/changes', validate({ query: competitorChangesQuery }), async (req, res) => {
  res.json(await competitors.competitorChanges(req.domain, req.valid.query));
});

router.get('/competitors/intel', async (req, res) => {
  res.json(await competitorIntel(req.domain));
});

// ------------------------------------------------------------------ Core Web Vitals geçmişi (CrUX)
router.get('/crux', async (req, res) => {
  res.json(await domainCrux(req.domain));
});

// ------------------------------------------------------------------ SERP özellikleri / AI Overview
router.get('/serp', async (req, res) => {
  res.json({ ...(await serp.serpOverview(req.domain)), running: serpQueue.has(req.domain.id) });
});

router.get('/serp/suggestions', async (req, res) => {
  res.json({ suggestions: await serp.suggestKeywords(req.domain) });
});

router.post('/serp/keywords', validate({ body: serpTrackSchema }), async (req, res) => {
  res.status(201).json(await serp.addKeywords(req.domain, req.valid.body.items));
});

router.delete('/serp/keywords/:trackId', validate({ params: serpTrackIdParam }), async (req, res) => {
  await serp.removeKeyword(req.domain, req.valid.params.trackId);
  res.status(204).end();
});

router.post('/serp/check', heavyJobLimiter, async (req, res) => {
  if (serpQueue.has(req.domain.id)) throw conflict('Kontrol zaten sürüyor');
  serpQueue.add(req.domain.id, () => serp.runChecks(req.domain));
  res.status(202).json({ status: 'running' });
});

// ------------------------------------------------------------------ İçerik fikirleri ve brief
router.get('/ideas', async (req, res) => {
  res.json(await contentIdeas(req.domain));
});

router.get('/briefs', async (req, res) => {
  res.json({ briefs: await briefs.listBriefs(req.domain) });
});

router.post('/briefs', heavyJobLimiter, validate({ body: briefSchema }), async (req, res) => {
  res.status(202).json({ brief: await briefs.createBrief(req.domain, req.user.id, req.valid.body) });
});

router.get('/briefs/:briefId', validate({ params: briefIdParam }), async (req, res) => {
  res.json({ brief: await briefs.getBrief(req.domain, req.valid.params.briefId) });
});

router.delete('/briefs/:briefId', validate({ params: briefIdParam }), async (req, res) => {
  await briefs.deleteBrief(req.domain, req.valid.params.briefId);
  res.status(204).end();
});

// ------------------------------------------------------------------ Log analizi
router.post('/logs/verify', heavyJobLimiter, validate({ body: logVerifySchema }), async (req, res) => {
  res.json({ results: await logs.verifyIps(req.valid.body.ips) });
});

router.post('/logs', heavyJobLimiter, validate({ body: logSummarySchema }), async (req, res) => {
  res.status(201).json({ analysis: await logs.saveAnalysis(req.domain, req.valid.body) });
});

router.get('/logs', validate({ query: logLatestQuery }), async (req, res) => {
  const [list, current] = await Promise.all([logs.listAnalyses(req.domain), logs.getAnalysis(req.domain, req.valid.query.id)]);
  res.json({ list, current });
});

router.delete('/logs/:logId', validate({ params: logIdParam }), async (req, res) => {
  if (!(await logs.deleteAnalysis(req.domain, req.valid.params.logId))) throw notFound('Analiz bulunamadı');
  res.status(204).end();
});

export default router;
