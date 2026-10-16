import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { validate } from '../middleware/validate.js';
import * as analytics from '../services/analyticsService.js';
import { notFound } from '../utils/httpError.js';
import { countryCode, days, globalKeywordQuery } from '../validation/schemas.js';

const router = Router();

/** Kullanıcının alan adları (opsiyonel tek alan adı filtresiyle) — sahiplik burada garanti edilir. */
async function userDomainIds(userId, domainId) {
  const { rows } = await query(
    'SELECT id, hostname FROM domains WHERE user_id = $1 AND ($2::uuid IS NULL OR id = $2) AND gsc_property IS NOT NULL',
    [userId, domainId || null],
  );
  if (domainId && !rows.length) throw notFound('Alan adı bulunamadı');
  return rows;
}

router.get('/', validate({ query: globalKeywordQuery }), async (req, res) => {
  const domains = await userDomainIds(req.user.id, req.valid.query.domainId);
  const ids = domains.map((d) => d.id);
  const range = ids.length ? await analytics.getRange(ids, req.valid.query.days) : null;
  if (!range) return res.json({ total: 0, rows: [], range: null });
  const result = await analytics.keywordList(ids, req.valid.query, range);
  const hosts = new Map(domains.map((d) => [d.id, d.hostname]));
  result.rows.forEach((r) => (r.hostname = hosts.get(r.domain_id)));
  res.json({ ...result, range });
});

router.get(
  '/overview',
  validate({ query: z.object({ days, domainId: z.string().uuid().optional(), country: countryCode.optional() }) }),
  async (req, res) => {
    const domains = await userDomainIds(req.user.id, req.valid.query.domainId);
    const ids = domains.map((d) => d.id);
    const range = ids.length ? await analytics.getRange(ids, req.valid.query.days) : null;
    if (!range) return res.json({ range: null, positions: null, opportunities: null, countries: [] });
    const [positions, opportunities, countries] = await Promise.all([
      analytics.positionDistribution(ids, range, req.valid.query.country),
      analytics.opportunities(ids, range),
      analytics.countryList(ids, range),
    ]);
    const hosts = new Map(domains.map((d) => [d.id, d.hostname]));
    for (const list of Object.values(opportunities)) list.forEach((r) => (r.hostname = hosts.get(r.domain_id)));
    res.json({ range, positions, opportunities, countries });
  },
);

export default router;
