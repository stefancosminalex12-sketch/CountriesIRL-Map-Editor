/**
 * The world map's entity table, and how Natural Earth's own codes resolve into it.
 *
 * One module, because two build steps need exactly the same answers: `prepare-data.mjs`
 * writes the table the app reads, and `build-geography.mjs` stamps the curated geometry
 * with the ids in it. If they worked the country out separately they could disagree, and
 * a country whose geometry and whose entity disagree about its id is simply not drawn.
 *
 * Ids are ISO 3166-1 alpha-3, from `world-countries`, plus the user-assigned `X` range for
 * the places Natural Earth draws that ISO does not name.
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/**
 * Entities present in Natural Earth that have no ISO 3166-1 code.
 * They are matched by their Natural Earth `NAME` and given a stable user-assigned
 * (ISO 3166 "X" range) identifier so they behave like any other country.
 */
export const NON_ISO_ENTITIES = [
  { id: 'XKX', name: 'Kosovo',              neNames: ['Kosovo'],             iso2: 'XK', region: 'Europe',   subregion: 'Southeast Europe', latlng: [42.6, 20.9] },
  { id: 'XNC', name: 'Northern Cyprus',     neNames: ['N. Cyprus'],          iso2: 'XN', region: 'Asia',     subregion: 'Western Asia',     latlng: [35.2, 33.6] },
  { id: 'XSO', name: 'Somaliland',          neNames: ['Somaliland'],         iso2: 'XS', region: 'Africa',   subregion: 'Eastern Africa',   latlng: [9.6, 46.2] },
  { id: 'XIO', name: 'Indian Ocean Ter.',   neNames: ['Indian Ocean Ter.'],  iso2: 'XI', region: 'Oceania',  subregion: 'Australia and New Zealand', latlng: [-12.4, 96.9] },
  { id: 'XSI', name: 'Siachen Glacier',     neNames: ['Siachen Glacier'],    iso2: 'XG', region: 'Asia',     subregion: 'Southern Asia',    latlng: [35.4, 77.1] },
  // Present from the 10m dataset onwards.
  { id: 'XAK', name: 'Akrotiri',            neNames: ['Akrotiri'],           iso2: 'XA', region: 'Asia',     subregion: 'Western Asia',     latlng: [34.6, 32.9] },
  { id: 'XDH', name: 'Dhekelia',            neNames: ['Dhekelia'],           iso2: 'XD', region: 'Asia',     subregion: 'Western Asia',     latlng: [34.98, 33.75] },
  { id: 'XCB', name: 'Cyprus U.N. Buffer Zone', neNames: ['Cyprus U.N. Buffer Zone'], iso2: 'XB', region: 'Asia', subregion: 'Western Asia', latlng: [35.1, 33.4] },
  { id: 'XGB', name: 'Guantanamo Bay',      neNames: ['USNB Guantanamo Bay'], iso2: 'XU', region: 'Americas', subregion: 'Caribbean',       latlng: [19.9, -75.15] },
  { id: 'XBK', name: 'Baikonur',            neNames: ['Baikonur'],           iso2: 'XR', region: 'Asia',     subregion: 'Central Asia',     latlng: [45.7, 63.3] },
  { id: 'XCS', name: 'Coral Sea Is.',       neNames: ['Coral Sea Is.'],      iso2: 'XC', region: 'Oceania',  subregion: 'Australia and New Zealand', latlng: [-18.0, 152.0] },
  { id: 'XSP', name: 'Spratly Is.',         neNames: ['Spratly Is.'],        iso2: 'XY', region: 'Asia',     subregion: 'South-Eastern Asia', latlng: [9.7, 114.0] },
  { id: 'XCP', name: 'Clipperton I.',       neNames: ['Clipperton I.'],      iso2: 'XP', region: 'Americas', subregion: 'North America',    latlng: [10.3, -109.2] },
  { id: 'XBN', name: 'Bajo Nuevo Bank',     neNames: ['Bajo Nuevo Bank'],    iso2: 'XJ', region: 'Americas', subregion: 'Caribbean',        latlng: [15.85, -78.65] },
  { id: 'XSN', name: 'Serranilla Bank',     neNames: ['Serranilla Bank'],    iso2: 'XL', region: 'Americas', subregion: 'Caribbean',        latlng: [15.85, -79.85] },
  { id: 'XSR', name: 'Scarborough Reef',    neNames: ['Scarborough Reef'],   iso2: 'XW', region: 'Asia',     subregion: 'South-Eastern Asia', latlng: [15.15, 117.76] },
  /*
   * Drawn as their own units by current Natural Earth. Without an id here they would be
   * dropped at load — and a dropped piece of land is a hole in the map that reads as water.
   */
  { id: 'XBT', name: 'Bir Tawil',           neNames: ['Bir Tawil'],          iso2: 'XT', region: 'Africa',   subregion: 'Northern Africa',  latlng: [21.9, 33.7] },
  { id: 'XPI', name: 'Southern Patagonian Ice Field', neNames: ['Southern Patagonian Ice Field'], iso2: 'XF', region: 'Americas', subregion: 'South America', latlng: [-49.5, -73.3] },
]

/**
 * Natural Earth's own adm0 codes where they differ from the table's id for the same
 * place — its user-assigned codes for the non-ISO entities above, and the handful of
 * countries it codes differently from ISO.
 */
export const NATURAL_EARTH_ADM0 = {
  KOS: 'XKX', SOL: 'XSO', CYN: 'XNC', CNM: 'XCB', KAB: 'XBK', KAS: 'XSI', WSB: 'XAK',
  ESB: 'XDH', USG: 'XGB', IOA: 'XIO', CSI: 'XCS', PGA: 'XSP', CLP: 'XCP', BJN: 'XBN',
  SER: 'XSN', SCR: 'XSR', SDS: 'SSD', PSX: 'PSE', SAH: 'ESH', ALD: 'ALA', BRT: 'XBT',
  SPI: 'XPI',
}

/** The entity table, and the two indexes the runtime keeps for datasets that need them. */
export function buildCountryTable() {
  const countries = require('world-countries/countries.json')
  /** @type {Record<string, object>} keyed by ISO 3166-1 alpha-3 (or user-assigned) */
  const byId = {}
  /** @type {Record<string, string>} ISO 3166-1 numeric -> alpha-3 */
  const numericToId = {}
  /** @type {Record<string, string>} Natural Earth name -> alpha-3, for entities without a numeric id */
  const nameToId = {}

  for (const c of countries) {
    byId[c.cca3] = {
      id: c.cca3,
      iso2: c.cca2,
      // The entity's own short code. For a country it coincides with its alpha-2; the
      // field exists because for a state or a province it does not.
      code: c.cca2,
      numeric: c.ccn3,
      name: c.name.common,
      officialName: c.name.official,
      region: c.region,
      subregion: c.subregion || c.region,
      independent: c.independent === true,
      lat: c.latlng[0],
      lng: c.latlng[1],
    }
    if (c.ccn3) numericToId[c.ccn3] = c.cca3
  }

  for (const e of NON_ISO_ENTITIES) {
    byId[e.id] = {
      id: e.id,
      iso2: e.iso2,
      code: e.iso2,
      numeric: null,
      name: e.name,
      officialName: e.name,
      region: e.region,
      subregion: e.subregion,
      independent: false,
      lat: e.latlng[0],
      lng: e.latlng[1],
    }
    for (const n of e.neNames) nameToId[n] = e.id
  }

  return { byId, numericToId, nameToId }
}

/** Natural Earth marks a missing code as `-99`, or leaves it empty. */
const known = (value) =>
  value !== null && value !== undefined && value !== '' && !String(value).includes('-99')

/**
 * The entity a Natural Earth admin-0 feature is, or `null`.
 *
 * Natural Earth's own adm0 alias first, then its codes that are ISO, then the numeric
 * code, then the name. A unit Natural Earth draws separately but ISO folds into a
 * country — Ashmore and Cartier into Australia, the Brazilian Island into Brazil —
 * resolves to that country through its "EH" code, and joins its geometry.
 */
export function resolveAdmin0(props, table) {
  const alias = NATURAL_EARTH_ADM0[props.ADM0_A3]
  if (alias) return alias
  for (const code of [props.ADM0_A3, props.ISO_A3, props.ISO_A3_EH]) {
    if (known(code) && table.byId[code]) return code
  }
  for (const numeric of [props.ISO_N3, props.ISO_N3_EH]) {
    if (known(numeric) && table.numericToId[numeric]) return table.numericToId[numeric]
  }
  return table.nameToId[props.NAME] ?? null
}

/** The country an admin-1 subdivision belongs to, by the table's id, or `null`. */
export function resolveParent(adm0, iso2, table, idByIso2) {
  return NATURAL_EARTH_ADM0[adm0] ?? (table.byId[adm0] ? adm0 : (iso2 && idByIso2.get(iso2)) || null)
}
