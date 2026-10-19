import { config } from '../../config.js';
import { HttpError } from '../../utils/httpError.js';

/**
 * SerpApi ile canlı Google sonucu: Search Console ortalamasını belirli bir ülkedeki gerçek SERP ile doğrular.
 * Anahtar sadece sunucuda; istekler yalnızca sabit SerpApi adresine gider. Her 10 sonuçluk sayfa 1 arama hakkı harcar.
 */
const API = 'https://serpapi.com';

const providerError = (msg) => new HttpError(502, `SerpApi: ${String(msg).slice(0, 300)}`, 'PROVIDER_ERROR');

async function get(path, params) {
  if (!config.serpapi.enabled) throw new HttpError(400, 'Canlı doğrulama için SERPAPI_KEY tanımlanmalı', 'SERPAPI_DISABLED');
  const url = new URL(path, API);
  url.search = new URLSearchParams({ ...params, api_key: config.serpapi.key }).toString();
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  } catch (err) {
    throw providerError(err.name === 'TimeoutError' ? 'zaman aşımı' : 'bağlantı kurulamadı');
  }
  const data = await res.json().catch(() => null);
  if (res.status === 401) throw providerError('API anahtarı geçersiz');
  if (!data) throw providerError(`HTTP ${res.status}`);
  // Arama hakkı bitti, geçersiz anahtar vb. hatalar "error" alanında gelir
  if (data.error) throw providerError(data.error);
  if (!res.ok) throw providerError(`HTTP ${res.status}`);
  return data;
}

/** Kalan aylık arama hakkı (ücretsiz uç nokta, hak harcamaz). */
export async function account() {
  const a = await get('/account.json', {});
  return { searchesLeft: a.total_searches_left ?? a.plan_searches_left ?? null, planName: a.plan_name ?? null };
}

const hostOf = (link) => {
  try {
    return new URL(link).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
};

/**
 * @param {{keyword:string, gl:string, hl:string, device:'desktop'|'mobile', hostname:string}} o
 * @returns {{position:number|null, url:string|null, correctedQuery:string|null, depth:number, top:object[]}}
 */
// ------------------------------------------------------------------ SERP özellikleri / AI Overview
const domainsOf = (refs) => [...new Set(refs.map((r) => hostOf(r.link || r.url || '')).filter(Boolean))];

/**
 * Tek arama (1 hak; AI Overview ayrı sayfada geliyorsa +1): ilk 10 organik sonuç ve sonuç sayfası özellikleri.
 * @returns {{position:number|null, url:string|null, top:object[], features:object, questions:string[], related:string[], searches:number}}
 */
export async function serpFeatures({ keyword, gl, hl, device, hostname }) {
  const bare = hostname.toLowerCase().replace(/^www\./, '');
  const isOwnHost = (h) => h === bare || h.endsWith(`.${bare}`);
  const data = await get('/search.json', { engine: 'google', q: keyword, gl, hl, device, google_domain: 'google.com' });
  let searches = 1;
  const top = (data.organic_results || []).slice(0, 10).map((r, i) => ({
    position: r.position || i + 1, title: String(r.title || '').slice(0, 300), link: r.link || null, domain: hostOf(r.link),
    own: isOwnHost(hostOf(r.link)), snippet: String(r.snippet || '').slice(0, 300),
  }));
  const hit = top.find((t) => t.own);

  let ai = data.ai_overview || null;
  if (ai?.page_token && !ai.references && config.serpapi.aiOverviewFetch) {
    try {
      const more = await get('/search.json', { engine: 'google_ai_overview', page_token: ai.page_token });
      searches++;
      ai = more.ai_overview || ai;
    } catch {
      /* AI Overview detayı alınamadı; varlığı yine de kaydedilir */
    }
  }
  const aiRefs = ai?.references || [];
  const box = data.answer_box;
  const boxLink = box?.link || box?.displayed_link || null;
  const features = {
    aiOverview: ai ? { present: true, cited: aiRefs.some((r) => isOwnHost(hostOf(r.link || ''))), sources: domainsOf(aiRefs).slice(0, 10), detail: Boolean(aiRefs.length) } : null,
    featuredSnippet: box && boxLink ? { domain: hostOf(boxLink), own: isOwnHost(hostOf(boxLink)), type: box.type || null, title: String(box.title || '').slice(0, 200) } : null,
    peopleAlsoAsk: (data.related_questions || []).length,
    localPack: Boolean(data.local_results || data.local_map),
    video: Boolean(data.inline_videos || data.video_results || data.short_videos),
    images: Boolean(data.inline_images || data.images_results),
    topStories: Boolean(data.top_stories),
    shopping: Boolean(data.shopping_results || data.inline_shopping || data.immersive_products),
    knowledgeGraph: Boolean(data.knowledge_graph),
    forums: Boolean(data.discussions_and_forums),
    ads: (data.ads || []).length,
  };
  return {
    position: hit?.position ?? null,
    url: hit?.link ?? null,
    top,
    features,
    questions: (data.related_questions || []).map((q) => String(q.question || '').slice(0, 300)).filter(Boolean).slice(0, 12),
    related: (data.related_searches || []).map((r) => String(r.query || '').slice(0, 200)).filter(Boolean).slice(0, 12),
    searches,
  };
}

export async function liveRank({ keyword, gl, hl, device, hostname }) {
  const bare = hostname.toLowerCase().replace(/^www\./, '');
  const isOwn = (link) => {
    const h = hostOf(link);
    return h === bare || h.endsWith(`.${bare}`);
  };
  const top = [];
  let correctedQuery = null;
  let hit = null;
  for (let page = 0; page < config.serpapi.pages && !hit; page++) {
    const data = await get('/search.json', {
      engine: 'google', q: keyword, gl, hl, device, start: String(page * 10), google_domain: 'google.com',
    });
    const info = data.search_information || {};
    correctedQuery ||= info.showing_results_for || info.spelling_fix || null;
    const organic = data.organic_results || [];
    for (const r of organic) {
      const item = { position: top.length + 1, title: String(r.title || '').slice(0, 300), link: r.link || null, domain: hostOf(r.link), own: isOwn(r.link) };
      top.push(item);
      if (item.own && !hit) hit = item;
    }
    if (organic.length < 10) break; // son sayfa
  }
  return { position: hit?.position ?? null, url: hit?.link ?? null, correctedQuery, depth: top.length, top: top.slice(0, 30) };
}
