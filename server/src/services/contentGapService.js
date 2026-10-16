import { query } from '../db/pool.js';
import { phraseCount } from './audit/keywordExtractor.js';
import { normalizeUrl } from './audit/pageAnalyzer.js';

/**
 * İçerik boşlukları: sayfanın Search Console'da 4–20. sırada göründüğü (yeterli gösterimli) ama
 * title / H1 / meta açıklamasında geçmeyen sorgular. Bu sorguyu sayfada işlemek çoğu zaman en hızlı kazanımdır.
 */
const TARGET_CTR = 0.15; // ~3. sıra tıklama oranı
const key = (u) => {
  const n = normalizeUrl(u);
  return n ? n.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') : null;
};

export async function contentGaps(domain) {
  const [{ rows: pairs }, { rows: pages }] = await Promise.all([
    query(
      `SELECT query, page, clicks, impressions, round(position::numeric, 1)::float AS position
         FROM gsc_query_page WHERE domain_id = $1 AND position > 3 AND position <= 20 AND impressions >= 20
        ORDER BY impressions DESC LIMIT 3000`,
      [domain.id],
    ),
    query(
      `WITH a AS (SELECT id FROM audits WHERE domain_id = $1 AND status = 'completed' ORDER BY created_at DESC LIMIT 1)
       SELECT p.url, p.title, p.h1, p.meta_description, p.lang, p.word_count FROM audit_pages p JOIN a ON a.id = p.audit_id
        WHERE p.status_code = 200`,
      [domain.id],
    ),
  ]);
  if (!pairs.length) return { needsAudit: !pages.length, rows: [] };
  const byUrl = new Map(pages.map((p) => [key(p.url), p]));
  const brand = domain.hostname.replace(/^www\./, '').split('.')[0].replace(/-/g, '');

  const rows = [];
  for (const r of pairs) {
    const p = byUrl.get(key(r.page));
    if (!p) continue;
    if (brand.length >= 4 && r.query.replace(/[\s-]/g, '').toLowerCase().includes(brand)) continue;
    const inTitle = phraseCount(p.title || '', r.query, p.lang) > 0;
    const inH1 = phraseCount(p.h1 || '', r.query, p.lang) > 0;
    const inMeta = phraseCount(p.meta_description || '', r.query, p.lang) > 0;
    if (inTitle || inH1) continue;
    const potential = Math.max(0, Math.round(r.impressions * TARGET_CTR - r.clicks));
    rows.push({ ...r, title: p.title, h1: p.h1, wordCount: p.word_count, inTitle, inH1, inMeta, potential });
  }
  rows.sort((a, b) => b.potential - a.potential);
  return { needsAudit: !pages.length, rows: rows.slice(0, 60) };
}
