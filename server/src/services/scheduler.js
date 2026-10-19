import { config } from '../config.js';
import { query } from '../db/pool.js';
import { checkSsl } from './alertService.js';
import { computeAuthority } from './authority/authorityService.js';
import { runAudit } from './audit/auditor.js';
import { runMonitor } from './changeService.js';
import { runCompetitor } from './insights/competitorService.js';
import { dueDomains, runChecks } from './insights/serpTrackingService.js';
import { runRefresh as runBacklinks } from './backlinks/backlinkService.js';
import { runInspection } from './indexService.js';
import { auditQueue, backlinkQueue, competitorQueue, indexQueue, monitorQueue, serpQueue, syncQueue } from './jobQueue.js';
import { runSync } from './searchConsoleSync.js';

/**
 * Otomatik izleme: her 15 dakikada vadesi gelen işleri mevcut kuyruklara ekler (her turda sınırlı sayıda,
 * dış servislere ve sunucuya yük bindirmemek için). İşler bitince alertService kontrolleri çalışır.
 */
const TICK_MS = 15 * 60_000;
const lastSsl = new Map();
const run = (label, fn) => fn().catch((err) => console.warn(`[scheduler] ${label}`, err.message));

async function tick() {
  // Search Console: günlük
  const { rows: sync } = await query(
    `SELECT d.id, d.user_id FROM domains d JOIN google_connections g ON g.user_id = d.user_id
      WHERE d.gsc_property IS NOT NULL AND d.sync_status <> 'running'
        AND (d.last_synced_at IS NULL OR d.last_synced_at < now() - interval '20 hours')
      ORDER BY d.last_synced_at NULLS FIRST LIMIT 5`,
  );
  for (const d of sync) {
    if (syncQueue.has(d.id)) continue;
    await query("UPDATE domains SET sync_status = 'running', sync_error = NULL WHERE id = $1", [d.id]);
    syncQueue.add(d.id, () => runSync(d.id, d.user_id));
  }

  // Site taraması: haftalık
  const { rows: audits } = await query(
    `SELECT d.id, d.hostname FROM domains d
      WHERE NOT EXISTS (SELECT 1 FROM audits a WHERE a.domain_id = d.id AND (a.status IN ('queued', 'running') OR a.created_at > now() - interval '7 days'))
      ORDER BY d.created_at LIMIT 3`,
  );
  for (const d of audits) {
    if (auditQueue.has(d.id)) continue;
    const { rows: [a] } = await query('INSERT INTO audits (domain_id) VALUES ($1) RETURNING id', [d.id]);
    auditQueue.add(d.id, () => runAudit(a.id, d.id, d.hostname));
  }

  // Backlink doğrulaması: haftalık (bağlantısı olan alan adlarında)
  const { rows: bl } = await query(
    `SELECT d.* FROM domains d
      WHERE d.backlink_status <> 'running' AND EXISTS (SELECT 1 FROM backlinks b WHERE b.domain_id = d.id)
        AND (d.backlink_updated_at IS NULL OR d.backlink_updated_at < now() - interval '7 days')
      LIMIT 2`,
  );
  for (const d of bl) if (!backlinkQueue.has(d.id)) backlinkQueue.add(d.id, () => runBacklinks(d));

  // İndekslenme denetimi: haftalık (Search Console bağlı ve taranmış alan adlarında)
  const { rows: idx } = await query(
    `SELECT d.* FROM domains d JOIN google_connections g ON g.user_id = d.user_id
      WHERE d.gsc_property IS NOT NULL AND d.index_status <> 'running'
        AND (d.index_updated_at IS NULL OR d.index_updated_at < now() - interval '7 days')
        AND EXISTS (SELECT 1 FROM audits a WHERE a.domain_id = d.id AND a.status = 'completed')
      LIMIT 2`,
  );
  for (const d of idx) if (!indexQueue.has(d.id)) indexQueue.add(d.id, () => runInspection(d, d.user_id));

  // Otorite puanı: haftalık (trend grafiği için)
  const { rows: auth } = await query(
    `SELECT d.* FROM domains d
      WHERE NOT EXISTS (SELECT 1 FROM authority_snapshots s WHERE s.domain_id = d.id AND s.created_at > now() - interval '7 days')
        AND EXISTS (SELECT 1 FROM audits a WHERE a.domain_id = d.id AND a.status = 'completed')
      LIMIT 2`,
  );
  for (const d of auth) await run('authority', () => computeAuthority(d));

  // Önemli sayfa izleme (noindex / hata kodu / canonical / title değişiklikleri): varsayılan 6 saatte bir
  const { rows: mon } = await query(
    `SELECT d.id, d.hostname FROM domains d
      WHERE d.monitor_checked_at IS NULL OR d.monitor_checked_at < now() - make_interval(hours => $1::int)
      ORDER BY d.monitor_checked_at NULLS FIRST LIMIT 5`,
    [config.monitorIntervalHours],
  );
  for (const d of mon) if (!monitorQueue.has(d.id)) monitorQueue.add(d.id, () => runMonitor(d));

  // Rakipler: haftalık yeniden tarama (yeni sayfa / güncelleme takibi)
  const { rows: rivals } = await query(
    `SELECT id, hostname FROM competitors WHERE status IN ('completed', 'failed') AND (finished_at IS NULL OR finished_at < now() - interval '7 days')
      ORDER BY finished_at NULLS FIRST LIMIT 1`,
  );
  for (const c of rivals) {
    if (competitorQueue.has(c.id)) continue;
    await query("UPDATE competitors SET status = 'queued' WHERE id = $1", [c.id]);
    competitorQueue.add(c.id, () => runCompetitor(c.id, c.hostname));
  }

  // SERP özellikleri / AI Overview: takip edilen kelimeler (varsayılan haftalık, SerpApi kotası korunarak)
  for (const d of await dueDomains(2)) if (!serpQueue.has(d.id)) serpQueue.add(d.id, () => runChecks(d));

  // SSL: günlük
  const { rows: all } = await query('SELECT id, hostname FROM domains');
  for (const d of all) {
    if (Date.now() - (lastSsl.get(d.id) || 0) < 24 * 3_600_000) continue;
    lastSsl.set(d.id, Date.now());
    await checkSsl(d);
  }
}

export function startScheduler() {
  if (!config.schedulerEnabled) return;
  const loop = () => run('tick', tick);
  setTimeout(loop, 60_000).unref();
  setInterval(loop, TICK_MS).unref();
  console.log('[scheduler] otomatik izleme aktif (15 dk aralık)');
}
