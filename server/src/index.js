import { config } from './config.js';
import { createApp } from './app.js';
import { pool, query } from './db/pool.js';
import { purgeExpiredTokens } from './services/authService.js';
import { startScheduler } from './services/scheduler.js';

// Şema migration'ları `prisma migrate deploy` ile (npm prestart/predev) uygulanır.

// Beklenmeyen bir hata (ör. anlık veritabanı kopması) tüm sunucuyu düşürmesin; kaydedilip devam edilir
process.on('unhandledRejection', (err) => console.error('[process] yakalanmamış hata:', err?.message || err));

// Önceki süreçte yarım kalan işler kuyrukta değil; durumlarını düzelt.
// Veritabanı o an erişilemiyorsa sunucu yine açılır, düzeltme 30 sn sonra tekrar denenir.
async function recoverInterruptedJobs() {
  await query("UPDATE audits SET status = 'failed', error = 'Sunucu yeniden başlatıldı' WHERE status IN ('queued', 'running')");
  await query("UPDATE pagespeed_reports SET status = 'failed', error = 'Sunucu yeniden başlatıldı' WHERE status = 'running'");
  await query("UPDATE domains SET sync_status = 'failed', sync_error = 'Sunucu yeniden başlatıldı' WHERE sync_status = 'running'");
  await query("UPDATE rank_snapshots SET status = 'failed', error = 'Sunucu yeniden başlatıldı', finished_at = now() WHERE status = 'running'");
  await query("UPDATE domains SET rank_status = 'failed', rank_error = 'Sunucu yeniden başlatıldı' WHERE rank_status = 'running'");
  await query("UPDATE domains SET backlink_status = 'failed', backlink_error = 'Sunucu yeniden başlatıldı' WHERE backlink_status = 'running'");
  await query("UPDATE domains SET index_status = 'failed', index_error = 'Sunucu yeniden başlatıldı' WHERE index_status = 'running'");
  await query("UPDATE competitors SET status = 'failed', error = 'Sunucu yeniden başlatıldı' WHERE status IN ('queued', 'running')");
  await query("UPDATE content_briefs SET status = 'failed', error = 'Sunucu yeniden başlatıldı' WHERE status IN ('queued', 'running')");
}
await recoverInterruptedJobs().catch((err) => {
  console.error('[startup] veritabanına ulaşılamadı, 30 sn sonra tekrar denenecek:', err.message);
  setTimeout(() => recoverInterruptedJobs().catch((e) => console.error('[startup]', e.message)), 30_000).unref();
});

startScheduler();

const cleanup = setInterval(() => purgeExpiredTokens().catch((e) => console.error('[cleanup]', e.message)), 60 * 60_000);
cleanup.unref();

const server = createApp().listen(config.port, () => {
  console.log(`[api] http://localhost:${config.port} (${config.env})`);
});
server.headersTimeout = 30_000;
server.requestTimeout = 60_000;

const shutdown = (signal) => {
  console.log(`[api] ${signal} alındı, kapatılıyor`);
  server.close(() => pool.end().finally(() => process.exit(0)));
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
