/**
 * Builds the Europe Countries and USA States maps at 110m, 50m, 25m and 10m — the World map's four
 * details — from each map's own finest data.
 *
 * A maintenance script, NOT part of the build, like `build-25m.mjs`: it reads committed data and
 * writes its results beside it, committed too. `npm run dev` / `npm run build` only copy them.
 *
 *   npm run build-levels
 *
 * **Matched to the World map, by weight.** Each level is simplified until it draws its continent
 * with about as many points as the World map's detail of the same name draws it (counted inside a
 * box round Europe and round the contiguous United States), so switching maps at one detail never
 * changes how heavy or how jagged the lines look. The tolerances below were found that way:
 *
 *   Europe, points inside [-25, 34, 45, 72]   World     Europe Countries   lakes: World / Europe
 *     110m                                     1,215        1,914           (50m's)
 *     50m                                     11,849        9,028           3,546 /  2,933
 *     25m                                     35,512       35,073          17,547 / 18,881
 *     10m                                     86,357       82,614          41,102 / 35,676
 *   USA, points inside [-125, 24, -66, 50]     World     USA States (state lines too)
 *     110m                                       334          561
 *     50m                                      3,420        3,108
 *     25m                                      9,453        8,149
 *     10m                                     24,535       25,847 (Natural Earth 10m, as it is)
 *
 * Every level keeps every entity: Europe's 95 and the USA's 64 at all four.
 *
 * **The same simplifier as the World's 25m** (`lib/simplify-lines.mjs`): borders stay shared arcs,
 * nothing sweeps over another point, nothing crosses. Natural Earth's own 50m and 110m leave out the
 * islands too small to see at their scale, and so do these (`dropRingKm2`): a whole island at a
 * time, never an entity's largest piece of land, never a microstate above 110m. See
 * `lib/simplify-topology.mjs`.
 *
 * Europe's source is EuroGlobalMap at 1:1,000,000 (`countries-full.json`, kept and loadable, not
 * offered yet); its lakes, 1:1,000,000 too, are simplified to each level the same way, the smallest
 * left out. USA States' source is Natural Earth 10m, which is its 10m level unchanged; its lakes
 * and rivers are the World map's own at each detail.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { geoArea } from 'd3-geo'
import { simplifyTopology, pointsInBox } from './lib/simplify-topology.mjs'
import { simplifyLines } from './lib/simplify-lines.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const EU_BOX = [-25, 34, 45, 72]
const US_BOX = [-125, 24, -66, 50]
const EARTH_KM2 = 6371.0088 ** 2

/*
 * Per level: the tolerance in km, the islands left out (km²), the entities kept whole (km²), and —
 * for the World-like 25m of Natural Earth data — the World build's own rule for small rings.
 */
const EUROPE = {
  '10m': { toleranceKm: 0.6, dropRingKm2: 1, smallEntityKm2: 2500, smallRingSpan: 0 },
  '25m': { toleranceKm: 1.8, dropRingKm2: 5, smallEntityKm2: 1000, smallRingSpan: 0 },
  '50m': { toleranceKm: 7, dropRingKm2: 150, smallEntityKm2: 100, smallRingSpan: 0 },
  '110m': { toleranceKm: 45, dropRingKm2: 1500, smallEntityKm2: 0, smallRingSpan: 0 },
}
/* Europe's lakes per level: the tolerance, and the smallest lake drawn. 110m draws 50m's. */
const EUROPE_LAKES = {
  '10m': { toleranceKm: 0.9, minKm2: 6 },
  '25m': { toleranceKm: 1.5, minKm2: 10 },
  '50m': { toleranceKm: 3, minKm2: 100 },
}
const USA = {
  '25m': { toleranceKm: 1.2, dropRingKm2: 0, smallEntityKm2: 2500, smallRingSpan: 12, pinBaseline: false },
  '50m': { toleranceKm: 3.5, dropRingKm2: 20, smallEntityKm2: 300, smallRingSpan: 0 },
  '110m': { toleranceKm: 40, dropRingKm2: 2000, smallEntityKm2: 0, smallRingSpan: 0 },
}

const read = (path) => JSON.parse(readFileSync(resolve(root, path), 'utf8'))
const pts = (n) => n.toLocaleString('en')

function build(source, out, levels, box, label) {
  for (const [level, options] of Object.entries(levels)) {
    const t0 = Date.now()
    const { topology, stats } = simplifyTopology(read(source), options)
    const file = out.replace('{level}', level)
    const json = JSON.stringify(topology)
    writeFileSync(resolve(root, file), json)
    console.log(
      `[levels] ${label} ${level}: ${pts(pointsInBox(topology, box))} points in the box, ${pts(stats.after)} in all, ` +
        `${(json.length / 1e6).toFixed(2)} MB; ${stats.droppedPolygons} islands and ${stats.droppedHoles} lakes too small left out, ` +
        `${stats.refined} lines refined, ${((Date.now() - t0) / 1000).toFixed(1)} s`,
    )
  }
}

/** Europe's 1:1M lakes at one level: simplified feature by feature, the smallest left out. */
function buildLakes(level, { toleranceKm, minKm2 }) {
  const fc = read('data/europe/lakes.geojson')
  let before = 0
  let after = 0
  const features = []
  for (const f of fc.features) {
    const g = f.geometry
    if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) continue
    // Each polygon of the lake, with its islands as holes; a polygon below the size is left out.
    const km2 = (ring) => {
      const a = geoArea({ type: 'Polygon', coordinates: [ring] })
      return Math.min(a, 4 * Math.PI - a) * EARTH_KM2
    }
    // The lake's islands are its holes: the ones below the size go too, as Saimaa's thousands do.
    const polygons = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates)
      .filter((p) => km2(p[0]) >= minKm2)
      .map(([outer, ...holes]) => [outer, ...holes.filter((h) => km2(h) >= minKm2)])
    if (polygons.length === 0) continue
    const rings = polygons.flat()
    // Degrees on an integer grid finer than the file's 5 decimals, so the tests are exact.
    const lines = rings.map((coords) => {
      const n = coords.length - 1
      const xy = new Int32Array(n * 2)
      for (let i = 0; i < n; i++) {
        xy[i * 2] = Math.round((coords[i][0] + 180) * 1e6)
        xy[i * 2 + 1] = Math.round((coords[i][1] + 90) * 1e6)
      }
      return xy
    })
    const r = simplifyLines(lines, lines.map((_, i) => [i]), { toleranceKm, grid: 1e-6, closedRings: true, smallRingSpan: 0, gentleRepair: true, maxRefines: 12, pinBaseline: true })
    before += r.before
    after += r.after
    const back = (xy) => {
      const coords = []
      for (let i = 0; i < xy.length; i += 2) coords.push([Math.round((xy[i] / 1e6 - 180) * 1e5) / 1e5, Math.round((xy[i + 1] / 1e6 - 90) * 1e5) / 1e5])
      coords.push(coords[0])
      return coords
    }
    let k = 0
    const out = polygons.map((p) => p.map(() => back(r.lines[k++])))
    features.push({ ...f, geometry: out.length === 1 ? { type: 'Polygon', coordinates: out[0] } : { type: 'MultiPolygon', coordinates: out } })
  }
  const json = JSON.stringify({ type: 'FeatureCollection', features })
  writeFileSync(resolve(root, `data/europe/lakes-${level}.geojson`), json)
  console.log(`[levels] Europe lakes ${level}: ${features.length} of ${fc.features.length} lakes, ${pts(before)} → ${pts(after)} points, ${(json.length / 1e6).toFixed(2)} MB`)
}

build('data/europe/countries-full.json', 'data/europe/countries-{level}.json', EUROPE, EU_BOX, 'Europe')
for (const [level, options] of Object.entries(EUROPE_LAKES)) buildLakes(level, options)
build('data/natural-earth/us-states-10m.json', 'data/natural-earth/us-states-{level}.json', USA, US_BOX, 'USA')
