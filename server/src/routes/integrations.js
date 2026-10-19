import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth.js';
import * as google from '../services/googleService.js';
import * as serpapi from '../services/rankings/serpapi.js';
import { forbidden } from '../utils/httpError.js';

const router = Router();

const callbackQuery = z.object({
  code: z.string().min(1).max(2000).optional(),
  state: z.string().min(1).max(200).optional(),
  error: z.string().max(200).optional(),
});

/**
 * Google'ın yönlendirdiği uç. Bearer token taşımaz; kullanıcı, DB'deki tek kullanımlık
 * ve 10 dk geçerli state ile eşleştirilir (CSRF / login CSRF koruması).
 */
router.get('/google/callback', async (req, res) => {
  const target = new URL('/settings', config.clientOrigins[0]);
  const parsed = callbackQuery.safeParse(req.query);
  if (!parsed.success || parsed.data.error || !parsed.data.code || !parsed.data.state) {
    target.searchParams.set('google', 'error');
    return res.redirect(303, target.href);
  }
  try {
    await google.handleCallback(parsed.data.code, parsed.data.state);
    target.searchParams.set('google', 'connected');
  } catch (err) {
    console.warn('[google] callback', err.message);
    target.searchParams.set('google', 'error');
  }
  res.redirect(303, target.href);
});

router.use(requireAuth);

// Google bağlantısı hesap sahibinindir: ekip üyeleri onu kullanır (durum + mülk listesi) ama bağlayıp kesemez
const ownerOnly = (req, _res, next) => next(req.user.fullAccess ? undefined : forbidden('Google bağlantısını yalnızca hesap sahibi yönetebilir'));

router.get('/google', async (req, res) => res.json({ ...(await google.getStatus(req.user.ownerId)), manageable: req.user.fullAccess }));

router.post('/google/auth-url', ownerOnly, async (req, res) => res.json({ url: await google.createAuthUrl(req.user.id) }));

router.get('/google/sites', async (req, res) => res.json({ sites: await google.listSites(req.user.ownerId) }));

/** Canlı doğrulama sağlayıcısı durumu ve kalan arama hakkı (hak harcamaz). */
router.get('/serpapi', async (_req, res) => {
  if (!config.serpapi.enabled) return res.json({ enabled: false });
  try {
    res.json({ enabled: true, ...(await serpapi.account()) });
  } catch (err) {
    res.json({ enabled: true, error: err.message });
  }
});

router.delete('/google', ownerOnly, async (req, res) => {
  await google.disconnect(req.user.id);
  res.status(204).end();
});

export default router;
