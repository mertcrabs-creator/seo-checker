import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { analyzeLimiter } from '../middleware/security.js';
import { validate } from '../middleware/validate.js';
import * as reports from '../services/tracking/reportService.js';
import * as tracking from '../services/tracking/trackingService.js';
import { trackingRangeQuery, trackingSessionsQuery, trackingUpdateSchema } from '../validation/schemas.js';

/** /api/domains/:id/tracking — alan adı erişimi üst router'da (loadDomain) doğrulanır. */
const router = Router({ mergeParams: true });

const withUrls = (site) => ({
  site,
  scriptUrl: tracking.scriptUrl(),
  collectUrl: tracking.collectUrl(),
  retention: { pageviewDays: config.tracking.pageviewDays, sessionDays: config.tracking.retentionDays },
});

router.get('/', async (req, res) => {
  res.json(withUrls(await tracking.getSite(req.domain.id)));
});

router.post('/', async (req, res) => {
  res.status(201).json(withUrls(await tracking.createSite(req.domain.id)));
});

router.patch('/', validate({ body: trackingUpdateSchema }), async (req, res) => {
  res.json(withUrls(await tracking.updateSite(req.domain.id, req.valid.body)));
});

router.post('/rotate', async (req, res) => {
  res.json(withUrls(await tracking.rotateKey(req.domain.id)));
});

// Siteye istek atar: tek sayfa analiziyle aynı sınır
router.post('/verify', analyzeLimiter, async (req, res) => {
  res.json(await tracking.verifyInstall(req.domain));
});

router.get('/summary', validate({ query: trackingRangeQuery }), async (req, res) => {
  res.json(await reports.summary(req.domain.id, req.valid.query.days));
});

router.get('/keywords', validate({ query: trackingRangeQuery }), async (req, res) => {
  res.json(await reports.keywords(req.domain.id, req.valid.query.days));
});

router.get('/sessions', validate({ query: trackingSessionsQuery }), async (req, res) => {
  res.json(await reports.sessions(req.domain.id, req.valid.query));
});

router.get('/sessions/:sessionId', validate({ params: z.object({ sessionId: z.string().uuid() }).passthrough() }), async (req, res) => {
  res.json(await reports.sessionDetail(req.domain.id, req.valid.params.sessionId));
});

export default router;
