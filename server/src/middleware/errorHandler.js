import { config } from '../config.js';

export function notFoundHandler(_req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Uç nokta bulunamadı' } });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'İstek gövdesi çok büyük' } });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Geçersiz JSON' } });
  }
  // Postgres: geçersiz uuid vb.
  if (err.code === '22P02') {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Geçersiz parametre' } });
  }

  const status = err.expose && err.status ? err.status : 500;
  if (status >= 500) console.error(`[error] ${req.method} ${req.originalUrl}`, err);

  res.status(status).json({
    error: {
      code: err.code && err.expose ? err.code : 'INTERNAL',
      // 5xx'te sadece bilinçli olarak açılan (expose) hatalar mesajını gösterir, ör. dış sağlayıcı hatası
      message: status >= 500 && !err.expose ? 'Sunucu hatası' : err.message,
      ...(err.details && { details: err.details }),
      ...(!config.isProd && status >= 500 && { debug: err.message }),
    },
  });
}
