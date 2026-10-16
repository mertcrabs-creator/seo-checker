import pg from 'pg';
import { config } from '../config.js';

// DATE kolonlarını JS Date'e çevirmeden 'YYYY-MM-DD' string olarak al (timezone kayması olmasın)
pg.types.setTypeParser(1082, (v) => v);
// BIGINT (SUM/COUNT sonuçları) — değerlerimiz Number sınırları içinde
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));

export const pool = new pg.Pool({
  connectionString: config.db.url,
  ssl: config.db.ssl ? { rejectUnauthorized: true } : false,
  max: 20,
  idleTimeoutMillis: 30_000,
  // Neon ücretsiz planda veritabanı uykudan birkaç saniyede uyanır; kısa zaman aşımı bağlantıyı düşürür
  connectionTimeoutMillis: 20_000,
  keepAlive: true,
  statement_timeout: 30_000,
  application_name: 'cr-seo-checker',
});

pool.on('error', (err) => console.error('[db] idle client error', err.message));

/**
 * Bağlantı kurulamadan (sorgu sunucuya hiç gitmeden) oluşan hatalar güvenle tekrar denenebilir;
 * sorgu çalıştıktan sonraki hatalar asla tekrarlanmaz (çift yazma riski).
 */
const isConnectError = (err) =>
  /timeout expired|connection timeout|Connection terminated unexpectedly|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i.test(
    `${err?.message} ${err?.code}`,
  );

async function connect(attempts = 3) {
  for (let i = 1; ; i++) {
    try {
      return await pool.connect();
    } catch (err) {
      if (i >= attempts || !isConnectError(err)) throw err;
      console.warn(`[db] bağlantı kurulamadı (${i}/${attempts}), tekrar deneniyor: ${err.message}`);
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
}

export async function query(text, params) {
  const client = await connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

export async function withTransaction(fn) {
  const client = await connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
