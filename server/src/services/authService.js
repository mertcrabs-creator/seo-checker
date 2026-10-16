import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { query, withTransaction } from '../db/pool.js';
import { signAccessToken } from '../middleware/auth.js';
import { randomToken, sha256 } from '../utils/crypto.js';
import { forbidden, unauthorized } from '../utils/httpError.js';

const BCRYPT_COST = 12;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
// Kullanıcı yoksa da aynı süre harcansın (kullanıcı tespiti / timing saldırısına karşı)
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), BCRYPT_COST);

const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, role: u.role });

export async function register({ name, email, password }) {
  const hash = await bcrypt.hash(password, BCRYPT_COST);
  return withTransaction(async (client) => {
    // İlk kullanıcı kontrolü yarış durumuna karşı kilitli yapılır
    await client.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');
    const { rows: countRows } = await client.query('SELECT count(*)::int AS n FROM users');
    const isFirst = countRows[0].n === 0;
    if (!isFirst && !config.allowRegistration) throw forbidden('Kayıt şu anda kapalı');

    const { rows } = await client.query(
      `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO NOTHING
       RETURNING id, email, name, role, password_changed_at`,
      [name, email, hash, isFirst ? 'admin' : 'user'],
    );
    // Kayıtlı e-postayı ifşa etmemek için genel mesaj
    if (!rows[0]) throw forbidden('Bu bilgilerle kayıt oluşturulamadı');
    return rows[0];
  });
}

export async function verifyCredentials(email, password) {
  const { rows } = await query(
    'SELECT id, email, name, role, password_hash, failed_login_attempts, locked_until, password_changed_at FROM users WHERE email = $1',
    [email],
  );
  const user = rows[0];
  const ok = await bcrypt.compare(password, user?.password_hash || DUMMY_HASH);

  if (!user) throw unauthorized('E-posta veya şifre hatalı');
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    throw Object.assign(unauthorized('Hesap geçici olarak kilitlendi. Lütfen daha sonra tekrar deneyin.'), { code: 'LOCKED' });
  }
  if (!ok) {
    await query(
      `UPDATE users SET
         failed_login_attempts = CASE WHEN failed_login_attempts + 1 >= $2 THEN 0 ELSE failed_login_attempts + 1 END,
         locked_until = CASE WHEN failed_login_attempts + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE locked_until END
       WHERE id = $1`,
      [user.id, MAX_FAILED, LOCK_MINUTES],
    );
    throw unauthorized('E-posta veya şifre hatalı');
  }
  await query(
    'UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1',
    [user.id],
  );
  return user;
}

export async function issueSession(user, { familyId = crypto.randomUUID(), userAgent, ip, client } = {}) {
  const token = randomToken();
  const db = client || { query };
  await db.query(
    `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at, user_agent, ip)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [user.id, familyId, sha256(token), new Date(Date.now() + config.refreshTtlMs), userAgent?.slice(0, 300) || null, ip || null],
  );
  return { refreshToken: token, accessToken: signAccessToken(user), user: publicUser(user) };
}

/** Refresh token rotasyonu + yeniden kullanım tespiti (çalınan token tüm aileyi iptal eder). */
export async function rotateSession(token, meta) {
  if (!token || typeof token !== 'string' || token.length > 200) throw unauthorized();
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT rt.id, rt.family_id, rt.expires_at, rt.revoked_at,
              u.id AS user_id, u.email, u.name, u.role, u.password_changed_at
         FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
        WHERE rt.token_hash = $1
        FOR UPDATE OF rt`,
      [sha256(token)],
    );
    const row = rows[0];
    if (!row) throw unauthorized();
    if (row.revoked_at) {
      await client.query('UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL', [row.family_id]);
      throw unauthorized('Oturum güvenlik nedeniyle sonlandırıldı');
    }
    if (new Date(row.expires_at) <= new Date()) throw unauthorized('Oturum süresi doldu');

    await client.query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [row.id]);
    const user = { id: row.user_id, email: row.email, name: row.name, role: row.role, password_changed_at: row.password_changed_at };
    return issueSession(user, { ...meta, familyId: row.family_id, client });
  });
}

export async function revokeSession(token) {
  if (!token || typeof token !== 'string' || token.length > 200) return;
  await query(
    `UPDATE refresh_tokens SET revoked_at = now()
      WHERE family_id = (SELECT family_id FROM refresh_tokens WHERE token_hash = $1) AND revoked_at IS NULL`,
    [sha256(token)],
  );
}

export async function changePassword(userId, currentPassword, newPassword) {
  const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [userId]);
  if (!rows[0] || !(await bcrypt.compare(currentPassword, rows[0].password_hash))) {
    throw unauthorized('Mevcut şifre hatalı');
  }
  const hash = await bcrypt.hash(newPassword, BCRYPT_COST);
  await withTransaction(async (client) => {
    await client.query(
      'UPDATE users SET password_hash = $2, password_changed_at = now(), updated_at = now() WHERE id = $1',
      [userId, hash],
    );
    await client.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
  });
}

export async function purgeExpiredTokens() {
  await query("DELETE FROM refresh_tokens WHERE expires_at < now() - interval '1 day'");
  await query('DELETE FROM oauth_states WHERE expires_at < now()');
}
