import { query } from '../db/pool.js';
import { dailyChangeMarkers } from './changeService.js';

/**
 * Grafik notları: kullanıcı notları + Google sıralama güncellemeleri (resmi Search Status Dashboard akışı)
 * + sitede tespit edilen önemli sayfa değişiklikleri. Düşüş/yükselişlerin nedenini grafikte görmeyi sağlar.
 */

const FEED_URL = 'https://status.search.google.com/incidents.json';
const CACHE_MS = 12 * 3_600_000;

// Akışa ulaşılamazsa kullanılacak yedek liste (status.search.google.com, Ekim 2026'da doğrulandı)
const FALLBACK = [
  ['September 2026 spam update', '2026-09-24', '2026-10-08'],
  ['August 2026 spam update', '2026-08-18', '2026-08-21'],
  ['June 2026 spam update', '2026-06-24', '2026-06-26'],
  ['May 2026 core update', '2026-05-21', '2026-06-01'],
  ['March 2026 core update', '2026-03-27', '2026-04-08'],
  ['March 2026 spam update', '2026-03-24', '2026-03-24'],
  ['December 2025 core update', '2025-12-11', '2025-12-29'],
  ['August 2025 spam update', '2025-08-26', '2025-09-22'],
  ['June 2025 core update', '2025-06-30', '2025-07-17'],
  ['March 2025 core update', '2025-03-13', '2025-03-27'],
  ['December 2024 spam update', '2024-12-19', '2024-12-26'],
  ['December 2024 core update', '2024-12-12', '2024-12-18'],
  ['November 2024 core update', '2024-11-11', '2024-12-05'],
  ['August 2024 core update', '2024-08-15', '2024-09-03'],
  ['June 2024 spam update', '2024-06-20', '2024-06-27'],
  ['March 2024 spam update', '2024-03-05', '2024-03-20'],
  ['March 2024 core update', '2024-03-05', '2024-04-19'],
].map(([name, start, end]) => ({ name, start, end }));

let cache = { at: 0, list: FALLBACK };

const kindOf = (name) => (/core/i.test(name) ? 'core' : /spam/i.test(name) ? 'spam' : 'other');

/** Google sıralama güncellemeleri (12 saat önbellek; hata durumunda son bilinen/yedek liste). */
export async function googleUpdates() {
  if (Date.now() - cache.at < CACHE_MS) return cache.list;
  try {
    const res = await fetch(FEED_URL, { signal: AbortSignal.timeout(10_000), headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const list = (Array.isArray(data) ? data : [])
      .filter((i) => i?.service_name === 'Ranking' && /update/i.test(String(i.external_desc || '')) && i.begin)
      .map((i) => ({ name: String(i.external_desc).slice(0, 120), start: String(i.begin).slice(0, 10), end: i.end ? String(i.end).slice(0, 10) : null }))
      .filter((u) => /^\d{4}-\d{2}-\d{2}$/.test(u.start));
    cache = { at: Date.now(), list: list.length ? list : FALLBACK };
  } catch (err) {
    console.warn('[annotations] Google güncelleme akışı alınamadı:', err.message);
    cache = { at: Date.now() - CACHE_MS + 30 * 60_000, list: cache.list }; // 30 dk sonra tekrar dene
  }
  return cache.list;
}

/** [start, end] aralığıyla kesişen güncellemeler (devam edenlerin bitişi bugün sayılır). */
export async function updatesBetween(start, end) {
  const today = new Date().toISOString().slice(0, 10);
  return (await googleUpdates())
    .filter((u) => u.start <= end && (u.end || today) >= start)
    .map((u) => ({ ...u, kind: kindOf(u.name), ongoing: !u.end }));
}

export async function listAnnotations(domainId, { start, end }) {
  const [{ rows: notes }, updates, changes] = await Promise.all([
    query(
      `SELECT id, date, title, detail, created_at FROM annotations
        WHERE domain_id = $1 AND date BETWEEN $2 AND $3 ORDER BY date`,
      [domainId, start, end],
    ),
    updatesBetween(start, end),
    dailyChangeMarkers(domainId, start, end),
  ]);
  return { notes, updates, changes };
}

export async function createAnnotation(domainId, { date, title, detail }) {
  const { rows: [n] } = await query('SELECT count(*)::int AS n FROM annotations WHERE domain_id = $1', [domainId]);
  if (n.n >= 500) return null;
  const { rows } = await query(
    'INSERT INTO annotations (domain_id, date, title, detail) VALUES ($1, $2, $3, $4) RETURNING id, date, title, detail, created_at',
    [domainId, date, title, detail || null],
  );
  return rows[0];
}

export async function deleteAnnotation(domainId, id) {
  const { rowCount } = await query('DELETE FROM annotations WHERE id = $1 AND domain_id = $2', [id, domainId]);
  return rowCount > 0;
}
