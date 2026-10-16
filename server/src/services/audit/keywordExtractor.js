/**
 * Sayfa içeriğinden hedeflenen anahtar kelimeleri çıkarır (Search Console gerektirmez).
 * Alan ağırlıklı (title > H1 > URL > başlıklar/meta > gövde) 1-3 kelimelik ifadeler;
 * ifadeler durak kelimeyle başlayıp bitemez ve cümle/blok sınırını aşamaz.
 */

const STOP_TR = `acaba ama ancak artık aslında az bana bazen bazı belki ben beni benim beri bile bir birçok biri birkaç birşey biz bize
bizi bizim bu buna bunda bundan bunlar bunları bunların bunu bunun burada böyle böylece çok çünkü da daha dahi de değil diğer diye
dolayı dolayısıyla en fakat gibi göre hala hangi hem hep hepsi her herhangi herkes hiç hiçbir için ile ise işte kadar kendi kendine
ki kim kimse mı mi mu mü nasıl ne neden nerede nereye niçin niye o olan olarak oldu olduğu olduğunu olmak olması olur ona onlar
onları onların onu onun orada öyle sadece sanki şey şeyler şimdi şu şuna şunda şundan şunu siz size sizi sizin tarafından üzere
var vardır ve veya ya yani yine yok zaten tüm bütün ayrıca sonra önce olan olup olsun olabilir olacak etmek eden eder ederek
yapmak yapılan yapılır yapan çeşitli şekilde bizler sizler hakkında yeni ilk son tek tıklayın devamı oku daha fazla detaylı
detay iletişim anasayfa ana sayfa menü giriş üye kayıt sepet ara`;

const STOP_EN = `a about above after again against all am an and any are as at be because been before being below between both but by
can could did do does doing down during each few for from further had has have having he her here hers herself him himself his how
i if in into is it its itself just me more most my myself no nor not now of off on once only or other our ours ourselves out over own
same she should so some such than that the their theirs them themselves then there these they this those through to too under until
up very was we were what when where which while who whom why will with you your yours yourself yourselves also may might must shall
would get got one us via per new click read more home menu login sign cart search contact`;

export const STOPWORDS = new Set(`${STOP_TR} ${STOP_EN}`.split(/\s+/).filter(Boolean));

const WEIGHTS = { title: 5, h1: 4, url: 3, headings: 2, meta: 2, alt: 1, body: 1 };
const BODY_CAP = 30; // tek bir ifadenin gövdeden alabileceği en yüksek tekrar katkısı
const NGRAM_BONUS = { 1: 1, 2: 1.6, 3: 1.9 };
const TOKEN_RE = /[\p{L}\p{N}]+(?:\.[\p{L}\p{N}]+)*(?:['’][\p{L}]+)?/gu;
// Nokta/iki nokta sadece ardından boşluk geliyorsa sınırdır ("node.js", "3.5" bölünmez)
const BOUNDARY_RE = /[\n!?;|•·,()[\]{}"“”«»<>/\\]+|[.:](?=\s|$)|\s[-–—]\s/u;

export const lowerFor = (lang) => {
  const locale = String(lang || '').toLowerCase().startsWith('tr') ? 'tr' : 'en';
  return (s) => String(s || '').toLocaleLowerCase(locale);
};

const isContentToken = (t) => t.length >= 2 && !STOPWORDS.has(t) && !/^\d+$/.test(t);

/** "Kırmızı elbise" ifadesinin bir metindeki geçiş sayısı için tokenize edilmiş segmentler. */
function segments(text, lower) {
  return lower(text)
    .split(BOUNDARY_RE)
    .map((seg) => (seg.match(TOKEN_RE) || []).map((t) => t.replace(/['’].*$/, '')))
    .filter((s) => s.length);
}

function countNgrams(text, lower, into) {
  for (const seg of segments(text, lower)) {
    for (let n = 1; n <= 3; n++) {
      for (let i = 0; i + n <= seg.length; i++) {
        const first = seg[i];
        const last = seg[i + n - 1];
        if (!isContentToken(first) || !isContentToken(last)) continue;
        if (n === 1 && first.length < 3) continue;
        const key = seg.slice(i, i + n).join(' ');
        into.set(key, (into.get(key) || 0) + 1);
      }
    }
  }
  return into;
}

export const wordCountOf = (text) => (String(text).match(TOKEN_RE) || []).length;

/**
 * @param {{title?:string,h1?:string,headings?:string[],meta?:string,path?:string,body?:string,alts?:string[],lang?:string}} src
 * @returns {{keyword:string,score:number,count:number,density:number,inTitle:boolean,inH1:boolean,inMeta:boolean,inUrl:boolean,inHeadings:boolean}[]}
 */
export function extractKeywords(src, limit = 20) {
  const lower = lowerFor(src.lang);
  const fields = {
    title: src.title || '',
    h1: src.h1 || '',
    headings: (src.headings || []).join('\n'),
    meta: src.meta || '',
    alt: (src.alts || []).join('\n'),
    body: src.body || '',
  };
  const counts = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, countNgrams(v, lower, new Map())]));
  const bodyWords = Math.max(1, wordCountOf(fields.body));
  // URL ASCII olabilir (kirmizi-elbise); ayrı aday üretmez, eşleşen ifadelere puan katar
  const urlSlug = `-${slugify(src.path)}-`;
  const inUrl = (key) => urlSlug.includes(`-${slugify(key)}-`);

  const candidates = new Map();
  for (const [field, map] of Object.entries(counts)) {
    for (const [key, c] of map) {
      const entry = candidates.get(key) || { keyword: key, raw: inUrl(key) ? WEIGHTS.url : 0, total: 0 };
      entry.raw += WEIGHTS[field] * (field === 'body' ? Math.min(c, BODY_CAP) : Math.min(c, 3));
      entry.total += c;
      candidates.set(key, entry);
    }
  }

  const prominent = (key) => inUrl(key) || ['title', 'h1', 'headings'].some((f) => counts[f].has(key));
  let list = [...candidates.values()]
    .map((e) => {
      const n = e.keyword.split(' ').length;
      return { ...e, n, score: e.raw * NGRAM_BONUS[n] };
    })
    // Tek geçen ve öne çıkan bir alanda olmayan çok kelimeli ifadeler gürültüdür
    .filter((e) => e.n === 1 || e.total >= 2 || prominent(e.keyword))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit * 4);

  // Daha uzun bir ifade neredeyse her geçişini kapsıyorsa kısa olanı at ("elbise" ⊂ "kırmızı elbise")
  const kept = [];
  for (const e of list) {
    const covered = kept.some((k) => k.n > e.n && ` ${k.keyword} `.includes(` ${e.keyword} `) && k.total >= e.total * 0.8);
    if (!covered) kept.push(e);
    if (kept.length >= limit) break;
  }
  list = kept;

  return list.map((e) => ({
    keyword: e.keyword.slice(0, 200),
    score: Math.round(e.score * 10) / 10,
    count: counts.body.get(e.keyword) || 0,
    density: Math.round(((counts.body.get(e.keyword) || 0) * e.n * 10_000) / bodyWords) / 100,
    inTitle: counts.title.has(e.keyword),
    inH1: counts.h1.has(e.keyword),
    inMeta: counts.meta.has(e.keyword),
    inUrl: inUrl(e.keyword),
    inHeadings: counts.headings.has(e.keyword),
  }));
}

const ASCII_MAP = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' };
/** URL karşılaştırması için: "Kırmızı Elbise" -> "kirmizi-elbise" */
export function slugify(s) {
  return String(s || '')
    .toLocaleLowerCase('tr')
    .replace(/[çğıöşüâîû]/g, (c) => ASCII_MAP[c])
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Bir ifadenin metinde (kelime sınırlarıyla) kaç kez geçtiği. */
export function phraseCount(text, phrase, lang) {
  const lower = lowerFor(lang);
  const target = (lower(phrase).match(TOKEN_RE) || []).join(' ');
  if (!target) return 0;
  const n = target.split(' ').length;
  let count = 0;
  for (const seg of segments(text, lower)) {
    for (let i = 0; i + n <= seg.length; i++) if (seg.slice(i, i + n).join(' ') === target) count++;
  }
  return count;
}
