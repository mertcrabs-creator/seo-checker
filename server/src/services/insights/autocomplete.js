import { config } from '../../config.js';

/**
 * Google otomatik tamamlama önerileri (ücretsiz): kullanıcıların bir kelimeyle birlikte gerçekte ne aradığı.
 * Sadece sabit Google adresine gider; sonuçlar 24 saat bellek önbelleğinde tutulur ve istekler aralıklı atılır.
 */

const ENDPOINT = 'https://suggestqueries.google.com/complete/search';
const CACHE_MS = 24 * 3_600_000;
const cache = new Map();
const MODIFIERS = {
  tr: ['nedir', 'nasıl', 'fiyat', 'en iyi', 'neden', 'yorumlar', 'kaç', 'sonrası'],
  en: ['what is', 'how', 'cost', 'best', 'vs', 'reviews', 'before and after', 'near me'],
  de: ['was ist', 'wie', 'kosten', 'beste', 'erfahrungen'],
  fr: ['prix', 'comment', 'meilleur', 'avis'],
  es: ['precio', 'cómo', 'mejor', 'opiniones'],
  it: ['prezzo', 'come', 'migliore', 'recensioni'],
  ru: ['цена', 'как', 'отзывы', 'лучший'],
  ar: ['سعر', 'كيف', 'افضل'],
};

async function suggest(q, hl, gl) {
  const key = `${hl}|${gl}|${q}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.list;
  const url = `${ENDPOINT}?${new URLSearchParams({ client: 'firefox', hl, gl, ie: 'utf-8', oe: 'utf-8', q })}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const list = Array.isArray(data?.[1]) ? data[1].map(String).filter((s) => s.length <= 200) : [];
  cache.set(key, { at: Date.now(), list });
  if (cache.size > 5000) cache.delete(cache.keys().next().value);
  return list;
}

/**
 * Anahtar kelimenin varyasyonları: kelimenin kendisi + dile göre soru/niyet ekleri.
 * @returns {Promise<{query:string, source:string}[]>}
 */
export async function keywordVariations(keyword, { hl = 'en', gl = 'us', max = 60 } = {}) {
  if (!config.autocompleteEnabled) return [];
  const lang = hl.slice(0, 2).toLowerCase();
  const seeds = [`${keyword} `, ...(MODIFIERS[lang] || MODIFIERS.en).map((m) => (lang === 'en' && /^(what is|how|best)$/.test(m) ? `${m} ${keyword}` : `${keyword} ${m}`))];
  const out = new Map();
  for (const seed of seeds) {
    try {
      for (const s of await suggest(seed, lang, gl.toLowerCase())) {
        const k = s.toLowerCase().trim();
        if (k !== keyword.toLowerCase() && !out.has(k)) out.set(k, { query: s, source: seed.trim() });
      }
    } catch {
      break; // Google geçici olarak reddettiyse zorlamayalım
    }
    await new Promise((r) => setTimeout(r, 150));
    if (out.size >= max) break;
  }
  return [...out.values()].slice(0, max);
}
