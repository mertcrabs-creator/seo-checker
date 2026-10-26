import { config } from '../config.js';
import { bulkInsert } from '../db/bulk.js';
import { query, withTransaction } from '../db/pool.js';
import { afterSync } from './alertService.js';
import { GSC_BASE, googleApi } from './googleService.js';

const ROW_LIMIT = 25_000;
const MAX_PAGES = 20; // boyut başına en fazla 500k satır

const isoDate = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86_400_000);

async function fetchAll(userId, property, body, maxPages = MAX_PAGES) {
  const url = `${GSC_BASE}/sites/${encodeURIComponent(property)}/searchAnalytics/query`;
  const rows = [];
  for (let page = 0; page < maxPages; page++) {
    const data = await googleApi(userId, url, {
      method: 'POST',
      body: { ...body, rowLimit: ROW_LIMIT, startRow: page * ROW_LIMIT, dataState: 'all' },
    });
    const batch = data.rows || [];
    rows.push(...batch);
    if (batch.length < ROW_LIMIT) break;
  }
  return rows;
}

const metrics = (r) => [Math.round(r.clicks), Math.round(r.impressions), Number(r.position.toFixed(2))];

/** Adımın süresini loglar; hata olursa mesajın başına adım adını ekler (sync_error'da hangi sorgunun takıldığı görünsün). */
async function step(label, fn) {
  const t0 = Date.now();
  try {
    const result = await fn();
    console.log(`[sync] ${label}: ${Date.now() - t0} ms`);
    return result;
  } catch (err) {
    console.error(`[sync] ${label} başarısız (${Date.now() - t0} ms): ${err.message}`);
    err.message = `${label}: ${err.message}`;
    err.syncStep = label;
    throw err;
  }
}

/** Kelime × ülke için son 28 gün ve önceki 28 gün toplamları; yalnızca son 28 günde görünen çiftler döner. */
function summarizeQueryCountry(rows) {
  if (!rows.length) return [];
  const last = rows.reduce((m, r) => (r.keys[0] > m ? r.keys[0] : m), '');
  const e = new Date(`${last}T00:00:00Z`);
  const curFrom = isoDate(addDays(e, -28)); // date > e - 28
  const prevFrom = isoDate(addDays(e, -56)); // date > e - 56
  const acc = new Map();
  for (const r of rows) {
    const [date, q, c] = r.keys;
    if (date <= prevFrom) continue;
    const country = c.toUpperCase();
    const key = `${q}\u0000${country}`;
    let a = acc.get(key);
    if (!a) acc.set(key, (a = { q, country, cur: [0, 0, 0, false], prev: [0, 0, 0, false] }));
    const [clicks, impressions, position] = metrics(r);
    const b = date > curFrom ? a.cur : a.prev;
    b[0] += clicks;
    b[1] += impressions;
    b[2] += position * impressions;
    b[3] = true;
  }
  const out = [];
  for (const { q, country, cur, prev } of acc.values()) {
    if (!cur[3]) continue;
    out.push([
      q, country, cur[0], cur[1], cur[1] ? cur[2] / cur[1] : 0,
      prev[3] ? prev[0] : null, prev[3] ? prev[1] : null, prev[1] ? prev[2] / prev[1] : null,
    ]);
  }
  return out;
}

const DIMENSION_TABLES = [
  { dim: 'query', table: 'gsc_query_daily', col: 'query' },
  { dim: 'page', table: 'gsc_page_daily', col: 'page' },
  { dim: 'country', table: 'gsc_country_daily', col: 'country' },
  { dim: 'device', table: 'gsc_device_daily', col: 'device' },
];

export async function syncDomain(domainId, userId) {
  const { rows } = await step('mülk okuma', () => query('SELECT gsc_property FROM domains WHERE id = $1 AND user_id = $2', [domainId, userId]));
  const property = rows[0]?.gsc_property;
  if (!property) throw new Error('Search Console mülkü seçilmemiş');

  const end = addDays(new Date(), -1);
  const startDate = isoDate(addDays(end, -(config.gscSyncDays - 1)));
  const endDate = isoDate(end);
  const qpStart = isoDate(addDays(end, -27));

  // Google kotası için sıralı çekiyoruz
  const daily = await fetchAll(userId, property, { startDate, endDate, dimensions: ['date'] });
  const byDim = {};
  for (const { dim } of DIMENSION_TABLES) {
    byDim[dim] = await fetchAll(userId, property, { startDate, endDate, dimensions: ['date', dim] });
  }
  const queryPage = await fetchAll(userId, property, { startDate: qpStart, endDate, dimensions: ['query', 'page'] });
  // Lokasyon bazlı sıralamalar: günlük kelime × ülke (en büyük boyut; 1M satıra kadar)
  const queryCountry = await step('Google kelime×ülke çekme', () =>
    fetchAll(userId, property, { startDate, endDate, dimensions: ['date', 'query', 'country'] }, 40));

  await withTransaction(async (client) => {
    // Havuzdaki 30 sn'lik sınır API istekleri için; büyük mülklerde yüz binlerce satırlık DELETE/INSERT/özet bunu aşıyor.
    // SET LOCAL yalnızca bu işlemde geçerli, COMMIT/ROLLBACK sonrası bağlantı varsayılana döner.
    await client.query("SET LOCAL statement_timeout = '10min'");
    const { rows: [t] } = await client.query('SHOW statement_timeout');
    console.log(`[sync] ${property}: statement_timeout=${t.statement_timeout}, satırlar: günlük ${daily.length}, ` +
      `${DIMENSION_TABLES.map(({ dim }) => `${dim} ${byDim[dim].length}`).join(', ')}, kelime×sayfa ${queryPage.length}, kelime×ülke ${queryCountry.length}`);
    await step('gsc_daily silme', () => client.query('DELETE FROM gsc_daily WHERE domain_id = $1 AND date BETWEEN $2 AND $3', [domainId, startDate, endDate]));
    await step('gsc_daily ekleme', () => bulkInsert(
      client,
      'gsc_daily',
      ['domain_id', 'date', 'clicks', 'impressions', 'position'],
      ['uuid', 'date', 'int', 'int', 'real'],
      daily.map((r) => [domainId, r.keys[0], ...metrics(r)]),
    ));

    for (const { dim, table, col } of DIMENSION_TABLES) {
      await step(`${table} silme`, () => client.query(`DELETE FROM ${table} WHERE domain_id = $1 AND date BETWEEN $2 AND $3`, [domainId, startDate, endDate]));
      await step(`${table} ekleme`, () => bulkInsert(
        client,
        table,
        ['domain_id', 'date', col, 'clicks', 'impressions', 'position'],
        ['uuid', 'date', 'text', 'int', 'int', 'real'],
        byDim[dim].map((r) => [domainId, r.keys[0], dim === 'country' ? r.keys[1].toUpperCase() : r.keys[1], ...metrics(r)]),
      ));
    }

    await step('gsc_query_page silme', () => client.query('DELETE FROM gsc_query_page WHERE domain_id = $1', [domainId]));
    await step('gsc_query_page ekleme', () => bulkInsert(
      client,
      'gsc_query_page',
      ['domain_id', 'query', 'page', 'clicks', 'impressions', 'position'],
      ['uuid', 'text', 'text', 'int', 'int', 'real'],
      queryPage.map((r) => [domainId, r.keys[0], r.keys[1], ...metrics(r)]),
    ));

    await step('gsc_query_country_daily silme', () => client.query('DELETE FROM gsc_query_country_daily WHERE domain_id = $1 AND date BETWEEN $2 AND $3', [domainId, startDate, endDate]));
    await step('gsc_query_country_daily ekleme', () => bulkInsert(
      client,
      'gsc_query_country_daily',
      ['domain_id', 'date', 'query', 'country', 'clicks', 'impressions', 'position'],
      ['uuid', 'date', 'text', 'text', 'int', 'int', 'real'],
      queryCountry.map((r) => [domainId, r.keys[0], r.keys[1], r.keys[2].toUpperCase(), ...metrics(r)]),
    ));

    // Sıralamalar sekmesi için son 28 gün / önceki 28 gün özeti (verideki son güne göre; GSC 2-3 gün gecikmeli).
    // Satırlar zaten bellekte olduğundan özet JS'te çıkarılır: aynı işlemde yeni yazılan yüz binlerce satırı
    // veritabanında yeniden gruplamak (istatistiksiz, diske taşan hash) Neon'da dakikalar sürüyordu.
    await step('gsc_query_country silme', () => client.query('DELETE FROM gsc_query_country WHERE domain_id = $1', [domainId]));
    await step('gsc_query_country özet', () => bulkInsert(
      client,
      'gsc_query_country',
      ['domain_id', 'query', 'country', 'clicks', 'impressions', 'position', 'prev_clicks', 'prev_impressions', 'prev_position'],
      ['uuid', 'text', 'text', 'int', 'int', 'real', 'int', 'int', 'real'],
      summarizeQueryCountry(queryCountry).map((r) => [domainId, ...r]),
    ));

    await step('domains durum güncelleme', () => client.query(
      "UPDATE domains SET sync_status = 'idle', sync_error = NULL, last_synced_at = now() WHERE id = $1",
      [domainId],
    ));
  });
}

/**
 * İçerik erimesi için aylık sayfa performansı: Search Console'un sakladığı 16 aya kadar takvim ayları.
 * Eksik aylar ve son iki ay (tamamlanmamış olabilir) her senkronda yenilenir; günlük tablolar 90 günle sınırlı olduğu için ayrı tutulur.
 */
const MONTHS = 16;
export async function syncPageMonthly(domainId, userId) {
  const { rows } = await query('SELECT gsc_property FROM domains WHERE id = $1 AND user_id = $2', [domainId, userId]);
  const property = rows[0]?.gsc_property;
  if (!property) return;
  const end = addDays(new Date(), -1);
  const { rows: have } = await query('SELECT DISTINCT month::text AS m FROM gsc_page_monthly WHERE domain_id = $1', [domainId]);
  const existing = new Set(have.map((r) => r.m));
  for (let i = 0; i < MONTHS; i++) {
    const first = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - i, 1));
    const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
    const month = isoDate(first);
    if (i >= 2 && existing.has(month)) continue;
    const data = await fetchAll(userId, property, { startDate: month, endDate: isoDate(last < end ? last : end), dimensions: ['page'] }, 4);
    await withTransaction(async (client) => {
      await client.query("SET LOCAL statement_timeout = '5min'");
      await client.query('DELETE FROM gsc_page_monthly WHERE domain_id = $1 AND month = $2', [domainId, month]);
      await bulkInsert(
        client,
        'gsc_page_monthly',
        ['domain_id', 'month', 'page', 'clicks', 'impressions', 'position'],
        ['uuid', 'date', 'text', 'int', 'int', 'real'],
        data.map((r) => [domainId, month, r.keys[0], ...metrics(r)]),
      );
    });
  }
}

export async function runSync(domainId, userId) {
  try {
    await syncDomain(domainId, userId);
    // Aylık geçmiş ana senkronu bozmasın (kota/zaman aşımı durumunda bir sonraki senkronda tamamlanır)
    await syncPageMonthly(domainId, userId).catch((err) => console.warn('[sync] aylık sayfa verisi', err.message));
    await afterSync(domainId);
  } catch (err) {
    // Adım dışında kalan hatalar da etiketlensin; etiketsiz mesaj görülürse sunucuda eski kod çalışıyordur
    if (!err.syncStep) console.error('[sync] adım dışı hata', err.stack);
    const message = err.syncStep ? err.message : `adım dışı: ${err.message}`;
    await query("UPDATE domains SET sync_status = 'failed', sync_error = $2 WHERE id = $1", [domainId, message.slice(0, 500)]);
    throw err;
  }
}
