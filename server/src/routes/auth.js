import { Router } from 'express';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth.js';
import { authIpLimiter, csrfGuard, loginLimiter, sessionLimiter } from '../middleware/security.js';
import { validate } from '../middleware/validate.js';
import * as auth from '../services/authService.js';
import { query } from '../db/pool.js';
import { changePasswordSchema, loginSchema, registerSchema } from '../validation/schemas.js';

const router = Router();
const COOKIE = 'rt';

const cookieOptions = () => ({
  httpOnly: true,
  secure: config.cookieSecure,
  sameSite: 'strict',
  path: '/api/auth',
  maxAge: config.refreshTtlMs,
});

const meta = (req) => ({ userAgent: req.get('user-agent'), ip: req.ip });

function sendSession(res, session, status = 200) {
  res.cookie(COOKIE, session.refreshToken, cookieOptions());
  res.status(status).json({ accessToken: session.accessToken, user: session.user });
}

// Sıkı IP sınırı sadece kimlik bilgisi alan uçlarda; oturum yenileme tahmin edilemez token ile korunur
// Tüm auth yanıtları önbelleğe alınmasın
router.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

router.get('/config', async (_req, res) => {
  const { rows } = await query('SELECT EXISTS (SELECT 1 FROM users) AS has_users');
  res.json({ registrationOpen: !rows[0].has_users || config.allowRegistration });
});

router.post('/register', authIpLimiter, csrfGuard, loginLimiter, validate({ body: registerSchema }), async (req, res) => {
  const user = await auth.register(req.valid.body);
  sendSession(res, await auth.issueSession(user, meta(req)), 201);
});

router.post('/login', authIpLimiter, csrfGuard, loginLimiter, validate({ body: loginSchema }), async (req, res) => {
  const { email, password } = req.valid.body;
  const user = await auth.verifyCredentials(email, password);
  sendSession(res, await auth.issueSession(user, meta(req)));
});

router.post('/refresh', sessionLimiter, csrfGuard, async (req, res) => {
  try {
    sendSession(res, await auth.rotateSession(req.cookies?.[COOKIE], meta(req)));
  } catch (err) {
    res.clearCookie(COOKIE, { ...cookieOptions(), maxAge: undefined });
    throw err;
  }
});

router.post('/logout', csrfGuard, async (req, res) => {
  await auth.revokeSession(req.cookies?.[COOKIE]);
  res.clearCookie(COOKIE, { ...cookieOptions(), maxAge: undefined });
  res.status(204).end();
});

router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

router.post('/change-password', authIpLimiter, requireAuth, csrfGuard, validate({ body: changePasswordSchema }), async (req, res) => {
  await auth.changePassword(req.user.id, req.valid.body.currentPassword, req.valid.body.newPassword);
  res.clearCookie(COOKIE, { ...cookieOptions(), maxAge: undefined });
  res.status(204).end();
});

export default router;
