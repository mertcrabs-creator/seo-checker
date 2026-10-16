import crypto from 'node:crypto';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { decrypt, encrypt, randomToken, sha256 } from '../utils/crypto.js';
import { HttpError, badRequest } from '../utils/httpError.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
export const GSC_BASE = 'https://searchconsole.googleapis.com/webmasters/v3';
const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/webmasters.readonly'];

function ensureEnabled() {
  if (!config.google.enabled) {
    throw new HttpError(503, 'Google entegrasyonu yapılandırılmamış (GOOGLE_CLIENT_ID / SECRET / REDIRECT_URI)', 'GOOGLE_DISABLED');
  }
}

async function postForm(url, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

/** PKCE + tek kullanımlık state ile OAuth yetkilendirme adresi üretir. */
export async function createAuthUrl(userId) {
  ensureEnabled();
  const state = randomToken(32);
  const verifier = randomToken(48);
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  await query(
    `INSERT INTO oauth_states (state_hash, user_id, code_verifier_enc, expires_at)
     VALUES ($1, $2, $3, now() + interval '10 minutes')`,
    [sha256(state), userId, encrypt(verifier)],
  );
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: config.google.redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString();
  return url.href;
}

export async function handleCallback(code, state) {
  ensureEnabled();
  const { rows } = await query(
    'DELETE FROM oauth_states WHERE state_hash = $1 AND expires_at > now() RETURNING user_id, code_verifier_enc',
    [sha256(state)],
  );
  if (!rows[0]) throw badRequest('Geçersiz veya süresi dolmuş yetkilendirme isteği');
  const { user_id: userId, code_verifier_enc: verifierEnc } = rows[0];

  const token = await postForm(TOKEN_URL, {
    code,
    client_id: config.google.clientId,
    client_secret: config.google.clientSecret,
    redirect_uri: config.google.redirectUri,
    grant_type: 'authorization_code',
    code_verifier: decrypt(verifierEnc),
  });
  if (!token.ok) throw badRequest('Google yetkilendirmesi başarısız');
  const { access_token: accessToken, refresh_token: refreshToken, expires_in: expiresIn, scope } = token.data;
  if (!String(scope).includes('webmasters')) throw badRequest('Search Console izni verilmedi');

  const info = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  }).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));

  const { rows: existing } = await query('SELECT refresh_token_enc FROM google_connections WHERE user_id = $1', [userId]);
  const refreshEnc = refreshToken ? encrypt(refreshToken) : existing[0]?.refresh_token_enc;
  if (!refreshEnc) throw badRequest('Google yenileme anahtarı alınamadı, lütfen tekrar bağlanın');

  await query(
    `INSERT INTO google_connections (user_id, google_email, access_token_enc, refresh_token_enc, token_expires_at, scope)
     VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5), $6)
     ON CONFLICT (user_id) DO UPDATE SET google_email = EXCLUDED.google_email, access_token_enc = EXCLUDED.access_token_enc,
       refresh_token_enc = EXCLUDED.refresh_token_enc, token_expires_at = EXCLUDED.token_expires_at,
       scope = EXCLUDED.scope, updated_at = now()`,
    [userId, info.email || null, encrypt(accessToken), refreshEnc, Number(expiresIn) || 3600, scope],
  );
}

async function getAccessToken(userId) {
  ensureEnabled();
  const { rows } = await query(
    'SELECT access_token_enc, refresh_token_enc, token_expires_at FROM google_connections WHERE user_id = $1',
    [userId],
  );
  const conn = rows[0];
  if (!conn) throw new HttpError(412, 'Önce Google Search Console hesabınızı bağlayın', 'GOOGLE_NOT_CONNECTED');
  if (new Date(conn.token_expires_at).getTime() - Date.now() > 60_000) return decrypt(conn.access_token_enc);

  const res = await postForm(TOKEN_URL, {
    client_id: config.google.clientId,
    client_secret: config.google.clientSecret,
    refresh_token: decrypt(conn.refresh_token_enc),
    grant_type: 'refresh_token',
  });
  if (!res.ok) {
    if (res.data?.error === 'invalid_grant') {
      await query('DELETE FROM google_connections WHERE user_id = $1', [userId]);
      throw new HttpError(412, 'Google bağlantısının süresi doldu, lütfen yeniden bağlanın', 'GOOGLE_NOT_CONNECTED');
    }
    throw new HttpError(502, 'Google token yenilenemedi', 'GOOGLE_ERROR');
  }
  await query(
    `UPDATE google_connections SET access_token_enc = $2, token_expires_at = now() + make_interval(secs => $3), updated_at = now()
     WHERE user_id = $1`,
    [userId, encrypt(res.data.access_token), Number(res.data.expires_in) || 3600],
  );
  return res.data.access_token;
}

export async function googleApi(userId, url, { method = 'GET', body } = {}) {
  const token = await getAccessToken(userId);
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body && { 'Content-Type': 'application/json' }) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(60_000),
    });
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }
    const data = await res.json().catch(() => ({}));
    const msg = data?.error?.message || `Google API hatası (${res.status})`;
    if (res.status === 403) throw new HttpError(403, `Search Console erişimi reddedildi: ${msg}`, 'GOOGLE_FORBIDDEN');
    throw new HttpError(502, msg, 'GOOGLE_ERROR');
  }
  throw new HttpError(502, 'Google API yanıt vermedi', 'GOOGLE_ERROR');
}

export async function getStatus(userId) {
  const { rows } = await query('SELECT google_email, scope, created_at FROM google_connections WHERE user_id = $1', [userId]);
  return {
    configured: config.google.enabled,
    connected: Boolean(rows[0]),
    email: rows[0]?.google_email || null,
    connectedAt: rows[0]?.created_at || null,
  };
}

export async function listSites(userId) {
  const data = await googleApi(userId, `${GSC_BASE}/sites`);
  return (data.siteEntry || [])
    .filter((s) => s.permissionLevel !== 'siteUnverifiedUser')
    .map((s) => ({ siteUrl: s.siteUrl, permissionLevel: s.permissionLevel }))
    .sort((a, b) => a.siteUrl.localeCompare(b.siteUrl));
}

export async function disconnect(userId) {
  const { rows } = await query('DELETE FROM google_connections WHERE user_id = $1 RETURNING refresh_token_enc', [userId]);
  if (rows[0]) {
    await postForm(REVOKE_URL, { token: decrypt(rows[0].refresh_token_enc) }).catch(() => {});
  }
}
