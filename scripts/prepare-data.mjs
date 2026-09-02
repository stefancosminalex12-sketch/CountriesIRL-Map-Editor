/**
 * Copies the vector geographic datasets into public/geo/ and derives a compact
 * country metadata table (ISO codes, names, region/subregion) from `world-countries`.
 *
 * Runs automatically before `npm run dev` / `npm run build`.
 * Keeping this as a build step (instead of importing the JSON) means datasets are
 * fetched lazily at runtime, which is what future historical datasets will need too.
 */
import { createRequire } from 'node:module'
import { mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import * as topojson from 'topojson-server'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(root, 'public/geo')

mkdirSync(outDir, { recursive: true })

/* ---------------------------------------------------------------- topojson */

const topologies = ['countries-110m.json', 'countries-50m.json', 'countries-10m.json']
for (const file of topologies) {
  const src = require.resolve(`world-atlas/${file}`)
  copyFileSync(src, resolve(outDir, file))
}

/* ------------------------------------------------------------------- lakes */

/**
 * Lakes are a separate geographic layer, vendored under data/natural-earth/ by
 * scripts/fetch-lakes.mjs. Copied rather than fetched so the build stays offline.
 */
for (const detail of ['10m', '50m']) {
  const src = resolve(root, `data/natural-earth/lakes-${detail}.geojson`)
  if (existsSync(src)) copyFileSync(src, resolve(outDir, `lakes-${detail}.geojson`))
  else console.warn(`[prepare-data] missing lakes-${detail}.geojson - run: node scripts/fetch-lakes.mjs`)
}

/* --------------------------------------------------------------- US states */

/**
 * The USA States map's geometry, built into TopoJSON here rather than vendored as one.
 *
 * Topology is not a storage detail for this app, it is a capability: shared arcs are
 * what `mesh` reads to find the boundaries between two states and nothing else, and
 * what `topojson.merge` dissolves when states are merged into one body. A plain
 * GeoJSON collection has neither, so a states map built from one would silently lose
 * internal borders and the Merge feature. Quantising to the same grid `world-atlas`
 * uses keeps the arc sharing exact.
 */
{
  const src = resolve(root, 'data/natural-earth/us-states.geojson')
  if (existsSync(src)) {
    const collection = JSON.parse(readFileSync(src, 'utf8'))
    const topology = topojson.topology({ states: collection }, 1e5)
    writeFileSync(resolve(outDir, 'us-states-10m.json'), JSON.stringify(topology))
    // The same envelope the country table uses, so one loader reads both. States are
    // identified by the feature id Natural Earth already carries, so the numeric and
    // name indexes a country needs are simply empty here rather than absent.
    writeFileSync(
      resolve(outDir, 'us-state-meta.json'),
      JSON.stringify({
        generatedAt: new Date().toISOString(),
        numericToId: {},
        nameToId: {},
        entities: JSON.parse(readFileSync(resolve(root, 'data/natural-earth/us-states-meta.json'), 'utf8')),
      }),
    )
    const arcs = topology.arcs.length
    console.log(
      `[prepare-data] ${collection.features.length} US states, ${arcs} arcs -> public/geo/us-states-10m.json`,
    )
  } else {
    console.warn('[prepare-data] missing us-states.geojson - run: node scripts/fetch-us-states.mjs')
  }
}

/* -------------------------------------------------------- country metadata */

const countries = require('world-countries/countries.json')

/**
 * Entities present in Natural Earth that have no ISO 3166-1 code.
 * They are matched by their Natural Earth `properties.name` and given a stable
 * user-assigned (ISO 3166 "X" range) identifier so they behave like any other country.
 */
const nonIsoEntities = [
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
]

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

for (const e of nonIsoEntities) {
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

writeFileSync(
  resolve(outDir, 'country-meta.json'),
  JSON.stringify({ generatedAt: new Date().toISOString(), numericToId, nameToId, entities: byId }),
)

const check = topologies.every((f) => existsSync(resolve(outDir, f)))
console.log(
  `[prepare-data] ${topologies.length} topologies ${check ? 'copied' : 'MISSING'}, ` +
    `${Object.keys(byId).length} countries indexed -> public/geo/`,
)
