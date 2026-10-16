import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import zlib from 'node:zlib';

/**
 * Kullanıcının verdiği alan adlarına istek atan tek yer.
 * SSRF koruması: DNS çözümlemesi bağlantı anında doğrulanır (DNS rebinding'e karşı),
 * özel/ayrılmış IP'ler, http/https dışı şemalar ve 80/443 dışı portlar reddedilir,
 * yönlendirmeler her adımda yeniden doğrulanır, gövde boyutu ve süre sınırlıdır.
 */

const blocked = new net.BlockList();
[
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
].forEach(([a, p]) => blocked.addSubnet(a, p, 'ipv4'));
[
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['100::', 64], ['2001:db8::', 32], ['2002::', 16],
  ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
].forEach(([a, p]) => blocked.addSubnet(a, p, 'ipv6'));

export function isBlockedIp(ip) {
  const family = net.isIP(ip);
  if (family === 4) return blocked.check(ip, 'ipv4');
  if (family === 6) {
    const mapped = ip.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return blocked.check(mapped[1], 'ipv4');
    if (/^::ffff:/i.test(ip)) return true;
    return blocked.check(ip, 'ipv6');
  }
  return true;
}

function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const bad = addresses.find((a) => isBlockedIp(a.address));
    if (bad || addresses.length === 0) {
      const e = new Error(`Hedef adres engellendi: ${hostname}`);
      e.code = 'EBLOCKED';
      return callback(e);
    }
    if (options.all) return callback(null, addresses);
    return callback(null, addresses[0].address, addresses[0].family);
  });
}

const agents = {
  'http:': new http.Agent({ keepAlive: true, maxSockets: 8, lookup: safeLookup }),
  'https:': new https.Agent({ keepAlive: true, maxSockets: 8, lookup: safeLookup }),
};

export const USER_AGENT = 'Mozilla/5.0 (compatible; CRSeoBot/1.0; +https://crabsmedia.com)';

export function assertSafeUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw Object.assign(new Error('Geçersiz URL'), { code: 'EBADURL' });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw Object.assign(new Error('Sadece http/https desteklenir'), { code: 'EBADURL' });
  }
  if (url.username || url.password) throw Object.assign(new Error('URL kimlik bilgisi içeremez'), { code: 'EBADURL' });
  if (url.port && !['80', '443'].includes(url.port)) {
    throw Object.assign(new Error('Sadece 80/443 portlarına izin verilir'), { code: 'EBADURL' });
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && isBlockedIp(host)) throw Object.assign(new Error('Hedef adres engellendi'), { code: 'EBLOCKED' });
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw Object.assign(new Error('Hedef adres engellendi'), { code: 'EBLOCKED' });
  }
  url.hash = '';
  return url;
}

function requestOnce(url, { method, timeoutMs, maxBytes, headers }) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(
      url,
      {
        method,
        agent: agents[url.protocol],
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
          'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
          ...headers,
        },
      },
      (res) => {
        const ttfb = Math.round(performance.now() - started);
        const enc = String(res.headers['content-encoding'] || '').toLowerCase();
        let stream = res;
        if (enc === 'gzip' || enc === 'x-gzip') stream = res.pipe(zlib.createGunzip());
        else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
        else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());

        const chunks = [];
        let size = 0;
        let rawSize = 0;
        let truncated = false;
        res.on('data', (c) => { rawSize += c.length; });
        stream.on('data', (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            truncated = true;
            req.destroy();
            stream.destroy();
            finish();
            return;
          }
          chunks.push(chunk);
        });
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: method === 'HEAD' ? '' : Buffer.concat(chunks).toString('utf8'),
            bytes: rawSize,
            decodedBytes: size,
            truncated,
            ttfb,
            totalMs: Math.round(performance.now() - started),
          });
        };
        const fail = (e) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          reject(e);
        };
        stream.on('end', finish);
        stream.on('error', fail);
        if (stream !== res) res.on('error', fail);
        res.on('aborted', () => fail(Object.assign(new Error('Bağlantı kesildi'), { code: 'EABORTED' })));
      },
    );
    const timer = setTimeout(() => req.destroy(Object.assign(new Error('Zaman aşımı'), { code: 'ETIMEOUT' })), timeoutMs);
    req.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    req.end();
  });
}

/**
 * @returns {Promise<{url:string, finalUrl:string, status:number, headers:object, body:string,
 *   redirects:{url:string,status:number}[], ttfb:number, totalMs:number, bytes:number, truncated:boolean}>}
 */
export async function safeFetch(rawUrl, { method = 'GET', timeoutMs = 15_000, maxBytes = 5 * 1024 * 1024, maxRedirects = 5, headers = {} } = {}) {
  let url = assertSafeUrl(rawUrl);
  const redirects = [];
  for (let i = 0; i <= maxRedirects; i++) {
    const res = await requestOnce(url, { method, timeoutMs, maxBytes, headers });
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      redirects.push({ url: url.href, status: res.status });
      if (i === maxRedirects) {
        return { ...res, url: rawUrl, finalUrl: url.href, redirects, tooManyRedirects: true };
      }
      url = assertSafeUrl(new URL(res.headers.location, url).href);
      continue;
    }
    return { ...res, url: rawUrl, finalUrl: url.href, redirects };
  }
  throw new Error('unreachable');
}
