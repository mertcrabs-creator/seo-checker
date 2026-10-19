import dns from 'node:dns/promises';
import tls from 'node:tls';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { accessParams, domainAccess } from './accessService.js';
import { ISSUES } from './audit/issueCatalog.js';
import { autoAnalyze } from './insights/rankDropService.js';
import { isBlockedIp } from '../utils/safeFetch.js';

/**
 * Otomatik izleme uyarıları. Her iş (senkron, tarama, backlink) bittiğinde ilgili kontrol çalışır.
 * Aynı alan adı + tür için varsayılan 24 saat (dedupeHours) içinde tekrar uyarı üretilmez. Telegram opsiyoneldir.
 */

async function sendTelegram(text) {
  if (!config.telegram.enabled) return;
  try {
    await fetch(`https://api.telegram.org/bot${config.telegram.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: config.telegram.chatId, text: text.slice(0, 4000), disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    console.warn('[alert] telegram', err.message);
  }
}

const ICON = { critical: '🔴', warning: '🟠', notice: '🔵' };

export async function createAlert({ domainId, type, severity, title, detail = null, data = {}, dedupeHours = 24 }) {
  const { rows } = await query(
    `INSERT INTO alerts (user_id, domain_id, type, severity, title, detail, data)
     SELECT d.user_id, d.id, $2, $3, $4, $5, $6 FROM domains d
      WHERE d.id = $1 AND NOT EXISTS (
        SELECT 1 FROM alerts a WHERE a.domain_id = d.id AND a.type = $2 AND a.created_at > now() - make_interval(hours => $7::int))
     RETURNING id, (SELECT hostname FROM domains WHERE id = $1) AS hostname`,
    [domainId, type, severity, title.slice(0, 300), detail ? String(detail).slice(0, 2000) : null, JSON.stringify(data), dedupeHours],
  );
  if (rows[0]) await sendTelegram(`${ICON[severity] || ''} ${rows[0].hostname}\n${title}${detail ? `\n${detail}` : ''}`);
  return rows[0] || null;
}

/** Alert üretimi işi asla bozmasın. */
const safe = (fn) => async (...args) => {
  try {
    await fn(...args);
  } catch (err) {
    console.warn('[alert]', err.message);
  }
};

// ------------------------------------------------------------------ Search Console senkronu sonrası
export const afterSync = safe(async (domainId) => {
  // Son 7 gün vs önceki 7 gün (verideki son güne göre)
  const { rows: [t] } = await query(
    `WITH b AS (SELECT max(date) AS e FROM gsc_daily WHERE domain_id = $1)
     SELECT COALESCE(SUM(clicks) FILTER (WHERE date > b.e - 7), 0)::int AS cur,
            COALESCE(SUM(clicks) FILTER (WHERE date <= b.e - 7 AND date > b.e - 14), 0)::int AS prev
       FROM gsc_daily, b WHERE domain_id = $1`,
    [domainId],
  );
  if (t.prev >= 50 && t.cur < t.prev * 0.7) {
    const pct = Math.round((1 - t.cur / t.prev) * 100);
    await createAlert({
      domainId, type: 'traffic_drop', severity: pct >= 50 ? 'critical' : 'warning',
      title: `Organik tıklamalar %${pct} düştü`, detail: `Son 7 gün ${t.cur} tıklama, önceki 7 gün ${t.prev}.`, data: t,
    });
  }

  // İlk sayfadayken (≤10) 5+ sıra kaybeden, yeterli gösterimi olan kelimeler
  const { rows: drops } = await query(
    `WITH b AS (SELECT max(date) AS e FROM gsc_query_daily WHERE domain_id = $1),
     agg AS (
       SELECT query,
              SUM(position * impressions) FILTER (WHERE date > b.e - 7) / NULLIF(SUM(impressions) FILTER (WHERE date > b.e - 7), 0) AS cur,
              SUM(position * impressions) FILTER (WHERE date <= b.e - 7 AND date > b.e - 14)
                / NULLIF(SUM(impressions) FILTER (WHERE date <= b.e - 7 AND date > b.e - 14), 0) AS prev,
              SUM(impressions) FILTER (WHERE date <= b.e - 7 AND date > b.e - 14) AS prev_imp
         FROM gsc_query_daily, b WHERE domain_id = $1 AND date > b.e - 14 GROUP BY query
     )
     SELECT query, round(prev::numeric, 1)::float AS prev, round(cur::numeric, 1)::float AS cur
       FROM agg WHERE prev <= 10 AND prev_imp >= 50 AND cur - prev >= 5
      ORDER BY prev_imp DESC LIMIT 10`,
    [domainId],
  );
  if (drops.length) {
    const alert = await createAlert({
      domainId, type: 'rank_drop', severity: drops.some((d) => d.prev <= 3 && d.cur > 10) ? 'critical' : 'warning',
      title: `${drops.length} önemli kelimede sıra kaybı`,
      detail: `${drops.slice(0, 5).map((d) => `“${d.query}”: ${d.prev} → ${d.cur}`).join('\n')}\nEn önemli ${Math.min(3, drops.length)} kelime için rakip ve sayfa analizi hazırlanıyor: Derin analiz → Sıralama kayıpları.`,
      data: { keywords: drops },
    });
    // Uyarı yeni üretildiyse (tekilleştirmeye takılmadıysa) en önemli düşüşleri otomatik analiz et
    if (alert) await autoAnalyze(domainId, drops.map((d) => d.query));
  }
});

// ------------------------------------------------------------------ Site taraması sonrası
export const afterAudit = safe(async (auditId, domainId, status, error) => {
  if (status === 'failed') {
    await createAlert({ domainId, type: 'site_down', severity: 'critical', title: 'Site taranamadı (erişilemiyor olabilir)', detail: error });
    return;
  }
  const { rows } = await query(
    `WITH prev AS (
       SELECT id FROM audits WHERE domain_id = $2 AND status = 'completed' AND id <> $1 ORDER BY created_at DESC LIMIT 1
     )
     SELECT DISTINCT i.code FROM audit_issues i
      WHERE i.audit_id = $1 AND (SELECT id FROM prev) IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM audit_issues p WHERE p.audit_id = (SELECT id FROM prev) AND p.code = i.code)`,
    [auditId, domainId],
  );
  const critical = rows.map((r) => r.code).filter((c) => ISSUES[c]?.severity === 'critical');
  if (critical.length) {
    await createAlert({
      domainId, type: 'new_critical_issues', severity: 'critical',
      title: `${critical.length} yeni kritik site sorunu`, detail: critical.map((c) => `• ${ISSUES[c].title}`).join('\n'), data: { codes: critical },
    });
  }
  // Ana sayfa yanlışlıkla noindex / robots.txt tüm siteyi engelliyor
  const { rows: block } = await query(
    `SELECT EXISTS (SELECT 1 FROM audit_issues WHERE audit_id = $1 AND code = 'robots_blocks_all') AS robots,
            EXISTS (SELECT 1 FROM audit_pages WHERE audit_id = $1 AND depth = 0 AND noindex) AS home_noindex`,
    [auditId],
  );
  if (block[0].robots || block[0].home_noindex) {
    await createAlert({
      domainId, type: 'indexing_blocked', severity: 'critical',
      title: block[0].robots ? 'robots.txt tüm siteyi engelliyor' : 'Ana sayfa noindex',
      detail: 'Google siteyi indeksten çıkarabilir. Hemen kontrol edin.',
    });
  }
});

// ------------------------------------------------------------------ Backlink doğrulaması sonrası
export const afterBacklinks = safe(async (domainId, since) => {
  const { rows: [r] } = await query(
    `SELECT count(*)::int AS lost, array_agg(source_domain ORDER BY source_domain) FILTER (WHERE true) AS domains
       FROM backlinks WHERE domain_id = $1 AND status = 'lost' AND lost_at >= $2`,
    [domainId, since],
  );
  if (r.lost) {
    await createAlert({
      domainId, type: 'backlinks_lost', severity: 'warning', title: `${r.lost} backlink kaybedildi`,
      detail: [...new Set(r.domains)].slice(0, 8).join(', '), data: { count: r.lost },
    });
  }
});

// ------------------------------------------------------------------ SSL sertifikası
/** Sertifika bitiş tarihi; SSRF koruması için IP önce doğrulanır. */
export function sslExpiry(hostname) {
  return new Promise((resolve, reject) => {
    dns.lookup(hostname).then(({ address }) => {
      if (isBlockedIp(address)) return reject(new Error('Hedef adres engellendi'));
      const socket = tls.connect({ host: address, port: 443, servername: hostname, timeout: 10_000, rejectUnauthorized: false }, () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        resolve(cert?.valid_to ? new Date(cert.valid_to) : null);
      });
      socket.on('timeout', () => socket.destroy(new Error('Zaman aşımı')));
      socket.on('error', reject);
    }, reject);
  });
}

export const checkSsl = safe(async (domain) => {
  const expires = await sslExpiry(domain.hostname);
  await query('UPDATE domains SET ssl_expires_at = $2 WHERE id = $1', [domain.id, expires]);
  if (!expires) return;
  const days = Math.floor((expires - Date.now()) / 86_400_000);
  if (days <= 14) {
    await createAlert({
      domainId: domain.id, type: 'ssl_expiry', severity: days <= 3 ? 'critical' : 'warning',
      title: days < 0 ? 'SSL sertifikasının süresi doldu' : `SSL sertifikası ${days} gün içinde bitiyor`,
      detail: `Bitiş: ${expires.toISOString().slice(0, 10)}`,
    });
  }
});

// ------------------------------------------------------------------ Okuma
// Kullanıcının görebildiği uyarılar: erişebildiği alan adlarınınkiler + alan adına bağlı olmayan kendi uyarıları
const visible = (i) => `((a.domain_id IS NULL AND a.user_id = $${i + 2})
  OR EXISTS (SELECT 1 FROM domains d2 WHERE d2.id = a.domain_id AND ${domainAccess('d2', i)}))`;

export async function listAlerts(user, { unread, page, pageSize }) {
  const { rows } = await query(
    `SELECT a.id, a.domain_id, d.hostname, a.type, a.severity, a.title, a.detail, a.created_at, a.read_at,
            COUNT(*) OVER ()::int AS total
       FROM alerts a LEFT JOIN domains d ON d.id = a.domain_id
      WHERE ${visible(4)} AND ($1::boolean = false OR a.read_at IS NULL)
      ORDER BY a.created_at DESC LIMIT $2 OFFSET $3`,
    [Boolean(unread), pageSize, (page - 1) * pageSize, ...accessParams(user)],
  );
  const { rows: [c] } = await query(`SELECT count(*)::int AS n FROM alerts a WHERE ${visible(1)} AND a.read_at IS NULL`, accessParams(user));
  return { unread: c.n, total: rows[0]?.total || 0, rows: rows.map(({ total, ...r }) => r) };
}

export async function markRead(user, id) {
  await query(
    `UPDATE alerts a SET read_at = now() WHERE ${visible(2)} AND a.read_at IS NULL AND ($1::uuid IS NULL OR a.id = $1)`,
    [id || null, ...accessParams(user)],
  );
}
