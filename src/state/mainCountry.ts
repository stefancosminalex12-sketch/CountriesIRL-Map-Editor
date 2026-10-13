/**
 * The main country: what a "Was your country richer than Romania?" map is about.
 *
 * Every other country with a number answers the question under its sticker, Yes or No, in its
 * own language and in the Latin alphabet — Oui, Da, Tak, Evet — so the map reads the way the
 * videos it is made for do. Yes means its number is *better* than the main country's: higher, or
 * lower when the layer says lower is better (`ColorScale.lowerIsBetter`). A tie is No.
 *
 * The words are by country (`LANGUAGE_OF`), the country's main language; a region of an
 * administrative map answers in its country's. Anything not listed answers in English.
 */
import type { CountryId, MapDocument } from '../types/map'

/** Yes and No, by language. Romanised where the language has another script. */
const WORDS: Record<string, [yes: string, no: string]> = {
  en: ['Yes', 'No'], fr: ['Oui', 'Non'], es: ['Sí', 'No'], pt: ['Sim', 'Não'], it: ['Sì', 'No'],
  de: ['Ja', 'Nein'], nl: ['Ja', 'Nee'], lb: ['Jo', 'Nee'], ro: ['Da', 'Nu'], ru: ['Da', 'Net'],
  uk: ['Tak', 'Ni'], be: ['Tak', 'Nie'], pl: ['Tak', 'Nie'], cs: ['Ano', 'Ne'], sk: ['Áno', 'Nie'],
  hu: ['Igen', 'Nem'], bg: ['Da', 'Ne'], sh: ['Da', 'Ne'], mk: ['Da', 'Ne'], sl: ['Da', 'Ne'],
  sq: ['Po', 'Jo'], el: ['Nai', 'Ochi'], tr: ['Evet', 'Hayır'], sv: ['Ja', 'Nej'], no: ['Ja', 'Nei'],
  da: ['Ja', 'Nej'], fo: ['Ja', 'Nei'], is: ['Já', 'Nei'], fi: ['Kyllä', 'Ei'], et: ['Jah', 'Ei'],
  lv: ['Jā', 'Nē'], lt: ['Taip', 'Ne'], mt: ['Iva', 'Le'], ca: ['Sí', 'No'], kl: ['Aap', 'Naagga'],
  ka: ['Ki', 'Ara'], hy: ['Ayo', 'Voch'], az: ['Bəli', 'Xeyr'], kk: ['Iä', 'Joq'], uz: ['Ha', 'Yoʻq'],
  ky: ['Ooba', 'Jok'], tg: ['Ha', 'Ne'], tk: ['Hawa', 'Ýok'], mn: ['Tiim', 'Ügüi'], ar: ['Naam', 'La'],
  he: ['Ken', 'Lo'], fa: ['Bale', 'Na'], hi: ['Haan', 'Nahin'], bn: ['Hyan', 'Na'], ne: ['Ho', 'Hoina'],
  si: ['Ow', 'Naha'], dz: ['Ing', 'Men'], dv: ['Aan', 'Noon'], my: ['Hoat', 'Mahoat'], th: ['Chai', 'Mai'],
  lo: ['Maen', 'Bo'], km: ['Baat', 'Te'], vi: ['Có', 'Không'], ms: ['Ya', 'Tidak'], tl: ['Oo', 'Hindi'],
  zh: ['Shì', 'Bù'], yue: ['Hai', 'M-hai'], ja: ['Hai', 'Iie'], ko: ['Ne', 'Aniyo'], kp: ['Ye', 'Aniyo'],
  tet: ['Sin', 'Lae'], sw: ['Ndiyo', 'Hapana'], am: ['Awo', 'Aydelem'], so: ['Haa', 'Maya'],
  ti: ['Ewe', 'Aykonen'], mg: ['Eny', 'Tsia'], rw: ['Yego', 'Oya'], rn: ['Ego', 'Oya'], ht: ['Wi', 'Non'],
  sm: ['Ioe', 'Leai'], to: ['Io', 'Ikai'],
}

/** Each language's countries, by ISO 3166 alpha-3 (and the dataset's own codes for the rest). */
const COUNTRIES: Record<string, string> = {
  fr: 'FRA MCO SEN MLI BFA NER TCD GIN CIV TGO BEN CMR GAB COG COD CAF DJI COM NCL PYF GUF GLP MTQ REU MYT SPM WLF BLM MAF ATF',
  es: 'ESP MEX GTM HND SLV NIC CRI PAN CUB DOM PRI COL VEN ECU PER BOL CHL ARG URY PRY GNQ',
  pt: 'PRT BRA AGO MOZ GNB CPV STP',
  it: 'ITA SMR VAT',
  de: 'DEU AUT CHE LIE',
  nl: 'NLD BEL SUR ABW CUW SXM BES',
  lb: 'LUX', ro: 'ROU MDA', ru: 'RUS', uk: 'UKR', be: 'BLR', pl: 'POL', cs: 'CZE', sk: 'SVK',
  hu: 'HUN', bg: 'BGR', sh: 'SRB HRV BIH MNE', mk: 'MKD', sl: 'SVN', sq: 'ALB XKX KOS',
  el: 'GRC CYP', tr: 'TUR CYN', sv: 'SWE ALA', no: 'NOR SJM', da: 'DNK', fo: 'FRO', is: 'ISL',
  fi: 'FIN', et: 'EST', lv: 'LVA', lt: 'LTU', mt: 'MLT', ca: 'AND', kl: 'GRL',
  ka: 'GEO', hy: 'ARM', az: 'AZE', kk: 'KAZ', uz: 'UZB', ky: 'KGZ', tg: 'TJK', tk: 'TKM', mn: 'MNG',
  ar: 'SAU ARE QAT BHR KWT OMN YEM IRQ SYR JOR LBN PSE EGY LBY TUN DZA MAR ESH MRT SDN',
  he: 'ISR', fa: 'IRN AFG', hi: 'IND PAK', bn: 'BGD', ne: 'NPL', si: 'LKA', dz: 'BTN', dv: 'MDV',
  my: 'MMR', th: 'THA', lo: 'LAO', km: 'KHM', vi: 'VNM', ms: 'MYS BRN IDN', tl: 'PHL',
  zh: 'CHN TWN', yue: 'HKG MAC', ja: 'JPN', ko: 'KOR', kp: 'PRK', tet: 'TLS',
  sw: 'TZA KEN', am: 'ETH', so: 'SOM SOL', ti: 'ERI', mg: 'MDG', rw: 'RWA', rn: 'BDI', ht: 'HTI',
  sm: 'WSM ASM', to: 'TON',
}

const LANGUAGE_OF = new Map<string, string>()
for (const [language, codes] of Object.entries(COUNTRIES)) for (const code of codes.split(' ')) LANGUAGE_OF.set(code, language)

/** Yes or No in an entity's language: its own, or its country's for a region. */
export function answerWord(yes: boolean, entityId: string, parentId?: string | null): string {
  const language = LANGUAGE_OF.get(entityId) ?? (parentId ? LANGUAGE_OF.get(parentId) : undefined) ?? 'en'
  return WORDS[language][yes ? 0 : 1]
}

/** The least and most the main country's flag is toned down to, and the default: as drawn. */
export const FLAG_CONTRAST = { min: 0.2, max: 1, step: 0.05, default: 1 }

/**
 * Every entity's answer — true for Yes — under the active layer, or an empty map when there is
 * no main country or it has no number to compare with.
 */
export function mainCountryAnswers(doc: MapDocument): Map<CountryId, boolean> {
  const out = new Map<CountryId, boolean>()
  const mainId = doc.mainCountryId
  if (!mainId) return out
  const layer = doc.layers.find((l) => l.id === doc.activeLayerId) ?? doc.layers[0]
  if (!layer) return out
  const main = doc.countries[mainId]?.properties[layer.dataKey]
  if (typeof main !== 'number' || !Number.isFinite(main)) return out
  const lowerIsBetter = !!layer.colorScale.lowerIsBetter
  for (const [id, entry] of Object.entries(doc.countries)) {
    if (id === mainId) continue
    const value = entry.properties[layer.dataKey]
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    out.set(id, lowerIsBetter ? value < main : value > main)
  }
  return out
}
