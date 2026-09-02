/**
 * Regenerates `src/geo/lowDetailGeometry.ts`.
 *
 * A maintenance script, NOT part of the build: ordinary builds only read the
 * generated module, which is committed.
 *
 *   node scripts/build-lowdetail-geometry.mjs
 *
 * Why this exists: world-atlas ships the same country layer at three resolutions, and
 * the coarser two leave out the entities that are too small to draw at that scale.
 * The 110m layer names 177 of the 254 entities the app knows; the 50m layer names
 * 240. So switching the map to 110m makes Monaco, Malta, Singapore, Hong Kong,
 * Bermuda and seventy-odd others vanish — not because the app stopped representing
 * them, but because that file has no shape for them.
 *
 * This lifts a shape for each from the finest world-atlas resolution that does have
 * it — the one that still knows about all of its islands — and simplifies every ring
 * to the vertex budget the 110m layer spends on its own small countries. Measured on
 * that layer: entities under 20,000 km2 carry a median of 4.9
 * points per degree of diagonal and never fewer than six points per polygon —
 * Luxembourg has 6, Cyprus 14, Kosovo 20. The budget below matches that, so a
 * supplemented Malta sits beside a source-data Cyprus without looking traced from a
 * finer map.
 *
 * Nothing here is drawn, invented, moved or scaled. Every coordinate is a real
 * Natural Earth lon/lat that survives from the source ring; simplification only ever
 * removes points. Islands are never merged or dropped, so an archipelago keeps its
 * distribution and the distributed assisted-selection system still has polygons to
 * work with.
 */
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readEntityMeta } from './entity-meta.mjs'
import { feature } from 'topojson-client'
import { geoArea, geoCentroid } from 'd3-geo'

const require = createRequire(import.meta.url)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outPath = resolve(root, 'src/geo/lowDetailGeometry.ts')

const EARTH_RADIUS_KM = 6371
const COORD_PRECISION = 4

/** Points per degree of a polygon's diagonal, matching the 110m layer's own density. */
const POINTS_PER_DEGREE = 5
/** No polygon drops below this, whatever its size — the 110m layer's own floor. */
const MIN_RING_POINTS = 6
/** Nor above it: this is a low-detail layer, not a coastline. */
const MAX_RING_POINTS = 24
/**
 * How much of a polygon's enclosed area simplification may cost it.
 *
 * A hard constraint that outranks the vertex budget. The area a supplement encloses
 * is the area the app reports for that entity, and what its small-entity and
 * archipelago classifications are decided from, so a shape that has been thinned
 * until it is a third smaller than the real thing is not a cheaper drawing of it —
 * it is a different country.
 */
const MAX_AREA_DRIFT = 0.12

/**
 * Entities whose supplement is hand-maintained in `supplemental.ts` and already
 * covers every resolution. Vatican City is smaller than the quantisation step of even
 * the 10m file, so no source layer can supply it.
 */
const HAND_MAINTAINED = new Set(['VAT'])

/* ------------------------------------------------------------------ sources */

const meta = readEntityMeta(resolve(root, 'public/geo/country-meta.json'))

/** The same id resolution the runtime loader uses, so the two can never disagree. */
function idOf(raw) {
  const numeric = raw.id != null ? String(raw.id) : null
  return (
    (numeric ? meta.numericToId[numeric] : undefined) ??
    meta.nameToId[String(raw.properties?.name ?? '')] ??
    null
  )
}

/** Drops consecutive duplicates and the closing repeat, exactly as `repair.ts` does. */
function distinct(ring) {
  const out = []
  for (const p of ring) {
    const prev = out[out.length - 1]
    if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) out.push(p)
  }
  if (out.length > 1) {
    const a = out[0]
    const b = out[out.length - 1]
    if (a[0] === b[0] && a[1] === b[1]) out.pop()
  }
  return out
}

function loadLayer(file) {
  const topo = require(`world-atlas/${file}`)
  const fc = feature(topo, topo.objects.countries)
  const byId = new Map()
  for (const raw of fc.features) {
    const id = idOf(raw)
    if (!id || !raw.geometry) continue
    const polygons =
      raw.geometry.type === 'Polygon' ? [raw.geometry.coordinates] : raw.geometry.coordinates
    const usable = []
    for (const polygon of polygons) {
      const rings = polygon.map(distinct).filter((r) => r.length >= 3)
      if (rings.length) usable.push(rings)
    }
    if (usable.length) byId.set(id, (byId.get(id) ?? []).concat(usable))
  }
  return byId
}

const layers = {
  '110m': loadLayer('countries-110m.json'),
  '50m': loadLayer('countries-50m.json'),
  '10m': loadLayer('countries-10m.json'),
}

/* ------------------------------------------------------------ simplification */

/**
 * Perpendicular distance from `p` to the segment `a`-`b`, in degrees of latitude.
 *
 * Longitude is scaled by cos(latitude) so a degree means the same distance on both
 * axes. Without it a ring at 62N — the Faroes, Aland — would be simplified twice as
 * hard east-west as north-south and come out visibly squashed.
 */
function segmentDistance(p, a, b, lonScale) {
  const px = (p[0] - a[0]) * lonScale
  const py = p[1] - a[1]
  const bx = (b[0] - a[0]) * lonScale
  const by = b[1] - a[1]
  const lengthSq = bx * bx + by * by
  if (lengthSq === 0) return Math.hypot(px, py)
  let t = (px * bx + py * by) / lengthSq
  t = t < 0 ? 0 : t > 1 ? 1 : t
  return Math.hypot(px - t * bx, py - t * by)
}

/** Ramer-Douglas-Peucker over an open polyline; both endpoints are always kept. */
function simplifyOpen(points, tolerance, lonScale) {
  if (points.length < 3) return points.slice()
  let worst = 0
  let index = 0
  for (let i = 1; i < points.length - 1; i++) {
    const d = segmentDistance(points[i], points[0], points[points.length - 1], lonScale)
    if (d > worst) {
      worst = d
      index = i
    }
  }
  if (worst <= tolerance) return [points[0], points[points.length - 1]]
  const left = simplifyOpen(points.slice(0, index + 1), tolerance, lonScale)
  const right = simplifyOpen(points.slice(index), tolerance, lonScale)
  return left.slice(0, -1).concat(right)
}

/**
 * Simplifies a closed ring without letting it unravel.
 *
 * A closed ring has no endpoints to anchor, so it is cut at its two most separated
 * points and the halves are simplified independently. Cutting anywhere else — at the
 * first vertex, say — lets the algorithm shave the ring's own extremes off, which is
 * how a simplified island ends up smaller than the real one.
 */
function simplifyRing(ring, tolerance, lonScale) {
  if (ring.length <= MIN_RING_POINTS) return ring.slice()

  const centre = ring.reduce(
    (acc, p) => [acc[0] + p[0] / ring.length, acc[1] + p[1] / ring.length],
    [0, 0],
  )
  let a = 0
  let far = -1
  for (let i = 0; i < ring.length; i++) {
    const d = Math.hypot((ring[i][0] - centre[0]) * lonScale, ring[i][1] - centre[1])
    if (d > far) {
      far = d
      a = i
    }
  }
  let b = a
  far = -1
  for (let i = 0; i < ring.length; i++) {
    const d = Math.hypot((ring[i][0] - ring[a][0]) * lonScale, ring[i][1] - ring[a][1])
    if (d > far) {
      far = d
      b = i
    }
  }
  if (b === a) return ring.slice()

  const rotate = (from, to) => {
    const out = []
    for (let i = from; ; i = (i + 1) % ring.length) {
      out.push(ring[i])
      if (i === to) break
    }
    return out
  }

  const first = simplifyOpen(rotate(a, b), tolerance, lonScale)
  const second = simplifyOpen(rotate(b, a), tolerance, lonScale)
  return first.slice(0, -1).concat(second.slice(0, -1))
}

/** Diagonal of a ring's bounding box, in degrees, with longitude scaled. */
function diagonalOf(ring, lonScale) {
  let w = Infinity
  let s = Infinity
  let e = -Infinity
  let n = -Infinity
  for (const [lon, lat] of ring) {
    if (lon < w) w = lon
    if (lon > e) e = lon
    if (lat < s) s = lat
    if (lat > n) n = lat
  }
  return Math.hypot((e - w) * lonScale, n - s)
}

/** Planar shoelace area of a ring, longitude scaled. Only ever compared to itself. */
function ringArea(ring, lonScale) {
  let sum = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j][0] - ring[i][0]) * lonScale * (ring[j][1] + ring[i][1])
  }
  return Math.abs(sum / 2)
}

/**
 * Simplifies one ring towards the 110m layer's vertex budget for a shape its size.
 *
 * The budget is a target, not a rule; the hard constraint is that the ring still has
 * to enclose the ground it started with. Tolerances are tried from fine to coarse and
 * the fewest points that keep the area within {@link MAX_AREA_DRIFT} wins, so a
 * blobby island collapses to its six points while a long thin one keeps whatever it
 * needs. That distinction is the whole reason for the guard: the Cyprus buffer zone
 * is a 180 km ribbon a few kilometres wide, and simplifying it on point count alone
 * throws away three fifths of it — which would then be the area the app reports for
 * it, and the area its assisted-selection classification is drawn from.
 */
function toBudget(ring, lonScale) {
  const diagonal = diagonalOf(ring, lonScale)
  const budget = Math.max(
    MIN_RING_POINTS,
    Math.min(MAX_RING_POINTS, Math.round(POINTS_PER_DEGREE * diagonal)),
  )
  if (ring.length <= budget) return ring

  const area = ringArea(ring, lonScale)
  const faithful = (candidate) =>
    area === 0 || Math.abs(ringArea(candidate, lonScale) - area) / area <= MAX_AREA_DRIFT

  // Never let a ring fall below three distinct corners: `repair.ts` drops those, and
  // dropping one here would lose an island the source data does describe.
  let best = ring
  let bestDrift = ring
  let tolerance = diagonal / 400
  for (let i = 0; i < 40; i++) {
    const candidate = simplifyRing(ring, tolerance, lonScale)
    if (candidate.length >= 3) {
      if (faithful(candidate)) best = candidate
      bestDrift = candidate
    }
    if (best.length <= budget && faithful(best)) break
    tolerance *= 1.35
  }
  const chosen = faithful(best) ? best : bestDrift
  return chosen.length >= 3 ? chosen : ring
}

const round = (n) => Number(n.toFixed(COORD_PRECISION))

/* --------------------------------------------------------------- generation */

/** Detail levels in order, coarsest first. */
const DETAILS = ['110m', '50m', '10m']

const entries = []
const skipped = []

const everyId = new Set()
for (const layer of Object.values(layers)) for (const id of layer.keys()) everyId.add(id)

for (const id of [...everyId].sort()) {
  // Which resolutions cannot draw this entity from their own data.
  const missing = DETAILS.filter((d) => !layers[d].has(id))
  if (missing.length === 0) continue
  if (HAND_MAINTAINED.has(id)) {
    skipped.push(`${id} hand-maintained`)
    continue
  }

  // Source from the FINEST layer that has the entity, and let simplification bring
  // the detail down. Taking the coarsest instead looks like the thriftier choice and
  // is a trap: the coarser layers drop islands as well as vertices, so a Cook Islands
  // lifted from 50m arrives as one island out of fifteen and the Maldives as four
  // atolls out of 175. Vertex count is what simplification is for; island count is
  // not recoverable once it is gone, and the distributed assisted-selection system
  // has nothing to work with without it.
  const sourceDetail = [...DETAILS].reverse().find((d) => layers[d].has(id))
  const source = layers[sourceDetail].get(id)

  const polygons = []
  let sourcePoints = 0
  let keptPoints = 0
  for (const rings of source) {
    const lat = rings[0].reduce((acc, p) => acc + p[1], 0) / rings[0].length
    const lonScale = Math.max(0.05, Math.cos((lat * Math.PI) / 180))
    const out = []
    for (const ring of rings) {
      sourcePoints += ring.length
      const simplified = toBudget(ring, lonScale)
      if (simplified.length < 3) continue
      keptPoints += simplified.length
      out.push(simplified.map(([lon, la]) => [round(lon), round(la)]))
    }
    if (out.length) polygons.push(out)
  }
  if (!polygons.length) {
    skipped.push(`${id} nothing survived`)
    continue
  }

  const closed = polygons.map((rings) => rings.map((r) => [...r, r[0]]))
  const areaKm2 =
    geoArea({ type: 'MultiPolygon', coordinates: closed }) * EARTH_RADIUS_KM * EARTH_RADIUS_KM
  const sourceArea =
    geoArea({
      type: 'MultiPolygon',
      coordinates: source.map((rings) => rings.map((r) => [...r, r[0]])),
    }) * EARTH_RADIUS_KM * EARTH_RADIUS_KM

  entries.push({
    id,
    name: meta[id]?.name ?? id,
    appliesToDetail: missing,
    sourceDetail,
    polygons,
    sourcePoints,
    keptPoints,
    areaKm2,
    sourceArea,
    centroid: geoCentroid({ type: 'MultiPolygon', coordinates: closed }),
  })
}

entries.sort((a, b) => a.id.localeCompare(b.id))

const body = entries
  .map((e) => {
    const polys = e.polygons
      .map(
        (rings) =>
          '      [\n' +
          rings
            .map(
              (ring) => '        [' + ring.map(([lon, lat]) => `[${lon},${lat}]`).join(', ') + '],',
            )
            .join('\n') +
          '\n      ],',
      )
      .join('\n')
    return (
      '  {\n' +
      `    id: '${e.id}',\n` +
      `    name: ${JSON.stringify(e.name)},\n` +
      `    appliesToDetail: [${e.appliesToDetail.map((d) => `'${d}'`).join(', ')}],\n` +
      `    sourceDetail: '${e.sourceDetail}',\n` +
      `    polygons: [\n${polys}\n    ],\n` +
      '  },'
    )
  })
  .join('\n')

const totalPolys = entries.reduce((n, e) => n + e.polygons.length, 0)
const totalPoints = entries.reduce((n, e) => n + e.keptPoints, 0)
const sourcePoints = entries.reduce((n, e) => n + e.sourcePoints, 0)

const file = `/**
 * Generated by scripts/build-lowdetail-geometry.mjs — do not edit by hand.
 *
 * Shapes for entities the coarser world-atlas layers leave out entirely. Each is
 * lifted from the finest layer that does describe it — the one that still knows about
 * all of its islands — and every ring is simplified to the vertex budget the 110m
 * layer spends on its own small countries, so a supplemented entity sits beside a
 * source-data one without looking traced from a finer map.
 *
 * Every coordinate is a real Natural Earth lon/lat carried over from the source ring.
 * Simplification only removes points: nothing is drawn, invented, moved or scaled,
 * and no polygon is ever merged or dropped, so archipelagos keep their distribution.
 *
 * ${entries.length} entities, ${totalPolys} polygons, ${totalPoints} points (from ${sourcePoints} in the source).
 */
import type { Position } from 'geojson'
import type { CountryId } from '../types/map'

export interface LowDetailCountry {
  id: CountryId
  name: string
  /** Resolutions whose own layer has no geometry for this entity. */
  appliesToDetail: ('110m' | '50m' | '10m')[]
  /** The layer the shape was lifted from, before simplification. */
  sourceDetail: '110m' | '50m' | '10m'
  polygons: Position[][][]
}

export const LOW_DETAIL_COUNTRIES: LowDetailCountry[] = [
${body}
]
`

writeFileSync(outPath, file)

const drift = entries
  .filter((e) => e.sourceArea > 1)
  .map((e) => ({ id: e.id, d: Math.abs(e.areaKm2 - e.sourceArea) / e.sourceArea }))
  .sort((a, b) => b.d - a.d)

console.log(
  `[build-lowdetail-geometry] ${entries.length} entities, ${totalPolys} polygons, ` +
    `${totalPoints} points (from ${sourcePoints}) -> src/geo/lowDetailGeometry.ts`,
)
console.log(
  '[build-lowdetail-geometry] applies at: ' +
    DETAILS.map(
      (d) => `${d}=${entries.filter((e) => e.appliesToDetail.includes(d)).length}`,
    ).join(', '),
)
console.log(
  '[build-lowdetail-geometry] largest area drift: ' +
    drift
      .slice(0, 6)
      .map((w) => `${w.id} ${(100 * w.d).toFixed(1)}%`)
      .join(', '),
)
if (skipped.length) console.log('[build-lowdetail-geometry] skipped: ' + skipped.join(', '))
