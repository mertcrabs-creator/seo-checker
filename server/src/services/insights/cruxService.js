import { config } from '../../config.js';
import { query } from '../../db/pool.js';

/**
 * CrUX History API: gerçek Chrome kullanıcılarından 25 haftalık (28 günlük kayan pencere) Core Web Vitals p75 değerleri.
 * Herkese açık veridir; rakip kökenleri için de çalışır. Sonuçlar köken + cihaz başına 24 saat önbelleğe alınır.
 */

const API = 'https://chromeuxreport.googleapis.com/v1/records:queryHistoryRecord';
const CACHE_MS = 24 * 3_600_000;
export const CRUX_METRICS = {
  lcp: 'largest_contentful_paint',
  inp: 'interaction_to_next_paint',
  cls: 'cumulative_layout_shift',
  fcp: 'first_contentful_paint',
  ttfb: 'experimental_time_to_first_byte',
};
/** "İyi" / "Zayıf" eşikleri (web.dev) */
export const THRESHOLDS = { lcp: [2500, 4000], inp: [200, 500], cls: [0.1, 0.25], fcp: [1800, 3000], ttfb: [800, 1800] };
const FORM_FACTORS = ['PHONE', 'DESKTOP'];

const ymd = (d) => (d ? `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}` : null);
const num = (v) => (v === null || v === undefined || v === 'NaN' ? null : Number(v));
export const rating = (metric, v) => (v === null ? null : v <= THRESHOLDS[metric][0] ? 'good' : v <= THRESHOLDS[metric][1] ? 'ni' : 'poor');

function parse(record) {
  const periods = record.collectionPeriods || [];
  const series = periods.map((p, i) => {
    const row = { start: ymd(p.firstDate), date: ymd(p.lastDate) };
    for (const [k, id] of Object.entries(CRUX_METRICS)) {
      const m = record.metrics?.[id];
      row[k] = num(m?.percentilesTimeseries?.p75s?.[i]);
      // "iyi" deneyim yaşayan kullanıcı oranı (histogramın ilk dilimi)
      const good = m?.histogramTimeseries?.[0]?.densities?.[i];
      row[`${k}Good`] = good === undefined || good === 'NaN' ? null : Number(good);
    }
    return row;
  });
  return { series };
}

async function fetchRecord(origin, formFactor) {
  const res = await fetch(`${API}?key=${encodeURIComponent(config.cruxKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ origin, formFactor, metrics: Object.values(CRUX_METRICS) }),
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) return { data: null, error: 'no_data' }; // köken CrUX'a girecek kadar trafik almıyor
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error?.message || `HTTP ${res.status}`;
    // Anahtar/izin hataları önbelleğe yazılmaz (düzeltilince hemen çalışsın)
    const err = new Error(/API_KEY|PERMISSION|disabled|not been used/i.test(msg) ? 'CrUX API anahtarı geçersiz veya projede "Chrome UX Report API" etkin değil' : msg);
    err.transient = true;
    throw err;
  }
  return { data: parse(body.record || {}), error: null };
}

/** Köken + cihaz için geçmiş (önbellekli). */
export async function cruxHistory(origin, formFactor) {
  const { rows: [cached] } = await query('SELECT data, error, fetched_at FROM crux_history WHERE origin = $1 AND form_factor = $2', [origin, formFactor]);
  if (cached && Date.now() - new Date(cached.fetched_at).getTime() < CACHE_MS) return { data: cached.data, error: cached.error };
  const r = await fetchRecord(origin, formFactor);
  await query(
    `INSERT INTO crux_history (origin, form_factor, data, error, fetched_at) VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (origin, form_factor) DO UPDATE SET data = EXCLUDED.data, error = EXCLUDED.error, fetched_at = now()`,
    [origin, formFactor, r.data ? JSON.stringify(r.data) : null, r.error],
  );
  return r;
}

export const originOf = (hostname, finalUrl) => {
  try {
    return new URL(finalUrl || `https://${hostname}/`).origin;
  } catch {
    return `https://${hostname}`;
  }
};

function summarize(series) {
  const valid = series.filter((s) => s.lcp !== null || s.inp !== null || s.cls !== null);
  if (!valid.length) return null;
  const last = valid.at(-1);
  const ref = valid[Math.max(0, valid.length - 9)]; // ~2 ay önce
  const out = {};
  for (const k of Object.keys(CRUX_METRICS)) {
    out[k] = { p75: last[k], rating: rating(k, last[k]), good: last[`${k}Good`], change: last[k] !== null && ref[k] ? (last[k] - ref[k]) / ref[k] : null };
  }
  // Core Web Vitals değerlendirmesi: LCP, INP ve CLS'nin üçü de "iyi" ise geçer
  const core = ['lcp', 'inp', 'cls'].map((k) => out[k].rating).filter(Boolean);
  out.passes = core.length === 3 ? core.every((r) => r === 'good') : null;
  out.date = last.date;
  return out;
}

/** Alan adı için mobil + masaüstü geçmiş, özet ve aynı dönemlerin Search Console tıklamaları. */
export async function domainCrux(domain) {
  if (!config.cruxKey) return { disabled: true };
  const { rows: [a] } = await query(
    `SELECT site_info->>'finalUrl' AS final FROM audits WHERE domain_id = $1 AND status = 'completed' ORDER BY created_at DESC LIMIT 1`,
    [domain.id],
  );
  const origin = originOf(domain.hostname, a?.final);
  const result = { origin, devices: {} };
  for (const ff of FORM_FACTORS) {
    const r = await cruxHistory(origin, ff);
    result.devices[ff.toLowerCase()] = r.data ? { series: r.data.series, summary: summarize(r.data.series) } : { error: r.error };
  }
  // Hız değişimi ile trafiği yan yana görmek için: her 28 günlük CrUX penceresindeki tıklamalar
  const ref = result.devices.phone?.series || result.devices.desktop?.series || [];
  if (ref.length && domain.gsc_property) {
    const { rows } = await query(
      `SELECT p.date, (SELECT SUM(clicks)::int FROM gsc_daily g WHERE g.domain_id = $1 AND g.date BETWEEN p.start::date AND p.date::date) AS clicks,
              (SELECT count(*)::int FROM gsc_daily g WHERE g.domain_id = $1 AND g.date BETWEEN p.start::date AND p.date::date) AS days
         FROM unnest($2::text[], $3::text[]) AS p(start, date)`,
      [domain.id, ref.map((s) => s.start), ref.map((s) => s.date)],
    );
    // Pencerenin tamamı için veri yoksa (GSC günlük verisi 90 gün) gösterme
    result.clicks = rows.map((r) => ({ date: r.date, clicks: r.days >= 26 ? r.clicks : null }));
  }
  return result;
}

/** Birden çok köken için son mobil değerler (rakip karşılaştırması). */
export async function latestForOrigins(origins) {
  if (!config.cruxKey) return null;
  const out = {};
  for (const o of origins) {
    try {
      const r = await cruxHistory(o, 'PHONE');
      out[o] = r.data ? summarize(r.data.series) : null;
    } catch {
      out[o] = null;
    }
  }
  return out;
}
