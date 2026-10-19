import { query } from '../../db/pool.js';
import { lowerFor, slugify, STOPWORDS } from '../audit/keywordExtractor.js';
import { normalizeUrl } from '../audit/pageAnalyzer.js';
import { keywordClusters, intentOf, stemmer } from './clusterService.js';
import { compareCompetitors } from './competitorService.js';
import { contentDecay } from './decayService.js';
import { guessLanguage } from './briefService.js';

/**
 * İçerik fikirleri: sitenin çalıştığı (Search Console'da göründüğü) kelimelerden, kümelerden, rakip boşluklarından,
 * Google "Diğer sorular" kutusundan ve yükselen aramalardan öncelikli içerik planı. Her fikir için önerilen başlık,
 * gerekçe, destekleyici sorgular ve tahmini potansiyel; tek tıkla brief'e dönüştürülebilir.
 */

const QUESTION_RE = /(^|\s)(nedir|nasıl|neden|niçin|ne zaman|nerede|kimdir|hangi|ne kadar|kaç|nelerdir|how|what|why|when|where|who|which|can|does|is it|should)(\s|\?|$)/iu;
const TOP3_CTR = 0.1;
const YEAR = String(new Date().getUTCFullYear());
const pageKey = (u) => {
  const n = normalizeUrl(u);
  return n ? n.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') : u;
};
const cap = (s) => s.charAt(0).toLocaleUpperCase('tr') + s.slice(1);

function headline(keyword, intent) {
  // Başlık şablonu sadece Türkçe/İngilizce kelimelerde; diğer dillerde kelimenin kendisi çalışma başlığıdır
  const lang = guessLanguage(keyword)[0];
  if (lang !== 'tr' && lang !== 'en') return null;
  const tr = lang === 'tr';
  // "best ..." / "en iyi ..." ile başlayan veya yıl içeren kelimelerde tekrar etmesin
  const k = cap(keyword.replace(/^(best|top|en iyi)\s+/i, ''));
  const hasYear = /\b20\d{2}\b/.test(keyword);
  const y = (s) => (hasYear ? s.replace(/\s*\(?\b20\d{2}\b\)?/g, '').replace(/\s+:/g, ':').trim() : s);
  if (QUESTION_RE.test(keyword)) return tr ? `${cap(keyword)}? Uzman Yanıtı ve Detaylar` : `${cap(keyword)}? Expert Answer & Details`;
  if (intent === 'transactional') return y(tr ? `${k} Fiyatları ${YEAR}: Güncel Ücretler ve Süreç` : `${k} Cost ${YEAR}: Prices & Process`);
  if (intent === 'commercial') return y(tr ? `En İyi ${k}: Karşılaştırma ve Öneriler (${YEAR})` : `Best ${k} (${YEAR}): Compared & Reviewed`);
  return y(tr ? `${k}: Bilmeniz Gereken Her Şey (${YEAR} Rehberi)` : `${k}: The Complete ${YEAR} Guide`);
}

export async function contentIdeas(domain) {
  const { rows: [langRow] } = await query(
    `WITH a AS (SELECT id FROM audits WHERE domain_id = $1 AND status = 'completed' ORDER BY created_at DESC LIMIT 1)
     SELECT lower(split_part(p.lang, '-', 1)) AS lang FROM audit_pages p JOIN a ON a.id = p.audit_id WHERE p.lang IS NOT NULL
      GROUP BY 1 ORDER BY count(*) DESC LIMIT 1`,
    [domain.id],
  );
  const lang = langRow?.lang || 'en';
  const lower = lowerFor(lang);
  const stem = stemmer(lang);
  const tok = (s) => new Set((lower(s).match(/[\p{L}\p{N}]+/gu) || []).filter((t) => t.length >= 2 && !STOPWORDS.has(t)).map(stem));
  const brand = slugify(domain.hostname.replace(/^www\./, '').split('.')[0]).replace(/-/g, '');
  const isBrand = (q) => brand.length >= 4 && slugify(q).replace(/-/g, '').includes(brand);

  // Sitenin mevcut sayfalarının konu imzası (title + H1 + başlıklar): "zaten kapsanıyor mu?" kontrolü
  const { rows: pages } = await query(
    `WITH a AS (SELECT id FROM audits WHERE domain_id = $1 AND status = 'completed' ORDER BY created_at DESC LIMIT 1)
     SELECT p.url, p.title, p.h1, p.outline FROM audit_pages p JOIN a ON a.id = p.audit_id WHERE p.status_code = 200 AND NOT p.noindex`,
    [domain.id],
  );
  const pageSigs = pages.map((p) => ({ url: p.url, title: p.title, head: tok(`${p.title || ''} ${p.h1 || ''}`), all: tok(`${p.title || ''} ${p.h1 || ''} ${(p.outline || []).map((h) => h.text).join(' ')}`) }));
  const byKey = new Map(pages.map((p) => [pageKey(p.url), p]));
  const coveredBy = (kw, strict) => {
    const t = tok(kw);
    if (!t.size) return null;
    return pageSigs.find((p) => [...t].every((x) => (strict ? p.head : p.all).has(x)))?.url || null;
  };

  const ideas = [];
  const push = (idea) => {
    const t = tok(idea.keyword);
    // Aynı konuyu iki kez önermeyelim (kök kümesi neredeyse aynıysa güçlü olan kalır)
    const dup = ideas.find((i) => {
      const o = i._t;
      let n = 0;
      for (const x of t) if (o.has(x)) n++;
      return n / Math.max(1, t.size + o.size - n) >= 0.75;
    });
    if (dup) {
      if ((idea.potential || 0) > (dup.potential || 0)) Object.assign(dup, idea, { _t: t });
      return;
    }
    ideas.push({ ...idea, _t: t });
  };

  // ------------------------------------------------ 1) Search Console: soru sorguları ve yükselen aramalar
  if (domain.gsc_property) {
    const { rows: qs } = await query(
      `SELECT query, SUM(clicks)::int AS clicks, SUM(impressions)::int AS impressions,
              SUM(position * impressions) / NULLIF(SUM(impressions), 0) AS position,
              SUM(COALESCE(prev_impressions, 0))::int AS prev_impressions
         FROM gsc_query_country WHERE domain_id = $1 GROUP BY query HAVING SUM(impressions) >= 20`,
      [domain.id],
    );
    const { rows: bestPages } = await query(
      `SELECT DISTINCT ON (query) query, page FROM gsc_query_page WHERE domain_id = $1 ORDER BY query, impressions DESC`,
      [domain.id],
    );
    const bestPage = new Map(bestPages.map((r) => [r.query, r.page]));
    for (const q of qs) {
      if (isBrand(q.query)) continue;
      const pos = Math.round(q.position * 10) / 10;
      const potential = Math.max(0, Math.round(q.impressions * TOP3_CTR - q.clicks));
      const page = bestPage.get(q.query) || null;
      // Sıralanan sayfanın title/H1'i sorgunun tüm köklerini içeriyorsa soruya özel sayfa var demektir
      const sig = page ? pageSigs.find((p) => pageKey(p.url) === pageKey(page)) : null;
      const dedicated = Boolean(sig && [...tok(q.query)].every((x) => sig.head.has(x)));
      if (QUESTION_RE.test(q.query) && (pos > 8 || !dedicated)) {
        push({
          type: 'question', keyword: q.query, impressions: q.impressions, position: pos, potential, page,
          reason: `Bu soru ${q.impressions} kez gösterildi ama ${page ? `onu doğrudan yanıtlayan bir sayfa yok (şu an ${pos}. sırada genel bir sayfa çıkıyor)` : 'sitede yanıtı yok'}.`,
        });
      }
      // Yükselen: gösterimi önceki 28 güne göre 2 katına çıkmış ve henüz ilk 10'da değil
      if (q.prev_impressions >= 10 && q.impressions >= q.prev_impressions * 2 && pos > 10) {
        push({
          type: 'trending', keyword: q.query, impressions: q.impressions, position: pos, potential, page,
          growth: Math.round((q.impressions / q.prev_impressions - 1) * 100),
          reason: `Gösterimi önceki 28 güne göre %${Math.round((q.impressions / q.prev_impressions - 1) * 100)} arttı; talep yükselirken ${pos}. sıradasınız.`,
        });
      }
    }
  }

  // ------------------------------------------------ 2) Kümeler: özel sayfası olmayan veya bölünmüş konular
  const clusters = await keywordClusters(domain);
  for (const c of clusters.clusters || []) {
    if (c.brand || c.impressions < (clusters.source === 'gsc' ? 100 : 20)) continue;
    const support = c.members.slice(1, 8).map((m) => m.query);
    if (c.cannibalized) {
      push({
        type: 'consolidate', keyword: c.name, impressions: c.impressions, position: c.position, potential: c.potential, page: c.mainPage, supporting: support,
        reason: `${c.pages.filter((p) => p.share >= 0.2).length} sayfanız bu konuda yarışıyor. Tek güçlü sayfada birleştirin; diğerlerini alt konulara odaklayın.`,
      });
    } else if (clusters.source === 'gsc' && (c.position === null || c.position > 12) && c.queries >= 3) {
      push({
        type: 'pillar', keyword: c.name, impressions: c.impressions, position: c.position, potential: c.potential, page: c.mainPage, supporting: support,
        reason: `${c.queries} sorguluk konu kümesi (${c.impressions} gösterim) ortalama ${c.position}. sırada. Konuyu tüm alt sorgularıyla kapsayan bir ana (pillar) sayfa açın.`,
      });
    }
  }

  // ------------------------------------------------ 3) Rakip boşlukları
  try {
    const comp = await compareCompetitors(domain);
    for (const g of (comp.gaps || []).slice(0, 60)) {
      push({
        type: 'competitor_gap', keyword: g.keyword, competitors: g.competitors.length, weak: g.weak,
        examples: g.competitors.slice(0, 3).map((c) => ({ url: c.url, title: c.title, words: c.words })),
        potential: null,
        reason: `${g.competitors.map((c) => c.hostname).join(', ')} bu konuya özel sayfa yayınlamış${g.weak ? '; sizde konu sadece metin içinde geçiyor' : ', sizde hiç yok'}.`,
      });
    }
  } catch {
    /* rakip yok */
  }

  // ------------------------------------------------ 4) Google "Diğer sorular" (SERP takibinden)
  const { rows: paa } = await query(
    `SELECT DISTINCT ON (q) q, keyword FROM serp_snapshots, unnest(questions) AS q WHERE domain_id = $1 AND checked_at > now() - interval '60 days'`,
    [domain.id],
  );
  for (const p of paa) {
    if (coveredBy(p.q, false)) continue;
    push({
      type: 'paa', keyword: p.q, parent: p.keyword, potential: null,
      reason: `Google “${p.keyword}” aramasında bu soruyu “Diğer sorular” kutusunda gösteriyor; sitenizde yanıtı yok.`,
    });
  }

  // ------------------------------------------------ 5) Güncelleme: eriyen sayfalar
  if (domain.gsc_property) {
    try {
      const decay = await contentDecay(domain);
      for (const r of (decay.rows || []).slice(0, 15)) {
        ideas.push({
          type: 'refresh', keyword: (byKey.get(pageKey(r.page))?.title || r.page).slice(0, 120), page: r.page, potential: r.lostClicks, position: r.recentPosition,
          reason: `Aylık tıklama ${r.peakClicks} → ${r.recentClicks} düştü. İçeriği güncelleyin; brief ile rakiplerin eklediği başlıkları görün.`,
          _t: new Set(),
        });
      }
    } catch {
      /* yeterli geçmiş yok */
    }
  }

  const weight = { question: 1.1, trending: 1.3, pillar: 1.2, consolidate: 1.0, competitor_gap: 1.0, paa: 0.9, refresh: 1.15 };
  const score = (i) => (i.potential ?? (i.competitors ? 20 * i.competitors : 12)) * weight[i.type];
  const out = ideas
    .map(({ _t, ...i }) => ({ ...i, intent: intentOf(i.keyword, false), title: i.type === 'refresh' ? null : headline(i.keyword, intentOf(i.keyword, false)), score: Math.round(score(i)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 150);
  const counts = {};
  for (const i of out) counts[i.type] = (counts[i.type] || 0) + 1;
  return { lang, counts, ideas: out, sources: { gsc: Boolean(domain.gsc_property), clusters: clusters.source, paa: paa.length } };
}
