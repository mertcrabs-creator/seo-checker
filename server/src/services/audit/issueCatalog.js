/**
 * Site sağlığı kural kataloğu. Her kural: önem derecesi, kategori, açıklama ve çözüm yolu.
 * severity: critical | warning | notice
 */
export const CATEGORIES = {
  technical: 'Teknik SEO',
  content: 'İçerik',
  indexing: 'Taranabilirlik & İndeksleme',
  performance: 'Performans',
  security: 'Güvenlik',
  social: 'Sosyal & Paylaşım',
  structured: 'Yapısal Veri',
  links: 'Bağlantılar',
};

export const ISSUES = {
  // ------------------------------------------------------------- Güvenlik
  no_https: {
    severity: 'critical', category: 'security', siteLevel: true,
    title: 'Site HTTPS üzerinden çalışmıyor',
    description: 'Google HTTPS’i sıralama sinyali olarak kullanır; tarayıcılar HTTP siteleri “Güvenli değil” olarak işaretler.',
    fix: 'Geçerli bir SSL/TLS sertifikası kurun (ör. Let’s Encrypt), tüm iç bağlantıları https:// olarak güncelleyin ve HTTP’den HTTPS’e 301 yönlendirmesi ekleyin.',
  },
  http_not_redirected: {
    severity: 'critical', category: 'security', siteLevel: true,
    title: 'HTTP sürümü HTTPS’e yönlendirilmiyor',
    description: 'http:// ve https:// sürümleri ayrı ayrı erişilebilir olduğunda kopya içerik oluşur ve bağlantı değeri bölünür.',
    fix: 'Sunucu yapılandırmasında (Nginx/Apache/Cloudflare) tüm http:// isteklerini aynı yolun https:// karşılığına 301 ile yönlendirin.',
  },
  hsts_missing: {
    severity: 'notice', category: 'security', siteLevel: true,
    title: 'HSTS başlığı yok',
    description: 'Strict-Transport-Security başlığı tarayıcının siteyi sadece HTTPS ile açmasını zorunlu kılar.',
    fix: 'Yanıtlara “Strict-Transport-Security: max-age=31536000; includeSubDomains” başlığını ekleyin.',
  },
  mixed_content: {
    severity: 'critical', category: 'security',
    title: 'Karışık içerik (HTTPS sayfada HTTP kaynak)',
    description: 'HTTPS sayfada HTTP üzerinden yüklenen script, stil veya görseller tarayıcı tarafından engellenebilir ve güvenlik uyarısı verir.',
    fix: 'Belirtilen kaynakların adreslerini https:// olarak güncelleyin veya göreli yol kullanın.',
  },
  // ------------------------------------------------------------- İndeksleme
  www_duplicate: {
    severity: 'warning', category: 'indexing', siteLevel: true,
    title: 'www ve www’suz sürüm ayrı ayrı erişilebilir',
    description: 'Her iki sürüm de yönlendirme olmadan 200 döndürüyor; arama motorları bunları iki ayrı site olarak görebilir.',
    fix: 'Tercih ettiğiniz sürümü belirleyin ve diğerini tek adımda 301 ile oraya yönlendirin.',
  },
  robots_missing: {
    severity: 'warning', category: 'indexing', siteLevel: true,
    title: 'robots.txt bulunamadı',
    description: 'robots.txt tarayıcılara hangi alanları tarayabileceklerini ve site haritasının yerini söyler.',
    fix: 'Kök dizine bir robots.txt ekleyin; en azından “User-agent: *”, “Allow: /” ve “Sitemap: https://alanadi/sitemap.xml” satırlarını içersin.',
  },
  robots_blocks_all: {
    severity: 'critical', category: 'indexing', siteLevel: true,
    title: 'robots.txt tüm siteyi engelliyor',
    description: '“Disallow: /” kuralı arama motorlarının siteyi taramasını tamamen engeller.',
    fix: 'robots.txt içindeki “Disallow: /” satırını kaldırın veya sadece gizlenmesi gereken dizinlerle sınırlandırın.',
  },
  sitemap_missing: {
    severity: 'warning', category: 'indexing', siteLevel: true,
    title: 'XML site haritası bulunamadı',
    description: 'Site haritası, arama motorlarının tüm önemli sayfaları hızlıca keşfetmesini sağlar.',
    fix: 'Bir sitemap.xml oluşturun (CMS eklentisi veya build adımıyla), robots.txt’ye ekleyin ve Search Console’a gönderin.',
  },
  sitemap_invalid: {
    severity: 'warning', category: 'indexing', siteLevel: true,
    title: 'Site haritası geçersiz veya boş',
    description: 'Site haritası okunamadı ya da hiç <loc> adresi içermiyor.',
    fix: 'Site haritasının sitemaps.org standardına uygun XML olduğunu ve mutlak URL’ler içerdiğini doğrulayın.',
  },
  sitemap_not_in_robots: {
    severity: 'notice', category: 'indexing', siteLevel: true,
    title: 'Site haritası robots.txt’de belirtilmemiş',
    description: 'robots.txt’deki Sitemap satırı tüm arama motorlarının site haritasını bulmasını kolaylaştırır.',
    fix: 'robots.txt dosyasının sonuna “Sitemap: https://alanadi/sitemap.xml” satırını ekleyin.',
  },
  sitemap_bad_urls: {
    severity: 'warning', category: 'indexing',
    title: 'Site haritasında indekslenemeyen URL',
    description: 'Site haritasındaki bu URL hata, yönlendirme veya noindex döndürüyor. Site haritası sadece indekslenebilir 200 sayfaları içermeli.',
    fix: 'Bu URL’leri site haritasından çıkarın veya hedef sayfayı düzeltin.',
  },
  noindex: {
    severity: 'warning', category: 'indexing',
    title: 'Sayfa noindex olarak işaretli',
    description: 'meta robots veya X-Robots-Tag “noindex” içeriyor; sayfa arama sonuçlarında görünmez.',
    fix: 'Sayfanın indekslenmesi gerekiyorsa noindex direktifini kaldırın. Bilinçli ise site haritasından da çıkarın.',
  },
  canonical_missing: {
    severity: 'warning', category: 'indexing',
    title: 'Canonical etiketi yok',
    description: 'Canonical etiketi parametreli/kopya URL’lerde hangi adresin asıl olduğunu belirtir.',
    fix: '<head> içine <link rel="canonical" href="https://alanadi/sayfa"> ekleyin (kendini gösteren canonical).',
  },
  canonical_multiple: {
    severity: 'warning', category: 'indexing',
    title: 'Birden fazla canonical etiketi',
    description: 'Çelişen canonical etiketleri olduğunda Google hepsini yok sayabilir.',
    fix: 'Sayfada tek bir canonical etiketi bırakın (tema ve SEO eklentisinin ikisi birden eklemiş olabilir).',
  },
  canonical_invalid: {
    severity: 'warning', category: 'indexing',
    title: 'Canonical adresi geçersiz veya hatalı sayfayı gösteriyor',
    description: 'Canonical URL ayrıştırılamıyor, başka alan adına ya da hata veren sayfaya işaret ediyor.',
    fix: 'Canonical değerini aynı alan adındaki, 200 döndüren mutlak bir URL olarak düzeltin.',
  },
  canonical_other: {
    severity: 'notice', category: 'indexing',
    title: 'Canonical başka bir sayfayı gösteriyor',
    description: 'Bu sayfa kendini değil başka bir URL’yi asıl olarak işaret ediyor; bu sayfa indekslenmeyecektir.',
    fix: 'Bilinçli değilse canonical’ı sayfanın kendi URL’si yapın.',
  },
  hreflang_no_return: {
    severity: 'warning', category: 'indexing',
    title: 'Hreflang geri bağlantısı yok',
    description: 'Sayfa başka bir dil sürümünü işaret ediyor ama o sürüm bu sayfaya geri işaret etmiyor. Google karşılıksız hreflang etiketlerini yok sayar; yanlış ülkede yanlış dil sıralanır.',
    fix: 'Her dil sürümü, diğer tüm sürümleri (ve kendisini) aynı hreflang setiyle listelemeli. Detaydaki hedef sayfaya bu sayfanın hreflang etiketini ekleyin.',
  },
  hreflang_no_self: {
    severity: 'notice', category: 'indexing',
    title: 'Hreflang kendine referans vermiyor',
    description: 'Hreflang seti sayfanın kendi URL’sini içermiyor.',
    fix: 'Sayfanın kendi dil kodu için kendi URL’sini gösteren bir hreflang etiketi ekleyin (ör. <link rel="alternate" hreflang="tr" href="bu-sayfa">).',
  },
  hreflang_no_xdefault: {
    severity: 'notice', category: 'indexing',
    title: 'x-default hreflang yok',
    description: 'Birden fazla dil sürümü var ama hiçbir dile uymayan kullanıcılar için varsayılan sayfa (x-default) tanımlanmamış.',
    fix: 'Dil seçimi sayfanızı veya ana sürümü hreflang="x-default" ile işaretleyin.',
  },
  hreflang_broken: {
    severity: 'warning', category: 'indexing',
    title: 'Hreflang hatalı sayfayı gösteriyor',
    description: 'Hreflang ile işaret edilen dil sürümü 200 dışında bir durum kodu (404, yönlendirme vb.) döndürüyor.',
    fix: 'Hreflang hedefini çalışan, yönlendirmesiz ve indekslenebilir URL ile değiştirin.',
  },
  hreflang_invalid: {
    severity: 'warning', category: 'indexing',
    title: 'Geçersiz hreflang değeri',
    description: 'hreflang dil/bölge kodu ISO 639-1 / ISO 3166-1 formatına uymuyor.',
    fix: 'hreflang değerlerini “tr”, “en-GB”, “x-default” gibi geçerli kodlarla değiştirin ve her sayfanın kendine de referans verdiğinden emin olun.',
  },
  deep_page: {
    severity: 'notice', category: 'indexing',
    title: 'Sayfa ana sayfadan çok uzak (4+ tık)',
    description: 'Derindeki sayfalar daha az taranır ve daha az iç bağlantı değeri alır.',
    fix: 'Önemli sayfalara menü, kategori veya ilgili içerik bloklarından bağlantı vererek tık derinliğini 3’ün altına indirin.',
  },
  // ------------------------------------------------------------- Teknik
  http_4xx: {
    severity: 'critical', category: 'technical',
    title: 'Sayfa 4xx hata döndürüyor',
    description: 'Kırık sayfalar kullanıcı deneyimini bozar ve tarama bütçesini boşa harcar.',
    fix: 'Sayfayı geri getirin ya da en alakalı sayfaya 301 yönlendirin; bu adrese verilen iç bağlantıları güncelleyin.',
  },
  http_5xx: {
    severity: 'critical', category: 'technical',
    title: 'Sayfa sunucu hatası (5xx) veriyor',
    description: 'Sürekli 5xx hataları Google’ın sayfayı indeksten düşürmesine yol açar.',
    fix: 'Sunucu/uygulama loglarını inceleyin; zaman aşımı, bellek veya veritabanı hatalarını giderin.',
  },
  fetch_failed: {
    severity: 'critical', category: 'technical',
    title: 'Sayfaya ulaşılamadı',
    description: 'Bağlantı zaman aşımına uğradı veya sunucu yanıt vermedi.',
    fix: 'Sunucunun erişilebilir olduğunu, güvenlik duvarının botları engellemediğini ve yanıt süresini kontrol edin.',
  },
  redirect_chain: {
    severity: 'warning', category: 'technical',
    title: 'Yönlendirme zinciri',
    description: 'Birden fazla ardışık yönlendirme tarama hızını düşürür ve bağlantı değerini zayıflatır.',
    fix: 'İlk URL’yi doğrudan son hedefe tek bir 301 ile yönlendirin ve iç bağlantıları son URL’ye güncelleyin.',
  },
  viewport_missing: {
    severity: 'critical', category: 'technical',
    title: 'Mobil viewport etiketi yok',
    description: 'Google mobil öncelikli indeksleme kullanır; viewport olmadan sayfa mobilde düzgün görünmez.',
    fix: '<head> içine <meta name="viewport" content="width=device-width, initial-scale=1"> ekleyin.',
  },
  lang_missing: {
    severity: 'warning', category: 'technical',
    title: 'HTML lang özniteliği yok',
    description: 'lang özniteliği arama motorlarına ve ekran okuyuculara sayfanın dilini bildirir.',
    fix: '<html lang="tr"> şeklinde sayfa diline uygun değeri ekleyin.',
  },
  charset_missing: {
    severity: 'notice', category: 'technical',
    title: 'Karakter kodlaması belirtilmemiş',
    description: 'Kodlama belirtilmezse Türkçe karakterler bozuk görünebilir.',
    fix: '<head> içinde ilk satırlara <meta charset="utf-8"> ekleyin.',
  },
  url_uppercase: {
    severity: 'notice', category: 'technical',
    title: 'URL’de büyük harf var',
    description: 'URL’ler büyük/küçük harfe duyarlıdır; büyük harf kopya URL’lere yol açabilir.',
    fix: 'URL’leri küçük harfe çevirin ve eski adresleri 301 ile yönlendirin.',
  },
  url_underscore: {
    severity: 'notice', category: 'technical',
    title: 'URL’de alt çizgi kullanılmış',
    description: 'Google kelime ayırıcı olarak tireyi (-) önerir; alt çizgi kelimeleri birleştirir.',
    fix: 'Alt çizgileri tire ile değiştirin ve eski adresleri yönlendirin.',
  },
  url_too_long: {
    severity: 'notice', category: 'technical',
    title: 'URL çok uzun (115+ karakter)',
    description: 'Kısa ve açıklayıcı URL’ler daha iyi tıklanma ve paylaşım sağlar.',
    fix: 'URL’yi anahtar kelimeyi içeren kısa bir slug ile yeniden yapılandırın.',
  },
  // ------------------------------------------------------------- Performans
  slow_response: {
    severity: 'warning', category: 'performance',
    title: 'Yavaş sunucu yanıtı (TTFB > 800 ms)',
    description: 'Yüksek ilk bayt süresi LCP’yi ve tarama hızını doğrudan kötüleştirir.',
    fix: 'Sayfa önbelleği (full-page cache), CDN, veritabanı sorgu optimizasyonu ve daha güçlü barındırma kullanın.',
  },
  page_too_large: {
    severity: 'warning', category: 'performance',
    title: 'HTML boyutu çok büyük (1 MB+)',
    description: 'Büyük HTML belgeleri yavaş indirilir ve ayrıştırılır; Googlebot sadece ilk 15 MB’ı okur.',
    fix: 'Satır içi script/stil ve gömülü verileri harici dosyalara taşıyın, gereksiz DOM öğelerini kaldırın.',
  },
  no_compression: {
    severity: 'notice', category: 'performance',
    title: 'Metin sıkıştırma kapalı',
    description: 'gzip/brotli sıkıştırması HTML boyutunu %70’e kadar küçültür.',
    fix: 'Sunucuda veya CDN’de brotli (yoksa gzip) sıkıştırmayı etkinleştirin.',
  },
  // ------------------------------------------------------------- İçerik
  title_missing: {
    severity: 'critical', category: 'content',
    title: 'Title etiketi yok',
    description: 'Title, arama sonuçlarında görünen başlıktır ve en güçlü sayfa içi sinyallerden biridir.',
    fix: 'Her sayfaya hedef anahtar kelimeyi içeren, benzersiz, 30–60 karakterlik bir <title> ekleyin.',
  },
  title_short: {
    severity: 'notice', category: 'content',
    title: 'Title çok kısa (< 30 karakter)',
    description: 'Kısa başlıklar arama sonucundaki alanı verimli kullanmaz.',
    fix: 'Başlığı anahtar kelime + fayda + marka yapısıyla 30–60 karaktere genişletin.',
  },
  title_long: {
    severity: 'warning', category: 'content',
    title: 'Title çok uzun (> 60 karakter)',
    description: 'Uzun başlıklar arama sonuçlarında kesilir.',
    fix: 'Önemli kelimeleri başa alarak başlığı 60 karakterin altına indirin.',
  },
  title_duplicate: {
    severity: 'warning', category: 'content',
    title: 'Aynı title birden fazla sayfada',
    description: 'Kopya başlıklar sayfaların birbiriyle yarışmasına (keyword cannibalization) yol açar.',
    fix: 'Her sayfaya içeriğini özetleyen benzersiz bir başlık yazın.',
  },
  meta_desc_missing: {
    severity: 'warning', category: 'content',
    title: 'Meta açıklama yok',
    description: 'Meta açıklama arama sonucundaki özet metindir ve tıklanma oranını doğrudan etkiler.',
    fix: 'Sayfanın değerini anlatan, eyleme çağıran 120–160 karakterlik benzersiz bir açıklama ekleyin.',
  },
  meta_desc_short: {
    severity: 'notice', category: 'content',
    title: 'Meta açıklama çok kısa (< 70 karakter)',
    description: 'Kısa açıklamalar Google tarafından sıklıkla rastgele metinle değiştirilir.',
    fix: 'Açıklamayı 120–160 karaktere genişletin.',
  },
  meta_desc_long: {
    severity: 'notice', category: 'content',
    title: 'Meta açıklama çok uzun (> 160 karakter)',
    description: 'Uzun açıklamalar arama sonuçlarında kesilir.',
    fix: 'Açıklamayı 160 karakterin altına indirin; en önemli bilgiyi başa yazın.',
  },
  meta_desc_duplicate: {
    severity: 'warning', category: 'content',
    title: 'Aynı meta açıklama birden fazla sayfada',
    description: 'Kopya açıklamalar sayfaların arama sonuçlarında ayırt edilmesini zorlaştırır.',
    fix: 'Her sayfa için benzersiz açıklama yazın.',
  },
  h1_missing: {
    severity: 'warning', category: 'content',
    title: 'H1 başlığı yok',
    description: 'H1, sayfanın ana konusunu hem kullanıcıya hem arama motoruna anlatır.',
    fix: 'Sayfaya hedef anahtar kelimeyi içeren tek bir <h1> ekleyin.',
  },
  h1_multiple: {
    severity: 'notice', category: 'content',
    title: 'Birden fazla H1',
    description: 'Birden fazla H1 sayfanın ana konusunu belirsizleştirebilir.',
    fix: 'Tek bir H1 bırakın; diğer başlıkları H2/H3 yapın.',
  },
  heading_skip: {
    severity: 'notice', category: 'content',
    title: 'Başlık hiyerarşisi atlanmış',
    description: 'H2’den H4’e atlamak gibi kırık hiyerarşi içerik yapısını bozar ve erişilebilirliği düşürür.',
    fix: 'Başlıkları H1 > H2 > H3 sırasıyla, seviye atlamadan kullanın.',
  },
  low_word_count: {
    severity: 'notice', category: 'content',
    title: 'Zayıf içerik (< 250 kelime)',
    description: 'Az içerikli sayfalar arama niyetini karşılamakta zorlanır ve “thin content” olarak değerlendirilebilir.',
    fix: 'Kullanıcının sorularını yanıtlayan, alt başlıklarla bölünmüş özgün içerik ekleyin veya benzer sayfalarla birleştirin.',
  },
  img_alt_missing: {
    severity: 'warning', category: 'content',
    title: 'Alt metni olmayan görseller',
    description: 'Alt metin görsel aramada sıralama ve erişilebilirlik için gereklidir.',
    fix: 'Her anlamlı görsele içeriğini anlatan kısa bir alt="" metni ekleyin; dekoratif görsellerde alt="" boş bırakın.',
  },
  // ------------------------------------------------------------- Bağlantılar
  broken_internal_link: {
    severity: 'critical', category: 'links',
    title: 'Kırık iç bağlantı',
    description: 'Sayfa, hata döndüren bir iç sayfaya bağlantı veriyor.',
    fix: 'Bağlantıyı çalışan doğru adresle güncelleyin veya kaldırın.',
  },
  nofollow_internal: {
    severity: 'notice', category: 'links',
    title: 'İç bağlantılarda nofollow',
    description: 'İç bağlantılardaki nofollow, sayfalar arası değer akışını keser.',
    fix: 'İç bağlantılardan rel="nofollow" değerini kaldırın.',
  },
  link_no_text: {
    severity: 'notice', category: 'links',
    title: 'Metni olmayan bağlantılar',
    description: 'Anchor text içermeyen bağlantılar hedef sayfa hakkında bağlam sağlamaz.',
    fix: 'Bağlantılara açıklayıcı metin ya da görsel bağlantılarda alt metni / aria-label ekleyin.',
  },
  orphan_page: {
    severity: 'warning', category: 'links',
    title: 'Yetim sayfa (hiç iç bağlantı almıyor)',
    description: 'Site haritasında yer alan ama sitedeki hiçbir sayfadan bağlantı almayan sayfalar zor keşfedilir ve otorite kazanamaz.',
    fix: 'Bu sayfaya ilgili kategori, menü veya içerik sayfalarından açıklayıcı anchor text ile iç bağlantı verin; gereksizse site haritasından çıkarın.',
  },
  // ------------------------------------------------------------- Anahtar kelime
  keyword_cannibalization: {
    severity: 'warning', category: 'content',
    title: 'Anahtar kelime yamyamlığı',
    description: 'Birden fazla sayfa title ve H1’de aynı anahtar kelimeyi hedefliyor; arama motoru hangisini sıralayacağını seçemez ve sayfalar birbirinin trafiğini böler.',
    fix: 'Her anahtar kelime için tek bir ana sayfa belirleyin. Diğer sayfaları farklı (uzun kuyruk) kelimelere yönlendirin, birleştirin veya ana sayfaya canonical / 301 verin.',
  },
  // ------------------------------------------------------------- Sosyal
  og_missing: {
    severity: 'notice', category: 'social',
    title: 'Open Graph etiketleri eksik',
    description: 'og:title, og:description ve og:image olmadan sosyal medya paylaşımları özensiz görünür.',
    fix: 'Her sayfaya og:title, og:description, og:image ve og:url etiketlerini ekleyin.',
  },
  twitter_missing: {
    severity: 'notice', category: 'social',
    title: 'Twitter Card etiketi yok',
    description: 'twitter:card etiketi X/Twitter paylaşımlarında zengin önizleme sağlar.',
    fix: '<meta name="twitter:card" content="summary_large_image"> ekleyin.',
  },
  favicon_missing: {
    severity: 'notice', category: 'social', siteLevel: true,
    title: 'Favicon bulunamadı',
    description: 'Google mobil arama sonuçlarında favicon gösterir; olmaması güven algısını düşürür.',
    fix: '48×48 katlarında bir favicon oluşturup <link rel="icon" href="/favicon.png"> ile tanımlayın.',
  },
  // ------------------------------------------------------------- Yapısal veri
  schema_missing: {
    severity: 'notice', category: 'structured',
    title: 'Yapısal veri (Schema.org) yok',
    description: 'Yapısal veri zengin sonuçlar (yıldız, SSS, breadcrumb, ürün) için gereklidir.',
    fix: 'Sayfa türüne uygun JSON-LD ekleyin: Organization, WebSite, BreadcrumbList, Article, Product, FAQPage vb.',
  },
  schema_invalid: {
    severity: 'warning', category: 'structured',
    title: 'Geçersiz JSON-LD',
    description: 'JSON-LD bloğu ayrıştırılamıyor; Google bu yapısal veriyi yok sayar.',
    fix: 'JSON sözdizimini düzeltin ve Google Zengin Sonuçlar Testi ile doğrulayın.',
  },
};

const WEIGHTS = { critical: 10, warning: 4, notice: 1 };

/**
 * 0-100 sağlık puanı: her kural için ağırlık × (taban + etkilenen sayfa oranı).
 * Böylece tek sayfadaki hata da puanı düşürür, yaygın hata çok daha fazla düşürür.
 */
export function computeScore(issueCounts, totalPages) {
  let penalty = 0;
  for (const [code, count] of Object.entries(issueCounts)) {
    const def = ISSUES[code];
    if (!def) continue;
    const ratio = def.siteLevel ? 1 : Math.min(1, count / Math.max(1, totalPages));
    penalty += WEIGHTS[def.severity] * (0.35 + 0.65 * Math.sqrt(ratio));
  }
  return Math.max(0, Math.min(100, Math.round(100 - penalty)));
}

const PAGE_WEIGHTS = { critical: 18, warning: 7, notice: 2 };

/** Tek sayfanın sayfa içi SEO puanı (0-100); site geneli kurallar dahil edilmez. */
export function pageScore(codes) {
  let penalty = 0;
  for (const code of new Set(codes)) {
    const def = ISSUES[code];
    if (def && !def.siteLevel) penalty += PAGE_WEIGHTS[def.severity];
  }
  return Math.max(0, 100 - penalty);
}
