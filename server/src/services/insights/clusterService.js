import { query } from '../../db/pool.js';
import { lowerFor, slugify, STOPWORDS } from '../audit/keywordExtractor.js';
import { normalizeUrl } from '../audit/pageAnalyzer.js';

/**
 * Anahtar kelime kümeleme. Benzerlik = kök (stem) kümelerinin Jaccard benzerliği + aynı sayfada
 * sıralanma bonusu (Google'ın aynı sayfayı göstermesi niyetin aynı olduğuna güçlü işarettir).
 * Lider tabanlı kümeleme: gösterime göre sıralı her sorgu en benzer lidere katılır, yoksa yeni küme açar
 * (zincirleme ile dev kümeler oluşmaz). Search Console yoksa taramadaki hedef kelimeler kümelenir.
 */

const MAX_ITEMS = 2000;
const THRESHOLD = 0.55; // yarı yarıya örtüşme tek başına yetmez ("x istanbul" ≠ "x ankara"); aynı sayfa bonusuyla geçer
const TR_SUFFIXES = ['larının', 'lerinin', 'ların', 'lerin', 'ları', 'leri', 'ndan', 'nden', 'nın', 'nin', 'nun', 'nün', 'dan', 'den', 'tan', 'ten', 'lar', 'ler', 'sı', 'si', 'su', 'sü', 'ın', 'in', 'un', 'ün', 'da', 'de', 'ta', 'te', 'ı', 'i', 'u', 'ü'];
const TOKEN_RE = /[\p{L}\p{N}]+/gu;

export function stemmer(lang) {
  const tr = String(lang || '').toLowerCase().startsWith('tr');
  return (t) => {
    if (tr) {
      for (const s of TR_SUFFIXES) if (t.length - s.length >= 3 && t.endsWith(s)) return t.slice(0, -s.length);
      return t;
    }
    if (t.length > 4 && t.endsWith('ies')) return `${t.slice(0, -3)}y`;
    if (t.length > 4 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
    return t;
  };
}

// Niyet sinyalleri (kelime başına göre eşleşir: "fiyat" -> "fiyatları")
const INTENTS = [
  ['transactional', /(?<![\p{L}\p{N}])(fiyat|ücret|ucuz|satın|sipariş|indirim|kampanya|kupon|randevu|kirala|price|pricing|cost|buy|order|cheap|deal|discount|coupon|booking|book |hire|near me|yakınımda|online al)/iu],
  ['commercial', /(?<![\p{L}\p{N}])(en iyi|best |top |vs |karşılaştır|compare|comparison|yorum|review|alternatif|alternative|öneri|tavsiye|marka|firma|şirket|uzman|klinik|agency|company|services?\b)/iu],
  ['informational', /(?<![\p{L}\p{N}])(nedir|nasıl|neden|niçin|ne zaman|nerede|kimdir|hangi|ne işe|zarar|fayda|belirti|tedavi|rehber|nelerdir|kaç |how|what|why|when|where|who|guide|tutorial|tips|ideas|example|meaning|definition)/iu],
];
export function intentOf(q, isBrand) {
  if (isBrand) return 'navigational';
  const s = ` ${q} `;
  for (const [name, re] of INTENTS) if (re.test(s)) return name;
  return null;
}

const jaccard = (a, b) => {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
};
const pageKey = (u) => {
  const n = normalizeUrl(u);
  return n ? n.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') : u;
};

async function siteLang(domainId) {
  const { rows } = await query(
    `WITH a AS (SELECT id FROM audits WHERE domain_id = $1 AND status = 'completed' ORDER BY created_at DESC LIMIT 1)
     SELECT lower(split_part(p.lang, '-', 1)) AS lang FROM audit_pages p JOIN a ON a.id = p.audit_id
      WHERE p.lang IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC LIMIT 1`,
    [domainId],
  );
  return rows[0]?.lang || null;
}

async function loadGscItems(domainId) {
  const { rows } = await query(
    `SELECT query, page, clicks, impressions, position FROM gsc_query_page WHERE domain_id = $1 AND impressions >= 2`,
    [domainId],
  );
  const map = new Map();
  for (const r of rows) {
    const g = map.get(r.query) || { query: r.query, clicks: 0, impressions: 0, posW: 0, pages: [] };
    g.clicks += r.clicks;
    g.impressions += r.impressions;
    g.posW += r.position * r.impressions;
    g.pages.push({ page: r.page, clicks: r.clicks, impressions: r.impressions });
    map.set(r.query, g);
  }
  return [...map.values()].map((g) => ({ ...g, position: g.impressions ? g.posW / g.impressions : null }));
}

async function loadSiteItems(domainId) {
  const { rows } = await query(
    `WITH a AS (SELECT id, site_info FROM audits WHERE domain_id = $1 AND status = 'completed' ORDER BY created_at DESC LIMIT 1)
     SELECT k.keyword, k.url, k.score FROM audit_keywords k JOIN a ON a.id = k.audit_id
      WHERE (k.in_title OR k.in_h1 OR k.in_headings)
        AND NOT (k.keyword = ANY(ARRAY(SELECT jsonb_array_elements_text(COALESCE(a.site_info->'templateTerms', '[]'::jsonb)))))`,
    [domainId],
  );
  const map = new Map();
  for (const r of rows) {
    const g = map.get(r.keyword) || { query: r.keyword, clicks: 0, impressions: 0, position: null, pages: [] };
    g.impressions += Math.round(r.score); // site modunda ağırlık = içerik puanı
    g.pages.push({ page: r.url, clicks: 0, impressions: Math.round(r.score) });
    map.set(r.keyword, g);
  }
  return [...map.values()];
}

export async function keywordClusters(domain) {
  const source = domain.gsc_property ? 'gsc' : 'site';
  let items = source === 'gsc' ? await loadGscItems(domain.id) : [];
  const effective = items.length ? source : 'site';
  if (!items.length) items = await loadSiteItems(domain.id);
  if (!items.length) return { source: effective, empty: true, clusters: [], unclustered: 0 };

  const lang = await siteLang(domain.id);
  const lower = lowerFor(lang);
  const stem = stemmer(lang);
  const brand = domain.hostname.replace(/^www\./, '').split('.')[0].replace(/-/g, '');
  const isBrand = (q) => brand.length >= 4 && slugify(q).replace(/-/g, '').includes(brand);
  const homeKey = pageKey(`https://${domain.hostname}/`);

  items = items.sort((a, b) => b.impressions - a.impressions).slice(0, MAX_ITEMS).map((it) => {
    const tokens = (lower(it.query).match(TOKEN_RE) || []).filter((t) => t.length >= 2 && !STOPWORDS.has(t));
    const best = [...it.pages].sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)[0];
    return {
      ...it,
      brand: isBrand(it.query),
      stems: new Set(tokens.filter((t) => brand.length < 4 || !slugify(t).replace(/-/g, '').includes(brand)).map(stem)),
      bestPage: best && pageKey(best.page) !== homeKey ? pageKey(best.page) : null,
    };
  });

  const clusters = [];
  for (const it of items) {
    if (!it.stems.size) continue;
    let best = null;
    let bestSim = 0;
    for (const c of clusters) {
      let sim = jaccard(it.stems, c.leader.stems);
      if (it.bestPage && it.bestPage === c.leader.bestPage) sim = Math.min(1, sim + 0.3);
      if (sim > bestSim) {
        bestSim = sim;
        best = c;
      }
    }
    if (best && bestSim >= THRESHOLD) best.members.push(it);
    else clusters.push({ leader: it, members: [it] });
  }

  const expected3 = 0.1; // ~3. sıra tıklama oranı (potansiyel hesabı)
  const out = clusters
    .filter((c) => c.members.length >= 2)
    .map(({ leader, members }) => {
      const imp = members.reduce((s, m) => s + m.impressions, 0);
      const clicks = members.reduce((s, m) => s + m.clicks, 0);
      const withPos = members.filter((m) => m.position !== null);
      const posImp = withPos.reduce((s, m) => s + m.impressions, 0);
      const position = posImp ? withPos.reduce((s, m) => s + m.position * m.impressions, 0) / posImp : null;
      // Kümedeki sayfalar: gösterim payı %20+ olan 2+ sayfa = Google tarafında yamyamlık
      const pages = new Map();
      for (const m of members) for (const p of m.pages) {
        const g = pages.get(p.page) || { page: p.page, clicks: 0, impressions: 0 };
        g.clicks += p.clicks;
        g.impressions += p.impressions;
        pages.set(p.page, g);
      }
      const pageList = [...pages.values()].sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);
      const totalPageImp = pageList.reduce((s, p) => s + p.impressions, 0) || 1;
      const competing = pageList.filter((p) => p.impressions / totalPageImp >= 0.2);
      const intents = {};
      for (const m of members) {
        const i = intentOf(m.query, m.brand);
        if (i) intents[i] = (intents[i] || 0) + m.impressions;
      }
      const intent = Object.entries(intents).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
      const striking = withPos.filter((m) => m.position > 3 && m.position <= 20);
      return {
        name: leader.query,
        queries: members.length,
        clicks,
        impressions: imp,
        ctr: imp && effective === 'gsc' ? clicks / imp : null,
        position: position === null ? null : Math.round(position * 10) / 10,
        top3: withPos.filter((m) => m.position <= 3).length,
        top10: withPos.filter((m) => m.position <= 10).length,
        striking: striking.length,
        potential: effective === 'gsc' ? Math.max(0, Math.round(striking.reduce((s, m) => s + m.impressions * expected3 - m.clicks, 0))) : null,
        intent,
        brand: members.filter((m) => m.brand).length >= members.length / 2,
        mainPage: pageList[0]?.page || null,
        pages: pageList.slice(0, 6).map((p) => ({ ...p, share: p.impressions / totalPageImp })),
        cannibalized: competing.length >= 2,
        members: members.slice(0, 50).map((m) => ({
          query: m.query, clicks: m.clicks, impressions: m.impressions,
          position: m.position === null ? null : Math.round(m.position * 10) / 10, intent: intentOf(m.query, m.brand),
        })),
      };
    })
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 200);

  const clustered = out.reduce((s, c) => s + c.queries, 0);
  return {
    source: effective,
    empty: false,
    lang,
    summary: {
      clusters: out.length,
      items: items.length,
      clustered,
      cannibalized: out.filter((c) => c.cannibalized).length,
      potential: out.reduce((s, c) => s + (c.potential || 0), 0),
    },
    unclustered: items.length - clustered,
    clusters: out,
  };
}
