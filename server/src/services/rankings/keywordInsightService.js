import { query } from '../../db/pool.js';
import { badRequest } from '../../utils/httpError.js';
import { GSC_BASE, googleApi } from '../googleService.js';
import { anyIso2, countryLanguages } from './countryLanguages.js';
import { targetLanguages } from './gscRankingService.js';
import { liveRank } from './serpapi.js';

/**
 * Tek bir kelimenin ülke bazında en doğru sırası:
 *  - Search Console'dan canlı: 28 gün ortalaması, son 7 gün, mobil/masaüstü ayrı (cihazlar arası fark büyük olabilir)
 *  - Gösterim sayısına göre güven seviyesi (az gösterimde ortalama yanıltıcıdır)
 *  - İsteğe bağlı canlı Google sonucu (SerpApi) ile doğrulama
 */

const isoDate = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86_400_000);
const round1 = (v) => (v === null || v === undefined ? null : Math.round(v * 10) / 10);

export function confidence(impressions) {
  if (impressions >= 100) return 'high';
  if (impressions >= 20) return 'medium';
  return 'low';
}

async function gscQuery(userId, property, body) {
  const data = await googleApi(userId, `${GSC_BASE}/sites/${encodeURIComponent(property)}/searchAnalytics/query`, {
    method: 'POST',
    body: { ...body, rowLimit: 1000, dataState: 'all' },
  });
  return data.rows || [];
}

export async function liveInsight(domain, userId, keyword) {
  if (!domain.gsc_property) throw badRequest('Bu alan adı için Search Console mülkü seçilmedi');
  const end = addDays(new Date(), -1);
  const filter = { dimensionFilterGroups: [{ filters: [{ dimension: 'query', operator: 'equals', expression: keyword }] }] };
  const [byDevice, last7] = await Promise.all([
    gscQuery(userId, domain.gsc_property, {
      ...filter, startDate: isoDate(addDays(end, -27)), endDate: isoDate(end), dimensions: ['country', 'device'],
    }),
    gscQuery(userId, domain.gsc_property, {
      ...filter, startDate: isoDate(addDays(end, -6)), endDate: isoDate(end), dimensions: ['country'],
    }),
  ]);

  const countries = new Map();
  const get = (c) => {
    const key = c.toUpperCase();
    if (!countries.has(key)) countries.set(key, { country: key, iso2: anyIso2(key), clicks: 0, impressions: 0, posSum: 0, devices: {}, last7: null });
    return countries.get(key);
  };
  for (const r of byDevice) {
    const c = get(r.keys[0]);
    c.clicks += r.clicks;
    c.impressions += r.impressions;
    c.posSum += r.position * r.impressions;
    c.devices[r.keys[1].toLowerCase()] = { position: round1(r.position), impressions: r.impressions, clicks: r.clicks };
  }
  for (const r of last7) get(r.keys[0]).last7 = { position: round1(r.position), impressions: r.impressions, clicks: r.clicks };

  return [...countries.values()]
    .map(({ posSum, ...c }) => ({
      ...c,
      position: c.impressions ? round1(posSum / c.impressions) : null,
      confidence: confidence(c.impressions),
    }))
    .sort((a, b) => b.impressions - a.impressions);
}

/** Ülkedeki kullanıcıların arama dili: site dili o ülkede konuşuluyorsa o, değilse ülkenin ana dili. */
export async function searchLanguage(domain, country) {
  const spoken = countryLanguages(country);
  const { languages } = await targetLanguages(domain);
  return languages.find((l) => spoken.includes(l)) || spoken[0] || languages[0] || 'en';
}

export async function serpCheck(domain, { keyword, country, device }) {
  const iso2 = anyIso2(country);
  if (!iso2) throw badRequest('Bu ülke için canlı doğrulama yapılamıyor');
  const hl = await searchLanguage(domain, country);
  const r = await liveRank({ keyword, gl: iso2.toLowerCase(), hl, device, hostname: domain.hostname });
  const { rows } = await query(
    `INSERT INTO serp_checks (domain_id, keyword, country, device, position, url, corrected_query, depth, top)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, checked_at`,
    [domain.id, keyword, country, device, r.position, r.url, r.correctedQuery, r.depth, JSON.stringify(r.top)],
  );
  return { ...r, keyword, country, device, language: hl, checked_at: rows[0].checked_at };
}

/** Kelime için ülke+cihaz başına en son canlı doğrulamalar (son 30 gün). */
export async function serpChecks(domain, keyword) {
  const { rows } = await query(
    `SELECT DISTINCT ON (country, device) country, device, position, url, corrected_query, depth, top, checked_at
       FROM serp_checks WHERE domain_id = $1 AND keyword = $2 AND checked_at > now() - interval '30 days'
      ORDER BY country, device, checked_at DESC`,
    [domain.id, keyword],
  );
  return rows;
}
