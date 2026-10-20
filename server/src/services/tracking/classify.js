/**
 * Ziyaretin kaynağı (kanal), cihazı ve ülkesi. Tamamen kurallara dayalı; dış servis çağrısı yoktur.
 * Kanal önceliği: yapay zekâ → reklam → e-posta → arama → sosyal → yönlendirme → doğrudan.
 */

// [desen, kaynak adı] — alan adının tamamı veya alt alan adıyla eşleşir
const AI = [
  [/(^|\.)chatgpt\.com$|(^|\.)chat\.openai\.com$|^openai$/, 'chatgpt'],
  [/(^|\.)perplexity\.ai$|^perplexity$/, 'perplexity'],
  [/^gemini\.google\.com$|^bard\.google\.com$|^gemini$/, 'gemini'],
  [/^copilot\.microsoft\.com$|^copilot$/, 'copilot'],
  [/(^|\.)claude\.ai$|^claude$/, 'claude'],
  [/(^|\.)deepseek\.com$|^deepseek$/, 'deepseek'],
  [/(^|\.)grok\.com$|^grok$/, 'grok'],
  [/(^|\.)meta\.ai$/, 'meta_ai'],
  [/(^|\.)you\.com$/, 'you'],
  [/(^|\.)poe\.com$/, 'poe'],
  [/(^|\.)mistral\.ai$/, 'mistral'],
];

const SEARCH = [
  [/^(www\.|news\.)?google\.[a-z.]{2,6}$|^com\.google\.android\.googlequicksearchbox$|^google$/, 'google'],
  [/(^|\.)bing\.com$|^bing$/, 'bing'],
  [/(^|\.)yandex\.[a-z.]{2,6}$|(^|\.)ya\.ru$|^yandex$/, 'yandex'],
  [/(^|\.)duckduckgo\.com$|^duckduckgo$/, 'duckduckgo'],
  [/(^|\.)search\.yahoo\.com$|(^|\.)yahoo\.com$|^yahoo$/, 'yahoo'],
  [/(^|\.)ecosia\.org$|^ecosia$/, 'ecosia'],
  [/(^|\.)search\.brave\.com$/, 'brave'],
  [/(^|\.)baidu\.com$|^baidu$/, 'baidu'],
  [/(^|\.)naver\.com$|^naver$/, 'naver'],
  [/(^|\.)seznam\.cz$|^seznam$/, 'seznam'],
  [/(^|\.)qwant\.com$|^qwant$/, 'qwant'],
];

const SOCIAL = [
  [/(^|\.)facebook\.com$|(^|\.)fb\.com$|(^|\.)fb\.me$|^facebook$|^fb$/, 'facebook'],
  [/(^|\.)instagram\.com$|^instagram$|^ig$/, 'instagram'],
  [/^t\.co$|(^|\.)twitter\.com$|(^|\.)x\.com$|^twitter$|^x$/, 'x'],
  [/(^|\.)linkedin\.com$|^lnkd\.in$|^linkedin$/, 'linkedin'],
  [/(^|\.)youtube\.com$|^youtu\.be$|^youtube$/, 'youtube'],
  [/(^|\.)tiktok\.com$|^tiktok$/, 'tiktok'],
  [/(^|\.)pinterest\.[a-z.]{2,6}$|^pin\.it$|^pinterest$/, 'pinterest'],
  [/(^|\.)reddit\.com$|^reddit$/, 'reddit'],
  [/(^|\.)threads\.net$|(^|\.)threads\.com$|^threads$/, 'threads'],
  [/^t\.me$|(^|\.)telegram\.org$|^telegram$/, 'telegram'],
  [/(^|\.)whatsapp\.com$|^wa\.me$|^whatsapp$/, 'whatsapp'],
  [/(^|\.)vk\.com$/, 'vk'],
  [/(^|\.)quora\.com$/, 'quora'],
  [/(^|\.)snapchat\.com$/, 'snapchat'],
];

const WEBMAIL = /(^|\.)mail\.google\.com$|^com\.google\.android\.gm$|(^|\.)outlook\.(live|office)\.com$|(^|\.)mail\.yahoo\.com$|(^|\.)mail\.yandex\.[a-z.]+$/;
const PAID_MEDIUM = /^(cpc|ppc|cpm|cpv|paid|paidsearch|paid_search|paid-search|paidsocial|paid_social|paid-social|display|banner|ads?)$/i;
const EMAIL_MEDIUM = /^(e-?mail|newsletter)$/i;
const SOCIAL_MEDIUM = /^(social|social-network|social-media|sm|social_media)$/i;

const match = (list, host) => list.find(([re]) => re.test(host))?.[1] || null;

/** 'www.' öneki olmadan ana alan adı */
export const baseHost = (host) => String(host || '').toLowerCase().replace(/^www\./, '');

/** host, sitenin kendisi veya bir alt alan adı mı */
export const isSameSite = (host, siteHost) => {
  const h = baseHost(host);
  const b = baseHost(siteHost);
  return Boolean(h) && (h === b || h.endsWith(`.${b}`));
};

function referrerHost(referrer) {
  if (!referrer) return null;
  try {
    const u = new URL(referrer);
    // Android Google uygulaması: android-app://com.google.android.googlequicksearchbox/
    return (u.protocol === 'android-app:' ? u.host || u.pathname.replace(/^\/\//, '').split('/')[0] : u.hostname).toLowerCase() || null;
  } catch {
    return null;
  }
}

/**
 * @param {{ referrer?: string, utm?: {s?:string,m?:string,c?:string,t?:string}, paidClick?: boolean, siteHost: string }} input
 * @returns {{ channel: string, source: string|null, referrerHost: string|null }}
 */
export function classifySource({ referrer, utm = {}, paidClick = false, siteHost }) {
  const host = referrerHost(referrer);
  const external = host && !isSameSite(host, siteHost) ? host : null;
  const utmSource = (utm.s || '').toLowerCase().trim();
  const medium = (utm.m || '').toLowerCase().trim();
  const result = (channel, source) => ({ channel, source, referrerHost: external });

  // Yapay zekâ: ChatGPT bağlantılara utm_source=chatgpt.com ekler; diğerleri referrer ile gelir
  const ai = (external && match(AI, external)) || (utmSource && match(AI, utmSource));
  if (ai) return result('ai', ai);

  if (paidClick || PAID_MEDIUM.test(medium)) {
    return result('paid', (utmSource && (match(SEARCH, utmSource) || match(SOCIAL, utmSource) || utmSource.slice(0, 60))) || (external && (match(SEARCH, external) || match(SOCIAL, external))) || 'google');
  }
  if (EMAIL_MEDIUM.test(medium) || (external && WEBMAIL.test(external))) return result('email', utmSource.slice(0, 60) || 'email');

  const search = (external && match(SEARCH, external)) || (!external && utmSource && match(SEARCH, utmSource));
  if (search) return result('organic', search);

  const social = (external && match(SOCIAL, external)) || (utmSource && match(SOCIAL, utmSource)) || (SOCIAL_MEDIUM.test(medium) && (utmSource.slice(0, 60) || 'social'));
  if (social) return result('social', social);

  if (external) return result('referral', baseHost(external).slice(0, 120));
  if (utmSource) return result('referral', utmSource.slice(0, 60));
  return result('direct', null);
}

export function deviceType(ua = '', screenWidth) {
  if (/iPad|Tablet|PlayBook|Silk|Kindle|Android(?!.*Mobile)/i.test(ua)) return 'tablet';
  if (/Mobi|iPhone|iPod|Android|BlackBerry|IEMobile|Opera Mini/i.test(ua)) return 'mobile';
  // iPadOS masaüstü user-agent'ı gönderir; dokunmatik + dar ekran ipucu istemciden gelir
  if (screenWidth && screenWidth < 768) return 'mobile';
  return 'desktop';
}

const BOT_UA = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|chrome-lighthouse|gtmetrix|pingdom|uptime|monitor|preview|prerender|facebookexternalhit|embedly|quora link|whatsapp\/|telegrambot|curl|wget|python|axios|node-fetch|go-http|java\/|okhttp|httpclient|phantom|selenium|puppeteer|playwright|cypress/i;
export const isBot = (ua) => !ua || ua.length < 20 || BOT_UA.test(ua);

// CDN/proxy'lerin eklediği ülke başlıkları (güvenilir kaynak), yoksa tarayıcı saat diliminden tahmin
const COUNTRY_HEADERS = ['cf-ipcountry', 'x-vercel-ip-country', 'cloudfront-viewer-country', 'x-country-code', 'x-geo-country', 'fastly-geo-country'];

const TZ = {
  'Europe/Istanbul': 'TR', 'Asia/Istanbul': 'TR', 'Europe/Berlin': 'DE', 'Europe/Busingen': 'DE', 'Europe/London': 'GB', 'Europe/Paris': 'FR',
  'Europe/Madrid': 'ES', 'Atlantic/Canary': 'ES', 'Europe/Rome': 'IT', 'Europe/Amsterdam': 'NL', 'Europe/Brussels': 'BE', 'Europe/Vienna': 'AT',
  'Europe/Zurich': 'CH', 'Europe/Stockholm': 'SE', 'Europe/Oslo': 'NO', 'Europe/Copenhagen': 'DK', 'Europe/Helsinki': 'FI', 'Europe/Warsaw': 'PL',
  'Europe/Prague': 'CZ', 'Europe/Budapest': 'HU', 'Europe/Bucharest': 'RO', 'Europe/Sofia': 'BG', 'Europe/Athens': 'GR', 'Europe/Lisbon': 'PT',
  'Europe/Dublin': 'IE', 'Europe/Kiev': 'UA', 'Europe/Kyiv': 'UA', 'Europe/Moscow': 'RU', 'Europe/Minsk': 'BY', 'Europe/Belgrade': 'RS',
  'Europe/Zagreb': 'HR', 'Europe/Ljubljana': 'SI', 'Europe/Bratislava': 'SK', 'Europe/Vilnius': 'LT', 'Europe/Riga': 'LV', 'Europe/Tallinn': 'EE',
  'Europe/Luxembourg': 'LU', 'Europe/Chisinau': 'MD', 'Europe/Sarajevo': 'BA', 'Europe/Skopje': 'MK', 'Europe/Tirane': 'AL', 'Europe/Podgorica': 'ME',
  'Europe/Malta': 'MT', 'Atlantic/Reykjavik': 'IS', 'Asia/Nicosia': 'CY', 'Europe/Nicosia': 'CY', 'Asia/Famagusta': 'CY', 'Asia/Baku': 'AZ',
  'Asia/Tbilisi': 'GE', 'Asia/Yerevan': 'AM', 'Asia/Dubai': 'AE', 'Asia/Riyadh': 'SA', 'Asia/Qatar': 'QA', 'Asia/Kuwait': 'KW', 'Asia/Bahrain': 'BH',
  'Asia/Muscat': 'OM', 'Asia/Baghdad': 'IQ', 'Asia/Tehran': 'IR', 'Asia/Jerusalem': 'IL', 'Asia/Tel_Aviv': 'IL', 'Asia/Amman': 'JO', 'Asia/Beirut': 'LB',
  'Asia/Damascus': 'SY', 'Africa/Cairo': 'EG', 'Africa/Casablanca': 'MA', 'Africa/Algiers': 'DZ', 'Africa/Tunis': 'TN', 'Africa/Tripoli': 'LY',
  'Africa/Lagos': 'NG', 'Africa/Johannesburg': 'ZA', 'Africa/Nairobi': 'KE', 'Asia/Karachi': 'PK', 'Asia/Kolkata': 'IN', 'Asia/Calcutta': 'IN',
  'Asia/Dhaka': 'BD', 'Asia/Tashkent': 'UZ', 'Asia/Almaty': 'KZ', 'Asia/Bishkek': 'KG', 'Asia/Ashgabat': 'TM', 'Asia/Shanghai': 'CN',
  'Asia/Hong_Kong': 'HK', 'Asia/Tokyo': 'JP', 'Asia/Seoul': 'KR', 'Asia/Singapore': 'SG', 'Asia/Bangkok': 'TH', 'Asia/Jakarta': 'ID',
  'Asia/Manila': 'PH', 'Asia/Kuala_Lumpur': 'MY', 'Asia/Ho_Chi_Minh': 'VN', 'Asia/Saigon': 'VN', 'Australia/Sydney': 'AU', 'Australia/Melbourne': 'AU',
  'Australia/Perth': 'AU', 'Australia/Brisbane': 'AU', 'Australia/Adelaide': 'AU', 'Pacific/Auckland': 'NZ', 'America/New_York': 'US',
  'America/Chicago': 'US', 'America/Denver': 'US', 'America/Los_Angeles': 'US', 'America/Phoenix': 'US', 'America/Anchorage': 'US',
  'America/Detroit': 'US', 'Pacific/Honolulu': 'US', 'America/Toronto': 'CA', 'America/Vancouver': 'CA', 'America/Edmonton': 'CA',
  'America/Winnipeg': 'CA', 'America/Halifax': 'CA', 'America/Montreal': 'CA', 'America/Mexico_City': 'MX', 'America/Sao_Paulo': 'BR',
  'America/Argentina/Buenos_Aires': 'AR', 'America/Buenos_Aires': 'AR', 'America/Bogota': 'CO', 'America/Lima': 'PE', 'America/Santiago': 'CL',
  'America/Caracas': 'VE',
};

export function countryOf(headers, timezone) {
  for (const h of COUNTRY_HEADERS) {
    const v = String(headers[h] || '').toUpperCase();
    if (/^[A-Z]{2}$/.test(v) && v !== 'XX' && v !== 'T1') return v;
  }
  return TZ[timezone] || null;
}
