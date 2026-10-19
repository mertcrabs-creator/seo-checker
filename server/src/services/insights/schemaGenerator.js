import * as cheerio from 'cheerio';
import { query } from '../../db/pool.js';
import { badRequest } from '../../utils/httpError.js';
import { safeFetch } from '../../utils/safeFetch.js';
import { normalizeUrl } from '../audit/pageAnalyzer.js';
import { validateJsonLd } from '../audit/schemaValidator.js';

/**
 * Sektöre ve sayfa türüne göre JSON-LD üretici. Sektör; tarama verisi (başlık, URL, mevcut şema),
 * Search Console sorguları ve ana sayfa metninden tespit edilir, kullanıcı değiştirebilir.
 * Değerler canlı sayfadan çıkarılır (telefon, adres, harita koordinatı, çalışma saatleri, sosyal profiller,
 * fiyat, stok, yazar, tarih, SSS…). Bulunamayan bilgi UYDURULMAZ: çıktıya eklenmez, "eksik" olarak raporlanır.
 * Sonuç, mevcut doğrulayıcıdan (schemaValidator) geçirilir.
 */

// ------------------------------------------------------------------ Sektörler
// Kelime başı sınırı: "app" → "happy", "diş" → "kadiş" eşleşmesin (Türkçe ekler için sonda sınır yok)
const R = (s) => new RegExp(`(?<!\\p{L})(?:${s})`, 'iu');
export const SECTORS = {
  ecommerce: { label: 'E-ticaret / Online mağaza', type: 'OnlineStore', local: false, re: R('sepete ekle|sepet|ürünler|kargo|indirim|kampanya|add to cart|shop|mağaza|alışveriş|checkout|ücretsiz kargo|taksit') },
  restaurant: { label: 'Restoran / Kafe', type: 'Restaurant', local: true, re: R('restoran|restaurant|kafe|cafe|café|menü|menu|yemek|kahvaltı|pizza|burger|meyhane|bistro|lokanta|paket servis|steakhouse') },
  hotel: { label: 'Otel / Konaklama', type: 'Hotel', local: true, re: R('otel|hotel|konaklama|pansiyon|resort|butik otel|apart|oda tipleri|rooms|accommodation|bungalov') },
  dentist: { label: 'Diş kliniği', type: 'Dentist', local: true, re: R('diş(?!\\p{L})|dişler|ortodonti|dental|zirkonyum|kanal tedavisi|gülüş tasarımı|dentist|teeth|lamina|veneer|diş hekimi|diş kliniği') },
  medical: { label: 'Klinik / Sağlık', type: 'MedicalClinic', local: true, re: R('klinik|clinic|estetik|ameliyat|tedavi|hastane|hospital|doktor|doctor|op\\.? ?dr|uzm\\.? ?dr|prof\\.? ?dr|cerrah|surgery|saç ekimi|rinoplasti|burun estetiği|hair transplant|muayene|tüp bebek|fizik tedavi|psikolog|diyetisyen|dermatoloji|göz') },
  legal: { label: 'Hukuk / Avukat', type: 'LegalService', local: true, re: R('avukat|hukuk|lawyer|attorney|law firm|dava|boşanma|arabulucu|icra|ceza|tazminat|legal') },
  realestate: { label: 'Emlak / Gayrimenkul', type: 'RealEstateAgent', local: true, re: R('emlak|gayrimenkul|satılık|kiralık|real estate|konut|daire|villa|arsa|residence|property|for sale|m²|metrekare') },
  automotive: { label: 'Otomotiv / Servis', type: 'AutoRepair', local: true, re: R('oto |otomotiv|araç|otomobil|oto servis|tamir|lastik|kaporta|boya|galeri|auto repair|car service|yedek parça|ekspertiz') },
  carrental: { label: 'Araç kiralama', type: 'AutoRental', local: true, re: R('araç kiralama|rent a car|car rental|kiralık araç|günlük kiralama') },
  beauty: { label: 'Güzellik / Kuaför', type: 'BeautySalon', local: true, re: R('kuaför|güzellik|beauty|salon|epilasyon|cilt bakımı|manikür|nail|berber|barber|makyaj|kirpik|kaş|spa|masaj') },
  fitness: { label: 'Spor / Fitness', type: 'ExerciseGym', local: true, re: R('spor salonu|fitness|gym|pilates|yoga|crossfit|personal trainer|antrenman|reformer') },
  education: { label: 'Eğitim / Kurs', type: 'EducationalOrganization', local: false, re: R('kurs|eğitim|okul|akademi|ders|sertifika|course|school|academy|training|üniversite|kolej|dil okulu|özel ders|öğrenci|online eğitim') },
  travel: { label: 'Turizm / Seyahat', type: 'TravelAgency', local: true, re: R('tur |turlar|tatil|seyahat|travel|tour|vize|transfer|gezi|uçak bileti|cruise|kapadokya|balon') },
  software: { label: 'Yazılım / SaaS', type: 'Organization', local: false, re: R('yazılım|software|saas(?!\\p{L})|mobil uygulama|app(?!\\p{L})|apps(?!\\p{L})|platform|api(?!\\p{L})|entegrasyon|demo(?!\\p{L})|free trial|ücretsiz dene|pricing|fiyatlandırma|dashboard|cloud|crm(?!\\p{L})|erp(?!\\p{L})') },
  agency: { label: 'Ajans / Danışmanlık', type: 'ProfessionalService', local: true, re: R('ajans|agency|dijital pazarlama|seo|web tasarım|sosyal medya|reklam|danışmanlık|consulting|branding|kurumsal kimlik|google ads|marketing') },
  construction: { label: 'İnşaat / Ev hizmetleri', type: 'HomeAndConstructionBusiness', local: true, re: R('inşaat|tadilat|dekorasyon|tesisat|elektrikçi|boya badana|mimarlık|mimar|construction|renovation|plumber|çatı|izolasyon|mutfak dolabı|nakliyat|evden eve|temizlik|klima|kombi') },
  finance: { label: 'Finans / Sigorta / Muhasebe', type: 'FinancialService', local: true, re: R('sigorta|insurance|muhasebe|mali müşavir|accounting|kredi|finans|yatırım|vergi|leasing|bordro|şirket kuruluşu') },
  veterinary: { label: 'Veteriner / Pet', type: 'VeterinaryCare', local: true, re: R('veteriner|veterinary|pet shop|kedi|köpek|evcil hayvan|aşı takvimi') },
  manufacturing: { label: 'Üretim / Sanayi / B2B', type: 'Organization', local: false, re: R('üretim|fabrika|imalat|sanayi|manufacturer|endüstriyel|makine|ihracat|toptan|wholesale|tedarik|b2b') },
  news: { label: 'Haber / Medya', type: 'NewsMediaOrganization', local: false, re: R('haber|news|gündem|son dakika|köşe yazısı|magazin|manşet|editör|muhabir') },
  events: { label: 'Etkinlik / Organizasyon', type: 'Organization', local: false, re: R('etkinlik|konser|festival|bilet|event|organizasyon|düğün|kongre|fuar|davet') },
  recipes: { label: 'Yemek tarifi / Yemek blogu', type: 'Organization', local: false, re: R('tarif|malzemeler|yapılışı|recipe|ingredients|nasıl yapılır|kek|börek|çorba') },
  nonprofit: { label: 'Dernek / Vakıf', type: 'NGO', local: false, re: R('dernek|vakıf|bağış|gönüllü|donate|charity|foundation|stk|yardım') },
  generic: { label: 'Genel kuruluş', type: 'Organization', local: false, re: null },
};
const LOCAL_TYPES = new Set(Object.values(SECTORS).filter((s) => s.local).map((s) => s.type));
const SCHEMA_TO_SECTOR = { Dentist: 'dentist', MedicalClinic: 'medical', Physician: 'medical', Hospital: 'medical', Restaurant: 'restaurant', CafeOrCoffeeShop: 'restaurant', Hotel: 'hotel', LodgingBusiness: 'hotel', LegalService: 'legal', Attorney: 'legal', RealEstateAgent: 'realestate', AutoRepair: 'automotive', AutoDealer: 'automotive', AutoRental: 'carrental', BeautySalon: 'beauty', HairSalon: 'beauty', DaySpa: 'beauty', ExerciseGym: 'fitness', EducationalOrganization: 'education', TravelAgency: 'travel', SoftwareApplication: 'software', ProfessionalService: 'agency', HomeAndConstructionBusiness: 'construction', FinancialService: 'finance', InsuranceAgency: 'finance', AccountingService: 'finance', NewsMediaOrganization: 'news', NGO: 'nonprofit', OnlineStore: 'ecommerce', Store: 'ecommerce', VeterinaryCare: 'veterinary', Recipe: 'recipes' };

// ------------------------------------------------------------------ Sayfa türleri
export const PAGE_TYPES = {
  home: { label: 'Ana sayfa', recommend: ['Organization', 'WebSite'] },
  product: { label: 'Ürün', recommend: ['Product', 'BreadcrumbList'] },
  category: { label: 'Kategori / Liste', recommend: ['CollectionPage', 'ItemList', 'BreadcrumbList'] },
  article: { label: 'Blog / Makale', recommend: ['BlogPosting', 'BreadcrumbList'] },
  service: { label: 'Hizmet / Tedavi', recommend: ['Service', 'BreadcrumbList'] },
  faq: { label: 'SSS', recommend: ['FAQPage'] },
  contact: { label: 'İletişim', recommend: ['ContactPage', 'Organization'] },
  about: { label: 'Hakkımızda', recommend: ['AboutPage', 'Organization'] },
  person: { label: 'Kişi / Doktor / Ekip profili', recommend: ['ProfilePage', 'Person'] },
  location: { label: 'Şube / Lokasyon', recommend: ['Organization'] },
  event: { label: 'Etkinlik', recommend: ['Event'] },
  job: { label: 'İş ilanı', recommend: ['JobPosting'] },
  recipe: { label: 'Tarif', recommend: ['Recipe'] },
  course: { label: 'Kurs / Eğitim', recommend: ['Course'] },
  pricing: { label: 'Fiyatlar', recommend: ['Service', 'BreadcrumbList'] },
  other: { label: 'Diğer sayfa', recommend: ['WebPage', 'BreadcrumbList'] },
};
// Kapsama kontrolünde eşdeğer kabul edilen türler
const EQUIV = {
  Organization: /^(Organization|Corporation|LocalBusiness|OnlineStore|OnlineBusiness|NGO|.*Store|.*Business|.*Service|Restaurant|Hotel|Dentist|MedicalClinic|Physician|Hospital|Attorney|RealEstateAgent|HairSalon|BeautySalon|ExerciseGym|TravelAgency|AutoRepair|AutoRental|VeterinaryCare|EducationalOrganization|NewsMediaOrganization)$/,
  BlogPosting: /^(Article|NewsArticle|BlogPosting|TechArticle|Report)$/,
  Service: /^(Service|MedicalProcedure|Product|Offer|OfferCatalog)$/,
  Person: /^(Person|Physician)$/,
  ItemList: /^(ItemList|OfferCatalog)$/,
};
const covers = (types, want) => types.some((t) => (EQUIV[want] ? EQUIV[want].test(t) : t === want));

const URL_RULES = [
  ['product', /\/(urun|urunler\/[^/]+\/[^/]+|product|products\/[^/]+|p\/|item)\b|-p-\d+|\/dp\//i],
  ['category', /\/(kategori|category|categories|collections?|shop|magaza|urunler\/?$|products\/?$|c\/)/i],
  ['article', /\/(blog|haber|haberler|news|makale|yazi|yazilar|article|rehber|guide|post)s?\//i],
  ['faq', /\/(sss|faq|sikca-sorulan|sik-sorulan)/i],
  ['contact', /\/(iletisim|contact|bize-ulasin|ulasim)/i],
  ['about', /\/(hakkimizda|hakkinda|about|kurumsal|biz-kimiz|who-we-are)/i],
  ['person', /\/(doktor|doktorlar|doctor|doctors|hekim|dr-|op-dr|prof-dr|uzm-dr|ekip\/|ekibimiz\/|team\/|kadro|avukat\/|uzman\/)/i],
  ['location', /\/(subeler|sube|branches?|locations?|lokasyon)/i],
  ['event', /\/(etkinlik|etkinlikler|event|events)\//i],
  ['job', /\/(kariyer|career|careers|is-ilani|jobs?)\//i],
  ['recipe', /\/(tarif|tarifler|recipe|recipes)\//i],
  ['course', /\/(kurs|kurslar|course|courses|egitimler?)\//i],
  ['pricing', /\/(fiyat|fiyatlar|fiyatlari|pricing|ucret|ucretler|price)/i],
  ['service', /\/(hizmet|hizmetler|hizmetlerimiz|service|services|tedavi|tedaviler|treatment|treatments|uygulamalar|islemler|cozumler|solutions|operasyon|ameliyat)/i],
];
const PERSON_TITLE = /^(op\.?\s*dr|prof\.?\s*dr|doç\.?\s*dr|uzm\.?\s*dr|dr\.?|dt\.?|av\.?|psk\.?|dyt\.?)\s/iu;

/** Tarama kaydından (veya canlı analizden) sayfa türü. */
export function classifyPage(p, { ignore } = {}) {
  const types = (p.schema_types || p.schemaTypes || []).filter((t) => !ignore?.has(t));
  const hints = (p.schema_report?.hints || p.hints || []).filter((t) => !ignore?.has(t));
  let path = '/';
  try {
    path = decodeURIComponent(new URL(p.url).pathname).toLowerCase();
  } catch {
    /* bozuk URL */
  }
  if (p.depth === 0 || path === '/' || /^\/(tr|en|de|ar|ru|fr)\/?$/.test(path)) return 'home';
  if (types.includes('Product') || hints.includes('Product')) return 'product';
  if (types.includes('Recipe')) return 'recipe';
  if (types.includes('JobPosting')) return 'job';
  if (types.includes('Event')) return 'event';
  if (types.includes('Course')) return 'course';
  if (PERSON_TITLE.test(p.h1 || '') || types.includes('Physician') || (types.includes('Person') && !types.some((t) => EQUIV.BlogPosting.test(t)))) return 'person';
  for (const [type, re] of URL_RULES) if (re.test(`${path}/`)) return type;
  if (types.some((t) => EQUIV.BlogPosting.test(t)) || hints.includes('Article') || p.published_at || p.publishedAt) return 'article';
  if (types.includes('FAQPage')) return 'faq';
  if (types.includes('Service')) return 'service';
  return 'other';
}

/** Sayfaların çoğunda bulunan türler şablondan gelir (ör. her sayfada Product); sayfa türü için sinyal değildir. */
export function templateTypes(pages) {
  if (pages.length < 5) return new Set();
  const n = new Map();
  for (const p of pages) for (const t of new Set([...(p.schema_types || []), ...(p.schema_report?.hints || [])])) n.set(t, (n.get(t) || 0) + 1);
  return new Set([...n].filter(([, c]) => c / pages.length > 0.6).map(([t]) => t));
}

const PRODUCT_SECTORS = new Set(['ecommerce', 'manufacturing', 'generic']);
const CONTENT_SECTORS = new Set(['news', 'recipes', 'generic', 'ecommerce', 'manufacturing']);
/** Sektöre göre düzeltilmiş sayfa türü: hizmet işletmelerinde Product işaretli sayfa ve sınıflandırılamayan içerik sayfaları "hizmet"tir. */
export function pageTypeFor(p, { ignore, sector } = {}) {
  const t = classifyPage(p, { ignore });
  if (!sector) return t;
  let path = '';
  try {
    path = new URL(p.url).pathname;
  } catch {
    /* bozuk URL */
  }
  if (t === 'product' && !PRODUCT_SECTORS.has(sector) && !URL_RULES[0][1].test(path)) return 'service';
  if (t === 'other' && !CONTENT_SECTORS.has(sector) && (p.word_count ?? 300) >= 300) return 'service';
  return t;
}

// ------------------------------------------------------------------ Sektör tespiti
async function latestAudit(domainId) {
  const { rows: [a] } = await query(`SELECT id, site_info FROM audits WHERE domain_id = $1 AND status = 'completed' ORDER BY created_at DESC LIMIT 1`, [domainId]);
  return a || null;
}

async function auditPages(auditId) {
  const { rows } = await query(
    `SELECT url, title, h1, meta_description, depth, inlinks, schema_types, schema_report, published_at::text, word_count
       FROM audit_pages WHERE audit_id = $1 AND status_code = 200 AND NOT noindex`,
    [auditId],
  );
  return rows;
}

export async function detectSector(domain, pages) {
  const docs = [];
  const home = pages.find((p) => p.depth === 0);
  if (home) docs.push({ text: `${home.title || ''} ${home.h1 || ''} ${home.meta_description || ''}`, w: 6 });
  for (const p of pages) docs.push({ text: `${p.title || ''} ${p.h1 || ''} ${decodeURIComponent(p.url).replace(/[-_/]/g, ' ')}`, w: 1 });
  if (domain.gsc_property) {
    const { rows } = await query('SELECT query FROM gsc_query_page WHERE domain_id = $1 GROUP BY query ORDER BY SUM(impressions) DESC LIMIT 300', [domain.id]);
    for (const r of rows) docs.push({ text: r.query, w: 1 });
  }
  const scores = {};
  for (const [key, s] of Object.entries(SECTORS)) {
    if (!s.re) continue;
    scores[key] = docs.reduce((sum, d) => sum + (s.re.test(d.text) ? d.w : 0), 0);
  }
  // Mevcut şema türleri güçlü sinyaldir
  for (const p of pages) {
    for (const t of p.schema_types || []) {
      const k = SCHEMA_TO_SECTOR[t];
      if (k) scores[k] = (scores[k] || 0) + (p.depth === 0 ? 25 : 2);
    }
  }
  const ignore = templateTypes(pages);
  const productShare = pages.length ? pages.filter((p) => classifyPage(p, { ignore }) === 'product').length / pages.length : 0;
  if (productShare > 0.1) scores.ecommerce = (scores.ecommerce || 0) + Math.round(productShare * 100);
  // Diş kliniği aynı zamanda "klinik"tir: daha özel olan öne geçsin
  if (scores.dentist >= 5 && scores.dentist >= (scores.medical || 0) * 0.4) scores.dentist += Math.round((scores.medical || 0) * 0.5);
  if (scores.carrental >= 3 && scores.carrental >= (scores.automotive || 0) * 0.4) scores.carrental += Math.round((scores.automotive || 0) * 0.5);

  const ranked = Object.entries(scores).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const [top, second] = ranked;
  const minScore = Math.max(4, docs.length * 0.04);
  const detected = top && top[1] >= minScore ? top[0] : 'generic';
  const confidence = detected === 'generic' ? null : Math.min(0.99, top[1] / (top[1] + (second?.[1] || 0) + minScore / 2));
  return {
    detected,
    confidence: confidence === null ? null : Math.round(confidence * 100) / 100,
    alternatives: ranked.slice(0, 4).filter(([k]) => k !== detected).map(([key, score]) => ({ key, label: SECTORS[key].label, score })),
  };
}

// ------------------------------------------------------------------ Plan (site geneli)
export async function schemaPlan(domain) {
  const audit = await latestAudit(domain.id);
  if (!audit) return { needsAudit: true };
  const pages = await auditPages(audit.id);
  const sector = await detectSector(domain, pages);
  const override = domain.business_type && SECTORS[domain.business_type] ? domain.business_type : null;
  const ignore = templateTypes(pages);
  const groups = new Map();
  for (const p of pages) {
    const type = pageTypeFor(p, { ignore, sector: override || sector.detected });
    const g = groups.get(type) || { type, label: PAGE_TYPES[type].label, recommend: PAGE_TYPES[type].recommend, pages: [] };
    const have = p.schema_types || [];
    g.pages.push({ url: p.url, title: p.title, inlinks: p.inlinks, has: have, missing: PAGE_TYPES[type].recommend.filter((t) => !covers(have, t)) });
    groups.set(type, g);
  }
  const order = Object.keys(PAGE_TYPES);
  return {
    sector: { ...sector, override, effective: override || sector.detected },
    sectors: Object.entries(SECTORS).map(([key, s]) => ({ key, label: s.label, type: s.type })),
    pageTypes: Object.entries(PAGE_TYPES).map(([key, t]) => ({ key, label: t.label })),
    groups: [...groups.values()]
      .map((g) => ({
        ...g,
        count: g.pages.length,
        complete: g.pages.filter((p) => !p.missing.length).length,
        pages: g.pages.sort((a, b) => b.missing.length - a.missing.length || b.inlinks - a.inlinks).slice(0, 50),
      }))
      .sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type)),
  };
}

export async function setSector(domain, businessType) {
  if (businessType && !SECTORS[businessType]) throw badRequest('Geçersiz sektör');
  await query('UPDATE domains SET business_type = $2 WHERE id = $1', [domain.id, businessType || null]);
  return { businessType: businessType || null };
}

// ------------------------------------------------------------------ Sayfadan bilgi çıkarma
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const abs = (u, base) => {
  try {
    return u ? new URL(u, base).href : null;
  } catch {
    return null;
  }
};
const SOCIAL = /^https?:\/\/(www\.)?(facebook\.com|instagram\.com|x\.com|twitter\.com|linkedin\.com|youtube\.com|tiktok\.com|pinterest\.[a-z.]+|threads\.net|wikipedia\.org|[a-z]{2}\.wikipedia\.org|wikidata\.org|github\.com|medium\.com|behance\.net|dribbble\.com|g\.page|maps\.app\.goo\.gl|tripadvisor\.[a-z.]+|yelp\.com|foursquare\.com|crunchbase\.com|doktortakvimi\.com|doctoralia\.[a-z.]+)\//i;
const PROVINCES = 'Adana Adıyaman Afyonkarahisar Ağrı Aksaray Amasya Ankara Antalya Ardahan Artvin Aydın Balıkesir Bartın Batman Bayburt Bilecik Bingöl Bitlis Bolu Burdur Bursa Çanakkale Çankırı Çorum Denizli Diyarbakır Düzce Edirne Elazığ Erzincan Erzurum Eskişehir Gaziantep Giresun Gümüşhane Hakkari Hatay Iğdır Isparta İstanbul İzmir Kahramanmaraş Karabük Karaman Kars Kastamonu Kayseri Kilis Kırıkkale Kırklareli Kırşehir Kocaeli Konya Kütahya Malatya Manisa Mardin Mersin Muğla Muş Nevşehir Niğde Ordu Osmaniye Rize Sakarya Samsun Şanlıurfa Siirt Sinop Sivas Şırnak Tekirdağ Tokat Trabzon Tunceli Uşak Van Yalova Yozgat Zonguldak'.split(' ');
const trLower = (s) => s.toLocaleLowerCase('tr');
const DAY_MAP = [
  [/^(pazartesi|pzt|monday|mon)/i, 'Monday'], [/^(salı|sali|sal|tuesday|tue)/i, 'Tuesday'], [/^(çarşamba|carsamba|çar|car|wednesday|wed)/i, 'Wednesday'],
  [/^(perşembe|persembe|per|thursday|thu)/i, 'Thursday'], [/^(cumartesi|cmt|cts|saturday|sat)/i, 'Saturday'], [/^(cuma|cum|friday|fri)/i, 'Friday'], [/^(pazar|paz|sunday|sun)/i, 'Sunday'],
];
const WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const dayOf = (s) => DAY_MAP.find(([re]) => re.test(s.trim()))?.[1] || null;
const DAY_WORD = '(pazartesi|salı|sali|çarşamba|carsamba|perşembe|persembe|cumartesi|cuma|pazar|pzt|sal|çar|per|cum|cmt|cts|paz|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)';
const HOURS_RE = new RegExp(`${DAY_WORD}\\.?\\s*(?:[-–—]|ile|to)?\\s*${DAY_WORD}?\\.?\\s*[:\\s]\\s*(\\d{1,2}[:.]\\d{2})\\s*[-–—]\\s*(\\d{1,2}[:.]\\d{2})`, 'giu');
const CURRENCY = { '₺': 'TRY', TL: 'TRY', TRY: 'TRY', '€': 'EUR', EUR: 'EUR', $: 'USD', USD: 'USD', '£': 'GBP', GBP: 'GBP' };

function parseNumber(s) {
  let v = String(s).replace(/\s/g, '');
  if (/,\d{1,2}$/.test(v)) v = v.replace(/\./g, '').replace(',', '.');
  else v = v.replace(/,/g, '');
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizePhone(raw, country) {
  let d = String(raw).replace(/[^\d+]/g, '');
  if (!d || d.replace(/\D/g, '').length < 7) return null;
  if (country === 'TR' && /^0\d{10}$/.test(d)) d = `+9${d}`;
  if (country === 'TR' && /^[2-5]\d{9}$/.test(d)) d = `+90${d}`;
  if (/^00/.test(d)) d = `+${d.slice(2)}`;
  return d;
}

function jsonLdNodes($) {
  const nodes = [];
  $('script').filter((_, el) => String($(el).attr('type') || '').toLowerCase() === 'application/ld+json').each((_, el) => {
    try {
      const visit = (n) => {
        if (Array.isArray(n)) return n.forEach(visit);
        if (!n || typeof n !== 'object') return;
        if (n['@type']) nodes.push(n);
        if (n['@graph']) visit(n['@graph']);
      };
      visit(JSON.parse($(el).text()));
    } catch {
      /* geçersiz JSON-LD */
    }
  });
  return nodes;
}
const typesOf = (n) => [].concat(n?.['@type'] || []).map(String);
const firstStr = (v) => (typeof v === 'string' ? v : Array.isArray(v) ? v.find((x) => typeof x === 'string') : v?.url || v?.['@id'] || null);

/** Sayfadan işletme ve içerik bilgilerini çıkarır. Her değer kaynağıyla birlikte döner. */
export function extractFacts(html, pageUrl) {
  const $ = cheerio.load(html);
  const meta = (n) => clean($('meta').filter((_, el) => [$(el).attr('name'), $(el).attr('property'), $(el).attr('itemprop')].some((a) => String(a || '').toLowerCase() === n)).first().attr('content'));
  const nodes = jsonLdNodes($);
  const org = nodes.find((n) => typesOf(n).some((t) => EQUIV.Organization.test(t)));
  const lang = clean($('html').attr('lang')).slice(0, 10) || null;
  const f = { lang, existing: nodes.map((n) => typesOf(n)[0]).filter(Boolean) };
  const set = (k, value, source, status = 'found') => {
    if (value !== null && value !== undefined && value !== '' && !(Array.isArray(value) && !value.length) && !f[k]) f[k] = { value, source, status };
  };

  // ---- Genel
  set('title', clean($('title').first().text()), 'title');
  set('h1', clean($('h1').first().text()), 'H1');
  set('description', meta('description') || meta('og:description'), 'meta description');
  set('image', abs(meta('og:image'), pageUrl), 'og:image');
  set('siteName', meta('og:site_name'), 'og:site_name');
  if (org?.name) set('siteName', clean(org.name), 'mevcut şema');

  // ---- Logo
  if (org?.logo) set('logo', abs(firstStr(org.logo), pageUrl), 'mevcut şema');
  const logoImg = $('header img, [class*="logo" i] img, img[class*="logo" i], img[id*="logo" i], img[alt*="logo" i], img[src*="logo" i]').first();
  if (logoImg.length) set('logo', abs(logoImg.attr('src') || logoImg.attr('data-src'), pageUrl), 'sayfa başlığındaki logo görseli');
  const svgLogo = $('link[rel="apple-touch-icon"], link[rel="icon"][sizes="192x192"], link[rel="icon"][sizes="512x512"]').first().attr('href');
  if (svgLogo) set('logo', abs(svgLogo, pageUrl), 'site simgesi (apple-touch-icon)', 'verify');

  // ---- İletişim
  const country = lang?.toLowerCase().startsWith('tr') || /\.tr$/.test(new URL(pageUrl).hostname) ? 'TR' : null;
  const phones = new Set();
  if (org?.telephone) phones.add(normalizePhone(firstStr(org.telephone), country));
  $('a[href^="tel:"]').each((_, el) => phones.add(normalizePhone(decodeURIComponent($(el).attr('href').slice(4)), country)));
  phones.delete(null);
  set('telephone', [...phones].slice(0, 3), org?.telephone ? 'mevcut şema' : 'tel: bağlantısı');
  const emails = new Set();
  if (org?.email) emails.add(firstStr(org.email).replace(/^mailto:/, ''));
  $('a[href^="mailto:"]').each((_, el) => emails.add(decodeURIComponent($(el).attr('href').slice(7).split('?')[0]).trim()));
  set('email', [...emails].filter((e) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e)).slice(0, 2), 'mailto: bağlantısı');

  // ---- Adres
  const addrNode = org?.address && typeof org.address === 'object' ? [].concat(org.address)[0] : null;
  if (addrNode?.streetAddress || addrNode?.addressLocality) {
    set('address', { streetAddress: addrNode.streetAddress, addressLocality: addrNode.addressLocality, addressRegion: addrNode.addressRegion, postalCode: addrNode.postalCode, addressCountry: firstStr(addrNode.addressCountry) || country }, 'mevcut şema');
  } else {
    const candidates = [];
    $('address, [itemprop="address"], [class*="address" i], [class*="adres" i], [id*="address" i], [id*="adres" i], footer, [class*="footer" i], [class*="contact" i], [class*="iletisim" i]').each((_, el) => {
      $(el).find('br').replaceWith('\n');
      candidates.push(...$(el).text().split(/\n|\s{3,}|\|/).map(clean).filter((s) => s.length >= 12 && s.length <= 220));
    });
    const ADDR = /\b(mah(alle(si)?)?\.?|mh\.|cad(de(si)?)?\.?|cd\.|sok(ak|ağı|\.)?|sk\.|bulvar(ı)?|blv\.?|no\s*[:.]?\s*\d+|kat\s*[:.]?\s*\d+|street|st\.|avenue|ave\.|road|rd\.|straße|strasse|suite)\b/iu;
    const line = candidates.find((s) => ADDR.test(s) && /\d/.test(s));
    if (line) {
      const postal = /\b(\d{5})\b/.exec(line)?.[1];
      const pair = /([\p{Lu}][\p{L}]+)\s*\/\s*([\p{Lu}][\p{L}]+)/u.exec(line);
      const province = PROVINCES.find((p) => trLower(line).includes(trLower(p)));
      let locality = pair ? pair[1] : null;
      let region = pair ? pair[2] : province || null;
      if (locality && region && trLower(locality) === trLower(region)) locality = null;
      if (!locality && province) locality = province;
      const street = clean(line.replace(/^(adres|address)\s*[:：]\s*/i, ''));
      set('address', { streetAddress: street, addressLocality: locality, addressRegion: region !== locality ? region : null, postalCode: postal || null, addressCountry: country }, 'sayfa metni (altbilgi/iletişim)', 'verify');
    }
  }

  // ---- Harita koordinatı
  if (org?.geo?.latitude) set('geo', { latitude: Number(org.geo.latitude), longitude: Number(org.geo.longitude) }, 'mevcut şema');
  $('iframe[src*="google.com/maps"], iframe[data-src*="google.com/maps"], a[href*="google.com/maps"], a[href*="maps.google"]').each((_, el) => {
    const s = decodeURIComponent($(el).attr('src') || $(el).attr('data-src') || $(el).attr('href') || '');
    const m = /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/.exec(s) || /@(-?\d+\.\d+),(-?\d+\.\d+)/.exec(s) || /[?&](?:q|ll|center)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/.exec(s);
    const e = /!2d(-?\d+\.\d+)!3d(-?\d+\.\d+)/.exec(s);
    if (m) set('geo', { latitude: Number(m[1]), longitude: Number(m[2]) }, 'Google Haritalar bağlantısı');
    else if (e) set('geo', { latitude: Number(e[2]), longitude: Number(e[1]) }, 'Google Haritalar gömme kodu');
    if (!f.mapUrl && /maps/.test(s) && $(el).is('a')) f.mapUrl = { value: $(el).attr('href'), source: 'Google Haritalar bağlantısı', status: 'found' };
  });

  // ---- Çalışma saatleri
  const hoursText = $('[class*="hour" i], [class*="saat" i], [class*="calisma" i], [id*="hour" i], footer, [class*="footer" i], table, dl').text();
  const specs = [];
  for (const m of clean(hoursText).matchAll(HOURS_RE)) {
    const from = dayOf(m[1]);
    const to = m[2] ? dayOf(m[2]) : from;
    if (!from || !to) continue;
    const i0 = WEEK.indexOf(from);
    const i1 = WEEK.indexOf(to);
    const days = i1 >= i0 ? WEEK.slice(i0, i1 + 1) : [...WEEK.slice(i0), ...WEEK.slice(0, i1 + 1)];
    const t = (s) => s.replace('.', ':').padStart(5, '0');
    specs.push({ '@type': 'OpeningHoursSpecification', dayOfWeek: days, opens: t(m[3]), closes: t(m[4]) });
    if (specs.length >= 7) break;
  }
  if (org?.openingHoursSpecification) set('hours', [].concat(org.openingHoursSpecification), 'mevcut şema');
  else if (specs.length) set('hours', specs, 'sayfa metni', 'verify');

  // ---- Sosyal profiller
  const same = new Set([].concat(org?.sameAs || []).filter((s) => typeof s === 'string'));
  $('a[href^="http"]').each((_, el) => {
    const h = $(el).attr('href').split('#')[0];
    if (SOCIAL.test(h) && !/share|sharer|intent|\/search|\/hashtag\/|watch\?v=|\/p\/|\/reel\/|\/status\//i.test(h)) same.add(h.replace(/\?.*$/, '').replace(/\/$/, ''));
  });
  set('sameAs', [...same].slice(0, 15), org?.sameAs ? 'mevcut şema + sayfa bağlantıları' : 'sayfadaki sosyal medya bağlantıları');

  // ---- Site içi arama
  const form = $('form').filter((_, el) => $(el).find('input[type="search"], input[name="q"], input[name="s"], input[name="search"], input[name="query"], input[name="ara"], input[name="k"]').length > 0).first();
  if (form.length) {
    const input = form.find('input[type="search"], input[name="q"], input[name="s"], input[name="search"], input[name="query"], input[name="ara"], input[name="k"]').first();
    const action = abs(form.attr('action') || '/', pageUrl);
    if (action && input.attr('name')) set('search', `${action.split('?')[0]}?${input.attr('name')}={search_term_string}`, 'site arama formu');
  }

  // ---- Breadcrumb
  const crumbs = [];
  $('nav[aria-label*="breadcrumb" i] a, [class*="breadcrumb" i] a, ol[itemtype*="BreadcrumbList"] a').each((_, el) => {
    const name = clean($(el).text());
    const url = abs($(el).attr('href'), pageUrl);
    if (name && url && !crumbs.some((c) => c.url === url)) crumbs.push({ name, url });
  });
  const uniq = crumbs.filter((c, i) => i === 0 || c.name !== crumbs[i - 1].name);
  if (uniq.length) set('breadcrumbs', uniq.slice(0, 8), 'sayfadaki breadcrumb menüsü');

  // ---- Tarihler / yazar
  const product = nodes.find((n) => typesOf(n).includes('Product'));
  const article = nodes.find((n) => typesOf(n).some((t) => EQUIV.BlogPosting.test(t)));
  set('datePublished', clean(article?.datePublished) || meta('article:published_time') || clean($('time[datetime]').first().attr('datetime')) || null, 'yayın tarihi etiketi');
  set('dateModified', clean(article?.dateModified) || meta('article:modified_time') || meta('og:updated_time') || null, 'güncelleme tarihi etiketi');
  const authorNode = [].concat(article?.author || [])[0];
  const authorText = clean(authorNode?.name || (typeof authorNode === 'string' ? authorNode : '') || meta('author') || $('[rel~="author"], [itemprop="author"] [itemprop="name"], [itemprop="author"], [class*="author-name" i], [class*="byline" i] a, [class*="author" i] a').first().text());
  if (authorText && authorText.length <= 80 && !/^(admin|administrator|editor|yönetici)$/i.test(authorText)) {
    const authorUrl = abs($('[rel~="author"], [class*="author" i] a').first().attr('href'), pageUrl);
    set('author', { name: authorText.replace(/^(yazar|author|by)\s*[:：]?\s*/i, ''), url: authorUrl }, 'yazar etiketi');
  }

  // ---- Ürün
  const offer = product ? [].concat(product.offers || [])[0] : null;
  const priceRaw = offer?.price ?? offer?.lowPrice ?? (meta('product:price:amount') || meta('og:price:amount') || $('[itemprop="price"]').first().attr('content') || clean($('[itemprop="price"]').first().text()));
  let price = priceRaw ? parseNumber(priceRaw) : null;
  let currency = offer?.priceCurrency || meta('product:price:currency') || meta('og:price:currency') || $('[itemprop="priceCurrency"]').first().attr('content') || null;
  let priceSource = priceRaw ? (offer ? 'mevcut şema' : 'fiyat etiketi') : null;
  if (!price) {
    const PRICE_RE = /(₺|\$|€|£)\s?(\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{1,2})?)|(\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{1,2})?)\s?(₺|TL|TRY|€|EUR|\$|USD|£|GBP)(?![\p{L}])/u;
    const priceText = $('[class*="price" i], [class*="fiyat" i], [id*="price" i]').slice(0, 15).map((_, el) => $(el).text()).get().find((t) => PRICE_RE.test(t)) || '';
    const m = PRICE_RE.exec(priceText);
    if (m) {
      price = parseNumber(m[2] || m[3]);
      currency = CURRENCY[m[1] || m[4]] || currency;
      priceSource = 'sayfadaki fiyat metni';
    }
  }
  if (price) set('price', { amount: price, currency: currency ? CURRENCY[currency] || currency : null }, priceSource, priceSource === 'sayfadaki fiyat metni' ? 'verify' : 'found');
  // Türkçe büyük harf (SATIŞ → satış) için yerel küçük harfe çevrilir; /i bayrağı I→ı dönüşümünü yapmaz
  const bodyText = trLower(clean($('body').clone().find('script, style, noscript').remove().end().text()).slice(0, 80_000));
  const availMeta = meta('product:availability') || $('[itemprop="availability"]').first().attr('href') || $('[itemprop="availability"]').first().attr('content') || firstStr(offer?.availability);
  if (availMeta) set('availability', /out|yok|tüken/i.test(availMeta) ? 'https://schema.org/OutOfStock' : /pre/i.test(availMeta) ? 'https://schema.org/PreOrder' : 'https://schema.org/InStock', 'stok etiketi');
  else if (/stokta yok|tükendi|tükenmiş|satış yok|out of stock|sold out/i.test(bodyText)) set('availability', 'https://schema.org/OutOfStock', 'sayfa metni', 'verify');
  else if (/sepete ekle|add to cart|hemen al|buy now|stokta/i.test(bodyText)) set('availability', 'https://schema.org/InStock', '“Sepete ekle” butonu', 'verify');
  const skuText = /(ürün kodu|stok kodu|sku|model no|model kodu|mpn)\s*[:：#]?\s*([A-Z0-9][A-Z0-9._\-/]{2,30})/i.exec(bodyText);
  set('sku', clean(product?.sku) || clean($('[itemprop="sku"]').first().attr('content') || $('[itemprop="sku"]').first().text()) || skuText?.[2] || null, 'ürün kodu');
  const gtin = clean(product?.gtin13 || product?.gtin || $('[itemprop^="gtin"]').first().attr('content')) || /(barkod|ean|gtin)\s*[:：]?\s*(\d{8,14})/i.exec(bodyText)?.[2];
  set('gtin', gtin || null, 'barkod');
  const brand = typeof product?.brand === 'string' ? product.brand : product?.brand?.name;
  set('brand', clean(brand) || meta('product:brand') || clean($('[itemprop="brand"] [itemprop="name"], [itemprop="brand"]').first().attr('content') || $('[itemprop="brand"]').first().text()) || null, 'marka etiketi');
  const imgs = new Set();
  if (f.image) imgs.add(f.image.value);
  $('[itemprop="image"], [class*="product" i] img, [class*="gallery" i] img').each((_, el) => {
    const u = abs($(el).attr('content') || $(el).attr('data-src') || $(el).attr('src'), pageUrl);
    if (u && !/\.svg|data:|placeholder|logo|icon/i.test(u)) imgs.add(u);
  });
  set('images', [...imgs].slice(0, 6), 'sayfa görselleri');
  const ratingValue = product?.aggregateRating?.ratingValue || $('[itemprop="ratingValue"]').first().attr('content') || clean($('[itemprop="ratingValue"]').first().text());
  const ratingCount = product?.aggregateRating?.reviewCount || product?.aggregateRating?.ratingCount || $('[itemprop="reviewCount"], [itemprop="ratingCount"]').first().attr('content') || clean($('[itemprop="reviewCount"], [itemprop="ratingCount"]').first().text());
  if (parseNumber(ratingValue) && parseNumber(ratingCount)) set('rating', { ratingValue: parseNumber(ratingValue), reviewCount: Math.round(parseNumber(ratingCount)) }, 'sayfadaki puan işaretlemesi');

  // ---- SSS (soru-cevap)
  const faqs = [];
  const pushFaq = (q, a) => {
    q = clean(q);
    a = clean(a);
    if (q.length >= 8 && a.length >= 20 && !faqs.some((x) => x.q === q)) faqs.push({ q: q.slice(0, 300), a: a.slice(0, 1200) });
  };
  $('details').each((_, el) => {
    const q = $(el).find('summary').first().text();
    const a = $(el).clone().find('summary').remove().end().text();
    pushFaq(q, a);
  });
  $('dl').each((_, el) => $(el).find('dt').each((__, dt) => pushFaq($(dt).text(), $(dt).next('dd').text())));
  $('h2, h3, h4, [class*="faq" i] button, [class*="accordion" i] button, [class*="sss" i] button').each((_, el) => {
    const q = clean($(el).text());
    if (!/\?\s*$/.test(q)) return;
    let a = '';
    let n = $(el).next();
    for (let i = 0; i < 6 && n.length && !/^h[1-6]$/i.test(n[0].tagName) && !n.is('button'); i++, n = n.next()) a += ` ${n.text()}`;
    if (!a.trim()) a = $(el).parent().next().text();
    pushFaq(q, a);
  });
  set('faqs', faqs.slice(0, 20), 'sayfadaki soru-cevap bölümleri');

  // ---- Video
  const videos = [];
  $('iframe[src*="youtube.com/embed/"], iframe[data-src*="youtube.com/embed/"], iframe[src*="youtube-nocookie.com/embed/"]').each((_, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src');
    const id = /embed\/([\w-]{6,})/.exec(src)?.[1];
    if (id && !videos.some((v) => v.id === id)) videos.push({ id, title: clean($(el).attr('title')) || null });
  });
  set('videos', videos.slice(0, 3), 'gömülü YouTube videosu');

  // ---- Tarif / adımlar
  const listAfter = (re) => {
    for (const el of $('h2, h3, h4, strong').filter((_, x) => re.test(trLower($(x).text()))).toArray().slice(0, 5)) {
      const items = listNear($(el));
      if (items.length >= 2) return items;
    }
    return [];
  };
  const listNear = (h) => {
    // Liste başlığın kardeşi olabileceği gibi bir sonraki kutunun içinde de olabilir
    const siblings = [];
    for (let n = h.next(), k = 0; n.length && k < 30 && !/^h[1-4]$/i.test(n[0].tagName); n = n.next(), k++) siblings.push(n);
    let list = siblings.map((n) => (n.is('ul, ol') ? n : n.find('ul, ol').first())).find((l) => l.length);
    if (!list?.length) list = h.parent().nextAll().find('ul, ol').addBack('ul, ol').first();
    const items = list.find('li').map((_, li) => clean($(li).text())).get().filter((x) => x.length >= 2);
    if (items.length >= 2) return items.slice(0, 40);
    // Fotoğraflı tariflerde adımlar liste değil, görseller arasındaki paragraflardır
    return siblings.flatMap((n) => (n.is('p') ? [n] : n.find('p').toArray().map((x) => $(x))))
      .map((x) => clean(x.text())).filter((x) => x.split(' ').length >= 4).slice(0, 40);
  };
  set('ingredients', listAfter(/malzeme|ingredient/), '“Malzemeler” listesi');
  set('steps', listAfter(/yapılış|hazırlanış|yapımı|instructions|directions|method|adım/), '“Yapılışı” listesi');

  // ---- Etkinlik tarihi
  const eventDate = $('[itemprop="startDate"]').attr('content') || $('time[datetime]').filter((_, el) => Date.parse($(el).attr('datetime')) > Date.now()).first().attr('datetime');
  set('startDate', eventDate || null, 'tarih etiketi', 'verify');

  // ---- Ana içerikteki bağlantılar (kategori → ItemList)
  const $main = $('main').length ? $('main').first() : $('body');
  const items = [];
  $main.find('a[href]').each((_, el) => {
    const u = normalizeUrl(abs($(el).attr('href'), pageUrl) || '');
    const name = clean($(el).attr('title') || $(el).find('img').attr('alt') || $(el).text());
    if (u && new URL(u).hostname === new URL(pageUrl).hostname && name.length >= 3 && name.length <= 150 && classifyPage({ url: u, schema_types: [] }) === 'product' && !items.some((i) => i.url === u)) items.push({ url: u, name });
  });
  set('listItems', items.slice(0, 30), 'sayfadaki ürün bağlantıları');
  return f;
}

// ------------------------------------------------------------------ Grafik oluşturma
function brandName(facts, hostname) {
  if (facts.siteName) return facts.siteName.value;
  const title = facts.title?.value || '';
  const parts = title.split(/\s[|\-–—:·]\s/).map(clean).filter(Boolean);
  const host = hostname.replace(/^www\./, '').split('.')[0];
  return parts.find((p) => trLower(p).replace(/\s/g, '').includes(trLower(host))) || (parts.length > 1 ? parts.at(-1) : null) || host.charAt(0).toUpperCase() + host.slice(1);
}

const prettySlug = (s) => {
  try {
    s = decodeURIComponent(s);
  } catch {
    /* ham */
  }
  return s.replace(/\.[a-z]{2,5}$/i, '').replace(/[-_]+/g, ' ').trim().replace(/^\p{L}/u, (c) => c.toLocaleUpperCase('tr'));
};
const pageName = (facts) => (facts.h1?.value || facts.title?.value?.split(/\s[|\-–—]\s/)[0] || '').slice(0, 200);
const compact = (o) => {
  if (Array.isArray(o)) return o.map(compact).filter((v) => v !== undefined);
  if (o && typeof o === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(o)) {
      const c = compact(v);
      if (c === undefined || c === null || c === '' || (Array.isArray(c) && !c.length) || (typeof c === 'object' && !Array.isArray(c) && !Object.keys(c).length)) continue;
      out[k] = c;
    }
    return out;
  }
  return o;
};

const NOTES = {
  FAQPage: 'Google, 2023’ten beri SSS zengin sonucunu yalnızca otoriter sağlık ve kamu sitelerinde gösteriyor. Yine de işaretleme, yapay zekâ yanıtlarında soru-cevapların doğru eşleşmesine yardımcı olur.',
  Product: 'Ürün zengin sonuçları ve Google Alışveriş (merchant listing) için fiyat, para birimi ve stok zorunludur; kargo (shippingDetails) ve iade politikası (hasMerchantReturnPolicy) eklemek uygunluğu artırır.',
  LocalBusiness: 'Yerel aramada asıl kaynak Google İşletme Profili’dir. Şemadaki ad, adres ve telefon, İşletme Profili ile birebir aynı olmalıdır.',
  Review: 'İşletmenin kendi sitesindeki kendi hakkındaki yorumlar (LocalBusiness/Organization puanı) Google’da yıldız olarak gösterilmez; bu yüzden puan eklenmedi.',
  VideoObject: 'Video zengin sonucu için uploadDate zorunludur; videonun yüklenme tarihini YouTube’dan kontrol edip ekleyin.',
  SoftwareApplication: 'Yazılım zengin sonucu için gerçek kullanıcı puanı (aggregateRating) veya yorum gerekir; uydurulmuş puan kullanmayın.',
  JobPosting: 'İş ilanı zengin sonucu için datePosted, validThrough, jobLocation ve maaş bilgisi önemlidir; ilan kapanınca işaretlemeyi kaldırın.',
};

/**
 * @param {object} domain
 * @param {{url:string, pageType?:string, sector?:string}} opts
 */
export async function generateSchema(domain, { url, pageType, sector }) {
  const target = normalizeUrl(url);
  if (!target) throw badRequest('Geçersiz URL');
  const bare = (h) => h.toLowerCase().replace(/^www\./, '');
  if (bare(new URL(target).hostname) !== bare(domain.hostname)) throw badRequest('URL bu alan adına ait olmalı');
  const audit = await latestAudit(domain.id);
  const pages = audit ? await auditPages(audit.id) : [];

  const fetchHtml = async (u) => {
    const res = await safeFetch(u, { timeoutMs: 15_000, maxBytes: 4 * 1024 * 1024 });
    if (res.status !== 200 || !/html/i.test(String(res.headers['content-type'] || ''))) throw badRequest(`Sayfa alınamadı (HTTP ${res.status})`);
    return res;
  };
  const pageRes = await fetchHtml(target);
  const pageUrl = normalizeUrl(pageRes.finalUrl);
  const origin = new URL(pageUrl).origin;
  const homeUrl = `${origin}/`;
  const isHome = new URL(pageUrl).pathname === '/' || pageUrl === normalizeUrl(homeUrl);
  const homeRes = isHome ? pageRes : await fetchHtml(homeUrl).catch(() => null);
  const pf = extractFacts(pageRes.body, pageUrl);
  const hf = homeRes ? (isHome ? pf : extractFacts(homeRes.body, normalizeUrl(homeRes.finalUrl))) : {};

  const crawl = pages.find((p) => normalizeUrl(p.url) === pageUrl);
  const detectedType = classifyPage(crawl || { url: pageUrl, h1: pf.h1?.value, schema_types: pf.existing, hints: [], depth: isHome ? 0 : 1, published_at: pf.datePublished?.value });
  // Canlı sayfa içeriği tarama sınıflandırmasından daha kesin olabilir (ör. şemasız tarif / ürün sayfası)
  let liveType = detectedType;
  if (['article', 'other'].includes(detectedType) && pf.ingredients && pf.steps) liveType = 'recipe';
  else if (['article', 'other', 'service'].includes(detectedType) && pf.price && pf.availability && /sepete|cart|stok/i.test(pf.availability.source)) liveType = 'product';
  const type = PAGE_TYPES[pageType] ? pageType : liveType;
  // İşletme bilgisi: önce ana sayfa; iletişim/şube/hakkımızda sayfasında o sayfadaki bilgi öncelikli
  const biz = (k) => (pf[k] && (['contact', 'location', 'about'].includes(type) || !hf[k]) ? pf[k] : hf[k] || pf[k]);

  let sectorKey = SECTORS[sector] ? sector : domain.business_type && SECTORS[domain.business_type] ? domain.business_type : null;
  let sectorAuto = null;
  if (!sectorKey) {
    sectorAuto = pages.length ? await detectSector(domain, pages) : { detected: 'generic' };
    sectorKey = sectorAuto.detected;
  }
  const S = SECTORS[sectorKey];
  const name = brandName(hf.siteName ? hf : pf, domain.hostname);

  const report = [];
  const note = new Set();
  const track = (path, fact, { required = false, label } = {}) => {
    if (fact) report.push({ path, label: label || path, status: fact.status, source: fact.source, value: typeof fact.value === 'string' ? fact.value.slice(0, 160) : Array.isArray(fact.value) ? `${fact.value.length} öğe` : null });
    else report.push({ path, label: label || path, status: required ? 'missing_required' : 'missing', source: null, value: null });
    return fact?.value;
  };

  // ---- Kuruluş
  const orgId = `${origin}/#organization`;
  const fullOrg = ['home', 'contact', 'about', 'location'].includes(type);
  const isLocal = LOCAL_TYPES.has(S.type);
  const address = biz('address');
  const phones = biz('telephone');
  const orgNode = {
    '@type': S.type,
    '@id': orgId,
    name,
    url: homeUrl,
    logo: biz('logo') ? { '@type': 'ImageObject', url: biz('logo').value } : undefined,
  };
  report.push({ path: 'organization.name', label: 'Kuruluş adı', status: hf.siteName || pf.siteName ? 'found' : 'verify', source: hf.siteName?.source || pf.siteName?.source || 'sayfa başlığından tahmin', value: name });
  track('organization.logo', biz('logo'), { label: 'Logo' });
  if (fullOrg) {
    Object.assign(orgNode, {
      description: hf.description?.value,
      image: biz('image')?.value || biz('logo')?.value,
      telephone: track('organization.telephone', phones, { label: 'Telefon', required: isLocal })?.[0],
      email: track('organization.email', biz('email'), { label: 'E-posta' })?.[0],
      sameAs: track('organization.sameAs', biz('sameAs'), { label: 'Sosyal profiller (sameAs)' }),
    });
    if (isLocal) {
      const a = track('organization.address', address, { label: 'Adres', required: true });
      orgNode.address = a ? { '@type': 'PostalAddress', ...a } : undefined;
      const g = track('organization.geo', biz('geo'), { label: 'Harita koordinatı' });
      orgNode.geo = g ? { '@type': 'GeoCoordinates', ...g } : undefined;
      orgNode.openingHoursSpecification = track('organization.openingHours', biz('hours'), { label: 'Çalışma saatleri' });
      orgNode.hasMap = biz('mapUrl')?.value;
      if (a?.addressLocality) orgNode.areaServed = { '@type': 'City', name: a.addressRegion || a.addressLocality };
      note.add(NOTES.LocalBusiness);
      note.add(NOTES.Review);
    } else if (address) {
      orgNode.address = { '@type': 'PostalAddress', ...address.value };
      track('organization.address', address, { label: 'Adres' });
    }
    if (phones?.value?.length) {
      orgNode.contactPoint = {
        '@type': 'ContactPoint', telephone: phones.value[0], contactType: 'customer service',
        email: biz('email')?.value[0], availableLanguage: pf.lang ? pf.lang.split('-')[0] : undefined,
      };
    }
  }

  // ---- WebSite + WebPage
  const websiteId = `${origin}/#website`;
  const website = { '@type': 'WebSite', '@id': websiteId, url: homeUrl, name, inLanguage: pf.lang || undefined, publisher: { '@id': orgId } };
  if (isHome && track('website.search', pf.search, { label: 'Site içi arama (SearchAction)' })) {
    website.potentialAction = { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: pf.search.value }, 'query-input': 'required name=search_term_string' };
  }
  const pageTypeMap = { category: 'CollectionPage', contact: 'ContactPage', about: 'AboutPage', faq: 'FAQPage', person: 'ProfilePage', product: 'ItemPage' };
  const webPageId = `${pageUrl}#webpage`;
  const webPage = {
    '@type': pageTypeMap[type] || 'WebPage',
    '@id': webPageId,
    url: pageUrl,
    name: pf.title?.value,
    description: pf.description?.value,
    isPartOf: { '@id': websiteId },
    inLanguage: pf.lang || undefined,
    primaryImageOfPage: pf.image ? { '@type': 'ImageObject', url: pf.image.value } : undefined,
    datePublished: pf.datePublished?.value,
    dateModified: pf.dateModified?.value,
  };
  if (isHome) webPage.about = { '@id': orgId };

  // ---- Breadcrumb
  let breadcrumb = null;
  if (!isHome) {
    let crumbs = pf.breadcrumbs?.value;
    const source = pf.breadcrumbs ? 'found' : 'verify';
    if (!crumbs) {
      const titles = new Map(pages.map((p) => [normalizeUrl(p.url), (p.h1 || p.title || '').split(/\s[|\-–—]\s/)[0]]));
      const segs = new URL(pageUrl).pathname.split('/').filter(Boolean);
      crumbs = [{ name: 'Ana Sayfa', url: homeUrl }];
      segs.forEach((s, i) => {
        const u = normalizeUrl(`${origin}/${segs.slice(0, i + 1).join('/')}${i < segs.length - 1 || pageUrl.endsWith('/') ? '/' : ''}`);
        crumbs.push({ name: i === segs.length - 1 ? pageName(pf) || prettySlug(s) : titles.get(u) || prettySlug(s), url: u });
      });
    } else if (!crumbs.some((c) => normalizeUrl(c.url) === pageUrl)) {
      crumbs = [...crumbs, { name: pageName(pf), url: pageUrl }];
    }
    breadcrumb = {
      '@type': 'BreadcrumbList',
      '@id': `${pageUrl}#breadcrumb`,
      itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, ...(i < crumbs.length - 1 && { item: c.url }) })),
    };
    webPage.breadcrumb = { '@id': breadcrumb['@id'] };
    report.push({ path: 'breadcrumb', label: 'Breadcrumb', status: source, source: pf.breadcrumbs ? pf.breadcrumbs.source : 'URL yapısından üretildi (ara sayfa adlarını kontrol edin)', value: crumbs.map((c) => c.name).join(' › ') });
  }

  // ---- Sayfa türüne özel ana varlık
  const mainNodes = [];
  const img = pf.images?.value?.length ? pf.images.value : pf.image ? [pf.image.value] : undefined;
  const offerFrom = (priceFact) => (priceFact ? {
    '@type': 'Offer',
    price: priceFact.value.amount,
    priceCurrency: priceFact.value.currency || undefined,
    availability: pf.availability?.value,
    url: pageUrl,
    seller: { '@id': orgId },
  } : undefined);

  if (type === 'product') {
    const node = {
      '@type': 'Product', '@id': `${pageUrl}#product`, name: pageName(pf), description: pf.description?.value, image: img,
      sku: track('product.sku', pf.sku, { label: 'SKU / ürün kodu' }),
      gtin13: pf.gtin?.value && String(pf.gtin.value).length === 13 ? pf.gtin.value : undefined,
      gtin: pf.gtin?.value && String(pf.gtin.value).length !== 13 ? pf.gtin.value : undefined,
      brand: { '@type': 'Brand', name: track('product.brand', pf.brand, { label: 'Marka' }) || name },
    };
    track('product.image', pf.images || pf.image, { label: 'Ürün görselleri', required: true });
    const price = track('product.offers.price', pf.price, { label: 'Fiyat', required: true });
    if (price) {
      node.offers = offerFrom(pf.price);
      if (!price.currency) report.push({ path: 'product.offers.priceCurrency', label: 'Para birimi', status: 'missing_required', source: null, value: null });
    }
    track('product.offers.availability', pf.availability, { label: 'Stok durumu' });
    if (pf.rating) node.aggregateRating = { '@type': 'AggregateRating', ...pf.rating.value };
    track('product.aggregateRating', pf.rating, { label: 'Puan / yorum sayısı' });
    webPage.mainEntity = { '@id': node['@id'] };
    mainNodes.push(node);
    note.add(NOTES.Product);
  } else if (type === 'article') {
    const author = track('article.author', pf.author, { label: 'Yazar', required: true });
    mainNodes.push({
      '@type': sectorKey === 'news' ? 'NewsArticle' : 'BlogPosting', '@id': `${pageUrl}#article`,
      headline: pageName(pf).slice(0, 110), description: pf.description?.value, image: img,
      datePublished: track('article.datePublished', pf.datePublished, { label: 'Yayın tarihi', required: true }),
      dateModified: track('article.dateModified', pf.dateModified, { label: 'Güncelleme tarihi' }),
      author: author ? { '@type': 'Person', name: author.name, url: author.url || undefined } : undefined,
      publisher: { '@id': orgId }, mainEntityOfPage: { '@id': webPageId }, inLanguage: pf.lang || undefined,
    });
  } else if (type === 'service' || type === 'pricing') {
    const node = {
      '@type': 'Service', '@id': `${pageUrl}#service`, name: pageName(pf), serviceType: pageName(pf), description: pf.description?.value, image: img,
      provider: { '@id': orgId }, areaServed: biz('address')?.value?.addressRegion || biz('address')?.value?.addressLocality || undefined,
      offers: offerFrom(pf.price),
    };
    track('service.offers.price', pf.price, { label: 'Fiyat (varsa)' });
    webPage.mainEntity = { '@id': node['@id'] };
    mainNodes.push(node);
  } else if (type === 'person') {
    const h1 = pageName(pf);
    const titleMatch = PERSON_TITLE.exec(`${h1} `);
    const node = {
      '@type': 'Person', '@id': `${pageUrl}#person`, name: h1, url: pageUrl, image: pf.image?.value,
      jobTitle: titleMatch ? clean(titleMatch[1]) : undefined, description: pf.description?.value,
      worksFor: { '@id': orgId }, sameAs: pf.sameAs?.value?.filter((s) => !(hf.sameAs?.value || []).includes(s)),
    };
    report.push({ path: 'person.jobTitle', label: 'Unvan', status: titleMatch ? 'verify' : 'missing', source: titleMatch ? 'başlıktaki unvan' : null, value: node.jobTitle || null });
    webPage.mainEntity = { '@id': node['@id'] };
    mainNodes.push(node);
  } else if (type === 'event') {
    const start = track('event.startDate', pf.startDate, { label: 'Başlangıç tarihi', required: true });
    mainNodes.push({
      '@type': 'Event', '@id': `${pageUrl}#event`, name: pageName(pf), description: pf.description?.value, image: img, startDate: start,
      eventStatus: 'https://schema.org/EventScheduled', eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      location: biz('address') ? { '@type': 'Place', name, address: { '@type': 'PostalAddress', ...biz('address').value } } : undefined,
      organizer: { '@id': orgId }, offers: offerFrom(pf.price),
    });
    track('event.location', biz('address'), { label: 'Etkinlik yeri', required: true });
  } else if (type === 'job') {
    mainNodes.push({
      '@type': 'JobPosting', '@id': `${pageUrl}#job`, title: pageName(pf), description: pf.description?.value,
      datePosted: track('job.datePosted', pf.datePublished, { label: 'İlan tarihi', required: true }),
      hiringOrganization: { '@id': orgId },
      jobLocation: biz('address') ? { '@type': 'Place', address: { '@type': 'PostalAddress', ...biz('address').value } } : undefined,
    });
    track('job.jobLocation', biz('address'), { label: 'İş yeri adresi', required: true });
    report.push({ path: 'job.validThrough', label: 'Son başvuru tarihi', status: 'missing', source: null, value: null });
    note.add(NOTES.JobPosting);
  } else if (type === 'recipe') {
    mainNodes.push({
      '@type': 'Recipe', '@id': `${pageUrl}#recipe`, name: pageName(pf), description: pf.description?.value, image: img,
      author: pf.author ? { '@type': 'Person', name: pf.author.value.name } : { '@id': orgId }, datePublished: pf.datePublished?.value,
      recipeIngredient: track('recipe.ingredients', pf.ingredients, { label: 'Malzemeler', required: true }),
      recipeInstructions: track('recipe.steps', pf.steps, { label: 'Yapılış adımları', required: true })?.map((t) => ({ '@type': 'HowToStep', text: t })),
    });
    report.push({ path: 'recipe.totalTime', label: 'Süre (totalTime, ör. PT45M)', status: 'missing', source: null, value: null });
  } else if (type === 'course') {
    mainNodes.push({ '@type': 'Course', '@id': `${pageUrl}#course`, name: pageName(pf), description: pf.description?.value || pageName(pf), provider: { '@id': orgId }, offers: offerFrom(pf.price) });
  } else if (type === 'category') {
    const items = track('itemList', pf.listItems, { label: 'Listelenen ürünler' });
    if (items?.length) {
      const list = { '@type': 'ItemList', '@id': `${pageUrl}#itemlist`, itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, url: it.url, name: it.name })) };
      webPage.mainEntity = { '@id': list['@id'] };
      mainNodes.push(list);
    }
  } else if (type === 'contact' || type === 'about' || type === 'location') {
    webPage.mainEntity = { '@id': orgId };
  }

  // SSS: hangi sayfa türü olursa olsun, sayfada soru-cevap varsa
  if (pf.faqs?.value?.length >= 2) {
    const faq = { mainEntity: pf.faqs.value.map((x) => ({ '@type': 'Question', name: x.q, acceptedAnswer: { '@type': 'Answer', text: x.a } })) };
    if (webPage['@type'] === 'FAQPage') Object.assign(webPage, faq);
    else mainNodes.push({ '@type': 'FAQPage', '@id': `${pageUrl}#faq`, ...faq });
    track('faq', pf.faqs, { label: 'Soru-cevaplar' });
    note.add(NOTES.FAQPage);
  } else if (type === 'faq') {
    track('faq', null, { label: 'Soru-cevaplar', required: true });
  }
  // Video: her sayfa türünde
  for (const v of pf.videos?.value || []) {
    mainNodes.push({
      '@type': 'VideoObject', '@id': `${pageUrl}#video-${v.id}`, name: v.title || pageName(pf), description: pf.description?.value || v.title || pageName(pf),
      thumbnailUrl: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`, embedUrl: `https://www.youtube.com/embed/${v.id}`, contentUrl: `https://www.youtube.com/watch?v=${v.id}`,
    });
    report.push({ path: `video.${v.id}.uploadDate`, label: `Video yükleme tarihi (${v.id})`, status: 'missing_required', source: null, value: null });
    note.add(NOTES.VideoObject);
  }
  if (sectorKey === 'software' && isHome) {
    mainNodes.push({ '@type': 'SoftwareApplication', '@id': `${origin}/#software`, name, applicationCategory: 'BusinessApplication', operatingSystem: 'Web', offers: offerFrom(pf.price), publisher: { '@id': orgId } });
    report.push({ path: 'software.aggregateRating', label: 'Kullanıcı puanı (gerçek)', status: 'missing_required', source: null, value: null });
    note.add(NOTES.SoftwareApplication);
  }

  const graph = compact({
    '@context': 'https://schema.org',
    '@graph': [orgNode, website, webPage, ...(breadcrumb ? [breadcrumb] : []), ...mainNodes],
  });
  const validation = validateJsonLd([graph]);
  if (!fullOrg) note.add('Bu sayfada kuruluş düğümü kısa tutuldu; tam bilgi (adres, telefon, saatler) ana sayfa çıktısındadır ve @id ile birbirine bağlanır.');
  const existing = pf.existing.filter((t) => t !== 'ListItem');
  if (existing.length) note.add(`Sayfada zaten ${[...new Set(existing)].join(', ')} işaretlemesi var. Yeni kodu eklerken aynı türü iki kez tanımlamamak için eski bloğu kaldırın veya eklentinizin (Yoast, Rank Math vb.) çıktısını devre dışı bırakın.`);

  return {
    url: pageUrl,
    pageType: type,
    detectedPageType: liveType,
    sector: { key: sectorKey, label: S.label, type: S.type, auto: sectorAuto },
    jsonld: JSON.stringify(graph, null, 2),
    fields: report,
    validation,
    notes: [...note],
    existing: [...new Set(existing)],
  };
}
