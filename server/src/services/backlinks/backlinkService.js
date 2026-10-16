import * as cheerio from 'cheerio';
import { config } from '../../config.js';
import { query } from '../../db/pool.js';
import { assertSafeUrl, safeFetch } from '../../utils/safeFetch.js';
import { normalizeUrl } from '../audit/pageAnalyzer.js';
import { afterBacklinks } from '../alertService.js';
import { inboundLinks } from './bing.js';

/**
 * Backlink sistemi: kaynaklar (Bing Webmaster API, Search Console "Bağlantılar" CSV'si, elle ekleme)
 * toplanır; her bağlantı veren sayfa tarayıcıyla ziyaret edilip bağlantının hâlâ var olduğu,
 * anchor metni, rel türü ve risk sinyalleri doğrulanır. Kaybolan bağlantılar işaretlenir.
 */

const VERIFY_CONCURRENCY = 6;
const SPAM_TLDS = new Set(['xyz', 'top', 'click', 'loan', 'work', 'gq', 'tk', 'ml', 'cf', 'ga', 'icu', 'buzz', 'rest', 'cyou', 'sbs', 'bond', 'cfd']);
const SPAM_WORDS = /\b(casino|betting|bahis|kumar|porn|xxx|viagra|cialis|escort|replica|payday loan|crack(ed)? download|airdrop)\b/i;
const escapeLike = (s) => s.replace(/[\\%_]/g, '\\$&');
const bareHost = (h) => String(h).toLowerCase().replace(/^www\./, '');

const hostOf = (u) => {
  try {
    return bareHost(new URL(u).hostname);
  } catch {
    return '';
  }
};
const isOwn = (domain, url) => {
  const h = hostOf(url);
  const own = bareHost(domain.hostname);
  return h === own || h.endsWith(`.${own}`);
};

/** IP/localhost gibi herkese açık olmayan adresler hiç kaydedilmez (tarama zaten engeller). */
const isPublic = (u) => {
  try {
    assertSafeUrl(u);
    return !/^\d{1,3}(\.\d{1,3}){3}$|^\[/.test(new URL(u).hostname);
  } catch {
    return false;
  }
};

async function pool(items, limit, fn) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

// ------------------------------------------------------------------ Toplama
/** Kaynak URL'leri ekler/birleştirir; mevcut kayıtta kaynak listesi genişler, anchor/hedef korunur. */
export async function upsertLinks(domain, items, source) {
  const seen = new Map();
  for (const it of items) {
    const src = normalizeUrl(String(it.source || '').trim());
    if (!src || isOwn(domain, src) || src.length > 2000 || !isPublic(src)) continue;
    if (!seen.has(src)) {
      seen.set(src, {
        source: src,
        target: it.target && isOwn(domain, it.target) ? String(it.target).slice(0, 2000) : null,
        anchor: it.anchor ? String(it.anchor).slice(0, 500) : null,
      });
    }
  }
  const rows = [...seen.values()];
  for (let i = 0; i < rows.length; i += 2000) {
    const chunk = rows.slice(i, i + 2000);
    await query(
      `INSERT INTO backlinks (domain_id, source_url, source_domain, target_url, anchor, sources)
       SELECT $1, u.src, u.dom, u.tgt, u.anc, ARRAY[$2::text]
         FROM unnest($3::text[], $4::text[], $5::text[], $6::text[]) AS u(src, dom, tgt, anc)
       ON CONFLICT (domain_id, source_url) DO UPDATE SET
         sources = ARRAY(SELECT DISTINCT unnest(backlinks.sources || EXCLUDED.sources)),
         target_url = COALESCE(backlinks.target_url, EXCLUDED.target_url),
         anchor = COALESCE(backlinks.anchor, EXCLUDED.anchor)`,
      [domain.id, source, chunk.map((r) => r.source), chunk.map((r) => hostOf(r.source)), chunk.map((r) => r.target), chunk.map((r) => r.anchor)],
    );
  }
  return rows.length;
}

// ------------------------------------------------------------------ Doğrulama
function relType(rel) {
  const t = String(rel || '').toLowerCase().split(/\s+/);
  if (t.includes('sponsored')) return 'sponsored';
  if (t.includes('ugc')) return 'ugc';
  if (t.includes('nofollow')) return 'nofollow';
  return 'dofollow';
}
const REL_RANK = { dofollow: 0, ugc: 1, sponsored: 2, nofollow: 3 };

/** Kaynak sayfayı inceler: bize bağlantı var mı, anchor, rel, kaynak indekslenebilir mi, risk sinyalleri. */
export function inspectSource(domain, res) {
  const $ = cheerio.load(res.body);
  const pageUrl = res.finalUrl;
  const robots = $('meta[name="robots" i], meta[name="googlebot" i]').map((_, el) => $(el).attr('content') || '').get().join(',');
  const noindex = /noindex/i.test(robots) || /noindex/i.test(String(res.headers['x-robots-tag'] || ''));

  let best = null;
  const external = new Set();
  $('a[href]').each((_, el) => {
    const $a = $(el);
    const href = normalizeUrl($a.attr('href'), pageUrl);
    if (!href) return;
    if (isOwn(domain, href)) {
      const rel = relType($a.attr('rel'));
      const anchor = ($a.text().replace(/\s+/g, ' ').trim() || $a.find('img[alt]').attr('alt') || $a.attr('title') || '').slice(0, 500);
      // Aynı sayfada birden çok bağlantı varsa en değerlisini (dofollow) esas al
      if (!best || REL_RANK[rel] < REL_RANK[best.rel]) best = { target: href, anchor: anchor || null, rel };
    } else if (hostOf(href) !== hostOf(pageUrl)) {
      external.add(hostOf(href));
    }
  });

  const reasons = [];
  const tld = hostOf(pageUrl).split('.').pop();
  if (SPAM_TLDS.has(tld)) reasons.push('spam_tld');
  if (external.size > 150) reasons.push('link_farm');
  const text = `${$('title').text()} ${$('body').text().slice(0, 8000)}`;
  if (SPAM_WORDS.test(text)) reasons.push('spam_content');
  if (noindex) reasons.push('source_noindex');
  if (hostOf(res.url) && hostOf(pageUrl) !== hostOf(res.url)) reasons.push('redirect_offsite');
  const weights = { spam_tld: 30, link_farm: 35, spam_content: 40, source_noindex: 15, redirect_offsite: 20 };
  const risk = Math.min(100, reasons.reduce((s, r) => s + weights[r], 0));

  return { link: best, noindex, outbound: external.size, risk, reasons };
}

async function verifyOne(domain, row) {
  let res;
  try {
    res = await safeFetch(row.source_url, { timeoutMs: 15_000, maxBytes: 3 * 1024 * 1024 });
  } catch (err) {
    // Geçici ağ hatasında aktif bağlantıyı hemen "kayıp" saymayalım
    await query(
      `UPDATE backlinks SET status = CASE WHEN status = 'active' THEN 'active' ELSE 'error' END, error = $2, last_checked = now() WHERE id = $1`,
      [row.id, String(err.message).slice(0, 300)],
    );
    return;
  }
  const html = /text\/html|application\/xhtml/i.test(String(res.headers['content-type'] || ''));
  const found = res.status === 200 && html ? inspectSource(domain, res) : null;
  const present = Boolean(found?.link);
  await query(
    `UPDATE backlinks SET
       status = CASE WHEN $2 THEN 'active' WHEN status IN ('active', 'lost') THEN 'lost' ELSE 'not_found' END,
       lost_at = CASE WHEN $2 THEN NULL WHEN status = 'active' THEN now() ELSE lost_at END,
       last_seen = CASE WHEN $2 THEN now() ELSE last_seen END,
       last_checked = now(), http_status = $3, error = NULL,
       target_url = COALESCE($4, target_url), anchor = CASE WHEN $2 THEN $5 ELSE anchor END, rel = CASE WHEN $2 THEN $6 ELSE rel END,
       source_noindex = COALESCE($7, source_noindex), outbound_links = COALESCE($8, outbound_links),
       risk_score = COALESCE($9, risk_score), risk_reasons = COALESCE($10, risk_reasons)
     WHERE id = $1`,
    [
      row.id, present, res.status, found?.link?.target ?? null, found?.link?.anchor ?? null, found?.link?.rel ?? null,
      found ? found.noindex : null, found ? found.outbound : null, found ? found.risk : null, found ? found.reasons : null,
    ],
  );
}

export async function verify(domain, { onlyUnverified = false } = {}) {
  const { rows } = await query(
    `SELECT id, source_url, status FROM backlinks WHERE domain_id = $1 ${onlyUnverified ? "AND status = 'unverified'" : ''}
      ORDER BY last_checked NULLS FIRST LIMIT $2`,
    [domain.id, config.backlinkVerifyLimit],
  );
  await pool(rows, VERIFY_CONCURRENCY, (row) => verifyOne(domain, row));
  return rows.length;
}

/** İş kuyruğa alınmadan önce durumu işaretle (arayüz hemen "taranıyor" görsün). */
export const markRunning = (domain) =>
  query("UPDATE domains SET backlink_status = 'running', backlink_error = NULL WHERE id = $1", [domain.id]);


/** Tam güncelleme: Bing'den keşif + tüm bağlantıların (en eski kontrol edilenden başlayarak) doğrulanması. */
export async function runRefresh(domain, { onlyUnverified = false } = {}) {
  await query("UPDATE domains SET backlink_status = 'running', backlink_error = NULL WHERE id = $1", [domain.id]);
  const startedAt = new Date();
  let warning = null;
  try {
    if (config.bing.enabled && !onlyUnverified) {
      try {
        const { links, sites } = await inboundLinks(domain.hostname);
        await upsertLinks(domain, links, 'bing');
        if (!links.length) {
          warning = `Bing API ${sites.join(', ')} için bağlantı döndürmedi (Bing yeni Backlinks raporunu API’de vermeyebiliyor). `
            + 'Bing Webmaster → Backlinks → Pages → “Download all” ile CSV indirip “İçe aktar / ekle” ile yükleyin.';
        }
      } catch (err) {
        warning = err.message; // Bing hatası doğrulamayı engellemesin
      }
    }
    await verify(domain, { onlyUnverified });
    // Tarama sürerken içe aktarılan bağlantılar da bu turda doğrulansın
    for (let round = 0; round < 5 && (await verify(domain, { onlyUnverified: true })) > 0; round++);
    await query(
      "UPDATE domains SET backlink_status = 'idle', backlink_error = $2, backlink_updated_at = now() WHERE id = $1",
      [domain.id, warning],
    );
    await afterBacklinks(domain.id, startedAt);
  } catch (err) {
    await query("UPDATE domains SET backlink_status = 'failed', backlink_error = $2 WHERE id = $1", [domain.id, String(err.message).slice(0, 500)]);
    throw err;
  }
}

// ------------------------------------------------------------------ Okuma
export async function summary(domain) {
  const [totals, anchors, targets, topDomains, rels] = await Promise.all([
    query(
      `SELECT count(*)::int AS links,
              count(DISTINCT source_domain) FILTER (WHERE status = 'active')::int AS referring_domains,
              count(*) FILTER (WHERE status = 'active')::int AS active,
              count(*) FILTER (WHERE status = 'active' AND rel = 'dofollow')::int AS dofollow,
              count(*) FILTER (WHERE status = 'lost')::int AS lost,
              count(*) FILTER (WHERE status = 'lost' AND lost_at > now() - interval '30 days')::int AS lost_30d,
              count(*) FILTER (WHERE status = 'active' AND first_seen > now() - interval '30 days')::int AS new_30d,
              count(*) FILTER (WHERE status IN ('unverified', 'error'))::int AS pending,
              count(*) FILTER (WHERE status = 'not_found')::int AS not_found,
              count(*) FILTER (WHERE status = 'active' AND risk_score >= 40)::int AS risky
         FROM backlinks WHERE domain_id = $1`,
      [domain.id],
    ),
    query(
      `SELECT COALESCE(NULLIF(lower(anchor), ''), '(boş / görsel)') AS anchor, count(*)::int AS links
         FROM backlinks WHERE domain_id = $1 AND status = 'active' GROUP BY 1 ORDER BY 2 DESC LIMIT 15`,
      [domain.id],
    ),
    query(
      `SELECT target_url, count(*)::int AS links, count(DISTINCT source_domain)::int AS domains
         FROM backlinks WHERE domain_id = $1 AND status = 'active' AND target_url IS NOT NULL
        GROUP BY target_url ORDER BY 3 DESC, 2 DESC LIMIT 15`,
      [domain.id],
    ),
    query(
      `SELECT source_domain, count(*)::int AS links, count(*) FILTER (WHERE rel = 'dofollow')::int AS dofollow, max(risk_score)::int AS risk
         FROM backlinks WHERE domain_id = $1 AND status = 'active' GROUP BY source_domain ORDER BY 2 DESC LIMIT 15`,
      [domain.id],
    ),
    query(`SELECT rel, count(*)::int AS links FROM backlinks WHERE domain_id = $1 AND status = 'active' GROUP BY rel`, [domain.id]),
  ]);
  return {
    status: domain.backlink_status,
    error: domain.backlink_error,
    updatedAt: domain.backlink_updated_at,
    bingEnabled: config.bing.enabled,
    totals: totals.rows[0],
    anchors: anchors.rows,
    targets: targets.rows,
    topDomains: topDomains.rows,
    rels: rels.rows,
  };
}

const LIST_SORT = {
  first_seen: 'first_seen', last_checked: 'last_checked', source_domain: 'source_domain', risk_score: 'risk_score', outbound_links: 'outbound_links',
};
const STATUS_FILTER = {
  all: 'TRUE', active: "status = 'active'", lost: "status = 'lost'", pending: "status IN ('unverified', 'error')",
  not_found: "status = 'not_found'", risky: "status = 'active' AND risk_score >= 40",
};

export async function list(domain, { search, status, rel, sort, order, page, pageSize }) {
  const params = [domain.id];
  const filters = ['domain_id = $1', STATUS_FILTER[status]];
  if (rel) {
    params.push(rel);
    filters.push(`rel = $${params.length}`);
  }
  if (search) {
    params.push(`%${escapeLike(search)}%`);
    filters.push(`(source_url ILIKE $${params.length} ESCAPE '\\' OR anchor ILIKE $${params.length} ESCAPE '\\' OR target_url ILIKE $${params.length} ESCAPE '\\')`);
  }
  params.push(pageSize, (page - 1) * pageSize);
  const dir = order === 'asc' ? 'ASC' : 'DESC';
  const { rows } = await query(
    `SELECT id, source_url, source_domain, target_url, anchor, rel, status, http_status, source_noindex, outbound_links,
            risk_score, risk_reasons, sources, error, first_seen, last_seen, last_checked, lost_at, COUNT(*) OVER ()::int AS total
       FROM backlinks WHERE ${filters.join(' AND ')}
      ORDER BY ${LIST_SORT[sort]} ${dir} NULLS LAST, source_url
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { total: rows[0]?.total || 0, rows: rows.map(({ total, ...r }) => r) };
}

export async function referringDomains(domain, { search, page, pageSize }) {
  const params = [domain.id];
  let filter = '';
  if (search) {
    params.push(`%${escapeLike(search)}%`);
    filter = `AND source_domain ILIKE $${params.length} ESCAPE '\\'`;
  }
  params.push(pageSize, (page - 1) * pageSize);
  const { rows } = await query(
    `SELECT source_domain, count(*)::int AS links, count(*) FILTER (WHERE status = 'active')::int AS active,
            count(*) FILTER (WHERE status = 'active' AND rel = 'dofollow')::int AS dofollow,
            count(*) FILTER (WHERE status = 'lost')::int AS lost, max(risk_score)::int AS risk, min(first_seen) AS first_seen,
            COUNT(*) OVER ()::int AS total
       FROM backlinks WHERE domain_id = $1 ${filter}
      GROUP BY source_domain ORDER BY count(*) FILTER (WHERE status = 'active') DESC, count(*) DESC, source_domain
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { total: rows[0]?.total || 0, rows: rows.map(({ total, ...r }) => r) };
}

export async function hasLinks(domain) {
  const { rows } = await query('SELECT 1 FROM backlinks WHERE domain_id = $1 LIMIT 1', [domain.id]);
  return rows.length > 0;
}

export async function remove(domain, id) {
  const { rowCount } = await query('DELETE FROM backlinks WHERE id = $1 AND domain_id = $2', [id, domain.id]);
  return rowCount > 0;
}

/** Google disavow dosyası formatında riskli alan adları (inceleme sonrası Search Console'a yüklenebilir). */
export async function disavowFile(domain) {
  const { rows } = await query(
    `SELECT DISTINCT source_domain FROM backlinks WHERE domain_id = $1 AND status = 'active' AND risk_score >= 40 ORDER BY 1`,
    [domain.id],
  );
  return [`# ${domain.hostname} için riskli bağlantı veren alan adları (CR SEO Panel). Yüklemeden önce gözden geçirin.`, ...rows.map((r) => `domain:${r.source_domain}`)].join('\n');
}
