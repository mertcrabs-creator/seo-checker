import { config } from '../../config.js';
import { HttpError } from '../../utils/httpError.js';

/**
 * DataForSEO v3 istemcisi. Kimlik bilgileri sadece sunucuda tutulur; istekler yalnızca
 * sabit API adresine gider (kullanıcı girdisi URL'ye girmez).
 */
const API = 'https://api.dataforseo.com/v3';
const LOCATIONS_TTL_MS = 24 * 60 * 60 * 1000;

const authHeader = () => `Basic ${Buffer.from(`${config.dataforseo.login}:${config.dataforseo.password}`).toString('base64')}`;

// Sık görülen sağlayıcı hataları için anlaşılır mesajlar; diğerlerinde DataForSEO'nun mesajı gösterilir
const KNOWN_ERRORS = {
  40100: 'DataForSEO kimlik bilgileri hatalı. .env içindeki DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD değerlerini kontrol edin.',
  40104: 'DataForSEO hesabınız henüz doğrulanmamış. https://app.dataforseo.com/ panelinden hesap doğrulamasını tamamlayın.',
  40200: 'DataForSEO bakiyeniz yetersiz. Panelden bakiye yükleyin.',
  40210: 'DataForSEO bakiyeniz yetersiz. Panelden bakiye yükleyin.',
};

/** Sağlayıcı hataları 502 olarak ve mesajıyla istemciye iletilir (iç hata ayrıntısı içermez). */
function providerError(code, message, httpStatus) {
  const text = KNOWN_ERRORS[code] || `DataForSEO: ${message || `HTTP ${httpStatus}`}${code ? ` (${code})` : ''}`;
  return new HttpError(502, String(text).slice(0, 500), 'PROVIDER_ERROR');
}

async function call(method, path, task) {
  if (!config.dataforseo.enabled) throw new Error('DataForSEO yapılandırılmamış');
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
      body: task ? JSON.stringify([task]) : undefined,
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    throw providerError(null, err.name === 'TimeoutError' ? 'zaman aşımı' : 'bağlantı kurulamadı');
  }
  const data = await res.json().catch(() => null);
  if (res.status === 401) throw providerError(40100);
  // 20000 = başarılı; hata kodu hem genel yanıtta hem görev düzeyinde gelebilir
  if (!res.ok || !data || data.status_code !== 20000) throw providerError(data?.status_code, data?.status_message, res.status);
  const t = data.tasks?.[0];
  if (!t || t.status_code !== 20000) throw providerError(t?.status_code, t?.status_message || 'Görev başarısız');
  return t.result || [];
}

let locationsCache = { at: 0, list: null, pending: null };

/** Labs veritabanındaki ülkeler ve her ülkede desteklenen diller (ücretsiz uç nokta, 24 saat önbellek). */
export async function labsLocations() {
  if (locationsCache.list && Date.now() - locationsCache.at < LOCATIONS_TTL_MS) return locationsCache.list;
  locationsCache.pending ||= call('GET', '/dataforseo_labs/locations_and_languages')
    .then((result) => {
      const list = result
        .filter((l) => l.location_type === 'Country')
        .map((l) => ({
          locationCode: l.location_code,
          locationName: l.location_name,
          countryIso: l.country_iso_code || null,
          languages: (l.available_languages || [])
            .filter((lang) => !lang.available_sources || lang.available_sources.includes('google'))
            .map((lang) => ({ code: String(lang.language_code).toLowerCase(), name: lang.language_name, keywords: lang.keywords ?? null })),
        }));
      locationsCache = { at: Date.now(), list, pending: null };
      return list;
    })
    .finally(() => {
      locationsCache.pending = null;
    });
  return locationsCache.pending;
}

/** Sitenin bir ülke + dilde sıralandığı organik kelimeler (en değerliler önce). */
export async function rankedKeywords(target, locationCode, languageCode) {
  const [r] = await call('POST', '/dataforseo_labs/google/ranked_keywords/live', {
    target,
    location_code: locationCode,
    language_code: languageCode,
    item_types: ['organic'],
    limit: config.dataforseo.keywordsLimit,
    order_by: ['ranked_serp_element.serp_item.etv,desc'],
  });
  const seen = new Set();
  const items = [];
  for (const it of r?.items || []) {
    const kw = it.keyword_data?.keyword;
    const serp = it.ranked_serp_element?.serp_item;
    if (!kw || !serp || seen.has(kw)) continue;
    seen.add(kw);
    const info = it.keyword_data.keyword_info || {};
    items.push({
      keyword: String(kw).slice(0, 500),
      position: serp.rank_group,
      positionAbsolute: serp.rank_absolute ?? null,
      previousPosition: serp.rank_changes?.previous_rank_absolute ?? null,
      isNew: Boolean(serp.rank_changes?.is_new),
      url: serp.url ? String(serp.url).slice(0, 2000) : null,
      searchVolume: info.search_volume ?? null,
      cpc: info.cpc ?? null,
      competition: info.competition ?? null,
      difficulty: it.keyword_data.keyword_properties?.keyword_difficulty ?? null,
      intent: it.keyword_data.search_intent_info?.main_intent ?? null,
      etv: serp.etv ?? null,
    });
  }
  return { totalCount: r?.total_count ?? items.length, metrics: r?.metrics?.organic || null, items };
}

/** Canlı Google sonucunda alan adının (ve alt alan adlarının) ilk organik pozisyonu. */
export async function serpPosition(keyword, locationCode, languageCode, hostname) {
  const [r] = await call('POST', '/serp/google/organic/live/advanced', {
    keyword,
    location_code: locationCode,
    language_code: languageCode,
    depth: config.dataforseo.checkDepth,
  });
  const bare = hostname.replace(/^www\./, '');
  const hit = (r?.items || []).find((i) => {
    if (i.type !== 'organic' || !i.domain) return false;
    const d = String(i.domain).toLowerCase().replace(/^www\./, '');
    return d === bare || d.endsWith(`.${bare}`);
  });
  return { position: hit?.rank_group ?? null, url: hit?.url ?? null };
}
