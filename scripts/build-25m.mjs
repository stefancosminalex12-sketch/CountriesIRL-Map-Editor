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
/** A ring with this many points or fewer is kept whole: islets, microstates, enclaves. */
const SMALL_RING_POINTS = 16
/** A ring whose box is smaller than this many tolerances across is kept whole. */
const SMALL_RING_SPAN = 12
/** How many times to go finer on arcs still involved in a crossing before keeping them whole. */
const MAX_REFINES = 4

const KM_PER_DEG_LAT = 110.574
const KM_PER_DEG_LON = 111.32

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

/* ------------------------------------------------------------ the simplifier */

/**
 * Simplifies a set of lines together, so that none crosses another or itself and none sweeps
 * over another's point.
 *
 * `lines` are integer x, y pairs. `rings` lists, for each closed ring, the lines it is made
 * of: a small ring keeps its lines whole, and every ring keeps at least four positions.
 * Coordinates are on the countries' grid unless `grid` gives degrees per unit, in which case
 * x is longitude + 180 and y latitude + 90.
 */
function simplifyLines(lines, ringLines, options = {}) {
  const degX = options.grid ? (x) => x * options.grid - 180 : lonOf
  const degY = options.grid ? (y) => y * options.grid - 90 : latOf
  const closedRings = options.closedRings ?? false

  /*
   * The distance test, on the sphere.
   *
   * d3 draws the line between two consecutive points as a great circle, not as a straight line
   * in longitude and latitude. So a run of points is replaced by a chord only when every one
   * of them lies within the tolerance of the great circle the chord will be drawn as. Measured
   * in the plane instead, a border along a parallel — the 49th between the United States and
   * Canada — reads as straight, loses its points, and is then drawn bowing towards the pole:
   * 124,000 km² moved from Canada to the United States.
   */
  const RADIANS = Math.PI / 180
  const EARTH_KM = 6371.0088
  const unit = (xy, i) => {
    const lon = degX(xy[i * 2]) * RADIANS
    const lat = degY(xy[i * 2 + 1]) * RADIANS
    const c = Math.cos(lat)
    return [c * Math.cos(lon), c * Math.sin(lon), Math.sin(lat)]
  }
  const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2]
  const chordKm = (u, v) => 2 * EARTH_KM * Math.asin(Math.min(1, Math.hypot(u[0] - v[0], u[1] - v[1], u[2] - v[2]) / 2))
  const kmDistance2 = (xy, a, b, p) => {
    const A = unit(xy, a)
    const B = unit(xy, b)
    const P = unit(xy, p)
    const n = cross(A, B)
    const nl = Math.hypot(n[0], n[1], n[2])
    let d
    if (nl < 1e-12) d = chordKm(P, A)
    else {
      const N = [n[0] / nl, n[1] / nl, n[2] / nl]
      // Between the two ends along the great circle: the cross-track distance. Otherwise the nearer end.
      if (dot(cross(A, P), N) >= 0 && dot(cross(P, B), N) >= 0) d = Math.abs(Math.asin(Math.max(-1, Math.min(1, dot(P, N))))) * EARTH_KM
      else d = Math.min(chordKm(P, A), chordKm(P, B))
    }
    return d * d
  }
  const spanKm = (xy) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (let i = 0; i < xy.length; i += 2) {
      const x = degX(xy[i]), y = degY(xy[i + 1])
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
    const cos = Math.cos(((y0 + y1) / 2) * (Math.PI / 180))
    return Math.hypot((x1 - x0) * KM_PER_DEG_LON * cos, (y1 - y0) * KM_PER_DEG_LAT)
  }

  /* Lines kept whole: those of small rings. */
  const whole = new Uint8Array(lines.length)
  for (const line of options.whole ?? []) whole[line] = 1
  const lineOf = (index) => (index >= 0 ? index : ~index)
  const ringMembers = ringLines.map((ring) => ring.map(lineOf))
  for (const members of ringMembers) {
    let points = 0
    for (const i of members) points += lines[i].length / 2
    let span = 0
    for (const i of members) span = Math.max(span, spanKm(lines[i]))
    if (points <= SMALL_RING_POINTS || span < SMALL_RING_SPAN * TOLERANCE_KM) for (const i of members) whole[i] = 1
  }

  /* A grid of every point of every line, for the sweep test. */
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const xy of lines) for (let i = 0; i < xy.length; i += 2) {
    if (xy[i] < minX) minX = xy[i]
    if (xy[i] > maxX) maxX = xy[i]
    if (xy[i + 1] < minY) minY = xy[i + 1]
    if (xy[i + 1] > maxY) maxY = xy[i + 1]
  }
  // Cells about as many as points, so a small feature's grid is not a million empty cells.
  let totalPoints = 0
  for (const xy of lines) totalPoints += xy.length / 2
  const CELLS = Math.max(1, Math.min(1024, Math.ceil(Math.sqrt(totalPoints / 2))))
  const cellW = Math.max(1, Math.ceil((maxX - minX + 1) / CELLS))
  const cellH = Math.max(1, Math.ceil((maxY - minY + 1) / CELLS))
  const cellOf = (x, y) => Math.floor((x - minX) / cellW) + Math.floor((y - minY) / cellH) * CELLS
  const grid = new Map()
  lines.forEach((xy, line) => {
    for (let i = 0; i < xy.length / 2; i++) {
      const c = cellOf(xy[i * 2], xy[i * 2 + 1])
      let list = grid.get(c)
      if (!list) grid.set(c, (list = []))
      list.push(line, i)
    }
  })

  const pointChordKm2 = (ax, ay, bx, by, px, py) => {
    const lax = degX(ax), lay = degY(ay)
    const cos = Math.cos(((lay + degY(by)) / 2) * (Math.PI / 180))
    const kx = KM_PER_DEG_LON * cos
    const qx = (degX(px) - lax) * kx, qy = (degY(py) - lay) * KM_PER_DEG_LAT
    const vx = (degX(bx) - lax) * kx, vy = (degY(by) - lay) * KM_PER_DEG_LAT
    const l2 = vx * vx + vy * vy
    let t = l2 === 0 ? 0 : (qx * vx + qy * vy) / l2
    t = t < 0 ? 0 : t > 1 ? 1 : t
    return (qx - t * vx) ** 2 + (qy - t * vy) ** 2
  }

  /** Whether any point other than the run's own lies in the area between chord a–b and the run. */
  const swept = (line, a, b) => {
    const xy = lines[line]
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (let i = a; i <= b; i++) {
      const x = xy[i * 2], y = xy[i * 2 + 1]
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
    const ax = xy[a * 2], ay = xy[a * 2 + 1], bx = xy[b * 2], by = xy[b * 2 + 1]
    let reach2 = 0
    for (let i = a + 1; i < b; i++) reach2 = Math.max(reach2, pointChordKm2(ax, ay, bx, by, xy[i * 2], xy[i * 2 + 1]))
    reach2 = reach2 * 1.0001 + 1e-9
    const c0x = Math.floor((x0 - minX) / cellW), c1x = Math.floor((x1 - minX) / cellW)
    const c0y = Math.floor((y0 - minY) / cellH), c1y = Math.floor((y1 - minY) / cellH)
    for (let cy = c0y; cy <= c1y; cy++) for (let cx = c0x; cx <= c1x; cx++) {
      const list = grid.get(cx + cy * CELLS)
      if (!list) continue
      for (let k = 0; k < list.length; k += 2) {
        const other = list[k], j = list[k + 1]
        if (other === line && j >= a && j <= b) continue
        const oxy = lines[other]
        const px = oxy[j * 2], py = oxy[j * 2 + 1]
        if (px < x0 || px > x1 || py < y0 || py > y1) continue
        if ((px === ax && py === ay) || (px === bx && py === by)) continue
        if (onSegment(ax, ay, bx, by, px, py)) return true
        // The area between the chord and the run lies within the run's own distance from the
        // chord: a point further than that is outside it.
        if (pointChordKm2(ax, ay, bx, by, px, py) > reach2) continue
        // Even-odd over the polygon a, a+1, …, b, closed by the chord.
        let inside = false
        for (let i = a, prev = b; i <= b; prev = i, i++) {
          const xi = xy[i * 2], yi = xy[i * 2 + 1], xj = xy[prev * 2], yj = xy[prev * 2 + 1]
          if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
        }
        if (inside) return true
      }
    }
    return false
  }

  /** Douglas–Peucker with the sweep test, at `tolerance` km; returns which points are kept. */
  const keepFor = (line, tolerance) => {
    const xy = lines[line]
    const n = xy.length / 2
    const keep = new Uint8Array(n)
    keep[0] = 1
    keep[n - 1] = 1
    if (whole[line] || tolerance <= 0) return keep.fill(1)
    const tol2 = tolerance * tolerance
    const stack = [0, n - 1]
    while (stack.length) {
      const b = stack.pop()
      const a = stack.pop()
      if (b - a < 2) continue
      let worst = -1
      let at = -1
      for (let i = a + 1; i < b; i++) {
        const d = kmDistance2(xy, a, b, i)
        if (d > worst) {
          worst = d
          at = i
        }
      }
      if (worst > tol2 || swept(line, a, b)) {
        keep[at] = 1
        stack.push(a, at, at, b)
      }
    }
    return keep
  }

  /* Lines that already cross or touch something at full detail are left exactly as they are. */
  const baseline = crossings(lines, lines.map((xy) => new Uint8Array(xy.length / 2).fill(1)), closedRings)
  for (const line of baseline) whole[line] = 1

  const tolerances = new Float64Array(lines.length).fill(TOLERANCE_KM)
  let kept = lines.map((_, line) => keepFor(line, tolerances[line]))

  /* Every ring keeps at least four positions (three distinct points and the closure). */
  const ensureRings = () => {
    for (const members of ringMembers) {
      const count = () => {
        let c = 0
        for (const i of members) {
          const k = kept[i]
          for (let j = 0; j < k.length; j++) if (k[j]) c++
          c -= 1 // each line's last point is the next line's first
        }
        return closedRings ? c + 1 : c
      }
      for (const i of members) {
        if (count() >= (closedRings ? 3 : 3)) break
        kept[i].fill(1)
      }
    }
  }
  ensureRings()

  /* Crossings: every drawn segment against every other, and refine the lines involved. */
  let refined = 0
  for (let pass = 0; pass <= MAX_REFINES; pass++) {
    const bad = crossings(lines, kept, closedRings)
    for (const line of baseline) bad.delete(line)
    if (bad.size === 0) break
    for (const line of bad) {
      refined++
      tolerances[line] = pass === MAX_REFINES - 1 ? 0 : tolerances[line] / 2
      kept[line] = keepFor(line, tolerances[line])
    }
    ensureRings()
    if (pass === MAX_REFINES) throw new Error(`crossings remain on ${bad.size} lines`)
  }

  /* Winding: a ring must turn the same way it did. */
  let flipped = 0
  for (const members of ringLines) {
    const area = (keepAll) => {
      let s = 0
      let first = null
      let prev = null
      for (const index of members) {
        const i = lineOf(index)
        const xy = lines[i]
        const k = kept[i]
        const n = xy.length / 2
        for (let step = 0; step < n; step++) {
          const j = index >= 0 ? step : n - 1 - step
          if (!keepAll && !k[j]) continue
          // Shift to a local origin so the products stay exact.
          const p = [xy[j * 2] - xy[0], xy[j * 2 + 1] - xy[1]]
          if (prev) s += prev[0] * p[1] - p[0] * prev[1]
          else first = p
          prev = p
        }
      }
      if (prev && first) s += prev[0] * first[1] - first[0] * prev[1]
      return s
    }
    if (Math.sign(area(false)) !== Math.sign(area(true))) {
      for (const index of members) kept[lineOf(index)].fill(1)
      flipped++
    }
  }

  let before = 0
  let after = 0
  const outLines = lines.map((xy, line) => {
    const k = kept[line]
    const n = xy.length / 2
    before += n
    const kept2 = []
    for (let i = 0; i < n; i++) if (k[i]) kept2.push(xy[i * 2], xy[i * 2 + 1])
    after += kept2.length / 2
    return Int32Array.from(kept2)
  })
  let wholeCount = 0
  for (const w of whole) wholeCount += w
  return { lines: outLines, before, after, refined, whole: wholeCount, flipped, baseline: baseline.size }
}

/** Whether p lies on the closed segment a–b (exact, integer coordinates). */
function onSegment(ax, ay, bx, by, px, py) {
  if ((bx - ax) * (py - ay) - (by - ay) * (px - ax) !== 0) return false
  return px >= Math.min(ax, bx) && px <= Math.max(ax, bx) && py >= Math.min(ay, by) && py <= Math.max(ay, by)
}

/**
 * The lines with a drawn segment that crosses or overlaps another drawn segment, not counting
 * segments that only meet at a shared end (consecutive segments, and lines meeting at a junction).
 */
function crossings(lines, kept, closedRings) {
  const segs = []
  lines.forEach((xy, line) => {
    const k = kept[line]
    let prev = -1
    for (let i = 0; i < xy.length / 2; i++) {
      if (!k[i]) continue
      if (prev >= 0) segs.push(line, prev, i)
      prev = i
    }
    // A closed lake ring's closing segment.
    if (closedRings && prev > 0) segs.push(line, prev, 0)
  })
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const xy of lines) for (let i = 0; i < xy.length; i += 2) {
    minX = Math.min(minX, xy[i]); maxX = Math.max(maxX, xy[i]); minY = Math.min(minY, xy[i + 1]); maxY = Math.max(maxY, xy[i + 1])
  }
  const CELLS = Math.max(1, Math.min(2048, Math.ceil(Math.sqrt(segs.length / 3))))
  const cw = Math.max(1, Math.ceil((maxX - minX + 1) / CELLS))
  const ch = Math.max(1, Math.ceil((maxY - minY + 1) / CELLS))
  const buckets = new Map()
  const bad = new Set()
  for (let s = 0; s < segs.length; s += 3) {
    const xy = lines[segs[s]]
    const ax = xy[segs[s + 1] * 2], ay = xy[segs[s + 1] * 2 + 1], bx = xy[segs[s + 2] * 2], by = xy[segs[s + 2] * 2 + 1]
    const c0x = Math.floor((Math.min(ax, bx) - minX) / cw), c1x = Math.floor((Math.max(ax, bx) - minX) / cw)
    const c0y = Math.floor((Math.min(ay, by) - minY) / ch), c1y = Math.floor((Math.max(ay, by) - minY) / ch)
    const seen = new Set()
    for (let cy = c0y; cy <= c1y; cy++) for (let cx = c0x; cx <= c1x; cx++) {
      const key = cx + cy * CELLS
      const list = buckets.get(key)
      if (list) {
        for (const t of list) {
          if (seen.has(t)) continue
          seen.add(t)
          const oxy = lines[segs[t]]
          const cx0 = oxy[segs[t + 1] * 2], cy0 = oxy[segs[t + 1] * 2 + 1], dx = oxy[segs[t + 2] * 2], dy = oxy[segs[t + 2] * 2 + 1]
          if (segmentsConflict(ax, ay, bx, by, cx0, cy0, dx, dy)) {
            bad.add(segs[s])
            bad.add(segs[t])
          }
        }
        list.push(s)
      } else buckets.set(key, [s])
    }
  }
  return bad
}

/**
 * Whether two segments cross or overlap other than by sharing an end point. Two segments that
 * share an end touch there by construction; they conflict only if they also run along each
 * other (collinear overlap).
 */
function segmentsConflict(ax, ay, bx, by, cx, cy, dx, dy) {
  if (Math.max(ax, bx) < Math.min(cx, dx) || Math.max(cx, dx) < Math.min(ax, bx)) return false
  if (Math.max(ay, by) < Math.min(cy, dy) || Math.max(cy, dy) < Math.min(ay, by)) return false
  const o1 = orient(ax, ay, bx, by, cx, cy)
  const o2 = orient(ax, ay, bx, by, dx, dy)
  const o3 = orient(cx, cy, dx, dy, ax, ay)
  const o4 = orient(cx, cy, dx, dy, bx, by)
  const sharedEnd = (ax === cx && ay === cy) || (ax === dx && ay === dy) || (bx === cx && by === cy) || (bx === dx && by === dy)
  if (o1 === 0 && o2 === 0) {
    // Collinear: conflict when they overlap in more than a shared end point.
    const len = (px, py, qx, qy) => (qx - px) * (bx - ax) + (qy - py) * (by - ay)
    const t0 = len(ax, ay, cx, cy), t1 = len(ax, ay, dx, dy), tb = len(ax, ay, bx, by)
    const lo = Math.max(0, Math.min(t0, t1)), hi = Math.min(tb, Math.max(t0, t1))
    return hi > lo
  }
  if (sharedEnd) return false
  if (o1 * o2 < 0 && o3 * o4 < 0) return true
  // One end on the other segment: a T-touch is a conflict (lines must meet only at shared points).
  return (o1 === 0 && onSegment(ax, ay, bx, by, cx, cy)) || (o2 === 0 && onSegment(ax, ay, bx, by, dx, dy)) || (o3 === 0 && onSegment(cx, cy, dx, dy, ax, ay)) || (o4 === 0 && onSegment(cx, cy, dx, dy, bx, by))
}

function orient(ax, ay, bx, by, cx, cy) {
  const v = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
  return v > 0 ? 1 : v < 0 ? -1 : 0
}
