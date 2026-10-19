/**
 * Sunucu erişim logu ayrıştırıcı (tarayıcıda çalışır; ziyaretçi verisi sunucuya gönderilmez).
 * Desteklenen biçimler: Apache/Nginx combined & common (vhost önekli dahil), JSON satırları (Nginx JSON,
 * Cloudflare Logpush vb.), W3C/IIS (#Fields başlıklı). .gz dosyalar tarayıcıda açılır.
 * Sadece bot satırları tutulur; sahte bot tespiti için bot IP'leri sunucuda resmi aralıklarla doğrulanır.
 */

export const BOTS = [
  { key: 'googlebot-image', label: 'Googlebot Image', re: /Googlebot-Image/i, group: 'google', family: 'google' },
  { key: 'googlebot-video', label: 'Googlebot Video', re: /Googlebot-Video/i, group: 'google', family: 'google' },
  { key: 'googlebot-news', label: 'Googlebot News', re: /Googlebot-News/i, group: 'google', family: 'google' },
  { key: 'google-inspection', label: 'Google InspectionTool', re: /Google-InspectionTool/i, group: 'google', family: 'google' },
  { key: 'googleother', label: 'GoogleOther', re: /GoogleOther/i, group: 'google', family: 'google' },
  { key: 'adsbot', label: 'AdsBot-Google', re: /AdsBot-Google/i, group: 'google', family: 'google' },
  { key: 'storebot', label: 'Storebot-Google', re: /Storebot-Google/i, group: 'google', family: 'google' },
  { key: 'googlebot-smartphone', label: 'Googlebot Smartphone', re: /Googlebot/i, group: 'google', family: 'google' },
  { key: 'googlebot-desktop', label: 'Googlebot Desktop', re: /Googlebot/i, group: 'google', family: 'google' },
  { key: 'bingbot', label: 'Bingbot', re: /bingbot|BingPreview/i, group: 'bing', family: 'bing' },
  { key: 'gptbot', label: 'GPTBot (OpenAI eğitim)', re: /GPTBot/i, group: 'ai', family: 'openai' },
  { key: 'oai-searchbot', label: 'OAI-SearchBot (ChatGPT arama)', re: /OAI-SearchBot/i, group: 'ai', family: 'openai' },
  { key: 'chatgpt-user', label: 'ChatGPT-User', re: /ChatGPT-User/i, group: 'ai', family: null },
  { key: 'claudebot', label: 'Claude (Anthropic)', re: /ClaudeBot|Claude-Web|Claude-User|Claude-SearchBot|anthropic-ai/i, group: 'ai', family: null },
  { key: 'perplexitybot', label: 'PerplexityBot', re: /PerplexityBot/i, group: 'ai', family: 'perplexity' },
  { key: 'perplexity-user', label: 'Perplexity-User', re: /Perplexity-User/i, group: 'ai', family: null },
  { key: 'meta-ai', label: 'Meta AI', re: /meta-externalagent|meta-externalfetcher|FacebookBot/i, group: 'ai', family: null },
  { key: 'bytespider', label: 'Bytespider (ByteDance)', re: /Bytespider/i, group: 'ai', family: null },
  { key: 'ccbot', label: 'CCBot (Common Crawl)', re: /CCBot/i, group: 'ai', family: null },
  { key: 'amazonbot', label: 'Amazonbot', re: /Amazonbot/i, group: 'ai', family: null },
  { key: 'applebot', label: 'Applebot', re: /Applebot/i, group: 'other', family: null },
  { key: 'yandex', label: 'YandexBot', re: /YandexBot|YandexImages/i, group: 'other', family: null },
  { key: 'baidu', label: 'Baiduspider', re: /Baiduspider/i, group: 'other', family: null },
  { key: 'duckduckbot', label: 'DuckDuckBot', re: /DuckDuckBot/i, group: 'other', family: null },
  { key: 'ahrefs', label: 'AhrefsBot', re: /AhrefsBot/i, group: 'seo', family: null },
  { key: 'semrush', label: 'SemrushBot', re: /SemrushBot/i, group: 'seo', family: null },
  { key: 'mj12', label: 'MJ12bot (Majestic)', re: /MJ12bot/i, group: 'seo', family: null },
  { key: 'dotbot', label: 'DotBot (Moz)', re: /DotBot/i, group: 'seo', family: null },
  { key: 'other-bot', label: 'Diğer botlar', re: /bot\b|spider|crawler/i, group: 'other', family: null },
];
const PRECHECK = /bot|spider|crawl|Google|GPT|Claude|anthropic|Perplexity|Bytespider|externalagent|externalfetcher|BingPreview/i;
const MAX_HITS = 3_000_000;
const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const COMBINED = /^(?:(\S+) )?(\S+) \S+ \S+ \[([^\]]+)\] "([A-Z]+) (\S+)[^"]*" (\d{3}) \S+(?: "[^"]*" "([^"]*)")?/;

function botOf(ua) {
  if (!ua || !PRECHECK.test(ua)) return -1;
  for (let i = 0; i < BOTS.length; i++) {
    const b = BOTS[i];
    if (!b.re.test(ua)) continue;
    if (b.key === 'googlebot-smartphone') {
      if (/Googlebot-/i.test(ua) || !/Mobile/i.test(ua)) continue; // masaüstü veya özel Google botu
    }
    return i;
  }
  return -1;
}

/** "10/Oct/2026:13:55:36 +0300" -> epoch ms */
function apacheTime(s) {
  const m = /^(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})(?: ([+-])(\d{2})(\d{2}))?/.exec(s);
  if (!m) return null;
  const utc = Date.UTC(+m[3], MONTHS[m[2]] ?? 0, +m[1], +m[4], +m[5], +m[6]);
  const off = m[7] ? (m[7] === '-' ? -1 : 1) * (+m[8] * 60 + +m[9]) * 60_000 : 0;
  return utc - off;
}

function anyTime(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v > 1e17 ? v / 1e6 : v > 1e14 ? v / 1e3 : v > 1e11 ? v : v * 1000; // ns / µs / ms / s
  const s = String(v);
  if (/^\d{2}\/\w{3}\/\d{4}:/.test(s)) return apacheTime(s);
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

function toPath(raw) {
  if (!raw) return null;
  let p = String(raw);
  if (/^https?:\/\//i.test(p)) {
    try {
      const u = new URL(p);
      p = u.pathname + u.search;
    } catch {
      return null;
    }
  }
  if (!p.startsWith('/')) return null;
  const hash = p.indexOf('#');
  if (hash >= 0) p = p.slice(0, hash);
  return p.slice(0, 2000);
}

const JSON_KEYS = {
  ip: ['ClientIP', 'remote_addr', 'ip', 'client_ip', 'clientIp', 'remoteIp', 'remote_ip', 'c-ip', 'http_x_forwarded_for'],
  path: ['ClientRequestURI', 'request_uri', 'uri', 'path', 'url', 'ClientRequestPath', 'requestUri'],
  request: ['request'],
  status: ['EdgeResponseStatus', 'status', 'status_code', 'statusCode', 'OriginResponseStatus', 'response_status'],
  ua: ['ClientRequestUserAgent', 'http_user_agent', 'user_agent', 'userAgent', 'ua', 'agent'],
  time: ['EdgeStartTimestamp', 'time', 'timestamp', 'time_local', '@timestamp', 'time_iso8601', 'datetime', 'date'],
};
const pick = (o, keys) => {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k];
  return undefined;
};

/** Satır ayrıştırıcı fabrikası (W3C başlığı satır akışında güncellenir). */
function createLineParser() {
  let w3c = null;
  let format = null;
  const parse = (line) => {
    if (!line) return null;
    if (line.charCodeAt(0) === 35) { // '#'
      if (line.startsWith('#Fields:')) {
        w3c = line.slice(8).trim().split(/\s+/);
        format = 'W3C / IIS';
      }
      return null;
    }
    if (line.charCodeAt(0) === 123) { // '{'
      let o;
      try {
        o = JSON.parse(line);
      } catch {
        return null;
      }
      format ||= 'JSON';
      let path = pick(o, JSON_KEYS.path);
      const req = pick(o, JSON_KEYS.request);
      if (!path && typeof req === 'string') path = req.split(' ')[1];
      return { ip: String(pick(o, JSON_KEYS.ip) || '').split(',')[0].trim(), path: toPath(path), status: Number(pick(o, JSON_KEYS.status)) || 0, ua: String(pick(o, JSON_KEYS.ua) || ''), time: anyTime(pick(o, JSON_KEYS.time)) };
    }
    if (w3c) {
      const parts = line.split(' ');
      const get = (f) => {
        const i = w3c.indexOf(f);
        return i >= 0 ? parts[i] : undefined;
      };
      const q = get('cs-uri-query');
      const stem = get('cs-uri-stem');
      return {
        ip: get('c-ip') || '',
        path: toPath(stem && q && q !== '-' ? `${stem}?${q}` : stem),
        status: Number(get('sc-status')) || 0,
        ua: (get('cs(User-Agent)') || '').replace(/\+/g, ' '),
        time: anyTime(`${get('date')}T${get('time')}Z`),
      };
    }
    const m = COMBINED.exec(line);
    if (!m) return null;
    format ||= 'Apache/Nginx combined';
    return { ip: m[2], path: toPath(m[5]), status: Number(m[6]), ua: m[7] || '', time: apacheTime(m[3]) };
  };
  return { parse, format: () => format };
}

/**
 * Birinci geçiş: dosyayı akış halinde okuyup bot isteklerini kompakt dizilere yazar.
 * @param {File} file
 * @param {(p:{bytes:number,total:number,lines:number})=>void} onProgress
 */
export async function parseLogFile(file, onProgress) {
  let stream = file.stream();
  if (/\.gz$/i.test(file.name)) {
    if (typeof DecompressionStream !== 'function') throw new Error('Tarayıcınız .gz dosyalarını açamıyor; dosyayı açıp yükleyin');
    stream = stream.pipeThrough(new DecompressionStream('gzip'));
  }
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  const parser = createLineParser();
  const ipIdx = new Map();
  const pathIdx = new Map();
  const ips = [];
  const paths = [];
  const hits = { ip: [], path: [], bot: [], status: [], time: [] };
  let totalLines = 0;
  let parsedLines = 0;
  let botLines = 0;
  let minT = Infinity;
  let maxT = -Infinity;
  let rest = '';
  let read = 0;
  let lastReport = 0;

  const handle = (line) => {
    totalLines++;
    const r = parser.parse(line.trim());
    if (!r) return;
    parsedLines++;
    if (r.time) {
      if (r.time < minT) minT = r.time;
      if (r.time > maxT) maxT = r.time;
    }
    const bot = botOf(r.ua);
    if (bot < 0 || !r.path) return;
    botLines++;
    if (hits.ip.length >= MAX_HITS) return;
    let ii = ipIdx.get(r.ip);
    if (ii === undefined) {
      ii = ips.length;
      ips.push(r.ip);
      ipIdx.set(r.ip, ii);
    }
    let pi = pathIdx.get(r.path);
    if (pi === undefined) {
      pi = paths.length;
      paths.push(r.path);
      pathIdx.set(r.path, pi);
    }
    hits.ip.push(ii);
    hits.path.push(pi);
    hits.bot.push(bot);
    hits.status.push(r.status);
    hits.time.push(r.time || 0);
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    read += value.length;
    const chunk = rest + value;
    const lines = chunk.split('\n');
    rest = lines.pop();
    for (const line of lines) handle(line);
    if (read - lastReport > 2_000_000) {
      lastReport = read;
      onProgress?.({ chars: read, size: file.size, lines: totalLines });
      await new Promise((r) => setTimeout(r, 0)); // arayüz donmasın
    }
  }
  if (rest) handle(rest);
  if (!parsedLines) throw new Error('Log biçimi tanınamadı. Apache/Nginx combined, JSON satırları veya W3C/IIS biçimi desteklenir.');
  return {
    format: parser.format(), totalLines, parsedLines, botLines, truncated: botLines > hits.ip.length,
    rangeStart: Number.isFinite(minT) ? new Date(minT).toISOString() : null,
    rangeEnd: Number.isFinite(maxT) ? new Date(maxT).toISOString() : null,
    ips, paths, hits,
  };
}

/** Doğrulanacak (IP, bot ailesi) çiftleri: en çok istek yapanlardan en fazla 5000. */
export function verificationTargets(parsed) {
  const counts = new Map();
  const { hits, ips } = parsed;
  for (let i = 0; i < hits.ip.length; i++) {
    const family = BOTS[hits.bot[i]].family;
    if (!family) continue;
    const key = `${family}|${ips[hits.ip[i]]}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5000).map(([k]) => {
    const [bot, ...ip] = k.split('|');
    return { bot, ip: ip.join('|') };
  });
}

const FILE_TYPES = [
  ['Görsel', /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp)$/i], ['JavaScript', /\.m?js$/i], ['CSS', /\.css$/i],
  ['Font', /\.(woff2?|ttf|otf|eot)$/i], ['XML / site haritası', /\.xml$/i], ['PDF', /\.pdf$/i], ['JSON / API', /\.json$|^\/(wp-json|api)\//i],
];
const fileType = (p) => {
  const path = p.split('?')[0];
  for (const [label, re] of FILE_TYPES) if (re.test(path)) return label;
  return /\.[a-z0-9]{2,5}$/i.test(path) && !/\.(html?|php|aspx?)$/i.test(path) ? 'Diğer' : 'HTML sayfa';
};
const day = (t) => (t ? new Date(t).toISOString().slice(0, 10) : null);

/**
 * İkinci aşama: doğrulama sonucuna göre sahte botları ayıklayıp sunucuya gönderilecek özeti üretir.
 * @param {Record<string,'verified'|'fake'|'unknown'>} verdicts `${family}|${ip}` anahtarlı
 */
export function summarize(parsed, verdicts, fileName) {
  const { hits, ips, paths } = parsed;
  const bots = BOTS.map((b) => ({ key: b.key, label: b.label, group: b.group, hits: 0, verified: 0, fake: 0, unverified: 0 }));
  const daily = new Map();
  const statuses = new Map();
  const types = new Map();
  const urls = new Map();
  const fakeIps = new Map();
  const ai = new Map();

  for (let i = 0; i < hits.ip.length; i++) {
    const b = BOTS[hits.bot[i]];
    const stat = bots[hits.bot[i]];
    const ip = ips[hits.ip[i]];
    const verdict = b.family ? verdicts[`${b.family}|${ip}`] || 'unknown' : 'unknown';
    stat.hits++;
    if (verdict === 'fake') {
      stat.fake++;
      const k = `${b.family}|${ip}`;
      fakeIps.set(k, (fakeIps.get(k) || 0) + 1);
      continue; // sahte bot istekleri analizden çıkarılır
    }
    if (verdict === 'verified') stat.verified++;
    else stat.unverified++;

    const path = paths[hits.path[i]];
    const status = String(hits.status[i] || 0);
    const t = hits.time[i];
    const d = day(t);
    if (d) {
      const row = daily.get(d) || { date: d, google: 0, bing: 0, ai: 0, seo: 0, other: 0 };
      row[b.group]++;
      daily.set(d, row);
    }
    const st = statuses.get(status) || { code: status, google: 0, all: 0 };
    st.all++;
    if (b.group === 'google') st.google++;
    statuses.set(status, st);

    const u = urls.get(path) || { path, hits: 0, google: 0, bing: 0, ai: 0, statuses: {}, lastGoogle: 0 };
    u.hits++;
    if (b.group === 'google') {
      u.google++;
      if (t > u.lastGoogle) u.lastGoogle = t;
      types.set(fileType(path), (types.get(fileType(path)) || 0) + 1);
    } else if (b.group === 'bing') u.bing++;
    else if (b.group === 'ai') u.ai++;
    u.statuses[status] = (u.statuses[status] || 0) + 1;
    urls.set(path, u);

    if (b.group === 'ai') {
      const a = ai.get(b.key) || { bot: b.label, hits: 0, paths: new Map() };
      a.hits++;
      a.paths.set(path, (a.paths.get(path) || 0) + 1);
      ai.set(b.key, a);
    }
  }

  const topUrls = [...urls.values()]
    .sort((a, b) => b.google - a.google || b.hits - a.hits)
    .slice(0, 5000)
    .map((u) => ({
      ...u,
      // durum kodu sözlüğü en sık 20 kodla sınırlı (şema sınırı)
      statuses: Object.fromEntries(Object.entries(u.statuses).sort((a, b) => b[1] - a[1]).slice(0, 20)),
      lastGoogle: u.lastGoogle ? new Date(u.lastGoogle).toISOString() : null,
    }));
  return {
    fileName: fileName.slice(0, 255),
    format: parsed.format || 'Bilinmiyor',
    totalLines: parsed.totalLines,
    parsedLines: parsed.parsedLines,
    rangeStart: parsed.rangeStart,
    rangeEnd: parsed.rangeEnd,
    bots: bots.filter((b) => b.hits > 0).sort((a, b) => b.hits - a.hits),
    daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-400),
    statuses: [...statuses.values()].sort((a, b) => b.all - a.all).slice(0, 80),
    fileTypes: [...types.entries()].map(([type, n]) => ({ type, hits: n })).sort((a, b) => b.hits - a.hits),
    urls: topUrls,
    fake: [...fakeIps.entries()].sort((a, b) => b[1] - a[1]).slice(0, 200).map(([k, n]) => {
      const [bot, ...ip] = k.split('|');
      return { bot, ip: ip.join('|'), hits: n };
    }),
    ai: [...ai.values()].sort((a, b) => b.hits - a.hits).slice(0, 30).map((a) => ({
      bot: a.bot, hits: a.hits, urls: a.paths.size,
      topPaths: [...a.paths.entries()].sort((x, y) => y[1] - x[1]).slice(0, 10).map(([path, n]) => ({ path, hits: n })),
    })),
  };
}
