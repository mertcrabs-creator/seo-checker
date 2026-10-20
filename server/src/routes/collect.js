import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import express, { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { collect } from '../services/tracking/trackingService.js';

/**
 * /api/t — müşteri sitelerinden çağrılan herkese açık uçlar (CrabRank script'i ve veri toplama).
 * Panelin güvenlik ayarlarından (helmet CSP, CORS, çerezler) bağımsızdır: hiçbir kimlik bilgisi kabul edilmez,
 * yanıtlar gövdesizdir ve her origin'e açıktır; yetki site anahtarı + alan adı eşleşmesiyle sağlanır.
 */
const router = Router();

const SCRIPT = readFileSync(new URL('../tracking/cr.v1.js', import.meta.url), 'utf8');
const SCRIPT_ETAG = `"${crypto.createHash('sha256').update(SCRIPT).digest('base64url').slice(0, 27)}"`;

const limiter = (limit) => rateLimit({ windowMs: 60_000, limit, standardHeaders: false, legacyHeaders: false, handler: (_req, res) => res.status(429).end() });

router.use((_req, res, next) => {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  next();
});

router.get('/cr.v1.js', limiter(120), (req, res) => {
  res.set({ 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400', ETag: SCRIPT_ETAG });
  if (req.get('if-none-match') === SCRIPT_ETAG) return res.status(304).end();
  res.send(SCRIPT);
});

router.options('/e', (_req, res) => {
  res.set({ 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' }).status(204).end();
});

// sendBeacon text/plain gönderir (CORS preflight gerektirmez); gövde en fazla 16 KB
router.post('/e', limiter(300), express.text({ type: () => true, limit: '16kb' }), (req, res) => {
  res.set('Cache-Control', 'no-store').status(204).end();
  if (typeof req.body !== 'string' || !req.body) return;
  collect(req.body, { ip: req.ip, ua: String(req.get('user-agent') || '').slice(0, 500), headers: req.headers })
    .catch((err) => console.warn('[tracking] collect', err.message));
});

// Bu router altında başka hiçbir şey yok; gövde hataları (ör. 16 KB aşımı) sessizce yanıtlanır
router.use((_req, res) => res.status(404).end());
router.use((err, _req, res, _next) => res.status(err.status || 400).end());

export default router;
