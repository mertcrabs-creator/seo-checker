import * as cheerio from 'cheerio';
import { config } from '../../config.js';
import { query } from '../../db/pool.js';
import { safeFetch } from '../../utils/safeFetch.js';
import { isAllowed, parseRobots } from '../audit/robots.js';

/**
 * GEO (Generative Engine Optimization): sitenin yapay zekâ yanıt motorlarında (Google AI Overview / AI Mode,
 * ChatGPT, Perplexity, Claude, Copilot) kaynak gösterilmeye ne kadar hazır olduğu.
 * Beş eksen: erişim (botlar, CDN, JS), içerik yapısı, güven (E-E-A-T), varlık (marka/entity) ve görünürlük (AI Overview atıfları).
 * Sayfa sinyalleri son taramadan (audit_pages.geo), site düzeyi kontroller canlı olarak alınır.
 */

/** purpose: search = yanıt/arama dizini (atıf için kritik), user = kullanıcı isteğiyle anlık okuma, training = model eğitimi (tercih). */
export const AI_BOTS = [
  { agent: 'Googlebot', company: 'Google', product: 'Google Arama, AI Overview ve AI Mode', purpose: 'search' },
  { agent: 'Bingbot', company: 'Microsoft', product: 'Bing, Copilot (ChatGPT arama da Bing dizinini kullanır)', purpose: 'search' },
  { agent: 'OAI-SearchBot', company: 'OpenAI', product: 'ChatGPT arama sonuçları', purpose: 'search' },
  { agent: 'ChatGPT-User', company: 'OpenAI', product: 'ChatGPT kullanıcı isteğiyle sayfa okuma', purpose: 'user' },
  { agent: 'GPTBot', company: 'OpenAI', product: 'Model eğitimi', purpose: 'training' },
  { agent: 'Claude-SearchBot', company: 'Anthropic', product: 'Claude arama sonuçları', purpose: 'search' },
  { agent: 'Claude-User', company: 'Anthropic', product: 'Claude kullanıcı isteğiyle sayfa okuma', purpose: 'user' },
  { agent: 'ClaudeBot', company: 'Anthropic', product: 'Model eğitimi', purpose: 'training' },
  { agent: 'PerplexityBot', company: 'Perplexity', product: 'Perplexity arama dizini', purpose: 'search' },
  { agent: 'Perplexity-User', company: 'Perplexity', product: 'Perplexity kullanıcı isteğiyle sayfa okuma', purpose: 'user' },
  { agent: 'Google-Extended', company: 'Google', product: 'Gemini eğitimi ve grounding', purpose: 'training' },
  { agent: 'Applebot', company: 'Apple', product: 'Siri / Spotlight önerileri', purpose: 'search' },
  { agent: 'Applebot-Extended', company: 'Apple', product: 'Apple Intelligence eğitimi', purpose: 'training' },
  { agent: 'DuckAssistBot', company: 'DuckDuckGo', product: 'DuckAssist yanıtları', purpose: 'search' },
  { agent: 'Amazonbot', company: 'Amazon', product: 'Alexa / Rufus yanıtları', purpose: 'search' },
  { agent: 'meta-externalagent', company: 'Meta', product: 'Meta AI eğitimi', purpose: 'training' },
  { agent: 'CCBot', company: 'Common Crawl', product: 'Açık veri seti (birçok model eğitiminde kullanılır)', purpose: 'training' },
  { agent: 'Bytespider', company: 'ByteDance', product: 'Model eğitimi', purpose: 'training' },
];

// CDN / WAF engeli testi için gerçek bot User-Agent dizeleri
const UA_TESTS = [
  { agent: 'GPTBot', ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)' },
  { agent: 'OAI-SearchBot', ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot' },
  { agent: 'ClaudeBot', ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)' },
  { agent: 'PerplexityBot', ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)' },
];
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const CHALLENGE = /(just a moment|challenge-platform|cf-chl|attention required|access denied|captcha|ddos-guard|sucuri website firewall|request blocked)/i;
const KNOWLEDGE = /(wikipedia\.org|wikidata\.org|linkedin\.com|crunchbase\.com|g\.page|maps\.google|google\.com\/maps|instagram\.com|facebook\.com|youtube\.com|x\.com|twitter\.com)/i;
const ORG_TYPE = /^(Organization|Corporation|LocalBusiness|OnlineBusiness|OnlineStore|NGO|NewsMediaOrganization|MedicalOrganization|EducationalOrganization|.*Store|.*Business|.*Service|Restaurant|Hotel|Dentist|MedicalClinic|Physician|Attorney|RealEstateAgent|HairSalon|BeautySalon|ExerciseGym|TravelAgency)$/;
const ABOUT_RE = /(hakk[ıi]m[ıi]zda|kurumsal|about|biz-kimiz|who-we-are|ekibimiz|team)/i;
const CONTACT_RE = /(ileti[sş]im|contact|bize-ulasin)/i;
const FRESH_DAYS = 365;

const tryFetch = (url, opts) => safeFetch(url, { timeoutMs: 12_000, maxBytes: 3 * 1024 * 1024, ...opts }).catch((error) => ({ error }));
const isHtml = (res) => /text\/html|application\/xhtml/i.test(String(res.headers?.['content-type'] || ''));
const textWords = (html) => {
  const $ = cheerio.load(html || '');
  $('script, style, noscript, svg').remove();
  return ($('body').text().match(/[\p{L}\p{N}]+/gu) || []).length;
};
const clamp = (v) => Math.max(0, Math.min(100, Math.round(v)));
const share = (list, f) => (list.length ? list.filter(f).length / list.length : 0);

// ------------------------------------------------------------------ Canlı site kontrolleri
export async function robotsAccess(origin, samplePaths) {
  const res = await tryFetch(`${origin}/robots.txt`, { maxBytes: 512 * 1024 });
  const found = !res.error && res.status === 200 && !isHtml(res);
  const text = found ? res.body : '';
  return {
    found,
    bots: AI_BOTS.map((b) => {
      const r = parseRobots(text, b.agent.toLowerCase());
      const blockedPages = samplePaths.filter((p) => !isAllowed(r.rules, p)).length;
      return { ...b, allowed: !r.blocksAll, explicit: r.explicit, blockedPages, sampled: samplePaths.length };
    }),
  };
}

/** Aynı sayfayı tarayıcı ve AI botu User-Agent'ıyla ister: CDN/WAF (ör. Cloudflare "AI botlarını engelle") engelini yakalar. */
export async function cdnAccess(url) {
  const base = await tryFetch(url, { headers: { 'User-Agent': BROWSER_UA } });
  const baseWords = base.error ? 0 : textWords(base.body);
  // Tarayıcı isteği de engelleniyorsa (sunucumuzun IP'si engelli) bot özelinde bir sonuç çıkarılamaz
  const inconclusive = Boolean(base.error) || base.status >= 400 || Boolean(base.headers['cf-mitigated']) || (CHALLENGE.test(base.body.slice(0, 20_000)) && baseWords < 150);
  const tests = await Promise.all(UA_TESTS.map(async (t) => {
    const r = await tryFetch(url, { headers: { 'User-Agent': t.ua } });
    if (inconclusive) return { agent: t.agent, status: r.error ? null : r.status, blocked: false, inconclusive: true, reason: null };
    if (r.error) return { agent: t.agent, status: null, blocked: true, reason: r.error.message };
    const words = textWords(r.body);
    const challenge = Boolean(r.headers['cf-mitigated']) || (CHALLENGE.test(r.body.slice(0, 20_000)) && words < baseWords * 0.5);
    const blocked = r.status >= 400 || challenge || (baseWords >= 100 && words < baseWords * 0.3);
    return {
      agent: t.agent, status: r.status, words, blocked,
      reason: blocked ? (r.status >= 400 ? `HTTP ${r.status}` : challenge ? 'Doğrulama / bot sayfası' : 'İçerik büyük ölçüde boş') : null,
    };
  }));
  return { url, baseStatus: base.error ? null : base.status, baseWords, inconclusive, tests, server: base.headers?.server || null, cdn: base.headers?.['cf-ray'] ? 'Cloudflare' : null, html: base.error ? null : base.body };
}

export async function llmsTxt(origin) {
  const check = async (path) => {
    const r = await tryFetch(`${origin}${path}`, { maxBytes: 2 * 1024 * 1024 });
    if (r.error || r.status !== 200) return { path, found: false };
    if (isHtml(r) || /^\s*</.test(r.body)) return { path, found: false, softError: true };
    const body = r.body;
    return {
      path, found: true, bytes: body.length,
      hasTitle: /^#\s+\S/m.test(body),
      hasSummary: /^>\s+\S/m.test(body),
      sections: (body.match(/^##\s+\S/gm) || []).length,
      links: (body.match(/\[[^\]]+\]\(https?:\/\/[^)]+\)/g) || []).length,
    };
  };
  const [main, full] = await Promise.all([check('/llms.txt'), check('/llms-full.txt')]);
  return { main, full };
}

/** Ana sayfadaki kuruluş işaretlemesi ve marka profilleri. */
export function entityInfo(html) {
  const out = { orgType: null, name: null, sameAs: [], knowledge: [], website: false, logo: false };
  if (!html) return out;
  const $ = cheerio.load(html);
  const nodes = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const visit = (n) => {
        if (Array.isArray(n)) return n.forEach(visit);
        if (!n || typeof n !== 'object') return;
        if (n['@type']) nodes.push(n);
        if (n['@graph']) visit(n['@graph']);
      };
      visit(JSON.parse($(el).text()));
    } catch {
      /* geçersiz JSON-LD: Yapısal veri raporunda gösteriliyor */
    }
  });
  const types = (n) => [].concat(n['@type']).map(String);
  const org = nodes.find((n) => types(n).some((t) => ORG_TYPE.test(t)));
  if (org) {
    out.orgType = types(org).find((t) => ORG_TYPE.test(t));
    out.name = typeof org.name === 'string' ? org.name : null;
    out.sameAs = [].concat(org.sameAs || []).filter((s) => typeof s === 'string').slice(0, 30);
    out.logo = Boolean(org.logo);
  }
  out.website = nodes.some((n) => types(n).includes('WebSite'));
  // Sayfadaki sosyal/bilgi profili bağlantıları (sameAs'e eklenmeye aday)
  const links = new Set();
  $('a[href^="http"]').each((_, el) => {
    const h = $(el).attr('href');
    if (KNOWLEDGE.test(h) && !/share|sharer|intent\/tweet|\/search/i.test(h)) links.add(h.split('?')[0]);
  });
  out.profileLinks = [...links].slice(0, 20);
  out.knowledge = out.sameAs.filter((s) => /wikipedia\.org|wikidata\.org/i.test(s));
  return out;
}

// ------------------------------------------------------------------ Sayfa puanı
/** Sayfanın AI yanıtlarında alıntılanmaya hazırlığı (0-100) ve eksikleri. */
export function pageGeoScore(p) {
  const g = p.geo;
  if (!g) return null;
  const fresh = (p.modified_at || p.published_at) && Date.now() - Date.parse(p.modified_at || p.published_at) < FRESH_DAYS * 86_400_000;
  const longForm = (p.word_count || 0) >= 600;
  const checks = [
    { code: 'question_headings', ok: g.questions > 0, w: 15 },
    { code: 'direct_answers', ok: g.headings ? g.answered / g.headings >= 0.4 : false, w: 20 },
    { code: 'intro_answer', ok: g.introWords >= 20 && g.introWords <= 90, w: 10 },
    { code: 'lists_tables', ok: g.lists + g.tables > 0, w: 10 },
    { code: 'stats', ok: g.stats >= 3, w: 10 },
    { code: 'citations', ok: g.citations >= 1, w: 10 },
    { code: 'author', ok: g.author, w: 10 },
    { code: 'freshness', ok: Boolean(fresh), w: 10 },
    { code: 'schema', ok: (p.schema_types || []).length > 0, w: 5 },
  ];
  if (longForm) checks.push({ code: 'summary', ok: g.summary, w: 5 }, { code: 'long_paragraphs', ok: g.longParas === 0, w: 5 });
  const total = checks.reduce((s, c) => s + c.w, 0);
  let score = (checks.filter((c) => c.ok).reduce((s, c) => s + c.w, 0) / total) * 100;
  if (g.jsShell) score = Math.min(score, 20);
  return { score: clamp(score), missing: [...(g.jsShell ? ['js_rendered'] : []), ...checks.filter((c) => !c.ok).map((c) => c.code)] };
}

// ------------------------------------------------------------------ llms.txt üretici
function brandOf(title, hostname) {
  const parts = String(title || '').split(/\s[|\-–—:·]\s/).map((s) => s.trim()).filter(Boolean);
  const host = hostname.replace(/^www\./, '').split('.')[0];
  return parts.find((p) => p.toLowerCase().replace(/\s/g, '').includes(host.toLowerCase())) || parts.at(-1) || host;
}

export function buildLlmsTxt({ hostname, home, pages }) {
  const name = brandOf(home?.title, hostname);
  const L = [`# ${name}`, ''];
  if (home?.meta_description) L.push(`> ${home.meta_description.replace(/\s+/g, ' ').trim()}`, '');
  const groups = new Map();
  for (const p of pages) {
    if (p.depth === 0) continue;
    // Tek parçalı (düz) URL'ler ana sayfalardır; bölüm yalnızca alt dizinli URL'lerden oluşur
    let seg = 'Sayfalar';
    try {
      const parts = new URL(p.url).pathname.split('/').filter(Boolean);
      if (parts.length >= 2) seg = decodeURIComponent(parts[0]);
    } catch {
      /* bozuk URL */
    }
    if (!groups.has(seg)) groups.set(seg, []);
    groups.get(seg).push(p);
  }
  const ordered = [...groups.entries()]
    .map(([seg, list]) => [seg, list.sort((a, b) => b.inlinks - a.inlinks)])
    .sort((a, b) => b[1].reduce((s, p) => s + p.inlinks, 0) - a[1].reduce((s, p) => s + p.inlinks, 0))
    .slice(0, 12);
  for (const [seg, list] of ordered) {
    const label = seg.replace(/[-_]+/g, ' ').replace(/^\p{L}/u, (c) => c.toLocaleUpperCase('tr'));
    L.push(`## ${label}`, '');
    for (const p of list.slice(0, 12)) {
      const title = (p.title || p.h1 || p.url).split(/\s[|\-–—]\s/)[0].trim();
      const desc = p.meta_description ? `: ${p.meta_description.replace(/\s+/g, ' ').trim().slice(0, 160)}` : '';
      L.push(`- [${title}](${p.url})${desc}`);
    }
    L.push('');
  }
  return L.join('\n').trim() + '\n';
}

// ------------------------------------------------------------------ Rapor
const ROBOTS_SNIPPET = (agents) => agents.map((a) => `User-agent: ${a}\nAllow: /`).join('\n\n');

export async function geoReport(domain) {
  const { rows: [audit] } = await query(
    `SELECT id, site_info FROM audits WHERE domain_id = $1 AND status = 'completed' ORDER BY created_at DESC LIMIT 1`,
    [domain.id],
  );
  if (!audit) return { needsAudit: true };
  const { rows: pages } = await query(
    `SELECT url, title, h1, meta_description, depth, word_count, inlinks, schema_types, geo, published_at::text, modified_at::text
       FROM audit_pages WHERE audit_id = $1 AND status_code = 200 AND NOT noindex AND (canonical IS NULL OR canonical = url)`,
    [audit.id],
  );
  const withGeo = pages.filter((p) => p.geo);
  if (pages.length && !withGeo.length) return { needsRecrawl: true };

  const origin = (() => {
    try {
      return new URL(audit.site_info?.finalUrl || `https://${domain.hostname}/`).origin;
    } catch {
      return `https://${domain.hostname}`;
    }
  })();
  const home = pages.find((p) => p.depth === 0) || null;
  const important = [...pages].sort((a, b) => b.inlinks - a.inlinks).slice(0, 50);
  const samplePaths = important.map((p) => {
    const u = new URL(p.url);
    return u.pathname + u.search;
  });

  const [robots, cdn, llms, aio] = await Promise.all([
    robotsAccess(origin, samplePaths),
    cdnAccess(home?.url || `${origin}/`),
    llmsTxt(origin),
    aiOverviewStats(domain),
  ]);
  const entity = entityInfo(cdn.html);
  delete cdn.html;

  // ---------------------------------------------------- Sayfalar
  const content = withGeo.filter((p) => (p.word_count || 0) >= 300);
  const scored = withGeo.map((p) => ({ ...p, ...pageGeoScore(p) }));
  const contentScored = scored.filter((p) => (p.word_count || 0) >= 300);
  const jsPages = withGeo.filter((p) => p.geo.jsShell);
  const avg = (list) => (list.length ? list.reduce((s, p) => s + p.score, 0) / list.length : 0);
  const missingCount = (code) => contentScored.filter((p) => p.missing.includes(code));
  const aboutPage = pages.find((p) => ABOUT_RE.test(p.url) || ABOUT_RE.test(p.title || ''));
  const contactPage = pages.find((p) => CONTACT_RE.test(p.url) || CONTACT_RE.test(p.title || ''));
  const fresh = share(content, (p) => (p.modified_at || p.published_at) && Date.now() - Date.parse(p.modified_at || p.published_at) < FRESH_DAYS * 86_400_000);
  const dated = share(content, (p) => p.modified_at || p.published_at);

  // ---------------------------------------------------- Eksen puanları
  const searchBots = robots.bots.filter((b) => b.purpose !== 'training');
  const blockedSearch = searchBots.filter((b) => !b.allowed);
  const partialSearch = searchBots.filter((b) => b.allowed && b.blockedPages > 0);
  const cdnBlocked = cdn.tests.filter((t) => t.blocked);
  const jsShare = share(withGeo, (p) => p.geo.jsShell);
  const access = clamp(
    100 - blockedSearch.length * 15 - partialSearch.length * 4 - cdnBlocked.length * 12 - jsShare * 50
    - (llms.main.found ? 0 : 8) - (audit.site_info?.sitemap?.found ? 0 : 10),
  );
  const structure = clamp(avg(contentScored));
  const trust = clamp(
    share(content, (p) => p.geo.author) * 35 + fresh * 30 + share(content, (p) => p.geo.citations > 0) * 15 + (aboutPage ? 10 : 0) + (contactPage ? 10 : 0),
  );
  const entityScore = clamp(
    (entity.orgType ? 35 : 0) + Math.min(entity.sameAs.length, 5) * 7 + (entity.knowledge.length ? 15 : 0) + (entity.website ? 10 : 0) + (entity.logo ? 5 : 0),
  );
  const visibility = aio.withAio ? clamp((aio.cited / aio.withAio) * 100) : null;
  const axes = [
    { key: 'access', label: 'Erişim', score: access, weight: 30, tip: 'AI botları siteye girebiliyor mu, içerik JavaScript olmadan okunuyor mu?' },
    { key: 'structure', label: 'İçerik yapısı', score: content.length ? structure : null, weight: 30, tip: 'Soru-yanıt düzeni, kısa net yanıtlar, liste/tablo, veri' },
    { key: 'trust', label: 'Güven (E-E-A-T)', score: content.length ? trust : null, weight: 20, tip: 'Yazar, güncellik, kaynak gösterimi, hakkımızda/iletişim' },
    { key: 'entity', label: 'Marka varlığı', score: entityScore, weight: 10, tip: 'Organization işaretlemesi, sameAs profilleri, Wikipedia/Wikidata' },
    { key: 'visibility', label: 'AI görünürlüğü', score: visibility, weight: 10, tip: 'Takip edilen kelimelerde AI Overview’da kaynak gösterilme oranı' },
  ];
  const active = axes.filter((a) => a.score !== null);
  const overall = clamp(active.reduce((s, a) => s + a.score * a.weight, 0) / active.reduce((s, a) => s + a.weight, 0));

  // ---------------------------------------------------- Öneriler
  const recs = [];
  const sample = (list) => list.slice(0, 25).map((p) => ({ url: p.url, title: p.title }));
  const add = (r) => recs.push(r);

  if (blockedSearch.length) {
    add({
      id: 'robots_search_blocked', priority: 'high', category: 'access',
      title: `${blockedSearch.length} AI arama botu robots.txt ile engelli`,
      detail: `${blockedSearch.map((b) => `${b.agent} (${b.company})`).join(', ')} siteyi okuyamıyor. Bu botlar engelliyken ilgili yapay zekâ ürünlerinde kaynak olarak gösterilemezsiniz.`,
      steps: ['robots.txt dosyasında bu botlar için Disallow: / kuralını kaldırın veya aşağıdaki izinleri ekleyin.', 'Eğitim botlarını (GPTBot, ClaudeBot, Google-Extended) engellemek ayrı bir tercihtir; arama botlarını etkilemez.'],
      code: ROBOTS_SNIPPET(blockedSearch.map((b) => b.agent)),
    });
  }
  if (partialSearch.length) {
    const b = partialSearch[0];
    add({
      id: 'robots_search_partial', priority: 'medium', category: 'access',
      title: 'Önemli sayfaların bir kısmı AI arama botlarına kapalı',
      detail: `${partialSearch.map((x) => x.agent).join(', ')} için en çok iç bağlantı alan ${b.sampled} sayfadan ${b.blockedPages} tanesi robots.txt ile engelli.`,
      steps: ['robots.txt’deki Disallow kurallarının yalnızca yönetim, sepet, arama gibi değersiz sayfaları kapsadığından emin olun.'],
    });
  }
  if (cdnBlocked.length) {
    add({
      id: 'cdn_blocked', priority: 'high', category: 'access',
      title: `Sunucu/CDN ${cdnBlocked.length} AI botunu engelliyor olabilir`,
      detail: `${cdnBlocked.map((t) => `${t.agent}: ${t.reason}`).join(' · ')}. robots.txt izin verse bile güvenlik duvarı botu reddediyorsa içerik okunamaz.${cdn.cdn ? ` Site ${cdn.cdn} arkasında.` : ''}`,
      steps: [
        cdn.cdn === 'Cloudflare' ? 'Cloudflare → Security → Bots: “Block AI bots / AI Scrapers and Crawlers” ayarını kapatın veya yalnızca eğitim botlarıyla sınırlayın.' : 'Güvenlik duvarı (WAF) / bot koruması kurallarında AI arama botlarını (OAI-SearchBot, PerplexityBot, Claude-SearchBot) izinli listeye ekleyin.',
        'Not: test sunucumuzun IP’siyle yapıldı; gerçek botlar doğrulanmış IP’lerden gelir. Sonucu sunucu loglarıyla (Log analizi) teyit edin.',
      ],
    });
  }
  if (jsPages.length) {
    add({
      id: 'js_rendered', priority: jsShare > 0.3 ? 'high' : 'medium', category: 'access',
      title: `${jsPages.length} sayfanın içeriği JavaScript ile oluşturuluyor`,
      detail: 'ChatGPT, Claude ve Perplexity botları JavaScript çalıştırmaz; ham HTML’de içerik yoksa sayfa onlar için boştur. Google da render kuyruğu nedeniyle geç işler.',
      steps: ['Sunucu taraflı render (SSR) veya statik ön-render (SSG) kullanın (Next.js, Nuxt, Astro, prerender).', 'En azından başlık, giriş paragrafı ve ana metnin ilk HTML yanıtında gelmesini sağlayın.'],
      pages: sample(jsPages),
    });
  }
  if (!robots.found) {
    add({ id: 'robots_missing', priority: 'low', category: 'access', title: 'robots.txt yok', detail: 'Dosya yoksa tüm botlara izin verilmiş sayılır; ancak site haritasını bildirmek ve bot politikasını açıkça yönetmek için önerilir.', steps: ['Kök dizine robots.txt ekleyin ve Sitemap: satırını yazın.'] });
  }
  if (!llms.main.found) {
    add({
      id: 'llms_missing', priority: 'medium', category: 'access',
      title: 'llms.txt dosyası yok',
      detail: 'llms.txt, dil modellerine sitenizin özetini ve en önemli sayfalarını Markdown olarak sunan yeni bir standarttır. Etkisi henüz sınırlı olsa da ucuz ve risksizdir; aşağıda taramanızdan üretilmiş hazır bir dosya var.',
      steps: ['Aşağıdaki içeriği gözden geçirip https://alanadiniz/llms.txt adresine düz metin olarak yükleyin.', 'Bölüm açıklamalarını kendi cümlelerinizle zenginleştirin; değersiz sayfaları çıkarın.'],
      generated: 'llms',
    });
  } else if (!llms.main.hasTitle || !llms.main.links) {
    add({ id: 'llms_invalid', priority: 'low', category: 'access', title: 'llms.txt biçimi eksik', detail: `Dosya bulundu ama ${!llms.main.hasTitle ? '“# Başlık” satırı' : 'Markdown bağlantı listesi'} yok.`, steps: ['Biçim: # Site adı, > kısa özet, ## Bölüm başlıkları altında - [Sayfa](URL): açıklama.'], generated: 'llms' });
  }

  const noQuestions = missingCount('question_headings');
  if (contentScored.length && noQuestions.length / contentScored.length > 0.4) {
    add({
      id: 'question_headings', priority: 'high', category: 'structure',
      title: `${noQuestions.length} içerik sayfasında soru biçimli başlık yok`,
      detail: 'Yapay zekâ yanıtları kullanıcı sorusuna en iyi eşleşen pasajı alıntılar. “X nedir?”, “X nasıl yapılır?”, “X ne kadar sürer?” gibi başlıklar pasajın hangi soruyu yanıtladığını netleştirir.',
      steps: ['Search Console’daki soru sorgularını (nedir, nasıl, ne kadar) H2/H3 olarak kullanın.', 'İçerik brief’i aracındaki “Yanıtlanması gereken sorular” listesinden yararlanın.'],
      pages: sample(noQuestions),
    });
  }
  const noAnswers = missingCount('direct_answers');
  if (contentScored.length && noAnswers.length / contentScored.length > 0.3) {
    add({
      id: 'direct_answers', priority: 'high', category: 'structure',
      title: `${noAnswers.length} sayfada başlıkların altında kısa, net yanıt yok`,
      detail: 'AI Overview ve ChatGPT genellikle başlığın hemen altındaki 40–60 kelimelik, kendi başına anlaşılır paragrafı alıntılar. Uzun girişler veya başlığın altında doğrudan görsel/liste olması alıntılanma şansını düşürür.',
      steps: ['Her H2’nin hemen altına soruyu doğrudan yanıtlayan 1–3 cümlelik (40–60 kelime) bir paragraf yazın.', 'Yanıtı “Bu, …” gibi önceki bağlama dayanan ifadelerle değil, konuyu adıyla anarak başlatın.', 'Ayrıntıları bu özet paragrafın ardından verin (ters piramit).'],
      pages: sample(noAnswers),
    });
  }
  const noIntro = missingCount('intro_answer');
  if (contentScored.length && noIntro.length / contentScored.length > 0.4) {
    add({
      id: 'intro_answer', priority: 'medium', category: 'structure',
      title: `${noIntro.length} sayfada özet giriş paragrafı yok`,
      detail: 'Sayfanın ilk paragrafı ana soruyu 20–90 kelimede yanıtlamalı; modeller sayfanın neyle ilgili olduğunu büyük ölçüde buradan çıkarır.',
      steps: ['Giriş paragrafını “X, … olan bir …’dır” biçiminde net bir tanım/yanıtla başlatın.'],
      pages: sample(noIntro),
    });
  }
  const noLists = missingCount('lists_tables').filter((p) => (p.word_count || 0) >= 600);
  if (noLists.length) {
    add({
      id: 'lists_tables', priority: 'medium', category: 'structure',
      title: `${noLists.length} uzun içerikte liste veya tablo yok`,
      detail: 'Adımlar, karşılaştırmalar ve özellikler liste/tablo olarak verildiğinde yanıt motorları bunları doğrudan aktarabilir.',
      steps: ['Adım adım süreçleri numaralı listeye, karşılaştırmaları tabloya dönüştürün (fiyat, süre, özellik).'],
      pages: sample(noLists),
    });
  }
  const noStats = missingCount('stats');
  if (contentScored.length && noStats.length / contentScored.length > 0.5) {
    add({
      id: 'stats', priority: 'medium', category: 'structure',
      title: `${noStats.length} sayfada somut veri/istatistik yok`,
      detail: 'Araştırmalar (Princeton GEO çalışması) istatistik ve sayısal veri eklemenin AI yanıtlarında görünürlüğü belirgin biçimde artırdığını gösteriyor.',
      steps: ['Fiyat aralıkları, süreler, oranlar, kendi verileriniz gibi doğrulanabilir sayılar ekleyin.', 'Her veriye kaynak veya tarih belirtin.'],
      pages: sample(noStats),
    });
  }
  const longParas = contentScored.filter((p) => p.missing.includes('long_paragraphs'));
  if (longParas.length) {
    add({ id: 'long_paragraphs', priority: 'low', category: 'structure', title: `${longParas.length} sayfada 120 kelimeyi aşan paragraflar var`, detail: 'Uzun paragraflar tek bir alıntılanabilir pasaj oluşturmaz.', steps: ['Paragrafları tek bir fikir etrafında 2–4 cümleye bölün.'], pages: sample(longParas) });
  }
  const noSummary = contentScored.filter((p) => p.missing.includes('summary'));
  if (noSummary.length >= 3) {
    add({ id: 'summary', priority: 'low', category: 'structure', title: `${noSummary.length} uzun içerikte özet bölümü yok`, detail: '“Kısaca” / “Önemli noktalar” bölümü modellere hazır bir özet sunar.', steps: ['Uzun yazıların başına veya sonuna 3–5 maddelik bir özet ekleyin.'], pages: sample(noSummary) });
  }

  const noAuthor = missingCount('author');
  if (contentScored.length && noAuthor.length / contentScored.length > 0.5) {
    add({
      id: 'author', priority: 'high', category: 'trust',
      title: `${noAuthor.length} içerik sayfasında yazar bilgisi yok`,
      detail: 'Google ve yanıt motorları uzmanlık sinyali arar; özellikle sağlık, finans, hukuk gibi YMYL konularında yazarı belli olmayan içerik daha az güvenilir sayılır.',
      steps: ['Her içeriğe yazar adı, unvanı ve yazar sayfasına bağlantı ekleyin.', 'Yazar sayfasında uzmanlık, deneyim ve sosyal profilleri belirtin; Person şemasıyla işaretleyin.', 'Sağlık içeriklerinde “Tıbbi olarak inceleyen” bilgisi ekleyin.'],
      pages: sample(noAuthor),
    });
  }
  const stale = missingCount('freshness');
  if (contentScored.length && stale.length / contentScored.length > 0.4) {
    add({
      id: 'freshness', priority: 'medium', category: 'trust',
      title: `${stale.length} sayfada güncelleme tarihi yok veya 1 yıldan eski`,
      detail: `İçeriklerin %${Math.round(dated * 100)}’inde tarih bilgisi var, %${Math.round(fresh * 100)}’i son 1 yılda güncellenmiş. Yanıt motorları güncel kaynakları tercih eder.`,
      steps: ['Sayfada görünür “Son güncelleme” tarihi gösterin ve şemada dateModified kullanın.', 'Önemli sayfaları en az yılda bir gerçek bilgi güncellemesiyle yenileyin (yalnızca tarihi değiştirmek yetmez).'],
      pages: sample(stale),
    });
  }
  const noCite = missingCount('citations');
  if (contentScored.length && noCite.length / contentScored.length > 0.6) {
    add({ id: 'citations', priority: 'low', category: 'trust', title: `${noCite.length} sayfada dış kaynak gösterimi yok`, detail: 'Güvenilir kaynaklara (resmî kurum, araştırma, standart) atıf, içeriğin doğrulanabilirliğini artırır.', steps: ['İddiaları ve verileri birincil kaynaklara bağlantıyla destekleyin.'], pages: sample(noCite) });
  }
  if (!aboutPage || !contactPage) {
    add({
      id: 'about_contact', priority: 'medium', category: 'trust',
      title: `${[!aboutPage && 'Hakkımızda', !contactPage && 'İletişim'].filter(Boolean).join(' ve ')} sayfası bulunamadı`,
      detail: 'Kim olduğunuzu ve size nasıl ulaşılacağını açıkça gösteren sayfalar hem Google’ın kalite yönergelerinde hem de yanıt motorlarının marka doğrulamasında kullanılır.',
      steps: ['Kuruluş geçmişi, ekip, adres, telefon ve yasal bilgileri içeren sayfalar oluşturup menü/altbilgiden bağlantı verin.'],
    });
  }

  if (!entity.orgType) {
    add({
      id: 'org_schema', priority: 'high', category: 'entity',
      title: 'Ana sayfada Organization / LocalBusiness işaretlemesi yok',
      detail: 'Yapay zekâ modelleri markanızı bir “varlık” (entity) olarak tanımak için kuruluş işaretlemesine ve tutarlı profillere bakar.',
      steps: ['Yapısal veri → Şema oluşturucu ile ana sayfa için sektörünüze uygun işaretlemeyi üretin.', 'name, logo, url, sameAs, telefon ve adres alanlarını doldurun.'],
      link: 'schema',
    });
  } else if (entity.sameAs.length < 3) {
    const candidates = entity.profileLinks.filter((l) => !entity.sameAs.includes(l));
    add({
      id: 'same_as', priority: 'medium', category: 'entity',
      title: `Kuruluş işaretlemesinde ${entity.sameAs.length ? 'yalnızca ' + entity.sameAs.length : 'hiç'} sameAs profili var`,
      detail: 'sameAs, markanızın sosyal ve bilgi profillerini birbirine bağlar; modellerin sizi doğru tanımasını ve diğer kaynaklardaki bilgilerle eşleştirmesini sağlar.',
      steps: ['LinkedIn, Instagram, YouTube, Google İşletme Profili, varsa Wikipedia/Wikidata adreslerini sameAs dizisine ekleyin.'],
      code: candidates.length ? JSON.stringify({ sameAs: [...entity.sameAs, ...candidates] }, null, 2) : undefined,
    });
  }
  if (entity.orgType && !entity.knowledge.length) {
    add({ id: 'knowledge', priority: 'low', category: 'entity', title: 'Wikipedia / Wikidata kaydı bağlı değil', detail: 'Bilgi grafiğine bağlı markalar yanıt motorlarında daha tutarlı tanınır.', steps: ['Markanızın Wikidata kaydı yoksa oluşturun (kaynaklarla), varsa sameAs’e ekleyin.', 'Sektör dizinleri, haber siteleri ve listelerde markanızın adını tutarlı yazdırın (brand mention).'] });
  }
  if (!entity.website) {
    add({ id: 'website_schema', priority: 'low', category: 'entity', title: 'WebSite işaretlemesi yok', detail: 'WebSite türü site adını ve dilini tanımlar.', steps: ['Şema oluşturucu ana sayfa çıktısında WebSite düğümü hazırdır.'], link: 'schema' });
  }

  if (aio.withAio && aio.notCited.length) {
    add({
      id: 'aio_not_cited', priority: 'high', category: 'visibility',
      title: `${aio.notCited.length} kelimede AI Overview var ama siz kaynak değilsiniz`,
      detail: `En çok alıntılanan alan adları: ${aio.topSources.slice(0, 5).map((s) => `${s.domain} (${s.count})`).join(', ')}. Bu kelimelerde sayfanızı alıntılanan kaynaklarla karşılaştırın.`,
      steps: ['Bu kelimeler için İçerik brief’i oluşturup eksik başlık ve soruları ekleyin.', 'Sayfanın başına soruyu doğrudan yanıtlayan kısa bir paragraf koyun.', 'Alıntılanan sayfalardaki veri, tablo ve kaynak kullanımını inceleyin.'],
      keywords: aio.notCited.slice(0, 30),
    });
  } else if (!aio.tracked) {
    add({ id: 'aio_tracking', priority: 'low', category: 'visibility', title: 'AI Overview takibi yapılmıyor', detail: 'Hangi kelimelerde AI Overview çıktığını ve kimlerin kaynak gösterildiğini görmek için SERP takibine kelime ekleyin.', steps: ['Derin analiz → SERP & AI Overview sekmesinden önemli kelimeleri takibe alın (SERPAPI_KEY gerekir).'], link: 'serp' });
  }
  if (!config.bing.enabled) {
    add({ id: 'bing', priority: 'low', category: 'visibility', title: 'Bing’de görünürlüğü doğrulayın', detail: 'ChatGPT arama ve Copilot büyük ölçüde Bing dizinini kullanır. Bing’de indekslenmeyen sayfalar bu yanıtlarda çıkamaz.', steps: ['Siteyi Bing Webmaster Tools’a ekleyin (Search Console’dan içe aktarılabilir).', 'IndexNow ile yeni/güncellenen sayfaları anında bildirin (çoğu CMS eklentisi destekler).'] });
  }

  const order = { high: 0, medium: 1, low: 2 };
  recs.sort((a, b) => order[a.priority] - order[b.priority]);

  return {
    generatedAt: new Date().toISOString(),
    auditId: audit.id,
    origin,
    overall,
    axes,
    recommendations: recs,
    robots,
    cdn,
    llms: { ...llms, generated: buildLlmsTxt({ hostname: domain.hostname, home, pages: important }) },
    entity: { orgType: entity.orgType, name: entity.name, sameAs: entity.sameAs, profileLinks: entity.profileLinks, website: entity.website, aboutPage: aboutPage?.url || null, contactPage: contactPage?.url || null },
    aio,
    summary: {
      pages: withGeo.length,
      contentPages: content.length,
      avgScore: contentScored.length ? clamp(avg(contentScored)) : null,
      jsPages: jsPages.length,
      authorShare: share(content, (p) => p.geo.author),
      freshShare: fresh,
      questionShare: share(content, (p) => p.geo.questions > 0),
    },
    pages: scored
      .filter((p) => p.score !== null && (p.word_count || 0) >= 150)
      .sort((a, b) => a.score - b.score || b.inlinks - a.inlinks)
      .slice(0, 300)
      .map((p) => ({ url: p.url, title: p.title, words: p.word_count, inlinks: p.inlinks, score: p.score, missing: p.missing, geo: p.geo, modifiedAt: p.modified_at || p.published_at })),
  };
}

/** Takip edilen kelimelerin son SERP görüntülerinde AI Overview varlığı ve atıflar. */
async function aiOverviewStats(domain) {
  const { rows } = await query(
    `SELECT DISTINCT ON (keyword, country, device) keyword, country, features FROM serp_snapshots
      WHERE domain_id = $1 ORDER BY keyword, country, device, checked_at DESC`,
    [domain.id],
  );
  const withAio = rows.filter((r) => r.features?.aiOverview);
  const sources = new Map();
  for (const r of withAio) for (const s of r.features.aiOverview.sources || []) sources.set(s, (sources.get(s) || 0) + 1);
  const own = domain.hostname.replace(/^www\./, '');
  return {
    tracked: rows.length,
    withAio: withAio.length,
    cited: withAio.filter((r) => r.features.aiOverview.cited).length,
    notCited: withAio.filter((r) => !r.features.aiOverview.cited).map((r) => ({ keyword: r.keyword, country: r.country, sources: (r.features.aiOverview.sources || []).slice(0, 5) })),
    topSources: [...sources.entries()].filter(([d]) => d !== own).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([d, count]) => ({ domain: d, count })),
  };
}
