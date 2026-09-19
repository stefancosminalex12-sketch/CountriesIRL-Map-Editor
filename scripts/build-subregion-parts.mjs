/**
 * The real extent of every state, province and region a subregion preset names by its
 * ISO 3166-2 code (see `src/geo/subregions.ts`), written to `src/geo/subregionParts.json`.
 *
 * Source: Natural Earth 1:10m admin-1 states and provinces (public domain), the file the
 * administrative build already downloads to `.cache/ne-admin1/admin1.geojson`.
 *
 * Output: `{ "US-ME": [west, south, east, north], … }` in degrees, rounded outwards to
 * 0.01°. A unit across the antimeridian (Chukotka, Alaska's Aleutians) is measured in
 * whichever longitude frame is narrower, so its `east` may exceed 180, the convention
 * the region framing already uses.
 *
 * Italy and France are named by their ISO 3166-2 *regions* (IT-57 Marche, FR-OCC
 * Occitanie), which Natural Earth splits into provinces and departments: those are
 * gathered up by the region Natural Earth records for each.
 *
 * Usage: node scripts/build-subregion-parts.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'

/** The countries whose units the presets name. Add one here when a preset names its units. */
const COUNTRIES = ['USA', 'CAN', 'MEX', 'GTM', 'BRA', 'ARG', 'CHL', 'RUS', 'CHN', 'TUR', 'PNG', 'IDN', 'ITA', 'FRA']

const IT_REGIONS = {
  Piemonte: 'IT-21', "Valle d'Aosta": 'IT-23', Lombardia: 'IT-25', 'Trentino-Alto Adige': 'IT-32',
  Veneto: 'IT-34', 'Friuli-Venezia Giulia': 'IT-36', Liguria: 'IT-42', 'Emilia-Romagna': 'IT-45',
  Toscana: 'IT-52', Umbria: 'IT-55', Marche: 'IT-57', Lazio: 'IT-62', Abruzzo: 'IT-65',
  Molise: 'IT-67', Campania: 'IT-72', Apulia: 'IT-75', Basilicata: 'IT-77', Calabria: 'IT-78',
  Sicily: 'IT-82', Sardegna: 'IT-88',
}
const FR_REGIONS = {
  'Auvergne-Rhône-Alpes': 'FR-ARA', 'Bourgogne-Franche-Comté': 'FR-BFC', Bretagne: 'FR-BRE',
  'Centre-Val de Loire': 'FR-CVL', Corse: 'FR-20R', 'Grand Est': 'FR-GES', 'Hauts-de-France': 'FR-HDF',
  'Île-de-France': 'FR-IDF', Normandie: 'FR-NOR', 'Nouvelle-Aquitaine': 'FR-NAQ', Occitanie: 'FR-OCC',
  'Pays de la Loire': 'FR-PDL', "Provence-Alpes-Côte-d'Azur": 'FR-PAC',
}

const source = JSON.parse(readFileSync('.cache/ne-admin1/admin1.geojson', 'utf8'))

/** code -> list of polygons' vertices */
const units = new Map()
for (const feature of source.features) {
  const p = feature.properties
  if (!COUNTRIES.includes(p.adm0_a3) || !feature.geometry) continue
  let code = p.iso_3166_2
  if (p.adm0_a3 === 'ITA') code = IT_REGIONS[p.region]
  if (p.adm0_a3 === 'FRA') code = FR_REGIONS[p.region]
  if (!code || code.includes('~')) continue
  const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates
  if (!units.has(code)) units.set(code, [])
  for (const polygon of polygons) units.get(code).push(...polygon[0])
}

/** Extent in the [-180, 180] frame or the [0, 360] frame, whichever is narrower. */
function extent(points) {
  const measure = (shift) => {
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
    for (const [lon, lat] of points) {
      const x = shift && lon < 0 ? lon + 360 : lon
      if (x < w) w = x
      if (x > e) e = x
      if (lat < s) s = lat
      if (lat > n) n = lat
    }
    return [w, s, e, n]
  }
  const plain = measure(false)
  const shifted = measure(true)
  const box = shifted[2] - shifted[0] < plain[2] - plain[0] - 1e-9 ? shifted : plain
  const down = (v) => Math.floor(v * 100) / 100
  const up = (v) => Math.ceil(v * 100) / 100
  return [down(box[0]), down(box[1]), up(box[2]), up(box[3])]
}

const out = {}
for (const code of [...units.keys()].sort()) out[code] = extent(units.get(code))

for (const [name, table] of [['Italian', IT_REGIONS], ['French', FR_REGIONS]]) {
  for (const code of Object.values(table)) if (!out[code]) throw new Error(`${name} region ${code} has no units`)
}

writeFileSync('src/geo/subregionParts.json', JSON.stringify(out) + '\n')
console.log(`${Object.keys(out).length} units written to src/geo/subregionParts.json`)
