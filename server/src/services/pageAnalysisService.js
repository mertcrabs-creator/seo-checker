import { badRequest } from '../utils/httpError.js';
import { safeFetch } from '../utils/safeFetch.js';
import { CATEGORIES, ISSUES, pageScore } from './audit/issueCatalog.js';
import { phraseCount, slugify, wordCountOf } from './audit/keywordExtractor.js';
import { analyzePage } from './audit/pageAnalyzer.js';

/**
 * Herhangi bir herkese açık URL için anlık sayfa içi SEO analizi (kendi siteniz veya rakip).
 * Search Console veya üçüncü taraf veri sağlayıcı gerektirmez.
 */

const isHtml = (res) => /text\/html|application\/xhtml/i.test(String(res.headers?.['content-type'] || ''));
const SEVERITY_ORDER = { critical: 0, warning: 1, notice: 2 };
const safeDecode = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};
const FETCH_ERRORS = { EBLOCKED: 'Bu adres analiz edilemez', ETIMEOUT: 'Sayfa zamanında yanıt vermedi' };

function keywordChecks(keyword, a, pageUrl) {
  const { data, content } = a;
  const lang = data.lang;
  const has = (text) => phraseCount(text, keyword, lang) > 0;
  const first100 = (content.bodyText.match(/[\p{L}\p{N}]+/gu) || []).slice(0, 100).join(' ');
  const subheads = content.outline.filter((h) => h.level > 1).map((h) => h.text);
  const occurrences = phraseCount(content.bodyText, keyword, lang);
  const n = Math.max(1, wordCountOf(keyword));
  const words = Math.max(1, data.contentWords);
  const density = Math.round(((occurrences * n) / words) * 10_000) / 100;
  const titleLower = String(data.title || '').toLocaleLowerCase(lang?.startsWith('tr') ? 'tr' : 'en');
  const kwLower = keyword.toLocaleLowerCase(lang?.startsWith('tr') ? 'tr' : 'en');

  const checks = [
    {
      key: 'title', label: 'Title içinde geçiyor', pass: has(data.title || ''),
      tip: 'Hedef kelimeyi title etiketine, tercihen başa yakın yerleştirin.',
    },
    {
      key: 'title_start', label: 'Title başında geçiyor', pass: titleLower.indexOf(kwLower) >= 0 && titleLower.indexOf(kwLower) <= 10,
      tip: 'Title’ın ilk kelimelerindeki terimler arama sonuçlarında daha güçlü sinyal verir.',
    },
    { key: 'h1', label: 'H1 içinde geçiyor', pass: has(data.h1 || ''), tip: 'Sayfanın ana başlığı hedef kelimeyi içermeli.' },
    {
      key: 'meta', label: 'Meta açıklamada geçiyor', pass: has(data.metaDescription || ''),
      tip: 'Arama sonuçlarında eşleşen kelimeler kalın gösterilir ve tıklama oranını artırır.',
    },
    {
      key: 'url', label: 'URL’de geçiyor', pass: `-${slugify(safeDecode(pageUrl.pathname))}-`.includes(`-${slugify(keyword)}-`),
      tip: 'Kısa ve kelimeyi içeren URL’ler (örn. /kirmizi-elbise) tercih edin.',
    },
    { key: 'intro', label: 'İlk 100 kelimede geçiyor', pass: has(first100), tip: 'Konuyu ilk paragrafta netleştirin.' },
    {
      key: 'subheads', label: 'Alt başlıklarda (H2–H6) geçiyor', pass: subheads.some(has),
      value: `${subheads.filter(has).length}/${subheads.length}`,
      tip: 'En az bir alt başlıkta kelimeyi veya yakın varyasyonunu kullanın.',
    },
    {
      key: 'alt', label: 'Görsel alt metninde geçiyor', pass: content.alts.some(has),
      tip: 'İlgili bir görselin alt metninde kelimeyi doğal şekilde kullanın.',
    },
    {
      key: 'density', label: 'Kelime yoğunluğu %0,5–3 arasında', pass: density >= 0.5 && density <= 3, value: `%${density.toLocaleString('tr-TR')}`,
      tip: density > 3 ? 'Kelime aşırı tekrar ediliyor (keyword stuffing); eş anlamlılarla çeşitlendirin.' : 'Kelimeyi içerikte daha fazla ve doğal şekilde kullanın.',
    },
    {
      key: 'length', label: 'İçerik en az 300 kelime', pass: data.contentWords >= 300, value: `${data.contentWords} kelime`,
      tip: 'Rekabetçi kelimelerde konuyu kapsamlı ele alan uzun içerikler daha iyi sıralanır.',
    },
  ];
  return {
    keyword,
    occurrences,
    density,
    score: Math.round((checks.filter((c) => c.pass).length / checks.length) * 100),
    checks,
  };
}

export async function analyzeUrl(rawUrl, keyword) {
  let res;
  try {
    res = await safeFetch(rawUrl, { timeoutMs: 20_000 });
  } catch (err) {
    if (err.code === 'EBADURL') throw badRequest(err.message);
    throw badRequest(FETCH_ERRORS[err.code] || `Sayfaya ulaşılamadı: ${err.message}`);
  }
  if (res.status !== 200) throw badRequest(`Sayfa HTTP ${res.status} döndürdü`);
  if (!isHtml(res)) throw badRequest('Adres bir HTML sayfası değil');

  const pageUrl = new URL(res.finalUrl);
  const a = analyzePage(res, pageUrl.hostname);

  const grouped = new Map();
  for (const i of a.issues) {
    const def = ISSUES[i.code];
    if (!def || def.siteLevel) continue;
    const g = grouped.get(i.code) || { code: i.code, ...def, categoryLabel: CATEGORIES[def.category], details: [] };
    if (i.detail && g.details.length < 10) g.details.push(i.detail);
    grouped.set(i.code, g);
  }
  const issues = [...grouped.values()].sort((x, y) => SEVERITY_ORDER[x.severity] - SEVERITY_ORDER[y.severity]);
  const h = res.headers;

  return {
    url: rawUrl,
    finalUrl: res.finalUrl,
    analyzedAt: new Date().toISOString(),
    score: pageScore(a.issues.map((i) => i.code)),
    response: {
      status: res.status,
      redirects: res.redirects,
      ttfb: res.ttfb,
      totalMs: res.totalMs,
      bytes: res.bytes,
      decodedBytes: res.decodedBytes,
      compression: h['content-encoding'] || null,
      server: h.server ? String(h.server).slice(0, 100) : null,
      https: pageUrl.protocol === 'https:',
      hsts: Boolean(h['strict-transport-security']),
      xRobotsTag: h['x-robots-tag'] ? String(h['x-robots-tag']).slice(0, 200) : null,
    },
    page: a.data,
    social: {
      ogTitle: a.content.ogTitle || null,
      ogDescription: a.content.ogDescription || null,
      ogImage: a.content.ogImage || null,
      twitterCard: a.content.twitterCard || null,
    },
    outline: a.content.outline,
    imagesWithoutAlt: a.content.noAltSamples,
    issues,
    keywords: a.keywords,
    target: keyword ? keywordChecks(keyword, a, pageUrl) : null,
  };
}
