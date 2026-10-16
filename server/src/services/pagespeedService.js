import { config } from '../config.js';
import { query } from '../db/pool.js';

const PSI_URL = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];

const METRIC_AUDITS = {
  fcp: 'first-contentful-paint',
  lcp: 'largest-contentful-paint',
  tbt: 'total-blocking-time',
  cls: 'cumulative-layout-shift',
  si: 'speed-index',
  tti: 'interactive',
  ttfb: 'server-response-time',
};

const FIELD_METRICS = {
  lcp: 'LARGEST_CONTENTFUL_PAINT_MS',
  inp: 'INTERACTION_TO_NEXT_PAINT',
  cls: 'CUMULATIVE_LAYOUT_SHIFT_SCORE',
  fcp: 'FIRST_CONTENTFUL_PAINT_MS',
  ttfb: 'EXPERIMENTAL_TIME_TO_FIRST_BYTE',
};

// Lighthouse açıklamalarındaki "[metin](link)" yapısını düz metne indirger
const plain = (s = '') => String(s).replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').slice(0, 1000);
const score100 = (s) => (typeof s === 'number' ? Math.round(s * 100) : null);

function parse(data) {
  const lh = data.lighthouseResult || {};
  const cats = lh.categories || {};
  const audits = lh.audits || {};

  const metrics = {};
  for (const [key, id] of Object.entries(METRIC_AUDITS)) {
    const a = audits[id];
    if (a) metrics[key] = { value: a.numericValue ?? null, display: a.displayValue || null, score: score100(a.score) };
  }

  let field = null;
  const le = data.loadingExperience;
  if (le?.metrics && Object.keys(le.metrics).length) {
    field = { overall: le.overall_category || null, metrics: {} };
    for (const [key, id] of Object.entries(FIELD_METRICS)) {
      const m = le.metrics[id];
      if (m) field.metrics[key] = { p75: m.percentile, category: m.category };
    }
  }

  const perfRefs = new Set((cats.performance?.auditRefs || []).map((r) => r.id));
  const opportunities = [];
  const diagnostics = [];
  for (const [id, a] of Object.entries(audits)) {
    if (a.score === null || a.score === undefined || a.score >= 0.9) continue;
    if (a.scoreDisplayMode === 'notApplicable' || a.scoreDisplayMode === 'informative' || a.scoreDisplayMode === 'manual') continue;
    const item = {
      id,
      title: plain(a.title),
      description: plain(a.description),
      displayValue: a.displayValue || null,
      score: score100(a.score),
      savingsMs: Math.round(a.details?.overallSavingsMs || a.metricSavings?.LCP || 0),
      savingsBytes: Math.round(a.details?.overallSavingsBytes || 0),
    };
    if (item.savingsMs > 0 || a.details?.type === 'opportunity') opportunities.push(item);
    else if (perfRefs.has(id)) diagnostics.push(item);
  }
  opportunities.sort((a, b) => b.savingsMs - a.savingsMs);
  diagnostics.sort((a, b) => a.score - b.score);

  return {
    performance: score100(cats.performance?.score),
    accessibility: score100(cats.accessibility?.score),
    best_practices: score100(cats['best-practices']?.score),
    seo: score100(cats.seo?.score),
    metrics,
    field,
    opportunities: opportunities.slice(0, 25),
    diagnostics: diagnostics.slice(0, 25),
  };
}

export async function createReport(domainId, url, strategy) {
  const { rows } = await query(
    "INSERT INTO pagespeed_reports (domain_id, url, strategy) VALUES ($1, $2, $3) RETURNING id",
    [domainId, url, strategy],
  );
  return rows[0].id;
}

export async function runReport(reportId, url, strategy) {
  try {
    const params = new URLSearchParams({ url, strategy, locale: 'tr' });
    CATEGORIES.forEach((c) => params.append('category', c));
    if (config.pagespeedApiKey) params.set('key', config.pagespeedApiKey);

    const res = await fetch(`${PSI_URL}?${params}`, { signal: AbortSignal.timeout(120_000) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message || `PageSpeed API hatası (${res.status})`);

    const r = parse(data);
    await query(
      `UPDATE pagespeed_reports SET status = 'completed', performance = $2, accessibility = $3, best_practices = $4,
         seo = $5, metrics = $6, field_data = $7, opportunities = $8, diagnostics = $9 WHERE id = $1`,
      [reportId, r.performance, r.accessibility, r.best_practices, r.seo,
        JSON.stringify(r.metrics), r.field ? JSON.stringify(r.field) : null,
        JSON.stringify(r.opportunities), JSON.stringify(r.diagnostics)],
    );
  } catch (err) {
    await query("UPDATE pagespeed_reports SET status = 'failed', error = $2 WHERE id = $1", [reportId, String(err.message).slice(0, 500)]);
    throw err;
  }
}
