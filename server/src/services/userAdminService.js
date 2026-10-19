import bcrypt from 'bcryptjs';
import { query, withTransaction } from '../db/pool.js';
import { badRequest, conflict, notFound } from '../utils/httpError.js';

/**
 * Ekip yönetimi (yalnızca admin): admin'in açtığı kullanıcılar (users.created_by = admin) ve
 * her kullanıcının erişebildiği alan adları (domain_members). Alan adlarının sahibi admin olarak kalır.
 */

const BCRYPT_COST = 12;

async function assertOwnDomains(client, ownerId, domainIds) {
  if (!domainIds.length) return;
  const { rows } = await client.query('SELECT count(*)::int AS n FROM domains WHERE user_id = $1 AND id = ANY($2::uuid[])', [ownerId, domainIds]);
  if (rows[0].n !== new Set(domainIds).size) throw badRequest('Geçersiz alan adı seçimi');
}

async function setDomains(client, userId, domainIds) {
  await client.query('DELETE FROM domain_members WHERE user_id = $1', [userId]);
  if (domainIds.length) {
    await client.query('INSERT INTO domain_members (domain_id, user_id) SELECT unnest($1::uuid[]), $2 ON CONFLICT DO NOTHING', [[...new Set(domainIds)], userId]);
  }
}

async function getMember(admin, userId) {
  const { rows: [u] } = await query('SELECT id FROM users WHERE id = $1 AND created_by = $2', [userId, admin.id]);
  if (!u) throw notFound('Kullanıcı bulunamadı');
  return u;
}

export async function listUsers(admin) {
  const { rows } = await query(
    `SELECT u.id, u.name, u.email AS username, u.role, u.created_at, u.last_login_at,
            (u.locked_until IS NOT NULL AND u.locked_until > now()) AS locked,
            COALESCE(json_agg(json_build_object('id', d.id, 'hostname', d.hostname) ORDER BY d.hostname) FILTER (WHERE d.id IS NOT NULL), '[]') AS domains
       FROM users u
       LEFT JOIN domain_members m ON m.user_id = u.id
       LEFT JOIN domains d ON d.id = m.domain_id
      WHERE u.created_by = $1
      GROUP BY u.id ORDER BY u.created_at DESC`,
    [admin.id],
  );
  return rows;
}

export async function ownDomains(admin) {
  const { rows } = await query('SELECT id, hostname FROM domains WHERE user_id = $1 ORDER BY hostname', [admin.id]);
  return rows;
}

export async function createUser(admin, { name, username, password, domainIds }) {
  const hash = await bcrypt.hash(password, BCRYPT_COST);
  return withTransaction(async (client) => {
    await assertOwnDomains(client, admin.id, domainIds);
    const { rows } = await client.query(
      `INSERT INTO users (name, email, password_hash, role, created_by) VALUES ($1, $2, $3, 'user', $4)
       ON CONFLICT (email) DO NOTHING RETURNING id, name, email AS username, role, created_at`,
      [name, username, hash, admin.id],
    );
    if (!rows[0]) throw conflict('Bu kullanıcı adı zaten kullanılıyor');
    await setDomains(client, rows[0].id, domainIds);
    return rows[0];
  });
}

export async function updateUser(admin, userId, { name, username, password, domainIds }) {
  await getMember(admin, userId);
  const hash = password ? await bcrypt.hash(password, BCRYPT_COST) : null;
  await withTransaction(async (client) => {
    if (name) await client.query('UPDATE users SET name = $2, updated_at = now() WHERE id = $1', [userId, name]);
    if (username) {
      const { rows } = await client.query('SELECT 1 FROM users WHERE email = $1 AND id <> $2', [username, userId]);
      if (rows[0]) throw conflict('Bu kullanıcı adı zaten kullanılıyor');
      await client.query('UPDATE users SET email = $2, updated_at = now() WHERE id = $1', [userId, username]);
    }
    if (hash) {
      // Şifre değişince açık oturumlar kapanır (erişim jetonu password_changed_at ile doğrulanır)
      await client.query(
        'UPDATE users SET password_hash = $2, password_changed_at = now(), failed_login_attempts = 0, locked_until = NULL, updated_at = now() WHERE id = $1',
        [userId, hash],
      );
      await client.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
    }
    if (domainIds) {
      await assertOwnDomains(client, admin.id, domainIds);
      await setDomains(client, userId, domainIds);
    }
  });
}

export async function deleteUser(admin, userId) {
  await getMember(admin, userId);
  await query('DELETE FROM users WHERE id = $1 AND created_by = $2', [userId, admin.id]);
}
