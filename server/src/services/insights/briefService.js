import { config } from '../../config.js';
import { query } from '../../db/pool.js';
import { badRequest, conflict, notFound } from '../../utils/httpError.js';
import { safeFetch } from '../../utils/safeFetch.js';
import { extractKeywords, lowerFor, phraseCount, slugify, STOPWORDS } from '../audit/keywordExtractor.js';
import { analyzePage, normalizeUrl } from '../audit/pageAnalyzer.js';
import { briefQueue } from '../jobQueue.js';
import { anyIso2, countryLanguages } from '../rankings/countryLanguages.js';
import { searchLanguage } from '../rankings/keywordInsightService.js';
import { account, serpFeatures } from '../rankings/serpapi.js';
import { keywordVariations } from './autocomplete.js';
import { intentOf, stemmer } from './clusterService.js';

/**
 * İçerik brief'i: hedef kelime için Google'ın ilk 10'undaki sayfalar (SerpApi varsa) veya rakip sayfaları canlı
 * analiz edilir; Search Console sorguları, Google otomatik tamamlama ve "Diğer sorular" ile birleştirilip
 * yazara verilecek veri odaklı bir plan çıkarılır: başlıklar, kapsanması gereken terimler, sorular, hedef uzunluk,
 * title/meta önerileri, yapısal veri ve iç bağlantılar. Mevcut sayfanız varsa eksikleri ayrıca işaretlenir.
 */

const MAX_PAGES = 8;
const FETCH_CONCURRENCY = 4;
const QUESTION_RE = /(^|\s)(nedir|nasıl|neden|niçin|ne zaman|nerede|kimdir|hangi|ne kadar|kaç|mı|mi|mu|mü|nelerdir|how|what|why|when|where|who|which|can|does|is|are|should)(\s|\?|$)/iu;
const YEAR = String(new Date().getUTCFullYear());

const bare = (h) => String(h || '').toLowerCase().replace(/^www\./, '');
const hostOf = (u) => {
  try {
    return bare(new URL(u).hostname);
  } catch {
    return '';
  }
};
const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
const pct = (a, q) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))];
};
const jaccard = (a, b) => {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n / (a.size + b.size - n);
};

// Brief'te yabancı dilli rakip sayfalar da olabilir: yaygın Avrupa dili durak kelimeleri
const EXTRA_STOP = new Set(`le la les de des du un une et en est pour par sur au aux avec dans que qui ce cette vous nous der die das und ist mit von zu den dem ein eine für auf im nicht sie el los las del y con por para una que es se lo al il di che per non sono gli della dei nel una`.split(' '));
const isStop = (t) => STOPWORDS.has(t) || EXTRA_STOP.has(t);

export function tokenizer(lang) {
  const lower = lowerFor(lang);
  const stem = stemmer(lang);
  return (text) => new Set((lower(text).match(/[\p{L}\p{N}]+/gu) || []).filter((t) => t.length >= 2 && !isStop(t) && !/^\d+$/.test(t)).map(stem));
}

/** Anahtar kelimenin dili için kaba tahmin (yazı sistemi, özel harfler ve sık kelimeler). */
const W = (list) => new RegExp(`(^|\\s)(${list})(\\s|$)`, 'iu');
const LANG_WORDS = [
  ['de', W('der|die|das|und|mit|kosten|türkei|haartransplantation|nasen|brust|op|erfahrungen|preise|klinik')],
  ['it', W('di|del|della|dei|capelli|trapianto|clinica|prezzo|prezzi|costo|naso|seno|turchia')],
  ['es', W('el|los|las|precio|precios|injerto|cabello|turquía|turquia|nariz|pecho')],
  ['fr', W('de|des|le|la|du|greffe|cheveux|prix|turquie|nez|poitrine|clinique')],
  ['tr', W('ve|için|nedir|nasıl|fiyat\\p{L}*|ücret\\p{L}*|estetiğ\\p{L}*|ameliyat\\p{L}*|ekim\\p{L}*|burun|meme|göğüs|sonrası|öncesi')],
];
export function guessLanguage(keyword) {
  if (/[\u0400-\u04FF]/.test(keyword)) return ['ru', 'bg', 'uk'];
  if (/[\u0600-\u06FF]/.test(keyword)) return ['ar'];
  for (const [lang, re] of LANG_WORDS) if (re.test(keyword)) return [lang];
  if (/[çğışİ]/i.test(keyword)) return ['tr'];
  if (/[ß]|[äöü]/i.test(keyword)) return ['de'];
  if (/[éèêàùâîôœ]/i.test(keyword)) return ['fr'];
  if (/[ñ¿¡]/i.test(keyword)) return ['es'];
  return ['en'];
}

// ------------------------------------------------------------------ Sayfa analizi
export async function analyzeUrl(url, ownHost) {
  try {
    const res = await safeFetch(url, { timeoutMs: 15_000, maxBytes: 3 * 1024 * 1024 });
    if (res.status !== 200 || !/text\/html|application\/xhtml/i.test(String(res.headers['content-type'] || ''))) return { url, error: `HTTP ${res.status}` };
    const host = new URL(res.finalUrl).hostname;
    const a = analyzePage(res, host);
    const d = a.data;
    return {
      url: res.finalUrl,
      domain: bare(host),
      own: bare(host) === ownHost,
      title: d.title,
      h1: d.h1,
      metaDescription: d.metaDescription,
      words: d.contentWords,
      lang: d.lang,
      outline: a.content.outline.filter((h) => h.level === 2 || h.level === 3).slice(0, 60),
      schemaTypes: d.schemaTypes,
      hints: d.schemaReport?.hints || [],
      images: d.images,
      externalLinks: d.externalLinks,
      publishedAt: d.publishedAt,
      modifiedAt: d.modifiedAt,
      // Sıralama kaybı analizi için indekslenebilirlik ve GEO sinyalleri
      noindex: d.noindex,
      canonical: d.canonical,
      issues: a.issues.map((i) => i.code),
      geo: d.geo,
      internalLinks: d.internalLinks,
      ttfb: res.ttfb,
      // Terim kapsamı için sayfa başına daha geniş (60) ifade listesi
      keywords: extractKeywords({
        title: d.title, h1: d.h1, headings: a.content.outline.filter((h) => h.level > 1).map((h) => h.text), meta: d.metaDescription,
        path: new URL(res.finalUrl).pathname, body: a.content.bodyText, alts: a.content.alts, lang: d.lang,
      }, 60),
      bodyText: a.content.bodyText.slice(0, 120_000),
    };
  } catch (err) {
    return { url, error: String(err.message).slice(0, 200) };
  }
}

export async function analyzeAll(urls, ownHost) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: FETCH_CONCURRENCY }, async () => {
    while (i < urls.length) {
      const idx = i++;
      out[idx] = await analyzeUrl(urls[idx], ownHost);
    }
  }));
  return out;
}

// ------------------------------------------------------------------ Veri toplama
/** Hedef ülke: kelimenin dilinin konuşulduğu ve en çok gösterim aldığı ülke (ör. İngilizce kelime için Fransa değil ABD/İngiltere). */
export async function targetCountry(domain, keyword) {
  const langs = guessLanguage(keyword);
  const speaks = (c) => countryLanguages(c).some((l) => langs.includes(l));
  const { rows } = await query(
    `SELECT country, impressions FROM gsc_query_country WHERE domain_id = $1 AND query = $2 ORDER BY impressions DESC`,
    [domain.id, keyword],
  );
  const hit = rows.find((r) => speaks(r.country));
  if (hit) return hit.country;
  const { rows: all } = await query(
    `SELECT country FROM gsc_country_daily WHERE domain_id = $1 GROUP BY country ORDER BY SUM(impressions) DESC LIMIT 60`,
    [domain.id],
  );
  const site = all.find((r) => speaks(r.country));
  if (site) return site.country;
  return { tr: 'TUR', de: 'DEU', fr: 'FRA', es: 'ESP', ar: 'SAU', ru: 'RUS', bg: 'BGR', uk: 'UKR' }[langs[0]] || 'USA';
}

/** Kelimeyle kök paylaşan Search Console sorguları ve sıralanan sayfalar. */
export async function relatedQueries(domain, keyword, tok) {
  if (!domain.gsc_property) return { queries: [], ourPage: null };
  const core = tok(keyword);
  const { rows } = await query(
    `SELECT query, page, clicks, impressions, position FROM gsc_query_page WHERE domain_id = $1 AND impressions >= 3`,
    [domain.id],
  );
  const byQuery = new Map();
  for (const r of rows) {
    const t = tok(r.query);
    const overlap = [...core].filter((x) => t.has(x)).length;
    if (!overlap || (overlap < core.size && jaccard(core, t) < 0.34)) continue;
    const g = byQuery.get(r.query) || { query: r.query, clicks: 0, impressions: 0, posW: 0, pages: new Map() };
    g.clicks += r.clicks;
    g.impressions += r.impressions;
    g.posW += r.position * r.impressions;
    g.pages.set(r.page, (g.pages.get(r.page) || 0) + r.impressions);
    byQuery.set(r.query, g);
  }
  const queries = [...byQuery.values()]
    .map((g) => ({ query: g.query, clicks: g.clicks, impressions: g.impressions, position: Math.round((g.posW / g.impressions) * 10) / 10, page: [...g.pages.entries()].sort((a, b) => b[1] - a[1])[0][0] }))
    .sort((a, b) => b.impressions - a.impressions);
  // Kelime için en çok gösterim alan sayfanız (mevcut sayfa)
  const pageImp = new Map();
  for (const q of queries.slice(0, 50)) pageImp.set(q.page, (pageImp.get(q.page) || 0) + q.impressions);
  const exact = queries.find((q) => q.query === keyword);
  const ourPage = exact?.page || [...pageImp.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  return { queries: queries.slice(0, 60), ourPage, ourPosition: exact?.position ?? null };
}

/** SerpApi yoksa: rakiplerin bu konuyu hedefleyen sayfaları. */
export async function competitorCandidates(domain, keyword, tok) {
  const core = tok(keyword);
  const { rows } = await query(
    `SELECT k.url, k.keyword, k.score FROM competitor_keywords k JOIN competitors c ON c.id = k.competitor_id
      WHERE c.domain_id = $1 AND (k.in_title OR k.in_h1)`,
    [domain.id],
  );
  const best = new Map();
  for (const r of rows) {
    const sim = jaccard(core, tok(r.keyword));
    if (sim < 0.5) continue;
    const s = sim * r.score;
    if (!best.has(r.url) || best.get(r.url) < s) best.set(r.url, s);
  }
  return [...best.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_PAGES).map(([u]) => u);
}

export async function internalLinks(domain, keyword, tok, excludeUrl) {
  const { rows: [audit] } = await query(`SELECT id FROM audits WHERE domain_id = $1 AND status = 'completed' ORDER BY created_at DESC LIMIT 1`, [domain.id]);
  if (!audit) return [];
  const core = tok(keyword);
  const { rows } = await query(
    `SELECT k.url, k.keyword, k.score, p.title, p.inlinks FROM audit_keywords k JOIN audit_pages p ON p.audit_id = k.audit_id AND p.url = k.url
      WHERE k.audit_id = $1 AND p.status_code = 200 AND NOT p.noindex`,
    [audit.id],
  );
  const byUrl = new Map();
  for (const r of rows) {
    if (r.url === excludeUrl) continue;
    const sim = jaccard(core, tok(r.keyword));
    if (sim < 0.34) continue;
    const e = byUrl.get(r.url) || { url: r.url, title: r.title, inlinks: r.inlinks, score: 0, terms: [] };
    e.score += sim * Math.min(20, r.score);
    if (e.terms.length < 4) e.terms.push(r.keyword);
    byUrl.set(r.url, e);
  }
  return [...byUrl.values()].sort((a, b) => b.score * (1 + Math.log2(1 + b.inlinks) / 3) - a.score * (1 + Math.log2(1 + a.inlinks) / 3)).slice(0, 8);
}

// ------------------------------------------------------------------ Sentez
export function headingGroups(pages, tok, ours) {
  const groups = [];
  for (const p of pages) {
    const seen = new Set();
    for (const h of p.outline) {
      const text = h.text.replace(/^\d+[.)-]\s*/, '').trim();
      if (text.length < 4 || text.length > 140) continue;
      const t = tok(text);
      if (!t.size) continue;
      let g = groups.find((x) => jaccard(x.tokens, t) >= 0.5);
      if (!g) {
        g = { tokens: t, texts: new Map(), pages: new Set(), level: h.level };
        groups.push(g);
      }
      if (seen.has(g)) continue;
      seen.add(g);
      g.pages.add(p.url);
      g.texts.set(text, (g.texts.get(text) || 0) + 1);
    }
  }
  const ourTokens = (ours?.outline || []).map((h) => tok(h.text));
  const min = pages.length >= 4 ? 2 : 1;
  return groups
    .filter((g) => g.pages.size >= min)
    .map((g) => ({
      heading: [...g.texts.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0],
      pages: g.pages.size,
      level: g.level,
      covered: ours ? ourTokens.some((t) => jaccard(t, g.tokens) >= 0.5) : null,
    }))
    .sort((a, b) => b.pages - a.pages || a.level - b.level)
    .slice(0, 30);
}

export function termCoverage(pages, ours, lang, keyword, tok) {
  const core = tok(keyword);
  const df = new Map();
  for (const p of pages) {
    const seen = new Set();
    for (const k of p.keywords) {
      if (seen.has(k.keyword)) continue;
      const t = tok(k.keyword);
      // Hedef kelimenin kendisi / parçaları ve durak kelimeler terim önerisi değildir
      if (!t.size || [...t].every((x) => core.has(x))) continue;
      seen.add(k.keyword);
      const e = df.get(k.keyword) || { term: k.keyword, pages: 0, score: 0 };
      e.pages++;
      e.score += k.score;
      df.set(k.keyword, e);
    }
  }
  const min = Math.max(2, Math.ceil(pages.length * 0.35));
  return [...df.values()]
    .filter((e) => e.pages >= Math.min(min, pages.length))
    .sort((a, b) => b.pages - a.pages || b.score - a.score)
    .slice(0, 40)
    .map((e) => ({ term: e.term, pages: e.pages, covered: ours ? phraseCount(ours.bodyText, e.term, lang) > 0 : null }));
}

export function titleModifiers(pages, keyword, tok, brands) {
  const core = tok(keyword);
  const counts = new Map();
  for (const p of pages) {
    const seen = new Set();
    for (const t of tok(p.title || '')) {
      if (core.has(t) || seen.has(t) || t.length < 3 || brands.some((b) => b.includes(slugify(t)) && t.length >= 4)) continue;
      seen.add(t);
      counts.set(t, (counts.get(t) || 0) + 1);
    }
    if ((p.title || '').includes(YEAR) && !seen.has(YEAR)) counts.set(YEAR, (counts.get(YEAR) || 0) + 1);
  }
  return [...counts.entries()].filter(([, n]) => n >= Math.max(2, Math.ceil(pages.length * 0.3))).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([term, n]) => ({ term, pages: n }));
}

const cap = (s) => s.charAt(0).toLocaleUpperCase('tr') + s.slice(1);

function titleIdeas(keyword, intent, modifiers, lang) {
  const k = cap(keyword.replace(/^(best|top|en iyi)\s+/i, ''));
  const mods = modifiers.map((m) => m.term);
  const year = !/\b20\d{2}\b/.test(keyword) && (mods.includes(YEAR) || intent === 'transactional') ? ` ${YEAR}` : '';
  const tr = String(lang || '').startsWith('tr');
  const ideas = tr
    ? {
      transactional: [`${k} Fiyatları${year}: Güncel Ücretler ve Detaylar`, `${k}${year} | Fiyat, Süreç ve Sonuçlar`, `${k}: Neye Göre Fiyatlanır?${year}`],
      commercial: [`En İyi ${k}: Karşılaştırma ve Öneriler${year}`, `${k} Seçerken Bilmeniz Gerekenler${year}`, `${k}: Avantajlar, Dezavantajlar, Yorumlar`],
      informational: [`${k} Nedir? Bilmeniz Gereken Her Şey${year}`, `${k}: Adım Adım Rehber${year}`, `${k} Hakkında Sık Sorulan Sorular`],
    }
    : {
      transactional: [`${k} Cost${year}: Prices & What's Included`, `${k}${year} | Prices, Process & Results`, `How Much Does ${k} Cost?${year}`],
      commercial: [`Best ${k}${year}: Compared & Reviewed`, `${k}: How to Choose the Right Option`, `${k}: Pros, Cons and Real Reviews`],
      informational: [`What Is ${k}? The Complete Guide${year}`, `${k}: A Step-by-Step Guide${year}`, `${k}: Answers to Common Questions`],
    };
  return (ideas[intent] || ideas.informational).map((t) => ({ title: t, length: t.length }));
}

export function questionList(serpQuestions, gscQueries, variations, ours, tok) {
  const out = new Map();
  const add = (q, source) => {
    const k = q.toLowerCase().replace(/[?!.]+$/, '').trim();
    if (k.length < 8 || out.has(k)) return;
    let covered = null;
    if (ours) {
      const t = tok(q);
      const body = tok(`${ours.bodyText.slice(0, 60_000)} ${ours.outline.map((h) => h.text).join(' ')}`);
      covered = t.size ? [...t].filter((x) => body.has(x)).length / t.size >= 0.8 : null;
    }
    out.set(k, { question: q, source, covered });
  };
  serpQuestions.forEach((q) => add(q, 'Google “Diğer sorular”'));
  gscQueries.filter((q) => QUESTION_RE.test(q.query)).slice(0, 15).forEach((q) => add(q.query, 'Search Console'));
  variations.filter((v) => QUESTION_RE.test(v.query)).slice(0, 15).forEach((v) => add(v.query, 'Google otomatik tamamlama'));
  return [...out.values()].slice(0, 30);
}

// ------------------------------------------------------------------ İş akışı
export async function createBrief(domain, userId, { keyword, country, urls = [] }) {
  const kw = keyword.trim().toLocaleLowerCase('tr');
  const { rows: [running] } = await query(
    "SELECT count(*)::int AS n FROM content_briefs WHERE domain_id = $1 AND status IN ('queued', 'running')",
    [domain.id],
  );
  if (running.n >= 3) throw conflict('Aynı anda en fazla 3 brief hazırlanabilir');
  const target = country || (await targetCountry(domain, kw));
  if (!anyIso2(target)) throw badRequest('Geçersiz ülke');
  const { rows: [b] } = await query(
    'INSERT INTO content_briefs (domain_id, keyword, country) VALUES ($1, $2, $3) RETURNING id, keyword, country, status, created_at',
    [domain.id, kw, target],
  );
  briefQueue.add(b.id, () => runBrief(b.id, domain, { keyword: kw, country: target, urls }));
  return b;
}

async function runBrief(id, domain, { keyword, country, urls }) {
  await query("UPDATE content_briefs SET status = 'running' WHERE id = $1", [id]);
  try {
    const data = await buildBrief(domain, { keyword, country, urls });
    await query("UPDATE content_briefs SET status = 'completed', data = $2, finished_at = now() WHERE id = $1", [id, JSON.stringify(data)]);
  } catch (err) {
    await query("UPDATE content_briefs SET status = 'failed', error = $2, finished_at = now() WHERE id = $1", [id, String(err.message).slice(0, 300)]);
  }
}

async function buildBrief(domain, { keyword, country, urls }) {
  const hl = await searchLanguage(domain, country);
  const gl = anyIso2(country).toLowerCase();
  const tok = tokenizer(hl);
  const ownHost = bare(domain.hostname);
  const notes = [];

  // 1) Google ilk 10 (SerpApi) veya rakip sayfaları
  let serp = null;
  if (config.serpapi.enabled) {
    try {
      const { searchesLeft } = await account();
      if (searchesLeft === null || searchesLeft > config.serpapi.quotaReserve) {
        serp = await serpFeatures({ keyword, gl, hl, device: 'mobile', hostname: domain.hostname });
        await query(
          `INSERT INTO serp_snapshots (domain_id, keyword, country, device, position, url, features, top, questions, related)
           VALUES ($1, $2, $3, 'mobile', $4, $5, $6, $7, $8, $9)`,
          [domain.id, keyword, country, serp.position, serp.url, JSON.stringify(serp.features), JSON.stringify(serp.top), serp.questions, serp.related],
        );
      } else notes.push('SerpApi kotası rezerv seviyesinde; Google ilk 10 yerine rakip sayfaları kullanıldı.');
    } catch (err) {
      notes.push(`Google sonuçları alınamadı (${err.message}); rakip sayfaları kullanıldı.`);
    }
  } else notes.push('SERPAPI_KEY tanımlı değil: Google ilk 10 yerine eklediğiniz rakiplerin sayfaları ve verdiğiniz URL’ler analiz edildi.');

  const gsc = await relatedQueries(domain, keyword, tok);
  const manual = urls.map((u) => normalizeUrl(u)).filter(Boolean);
  let candidates = serp ? serp.top.filter((t) => !t.own && t.link).map((t) => t.link) : await competitorCandidates(domain, keyword, tok);
  candidates = [...new Set([...manual, ...candidates])].filter((u) => hostOf(u) !== ownHost).slice(0, MAX_PAGES);
  const ourUrl = serp?.url || gsc.ourPage;

  // 2) Sayfaları canlı analiz et (sizin sayfanız dahil)
  const analyzed = await analyzeAll(ourUrl ? [...candidates, ourUrl] : candidates, ownHost);
  const ours = ourUrl ? analyzed.at(-1) : null;
  const pages = analyzed.slice(0, candidates.length).filter((p) => !p.error && p.words >= 150);
  const failed = analyzed.slice(0, candidates.length).filter((p) => p.error).length;
  if (failed) notes.push(`${failed} sayfa erişilemediği için analiz dışı kaldı (bot engeli veya hata).`);
  if (!pages.length) throw new Error('Analiz edilecek rakip sayfa bulunamadı. SerpApi anahtarı ekleyin, rakip ekleyin veya karşılaştırılacak URL’leri girin.');
  const own = ours && !ours.error ? ours : null;

  // 3) Ek kaynaklar
  const variations = await keywordVariations(keyword, { hl, gl }).catch(() => []);
  const words = pages.map((p) => p.words);
  const intents = {};
  for (const q of [keyword, ...gsc.queries.slice(0, 20).map((q) => q.query), ...variations.slice(0, 20).map((v) => v.query)]) {
    const i = intentOf(q, false);
    if (i) intents[i] = (intents[i] || 0) + 1;
  }
  const intent = intentOf(keyword, false) || Object.entries(intents).sort((a, b) => b[1] - a[1])[0]?.[0] || 'informational';
  const modifiers = titleModifiers(pages, keyword, tok, [slugify(ownHost.split('.')[0]).replace(/-/g, ''), ...pages.map((p) => slugify(p.domain.split('.')[0]).replace(/-/g, ''))]);
  const headings = headingGroups(pages, tok, own);
  const terms = termCoverage(pages, own, hl, keyword, tok);
  const questions = questionList(serp?.questions || [], gsc.queries, variations, own, tok);
  const schemaCounts = new Map();
  for (const p of pages) for (const t of new Set(p.schemaTypes)) schemaCounts.set(t, (schemaCounts.get(t) || 0) + 1);
  const share = (f) => pages.filter(f).length / pages.length;
  const target = { min: Math.round((median(words) * 0.9) / 50) * 50, max: Math.round((Math.max(median(words), pct(words, 0.75)) * 1.1) / 50) * 50 };
  const links = await internalLinks(domain, keyword, tok, ourUrl);

  // 4) Önerilen taslak: en yaygın başlıklar + sorular (SSS)
  const outline = [
    ...headings.filter((h) => h.level === 2).slice(0, 10).map((h) => ({ level: 2, text: h.heading, why: `${h.pages}/${pages.length} rakipte var` })),
    ...(questions.length ? [{ level: 2, text: String(hl).startsWith('tr') ? 'Sık Sorulan Sorular' : 'Frequently Asked Questions', why: 'Kullanıcı soruları' }] : []),
    ...questions.slice(0, 8).map((q) => ({ level: 3, text: q.question, why: q.source })),
  ];

  return {
    keyword,
    country,
    language: hl,
    intent,
    generatedAt: new Date().toISOString(),
    notes,
    source: serp ? 'serp' : manual.length && !candidates.some((c) => !manual.includes(c)) ? 'manual' : 'competitors',
    serp: serp ? {
      features: serp.features,
      ourPosition: serp.position,
      top: serp.top.map((t) => ({ ...t, analyzed: pages.some((p) => p.url === t.link || hostOf(p.url) === t.domain) })),
      related: serp.related,
    } : null,
    stats: {
      pages: pages.length,
      words: { median: median(words), p75: pct(words, 0.75), min: Math.min(...words), max: Math.max(...words) },
      h2: median(pages.map((p) => p.outline.filter((h) => h.level === 2).length)),
      images: median(pages.map((p) => p.images || 0)),
      externalLinks: median(pages.map((p) => p.externalLinks || 0)),
      faqShare: share((p) => p.schemaTypes.includes('FAQPage') || p.hints.includes('FAQPage')),
      videoShare: share((p) => p.schemaTypes.includes('VideoObject') || p.hints.includes('VideoObject')),
      freshShare: share((p) => p.modifiedAt && Date.now() - Date.parse(p.modifiedAt) < 365 * 86_400_000),
      titleLength: median(pages.map((p) => (p.title || '').length)),
    },
    target,
    titleIdeas: titleIdeas(keyword, intent, modifiers, hl),
    modifiers,
    metaTip: String(hl).startsWith('tr')
      ? `“${keyword}” ile başlayan, ${modifiers.slice(0, 2).map((m) => `“${m.term}”`).join(' ve ') || 'net bir fayda'} içeren ve harekete geçiren bir cümleyle biten 140–155 karakterlik açıklama.`
      : `A 140–155 character description that starts with “${keyword}”, mentions ${modifiers.slice(0, 2).map((m) => `“${m.term}”`).join(' and ') || 'a clear benefit'} and ends with a call to action.`,
    headings,
    terms,
    questions,
    outline,
    schema: [...schemaCounts.entries()].filter(([, n]) => n / pages.length >= 0.3).sort((a, b) => b[1] - a[1]).map(([type, n]) => ({ type, pages: n })),
    supporting: gsc.queries.slice(0, 40),
    variations: variations.slice(0, 40),
    internalLinks: links,
    competitors: pages.map((p) => ({
      url: p.url, domain: p.domain, title: p.title, words: p.words, h2: p.outline.filter((h) => h.level === 2).length,
      schemaTypes: p.schemaTypes.slice(0, 6), modifiedAt: p.modifiedAt, publishedAt: p.publishedAt,
    })),
    existing: own ? {
      url: own.url,
      title: own.title,
      words: own.words,
      position: serp?.position ?? gsc.ourPosition ?? null,
      keywordInTitle: phraseCount(own.title || '', keyword, hl) > 0,
      missingHeadings: headings.filter((h) => h.covered === false).length,
      missingTerms: terms.filter((t) => t.covered === false).length,
      missingQuestions: questions.filter((q) => q.covered === false).length,
      schemaTypes: own.schemaTypes,
    } : ours?.error ? { url: ourUrl, error: ours.error } : null,
  };
}

// ------------------------------------------------------------------ Okuma
export async function listBriefs(domain) {
  const { rows } = await query(
    `SELECT id, keyword, country, status, error, created_at, finished_at FROM content_briefs WHERE domain_id = $1 ORDER BY created_at DESC LIMIT 100`,
    [domain.id],
  );
  return rows;
}

export async function getBrief(domain, id) {
  const { rows: [b] } = await query('SELECT * FROM content_briefs WHERE id = $1 AND domain_id = $2', [id, domain.id]);
  if (!b) throw notFound('Brief bulunamadı');
  return b;
}

export async function deleteBrief(domain, id) {
  const { rowCount } = await query('DELETE FROM content_briefs WHERE id = $1 AND domain_id = $2', [id, domain.id]);
  if (!rowCount) throw notFound('Brief bulunamadı');
}
