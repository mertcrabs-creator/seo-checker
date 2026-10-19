/**
 * JSON-LD doğrulayıcı: Google zengin sonuç dokümantasyonundaki zorunlu (error) ve önerilen (warning)
 * alanlara göre tür bazlı kontrol. Sadece üst düzey ve @graph içindeki tipli düğümler değerlendirilir;
 * iç içe nesneler (offers, author, address) ait oldukları türün kuralı içinde kontrol edilir.
 */

const ARTICLE = new Set(['Article', 'NewsArticle', 'BlogPosting', 'TechArticle', 'Report', 'ScholarlyArticle', 'LiveBlogPosting']);
const LOCAL_BUSINESS = new Set([
  'LocalBusiness', 'Store', 'Restaurant', 'CafeOrCoffeeShop', 'BarOrPub', 'Bakery', 'FoodEstablishment', 'Hotel', 'LodgingBusiness',
  'MedicalBusiness', 'MedicalClinic', 'Dentist', 'Physician', 'Hospital', 'Pharmacy', 'BeautySalon', 'HairSalon', 'DaySpa', 'HealthAndBeautyBusiness',
  'AutoRepair', 'AutoDealer', 'AutomotiveBusiness', 'LegalService', 'Attorney', 'RealEstateAgent', 'TravelAgency', 'ProfessionalService',
  'HomeAndConstructionBusiness', 'Electrician', 'Plumber', 'GeneralContractor', 'SportsActivityLocation', 'ExerciseGym', 'EducationalOrganization',
  'ClothingStore', 'ElectronicsStore', 'FurnitureStore', 'JewelryStore', 'ShoeStore', 'OnlineStore', 'FinancialService', 'InsuranceAgency',
]);
const ORGANIZATION = new Set(['Organization', 'Corporation', 'NGO', 'OnlineBusiness', 'NewsMediaOrganization', 'MedicalOrganization']);

const asArray = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const has = (node, key) => asArray(node?.[key]).some((v) => v !== '' && v !== null && v !== undefined);
const typesOf = (node) => asArray(node?.['@type']).map(String);
const isAbsUrl = (v) => typeof v === 'string' && /^https?:\/\/[^\s]+$/i.test(v.trim());
const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const isIsoDate = (v) => typeof v === 'string' && ISO_DATE.test(v.trim()) && !Number.isNaN(Date.parse(v.trim().replace(' ', 'T')));
const isNumeric = (v) => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && /^\d+([.,]\d+)?$/.test(v.trim()));
const urlOf = (v) => (typeof v === 'string' ? v : v?.url || v?.['@id'] || v?.contentUrl);

function checkRating(rating, label, out) {
  if (!rating || typeof rating !== 'object') return out.errors.push(`${label}: geçersiz nesne`);
  if (!has(rating, 'ratingValue')) out.errors.push(`${label}: ratingValue eksik`);
  else if (!isNumeric(rating.ratingValue)) out.errors.push(`${label}: ratingValue sayı olmalı (“${String(rating.ratingValue).slice(0, 20)}”)`);
  else if (Number(String(rating.ratingValue).replace(',', '.')) > 5 && !has(rating, 'bestRating')) out.warnings.push(`${label}: 5’ten büyük puan için bestRating belirtin`);
  if (label === 'aggregateRating' && !has(rating, 'ratingCount') && !has(rating, 'reviewCount')) out.errors.push('aggregateRating: ratingCount veya reviewCount eksik');
}

function checkOffers(node, out) {
  for (const offer of asArray(node.offers).slice(0, 20)) {
    if (!offer || typeof offer !== 'object') continue;
    const aggregate = typesOf(offer).includes('AggregateOffer');
    if (aggregate) {
      if (!has(offer, 'lowPrice')) out.errors.push('AggregateOffer: lowPrice eksik');
    } else if (!has(offer, 'price') && !has(offer, 'priceSpecification')) {
      out.errors.push('offers: price eksik');
    } else if (has(offer, 'price') && !isNumeric(offer.price)) {
      out.errors.push(`offers: price yalnızca sayı olmalı (“${String(offer.price).slice(0, 20)}”)`);
    }
    if (!has(offer, 'priceCurrency') && !has(offer, 'priceSpecification')) out.errors.push('offers: priceCurrency eksik');
    if (!aggregate && !has(offer, 'availability')) out.warnings.push('offers: availability önerilir');
    if (has(offer, 'priceValidUntil') && !isIsoDate(offer.priceValidUntil)) out.errors.push('offers: priceValidUntil ISO 8601 tarih olmalı');
  }
}

const recommend = (node, keys, out, prefix) => keys.forEach((k) => !has(node, k) && out.warnings.push(`${prefix}: ${k} önerilir`));
const requireKeys = (node, keys, out, prefix) => keys.forEach((k) => !has(node, k) && out.errors.push(`${prefix}: ${k} eksik`));
const dateField = (node, key, out, prefix) => has(node, key) && !isIsoDate(node[key]) && out.errors.push(`${prefix}: ${key} ISO 8601 biçiminde olmalı`);

/** Tür bazlı kurallar; anahtar normalize edilmiş tür adıdır. */
const RULES = {
  Product(n, o) {
    requireKeys(n, ['name'], o, 'Product');
    if (!has(n, 'offers') && !has(n, 'review') && !has(n, 'aggregateRating')) o.errors.push('Product: offers, review veya aggregateRating’den en az biri zorunlu');
    checkOffers(n, o);
    if (has(n, 'aggregateRating')) checkRating(n.aggregateRating, 'aggregateRating', o);
    recommend(n, ['image', 'description', 'brand'], o, 'Product');
    if (!has(n, 'sku') && !has(n, 'gtin') && !has(n, 'gtin13') && !has(n, 'mpn')) o.warnings.push('Product: sku / gtin / mpn önerilir');
  },
  Article(n, o, t) {
    recommend(n, ['headline', 'image', 'datePublished', 'author'], o, t);
    if (typeof n.headline === 'string' && n.headline.length > 110) o.warnings.push(`${t}: headline 110 karakteri aşıyor`);
    dateField(n, 'datePublished', o, t);
    dateField(n, 'dateModified', o, t);
    for (const a of asArray(n.author)) {
      if (typeof a === 'string') o.warnings.push(`${t}: author metin yerine Person/Organization nesnesi olmalı`);
      else if (a && !has(a, 'name') && !has(a, '@id')) o.errors.push(`${t}: author.name eksik`);
    }
    if (!has(n, 'dateModified')) o.warnings.push(`${t}: dateModified önerilir`);
  },
  FAQPage(n, o) {
    const qs = asArray(n.mainEntity);
    if (!qs.length) return o.errors.push('FAQPage: mainEntity (sorular) eksik');
    qs.slice(0, 50).forEach((q, i) => {
      if (!has(q, 'name')) o.errors.push(`FAQPage: ${i + 1}. soruda name eksik`);
      const ans = asArray(q?.acceptedAnswer)[0];
      if (!ans || !has(ans, 'text')) o.errors.push(`FAQPage: ${i + 1}. soruda acceptedAnswer.text eksik`);
    });
  },
  BreadcrumbList(n, o) {
    const items = asArray(n.itemListElement);
    if (!items.length) return o.errors.push('BreadcrumbList: itemListElement eksik');
    items.slice(0, 30).forEach((it, i) => {
      if (!has(it, 'position')) o.errors.push(`BreadcrumbList: ${i + 1}. öğede position eksik`);
      if (!has(it, 'name') && !has(it?.item, 'name')) o.errors.push(`BreadcrumbList: ${i + 1}. öğede name eksik`);
      if (i < items.length - 1 && !has(it, 'item')) o.errors.push(`BreadcrumbList: ${i + 1}. öğede item (URL) eksik`);
      const u = urlOf(it?.item);
      if (u && !isAbsUrl(u)) o.warnings.push(`BreadcrumbList: ${i + 1}. öğenin URL’si tam adres olmalı`);
    });
  },
  Organization(n, o, t) {
    recommend(n, ['name', 'url', 'logo'], o, t);
    const logo = urlOf(n.logo);
    if (logo && !isAbsUrl(logo)) o.warnings.push(`${t}: logo tam URL olmalı`);
    if (!has(n, 'sameAs')) o.warnings.push(`${t}: sameAs (sosyal profiller) önerilir`);
  },
  LocalBusiness(n, o, t) {
    requireKeys(n, ['name', 'address'], o, t);
    const addr = asArray(n.address)[0];
    if (addr && typeof addr === 'object') recommend(addr, ['streetAddress', 'addressLocality', 'addressCountry'], o, `${t}.address`);
    recommend(n, ['telephone', 'url', 'image', 'geo'], o, t);
    if (!has(n, 'openingHoursSpecification') && !has(n, 'openingHours')) o.warnings.push(`${t}: openingHoursSpecification önerilir`);
    if (has(n, 'aggregateRating')) checkRating(n.aggregateRating, 'aggregateRating', o);
  },
  WebSite(n, o) {
    recommend(n, ['name', 'url'], o, 'WebSite');
  },
  Event(n, o) {
    requireKeys(n, ['name', 'startDate', 'location'], o, 'Event');
    dateField(n, 'startDate', o, 'Event');
    dateField(n, 'endDate', o, 'Event');
    recommend(n, ['endDate', 'eventStatus', 'image', 'description', 'offers', 'organizer'], o, 'Event');
    if (has(n, 'offers')) checkOffers(n, o);
  },
  Recipe(n, o) {
    requireKeys(n, ['name', 'image'], o, 'Recipe');
    recommend(n, ['recipeIngredient', 'recipeInstructions', 'author', 'datePublished', 'totalTime', 'aggregateRating'], o, 'Recipe');
    if (has(n, 'aggregateRating')) checkRating(n.aggregateRating, 'aggregateRating', o);
  },
  Review(n, o) {
    requireKeys(n, ['itemReviewed', 'author'], o, 'Review');
    if (!has(n, 'reviewRating')) o.errors.push('Review: reviewRating eksik');
    else checkRating(asArray(n.reviewRating)[0], 'reviewRating', o);
  },
  AggregateRating(n, o) {
    requireKeys(n, ['itemReviewed'], o, 'AggregateRating');
    checkRating(n, 'aggregateRating', o);
  },
  VideoObject(n, o) {
    requireKeys(n, ['name', 'thumbnailUrl', 'uploadDate'], o, 'VideoObject');
    dateField(n, 'uploadDate', o, 'VideoObject');
    recommend(n, ['description', 'duration'], o, 'VideoObject');
    if (!has(n, 'contentUrl') && !has(n, 'embedUrl')) o.warnings.push('VideoObject: contentUrl veya embedUrl önerilir');
  },
  JobPosting(n, o) {
    requireKeys(n, ['title', 'description', 'datePosted', 'hiringOrganization'], o, 'JobPosting');
    if (!has(n, 'jobLocation') && n.jobLocationType !== 'TELECOMMUTE') o.errors.push('JobPosting: jobLocation eksik (uzaktan ise jobLocationType: TELECOMMUTE)');
    dateField(n, 'datePosted', o, 'JobPosting');
    dateField(n, 'validThrough', o, 'JobPosting');
    recommend(n, ['validThrough', 'baseSalary', 'employmentType'], o, 'JobPosting');
  },
  SoftwareApplication(n, o, t) {
    requireKeys(n, ['name'], o, t);
    if (!has(n, 'aggregateRating') && !has(n, 'review')) o.errors.push(`${t}: aggregateRating veya review zorunlu`);
    if (has(n, 'aggregateRating')) checkRating(n.aggregateRating, 'aggregateRating', o);
    if (!has(n, 'offers')) o.errors.push(`${t}: offers.price eksik (ücretsizse 0)`);
    recommend(n, ['applicationCategory', 'operatingSystem'], o, t);
  },
  Course(n, o) {
    requireKeys(n, ['name', 'description'], o, 'Course');
    recommend(n, ['provider'], o, 'Course');
  },
  HowTo(_n, o) {
    o.warnings.push('HowTo: Google bu zengin sonucu 2023’te kaldırdı; işaretleme zararsız ama görsel kazanç sağlamaz');
  },
};

function ruleFor(type) {
  if (ARTICLE.has(type)) return [RULES.Article, type];
  if (LOCAL_BUSINESS.has(type)) return [RULES.LocalBusiness, type];
  if (ORGANIZATION.has(type)) return [RULES.Organization, type];
  if (type === 'WebApplication' || type === 'MobileApplication' || type === 'VideoGame') return [RULES.SoftwareApplication, type];
  return RULES[type] ? [RULES[type], type] : null;
}

/** Üst düzey ve @graph içindeki tipli düğümler. */
function topNodes(parsed) {
  const out = [];
  const visit = (node, depth) => {
    if (Array.isArray(node)) return node.forEach((n) => visit(n, depth));
    if (!node || typeof node !== 'object' || out.length >= 30) return;
    if (node['@graph']) visit(node['@graph'], depth + 1);
    if (node['@type']) out.push(node);
  };
  visit(parsed, 0);
  return out;
}

/**
 * @param {unknown[]} blocks Ayrıştırılmış JSON-LD blokları
 * @returns {{ type:string, errors:string[], warnings:string[] }[]}
 */
export function validateJsonLd(blocks) {
  const results = [];
  for (const block of blocks) {
    const ctx = asArray(Array.isArray(block) ? block[0]?.['@context'] : block?.['@context']).map((c) => (typeof c === 'string' ? c : '')).join(' ');
    const badContext = !/schema\.org/i.test(ctx) && !block?.['@graph'];
    for (const node of topNodes(block)) {
      for (const t of typesOf(node)) {
        const rule = ruleFor(t);
        if (!rule) continue;
        const out = { type: t, errors: [], warnings: [] };
        if (badContext) out.warnings.push('@context “https://schema.org” olmalı');
        rule[0](node, out, rule[1]);
        out.errors = [...new Set(out.errors)].slice(0, 15);
        out.warnings = [...new Set(out.warnings)].slice(0, 15);
        results.push(out);
        break; // aynı düğüm için tek kural yeterli (ör. ["Product", "Thing"])
      }
      if (results.length >= 20) return results;
    }
  }
  return results;
}

/** İçerik ipucu → beklenen şema türleri (biri varsa ipucu karşılanmış sayılır). */
export const HINT_TYPES = {
  Article: [...ARTICLE],
  Product: ['Product', 'SoftwareApplication'],
  FAQPage: ['FAQPage', 'QAPage'],
  BreadcrumbList: ['BreadcrumbList'],
  VideoObject: ['VideoObject'],
};

/**
 * Sayfa içeriğinden yapısal veriye aday sinyaller (cheerio $ ile, metin temizliğinden önce çağrılır).
 * @returns {string[]} HINT_TYPES anahtarları
 */
export function detectSchemaHints($, meta) {
  const hints = [];
  const ogType = meta('og:type').toLowerCase();
  if (ogType === 'article' || meta('article:published_time') || ($('article').length && $('article time[datetime], time[datetime]').length)) hints.push('Article');
  const cartText = /\b(sepete ekle|add to cart|add to basket|satın al|hemen al|buy now|in den warenkorb)\b/i;
  const buttons = $('button, a.button, a.btn, input[type="submit"]').map((_, el) => $(el).text() || $(el).attr('value') || '').get().join(' | ');
  if (ogType === 'product' || meta('product:price:amount') || $('[itemprop="price"]').length || cartText.test(buttons)) hints.push('Product');
  const questions = $('h2, h3, h4, summary, dt').filter((_, el) => /\?\s*$/.test($(el).text().trim())).length;
  if (questions >= 3) hints.push('FAQPage');
  if ($('nav[aria-label*="breadcrumb" i], [class*="breadcrumb" i], [id*="breadcrumb" i], ol[itemtype*="BreadcrumbList"]').length) hints.push('BreadcrumbList');
  if ($('video').length || $('iframe[src*="youtube.com/embed"], iframe[src*="youtube-nocookie.com"], iframe[src*="player.vimeo.com"]').length) hints.push('VideoObject');
  return hints;
}
