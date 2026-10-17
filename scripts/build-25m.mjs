/**
 * Builds the World map's 25m detail from its 10m detail.
 *
 * A maintenance script, NOT part of the build, like `build-geography.mjs`: it reads the
 * committed 10m layers in `data/natural-earth/` and writes their 25m counterparts beside
 * them, which are committed too. `npm run dev` / `npm run build` only copy the result.
 *
 *   node scripts/build-25m.mjs
 *
 * Natural Earth publishes 110m, 50m and 10m and nothing between; 50m names 240 of the 254
 * entities and draws them far more coarsely, 10m draws everything at six times the weight.
 * 25m is the 10m map with the points that a map at about that scale cannot show taken out
 * — the same land, the same ids, the same properties, the same islands — so nothing here
 * is drawn or invented: every point it keeps is one of the 10m map's, on the same grid.
 *
 * **Borders stay shared.** The 10m map is a topology: a border two entities share is one arc
 * that both reference. Each arc is simplified once and both sides keep referencing it, so
 * neighbours can never open a gap or overlap along a border. Arc ends — the junctions where
 * three entities meet, and the points where a border reaches the coast — are always kept.
 *
 * **Nothing is swept over.** Douglas–Peucker replaces a run of points by a straight chord
 * when none of them is further than `TOLERANCE_KM` from it. That alone can cut a corner over
 * an island, a lake shore, a neighbour's border or the same line further along, so a chord
 * is only accepted when no other point of the map lies in the area between it and the line
 * it replaces. Otherwise the run is split at its farthest point and tried again. After that
 * every drawn segment is checked against every other for crossings, and any arc still in one
 * is simplified again more finely until none is.
 *
 * **Small things are kept whole.** A ring with few points, or small enough that simplifying
 * it would change its shape noticeably — an islet, a microstate, an enclave — keeps every
 * point of every arc it uses. Every ring keeps at least four positions, so nothing
 * degenerates, and each keeps its winding.
 *
 * The lakes and the rivers are simplified the same way, feature by feature (they are not a
 * topology), with the same tolerance and the same guarantees within each feature.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { feature } from 'topojson-client'
import { geoArea } from 'd3-geo'
import { simplifyLines as simplify } from './lib/simplify-lines.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = resolve(root, 'data/natural-earth')

/**
 * How far, in kilometres, a dropped point may lie from the line that replaces it.
 *
 * Tuned by point count and by eye (see the README): at 1.2 km the 25m map keeps about two
 * fifths of 10m's points, two and a half times 50m's.
 */
const TOLERANCE_KM = Number(process.env.TOLERANCE_KM ?? 1.2)
/**
 * An entity smaller than this keeps every point: a microstate or a small island territory is
 * drawn at 10m on the 50m and 110m maps too (`lowDetailGeometry.ts`), and on 25m a 1 km
 * tolerance would take a tenth off Liechtenstein.
 */
const SMALL_ENTITY_KM2 = Number(process.env.SMALL_ENTITY_KM2 ?? 2500)

/* ------------------------------------------------------------ the countries */

const topology = JSON.parse(readFileSync(resolve(dataDir, 'countries-10m.json'), 'utf8'))
const [sx, sy] = topology.transform.scale
const [tx, ty] = topology.transform.translate

/** Absolute quantised coordinates of every arc: [x0, y0, x1, y1, …]. */
const arcs = topology.arcs.map((arc) => {
  const xy = new Int32Array(arc.length * 2)
  let x = 0
  let y = 0
  for (let i = 0; i < arc.length; i++) {
    x += arc[i][0]
    y += arc[i][1]
    xy[i * 2] = x
    xy[i * 2 + 1] = y
  }
  return xy
})

const lonOf = (x) => x * sx + tx
const latOf = (y) => y * sy + ty

/** Every ring of every geometry, as arc indexes (negative for reversed, as TopoJSON writes). */
const rings = []
for (const g of Object.values(topology.objects)[0].geometries) {
  const polygons = g.type === 'Polygon' ? [g.arcs] : g.type === 'MultiPolygon' ? g.arcs : []
  for (const polygon of polygons) for (const ring of polygon) rings.push(ring)
}

/* The arcs of small entities, kept whole. */
const EARTH_KM2 = 6371.0088 ** 2
const smallArcs = new Set()
const countries = Object.values(topology.objects)[0]
feature(topology, countries).features.forEach((f, i) => {
  if (geoArea(f) * EARTH_KM2 >= SMALL_ENTITY_KM2) return
  const g = countries.geometries[i]
  const polygons = g.type === 'Polygon' ? [g.arcs] : g.type === 'MultiPolygon' ? g.arcs : []
  for (const polygon of polygons) for (const ring of polygon) for (const index of ring) smallArcs.add(index >= 0 ? index : ~index)
})

const result = simplifyLines(arcs, rings, { whole: smallArcs })

/* Rewrite the arcs, delta-encoded on the same grid; everything else is 10m's own. */
const out = { ...topology, arcs: result.lines.map((xy) => {
  const arc = []
  let px = 0
  let py = 0
  for (let i = 0; i < xy.length; i += 2) {
    arc.push([xy[i] - px, xy[i + 1] - py])
    px = xy[i]
    py = xy[i + 1]
  }
  return arc
}) }
writeFileSync(resolve(dataDir, 'countries-25m.json'), JSON.stringify(out))
console.log(`[25m] countries: ${result.before} → ${result.after} points (${pct(result.after, result.before)}), ${result.refined} arcs refined, ${result.whole} kept whole, ${result.flipped} rings restored for winding, ${result.baseline} arcs already touching at 10m`)

/* ---------------------------------------------------------- lakes and rivers */

for (const [from, to, closed] of [['lakes-10m.geojson', 'lakes-25m.geojson', true], ['rivers-10m.geojson', 'rivers-25m.geojson', false]]) {
  const fc = JSON.parse(readFileSync(resolve(dataDir, from), 'utf8'))
  let before = 0
  let after = 0
  for (const feature of fc.features) {
    const g = feature.geometry
    if (!g) continue
    // Every line of the feature, as a ring or a line of its own; a feature is simplified as a whole.
    const parts = []
    if (g.type === 'Polygon') parts.push(...g.coordinates)
    else if (g.type === 'MultiPolygon') for (const p of g.coordinates) parts.push(...p)
    else if (g.type === 'LineString') parts.push(g.coordinates)
    else if (g.type === 'MultiLineString') parts.push(...g.coordinates)
    else continue
    // Degrees scaled to an integer grid finer than the file's own 4 decimals, so tests are exact.
    const lines = parts.map((coords) => {
      const n = closed ? coords.length - 1 : coords.length
      const xy = new Int32Array(n * 2)
      for (let i = 0; i < n; i++) {
        xy[i * 2] = Math.round((coords[i][0] + 180) * 1e5)
        xy[i * 2 + 1] = Math.round((coords[i][1] + 90) * 1e5)
      }
      return xy
    })
    const r = simplifyLines(lines, closed ? lines.map((_, i) => [i]) : [], { grid: 1e-5, closedRings: closed })
    before += r.before
    after += r.after
    const back = (xy) => {
      const coords = []
      for (let i = 0; i < xy.length; i += 2) coords.push([round4(xy[i] / 1e5 - 180), round4(xy[i + 1] / 1e5 - 90)])
      if (closed) coords.push(coords[0])
      return coords
    }
    let k = 0
    if (g.type === 'Polygon') g.coordinates = g.coordinates.map(() => back(r.lines[k++]))
    else if (g.type === 'MultiPolygon') g.coordinates = g.coordinates.map((p) => p.map(() => back(r.lines[k++])))
    else if (g.type === 'LineString') g.coordinates = back(r.lines[k++])
    else g.coordinates = g.coordinates.map(() => back(r.lines[k++]))
  }
  writeFileSync(resolve(dataDir, to), JSON.stringify(fc))
  console.log(`[25m] ${to}: ${before} → ${after} points (${pct(after, before)})`)
}

function round4(v) {
  return Math.round(v * 1e4) / 1e4
}
function pct(a, b) {
  return `${((100 * a) / b).toFixed(1)} %`
}

/** The shared simplifier at this script's tolerance, on the countries' grid unless `grid` is given. */
function simplifyLines(lines, ringLines, options = {}) {
  return simplify(lines, ringLines, { toleranceKm: TOLERANCE_KM, lonOf, latOf, ...options })
}
