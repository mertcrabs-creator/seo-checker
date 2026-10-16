import { Router } from 'express';
import { config } from '../config.js';
import { heavyJobLimiter } from '../middleware/security.js';
import { validate } from '../middleware/validate.js';
import { rankQueue } from '../services/jobQueue.js';
import { query } from '../db/pool.js';
import * as gsc from '../services/rankings/gscRankingService.js';
import * as rankings from '../services/rankings/rankingService.js';
import { badRequest, conflict } from '../utils/httpError.js';
import {
  gscRankKeywordQuery, gscRankLookupQuery, gscRankMatrixQuery, gscRankSummaryQuery, rankCheckSchema, rankConfigSchema,
  rankKeywordQuery, rankLanguagesSchema, rankMatrixQuery,
} from '../validation/schemas.js';

/**
 * /api/domains/:id/rankings — alan adı sahipliği üst router'da (loadDomain) doğrulanır.
 * DataForSEO yapılandırılmamışsa sadece `config` uç noktası yanıt verir (enabled: false).
 */
const router = Router({ mergeParams: true });

const requireProvider = (_req, _res, next) =>
  next(config.dataforseo.enabled ? undefined : badRequest('Sıralama verisi için DataForSEO yapılandırılmalı'));

// ------------------------------------------------------------------ Search Console (ücretsiz)
const requireGsc = (req, _res, next) => next(req.domain.gsc_property ? undefined : badRequest('Bu alan adı için Search Console mülkü seçilmedi'));

router.get('/gsc/summary', requireGsc, validate({ query: gscRankSummaryQuery }), async (req, res) => {
  res.json(await gsc.summary(req.domain, req.valid.query.scope));
});

router.get('/gsc/keywords', requireGsc, validate({ query: gscRankKeywordQuery }), async (req, res) => {
  res.json(await gsc.keywords(req.domain, req.valid.query));
});

router.get('/gsc/matrix', requireGsc, validate({ query: gscRankMatrixQuery }), async (req, res) => {
  res.json(await gsc.matrix(req.domain, req.valid.query));
});

router.get('/gsc/lookup', requireGsc, validate({ query: gscRankLookupQuery }), async (req, res) => {
  res.json(await gsc.lookup(req.domain, req.valid.query.keyword));
});

/** Hedef diller (boş = site dilinden otomatik); hem Search Console hem DataForSEO görünümü kullanır. */
router.patch('/languages', validate({ body: rankLanguagesSchema }), async (req, res) => {
  await query('UPDATE domains SET rank_languages = $2 WHERE id = $1', [req.domain.id, req.valid.body.languages]);
  res.status(204).end();
});

// ------------------------------------------------------------------ DataForSEO (ücretli, opsiyonel)
router.get('/config', async (req, res) => {
  res.json(await rankings.getConfig(req.domain));
});

router.patch('/config', requireProvider, validate({ body: rankConfigSchema }), async (req, res) => {
  if (rankQueue.has(req.domain.id)) throw conflict('Güncelleme sürerken ayarlar değiştirilemez');
  await rankings.saveConfig(req.domain, req.valid.body);
  res.status(204).end();
});

router.post('/refresh', heavyJobLimiter, requireProvider, async (req, res) => {
  if (rankQueue.has(req.domain.id) || req.domain.rank_status === 'running') throw conflict('Sıralamalar zaten güncelleniyor');
  const snapshots = await rankings.prepareRefresh(req.domain);
  if (!snapshots.length) throw badRequest('Sitenin dili tespit edilemedi veya bu dil için desteklenen ülke yok. Ayarlardan dil seçin.');
  rankQueue.add(req.domain.id, () => rankings.runRefresh(req.domain, snapshots));
  res.status(202).json({ status: 'running', locations: snapshots.length });
});

router.get('/summary', requireProvider, async (req, res) => {
  res.json(await rankings.summary(req.domain));
});

router.get('/keywords', requireProvider, validate({ query: rankKeywordQuery }), async (req, res) => {
  const q = req.valid.query;
  res.json(await rankings.keywordList(req.domain, { ...q, locationCode: q.location, languageCode: q.language }));
});

router.get('/matrix', requireProvider, validate({ query: rankMatrixQuery }), async (req, res) => {
  res.json(await rankings.matrix(req.domain, req.valid.query));
});

const checkKey = (domain) => `check:${domain.id}`;

// Çok ülkede canlı SERP sorgusu uzun sürebilir: arka planda çalışır, sonuç /checks ile okunur
router.post('/check', heavyJobLimiter, requireProvider, validate({ body: rankCheckSchema }), async (req, res) => {
  if (rankQueue.has(checkKey(req.domain))) throw conflict('Bir kelime kontrolü zaten sürüyor');
  const targets = await rankings.targetsFor(req.domain);
  if (!targets.length) throw badRequest('Sitenin dili tespit edilemedi veya bu dil için desteklenen ülke yok. Ayarlardan dil seçin.');
  rankQueue.add(checkKey(req.domain), () => rankings.checkKeyword(req.domain, req.valid.body.keyword, targets));
  res.status(202).json({ status: 'running', keyword: req.valid.body.keyword, locations: targets.length });
});

router.get('/checks', requireProvider, async (req, res) => {
  res.json({ running: rankQueue.has(checkKey(req.domain)), checks: await rankings.recentChecks(req.domain) });
});

export default router;
