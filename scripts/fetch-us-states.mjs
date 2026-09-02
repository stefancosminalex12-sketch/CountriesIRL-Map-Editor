/**
 * Rebuilds the vendored US states dataset from Natural Earth.
 *
 * A maintenance script, NOT part of the build: it reaches the network, so it is run by
 * hand when the source data needs to change. `npm run dev` / `npm run build` only ever
 * read the vendored result, so ordinary builds stay entirely offline — the same
 * arrangement `fetch-lakes.mjs` uses.
 *
 *   node scripts/fetch-us-states.mjs
 *
 * Source: Natural Earth 10m admin-1 states and provinces, via
 * github.com/nvkelso/natural-earth-vector — public domain.
 *
 * The whole-world admin-1 file is 40 MB; the United States is 51 of its features. They
 * are filtered out here rather than at runtime so the app never downloads Bavaria to
 * draw Nevada.
 *
 * Natural Earth already carries the identifiers this map wants — `iso_3166_2` gives
 * `US-CA`, `postal` gives `CA` — so nothing is invented or hand-typed. The Census
 * region and division come along as `region` and `region_sub`, which is what lets the
 * region/subregion fields mean something real for a state rather than being padding.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SOURCE =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson'

/** Decimal places kept on coordinates: 4dp is ~11 m, far finer than any screen use. */
const COORD_PRECISION = 4

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(root, 'data/natural-earth')
mkdirSync(outDir, { recursive: true })

const round = (n) => Number(n.toFixed(COORD_PRECISION))

function roundCoords(coords) {
  if (typeof coords[0] === 'number') return [round(coords[0]), round(coords[1])]
  return coords.map(roundCoords)
}

/** Area-weighted centroid of a polygon ring set, for the entity's representative point. */
function representativePoint(geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  let bestArea = -Infinity
  let best = null
  for (const polygon of polygons) {
    const ring = polygon[0]
    if (!ring || ring.length < 4) continue
    let area = 0
    let cx = 0
    let cy = 0
    for (let i = 0, n = ring.length - 1; i < n; i++) {
      const [x0, y0] = ring[i]
      const [x1, y1] = ring[i + 1]
      const cross = x0 * y1 - x1 * y0
      area += cross
      cx += (x0 + x1) * cross
      cy += (y0 + y1) * cross
    }
    area /= 2
    if (Math.abs(area) < 1e-12) continue
    // Largest ring wins: a state's representative point belongs on its mainland, not
    // averaged out to sea across its islands.
    if (Math.abs(area) > bestArea) {
      bestArea = Math.abs(area)
      best = [cx / (6 * area), cy / (6 * area)]
    }
  }
  return best
}

console.log(`[us-states] fetching ${SOURCE}`)
const response = await fetch(SOURCE)
if (!response.ok) throw new Error(`Natural Earth admin-1 unavailable (${response.status})`)
const collection = await response.json()

const features = []
const meta = {}

for (const raw of collection.features) {
  if (raw.properties?.adm0_a3 !== 'USA') continue
  const p = raw.properties
  const id = String(p.iso_3166_2 || `US-${p.postal}`)
  const point = representativePoint(raw.geometry) ?? [0, 0]

  features.push({
    type: 'Feature',
    id,
    properties: { id, name: p.name, code: p.postal },
    geometry: { type: raw.geometry.type, coordinates: roundCoords(raw.geometry.coordinates) },
  })

  meta[id] = {
    id,
    /*
     * `iso2` is the ISO 3166-1 alpha-2 code of a *country*, and a state does not have
     * one. Null rather than a stand-in, because that field is what the flag library is
     * keyed on and inventing a value there would ask it for artwork that cannot exist.
     * The state's own identifier lives in `code`.
     */
    iso2: null,
    code: p.postal,
    numeric: null,
    name: p.name,
    officialName: p.name,
    // The US Census regions and divisions, which is what "region" and "subregion"
    // honestly mean for a state.
    region: p.region || 'United States',
    subregion: p.region_sub || p.region || 'United States',
    independent: false,
    lat: round(point[1]),
    lng: round(point[0]),
  }
}

features.sort((a, b) => a.properties.name.localeCompare(b.properties.name))

writeFileSync(
  resolve(outDir, 'us-states.geojson'),
  JSON.stringify({ type: 'FeatureCollection', features }),
)
writeFileSync(resolve(outDir, 'us-states-meta.json'), JSON.stringify(meta))

let vertices = 0
for (const f of features) {
  const polygons =
    f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
  for (const polygon of polygons) for (const ring of polygon) vertices += ring.length
}

console.log(
  `[us-states] ${features.length} entities, ${vertices.toLocaleString()} vertices ` +
    `-> data/natural-earth/us-states.geojson`,
)
