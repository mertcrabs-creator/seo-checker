import { Router } from 'express';
import { heavyJobLimiter } from '../middleware/security.js';
import { validate } from '../middleware/validate.js';
import * as backlinks from '../services/backlinks/backlinkService.js';
import { backlinkQueue } from '../services/jobQueue.js';
import { config } from '../config.js';
import { badRequest, conflict, notFound } from '../utils/httpError.js';
import { backlinkDomainsQuery, backlinkIdParam, backlinkImportSchema, backlinkListQuery } from '../validation/schemas.js';

/** /api/domains/:id/backlinks — alan adı sahipliği üst router'da (loadDomain) doğrulanır. */
const router = Router({ mergeParams: true });

const busy = (domain) => backlinkQueue.has(domain.id) || domain.backlink_status === 'running';

router.get('/summary', async (req, res) => {
  res.json(await backlinks.summary(req.domain));
});

router.get('/', validate({ query: backlinkListQuery }), async (req, res) => {
  res.json(await backlinks.list(req.domain, req.valid.query));
});

router.get('/domains', validate({ query: backlinkDomainsQuery }), async (req, res) => {
  res.json(await backlinks.referringDomains(req.domain, req.valid.query));
});

/** Bing'den keşif + tüm bağlantıların doğrulanması (arka planda). */
router.post('/refresh', heavyJobLimiter, async (req, res) => {
  if (busy(req.domain)) throw conflict('Backlink taraması zaten sürüyor');
  if (!config.bing.enabled && !(await backlinks.hasLinks(req.domain))) {
    throw badRequest('Doğrulanacak bağlantı yok. Önce Search Console dışa aktarımını içe aktarın veya Bing API anahtarı ekleyin.');
  }
  await backlinks.markRunning(req.domain);
  backlinkQueue.add(req.domain.id, () => backlinks.runRefresh(req.domain));
  res.status(202).json({ status: 'running' });
});

/** Search Console "Bağlantılar" dışa aktarımı veya elle eklenen URL'ler; eklenenler hemen doğrulanır. */
router.post('/import', validate({ body: backlinkImportSchema }), async (req, res) => {
  const { urls = [], items = [], source } = req.valid.body;
  const added = await backlinks.upsertLinks(req.domain, [...urls.map((u) => ({ source: u })), ...items], source);
  if (added && !busy(req.domain)) {
    await backlinks.markRunning(req.domain);
    backlinkQueue.add(req.domain.id, () => backlinks.runRefresh(req.domain, { onlyUnverified: true }));
  }
  res.status(201).json({ added });
});

router.get('/disavow.txt', async (req, res) => {
  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="disavow-${req.domain.hostname}.txt"`);
  res.send(await backlinks.disavowFile(req.domain));
});

router.delete('/:backlinkId', validate({ params: backlinkIdParam }), async (req, res) => {
  if (!(await backlinks.remove(req.domain, req.valid.params.backlinkId))) throw notFound('Bağlantı bulunamadı');
  res.status(204).end();
});

export default router;
