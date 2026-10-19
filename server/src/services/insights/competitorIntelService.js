import { query } from '../../db/pool.js';
import { getMetrics } from '../authority/domainMetrics.js';
import { latestForOrigins, originOf } from './cruxService.js';
import { serpOverview } from './serpTrackingService.js';

/**
 * Rakip istihbaratı: rakip ve kendi sitenizin içerik stratejisi, yayın hızı, dil kapsamı, yapısal veri kullanımı,
 * Core Web Vitals, otorite ve arama görünürlüğü karşılaştırılır; fark büyük olan noktalar otomatik "bulgu"
 * kartlarına dönüştürülür (tehdit / fırsat / güçlü yön), etkisine göre sıralanır.
 */

const SCHEMA_WATCH = {
  FAQPage: 'SSS (FAQPage)', Product: 'Ürün (Product)', Review: 'Yorum (Review)', AggregateRating: 'Puan (AggregateRating)',
  Article: 'Makale', BlogPosting: 'Blog yazısı', BreadcrumbList: 'Breadcrumb', VideoObject: 'Video', Person: 'Yazar (Person)', MedicalClinic: 'Klinik (MedicalClinic)',
};
const PAGE_TYPES = [
  ['blog', /\/(blog|haber|news|makale|article|yazi|rehber|guide|magazin)\b|\/\d{4}\/\d{2}\//i],
  ['location', /\/(sube|şube|location|lokasyon|city|il|ilce)\b/i],
  ['product', /\/(urun|ürün|product|shop|magaza|store)\b/i],
  ['category', /\/(kategori|category|tag|etiket)\b/i],
  ['legal', /\/(gizlilik|privacy|kvkk|cerez|cookie|terms|kosullar|sozlesme)\b/i],
  ['about', /\/(hakkimizda|hakkımızda|about|iletisim|contact|ekibimiz|team|doktor|doctor)\b/i],
];
const bare = (h) => String(h || '').toLowerCase().replace(/^www\./, '');
const pctFmt = (v) => `%${Math.round(v * 100)}`;

function pageType(url, types) {
  if ((types || []).some((t) => /Article|BlogPosting|NewsArticle/.test(t))) return 'blog';
  if ((types || []).includes('Product')) return 'product';
  let path = url;
  try {
    path = decodeURIComponent(new URL(url).pathname);
  } catch {
    /* ham yol */
  }
  for (const [t, re] of PAGE_TYPES) if (re.test(path)) return t;
  return path === '/' || /^\/[a-z]{2}\/?$/.test(path) ? 'home' : 'service';
}

/** Bir sitenin (kendi taramamız veya rakip taraması) istihbarat metrikleri. */
async function siteMetrics({ pagesSql, pagesParam, keywordsSql, sitemapSql, sitemapParam, templateTerms, sinceFirstCrawl }) {
  const [{ rows: pages }, { rows: topics }, { rows: [sm] }] = await Promise.all([
    query(pagesSql, [pagesParam]),
    query(keywordsSql, [pagesParam, templateTerms]),
    query(sitemapSql, [sitemapParam, sinceFirstCrawl]),
  ]);
  const ok = pages.filter((p) => p.status_code === 200);
  const n = ok.length || 1;
  const types = {};
  for (const p of ok) {
    const t = pageType(p.url, p.schema_types);
    types[t] = (types[t] || 0) + 1;
  }
  const schema = {};
  for (const t of Object.keys(SCHEMA_WATCH)) schema[t] = ok.filter((p) => (p.schema_types || []).includes(t)).length / n;
  const words = ok.map((p) => p.word_count || 0).sort((a, b) => a - b);
  // Yayın hızı (örneklem): son 12 ayda yayın tarihi olan sayfalar, ay bazında
  const months = {};
  const yearAgo = Date.now() - 365 * 86_400_000;
  for (const p of ok) {
    if (!p.published_at || Date.parse(p.published_at) < yearAgo) continue;
    const m = String(p.published_at).slice(0, 7);
    months[m] = (months[m] || 0) + 1;
  }
  const dated = ok.filter((p) => p.published_at).length;
  return {
    // Bu özellikten önceki taramalarda yayın tarihi / başlık yapısı toplanmadı: yayın hızı karşılaştırılamaz
    newFormat: ok.some((p) => p.has_outline),
    pages: pages.length,
    okPages: ok.length,
    medianWords: words.length ? words[Math.floor(words.length / 2)] : null,
    types,
    schema,
    authorShare: ok.filter((p) => (p.schema_types || []).includes('Person')).length / n,
    publishedLast12m: Object.values(months).reduce((a, b) => a + b, 0),
    datedShare: dated / n,
    months,
    topics: topics.map((t) => ({ topic: t.keyword, pages: t.pages })),
    sitemap: { urls: sm?.urls || 0, fresh90: sm?.fresh90 || 0, withLastmod: sm?.with_lastmod || 0, new30: sm?.new30 || 0, new90: sm?.new90 || 0 },
  };
}

const PAGES_SQL = (table, key) => `SELECT url, status_code, word_count, schema_types, published_at, outline IS NOT NULL AS has_outline FROM ${table} WHERE ${key} = $1`;
const TOPICS_SQL = (table, key) => `
  SELECT keyword, count(DISTINCT url)::int AS pages FROM ${table}
   WHERE ${key} = $1 AND (in_title OR in_h1) AND NOT (keyword = ANY($2::text[])) AND position(' ' in keyword) > 0
   GROUP BY keyword ORDER BY pages DESC LIMIT 60`;
const SITEMAP_SQL = (table, key) => `
  SELECT count(*)::int AS urls, count(lastmod)::int AS with_lastmod,
         count(*) FILTER (WHERE lastmod > now() - interval '90 days')::int AS fresh90,
         count(*) FILTER (WHERE first_seen > $2::timestamptz AND first_seen > now() - interval '30 days')::int AS new30,
         count(*) FILTER (WHERE first_seen > $2::timestamptz AND first_seen > now() - interval '90 days')::int AS new90
    FROM ${table} WHERE ${key} = $1`;

export async function competitorIntel(domain) {
  const { rows: [audit] } = await query(
    `SELECT id, score, site_info FROM audits WHERE domain_id = $1 AND status = 'completed' ORDER BY created_at DESC LIMIT 1`,
    [domain.id],
  );
  const { rows: comps } = await query(
    `SELECT id, hostname, score, site_info, created_at, finished_at FROM competitors WHERE domain_id = $1 AND status = 'completed' ORDER BY created_at`,
    [domain.id],
  );
  if (!audit || !comps.length) return { ready: false, needsAudit: !audit, sites: [], insights: [] };

  // İlk taramadan sonra görülen site haritası URL'leri "yeni" sayılır (ilk tarama tüm URL'leri ekler)
  const { rows: [firstSm] } = await query('SELECT min(first_seen) AS t FROM domain_sitemap_urls WHERE domain_id = $1', [domain.id]);
  const ownT = firstSm?.t ? new Date(new Date(firstSm.t).getTime() + 86_400_000) : new Date();
  const own = {
    id: null, hostname: domain.hostname, own: true, score: audit.score, languages: audit.site_info?.languages || null,
    origin: originOf(domain.hostname, audit.site_info?.finalUrl),
    ...(await siteMetrics({
      pagesSql: PAGES_SQL('audit_pages', 'audit_id'), pagesParam: audit.id, keywordsSql: TOPICS_SQL('audit_keywords', 'audit_id'),
      sitemapSql: SITEMAP_SQL('domain_sitemap_urls', 'domain_id'), sitemapParam: domain.id, templateTerms: audit.site_info?.templateTerms || [], sinceFirstCrawl: ownT,
    })),
  };
  const sites = [own];
  for (const c of comps) {
    const { rows: [f] } = await query('SELECT min(first_seen) AS t FROM competitor_sitemap_urls WHERE competitor_id = $1', [c.id]);
    const t = f?.t ? new Date(new Date(f.t).getTime() + 86_400_000) : new Date();
    const { rows: [ch] } = await query(
      `SELECT count(*) FILTER (WHERE kind = 'new_page')::int AS new_pages, count(*) FILTER (WHERE kind IN ('content_expanded', 'title', 'h1', 'schema_added'))::int AS updates
         FROM competitor_changes WHERE competitor_id = $1 AND created_at > now() - interval '30 days'`,
      [c.id],
    );
    const { rows: newest } = await query(
      `SELECT url, new_value AS title, created_at FROM competitor_changes WHERE competitor_id = $1 AND kind = 'new_page' ORDER BY created_at DESC LIMIT 5`,
      [c.id],
    );
    sites.push({
      id: c.id, hostname: c.hostname, own: false, score: c.score, languages: c.site_info?.languages || null,
      origin: originOf(c.hostname, c.site_info?.finalUrl), changes30: ch, newest,
      ...(await siteMetrics({
        pagesSql: PAGES_SQL('competitor_pages', 'competitor_id'), pagesParam: c.id, keywordsSql: TOPICS_SQL('competitor_keywords', 'competitor_id'),
        sitemapSql: SITEMAP_SQL('competitor_sitemap_urls', 'competitor_id'), sitemapParam: c.id, templateTerms: c.site_info?.templateTerms || [], sinceFirstCrawl: t,
      })),
    });
  }

  // Dış veriler: Core Web Vitals (CrUX), otorite (Open PageRank / Tranco / alan adı yaşı), arama görünürlüğü
  const [crux, serp] = await Promise.all([
    latestForOrigins(sites.map((s) => s.origin)).catch(() => null),
    serpOverview(domain).catch(() => null),
  ]);
  const metrics = await getMetrics(sites.map((s) => s.hostname)).catch(() => new Map());
  for (const s of sites) {
    s.cwv = crux?.[s.origin] || null;
    const m = metrics.get?.(bare(s.hostname));
    s.authority = m ? { opr: m.opr, trancoRank: m.trancoRank, registeredAt: m.registeredAt } : null;
    const sov = serp?.shareOfVoice?.find((x) => x.domain === bare(s.hostname));
    s.sov = serp?.summary?.checked ? { share: sov?.share || 0, keywords: sov?.keywords || 0, top3: sov?.top3 || 0 } : null;
    s.aiCitations = serp?.rows?.filter((r) => r.features?.aiOverview?.sources?.some((d) => d === bare(s.hostname))).length ?? null;
  }

  // Rakip/kendi marka adları "konu" sayılmaz
  const brands = sites.map((s) => bare(s.hostname).split('.')[0].replace(/-/g, ''));
  for (const s of sites) s.topics = s.topics.filter((t) => !brands.some((b) => b.length >= 4 && t.topic.replace(/\s/g, '').includes(b)));
  return {
    ready: true, sites, insights: buildInsights(own, sites.filter((s) => !s.own), serp), cruxEnabled: crux !== null, serpTracked: serp?.summary?.checked || 0,
    needsRecrawl: !own.newFormat,
  };
}

function buildInsights(own, rivals, serp) {
  const out = [];
  const add = (tone, impact, title, detail, site, metric) => out.push({ tone, impact, title, detail, competitor: site?.hostname || null, metric: metric || null });

  for (const c of rivals) {
    // Yayın hızı
    if (c.changes30?.new_pages >= 3 || c.sitemap.new30 >= 3) {
      const n = Math.max(c.changes30?.new_pages || 0, c.sitemap.new30);
      add('threat', 70 + Math.min(25, n), `${c.hostname} son 30 günde ${n} yeni sayfa yayınladı`,
        `${c.newest?.length ? `Son yayınlar: ${c.newest.slice(0, 3).map((x) => `“${x.title || x.url}”`).join(', ')}. ` : ''}Sizin aynı dönemde site haritanıza eklenen sayfa sayınız: ${own.sitemap.new30}. Düzenli yayın, Google’ın siteyi daha sık taramasını ve konu otoritesini artırır.`,
        c, { you: own.sitemap.new30, them: n });
    }
    if (own.newFormat && c.publishedLast12m >= 6 && c.publishedLast12m >= own.publishedLast12m * 2) {
      add('threat', 55, `${c.hostname} son 12 ayda sizden ${own.publishedLast12m ? `${Math.round(c.publishedLast12m / Math.max(1, own.publishedLast12m))} kat` : 'çok daha'} fazla tarihli içerik yayınladı`,
        `Taranan örneklemde ${c.publishedLast12m} yayın (sizde ${own.publishedLast12m}). Blog/rehber içerikleri bilgi amaçlı aramalarda görünürlük kazandırır ve hizmet sayfalarına iç bağlantı taşır.`, c,
        { you: own.publishedLast12m, them: c.publishedLast12m });
    }
    // Tazelik
    if (c.sitemap.withLastmod >= 10 && own.sitemap.withLastmod >= 10) {
      const cf = c.sitemap.fresh90 / c.sitemap.withLastmod;
      const of = own.sitemap.fresh90 / own.sitemap.withLastmod;
      if (cf - of >= 0.2) add('threat', 45, `${c.hostname} içeriklerini daha sık güncelliyor`, `Site haritasındaki sayfaların ${pctFmt(cf)}’i son 90 günde güncellenmiş; sizde ${pctFmt(of)}. Eski içerikleri güncellemek içerik erimesini önler.`, c, { you: of, them: cf, format: 'pct' });
    }
    // Dil kapsamı
    if (c.languages && own.languages) {
      const extra = c.languages.filter((l) => !own.languages.includes(l));
      if (extra.length >= 2) add('opportunity', 60 + extra.length * 2, `${c.hostname} sizde olmayan ${extra.length} dilde içerik sunuyor`, `Ek diller: ${extra.slice(0, 10).join(', ')}. Bu pazarlarda rakip tek başına görünüyor; hedef ülkeleriniz arasındaysa çeviri + hreflang ile yeni trafik açabilirsiniz.`, c, { you: own.languages.length, them: c.languages.length });
      const ours = own.languages.filter((l) => !c.languages.includes(l));
      if (ours.length >= 2) add('strength', 30, `${ours.length} dilde ${c.hostname}’in olmadığı pazarlardasınız`, `Sadece sizde olan diller: ${ours.slice(0, 10).join(', ')}.`, c);
    }
    // İçerik derinliği
    if (c.medianWords && own.medianWords) {
      const r = c.medianWords / own.medianWords;
      if (r >= 1.4) add('threat', 50, `${c.hostname}’in sayfaları sizinkilerden ${r.toFixed(1)} kat daha kapsamlı`, `Medyan içerik ${c.medianWords} kelime, sizde ${own.medianWords}. Önemli sayfalarınız için İçerik Brief’i oluşturup rakibin işlediği alt başlıkları görün.`, c, { you: own.medianWords, them: c.medianWords });
      else if (r <= 0.7) add('strength', 30, `İçerikleriniz ${c.hostname}’den daha kapsamlı`, `Medyan ${own.medianWords} kelime, rakipte ${c.medianWords}.`, c);
    }
    // Yapısal veri
    for (const [t, label] of Object.entries(SCHEMA_WATCH)) {
      const d = (c.schema[t] || 0) - (own.schema[t] || 0);
      if (d >= 0.3 && c.schema[t] >= 0.3) {
        const rich = ['Review', 'AggregateRating', 'Product', 'VideoObject', 'FAQPage'].includes(t);
        add('threat', rich ? 55 : 35, `${c.hostname} sayfalarının ${pctFmt(c.schema[t])}’inde ${label} işaretlemesi var, sizde ${pctFmt(own.schema[t] || 0)}`,
          rich ? 'Bu işaretleme arama sonuçlarında yıldız, fiyat veya video gibi göz alıcı gösterim sağlar ve tıklama oranını artırır.' : 'Google’ın içeriği ve yazarı daha iyi anlamasını sağlar (E-E-A-T sinyali).', c, { you: own.schema[t] || 0, them: c.schema[t], format: 'pct' });
      }
    }
    if (own.newFormat && c.authorShare - own.authorShare >= 0.25) add('threat', 40, `${c.hostname} içeriklerinde yazar (Person) bilgisi işaretliyor`, `Sayfalarının ${pctFmt(c.authorShare)}’inde yazar işaretlemesi var, sizde ${pctFmt(own.authorShare)}. Sağlık gibi YMYL konularda uzman yazar bilgisi güven sinyalidir.`, c);
    // Konu yatırımı
    const ourTopics = new Map(own.topics.map((t) => [t.topic, t.pages]));
    const heavy = c.topics.filter((t) => t.pages >= 4 && (ourTopics.get(t.topic) || 0) <= 1).slice(0, 3);
    for (const t of heavy) add('opportunity', 40 + t.pages, `${c.hostname} “${t.topic}” konusunda ${t.pages} sayfayla konu otoritesi kuruyor`, `Sizde bu konuyu başlıkta hedefleyen ${ourTopics.get(t.topic) || 0} sayfa var. İçerik Fikirleri’nden bu konu için brief oluşturabilirsiniz.`, c, { you: ourTopics.get(t.topic) || 0, them: t.pages });
    // Core Web Vitals
    if (c.cwv && own.cwv) {
      if (c.cwv.passes && own.cwv.passes === false) add('threat', 50, `${c.hostname} Core Web Vitals’ı geçiyor, siz geçemiyorsunuz`, `Mobil LCP: rakip ${fmtMs(c.cwv.lcp.p75)}, siz ${fmtMs(own.cwv.lcp.p75)} · INP: rakip ${fmtMs(c.cwv.inp.p75)}, siz ${fmtMs(own.cwv.inp.p75)}.`, c);
      else if (own.cwv.passes && c.cwv.passes === false) add('strength', 35, `Core Web Vitals’ta ${c.hostname}’den öndesiniz`, `Mobil LCP: siz ${fmtMs(own.cwv.lcp.p75)}, rakip ${fmtMs(c.cwv.lcp.p75)}.`, c);
      else if (c.cwv.lcp.p75 && own.cwv.lcp.p75 && own.cwv.lcp.p75 > c.cwv.lcp.p75 * 1.3) add('threat', 35, `${c.hostname} mobilde ${Math.round((1 - c.cwv.lcp.p75 / own.cwv.lcp.p75) * 100)}% daha hızlı açılıyor (LCP)`, `Gerçek kullanıcı verisi: rakip ${fmtMs(c.cwv.lcp.p75)}, siz ${fmtMs(own.cwv.lcp.p75)}.`, c);
    }
    // Otorite
    if (c.authority?.opr != null && own.authority?.opr != null && c.authority.opr - own.authority.opr >= 1) {
      add('threat', 45, `${c.hostname} alan adı otoritesinde önde (Open PageRank ${c.authority.opr.toFixed(1)} / siz ${own.authority.opr.toFixed(1)})`, 'Fark genelde kaliteli backlink sayısından gelir. Backlinkler sekmesinden rakibin bağlantı aldığı türde sitelere (rehber, basın, sektör siteleri) odaklanın.', c);
    }
    // Arama görünürlüğü
    if (c.sov && own.sov && c.sov.share > own.sov.share * 1.2 && c.sov.share >= 0.03) {
      add('threat', 75, `Takip edilen kelimelerde ${c.hostname} görünürlüğün ${pctFmt(c.sov.share)}’ini alıyor, siz ${pctFmt(own.sov.share)}`, `Rakip ${c.sov.keywords} kelimede ilk 10’da, ${c.sov.top3} kelimede ilk 3’te. SERP & AI Overview görünümünden kelime bazında kimin önde olduğunu görün.`, c, { you: own.sov.share, them: c.sov.share, format: 'pct' });
    } else if (c.sov && own.sov && own.sov.share > c.sov.share * 1.2 && own.sov.share >= 0.03) {
      add('strength', 40, `Takip edilen kelimelerde ${c.hostname}’den daha görünürsünüz`, `Görünürlük payınız ${pctFmt(own.sov.share)}, rakip ${pctFmt(c.sov.share)}.`, c);
    }
    if (c.aiCitations > (own.aiCitations || 0) && c.aiCitations >= 2) {
      add('threat', 65, `Google AI Overview ${c.aiCitations} kelimede ${c.hostname}’i kaynak gösteriyor${own.aiCitations ? `, sizi ${own.aiCitations} kelimede` : ', sizi hiç'}`, 'AI Overview kaynakları genelde soruyu ilk paragrafta net yanıtlayan, yapılandırılmış (liste, tablo, SSS) ve güncel sayfalardır.', c);
    }
    // Teknik sağlık
    if (c.score != null && own.score != null && own.score - c.score >= 15) add('strength', 25, `Teknik SEO sağlığınız ${c.hostname}’den iyi (${own.score} / ${c.score})`, 'Bu avantajı korumak için haftalık taramadaki yeni kritik sorunları takip edin.', c);
    if (c.score != null && own.score != null && c.score - own.score >= 15) add('threat', 40, `${c.hostname} teknik SEO sağlığında önde (${c.score} / ${own.score})`, 'Site Sağlığı sekmesindeki kritik sorunlardan başlayın.', c);
  }
  if (serp?.summary?.checked && serp.summary.aiOverview && !serp.summary.aiCited) {
    add('opportunity', 50, `Takip edilen ${serp.summary.checked} kelimenin ${serp.summary.aiOverview}’ünde AI Overview çıkıyor ama siz hiçbirinde kaynak değilsiniz`, 'İlgili sayfaların başına soruyu 2–3 cümlede net yanıtlayan bir özet, ardından liste/tablo ve SSS ekleyin.', null);
  }
  const order = { threat: 0, opportunity: 1, strength: 2 };
  return out.sort((a, b) => b.impact - a.impact || order[a.tone] - order[b.tone]).slice(0, 40);
}

const fmtMs = (v) => (v == null ? '—' : v >= 1000 ? `${(v / 1000).toFixed(1)} sn` : v < 1 ? v.toFixed(2) : `${Math.round(v)} ms`);
