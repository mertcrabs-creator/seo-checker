import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { forbidden } from '../utils/httpError.js';

const limiterDefaults = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Çok fazla istek. Lütfen biraz sonra tekrar deneyin.' } },
};

export const apiLimiter = rateLimit({ ...limiterDefaults, windowMs: 60_000, limit: 300 });

// Brute-force: IP + e-posta başına (hesap bazlı kilit ayrıca DB'de tutulur)
export const loginLimiter = rateLimit({
  ...limiterDefaults,
  windowMs: 15 * 60_000,
  limit: 10,
  keyGenerator: (req) => `${req.ip}|${String(req.body?.email || '').toLowerCase().slice(0, 254)}`,
});

export const authIpLimiter = rateLimit({ ...limiterDefaults, windowMs: 15 * 60_000, limit: 50 });

// Oturum yenileme (sayfa yenileme / çoklu sekme): kötüye kullanıma karşı geniş bir üst sınır
export const sessionLimiter = rateLimit({ ...limiterDefaults, windowMs: 15 * 60_000, limit: 600 });

// Ağır işler (tarama, PageSpeed, senkron) için
export const heavyJobLimiter = rateLimit({
  ...limiterDefaults,
  windowMs: 10 * 60_000,
  limit: 20,
  keyGenerator: (req) => req.user?.id || req.ip,
});

// Anlık tek sayfa analizi (dış siteye istek atar)
export const analyzeLimiter = rateLimit({
  ...limiterDefaults,
  windowMs: 10 * 60_000,
  limit: 40,
  keyGenerator: (req) => req.user?.id || req.ip,
});

/**
 * Cookie ile çalışan uçlar (refresh/logout) için CSRF koruması:
 * SameSite=Strict cookie + Origin kontrolü + özel başlık (cross-origin formlar gönderemez,
 * CORS preflight da izin verilmeyen origin'lere kapalı).
 */
export function csrfGuard(req, _res, next) {
  const origin = req.get('origin');
  if (origin && !config.clientOrigins.includes(origin)) return next(forbidden('Geçersiz origin'));
  if (req.get('x-requested-with') !== 'XMLHttpRequest') return next(forbidden('Geçersiz istek'));
  next();
}
