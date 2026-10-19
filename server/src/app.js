import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { requireAuth } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { apiLimiter } from './middleware/security.js';
import alertRoutes from './routes/alerts.js';
import analyzeRoutes from './routes/analyze.js';
import authRoutes from './routes/auth.js';
import domainRoutes from './routes/domains.js';
import integrationRoutes from './routes/integrations.js';
import keywordRoutes from './routes/keywords.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.set('query parser', 'simple'); // dizi/nesne enjeksiyonu (qs) kapalı

  app.use(
    helmet({
      // API sadece JSON döner: hiçbir kaynak yüklenemez, çerçevelenemez
      contentSecurityPolicy: { useDefaults: false, directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      frameguard: { action: 'deny' },
      crossOriginResourcePolicy: { policy: 'same-origin' },
      hsts: config.isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
    }),
  );
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || config.clientOrigins.includes(origin)),
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
      maxAge: 600,
    }),
  );
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  app.use('/api', apiLimiter);
  // Log analizi özeti ve bot IP doğrulaması büyük olabilir (tarayıcıda özetlenmiş, en fazla birkaç MB);
  // sadece bu iki uç daha geniş sınırla ayrıştırılır, genel sınır 100 KB kalır
  const largeJson = express.json({ limit: '4mb' });
  const LARGE_BODY = /^\/api\/domains\/[0-9a-f-]{36}\/insights\/logs(\/verify)?$/i;
  app.use((req, res, next) => (req.method === 'POST' && LARGE_BODY.test(req.path) ? largeJson(req, res, next) : next()));
  app.use(express.json({ limit: '100kb' }));
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    next();
  });
  app.use('/api/auth', authRoutes);
  app.use('/api/integrations', integrationRoutes);
  app.use('/api/domains', requireAuth, domainRoutes);
  app.use('/api/keywords', requireAuth, keywordRoutes);
  app.use('/api/analyze', requireAuth, analyzeRoutes);
  app.use('/api/alerts', requireAuth, alertRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
