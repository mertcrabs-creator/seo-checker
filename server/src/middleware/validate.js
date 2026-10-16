import { badRequest } from '../utils/httpError.js';

/**
 * Zod şemalarıyla body/query/params doğrular. Sonuç `req.valid` altında tutulur;
 * Express 5'te req.query salt okunur olduğundan orijinal nesnelere dokunulmaz.
 */
export const validate = (schemas) => (req, _res, next) => {
  req.valid = req.valid || {};
  for (const key of ['params', 'query', 'body']) {
    if (!schemas[key]) continue;
    const result = schemas[key].safeParse(req[key] ?? {});
    if (!result.success) {
      const details = result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
      return next(badRequest(details[0]?.message || 'Geçersiz istek', details));
    }
    req.valid[key] = result.data;
  }
  next();
};
