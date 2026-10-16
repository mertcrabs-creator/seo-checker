const nf = new Intl.NumberFormat('tr-TR');
const compact = new Intl.NumberFormat('tr-TR', { notation: 'compact', maximumFractionDigits: 1 });
const pct = new Intl.NumberFormat('tr-TR', { style: 'percent', maximumFractionDigits: 2 });
const dateShort = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short' });
const dateTime = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });
const regionNames = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['tr'], { type: 'region' }) : null;

export const fmt = {
  num: (v) => (v === null || v === undefined ? '—' : nf.format(v)),
  compact: (v) => (v === null || v === undefined ? '—' : v >= 10_000 ? compact.format(v) : nf.format(v)),
  pct: (v) => (v === null || v === undefined || Number.isNaN(v) ? '—' : pct.format(v)),
  pos: (v) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('tr-TR', { maximumFractionDigits: 1, minimumFractionDigits: 1 })),
  dateShort: (iso) => (iso ? dateShort.format(new Date(`${iso.slice(0, 10)}T00:00:00`)) : ''),
  dateTime: (v) => (v ? dateTime.format(new Date(v)) : '—'),
  ms: (v) => (v === null || v === undefined ? '—' : v >= 1000 ? `${(v / 1000).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} sn` : `${Math.round(v)} ms`),
  bytes: (v) => (v === null || v === undefined ? '—' : v > 1024 * 1024 ? `${(v / 1048576).toFixed(1)} MB` : `${Math.round(v / 1024)} KB`),
};

export function relativeChange(cur, prev) {
  if (cur === null || cur === undefined || !prev) return null;
  return (cur - prev) / prev;
}

/** GSC ISO-3166 alpha-3 ülke kodu -> Türkçe ülke adı */
const A3_TO_A2 = {
  TUR: 'TR', USA: 'US', DEU: 'DE', GBR: 'GB', FRA: 'FR', NLD: 'NL', AZE: 'AZ', RUS: 'RU', UKR: 'UA', ITA: 'IT',
  ESP: 'ES', CYP: 'CY', BEL: 'BE', AUT: 'AT', CHE: 'CH', SWE: 'SE', NOR: 'NO', DNK: 'DK', FIN: 'FI', POL: 'PL',
  CAN: 'CA', AUS: 'AU', IND: 'IN', PAK: 'PK', SAU: 'SA', ARE: 'AE', QAT: 'QA', KWT: 'KW', IRQ: 'IQ', IRN: 'IR',
  EGY: 'EG', GRC: 'GR', BGR: 'BG', ROU: 'RO', GEO: 'GE', KAZ: 'KZ', UZB: 'UZ', TKM: 'TM', KGZ: 'KG', BRA: 'BR',
  MEX: 'MX', ARG: 'AR', JPN: 'JP', CHN: 'CN', KOR: 'KR', IDN: 'ID', MYS: 'MY', SGP: 'SG', PHL: 'PH', VNM: 'VN',
  THA: 'TH', ISR: 'IL', JOR: 'JO', LBN: 'LB', SYR: 'SY', MAR: 'MA', DZA: 'DZ', TUN: 'TN', LBY: 'LY', NGA: 'NG',
  ZAF: 'ZA', KEN: 'KE', IRL: 'IE', PRT: 'PT', CZE: 'CZ', HUN: 'HU', SRB: 'RS', BIH: 'BA', MKD: 'MK', ALB: 'AL',
  HRV: 'HR', SVN: 'SI', SVK: 'SK', LTU: 'LT', LVA: 'LV', EST: 'EE', BLR: 'BY', MDA: 'MD', ARM: 'AM', XKX: 'XK',
};
export function countryName(code) {
  const a2 = A3_TO_A2[String(code).toUpperCase()];
  if (a2 && regionNames) {
    try {
      return regionNames.of(a2);
    } catch {
      /* yok say */
    }
  }
  return code === 'ZZZ' ? 'Bilinmiyor' : String(code).toUpperCase();
}

/** ISO-3166 alpha-2 ülke kodu -> Türkçe ülke adı */
export function regionName(iso, fallback) {
  if (iso && regionNames) {
    try {
      return regionNames.of(String(iso).toUpperCase()) || fallback || iso;
    } catch {
      /* yok say */
    }
  }
  return fallback || iso || '—';
}

const languageNames = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['tr'], { type: 'language' }) : null;
/** "en" -> "İngilizce" */
export function languageName(code, fallback) {
  try {
    return languageNames?.of(code) || fallback || code;
  } catch {
    return fallback || code;
  }
}

export const DEVICE_LABELS ={ MOBILE: 'Mobil', DESKTOP: 'Masaüstü', TABLET: 'Tablet' };

export const DAY_OPTIONS = [
  { value: 7, label: 'Son 7 gün' },
  { value: 28, label: 'Son 28 gün' },
  { value: 90, label: 'Son 3 ay' },
  { value: 180, label: 'Son 6 ay' },
  { value: 365, label: 'Son 12 ay' },
];

/** Sadece http/https bağlantılarına izin ver (javascript: vb. şemalara karşı). */
export function safeHref(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : undefined;
  } catch {
    return undefined;
  }
}

export function shortUrl(url) {
  try {
    const u = new URL(url);
    return decodeURI(u.pathname + u.search) || '/';
  } catch {
    return url;
  }
}
