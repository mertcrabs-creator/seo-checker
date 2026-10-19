import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import * as users from '../services/userAdminService.js';
import { adminUserCreateSchema, adminUserIdParam, adminUserUpdateSchema } from '../validation/schemas.js';

/** /api/admin — ekip yönetimi, yalnızca admin. */
const router = Router();
router.use(requireRole('admin'));

router.get('/users', async (req, res) => {
  const [list, domains] = await Promise.all([users.listUsers(req.user), users.ownDomains(req.user)]);
  res.json({ users: list, domains });
});

router.post('/users', validate({ body: adminUserCreateSchema }), async (req, res) => {
  res.status(201).json({ user: await users.createUser(req.user, req.valid.body) });
});

router.patch('/users/:userId', validate({ params: adminUserIdParam, body: adminUserUpdateSchema }), async (req, res) => {
  await users.updateUser(req.user, req.valid.params.userId, req.valid.body);
  res.status(204).end();
});

router.delete('/users/:userId', validate({ params: adminUserIdParam }), async (req, res) => {
  await users.deleteUser(req.user, req.valid.params.userId);
  res.status(204).end();
});

export default router;
