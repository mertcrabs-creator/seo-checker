import { query } from '../../db/pool.js';
import { phraseCount, slugify } from '../audit/keywordExtractor.js';
import { normalizeUrl } from '../audit/pageAnalyzer.js';
import { featuresByKeyword } from './serpTrackingService.js';

/**
 * CTR anomalisi: pozisyonuna göre beklenen tıklama oranının belirgin ve istatistiksel olarak anlamlı
 * biçimde altında kalan sorgu/sayfalar. Beklenen eğri sitenin kendi (marka dışı) verisinden öğrenilir,
 * az veri olan pozisyonlarda sektör ortalamasıyla harmanlanır. Sayfa için olası nedenler taramadan çıkarılır.
 */

// Pozisyon 1..20 için sektör ortalaması (masaüstü+mobil karışık, marka dışı yaklaşık değerler)
const INDUSTRY = [0.28, 0.15, 0.1, 0.07, 0.05, 0.04, 0.03, 0.025, 0.02, 0.018, 0.012, 0.01, 0.009, 0.008, 0.007, 0.006, 0.005, 0.005, 0.004, 0.004];
const MAX_POS = 15;
const pageKey = (u) => {
  const n = normalizeUrl(u);
  return n ? n.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') : u;
};

function learnCurve(rows) {
  const buckets = INDUSTRY.map(() => ({ clicks: 0, impressions: 0 }));
  for (const r of rows) {
    const i = Math.min(20, Math.max(1, Math.round(r.position))) - 1;
    buckets[i].clicks += r.clicks;
    buckets[i].impressions += r.impressions;
  }
  // Site sektörden sistematik olarak farklıysa (ör. AI Overview, marka gücü) az örnekli pozisyonlarda
  // sektör eğrisi sitenin genel oranıyla ölçeklenir; anomali "sitenin kendi normuna göre" değerlendirilir
  let num = 0;
  let den = 0;
  buckets.forEach((b, i) => {
    if (b.impressions >= 300) {
      num += b.clicks;
      den += b.impressions * INDUSTRY[i];
    }
  });
  const ratio = den ? Math.min(2, Math.max(0.05, num / den)) : 1;
  const curve = buckets.map((b, i) => {
    const site = b.impressions >= 300 ? b.clicks / b.impressions : null;
    const fallback = INDUSTRY[i] * ratio;
    const w = site === null ? 0 : Math.min(1, b.impressions / 2000);
    return { position: i + 1, impressions: b.impressions, site, industry: INDUSTRY[i], expected: w * (site ?? 0) + (1 - w) * fallback };
  });
  // Beklenen TO pozisyon arttıkça artamaz: ağırlıklı izotonik regresyon (komşu ihlalleri havuzla).
  // Tek bir gürültülü pozisyon (ör. 1. sırada anormal düşük TO) tüm eğriyi aşağı çekmez, komşularıyla ortalanır.
  const blocks = [];
  for (const c of curve) {
    blocks.push({ value: c.expected, weight: Math.max(300, c.impressions), size: 1 });
    while (blocks.length > 1 && blocks.at(-2).value < blocks.at(-1).value) {
      const b = blocks.pop();
      const a = blocks.pop();
      const weight = a.weight + b.weight;
      blocks.push({ value: (a.value * a.weight + b.value * b.weight) / weight, weight, size: a.size + b.size });
    }
  }
  let i = 0;
  for (const b of blocks) for (let k = 0; k < b.size; k++) curve[i++].expected = b.value;
  return Object.assign(curve, { ratio });
}

/** Ondalıklı pozisyon için komşu pozisyonlar arasında doğrusal ara değer. */
function expectedAt(curve, pos) {
  const p = Math.min(20, Math.max(1, pos));
  const lo = Math.floor(p);
  const hi = Math.min(20, lo + 1);
  const t = p - lo;
  return curve[lo - 1].expected * (1 - t) + curve[hi - 1].expected * t;
}

const zScore = (clicks, imp, exp) => (clicks - imp * exp) / Math.sqrt(Math.max(1e-9, imp * exp * (1 - exp)));

export async function ctrAnomalies(domain) {
  const [{ rows }, { rows: pages }, { rows: issues }] = await Promise.all([
    query(
      `SELECT query, page, clicks, impressions, position FROM gsc_query_page
        WHERE domain_id = $1 AND impressions >= 10 AND position <= 20`,
      [domain.id],
    ),
    query(
      `WITH a AS (SELECT id FROM audits WHERE domain_id = $1 AND status = 'completed' ORDER BY created_at DESC LIMIT 1)
       SELECT p.url, p.title, p.meta_description, p.h1, p.lang, p.schema_types, p.depth FROM audit_pages p JOIN a ON a.id = p.audit_id
        WHERE p.status_code = 200`,
      [domain.id],
    ),
    query(
      `WITH a AS (SELECT id FROM audits WHERE domain_id = $1 AND status = 'completed' ORDER BY created_at DESC LIMIT 1)
       SELECT DISTINCT i.url, i.code FROM audit_issues i JOIN a ON a.id = i.audit_id
        WHERE i.code IN ('title_duplicate', 'meta_desc_duplicate')`,
      [domain.id],
    ),
  ]);
  if (!rows.length) return { empty: true, curve: [], pages: [], queries: [] };
  const serp = await featuresByKeyword(domain.id);

  const brand = domain.hostname.replace(/^www\./, '').split('.')[0].replace(/-/g, '');
  const isBrand = (q) => brand.length >= 4 && slugify(q).replace(/-/g, '').includes(brand);
  const nonBrand = rows.filter((r) => !isBrand(r.query));
  const curve = learnCurve(nonBrand);

  // ------------------------------------------------ Sorgu düzeyi
  const scored = nonBrand
    .filter((r) => r.position <= MAX_POS)
    .map((r) => {
      const exp = expectedAt(curve, r.position);
      const ctr = r.clicks / r.impressions;
      return { ...r, ctr, expectedCtr: exp, expectedClicks: r.impressions * exp, z: zScore(r.clicks, r.impressions, exp) };
    });
  const queries = scored
    .filter((r) => r.impressions >= 50 && r.ctr < r.expectedCtr * 0.6 && r.z <= -2)
    .map((r) => ({ ...r, missedClicks: Math.round(r.expectedClicks - r.clicks), position: Math.round(r.position * 10) / 10 }))
    .sort((a, b) => b.missedClicks - a.missedClicks)
    .slice(0, 150);

  // ------------------------------------------------ Sayfa düzeyi (sorguların toplamı)
  const byPage = new Map();
  for (const r of scored) {
    const g = byPage.get(r.page) || { page: r.page, clicks: 0, impressions: 0, expectedClicks: 0, variance: 0, posW: 0, queries: [] };
    g.clicks += r.clicks;
    g.impressions += r.impressions;
    g.expectedClicks += r.expectedClicks;
    g.variance += r.impressions * r.expectedCtr * (1 - r.expectedCtr);
    g.posW += r.position * r.impressions;
    g.queries.push(r);
    byPage.set(r.page, g);
  }
  const audit = new Map(pages.map((p) => [pageKey(p.url), p]));
  const dup = new Map();
  for (const i of issues) dup.set(`${pageKey(i.url)}|${i.code}`, true);

  const pageRows = [...byPage.values()]
    .map((g) => ({ ...g, ratio: g.expectedClicks ? g.clicks / g.expectedClicks : 1, z: (g.clicks - g.expectedClicks) / Math.sqrt(Math.max(1e-9, g.variance)) }))
    .filter((g) => g.expectedClicks >= 5 && g.ratio < 0.6 && g.z <= -2.5)
    .sort((a, b) => (b.expectedClicks - b.clicks) - (a.expectedClicks - a.clicks))
    .slice(0, 60)
    .map((g) => {
      const top = g.queries.sort((a, b) => b.impressions - a.impressions);
      const mainQuery = top[0];
      const position = g.posW / g.impressions;
      const a = audit.get(pageKey(g.page));
      const key = pageKey(g.page);
      const reasons = [];
      if (!a) reasons.push('not_crawled');
      else {
        const lang = a.lang;
        const title = a.title || '';
        if (!title) reasons.push('title_missing');
        else if (title.length > 60) reasons.push('title_long');
        else if (title.length < 30) reasons.push('title_short');
        if (title && mainQuery && phraseCount(title, mainQuery.query, lang) === 0) reasons.push('query_not_in_title');
        if (!a.meta_description) reasons.push('meta_missing');
        else if (a.meta_description.length > 160) reasons.push('meta_long');
        else if (mainQuery && phraseCount(a.meta_description, mainQuery.query, lang) === 0) reasons.push('query_not_in_meta');
        if (dup.has(`${key}|title_duplicate`)) reasons.push('title_duplicate');
        if (dup.has(`${key}|meta_desc_duplicate`)) reasons.push('meta_duplicate');
        if (!a.schema_types?.length) reasons.push('no_schema');
        if (a.depth === 0 && mainQuery && !isBrand(mainQuery.query)) reasons.push('homepage_generic');
      }
      // SERP takibi varsa tahmin yerine gerçek sonuç sayfası özellikleri
      const snaps = top.slice(0, 5).map((q) => serp.get(q.query)).filter(Boolean);
      if (snaps.length) {
        if (snaps.some((s) => s.features?.aiOverview && !s.features.aiOverview.cited)) reasons.push('ai_overview');
        if (snaps.some((s) => s.features?.featuredSnippet && !s.features.featuredSnippet.own)) reasons.push('snippet_other');
        if (snaps.some((s) => s.features?.ads >= 3)) reasons.push('ads_heavy');
        if (snaps.some((s) => s.features?.localPack)) reasons.push('local_pack');
      } else if (position <= 3) reasons.push('serp_features');
      return {
        page: g.page,
        title: a?.title || null,
        metaDescription: a?.meta_description || null,
        clicks: g.clicks,
        impressions: g.impressions,
        position: Math.round(position * 10) / 10,
        ctr: g.clicks / g.impressions,
        expectedCtr: g.expectedClicks / g.impressions,
        missedClicks: Math.round(g.expectedClicks - g.clicks),
        reasons,
        topQueries: top.slice(0, 5).map((q) => ({ query: q.query, impressions: q.impressions, clicks: q.clicks, position: Math.round(q.position * 10) / 10, ctr: q.ctr, expectedCtr: q.expectedCtr })),
      };
    });

  return {
    empty: false,
    curve: curve.map((c) => ({ ...c, siteSample: c.impressions >= 300 })),
    summary: {
      missedClicks: pageRows.reduce((s, p) => s + p.missedClicks, 0),
      pages: pageRows.length,
      queries: queries.length,
      industryRatio: curve.ratio,
      siteCtr: nonBrand.reduce((s, r) => s + r.clicks, 0) / Math.max(1, nonBrand.reduce((s, r) => s + r.impressions, 0)),
    },
    pages: pageRows,
    queries: queries.map(({ z, expectedClicks, ...r }) => ({ ...r, serp: serp.get(r.query)?.features || null })),
  };
}
