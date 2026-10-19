import { config } from '../config.js';
import { query, withTransaction } from '../db/pool.js';
import { safeFetch } from '../utils/safeFetch.js';
import { createAlert } from './alertService.js';
import { analyzePage, normalizeUrl } from './audit/pageAnalyzer.js';
import { isAllowed, parseRobots } from './audit/robots.js';

/**
 * Sayfa değişiklik takibi. İki kaynak:
 *  - audit:   her tamamlanan taramada, iki taramada da bulunan sayfalar karşılaştırılır
 *  - monitor: önemli sayfalar (ana sayfa + en çok trafik alanlar) 6 saatte bir hafifçe kontrol edilir
 * Kritik değişiklikler (noindex, hata kodu, robots engeli, canonical başka sayfaya) anında uyarı üretir.
 */

const MONITOR_CONCURRENCY = 4;
const DUPLICATE_WINDOW_DAYS = 8; // izleme bir değişikliği yakaladıysa haftalık tarama aynısını tekrar yazmaz

const clean = (v) => (v === null || v === undefined ? null : String(v).replace(/\s+/g, ' ').trim() || null);
const short = (v) => (v === null || v === undefined ? null : String(v).slice(0, 500));
const sameUrl = (a, b) => (a || '').replace(/\/$/, '') === (b || '').replace(/\/$/, '');
const isOk = (s) => s === 200;

/**
 * İki anlık görüntü arasındaki farklar.
 * @param {{url:string,statusCode:number|null,noindex:boolean,canonical:string|null,title:string|null,metaDescription:string|null,h1:string|null,wordCount?:number|null,robotsBlocked?:boolean}} prev
 */
export function diffSnapshots(prev, cur) {
  const out = [];
  const push = (field, oldValue, newValue, severity) => out.push({ url: cur.url, field, oldValue: short(oldValue), newValue: short(newValue), severity });

  if ((prev.statusCode ?? null) !== (cur.statusCode ?? null)) {
    const p = prev.statusCode;
    const c = cur.statusCode;
    let severity = 'warning';
    if (isOk(p) && (c === null || c >= 400)) severity = 'critical';
    else if (isOk(c)) severity = 'notice'; // düzeldi
    push('status_code', p ?? 'hata', c ?? 'hata', severity);
  }
  if (prev.robotsBlocked !== undefined && cur.robotsBlocked !== undefined && Boolean(prev.robotsBlocked) !== Boolean(cur.robotsBlocked)) {
    push('robots_blocked', prev.robotsBlocked ? 'engelli' : 'izinli', cur.robotsBlocked ? 'engelli' : 'izinli', cur.robotsBlocked ? 'critical' : 'notice');
  }
  // İçerik alanları sadece iki tarafta da sayfa başarıyla açıldıysa anlamlıdır
  if (!isOk(prev.statusCode) || !isOk(cur.statusCode)) return out;

  if (Boolean(prev.noindex) !== Boolean(cur.noindex)) {
    push('noindex', prev.noindex ? 'noindex' : 'index', cur.noindex ? 'noindex' : 'index', cur.noindex ? 'critical' : 'notice');
  }
  const pc = clean(prev.canonical);
  const cc = clean(cur.canonical);
  if (!sameUrl(pc, cc)) {
    const nowElsewhere = cc && !sameUrl(cc, cur.url);
    const wasSelf = !pc || sameUrl(pc, cur.url);
    push('canonical', pc, cc, nowElsewhere && wasSelf ? 'critical' : 'warning');
  }
  for (const [field, key, removedSeverity] of [['title', 'title', 'warning'], ['h1', 'h1', 'warning'], ['meta_description', 'metaDescription', 'notice']]) {
    const a = clean(prev[key]);
    const b = clean(cur[key]);
    if (a !== b) push(field, a, b, !b ? removedSeverity : 'notice');
  }
  if (prev.wordCount >= 300 && cur.wordCount !== undefined && cur.wordCount !== null && cur.wordCount <= prev.wordCount * 0.6) {
    push('word_count', prev.wordCount, cur.wordCount, 'warning');
  }
  return out;
}

const FIELD_LABELS = {
  status_code: 'HTTP durum kodu', noindex: 'İndeksleme (noindex)', canonical: 'Canonical', title: 'Title', h1: 'H1',
  meta_description: 'Meta açıklama', word_count: 'İçerik uzunluğu', robots_blocked: 'robots.txt erişimi',
};

async function insertChanges(domainId, changes, source) {
  if (!changes.length) return [];
  const rows = changes.slice(0, 2000);
  const { rows: inserted } = await query(
    `INSERT INTO page_changes (domain_id, url, field, old_value, new_value, severity, source)
     SELECT $1::uuid, u.url, u.field, u.old_value, u.new_value, u.severity, $2
       FROM unnest($3::text[], $4::text[], $5::text[], $6::text[], $7::text[]) AS u(url, field, old_value, new_value, severity)
      WHERE NOT EXISTS (
        SELECT 1 FROM page_changes c
         WHERE c.domain_id = $1 AND c.url = u.url AND c.field = u.field AND c.new_value IS NOT DISTINCT FROM u.new_value
           AND c.created_at > now() - make_interval(days => ${DUPLICATE_WINDOW_DAYS}))
     RETURNING url, field, old_value, new_value, severity`,
    [domainId, source, rows.map((c) => c.url), rows.map((c) => c.field), rows.map((c) => c.oldValue), rows.map((c) => c.newValue), rows.map((c) => c.severity)],
  );
  return inserted;
}

const describe = (c) => {
  if (c.field === 'noindex') return `noindex eklendi: ${c.url}`;
  if (c.field === 'robots_blocked') return `robots.txt engelliyor: ${c.url}`;
  if (c.field === 'status_code') return `HTTP ${c.old_value} → ${c.new_value}: ${c.url}`;
  if (c.field === 'canonical') return `Canonical başka sayfaya: ${c.url} → ${c.new_value}`;
  if (c.field === 'word_count') return `İçerik ${c.old_value} → ${c.new_value} kelime: ${c.url}`;
  return `${FIELD_LABELS[c.field] || c.field} ${c.new_value ? 'değişti' : 'kaldırıldı'}: ${c.url}`;
};

async function alertFor(domainId, inserted) {
  for (const [severity, type, label] of [['critical', 'page_change_critical', 'kritik'], ['warning', 'page_change_warning', 'önemli']]) {
    const list = inserted.filter((c) => c.severity === severity);
    if (!list.length) continue;
    const pages = new Set(list.map((c) => c.url)).size;
    await createAlert({
      domainId, type, severity,
      title: `${pages} sayfada ${label} değişiklik`,
      detail: list.slice(0, 6).map((c) => `• ${describe(c)}`).join('\n'),
      data: { count: list.length },
      // Kritik değişiklikler (ör. yanlışlıkla noindex) her izleme turunda haber verilmeli
      dedupeHours: severity === 'critical' ? 1 : 24,
    });
  }
}

// ------------------------------------------------------------------ Tarama karşılaştırması
const PAGE_COLS = 'url, status_code, noindex, canonical, title, meta_description, h1, word_count';
const toSnapshot = (r) => ({
  url: r.url, statusCode: r.status_code, noindex: r.noindex, canonical: r.canonical, title: r.title,
  metaDescription: r.meta_description, h1: r.h1, wordCount: r.word_count,
});

export async function detectAuditChanges(auditId, domainId) {
  try {
    const { rows: [prev] } = await query(
      `SELECT id FROM audits WHERE domain_id = $1 AND status = 'completed' AND id <> $2 ORDER BY created_at DESC LIMIT 1`,
      [domainId, auditId],
    );
    if (!prev) return;
    const [{ rows: before }, { rows: after }] = await Promise.all([
      query(`SELECT ${PAGE_COLS} FROM audit_pages WHERE audit_id = $1`, [prev.id]),
      query(`SELECT ${PAGE_COLS} FROM audit_pages WHERE audit_id = $1`, [auditId]),
    ]);
    const old = new Map(before.map((r) => [r.url, r]));
    const changes = after.filter((r) => old.has(r.url)).flatMap((r) => diffSnapshots(toSnapshot(old.get(r.url)), toSnapshot(r)));
    await alertFor(domainId, await insertChanges(domainId, changes, 'audit'));
  } catch (err) {
    console.warn('[changes] audit', err.message);
  }
}

// ------------------------------------------------------------------ Önemli sayfa izleme
/** Ana sayfa + son 28 günde en çok tıklanan sayfalar + en çok iç bağlantı alan sayfalar. */
async function keyPages(domain) {
  const limit = config.monitorPages;
  const { rows: [audit] } = await query(
    `SELECT id, site_info->>'finalUrl' AS home FROM audits WHERE domain_id = $1 AND status = 'completed' ORDER BY created_at DESC LIMIT 1`,
    [domain.id],
  );
  const home = normalizeUrl(audit?.home || `https://${domain.hostname}/`);
  const host = new URL(home).hostname;
  const urls = new Set([home]);
  const { rows: gsc } = await query(
    `WITH b AS (SELECT max(date) AS e FROM gsc_page_daily WHERE domain_id = $1)
     SELECT page FROM gsc_page_daily, b WHERE domain_id = $1 AND date > b.e - 28
      GROUP BY page ORDER BY SUM(clicks) DESC, SUM(impressions) DESC LIMIT $2`,
    [domain.id, limit],
  );
  const add = (u) => {
    const n = normalizeUrl(u);
    if (n && urls.size < limit && new URL(n).hostname === host) urls.add(n);
  };
  gsc.forEach((r) => add(r.page));
  if (audit && urls.size < limit) {
    const { rows } = await query(
      `SELECT url FROM audit_pages WHERE audit_id = $1 AND status_code = 200 AND NOT noindex ORDER BY inlinks DESC, depth ASC LIMIT $2`,
      [audit.id, limit],
    );
    rows.forEach((r) => add(r.url));
  }
  return { home, urls: [...urls] };
}

async function fetchSnapshot(url, rules) {
  const u = new URL(url);
  const base = { url, robotsBlocked: !isAllowed(rules, u.pathname + u.search) };
  let res;
  for (let attempt = 0; attempt < 2; attempt++) {
    res = await safeFetch(url, { maxRedirects: 0, timeoutMs: 20_000 }).catch((error) => ({ error }));
    // Geçici ağ hatası / 5xx yanlış alarm üretmesin: bir kez daha dene
    if (!res.error && res.status < 500) break;
    if (attempt === 0) await new Promise((r) => setTimeout(r, 5000));
  }
  if (res.error) return { ...base, statusCode: null, error: String(res.error.message).slice(0, 300) };
  const snap = { ...base, statusCode: res.status, error: null };
  if (res.status === 200 && /text\/html|application\/xhtml/i.test(String(res.headers['content-type'] || ''))) {
    const { data } = analyzePage(res, u.hostname);
    Object.assign(snap, { noindex: data.noindex, canonical: data.canonical, title: data.title, metaDescription: data.metaDescription, h1: data.h1 });
  }
  return snap;
}

export async function runMonitor(domain) {
  try {
    const { home, urls } = await keyPages(domain);
    const origin = new URL(home).origin;
    const robotsRes = await safeFetch(`${origin}/robots.txt`, { maxBytes: 512 * 1024 }).catch(() => null);
    const robots = robotsRes?.status === 200 && !/text\/html/i.test(String(robotsRes.headers['content-type'] || ''))
      ? parseRobots(robotsRes.body, 'googlebot')
      : { rules: [], blocksAll: false };

    const { rows: prevRows } = await query('SELECT * FROM page_watch WHERE domain_id = $1', [domain.id]);
    const prevMap = new Map(prevRows.map((r) => [r.url, r]));

    const snaps = [];
    let next = 0;
    await Promise.all(Array.from({ length: MONITOR_CONCURRENCY }, async () => {
      while (next < urls.length) {
        const url = urls[next++];
        snaps.push(await fetchSnapshot(url, robots.rules));
      }
    }));

    const changes = [];
    for (const s of snaps) {
      const p = prevMap.get(s.url);
      // Sayfa açılamadıysa son bilinen içeriği koru (düzelince yanlış "title değişti" çıkmasın)
      if (s.statusCode !== 200 && p) Object.assign(s, { noindex: p.noindex, canonical: p.canonical, title: p.title, metaDescription: p.meta_description, h1: p.h1 });
      if (!p) continue;
      changes.push(...diffSnapshots({
        url: p.url, statusCode: p.status_code, noindex: p.noindex, canonical: p.canonical, title: p.title,
        metaDescription: p.meta_description, h1: p.h1, robotsBlocked: p.robots_blocked,
      }, s));
    }

    await withTransaction(async (client) => {
      await client.query('DELETE FROM page_watch WHERE domain_id = $1', [domain.id]);
      await client.query(
        `INSERT INTO page_watch (domain_id, url, status_code, noindex, canonical, title, meta_description, h1, robots_blocked, error)
         SELECT $1::uuid, * FROM unnest($2::text[], $3::int[], $4::bool[], $5::text[], $6::text[], $7::text[], $8::text[], $9::bool[], $10::text[])`,
        [
          domain.id, snaps.map((s) => s.url), snaps.map((s) => s.statusCode), snaps.map((s) => Boolean(s.noindex)),
          snaps.map((s) => s.canonical ?? null), snaps.map((s) => s.title ?? null), snaps.map((s) => s.metaDescription ?? null),
          snaps.map((s) => s.h1 ?? null), snaps.map((s) => s.robotsBlocked), snaps.map((s) => s.error ?? null),
        ],
      );
      await client.query('UPDATE domains SET monitor_checked_at = now() WHERE id = $1', [domain.id]);
    });

    await alertFor(domain.id, await insertChanges(domain.id, changes, 'monitor'));
    if (robots.blocksAll) {
      await createAlert({
        domainId: domain.id, type: 'indexing_blocked', severity: 'critical', title: 'robots.txt Googlebot’u tüm siteden engelliyor',
        detail: 'Google siteyi taramayı bırakacak ve sayfalar zamanla indeksten düşebilir. Hemen kontrol edin.', dedupeHours: 6,
      });
    }
    return { checked: snaps.length, changes: changes.length };
  } catch (err) {
    console.warn('[changes] monitor', domain.hostname, err.message);
    await query('UPDATE domains SET monitor_checked_at = now() WHERE id = $1', [domain.id]).catch(() => {});
    throw err;
  }
}

// ------------------------------------------------------------------ Okuma
const SEVERITIES = ['critical', 'warning', 'notice'];

export async function listChanges(domainId, { severity, field, search, days, page, pageSize }) {
  const params = [domainId, days];
  const filters = ['domain_id = $1', 'created_at > now() - make_interval(days => $2)'];
  if (severity && SEVERITIES.includes(severity)) {
    params.push(severity);
    filters.push(`severity = $${params.length}`);
  }
  if (field) {
    params.push(field);
    filters.push(`field = $${params.length}`);
  }
  if (search) {
    params.push(`%${search.replace(/[\\%_]/g, '\\$&')}%`);
    filters.push(`url ILIKE $${params.length} ESCAPE '\\'`);
  }
  params.push(pageSize, (page - 1) * pageSize);
  const where = filters.join(' AND ');
  const [{ rows }, { rows: [counts] }] = await Promise.all([
    query(
      `SELECT id, url, field, old_value, new_value, severity, source, created_at, COUNT(*) OVER ()::int AS total
         FROM page_changes WHERE ${where}
        ORDER BY created_at DESC, CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, url
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    ),
    query(
      `SELECT count(*) FILTER (WHERE severity = 'critical')::int AS critical, count(*) FILTER (WHERE severity = 'warning')::int AS warning,
              count(*) FILTER (WHERE severity = 'notice')::int AS notice, count(DISTINCT url)::int AS pages
         FROM page_changes WHERE domain_id = $1 AND created_at > now() - make_interval(days => $2)`,
      [domainId, days],
    ),
  ]);
  return { total: rows[0]?.total || 0, rows: rows.map(({ total, ...r }) => r), counts };
}

export async function watchList(domain) {
  const { rows } = await query(
    `SELECT url, status_code, noindex, canonical, title, robots_blocked, error, checked_at FROM page_watch
      WHERE domain_id = $1 ORDER BY (status_code = 200 AND NOT noindex AND NOT robots_blocked), url`,
    [domain.id],
  );
  const { rows: [d] } = await query('SELECT monitor_checked_at FROM domains WHERE id = $1', [domain.id]);
  return { checkedAt: d?.monitor_checked_at || null, pages: rows };
}

/** Grafik işaretleri için: gün bazında kritik/önemli değişiklik sayısı. */
export async function dailyChangeMarkers(domainId, start, end) {
  const { rows } = await query(
    `SELECT (created_at AT TIME ZONE 'UTC')::date AS date, count(*) FILTER (WHERE severity = 'critical')::int AS critical,
            count(*) FILTER (WHERE severity = 'warning')::int AS warning, count(DISTINCT url)::int AS pages
       FROM page_changes WHERE domain_id = $1 AND severity IN ('critical', 'warning')
        AND created_at >= $2::date AND created_at < $3::date + 1
      GROUP BY 1 ORDER BY 1`,
    [domainId, start, end],
  );
  return rows;
}
