import * as cheerio from 'cheerio';
import { query } from '../../db/pool.js';
import { safeFetch } from '../../utils/safeFetch.js';
import { STOPWORDS, lowerFor } from '../audit/keywordExtractor.js';
import { getMetrics } from './domainMetrics.js';

/**
 * Site otoritesi: 5 bileşenden ağırlıklı 0-100 puan + bileşen başına somut öneriler.
 * Veri olmayan bileşen puana katılmaz (ağırlıklar mevcut bileşenlere göre normalize edilir).
 */
const WEIGHTS = { backlinks: 35, topical: 25, brand: 15, trust: 15, technical: 10 };
const clamp = (v, min = 0, max = 1) => Math.max(min, Math.min(max, v));
const logScale = (v, full) => clamp(Math.log10(1 + Math.max(0, v)) / Math.log10(1 + full));
const round = (v) => (v === null || v === undefined ? null : Math.round(v));
const bareHost = (h) => String(h).toLowerCase().replace(/^www\./, '');

const brandLabel = (hostname) => bareHost(hostname).split('.')[0].replace(/-/g, '');
const isBrandQuery = (q, brand) => brand.length >= 4 && q.toLowerCase().replace(/[\s-]/g, '').includes(brand);

// ------------------------------------------------------------------ Veri toplama
async function backlinkData(domainId) {
  const [rd, totals, anchors, targets] = await Promise.all([
    query(
      `SELECT source_domain, count(*)::int AS links, count(*) FILTER (WHERE rel = 'dofollow')::int AS dofollow, max(risk_score)::int AS risk
         FROM backlinks WHERE domain_id = $1 AND status = 'active' GROUP BY source_domain`,
      [domainId],
    ),
    query(
      `SELECT count(*) FILTER (WHERE status = 'active')::int AS active,
              count(*) FILTER (WHERE status = 'active' AND first_seen > now() - interval '30 days')::int AS new_30d,
              count(*) FILTER (WHERE status = 'lost' AND lost_at > now() - interval '30 days')::int AS lost_30d,
              count(*)::int AS all_links
         FROM backlinks WHERE domain_id = $1`,
      [domainId],
    ),
    query(
      `SELECT COALESCE(NULLIF(lower(trim(anchor)), ''), '') AS anchor, count(*)::int AS links
         FROM backlinks WHERE domain_id = $1 AND status = 'active' GROUP BY 1 ORDER BY 2 DESC LIMIT 20`,
      [domainId],
    ),
    query(
      `SELECT count(*) FILTER (WHERE target_url ~ '^https?://[^/]+/?$')::int AS home, count(*)::int AS total
         FROM backlinks WHERE domain_id = $1 AND status = 'active' AND target_url IS NOT NULL`,
      [domainId],
    ),
  ]);
  return { referring: rd.rows, totals: totals.rows[0], anchors: anchors.rows, targets: targets.rows[0] };
}

async function gscData(domainId) {
  const { rows } = await query(
    `WITH b AS (SELECT max(date) AS e FROM gsc_query_daily WHERE domain_id = $1)
     SELECT query,
            COALESCE(SUM(clicks) FILTER (WHERE date > b.e - 28), 0)::int AS clicks,
            COALESCE(SUM(impressions) FILTER (WHERE date > b.e - 28), 0)::int AS impressions,
            SUM(position * impressions) FILTER (WHERE date > b.e - 28) / NULLIF(SUM(impressions) FILTER (WHERE date > b.e - 28), 0) AS position,
            COALESCE(SUM(clicks) FILTER (WHERE date <= b.e - 28), 0)::int AS prev_clicks,
            COALESCE(SUM(impressions) FILTER (WHERE date <= b.e - 28), 0)::int AS prev_impressions
       FROM gsc_query_daily, b WHERE domain_id = $1 AND date > b.e - 56 GROUP BY query`,
    [domainId],
  );
  return rows;
}

async function crawlData(domainId) {
  const { rows: [audit] } = await query(
    `SELECT id, score, site_info FROM audits WHERE domain_id = $1 AND status = 'completed' ORDER BY created_at DESC LIMIT 1`,
    [domainId],
  );
  if (!audit) return null;
  const { rows: pages } = await query(
    `SELECT url, title, word_count, schema_types, inlinks, status_code, noindex, depth, lang FROM audit_pages WHERE audit_id = $1`,
    [audit.id],
  );
  return { audit, pages };
}

/** Ana sayfadan güven sinyalleri: JSON-LD sameAs, telefon, adres. */
async function homepageSignals(hostname) {
  try {
    const res = await safeFetch(`https://${hostname}/`, { timeoutMs: 15_000, maxBytes: 3 * 1024 * 1024 });
    const $ = cheerio.load(res.body);
    const sameAs = new Set();
    let address = $('address').length > 0;
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const walk = (n) => {
          if (Array.isArray(n)) return n.forEach(walk);
          if (!n || typeof n !== 'object') return;
          [].concat(n.sameAs || []).forEach((u) => typeof u === 'string' && sameAs.add(u));
          if (n.address || n['@type'] === 'PostalAddress') address = true;
          Object.values(n).forEach((v) => typeof v === 'object' && walk(v));
        };
        walk(JSON.parse($(el).text()));
      } catch {
        /* geçersiz JSON-LD */
      }
    });
    const social = $('a[href]').map((_, a) => $(a).attr('href')).get()
      .filter((h) => /(facebook|instagram|linkedin|youtube|twitter|x\.com|tiktok|pinterest)\./i.test(h)).length;
    return { reachable: true, https: res.finalUrl.startsWith('https://'), hsts: Boolean(res.headers['strict-transport-security']), sameAs: sameAs.size, social, phone: $('a[href^="tel:"]').length > 0, address };
  } catch {
    return { reachable: false };
  }
}

async function technicalData(domainId) {
  const { rows: [r] } = await query(
    `SELECT (SELECT performance FROM pagespeed_reports WHERE domain_id = $1 AND strategy = 'mobile' AND status = 'completed' ORDER BY created_at DESC LIMIT 1) AS psi,
            (SELECT count(*) FILTER (WHERE verdict = 'PASS')::float / NULLIF(count(*) FILTER (WHERE verdict IS NOT NULL), 0) FROM index_inspections WHERE domain_id = $1) AS index_rate`,
    [domainId],
  );
  return r;
}

// ------------------------------------------------------------------ Konu kümeleri
/**
 * Sorguları (impression ağırlıklı) en sık geçen 2'li / tekli ifadelere göre kümeler.
 * Örn. "fue hair transplant", "dhi hair transplant" -> "hair transplant"; "beard transplant" ayrı küme.
 */
export function topicClusters(queries, lang) {
  const lower = lowerFor(lang);
  const tokensOf = (q) => (lower(q).match(/[\p{L}\p{N}]+/gu) || []).filter((t) => t.length >= 2 && !STOPWORDS.has(t));
  const items = queries.filter((q) => q.impressions >= 5).map((q) => ({ ...q, tokens: tokensOf(q.query) }));
  const score = new Map();
  const add = (k, q) => {
    const s = score.get(k) || { key: k, n: 0, w: 0 };
    s.n += 1;
    s.w += q.impressions;
    score.set(k, s);
  };
  for (const q of items) {
    const seen = new Set();
    for (let i = 0; i < q.tokens.length; i++) {
      for (const k of [q.tokens[i], q.tokens[i + 1] ? `${q.tokens[i]} ${q.tokens[i + 1]}` : null]) if (k && !seen.has(k)) { seen.add(k); add(k, q); }
    }
  }
  // Sorguların %25+’inde geçen ifade sitenin ana konusudur (ör. "hair transplant"); küme olarak değil,
  // ayrı raporlanır ve onu oluşturan kelimeler de küme başlığı olamaz. Böylece özgül alt konular (fue, dhi, beard…) çıkar.
  const generic = new Set();
  let mainTopic = null;
  for (const s of [...score.values()].sort((a, b) => b.w - a.w)) {
    if (s.n >= items.length * 0.25) {
      generic.add(s.key);
      s.key.split(' ').forEach((t) => generic.add(t));
      if (!mainTopic || (s.key.includes(' ') && !mainTopic.includes(' '))) mainTopic = s.key;
    }
  }
  const ranked = [...score.values()]
    .filter((s) => s.n >= 3 && !generic.has(s.key))
    .sort((a, b) => b.w * (b.key.includes(' ') ? 1.5 : 1) - a.w * (a.key.includes(' ') ? 1.5 : 1));
  const heads = [];
  const assigned = new Set();
  for (const s of ranked) {
    if (heads.length >= 12) break;
    const parts = s.key.split(' ');
    const members = items.filter((q) => !assigned.has(q.query) && (parts.length === 1 ? q.tokens.includes(s.key) : q.tokens.join(' ').includes(s.key)));
    if (members.length < 3) continue;
    members.forEach((q) => assigned.add(q.query));
    heads.push({ topic: s.key, members });
  }
  const result = heads.map(({ topic, members }) => {
    const imp = members.reduce((a, q) => a + q.impressions, 0);
    const top10 = members.filter((q) => q.position <= 10).length;
    const striking = members.filter((q) => q.position > 10 && q.position <= 30);
    return {
      topic,
      queries: members.length,
      impressions: imp,
      clicks: members.reduce((a, q) => a + q.clicks, 0),
      position: imp ? Math.round((members.reduce((a, q) => a + q.position * q.impressions, 0) / imp) * 10) / 10 : null,
      top3: members.filter((q) => q.position <= 3).length,
      top10,
      striking: striking.length,
      strikingImpressions: striking.reduce((a, q) => a + q.impressions, 0),
      examples: members.sort((a, b) => b.impressions - a.impressions).slice(0, 5).map((q) => ({ query: q.query, position: Math.round(q.position * 10) / 10, impressions: q.impressions })),
    };
  }).sort((a, b) => b.impressions - a.impressions);
  return Object.assign(result, { mainTopic });
}

// ------------------------------------------------------------------ Güven sinyalleri (E-E-A-T)
const PAGE_PATTERNS = {
  about: /(about|hakkimizda|hakkımızda|kurumsal|ueber-uns|uber-uns|qui-sommes|chi-siamo|sobre|o-nas|who-we-are|our-story)/i,
  contact: /(contact|iletisim|iletişim|kontakt|contatti|contacto|contato)/i,
  privacy: /(privacy|gizlilik|kvkk|datenschutz|confidentialite|privacidad|cookie)/i,
  team: /(team|ekibimiz|doctors|doktorlar|doktor|uzman|our-doctors|staff|kadro)/i,
};

function trustChecklist(crawl, home, metrics) {
  const pages = crawl?.pages || [];
  const has = (re) => pages.some((p) => re.test(p.url) || re.test(p.title || ''));
  const types = new Set(pages.flatMap((p) => p.schema_types || []));
  const anyType = (...t) => t.some((x) => types.has(x));
  const age = metrics.registeredAt ? (Date.now() - new Date(metrics.registeredAt)) / (365.25 * 86_400_000) : null;
  const items = [
    { key: 'https', label: 'HTTPS', weight: 8, pass: home.reachable ? home.https : null,
      fix: 'Geçerli bir SSL sertifikası kurup tüm sayfaları HTTPS’e 301 ile yönlendirin.' },
    { key: 'hsts', label: 'HSTS güvenlik başlığı', weight: 3, pass: home.reachable ? home.hsts : null,
      fix: 'Sunucu yanıtlarına “Strict-Transport-Security: max-age=31536000; includeSubDomains” başlığını ekleyin.' },
    { key: 'about', label: 'Hakkımızda sayfası', weight: 12, pass: crawl ? has(PAGE_PATTERNS.about) : null,
      fix: 'Kurumun geçmişini, kadrosunu, akreditasyonlarını ve fiziksel adresini anlatan bir “Hakkımızda” sayfası yayınlayın ve menüden bağlayın.' },
    { key: 'contact', label: 'İletişim sayfası', weight: 10, pass: crawl ? has(PAGE_PATTERNS.contact) : null,
      fix: 'Telefon, adres, harita ve çalışma saatlerini içeren bir iletişim sayfası ekleyin.' },
    { key: 'privacy', label: 'Gizlilik / KVKK politikası', weight: 6, pass: crawl ? has(PAGE_PATTERNS.privacy) : null,
      fix: 'Gizlilik politikası ve KVKK/GDPR aydınlatma metnini yayınlayıp alt bilgiden bağlayın.' },
    { key: 'team', label: 'Uzman / doktor kadrosu sayfası', weight: 8, pass: crawl ? has(PAGE_PATTERNS.team) || anyType('Physician', 'Person') : null,
      fix: 'İçerikleri hazırlayan veya hizmeti veren uzmanlar için ayrı profil sayfaları oluşturun (eğitim, deneyim, sertifikalar, fotoğraf).' },
    { key: 'org_schema', label: 'Kurum yapısal verisi (Organization / LocalBusiness / MedicalClinic)', weight: 12,
      pass: crawl ? anyType('Organization', 'LocalBusiness', 'MedicalClinic', 'MedicalBusiness', 'MedicalOrganization', 'Hospital', 'Dentist', 'Physician', 'ProfessionalService') : null,
      fix: 'Ana sayfaya ad, logo, adres, telefon, sameAs (sosyal profiller) içeren Organization veya MedicalClinic JSON-LD ekleyin.' },
    { key: 'author_schema', label: 'Yazar / uzman yapısal verisi (Person, Physician)', weight: 8, pass: crawl ? anyType('Person', 'Physician') : null,
      fix: 'Blog ve hizmet içeriklerinde yazarı/uzmanı Person veya Physician şemasıyla işaretleyip profil sayfasına bağlayın.' },
    { key: 'reviews', label: 'Yorum / puan yapısal verisi', weight: 8, pass: crawl ? anyType('Review', 'AggregateRating') : null,
      fix: 'Gerçek hasta/müşteri yorumlarını Review ve AggregateRating şemasıyla işaretleyin (Google kurallarına uygun, kendi sitenizde toplanan yorumlar).' },
    { key: 'same_as', label: 'Sosyal profiller (sameAs / bağlantılar)', weight: 10, pass: home.reachable ? home.sameAs > 0 || home.social >= 2 : null,
      fix: 'Organization şemasına sameAs ile Google Business Profile, Instagram, YouTube, LinkedIn vb. resmi profilleri ekleyin.' },
    { key: 'nap', label: 'Telefon ve adres (NAP) görünür', weight: 8, pass: home.reachable ? home.phone && home.address : null, partial: home.phone || home.address,
      fix: 'Telefonu tıklanabilir (tel:) yapın ve açık adresi alt bilgide ve şemada tutarlı şekilde gösterin.' },
    { key: 'age', label: 'Alan adı yaşı (2+ yıl)', weight: 8, pass: age === null ? null : age >= 2, value: age === null ? null : Math.round(age * 10) / 10,
      fix: 'Alan adı yaşı değiştirilemez; düzenli içerik ve bağlantı geçmişiyle güven zamanla birikir. Alan adını uzun süreli yenileyin.' },
  ];
  const known = items.filter((i) => i.pass !== null);
  const total = known.reduce((a, i) => a + i.weight, 0);
  const got = known.reduce((a, i) => a + (i.pass ? i.weight : i.partial ? i.weight / 2 : 0), 0);
  return { items, score: total ? round((got / total) * 100) : null };
}

// ------------------------------------------------------------------ Hesaplama
export async function computeAuthority(domain) {
  const own = bareHost(domain.hostname);
  const brand = brandLabel(domain.hostname);
  const [bl, queries, crawl, home, tech] = await Promise.all([
    backlinkData(domain.id), domain.gsc_property ? gscData(domain.id) : [], crawlData(domain.id), homepageSignals(domain.hostname), technicalData(domain.id),
  ]);
  const metrics = await getMetrics([own, ...bl.referring.map((r) => r.source_domain)], own);
  const ownM = metrics.get(own) || {};
  const recs = [];
  const rec = (pillar, priority, title, detail, actions = []) => recs.push({ pillar, priority, title, detail, actions });

  // ---- Backlink otoritesi
  const rd = bl.referring.map((r) => ({ ...r, opr: metrics.get(bareHost(r.source_domain))?.opr ?? null }));
  const rdDofollow = rd.filter((r) => r.dofollow > 0);
  const withOpr = rd.filter((r) => r.opr !== null);
  const avgOpr = withOpr.length ? withOpr.reduce((a, r) => a + r.opr, 0) / withOpr.length : null;
  const hq = rd.filter((r) => r.opr !== null && r.opr >= 4 && r.dofollow > 0);
  const risky = rd.filter((r) => r.risk >= 40);
  const activeLinks = bl.totals.active;
  const topAnchor = bl.anchors.find((a) => a.anchor);
  const topAnchorShare = activeLinks && topAnchor ? topAnchor.links / activeLinks : 0;
  const homeShare = bl.targets.total ? bl.targets.home / bl.targets.total : 0;
  const nofollowShare = activeLinks ? 1 - rd.reduce((a, r) => a + r.dofollow, 0) / activeLinks : 0;
  let backlinks = null;
  if (rd.length) {
    const s = 0.4 * logScale(rdDofollow.length, 500) + 0.25 * (avgOpr === null ? logScale(rd.length, 300) : clamp(avgOpr / 5))
      + 0.2 * (avgOpr === null ? 0.5 : clamp(hq.length / 30)) + 0.15 * (1 - clamp((risky.length / rd.length) * 2));
    backlinks = round(s * 100);
    if (rdDofollow.length < 50) {
      rec('backlinks', 'high', `Sadece ${rdDofollow.length} alan adından dofollow bağlantı var`,
        'Otoritenin en güçlü sinyali, farklı ve güvenilir alan adlarından gelen dofollow bağlantılardır. Ayda düzenli olarak yeni alan adı kazanmayı hedefleyin.',
        ['Sektör rehberleri ve platformlar (ör. medikal turizm / klinik karşılaştırma siteleri, yerel dizinler)', 'Basın bülteni ve haber sitelerinde röportaj / uzman görüşü',
          'Misafir yazarlık: sektör blogları ve dernek yayınları', 'Tedarikçi, iş ortağı, sponsorluk ve etkinlik sayfalarından bağlantı', 'Veri/araştırma içerikleri (istatistik, fiyat rehberi) ile doğal bağlantı kazanımı']);
    }
    if (avgOpr !== null && avgOpr < 3) {
      rec('backlinks', 'medium', `Bağlantı veren sitelerin ortalama otoritesi düşük (${avgOpr.toFixed(1)}/10)`,
        'Çok sayıda zayıf siteden gelen bağlantı yerine az sayıda güçlü siteden bağlantı almak daha değerlidir.',
        ['Open PageRank 4+ olan sektör sitelerini hedefleyin (aşağıdaki listede güçlü bağlantılarınızı örnek alın)', 'Düşük kaliteli dizin ve forum bağlantılarına yatırım yapmayın']);
    }
    if (risky.length) {
      rec('backlinks', risky.length / rd.length > 0.1 ? 'high' : 'low', `${risky.length} alan adından riskli bağlantı`,
        'Spam uzantılı, link çiftliği veya şüpheli içerikli sitelerden gelen bağlantılar güveni zedeleyebilir.',
        ['Backlinkler sekmesinde “Riskli” filtresiyle inceleyin', 'Gerçekten spam olanlar için disavow dosyasını indirip Search Console’a yükleyin']);
    }
    if (bl.totals.lost_30d > bl.totals.new_30d && bl.totals.lost_30d > 0) {
      rec('backlinks', 'medium', `Son 30 günde ${bl.totals.lost_30d} bağlantı kaybedildi, ${bl.totals.new_30d} kazanıldı`,
        'Bağlantı profili küçülüyor. Kaybolan bağlantıların çoğu site yenilemesi veya kırık URL nedeniyle geri kazanılabilir.',
        ['Backlinkler → Kayıp listesindeki sitelerle iletişime geçin', 'Bağlantı verilen URL’niz değiştiyse eski adresten 301 yönlendirme yapın']);
    }
    if (topAnchorShare > 0.3 && topAnchor && !isBrandQuery(topAnchor.anchor, brand) && !topAnchor.anchor.includes(own)) {
      rec('backlinks', 'medium', `Anchor metni aşırı optimize: “${topAnchor.anchor}” bağlantıların %${Math.round(topAnchorShare * 100)}’inde`,
        'Doğal bir profilde marka adı ve URL anchor’ları baskındır; aynı ticari kelimenin tekrar etmesi manipülasyon sinyalidir.',
        ['Yeni bağlantılarda marka adı, alan adı ve “buraya tıklayın” gibi doğal anchor’ları tercih edin']);
    }
    if (homeShare > 0.8 && bl.targets.total >= 10) {
      rec('backlinks', 'medium', `Bağlantıların %${Math.round(homeShare * 100)}’i ana sayfaya gidiyor`,
        'Hizmet ve içerik sayfaları kendi bağlantılarını almadıkça o sayfaların sıralaması zayıf kalır.',
        ['Yeni bağlantıları ilgili hizmet sayfalarına yönlendirin', 'Bağlantı alan güçlü sayfalardan hizmet sayfalarına iç bağlantı verin']);
    }
    if (nofollowShare > 0.7 && activeLinks >= 10) {
      rec('backlinks', 'low', `Bağlantıların %${Math.round(nofollowShare * 100)}’i nofollow/ugc/sponsored`,
        'Nofollow bağlantılar trafik ve marka bilinirliği sağlar ama otorite aktarımı sınırlıdır.', ['Editoryal (dofollow) bağlantı kaynaklarına ağırlık verin']);
    }
  } else {
    rec('backlinks', 'high', 'Backlink verisi yok',
      'Otorite puanının en büyük bileşeni hesaplanamıyor.',
      ['Backlinkler sekmesinden Bing Webmaster API anahtarı ekleyin veya Search Console “En son bağlantılar” CSV’sini içe aktarın']);
  }

  // ---- Marka otoritesi ve konu otoritesi (Search Console)
  let brandScore = null;
  let topical = null;
  let clusters = [];
  const brandRows = queries.filter((q) => isBrandQuery(q.query, brand));
  const nonBrand = queries.filter((q) => !isBrandQuery(q.query, brand) && q.impressions > 0).map((q) => ({ ...q, position: Number(q.position) || 100 }));
  const brandClicks = brandRows.reduce((a, q) => a + q.clicks, 0);
  const brandPrev = brandRows.reduce((a, q) => a + q.prev_clicks, 0);
  const brandImpr = brandRows.reduce((a, q) => a + q.impressions, 0);
  const brandTrend = brandPrev ? (brandClicks - brandPrev) / brandPrev : null;
  if (queries.length) {
    brandScore = round((0.7 * logScale(brandClicks, 3000) + 0.3 * (brandTrend === null ? 0.5 : clamp(1 + brandTrend))) * 100);
    if (brandClicks < 100) {
      rec('brand', 'medium', `Marka aramaları zayıf (28 günde ${brandClicks} tıklama)`,
        'Google, markanızı adıyla arayan kullanıcıları güçlü bir güven ve otorite sinyali olarak değerlendirir.',
        ['Google Business Profile’ı eksiksiz doldurup düzenli gönderi ve yorum toplayın', 'YouTube / Instagram’da düzenli içerik ve marka adını öne çıkaran kampanyalar',
          'Basın ve sektör yayınlarında marka adının geçtiği haberler', 'Offline materyallerde (kartvizit, broşür) marka adıyla arama çağrısı']);
    }
    if (brandTrend !== null && brandTrend < -0.15) {
      rec('brand', 'high', `Marka aramaları %${Math.round(-brandTrend * 100)} azaldı`, 'Önceki 28 güne göre markanızı arayan kişi sayısı düşüyor.',
        ['Reklam / sosyal medya bütçesindeki değişiklikleri kontrol edin', 'Rakiplerin marka aramalarınızda reklam verip vermediğine bakın', 'Marka adı benzeri sitelerle karışma olup olmadığını inceleyin']);
    }

    const siteLang = crawl?.pages?.find((p) => p.depth === 0)?.lang || crawl?.pages?.find((p) => p.lang)?.lang || null;
    clusters = topicClusters(nonBrand, siteLang);
    const top10 = nonBrand.filter((q) => q.position <= 10 && q.impressions >= 10).length;
    const top3 = nonBrand.filter((q) => q.position <= 3 && q.impressions >= 10).length;
    const avgWords = crawl ? crawl.pages.filter((p) => p.status_code === 200).reduce((a, p, _, arr) => a + (p.word_count || 0) / arr.length, 0) : null;
    topical = round((0.45 * logScale(top10, 500) + 0.3 * logScale(top3, 100) + 0.25 * (avgWords === null ? 0.5 : clamp(avgWords / 1200))) * 100);

    for (const c of clusters.filter((x) => x.striking >= 3 && x.strikingImpressions >= 100).slice(0, 4)) {
      rec('topical', 'high', `“${c.topic}” konusunda ${c.striking} sorgu 11–30. sırada`,
        `Bu kümede ${c.queries} sorgu ve ${c.impressions} gösterim var; sadece ${c.top10} sorgu ilk 10’da. Konuyu kapsamlı işleyen bir ana (pillar) sayfa ve onu destekleyen içeriklerle konu otoritesi kurulabilir.`,
        [`“${c.topic}” için kapsamlı bir rehber sayfası (SSS, fiyat, süreç, öncesi/sonrası, uzman görüşü)`,
          `Örnek sorgular: ${c.examples.map((e) => `“${e.query}”`).join(', ')}`, 'Destek içerikleri bu sayfaya, bu sayfa da hizmet sayfasına iç bağlantı versin']);
    }
    if (top10 < 30) {
      rec('topical', 'medium', `Marka dışı sadece ${top10} kelimede ilk 10’dasınız`,
        'Konu otoritesi, bir alanda çok sayıda sorguda görünür olmakla oluşur.',
        ['Fırsatlar → İçerik boşlukları listesindeki sorguları ilgili sayfalara işleyin', 'Her hizmet için en az bir kapsamlı sayfa ve 3–5 destek içerik planlayın']);
    }
    if (avgWords !== null && avgWords < 600) {
      rec('topical', 'medium', `Sayfaların ortalama içeriği kısa (${Math.round(avgWords)} kelime)`,
        'Kısa içerikler konuyu derinlemesine işlemediği için otorite ve uzmanlık sinyali zayıf kalır.', ['Ana hizmet sayfalarını 1.000+ kelimeye, gerçek sorulara yanıt veren bölümlerle genişletin']);
    }
  } else {
    rec('topical', 'medium', 'Search Console bağlı değil', 'Konu ve marka otoritesi Google arama verisi olmadan hesaplanamıyor.', ['Alan adı ayarlarından Search Console mülkünü seçin']);
  }

  // ---- Güven (E-E-A-T)
  const trust = trustChecklist(crawl, home, ownM);
  for (const i of trust.items.filter((x) => x.pass === false)) {
    rec('trust', i.weight >= 10 ? 'high' : 'medium', `Eksik güven sinyali: ${i.label}`, i.fix);
  }
  if (!crawl) rec('trust', 'medium', 'Site taraması yok', 'Güven sinyallerinin çoğu tarama verisinden okunur.', ['Site Sağlığı sekmesinden tarama başlatın']);

  // ---- Teknik
  const parts = [[crawl?.audit?.score, 0.5], [tech.psi, 0.3], [tech.index_rate === null ? null : tech.index_rate * 100, 0.2]].filter(([v]) => v !== null && v !== undefined);
  const wsum = parts.reduce((a, [, w]) => a + w, 0);
  const technical = wsum ? round(parts.reduce((a, [v, w]) => a + v * w, 0) / wsum) : null;
  if (crawl?.audit?.score !== undefined && crawl.audit.score < 80) rec('technical', 'medium', `Site sağlığı puanı ${crawl.audit.score}`, 'Teknik sorunlar tarama ve indekslemeyi zayıflatır; otorite sayfalara tam aktarılamaz.', ['Site Sağlığı sekmesindeki kritik sorunları çözün']);
  if (tech.psi !== null && tech.psi < 50) rec('technical', 'medium', `Mobil hız puanı ${tech.psi}`, 'Yavaş sayfalar kullanıcı sinyallerini ve tarama bütçesini olumsuz etkiler.', ['Hız & Web Vitals sekmesindeki önerileri uygulayın']);
  if (tech.index_rate !== null && tech.index_rate < 0.8) rec('technical', 'high', `Denetlenen sayfaların sadece %${Math.round(tech.index_rate * 100)}’i indeksli`, 'İndekslenmeyen sayfalar otorite kazanamaz.', ['İndeksleme sekmesindeki nedenleri inceleyin']);

  // ---- Toplam
  const pillars = {
    backlinks: { score: backlinks, weight: WEIGHTS.backlinks },
    topical: { score: topical, weight: WEIGHTS.topical },
    brand: { score: brandScore, weight: WEIGHTS.brand },
    trust: { score: trust.score, weight: WEIGHTS.trust },
    technical: { score: technical, weight: WEIGHTS.technical },
  };
  const avail = Object.values(pillars).filter((p) => p.score !== null);
  const missing = Object.entries(pillars).filter(([, p]) => p.score === null).map(([k]) => k);
  const total = avail.length ? round(avail.reduce((a, p) => a + p.score * p.weight, 0) / avail.reduce((a, p) => a + p.weight, 0)) : 0;
  const PRIO = { high: 0, medium: 1, low: 2 };
  recs.sort((a, b) => PRIO[a.priority] - PRIO[b.priority] || WEIGHTS[b.pillar] - WEIGHTS[a.pillar]);

  const snapshotMetrics = {
    partial: missing.length > 0,
    missingPillars: missing,
    external: {
      opr: ownM.opr ?? null, oprRank: ownM.oprRank ?? null, trancoRank: ownM.trancoRank ?? null,
      registeredAt: ownM.registeredAt ?? null, oprEnabled: metrics.oprEnabled, oprError: metrics.oprError,
    },
    backlinks: {
      referringDomains: rd.length, dofollowDomains: rdDofollow.length, avgOpr: avgOpr === null ? null : Math.round(avgOpr * 100) / 100,
      highQuality: hq.length, risky: risky.length, activeLinks, new30d: bl.totals.new_30d, lost30d: bl.totals.lost_30d,
      homeShare: Math.round(homeShare * 100) / 100, topAnchor: topAnchor?.anchor || null, topAnchorShare: Math.round(topAnchorShare * 100) / 100,
      oprDistribution: [[0, 2], [2, 4], [4, 6], [6, 11]].map(([a, b]) => ({ range: `${a}–${b === 11 ? 10 : b}`, domains: withOpr.filter((r) => r.opr >= a && r.opr < b).length })),
      topDomains: rd.sort((a, b) => (b.opr ?? -1) - (a.opr ?? -1) || b.links - a.links).slice(0, 100),
    },
    brand: { clicks: brandClicks, prevClicks: brandPrev, impressions: brandImpr, queries: brandRows.length, trend: brandTrend },
    topical: {
      nonBrandQueries: nonBrand.length,
      top10: nonBrand.filter((q) => q.position <= 10 && q.impressions >= 10).length,
      top3: nonBrand.filter((q) => q.position <= 3 && q.impressions >= 10).length,
      clusters,
      mainTopic: clusters.mainTopic || null,
    },
    trust: trust.items.map(({ fix, ...i }) => ({ ...i, fix })),
    technical: { auditScore: crawl?.audit?.score ?? null, psi: tech.psi, indexRate: tech.index_rate },
  };

  const { rows: [snap] } = await query(
    `INSERT INTO authority_snapshots (domain_id, score, pillars, metrics, recommendations) VALUES ($1, $2, $3, $4, $5)
     RETURNING id, created_at`,
    [domain.id, total, JSON.stringify(pillars), JSON.stringify(snapshotMetrics), JSON.stringify(recs)],
  );
  return { id: snap.id, created_at: snap.created_at, score: total, pillars, metrics: snapshotMetrics, recommendations: recs };
}

export async function latest(domain) {
  const [{ rows: [snap] }, { rows: history }] = await Promise.all([
    query(
      'SELECT id, score, pillars, metrics, recommendations, created_at FROM authority_snapshots WHERE domain_id = $1 ORDER BY created_at DESC LIMIT 1',
      [domain.id],
    ),
    query(
      `SELECT score, pillars, created_at FROM authority_snapshots WHERE domain_id = $1 ORDER BY created_at DESC LIMIT 26`,
      [domain.id],
    ),
  ]);
  return { snapshot: snap || null, history: history.reverse() };
}
