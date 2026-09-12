/**
 * Builds the Modern Administrative World dataset from Natural Earth admin-1.
 *
 * A maintenance script, NOT part of the build: it reaches the network, so it is run by
 * hand when the source data needs to change. `npm run dev` / `npm run build` only ever
 * read the vendored result, so ordinary builds stay entirely offline — the same
 * arrangement `fetch-us-states.mjs` and `fetch-lakes.mjs` use.
 *
 *   node scripts/fetch-admin1.mjs            (reuses .cache/ne-admin1 when present)
 *   node scripts/fetch-admin1.mjs --refresh  (downloads the source again)
 *
 * Source: Natural Earth 10m admin-1 states and provinces
 * (`ne_10m_admin_1_states_provinces`), via github.com/nvkelso/natural-earth-vector.
 * Natural Earth is public domain — "Made with Natural Earth" — and commercially usable,
 * which is why it is used here and GADM, whose licence forbids commercial use, is not.
 *
 * **The geometry is Natural Earth's own, at the country map's detail.** It is built into
 * one topology on the same 1e5 quantisation grid `world-atlas` uses for the 10m country
 * map, and nothing is simplified away: thinning even by half a grid step removes dozens of
 * islets outright, and islands are exactly what this map must keep. As one topology, a
 * boundary two subdivisions share is a single arc — which is what the renderer reads to
 * draw borders, coasts and the national-border layer, and what Merge dissolves.
 *
 * **The identifiers are Natural Earth's.** `adm1_code` names every feature uniquely
 * (`FRA-2000`, `IND-20012`) and is the entity id, which also keeps it clear of the world
 * map's ISO 3166-1 ids and the states map's ISO 3166-2 ids. ISO 3166-2 is carried as
 * metadata rather than used as the key, because in this source 155 features share a code
 * with another.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as topojson from 'topojson-server'

const SOURCE =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson'

/** The quantisation `world-atlas` uses for its 10m countries, so the two maps agree. */
const QUANTIZATION = 1e5

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cacheFile = resolve(root, '.cache/ne-admin1/admin1.geojson')
const outDir = resolve(root, 'data/natural-earth')
mkdirSync(outDir, { recursive: true })

let collection
if (existsSync(cacheFile) && !process.argv.includes('--refresh')) {
  console.log(`[admin1] reading ${cacheFile}`)
  collection = JSON.parse(readFileSync(cacheFile, 'utf8'))
} else {
  console.log(`[admin1] fetching ${SOURCE}`)
  const response = await fetch(SOURCE)
  if (!response.ok) throw new Error(`Natural Earth admin-1 unavailable (${response.status})`)
  const text = await response.text()
  mkdirSync(dirname(cacheFile), { recursive: true })
  writeFileSync(cacheFile, text)
  collection = JSON.parse(text)
}

/** Natural Earth marks a missing code as `-99`, or leaves it empty. */
const known = (value) =>
  value !== null && value !== undefined && value !== '' && !String(value).includes('-99')

const round = (n) => (typeof n === 'number' ? Number(n.toFixed(4)) : null)

const features = []
/** Per subdivision, the source fields the entity table is built from — see prepare-data. */
const source = {}

for (const raw of collection.features) {
  const p = raw.properties
  if (!raw.geometry) continue
  const id = String(p.adm1_code)
  if (source[id]) throw new Error(`[admin1] duplicate adm1_code ${id}`)

  const name = known(p.name_en) ? p.name_en : p.name
  features.push({ type: 'Feature', id, properties: { name }, geometry: raw.geometry })
  source[id] = {
    name,
    // Natural Earth's own `name`, usually the local form: Xizang where English says Tibet.
    localName: known(p.name) ? p.name : name,
    kind: known(p.type_en) ? p.type_en : known(p.type) ? p.type : null,
    adm1Code: id,
    neId: typeof p.ne_id === 'number' ? p.ne_id : null,
    iso31662: known(p.iso_3166_2) ? p.iso_3166_2 : null,
    hasc: known(p.code_hasc) ? p.code_hasc : null,
    postal: known(p.postal) ? p.postal : null,
    wikidata: known(p.wikidataid) ? p.wikidataid : null,
    // The parent country, as Natural Earth names it: prepare-data resolves it against
    // the world map's own country table.
    country: p.admin,
    adm0: p.adm0_a3,
    iso2: known(p.iso_a2) ? p.iso_a2 : null,
    // Natural Earth's label point, which it places inside the subdivision.
    lat: round(p.latitude),
    lng: round(p.longitude),
  }
}

// Sorted by id, so the topology — and so the file — is byte-stable between runs.
features.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

const topology = topojson.topology(
  { provinces: { type: 'FeatureCollection', features } },
  QUANTIZATION,
)
writeFileSync(resolve(outDir, 'admin1-10m.json'), JSON.stringify(topology))
writeFileSync(resolve(outDir, 'admin1-source.json'), JSON.stringify(source))

const points = topology.arcs.reduce((sum, arc) => sum + arc.length, 0)
const countries = new Set(Object.values(source).map((s) => s.adm0)).size
console.log(
  `[admin1] ${features.length} subdivisions of ${countries} countries, ${topology.arcs.length} arcs, ` +
    `${points.toLocaleString()} points -> data/natural-earth/admin1-10m.json`,
)
