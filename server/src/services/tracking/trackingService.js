import crypto from 'node:crypto';
import { config } from '../../config.js';
import { query, withTransaction } from '../../db/pool.js';
import { conflict, notFound } from '../../utils/httpError.js';
import { safeFetch } from '../../utils/safeFetch.js';
import { collectPayload } from '../../validation/schemas.js';
import { baseHost, classifySource, countryOf, deviceType, isBot, isSameSite } from './classify.js';

/**
 * CrabRank ziyaretçi takibi: anahtar yönetimi (panel) ve veri toplama (sitelerdeki script).
 * Çerez/localStorage kullanılmaz. Ziyaretçi kimliği sunucuda günlük değişen HMAC ile üretilir, ham IP hiç yazılmaz.
 */

const KEY_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const KEY_GRACE_DAYS = 7; // anahtar yenilenince eskisi bu süre daha kabul edilir (siteler güncellenene kadar)
const SESSION_IDLE_MIN = 30;
const MAX_PAGEVIEWS_PER_SESSION = 1000;
const MAX_CONVERSIONS_PER_SESSION = 50;

const newKey = () => `crk_${Array.from({ length: 24 }, () => KEY_ALPHABET[crypto.randomInt(KEY_ALPHABET.length)]).join('')}`;
// Ziyaretçi özeti için şifreleme anahtarından türetilmiş ayrı bir anahtar (aynı anahtar iki amaçla kullanılmaz)
const visitorKey = crypto.createHmac('sha256', config.encryptionKey).update('crabrank-visitor-v1').digest();

export const scriptUrl = () => `${config.tracking.publicUrl}/api/t/cr.v1.js`;
export const collectUrl = () => `${config.tracking.publicUrl}/api/t/e`;

// ------------------------------------------------------------------ Panel
const SITE_COLS = `site_key, previous_key_expires_at, allowed_hosts, enabled, last_event_at, rotated_at, created_at`;

export async function getSite(domainId) {
  const { rows } = await query(`SELECT ${SITE_COLS} FROM tracking_sites WHERE domain_id = $1`, [domainId]);
  return rows[0] || null;
}

export async function createSite(domainId) {
  const { rows } = await query(
    `INSERT INTO tracking_sites (domain_id, site_key) VALUES ($1, $2) ON CONFLICT (domain_id) DO NOTHING RETURNING ${SITE_COLS}`,
    [domainId, newKey()],
  );
  if (!rows[0]) throw conflict('Bu alan adı için takip kodu zaten oluşturulmuş');
  return rows[0];
}

export async function rotateKey(domainId) {
  const { rows } = await query(
    `UPDATE tracking_sites
        SET previous_key = site_key, previous_key_expires_at = now() + make_interval(days => $3), site_key = $2, rotated_at = now()
      WHERE domain_id = $1 RETURNING ${SITE_COLS}`,
    [domainId, newKey(), KEY_GRACE_DAYS],
  );
  if (!rows[0]) throw notFound('Takip kodu bulunamadı');
  siteCache.clear();
  return rows[0];
}

export async function updateSite(domainId, { enabled, allowedHosts }) {
  const { rows } = await query(
    `UPDATE tracking_sites SET enabled = COALESCE($2, enabled), allowed_hosts = COALESCE($3, allowed_hosts)
      WHERE domain_id = $1 RETURNING ${SITE_COLS}`,
    [domainId, enabled ?? null, allowedHosts ?? null],
  );
  if (!rows[0]) throw notFound('Takip kodu bulunamadı');
  siteCache.clear();
  return rows[0];
}

/** Kurulum kontrolü: ana sayfada script ve anahtar var mı, son 24 saatte veri geldi mi. */
export async function verifyInstall(domain) {
  const site = await getSite(domain.id);
  if (!site) throw notFound('Önce takip kodu oluşturun');
  const result = { scriptFound: false, keyFound: false, otherKey: null, receiving: Boolean(site.last_event_at && Date.now() - new Date(site.last_event_at) < 86_400_000), error: null, url: `https://${domain.hostname}/` };
  try {
    const res = await safeFetch(result.url, { timeoutMs: 15_000, maxBytes: 3 * 1024 * 1024 });
    result.url = res.finalUrl;
    result.scriptFound = /cr\.v1\.js/.test(res.body);
    result.keyFound = res.body.includes(site.site_key);
    if (!result.keyFound) result.otherKey = res.body.match(/crk_[A-Za-z0-9]{24}/)?.[0] || null;
    if (res.status >= 400) result.error = `Site ${res.status} döndü`;
  } catch (err) {
    result.error = `Site açılamadı: ${err.message}`;
  }
  return result;
}

// ------------------------------------------------------------------ Veri toplama
// Anahtar → site eşlemesi kısa süre bellekte tutulur (her istekte veritabanına gidilmesin; olmayan anahtarlar da önbelleğe alınır)
const siteCache = new Map();
const CACHE_MS = 60_000;

async function resolveSite(key) {
  const hit = siteCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.site;
  const { rows } = await query(
    `SELECT t.domain_id, t.enabled, t.allowed_hosts, d.hostname
       FROM tracking_sites t JOIN domains d ON d.id = t.domain_id
      WHERE t.site_key = $1 OR (t.previous_key = $1 AND t.previous_key_expires_at > now())`,
    [key],
  );
  if (siteCache.size > 5000) siteCache.clear();
  siteCache.set(key, { site: rows[0] || null, at: Date.now() });
  return rows[0] || null;
}

const hostOf = (value) => {
  try {
    return value ? new URL(value).hostname.toLowerCase() : null;
  } catch {
    return null;
  }
};

/** Alan adının kendisi + alt alan adları her zaman; ayrıca panelde eklenen ek alan adları ("*.ornek.com" desteklenir). */
function hostAllowed(site, host) {
  if (isSameSite(host, site.hostname)) return true;
  return (site.allowed_hosts || []).some((h) => (h.startsWith('*.') ? isSameSite(host, h.slice(2)) : baseHost(h) === baseHost(host)));
}

const lastTouch = new Map();
function touchSite(domainId) {
  const now = Date.now();
  if (now - (lastTouch.get(domainId) || 0) < 60_000) return;
  lastTouch.set(domainId, now);
  query('UPDATE tracking_sites SET last_event_at = now() WHERE domain_id = $1', [domainId]).catch((e) => console.warn('[tracking] last_event_at', e.message));
}

/**
 * Script'ten gelen toplu olayları işler. Geçersiz/izinsiz istekler sessizce atılır (yanıt her zaman 204,
 * böylece dışarıdan anahtar veya alan adı denemesi bilgi sızdırmaz).
 * @returns {Promise<string>} sonuç (yalnızca günlük için)
 */
export async function collect(raw, { ip, ua, headers }) {
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return 'invalid_json';
  }
  const parsed = collectPayload.safeParse(body);
  if (!parsed.success) return 'invalid_payload';
  const p = parsed.data;
  if (p.wd || isBot(ua)) return 'bot';

  const site = await resolveSite(p.k);
  if (!site) return 'unknown_key';
  if (!site.enabled) return 'disabled';
  const origin = hostOf(headers.origin) || hostOf(headers.referer);
  if (!origin || !hostAllowed(site, origin)) return 'origin_denied';

  const day = new Date().toISOString().slice(0, 10);
  const visitor = crypto.createHmac('sha256', visitorKey).update(`${day}|${site.domain_id}|${ip}|${ua}`).digest('hex').slice(0, 32);
  const domainId = site.domain_id;

  await withTransaction(async (c) => {
    // Aynı ziyaretçinin eşzamanlı istekleri çift oturum açmasın
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [visitor]);
    let sessionId = null;
    const touched = new Set();

    for (const e of p.e) {
      if (e.t === 'pv') {
        if (!sessionId) {
          const { rows } = await c.query(
            `SELECT id FROM tracking_sessions
              WHERE domain_id = $1 AND visitor_hash = $2 AND last_seen_at > now() - make_interval(mins => $3)
              ORDER BY last_seen_at DESC LIMIT 1`,
            [domainId, visitor, SESSION_IDLE_MIN],
          );
          sessionId = rows[0]?.id || null;
        }
        if (!sessionId) {
          const src = classifySource({ referrer: e.r, utm: e.u, paidClick: e.g, siteHost: site.hostname });
          const { rows } = await c.query(
            `INSERT INTO tracking_sessions (domain_id, visitor_hash, landing_path, channel, source, referrer_host,
                                            utm_source, utm_medium, utm_campaign, utm_term, country, device, language)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
            [
              domainId, visitor, e.p, src.channel, src.source, src.referrerHost,
              e.u?.s || null, e.u?.m || null, e.u?.c || null, e.u?.t || null,
              countryOf(headers, p.tz), deviceType(ua, p.w), p.l?.slice(0, 2).toLowerCase() || null,
            ],
          );
          sessionId = rows[0].id;
        }
        const ins = await c.query(
          `INSERT INTO tracking_pageviews (domain_id, pv_id, session_id, path)
           SELECT $1, $2, $3, $4 WHERE (SELECT pageviews FROM tracking_sessions WHERE id = $3) < $5
           ON CONFLICT DO NOTHING`,
          [domainId, e.id, sessionId, e.p, MAX_PAGEVIEWS_PER_SESSION],
        );
        if (ins.rowCount) {
          await c.query('UPDATE tracking_sessions SET pageviews = pageviews + 1, exit_path = $2, last_seen_at = now() WHERE id = $1', [sessionId, e.p]);
        }
        continue;
      }

      // Etkileşim / dönüşüm / Web Vitals: sayfa görüntülemesine bağlıdır (oturum 30 dk'yı aşmış olabilir)
      const { rows: [pv] } = await c.query(
        `SELECT session_id, path FROM tracking_pageviews WHERE domain_id = $1 AND pv_id = $2 AND created_at > now() - interval '1 day'`,
        [domainId, e.id],
      );
      if (!pv) continue;
      if (e.t === 'en') {
        await c.query(
          'UPDATE tracking_pageviews SET engaged_ms = GREATEST(engaged_ms, $3), max_scroll = GREATEST(max_scroll, $4) WHERE domain_id = $1 AND pv_id = $2',
          [domainId, e.id, e.ms, e.sc],
        );
        touched.add(pv.session_id);
      } else if (e.t === 'wv') {
        await c.query(
          'UPDATE tracking_pageviews SET lcp_ms = COALESCE($3, lcp_ms), cls = COALESCE($4, cls), inp_ms = COALESCE($5, inp_ms) WHERE domain_id = $1 AND pv_id = $2',
          [domainId, e.id, e.lcp ?? null, e.cls ?? null, e.inp ?? null],
        );
      } else if (e.t === 'cv') {
        // Aynı dönüşüm kısa sürede tekrar gelirse (çift tıklama) bir kez sayılır
        const { rowCount } = await c.query(
          `INSERT INTO tracking_conversions (domain_id, session_id, kind, name, path)
           SELECT $1, $2, $3, $4, $5
            WHERE (SELECT conversions FROM tracking_sessions WHERE id = $2) < $6
              AND NOT EXISTS (SELECT 1 FROM tracking_conversions WHERE session_id = $2 AND kind = $3 AND name IS NOT DISTINCT FROM $4
                                AND created_at > now() - interval '3 seconds')`,
          [domainId, pv.session_id, e.k, e.n || null, pv.path, MAX_CONVERSIONS_PER_SESSION],
        );
        if (rowCount) await c.query('UPDATE tracking_sessions SET conversions = conversions + 1, last_seen_at = now() WHERE id = $1', [pv.session_id]);
      }
    }

    for (const id of touched) {
      await c.query(
        `UPDATE tracking_sessions s SET engaged_ms = x.ms, max_scroll = x.sc, last_seen_at = now()
           FROM (SELECT COALESCE(SUM(engaged_ms), 0)::int AS ms, COALESCE(MAX(max_scroll), 0) AS sc FROM tracking_pageviews WHERE session_id = $1) x
          WHERE s.id = $1`,
        [id],
      );
    }
  });
  touchSite(domainId);
  return 'ok';
}

// ------------------------------------------------------------------ Saklama süresi
/** Ham sayfa görüntülemeleri ve eski oturumlar parça parça silinir (tek büyük DELETE zaman aşımına düşmesin). */
export async function purgeOldTrackingData() {
  const purge = async (sql, days) => {
    let total = 0;
    for (let i = 0; i < 200; i++) {
      const { rowCount } = await query(sql, [days]);
      total += rowCount;
      if (rowCount < 5000) break;
    }
    return total;
  };
  const pageviews = await purge(
    `DELETE FROM tracking_pageviews WHERE ctid IN (SELECT ctid FROM tracking_pageviews WHERE created_at < now() - make_interval(days => $1) LIMIT 5000)`,
    config.tracking.pageviewDays,
  );
  const sessions = await purge(
    `DELETE FROM tracking_sessions WHERE id IN (SELECT id FROM tracking_sessions WHERE started_at < now() - make_interval(days => $1) LIMIT 5000)`,
    config.tracking.retentionDays,
  );
  return { pageviews, sessions };
}
