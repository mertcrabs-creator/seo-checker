import { config } from '../../config.js';
import { HttpError } from '../../utils/httpError.js';

/**
 * Bing Webmaster Tools API (ücretsiz): siteye gelen bağlantılar.
 * GetLinkCounts -> bağlantı alan sayfalarımız; GetUrlLinks -> her sayfaya bağlantı veren URL'ler + anchor.
 * Not: Bing eski POX (XML) uç noktasını kapattı; JSON uç noktası kullanılır.
 * Not 2: Bing'in yeni "Backlinks" raporundaki veriler bu API'de her zaman görünmeyebilir;
 * o durumda raporun "Download all" CSV dışa aktarımı içe aktarılır.
 */
const API = 'https://ssl.bing.com/webmaster/api.svc/json';
const MAX_TARGET_PAGES = 20; // GetLinkCounts sayfası
const MAX_LINK_PAGES = 10; // hedef başına GetUrlLinks sayfası
const MAX_LINKS = 10_000;

const providerError = (msg) => new HttpError(502, `Bing Webmaster: ${String(msg).slice(0, 400)}`, 'PROVIDER_ERROR');

async function call(method, params) {
  const url = new URL(`${API}/${method}`);
  url.search = new URLSearchParams({ ...params, apikey: config.bing.key }).toString();
  let res;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(60_000) });
  } catch (err) {
    throw providerError(err.name === 'TimeoutError' ? 'zaman aşımı' : 'bağlantı kurulamadı');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data?.Message || `HTTP ${res.status}`;
    if (/InvalidApiKey/i.test(msg) || res.status === 401) throw providerError('API anahtarı geçersiz');
    if (/NotAuthorized/i.test(msg)) throw providerError('Bu site adresi Bing hesabınızda doğrulanmamış');
    throw providerError(msg);
  }
  return data?.d;
}

const hostOf = (u) => {
  try {
    return new URL(u).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
};

/**
 * Bing hesabındaki sitelerden alan adımıza karşılık gelen kayıtlı adres(ler).
 * www'li/www'siz ve http/https farkları tolere edilir; kök adres alt klasörlere tercih edilir.
 */
export async function resolveSites(hostname) {
  const sites = (await call('GetUserSites', {})) || [];
  const own = hostname.toLowerCase().replace(/^www\./, '');
  const matches = sites.filter((s) => hostOf(s.Url) === own);
  const verified = matches.filter((s) => s.IsVerified).map((s) => s.Url);
  const isRoot = (u) => /^https?:\/\/[^/]+\/?$/.test(u);
  return {
    verified: [...verified.filter(isRoot), ...verified.filter((u) => !isRoot(u))],
    unverified: matches.filter((s) => !s.IsVerified).map((s) => s.Url),
  };
}

/** Bing'in sitemiz için bildiği (kaynak URL, hedef URL, anchor) kayıtları. */
export async function inboundLinks(hostname) {
  if (!config.bing.enabled) return { links: [], sites: [] };
  const { verified, unverified } = await resolveSites(hostname);
  if (!verified.length) {
    throw providerError(
      unverified.length
        ? `Site Bing’de ekli ama doğrulanmamış (${unverified.join(', ')}). Bing Webmaster Tools’ta doğrulamayı tamamlayın.`
        : 'Bu alan adı Bing Webmaster Tools hesabınızda yok. Siteyi ekleyin (Search Console’dan içe aktarılabilir).',
    );
  }

  const links = [];
  for (const siteUrl of verified) {
    const targets = [];
    for (let page = 0; page < MAX_TARGET_PAGES; page++) {
      const d = await call('GetLinkCounts', { siteUrl, page: String(page) });
      for (const l of d?.Links || []) if (l.Url) targets.push(l.Url);
      if (page + 1 >= (d?.TotalPages || 0)) break;
    }
    for (const target of targets) {
      for (let page = 0; page < MAX_LINK_PAGES && links.length < MAX_LINKS; page++) {
        // WCF JSON uç noktası string parametreyi JSON-serileştirilmiş bekler
        const d = await call('GetUrlLinks', { siteUrl, link: JSON.stringify(target), page: String(page) })
          .catch(() => call('GetUrlLinks', { siteUrl, link: target, page: String(page) }));
        for (const l of d?.Details || []) if (l.Url) links.push({ source: l.Url, target, anchor: l.AnchorText?.trim().slice(0, 500) || null });
        if (page + 1 >= (d?.TotalPages || 0)) break;
      }
      if (links.length >= MAX_LINKS) break;
    }
  }
  return { links, sites: verified };
}
