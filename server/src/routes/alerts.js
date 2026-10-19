import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { listAlerts, markRead } from '../services/alertService.js';
import { alertListQuery, alertReadSchema } from '../validation/schemas.js';

/** /api/alerts — kullanıcı yalnızca erişebildiği alan adlarının uyarılarını görür. */
const router = Router();

router.get('/', validate({ query: alertListQuery }), async (req, res) => {
  res.json(await listAlerts(req.user, req.valid.query));
});

/** id verilirse tek uyarı, verilmezse tümü okundu sayılır. */
router.post('/read', validate({ body: alertReadSchema }), async (req, res) => {
  await markRead(req.user, req.valid.body.id);
  res.status(204).end();
});

export default router;
