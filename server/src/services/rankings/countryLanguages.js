/**
 * Ülke (Search Console'un ISO 3166-1 alpha-3 kodu) -> [alpha-2, yaygın konuşulan diller (ISO 639-1)].
 * Bir sitenin dili hangi ülkelerde konuşuluyorsa o ülkeler "hedef pazar" sayılır.
 */
const MAP = {
  // İngilizce
  USA: ['US', ['en', 'es']], GBR: ['GB', ['en']], CAN: ['CA', ['en', 'fr']], AUS: ['AU', ['en']], NZL: ['NZ', ['en']],
  IRL: ['IE', ['en', 'ga']], ZAF: ['ZA', ['en', 'af', 'zu']], IND: ['IN', ['hi', 'en']], SGP: ['SG', ['en', 'zh', 'ms', 'ta']],
  PHL: ['PH', ['en', 'tl']], NGA: ['NG', ['en']], KEN: ['KE', ['en', 'sw']], GHA: ['GH', ['en']], PAK: ['PK', ['ur', 'en']],
  MYS: ['MY', ['ms', 'en', 'zh']], MLT: ['MT', ['mt', 'en']], JAM: ['JM', ['en']], TTO: ['TT', ['en']], UGA: ['UG', ['en', 'sw']],
  TZA: ['TZ', ['sw', 'en']], ZMB: ['ZM', ['en']], ZWE: ['ZW', ['en']], BWA: ['BW', ['en']], NAM: ['NA', ['en', 'af']],
  RWA: ['RW', ['rw', 'en', 'fr']], ETH: ['ET', ['am', 'en']], LKA: ['LK', ['si', 'ta', 'en']], BGD: ['BD', ['bn', 'en']],
  HKG: ['HK', ['zh', 'en']], BHS: ['BS', ['en']], BRB: ['BB', ['en']], CYP: ['CY', ['el', 'tr', 'en']], ARE: ['AE', ['ar', 'en']],
  // Türkçe ve Türk dilleri
  TUR: ['TR', ['tr', 'ku']], AZE: ['AZ', ['az', 'ru']], KAZ: ['KZ', ['kk', 'ru']], UZB: ['UZ', ['uz', 'ru']], TKM: ['TM', ['tk', 'ru']],
  KGZ: ['KG', ['ky', 'ru']],
  // Almanca
  DEU: ['DE', ['de']], AUT: ['AT', ['de']], CHE: ['CH', ['de', 'fr', 'it']], LIE: ['LI', ['de']], LUX: ['LU', ['lb', 'fr', 'de']],
  // Fransızca
  FRA: ['FR', ['fr']], BEL: ['BE', ['nl', 'fr', 'de']], MCO: ['MC', ['fr']], SEN: ['SN', ['fr']], CIV: ['CI', ['fr']],
  CMR: ['CM', ['fr', 'en']], MAR: ['MA', ['ar', 'fr']], DZA: ['DZ', ['ar', 'fr']], TUN: ['TN', ['ar', 'fr']], MDG: ['MG', ['mg', 'fr']],
  COD: ['CD', ['fr']], HTI: ['HT', ['fr', 'ht']], MLI: ['ML', ['fr']], BFA: ['BF', ['fr']], NER: ['NE', ['fr']], BEN: ['BJ', ['fr']],
  TGO: ['TG', ['fr']], GAB: ['GA', ['fr']], COG: ['CG', ['fr']], GIN: ['GN', ['fr']],
  // İspanyolca
  ESP: ['ES', ['es', 'ca']], MEX: ['MX', ['es']], ARG: ['AR', ['es']], COL: ['CO', ['es']], CHL: ['CL', ['es']], PER: ['PE', ['es']],
  VEN: ['VE', ['es']], ECU: ['EC', ['es']], GTM: ['GT', ['es']], CUB: ['CU', ['es']], BOL: ['BO', ['es']], DOM: ['DO', ['es']],
  HND: ['HN', ['es']], PRY: ['PY', ['es', 'gn']], SLV: ['SV', ['es']], NIC: ['NI', ['es']], CRI: ['CR', ['es']], PAN: ['PA', ['es']],
  URY: ['UY', ['es']], PRI: ['PR', ['es', 'en']],
  // Portekizce
  PRT: ['PT', ['pt']], BRA: ['BR', ['pt']], AGO: ['AO', ['pt']], MOZ: ['MZ', ['pt']],
  // Arapça
  SAU: ['SA', ['ar']], EGY: ['EG', ['ar']], IRQ: ['IQ', ['ar', 'ku']], JOR: ['JO', ['ar']], KWT: ['KW', ['ar']], QAT: ['QA', ['ar']],
  BHR: ['BH', ['ar']], OMN: ['OM', ['ar']], LBN: ['LB', ['ar', 'fr']], SYR: ['SY', ['ar']], YEM: ['YE', ['ar']], LBY: ['LY', ['ar']],
  SDN: ['SD', ['ar', 'en']], PSE: ['PS', ['ar']], MRT: ['MR', ['ar']],
  // Diğer Avrupa
  ITA: ['IT', ['it']], SMR: ['SM', ['it']], NLD: ['NL', ['nl']], SWE: ['SE', ['sv']], NOR: ['NO', ['no', 'nb', 'nn']], DNK: ['DK', ['da']],
  FIN: ['FI', ['fi', 'sv']], ISL: ['IS', ['is']], POL: ['PL', ['pl']], CZE: ['CZ', ['cs']], SVK: ['SK', ['sk']], HUN: ['HU', ['hu']],
  ROU: ['RO', ['ro']], MDA: ['MD', ['ro', 'ru']], BGR: ['BG', ['bg']], GRC: ['GR', ['el']], SRB: ['RS', ['sr']], HRV: ['HR', ['hr']],
  BIH: ['BA', ['bs', 'hr', 'sr']], MNE: ['ME', ['sr']], SVN: ['SI', ['sl']], MKD: ['MK', ['mk', 'sq']], ALB: ['AL', ['sq']],
  XKX: ['XK', ['sq', 'sr']], LTU: ['LT', ['lt']], LVA: ['LV', ['lv', 'ru']], EST: ['EE', ['et', 'ru']], UKR: ['UA', ['uk', 'ru']],
  BLR: ['BY', ['be', 'ru']], RUS: ['RU', ['ru']], GEO: ['GE', ['ka']], ARM: ['AM', ['hy']], AND: ['AD', ['ca']],
  // Asya
  CHN: ['CN', ['zh']], TWN: ['TW', ['zh']], MAC: ['MO', ['zh', 'pt']], JPN: ['JP', ['ja']], KOR: ['KR', ['ko']], IDN: ['ID', ['id']],
  VNM: ['VN', ['vi']], THA: ['TH', ['th']], KHM: ['KH', ['km']], LAO: ['LA', ['lo']], MMR: ['MM', ['my']], NPL: ['NP', ['ne']],
  IRN: ['IR', ['fa']], AFG: ['AF', ['fa', 'ps']], TJK: ['TJ', ['tg', 'ru']], ISR: ['IL', ['he', 'ar']], MNG: ['MN', ['mn']],
  BRN: ['BN', ['ms']],
};

export const countryIso2 = (a3) => MAP[String(a3).toUpperCase()]?.[0] || null;
export const countryLanguages = (a3) => MAP[String(a3).toUpperCase()]?.[1] || [];

/** Verilen dillerden en az biri konuşulan ülkeler (alpha-3). */
export function countriesForLanguages(languages) {
  const set = new Set(languages.map((l) => String(l).toLowerCase().split('-')[0]));
  return Object.keys(MAP).filter((a3) => MAP[a3][1].some((l) => set.has(l)));
}

// Search Console'un döndürdüğü tüm ülkeler için ISO 3166-1 alpha-3 -> alpha-2
const ISO3 = `AFG:AF ALA:AX ALB:AL DZA:DZ ASM:AS AND:AD AGO:AO AIA:AI ATA:AQ ATG:AG ARG:AR ARM:AM ABW:AW AUS:AU AUT:AT AZE:AZ
BHS:BS BHR:BH BGD:BD BRB:BB BLR:BY BEL:BE BLZ:BZ BEN:BJ BMU:BM BTN:BT BOL:BO BES:BQ BIH:BA BWA:BW BVT:BV BRA:BR IOT:IO
BRN:BN BGR:BG BFA:BF BDI:BI CPV:CV KHM:KH CMR:CM CAN:CA CYM:KY CAF:CF TCD:TD CHL:CL CHN:CN CXR:CX CCK:CC COL:CO COM:KM
COG:CG COD:CD COK:CK CRI:CR CIV:CI HRV:HR CUB:CU CUW:CW CYP:CY CZE:CZ DNK:DK DJI:DJ DMA:DM DOM:DO ECU:EC EGY:EG SLV:SV
GNQ:GQ ERI:ER EST:EE SWZ:SZ ETH:ET FLK:FK FRO:FO FJI:FJ FIN:FI FRA:FR GUF:GF PYF:PF ATF:TF GAB:GA GMB:GM GEO:GE DEU:DE
GHA:GH GIB:GI GRC:GR GRL:GL GRD:GD GLP:GP GUM:GU GTM:GT GGY:GG GIN:GN GNB:GW GUY:GY HTI:HT HMD:HM VAT:VA HND:HN HKG:HK
HUN:HU ISL:IS IND:IN IDN:ID IRN:IR IRQ:IQ IRL:IE IMN:IM ISR:IL ITA:IT JAM:JM JPN:JP JEY:JE JOR:JO KAZ:KZ KEN:KE KIR:KI
PRK:KP KOR:KR KWT:KW KGZ:KG LAO:LA LVA:LV LBN:LB LSO:LS LBR:LR LBY:LY LIE:LI LTU:LT LUX:LU MAC:MO MDG:MG MWI:MW MYS:MY
MDV:MV MLI:ML MLT:MT MHL:MH MTQ:MQ MRT:MR MUS:MU MYT:YT MEX:MX FSM:FM MDA:MD MCO:MC MNG:MN MNE:ME MSR:MS MAR:MA MOZ:MZ
MMR:MM NAM:NA NRU:NR NPL:NP NLD:NL NCL:NC NZL:NZ NIC:NI NER:NE NGA:NG NIU:NU NFK:NF MKD:MK MNP:MP NOR:NO OMN:OM PAK:PK
PLW:PW PSE:PS PAN:PA PNG:PG PRY:PY PER:PE PHL:PH PCN:PN POL:PL PRT:PT PRI:PR QAT:QA REU:RE ROU:RO RUS:RU RWA:RW BLM:BL
SHN:SH KNA:KN LCA:LC MAF:MF SPM:PM VCT:VC WSM:WS SMR:SM STP:ST SAU:SA SEN:SN SRB:RS SYC:SC SLE:SL SGP:SG SXM:SX SVK:SK
SVN:SI SLB:SB SOM:SO ZAF:ZA SGS:GS SSD:SS ESP:ES LKA:LK SDN:SD SUR:SR SJM:SJ SWE:SE CHE:CH SYR:SY TWN:TW TJK:TJ TZA:TZ
THA:TH TLS:TL TGO:TG TKL:TK TON:TO TTO:TT TUN:TN TUR:TR TKM:TM TCA:TC TUV:TV UGA:UG UKR:UA ARE:AE GBR:GB USA:US UMI:UM
URY:UY UZB:UZ VUT:VU VEN:VE VNM:VN VGB:VG VIR:VI WLF:WF ESH:EH YEM:YE ZMB:ZM ZWE:ZW XKX:XK`;
const ISO3_MAP = Object.fromEntries(ISO3.split(/\s+/).filter(Boolean).map((p) => p.split(':')));

/** Tüm ülkeler için alpha-2 (ZZZ = bilinmeyen -> null). */
export const anyIso2 = (a3) => ISO3_MAP[String(a3).toUpperCase()] || null;
