import { Router } from 'express';
import { analyzeLimiter } from '../middleware/security.js';
import { validate } from '../middleware/validate.js';
import { analyzeUrl } from '../services/pageAnalysisService.js';
import { analyzeSchema } from '../validation/schemas.js';

const router = Router();

/** Herhangi bir herkese açık sayfanın anlık SEO analizi (SSRF koruması safeFetch içinde). */
router.post('/', analyzeLimiter, validate({ body: analyzeSchema }), async (req, res) => {
  res.json(await analyzeUrl(req.valid.body.url, req.valid.body.keyword));
});

export default router;
