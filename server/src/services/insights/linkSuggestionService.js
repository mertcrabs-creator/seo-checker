import { query } from '../../db/pool.js';
import { slugify } from '../audit/keywordExtractor.js';
import { normalizeUrl } from '../audit/pageAnalyzer.js';

/**
 * İç link önerileri: desteğe ihtiyacı olan hedef sayfalar (az iç bağlantı, vuruş mesafesindeki sıralama,
 * yetim) için, konusu örtüşen ama henüz bağlantı vermeyen kaynak sayfalar ve önerilen anchor metni.
 * Konu örtüşmesi taramadaki sayfa anahtar kelimelerinden; anchor Search Console'daki en çok gösterim alan
 * sorgudan (yoksa sayfanın ana kelimesinden) gelir. Kaynakların otoritesi aldığı iç bağlantı sayısıyla ölçülür.
 */

const MAX_TARGETS = 60;
const PER_TARGET = 6;
const GENERIC_ANCHOR = /^(tıkla(yın|yınız)?|buraya tıkla(yın)?|devamı(nı oku)?|devamını oku|daha fazla|detay(lar|lı bilgi)?|incele|hemen incele|oku|tümünü gör|keşfet|click here|here|read more|more|learn more|details|view|see more|link|buraya|bu sayfa)$/i;
const pageKey = (u) => {
  const n = normalizeUrl(u);
  return n ? n.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') : u;
};

export async function linkSuggestions(domain) {
  const { rows: [audit] } = await query(
    `SELECT id, site_info FROM audits WHERE domain_id = $1 AND status = 'completed' ORDER BY created_at DESC LIMIT 1`,
    [domain.id],
  );
  if (!audit) return { needsAudit: true, targets: [] };
  const { rows: [edgeCount] } = await query('SELECT count(*)::int AS n FROM audit_links WHERE audit_id = $1', [audit.id]);
  if (!edgeCount.n) return { needsRecrawl: true, targets: [] };

  const template = new Set(audit.site_info?.templateTerms || []);
  const [{ rows: pages }, { rows: keywords }, { rows: edges }, { rows: gsc }] = await Promise.all([
    query(
      `SELECT url, title, primary_keyword, inlinks, depth, word_count, lower(split_part(lang, '-', 1)) AS lang FROM audit_pages
        WHERE audit_id = $1 AND status_code = 200 AND NOT noindex AND (canonical IS NULL OR canonical = url)`,
      [audit.id],
    ),
    query('SELECT url, keyword, score, count, in_title, in_h1 FROM audit_keywords WHERE audit_id = $1', [audit.id]),
    query('SELECT source_url, target_url, anchor FROM audit_links WHERE audit_id = $1', [audit.id]),
    domain.gsc_property
      ? query(
        `SELECT page, query, impressions, position FROM (
           SELECT page, query, impressions, position, row_number() OVER (PARTITION BY page ORDER BY impressions DESC) AS rn
             FROM gsc_query_page WHERE domain_id = $1) x
          WHERE rn <= 5 ORDER BY page, impressions DESC`,
        [domain.id],
      )
      : { rows: [] },
  ]);
  // Marka terimleri anchor olarak değer taşımaz ("hairneva" -> her sayfada geçer)
  const brand = slugify(domain.hostname.replace(/^www\./, '').split('.')[0]).replace(/-/g, '');
  const isBrand = (q) => brand.length >= 4 && slugify(q).replace(/-/g, '').includes(brand);
  if (pages.length < 3) return { targets: [], summary: { targets: 0, suggestions: 0 } };

  const kwByUrl = new Map();
  for (const k of keywords) {
    if (template.has(k.keyword) || isBrand(k.keyword)) continue;
    if (!kwByUrl.has(k.url)) kwByUrl.set(k.url, new Map());
    kwByUrl.get(k.url).set(k.keyword, k);
  }
  const linked = new Set(edges.map((e) => `${e.source_url}\n${e.target_url}`));
  const anchorsTo = new Map();
  for (const e of edges) {
    if (!anchorsTo.has(e.target_url)) anchorsTo.set(e.target_url, []);
    if (e.anchor) anchorsTo.get(e.target_url).push(e.anchor);
  }
  // Sayfa başına en çok gösterim alan marka dışı sorgu (anchor önerisi) ve sayfanın sıralama verisi
  const gscByKey = new Map();
  for (const g of gsc) {
    const key = pageKey(g.page);
    const cur = gscByKey.get(key);
    if (!cur) gscByKey.set(key, { ...g, query: isBrand(g.query) ? null : g.query });
    else if (!cur.query && !isBrand(g.query)) cur.query = g.query;
  }

  // ------------------------------------------------ Hedef önceliği
  const targets = pages
    .filter((p) => p.depth !== 0)
    .map((p) => {
      const g = gscByKey.get(pageKey(p.url));
      const striking = g && g.position > 3 && g.position <= 20 && g.impressions >= 20;
      const priority = 3 / (1 + p.inlinks) + (striking ? 2 + Math.log10(g.impressions) : 0) + (p.inlinks === 0 ? 1.5 : 0);
      return { ...p, gsc: g || null, striking, priority };
    })
    .filter((p) => p.inlinks <= 5 || p.striking)
    .sort((a, b) => b.priority - a.priority)
    .slice(0, MAX_TARGETS);

  const result = [];
  for (const t of targets) {
    const tk = kwByUrl.get(t.url) || new Map();
    // Hedefin konusu: title/H1'de geçen kelimeler + ana kelime + GSC sorgusu
    const terms = [...tk.values()].filter((k) => k.in_title || k.in_h1).sort((a, b) => b.score - a.score).slice(0, 6).map((k) => k.keyword);
    if (t.primary_keyword && !terms.includes(t.primary_keyword) && !template.has(t.primary_keyword) && !isBrand(t.primary_keyword)) terms.unshift(t.primary_keyword);
    const anchor = t.gsc?.query || (t.primary_keyword && !isBrand(t.primary_keyword) ? t.primary_keyword : null) || terms[0] || null;
    if (!terms.length && !anchor) continue;
    const anchorKey = anchor?.toLowerCase();

    const candidates = [];
    for (const s of pages) {
      if (s.url === t.url || linked.has(`${s.url}\n${t.url}`)) continue;
      if (t.lang && s.lang && t.lang !== s.lang) continue; // çok dilli sitelerde dil dışı öneri verme
      const sk = kwByUrl.get(s.url);
      if (!sk) continue;
      let relevance = 0;
      const shared = [];
      for (const term of terms) {
        const k = sk.get(term);
        if (!k) continue;
        relevance += Math.min(20, k.score) * (term === anchorKey ? 2 : 1);
        shared.push(term);
      }
      const mention = anchorKey ? sk.get(anchorKey) : null;
      if (mention && !shared.includes(anchorKey)) {
        relevance += Math.min(20, mention.score) * 2;
        shared.push(anchorKey);
      }
      // Tek bir genel ortak kelime ("istanbul") konu yakınlığı için yetmez
      if (relevance <= 0 || (shared.length < 2 && !shared.includes(anchorKey))) continue;
      candidates.push({
        source: s.url,
        sourceTitle: s.title,
        sourceInlinks: s.inlinks,
        sharedTerms: shared.slice(0, 5),
        // Anchor ifadesi kaynak metinde zaten geçiyor: yeni cümle yazmadan mevcut ifadeyi bağlantıya çevirmek yeterli
        mentionsAnchor: Boolean(mention && mention.count > 0),
        score: relevance * (1 + Math.log2(1 + s.inlinks) / 3) * (s.depth >= 0 && s.depth <= 2 ? 1.2 : 1),
      });
    }
    if (!candidates.length) continue;
    candidates.sort((a, b) => b.score - a.score);
    const anchors = anchorsTo.get(t.url) || [];
    result.push({
      url: t.url,
      title: t.title,
      inlinks: t.inlinks,
      wordCount: t.word_count,
      position: t.gsc ? Math.round(t.gsc.position * 10) / 10 : null,
      impressions: t.gsc?.impressions ?? null,
      striking: Boolean(t.striking),
      anchor,
      existingAnchors: [...new Set(anchors)].slice(0, 6),
      genericAnchors: anchors.filter((a) => GENERIC_ANCHOR.test(a.trim())).length,
      suggestions: candidates.slice(0, PER_TARGET).map(({ score, ...c }) => c),
    });
  }

  // Genel anchor sağlığı: jenerik anchor ("tıklayın", "devamı") kullanan bağlantılar
  const generic = edges.filter((e) => e.anchor && GENERIC_ANCHOR.test(e.anchor.trim()));
  return {
    summary: {
      targets: result.length,
      suggestions: result.reduce((s, r) => s + r.suggestions.length, 0),
      orphans: result.filter((r) => r.inlinks === 0).length,
      striking: result.filter((r) => r.striking).length,
      genericAnchors: generic.length,
      edges: edges.length,
    },
    genericSamples: [...new Map(generic.map((e) => [e.anchor.toLowerCase(), e])).values()].slice(0, 10).map((e) => ({ anchor: e.anchor, source: e.source_url, target: e.target_url })),
    targets: result,
  };
}
