import * as cheerio from 'cheerio';
import { extractKeywords, wordCountOf } from './keywordExtractor.js';
import { detectSchemaHints, HINT_TYPES, validateJsonLd } from './schemaValidator.js';

const HREFLANG_RE = /^(x-default|[a-z]{2,3}(-[a-z]{4})?(-([a-z]{2}|\d{3}))?)$/i;
const SKIP_EXT = /\.(jpe?g|png|gif|webp|avif|svg|ico|bmp|pdf|zip|rar|7z|gz|tar|mp4|mp3|webm|mov|avi|wav|css|js|mjs|json|xml|txt|csv|woff2?|ttf|otf|eot|docx?|xlsx?|pptx?|exe|dmg|apk)$/i;
const TRACKING_PARAM = /^(utm_|fbclid$|gclid$|msclkid$|mc_|_ga$|yclid$)/i;

export function normalizeUrl(href, base) {
  try {
    const u = new URL(href, base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    for (const key of [...u.searchParams.keys()]) if (TRACKING_PARAM.test(key)) u.searchParams.delete(key);
    return u.href;
  } catch {
    return null;
  }
}

export const isCrawlable = (url) => !SKIP_EXT.test(new URL(url).pathname);

/** "2026-03-12T10:00:00+03:00" / "12.03.2026" gibi değerlerden YYYY-MM-DD (makul aralık dışını atar). */
function isoDay(v) {
  if (!v) return null;
  const s = String(v).trim();
  let d = null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  else if (!Number.isNaN(Date.parse(s))) d = new Date(Date.parse(s));
  if (!d || Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  return y >= 1995 && d.getTime() <= Date.now() + 86_400_000 * 2 ? d.toISOString().slice(0, 10) : null;
}

/** JSON-LD bloklarında ilk datePublished / dateModified değerleri. */
function schemaDates(blocks) {
  const out = { published: null, modified: null };
  const visit = (node) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== 'object') return;
    out.published ||= isoDay(node.datePublished);
    out.modified ||= isoDay(node.dateModified);
    if (node['@graph']) visit(node['@graph']);
    if (node.mainEntity) visit(node.mainEntity);
  };
  blocks.forEach(visit);
  return out;
}

const attrLower = ($el, name) => String($el.attr(name) || '').toLowerCase().trim();
const relHas = ($el, token) => attrLower($el, 'rel').split(/\s+/).includes(token);

// ---------------------------------------------------- GEO (yapay zekâ aramaları) sinyalleri
const QUESTION_HEAD = /\?\s*$|^(ne|neden|nasıl|niçin|nedir|kim|hangi|kaç|ne zaman|nerede|what|why|how|when|where|who|which|can|does|is|are|should)\b/iu;
const SUMMARY_HEAD = /(özet|kısaca|önemli noktalar|öne çıkanlar|sonuç|summary|key takeaways|tl;?dr|in short|at a glance|conclusion)/iu;
const STAT_RE = /(\d+([.,]\d+)?\s?%|%\s?\d+|\b\d+([.,]\d+)?\s?(milyon|milyar|bin|million|billion|thousand|kg|km|cm|mm|ml|tl|₺|usd|eur|€|\$|dakika|saat|gün|hafta|ay|yıl|minutes?|hours?|days?|weeks?|months?|years?)\b)/giu;
const SOCIAL_HOST = /(^|\.)(facebook|instagram|twitter|x|linkedin|youtube|youtu|tiktok|pinterest|t|wa|whatsapp|telegram|threads)\.(com|me|be|net)$/i;
const wordsOf = (s) => (String(s).match(/[\p{L}\p{N}]+/gu) || []).length;

/** Başlığın ardından gelen ilk metin bloğu (sonraki başlığa kadar). */
function firstBlockAfter($, el) {
  let n = $(el).next();
  for (let i = 0; i < 4 && n.length; i++, n = n.next()) {
    if (/^h[1-6]$/i.test(n[0].tagName)) return '';
    const t = n.text().replace(/\s+/g, ' ').trim();
    if (t) return t;
  }
  return '';
}

/**
 * Yapay zekâ yanıt motorlarının (AI Overview, ChatGPT, Perplexity) alıntılamayı tercih ettiği içerik yapısı:
 * soru biçimli başlıklar, başlığın hemen altında kısa ve net yanıt, liste/tablo, veri ve kaynak gösterimi, yazar ve özet.
 */
function geoSignals($, $main, { jsShell, author, words }) {
  const heads = $main.find('h2, h3');
  let questions = 0;
  let answered = 0;
  heads.each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (QUESTION_HEAD.test(text)) questions++;
    const w = wordsOf(firstBlockAfter($, el));
    if (w >= 15 && w <= 90) answered++;
  });
  const paras = $main.find('p').map((_, el) => wordsOf($(el).text())).get().filter((w) => w >= 5);
  const intro = paras[0] || 0;
  const citations = new Set();
  $main.find('a[href^="http"]').each((_, el) => {
    try {
      const h = new URL($(el).attr('href')).hostname.replace(/^www\./, '');
      if (!SOCIAL_HOST.test(h)) citations.add(h);
    } catch {
      /* geçersiz bağlantı */
    }
  });
  const mainText = $main.text();
  return {
    headings: heads.length,
    questions,
    answered,
    lists: $main.find('ul, ol').filter((_, el) => $(el).children('li').length >= 3).length,
    tables: $main.find('table').filter((_, el) => $(el).find('tr').length >= 2).length,
    stats: Math.min(200, (mainText.match(STAT_RE) || []).length),
    citations: citations.size,
    author,
    summary: $main.find('h2, h3, h4, strong, b').filter((_, el) => SUMMARY_HEAD.test($(el).text())).length > 0,
    paras: paras.length,
    longParas: paras.filter((w) => w > 120).length,
    introWords: intro,
    jsShell: jsShell && words < 120,
  };
}

/**
 * Tek bir HTML sayfasını analiz eder.
 * @returns {{ data: object, issues: {code:string, detail?:string}[], links: string[] }}
 */
export function analyzePage(res, siteHost) {
  const issues = [];
  const add = (code, detail) => issues.push({ code, detail: detail ? String(detail).slice(0, 500) : null });
  const pageUrl = new URL(res.finalUrl);
  const $ = cheerio.load(res.body);
  const meta = (name) =>
    $('meta').filter((_, el) => attrLower($(el), 'name') === name || attrLower($(el), 'property') === name).first().attr('content')?.trim() || '';

  // ---------------------------------------------------- İndeksleme
  const robotsMeta = `${meta('robots')},${meta('googlebot')}`.toLowerCase();
  const xRobots = String(res.headers['x-robots-tag'] || '').toLowerCase();
  const noindex = robotsMeta.includes('noindex') || xRobots.includes('noindex');
  if (noindex) add('noindex', xRobots.includes('noindex') ? 'X-Robots-Tag başlığı' : 'meta robots');

  const canonicals = $('link').filter((_, el) => relHas($(el), 'canonical'));
  let canonical = null;
  if (canonicals.length === 0) add('canonical_missing');
  else {
    if (canonicals.length > 1) add('canonical_multiple', `${canonicals.length} etiket`);
    const href = canonicals.first().attr('href');
    canonical = href ? normalizeUrl(href, pageUrl) : null;
    if (!canonical) add('canonical_invalid', href || '(boş)');
    else if (new URL(canonical).hostname !== pageUrl.hostname) add('canonical_invalid', `Farklı alan adı: ${canonical}`);
    else if (canonical !== normalizeUrl(pageUrl.href)) add('canonical_other', canonical);
  }

  const hreflangs = [];
  $('link[hreflang]').each((_, el) => {
    const v = $(el).attr('hreflang')?.trim() || '';
    if (!HREFLANG_RE.test(v)) add('hreflang_invalid', v || '(boş)');
    const href = normalizeUrl($(el).attr('href'), pageUrl);
    if (href && hreflangs.length < 100) hreflangs.push({ lang: v.toLowerCase(), href });
  });

  // ---------------------------------------------------- Teknik
  if (!$('meta').filter((_, el) => attrLower($(el), 'name') === 'viewport').length) add('viewport_missing');
  if (!$('html').attr('lang')) add('lang_missing');
  const hasCharset =
    $('meta[charset]').length > 0 ||
    $('meta').filter((_, el) => attrLower($(el), 'http-equiv') === 'content-type').length > 0 ||
    /charset=/i.test(String(res.headers['content-type'] || ''));
  if (!hasCharset) add('charset_missing');

  let path = pageUrl.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    /* bozuk yüzde kodlaması: ham yolu kullan */
  }
  if (/[A-ZÇĞİÖŞÜ]/.test(path)) add('url_uppercase');
  if (path.includes('_')) add('url_underscore');
  if (pageUrl.href.length > 115) add('url_too_long', `${pageUrl.href.length} karakter`);

  // ---------------------------------------------------- Performans
  if (res.ttfb > 800) add('slow_response', `${res.ttfb} ms`);
  if (res.decodedBytes > 1024 * 1024) add('page_too_large', `${Math.round(res.decodedBytes / 1024)} KB`);
  if (!res.headers['content-encoding'] && res.decodedBytes > 1400) add('no_compression');

  // ---------------------------------------------------- İçerik
  const title = ($('head > title').first().text() || $('title').first().text()).replace(/\s+/g, ' ').trim();
  if (!title) add('title_missing');
  else if (title.length < 30) add('title_short', `${title.length} karakter`);
  else if (title.length > 60) add('title_long', `${title.length} karakter`);

  const description = meta('description').replace(/\s+/g, ' ');
  if (!description) add('meta_desc_missing');
  else if (description.length < 70) add('meta_desc_short', `${description.length} karakter`);
  else if (description.length > 160) add('meta_desc_long', `${description.length} karakter`);

  const h1s = $('h1');
  const h1 = h1s.first().text().replace(/\s+/g, ' ').trim();
  if (h1s.length === 0) add('h1_missing');
  else if (h1s.length > 1) add('h1_multiple', `${h1s.length} adet H1`);

  let prev = 0;
  let skipped = null;
  const outline = [];
  $('h1, h2, h3, h4, h5, h6').each((_, el) => {
    const level = Number(el.tagName[1]);
    if (prev && level > prev + 1 && !skipped) skipped = `H${prev} → H${level}`;
    prev = level;
    if (outline.length < 80) outline.push({ level, text: $(el).text().replace(/\s+/g, ' ').trim().slice(0, 200) });
  });
  if (skipped) add('heading_skip', skipped);

  const images = $('img');
  const noAltImgs = images.filter((_, el) => $(el).attr('alt') === undefined);
  if (noAltImgs.length) add('img_alt_missing', `${noAltImgs.length} görsel`);
  const alts = images.map((_, el) => $(el).attr('alt')?.trim()).get().filter(Boolean).slice(0, 200);

  // ---------------------------------------------------- Yapısal veri (metin temizliğinden önce)
  const jsonLd = $('script').filter((_, el) => attrLower($(el), 'type') === 'application/ld+json');
  const schemaTypes = new Set();
  const blocks = [];
  let invalidSchema = 0;
  jsonLd.each((_, el) => {
    try {
      const parsed = JSON.parse($(el).text());
      blocks.push(parsed);
      const collect = (node) => {
        if (Array.isArray(node)) return node.forEach(collect);
        if (node && typeof node === 'object') {
          [].concat(node['@type'] || []).forEach((t) => schemaTypes.add(String(t)));
          if (node['@graph']) collect(node['@graph']);
        }
      };
      collect(parsed);
    } catch {
      invalidSchema++;
    }
  });
  if (invalidSchema) add('schema_invalid', `${invalidSchema} blok`);
  if (!jsonLd.length && !$('[itemscope]').length) add('schema_missing');
  const schemaItems = validateJsonLd(blocks);
  const schemaErrors = schemaItems.flatMap((i) => i.errors);
  const schemaWarnings = schemaItems.flatMap((i) => i.warnings);
  if (schemaErrors.length) add('schema_errors', schemaErrors.slice(0, 3).join(' · '));
  if (schemaWarnings.length) add('schema_warnings', schemaWarnings.slice(0, 3).join(' · '));
  // İçerik yapısal veriye uygun ama ilgili tür işaretlenmemiş (ör. SSS bölümü var, FAQPage yok)
  const schemaHints = detectSchemaHints($, meta).filter((h) => !HINT_TYPES[h].some((t) => schemaTypes.has(t)));
  if (schemaHints.length) add('schema_opportunity', schemaHints.join(', '));

  // ---------------------------------------------------- Sosyal
  const ogMissing = ['og:title', 'og:description', 'og:image'].filter((k) => !meta(k));
  if (ogMissing.length) add('og_missing', ogMissing.join(', '));
  if (!meta('twitter:card')) add('twitter_missing');

  // ---------------------------------------------------- Güvenlik
  if (pageUrl.protocol === 'https:') {
    const insecure = new Set();
    $('script[src], img[src], iframe[src], video[src], audio[src], source[src], embed[src]').each((_, el) => {
      const src = $(el).attr('src') || '';
      if (/^http:\/\//i.test(src)) insecure.add(src);
    });
    $('link[href]').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (relHas($(el), 'stylesheet') && /^http:\/\//i.test(href)) insecure.add(href);
    });
    if (insecure.size) add('mixed_content', [...insecure].slice(0, 3).join(', '));
  }

  // ---------------------------------------------------- Bağlantılar
  const links = new Set();
  const anchors = new Map(); // hedef -> ilk boş olmayan anchor metni
  const external = new Set();
  let nofollowInternal = 0;
  let emptyAnchors = 0;
  $('a[href]').each((_, el) => {
    const $a = $(el);
    const target = normalizeUrl($a.attr('href'), pageUrl);
    if (!target) return;
    const internal = new URL(target).hostname === siteHost;
    if (internal) {
      links.add(target);
      if (relHas($a, 'nofollow')) nofollowInternal++;
    } else external.add(target);
    const text = $a.text().trim() || $a.attr('aria-label') || $a.attr('title') || $a.find('img[alt]').attr('alt');
    if (!text || !String(text).trim()) emptyAnchors++;
    else if (internal && !anchors.has(target)) anchors.set(target, String(text).replace(/\s+/g, ' ').trim().slice(0, 200));
  });
  if (nofollowInternal) add('nofollow_internal', `${nofollowInternal} bağlantı`);
  if (emptyAnchors) add('link_no_text', `${emptyAnchors} bağlantı`);

  // ---------------------------------------------------- Kelime sayısı & içerik metni
  // İçerik JavaScript ile mi oluşturuluyor? (yapay zekâ botlarının çoğu JS çalıştırmaz)
  const jsShell = $('script[src]').length > 0 && $('#root, #app, #__next, #__nuxt, [data-reactroot], app-root, [ng-version]').length > 0;
  const author = Boolean(
    meta('author') || meta('article:author') || $('[rel~="author"], [itemprop="author"], [class*="author" i], [class*="byline" i]').length
    || blocks.some((b) => JSON.stringify(b).includes('"author"')),
  );
  $('script, style, noscript, svg, template, iframe').remove();
  const words = $('body').text().split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  if (!noindex && words < 250) add('low_word_count', `${words} kelime`);

  // Anahtar kelime analizi için şablon alanlarını (menü, alt bilgi, formlar) çıkar, blokları ayır
  const $main = ($('main').length ? $('main').first() : $('body')).clone();
  $main.find('nav, header, footer, aside, form, button, [role="navigation"], [role="button"], [aria-hidden="true"]').remove();
  // "Devamını oku", "Projeye git" gibi tekrar eden CTA bağlantıları içerik değildir
  const anchorFreq = new Map();
  const anchorText = (el) => $(el).text().replace(/\s+/g, ' ').trim().toLowerCase();
  $main.find('a').each((_, el) => anchorFreq.set(anchorText(el), (anchorFreq.get(anchorText(el)) || 0) + 1));
  $main.find('a').filter((_, el) => anchorFreq.get(anchorText(el)) >= 3).remove();
  const geo = geoSignals($, $main, { jsShell, author, words });
  $main.find('p, div, li, td, th, br, section, article, h1, h2, h3, h4, h5, h6, dt, dd, blockquote, figcaption').append('\n');
  const bodyText = $main.text().replace(/[ \t\r\f\v]+/g, ' ').replace(/\n\s*/g, '\n').trim().slice(0, 200_000);
  const lang = $('html').attr('lang')?.trim().slice(0, 20) || null;
  const keywords = extractKeywords({
    title, h1, headings: outline.filter((h) => h.level > 1).map((h) => h.text), meta: description,
    path, body: bodyText, alts, lang,
  });

  const hasFavicon = $('link').filter((_, el) => relHas($(el), 'icon')).length > 0;
  const sd = schemaDates(blocks);
  const publishedAt = sd.published || isoDay(meta('article:published_time')) || isoDay($('article time[datetime]').first().attr('datetime'));
  const modifiedAt = sd.modified || isoDay(meta('article:modified_time')) || isoDay(meta('og:updated_time'));

  return {
    data: {
      title: title.slice(0, 500) || null,
      metaDescription: description.slice(0, 1000) || null,
      h1: h1.slice(0, 500) || null,
      wordCount: words,
      canonical,
      noindex,
      hasFavicon,
      schemaTypes: [...schemaTypes].slice(0, 20),
      lang,
      h2Count: outline.filter((h) => h.level === 2).length,
      internalLinks: links.size,
      externalLinks: external.size,
      images: images.length,
      imagesNoAlt: noAltImgs.length,
      contentWords: wordCountOf(bodyText),
      hreflangs,
      schemaReport: schemaItems.length || schemaHints.length ? { items: schemaItems, hints: schemaHints } : null,
      // İçerik brief'i ve rakip karşılaştırması için H2/H3 yapısı
      outline: outline.filter((h) => (h.level === 2 || h.level === 3) && h.text).slice(0, 60).map((h) => ({ level: h.level, text: h.text.slice(0, 160) })),
      publishedAt,
      modifiedAt,
      geo,
    },
    keywords,
    // Tek sayfa analizi (analyze uç noktası) için; tarama bunları saklamaz
    content: {
      outline, bodyText, alts, ogTitle: meta('og:title'), ogDescription: meta('og:description'), ogImage: meta('og:image'),
      twitterCard: meta('twitter:card'), noAltSamples: noAltImgs.map((_, el) => $(el).attr('src')).get().filter(Boolean).slice(0, 10),
    },
    issues,
    links: [...links].slice(0, 1000),
    anchors,
  };
}
