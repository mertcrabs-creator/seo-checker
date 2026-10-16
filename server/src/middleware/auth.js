import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { forbidden, unauthorized } from '../utils/httpError.js';

export function signAccessToken(user) {
  return jwt.sign(
    { role: user.role, pwv: new Date(user.password_changed_at).getTime() },
    config.jwt.accessSecret,
    {
      algorithm: 'HS256',
      subject: user.id,
      expiresIn: config.jwt.accessTtlSec,
      issuer: config.jwt.issuer,
      audience: config.jwt.audience,
    },
  );
}

/** Bearer token doğrular; şifre değişikliği sonrası eski tokenlar anında geçersiz olur. */
export async function requireAuth(req, _res, next) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return next(unauthorized());

  let payload;
  try {
    payload = jwt.verify(token, config.jwt.accessSecret, {
      algorithms: ['HS256'],
      issuer: config.jwt.issuer,
      audience: config.jwt.audience,
    });
  } catch {
    return next(unauthorized('Oturum süresi doldu'));
  }

  const { rows } = await query(
    'SELECT id, email, name, role, password_changed_at FROM users WHERE id = $1',
    [payload.sub],
  );
  const user = rows[0];
  if (!user || new Date(user.password_changed_at).getTime() !== payload.pwv) return next(unauthorized());

  req.user = { id: user.id, email: user.email, name: user.name, role: user.role };
  next();
}

export const requireRole = (role) => (req, _res, next) =>
  req.user?.role === role ? next() : next(forbidden());
