import { query } from '../../db/pool.js';
import { GSC_BASE, googleApi } from '../googleService.js';
import { updatesBetween } from '../annotationService.js';
import { normalizeUrl } from '../audit/pageAnalyzer.js';

/**
 * İçerik erimesi (content decay): aylık Search Console verisinde zirvesinden sonra tıklaması
 * istikrarlı biçimde düşen sayfalar. Aylar gün sayısına göre normalize edilir (içinde bulunulan ay kısmi).
 * Neden tahmini: sıra kaybı / arama talebi düşüşü (mevsimsellik dahil) / tıklama oranı düşüşü.
 */

const MIN_MONTHS = 6;
const MIN_PEAK_CLICKS = 15; // aylık; altındaki sayfalar istatistiksel gürültü
const pageKey = (u) => {
  const n = normalizeUrl(u);
  return n ? n.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') : u;
};
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const round1 = (v) => (v === null || Number.isNaN(v) ? null : Math.round(v * 10) / 10);
const monthAdd = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)).toISOString().slice(0, 10);
};
const daysInMonth = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
};

/** Doğrusal regresyon eğimi (ortalamaya oranla, ay başına). */
function relativeSlope(values) {
  const n = values.length;
  const m = mean(values);
  if (n < 3 || m <= 0) return 0;
  const xm = (n - 1) / 2;
  let num = 0;
  let den = 0;
  values.forEach((y, x) => {
    num += (x - xm) * (y - m);
    den += (x - xm) ** 2;
  });
  return num / den / m;
}

function windowStats(points) {
  const clicks = points.reduce((s, p) => s + p.rawClicks, 0);
  const imp = points.reduce((s, p) => s + p.rawImpressions, 0);
  const posW = points.reduce((s, p) => s + p.position * p.rawImpressions, 0);
  return {
    clicks: mean(points.map((p) => p.clicks)),
    impressions: mean(points.map((p) => p.impressions)),
    position: imp ? posW / imp : null,
    ctr: imp ? clicks / imp : null,
  };
}

export async function contentDecay(domain) {
  const { rows: [b] } = await query(
    `SELECT (SELECT max(date) FROM gsc_daily WHERE domain_id = $1)::text AS end_date,
            (SELECT count(DISTINCT month)::int FROM gsc_page_monthly WHERE domain_id = $1) AS months`,
    [domain.id],
  );
  if (!b.end_date || b.months < MIN_MONTHS) return { insufficient: true, months: b.months || 0, minMonths: MIN_MONTHS, rows: [] };

  const lastMonth = `${b.end_date.slice(0, 7)}-01`;
  const lastDays = Number(b.end_date.slice(8, 10));
  const [{ rows }, { rows: auditPages }] = await Promise.all([
    query(
      `SELECT month::text AS month, page, clicks, impressions, position FROM gsc_page_monthly
        WHERE domain_id = $1 AND month <= $2 AND page IN (
          SELECT page FROM gsc_page_monthly WHERE domain_id = $1 GROUP BY page HAVING max(clicks) >= $3)`,
      [domain.id, lastMonth, MIN_PEAK_CLICKS],
    ),
    query(
      `WITH a AS (SELECT id FROM audits WHERE domain_id = $1 AND status = 'completed' ORDER BY created_at DESC LIMIT 1)
       SELECT p.url, p.title, p.word_count, p.onpage_score, p.inlinks, p.status_code, p.noindex FROM audit_pages p JOIN a ON a.id = p.audit_id`,
      [domain.id],
    ),
  ]);
  const audit = new Map(auditPages.map((p) => [pageKey(p.url), p]));

  const firstMonth = rows.reduce((m, r) => (r.month < m ? r.month : m), lastMonth);
  const months = [];
  for (let m = firstMonth; m <= lastMonth; m = monthAdd(m, 1)) months.push(m);
  // Kısmi ayı tam aya ölçekle; son ayda 10 günden az veri varsa trend için güvenilmez, dışarıda bırak
  const usable = lastDays < 10 ? months.slice(0, -1) : months;
  if (usable.length < MIN_MONTHS) return { insufficient: true, months: usable.length, minMonths: MIN_MONTHS, rows: [] };
  const scale = (m) => (m === lastMonth ? daysInMonth(m) / lastDays : 1);

  const byPage = new Map();
  for (const r of rows) {
    if (!byPage.has(r.page)) byPage.set(r.page, new Map());
    byPage.get(r.page).set(r.month, r);
  }

  const result = [];
  for (const [page, map] of byPage) {
    const series = usable.map((m) => {
      const r = map.get(m);
      const k = scale(m);
      return {
        month: m, clicks: (r?.clicks || 0) * k, impressions: (r?.impressions || 0) * k,
        rawClicks: r?.clicks || 0, rawImpressions: r?.impressions || 0, position: r?.position || 0,
      };
    });
    const n = series.length;
    const recentPts = series.slice(n - 3);
    const priorPts = series.slice(n - 6, n - 3);
    // Zirve: son 3 ay hariç, en yüksek 3 aylık hareketli ortalama
    let peakIdx = -1;
    let peak3 = 0;
    for (let i = 0; i + 3 <= n - 3; i++) {
      const v = mean(series.slice(i, i + 3).map((p) => p.clicks));
      if (v > peak3) {
        peak3 = v;
        peakIdx = i;
      }
    }
    if (peak3 < MIN_PEAK_CLICKS) continue;
    const recent = windowStats(recentPts);
    const prior = windowStats(priorPts);
    const peak = windowStats(series.slice(peakIdx, peakIdx + 3));
    const drop = 1 - recent.clicks / peak3;
    const last6 = series.slice(n - 6).map((p) => p.clicks);
    const slope = relativeSlope(last6);
    const declines = last6.slice(1).filter((v, i) => v < last6[i] * 0.97).length;
    if (drop < 0.25 || recent.clicks > prior.clicks * 0.9 || slope > -0.04 || declines < 3) continue;

    // Neden tahmini
    const causes = [];
    const posDelta = recent.position !== null && peak.position !== null ? recent.position - peak.position : 0;
    const impDrop = peak.impressions ? 1 - recent.impressions / peak.impressions : 0;
    const ctrDrop = peak.ctr ? 1 - (recent.ctr ?? 0) / peak.ctr : 0;
    if (posDelta >= 1.5) causes.push('ranking');
    if (impDrop >= 0.3 && posDelta < 1.5) causes.push('demand');
    if (ctrDrop >= 0.3 && posDelta < 1.5) causes.push('ctr');
    if (!causes.length) causes.push('mixed');

    // Mevsimsellik: 12 ay önceki aynı dönem de benzer seviyedeyse düşüş muhtemelen mevsimsel
    let yoy = null;
    if (n >= 15) {
      const lastYear = mean(series.slice(n - 15, n - 12).map((p) => p.clicks));
      if (lastYear > 0) yoy = recent.clicks / lastYear - 1;
    }
    const seasonal = yoy !== null && yoy > -0.15;

    const declineStart = series[Math.min(n - 1, peakIdx + 2)].month;
    const a = audit.get(pageKey(page));
    result.push({
      page,
      title: a?.title || null,
      wordCount: a?.word_count ?? null,
      onpageScore: a?.onpage_score ?? null,
      inlinks: a?.inlinks ?? null,
      statusCode: a?.status_code ?? null,
      noindex: a?.noindex ?? null,
      stage: drop >= 0.7 ? 'severe' : drop >= 0.4 ? 'decaying' : 'early',
      drop: round1(drop * 100),
      lostClicks: Math.round(peak3 - recent.clicks),
      peakClicks: Math.round(peak3),
      recentClicks: Math.round(recent.clicks),
      peakMonth: series[peakIdx].month,
      declineStart,
      peakPosition: round1(peak.position),
      recentPosition: round1(recent.position),
      peakCtr: peak.ctr,
      recentCtr: recent.ctr,
      impressionDrop: round1(impDrop * 100),
      slope: round1(slope * 100),
      yoy: yoy === null ? null : round1(yoy * 100),
      seasonal,
      causes,
      series: series.map((p) => ({ month: p.month, clicks: Math.round(p.clicks), impressions: Math.round(p.impressions), position: round1(p.position) || null })),
    });
  }
  result.sort((x, y) => y.lostClicks - x.lostClicks);
  const top = result.slice(0, 100);

  // Düşüşün başladığı dönemde Google güncellemesi var mı?
  if (top.length) {
    const updates = await updatesBetween(usable[0], lastMonth.slice(0, 8) + String(daysInMonth(lastMonth)).padStart(2, '0'));
    for (const r of top) {
      const from = r.peakMonth;
      const to = monthAdd(r.declineStart, 1);
      r.updates = updates.filter((u) => u.kind === 'core' && u.start < to && (u.end || u.start) >= from).map((u) => u.name);
    }
  }

  return {
    insufficient: false,
    months: usable.length,
    range: { start: usable[0], end: usable.at(-1), partialDays: usable.at(-1) === lastMonth ? lastDays : null },
    summary: {
      decaying: result.length,
      lostClicks: result.reduce((s, r) => s + r.lostClicks, 0),
      severe: result.filter((r) => r.stage === 'severe').length,
      ranking: result.filter((r) => r.causes.includes('ranking')).length,
      seasonal: result.filter((r) => r.seasonal).length,
    },
    rows: top,
  };
}

/**
 * Bir sayfanın zirve dönemi ile son 3 ay arasında kaybettiği sorgular (canlı Search Console; erimenin nedenini gösterir).
 */
export async function decayPageQueries(domain, userId, { url, peakMonth }) {
  const { rows: [b] } = await query('SELECT max(date)::text AS e FROM gsc_daily WHERE domain_id = $1', [domain.id]);
  if (!b.e) return { rows: [] };
  const endDate = b.e;
  const recentStart = new Date(Date.parse(`${endDate}T00:00:00Z`) - 89 * 86_400_000).toISOString().slice(0, 10);
  const peakStart = peakMonth;
  const peakEnd = new Date(Date.parse(`${monthAdd(peakMonth, 3)}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const api = `${GSC_BASE}/sites/${encodeURIComponent(domain.gsc_property)}/searchAnalytics/query`;
  const body = (startDate, end) => ({
    startDate, endDate: end, dimensions: ['query'], rowLimit: 1000, dataState: 'all',
    dimensionFilterGroups: [{ filters: [{ dimension: 'page', operator: 'equals', expression: url }] }],
  });
  const [before, after] = await Promise.all([googleApi(userId, api, { method: 'POST', body: body(peakStart, peakEnd) }), googleApi(userId, api, { method: 'POST', body: body(recentStart, endDate) })]);
  const cur = new Map((after.rows || []).map((r) => [r.keys[0], r]));
  const days = (s, e) => (Date.parse(e) - Date.parse(s)) / 86_400_000 + 1;
  const k = days(recentStart, endDate) / days(peakStart, peakEnd); // dönem uzunluklarını eşitle
  const rows = (before.rows || []).map((p) => {
    const c = cur.get(p.keys[0]);
    const prevClicks = p.clicks * k;
    return {
      query: p.keys[0],
      prevClicks: Math.round(prevClicks),
      clicks: c?.clicks || 0,
      lost: Math.round(prevClicks - (c?.clicks || 0)),
      prevPosition: round1(p.position),
      position: c ? round1(c.position) : null,
      prevImpressions: Math.round(p.impressions * k),
      impressions: c?.impressions || 0,
    };
  }).filter((r) => r.lost > 0).sort((x, y) => y.lost - x.lost).slice(0, 30);
  return { periods: { peak: [peakStart, peakEnd], recent: [recentStart, endDate] }, rows };
}
