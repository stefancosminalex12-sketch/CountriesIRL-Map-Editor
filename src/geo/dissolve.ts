/**
 * Dissolving the pieces of one territory that touch.
 *
 * A territory's water can arrive as several polygons that meet along a shared edge. Two
 * things produce that, and neither is geography:
 *
 * - **The antimeridian.** The source splits every zone that crosses ±180° into two
 *   polygons, one either side of the line — Fiji's, Tuvalu's and Kiribati's among them.
 * - **Zones of one owner that border each other.** A territory's water is sometimes
 *   recorded as several adjacent zones — the Scattered Islands in the Mozambique Channel,
 *   or the Caribbean Netherlands — and they meet along boundaries of their own.
 *
 * Drawn as they come, each piece is filled and outlined separately. The outline then runs
 * straight through the middle of the territory, and where the outline is off, the two
 * fills meet edge to edge and anti-aliasing leaves a hairline of ocean between them. So
 * the pieces are joined into the polygon they really are: the shared edges cancel, and
 * what is left is the territory's true outer boundary.
 *
 * This is exact rather than approximate. Every shared boundary in the maritime data is
 * the same line on both sides (see `scripts/fetch-eez.mjs`), so an edge that belongs to
 * two pieces appears once in each direction and removing both leaves no sliver. The one
 * boundary that can carry different vertices either side is a meridian — the antimeridian
 * cut — and a straight vertical line is split at every vertex either side has before the
 * edges are compared, so it cancels exactly too.
 *
 * A territory with nothing to join is returned as it was given, the same object.
 */
import { geoArea, geoCentroid } from 'd3-geo'
import type { MultiPolygon, Position } from 'geojson'

type Point = [number, number]

/** Coordinates the data distinguishes at 1e-3° are told apart; float noise is not. */
const SCALE = 1e6
const keyOf = (x: number, y: number) => `${Math.round(x * SCALE)},${Math.round(y * SCALE)}`

/** On the antimeridian, in any frame: the only line two halves of one zone are cut along. */
const onCut = (x: number) => Math.abs((((x % 360) + 360) % 360) - 180) < 1e-9

/** A ring of no area — a sliver walked out and back along a line — is not a ring. */
const MIN_AREA = 1e-9

/** Shoelace area in the plane of longitude and latitude, positive when anticlockwise. */
function signedArea(ring: Point[]): number {
  let sum = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]
  }
  return sum / 2
}

/**
 * A ring in one continuous longitude frame around `centre`.
 *
 * The first vertex is brought within 180° of the centre and every later one within 180°
 * of the vertex before it, so a ring never jumps a whole turn between two neighbours —
 * and the two halves of a zone cut at the antimeridian both end up on the same meridian.
 */
function unwrap(ring: Position[], centre: number): Point[] {
  const out: Point[] = []
  let previous: number | null = null
  for (const [lon, lat] of ring) {
    let x = lon
    const reference = previous ?? centre
    while (x - reference > 180) x -= 360
    while (reference - x > 180) x += 360
    out.push([x, lat])
    previous = x
  }
  const first = out[0]
  const last = out[out.length - 1]
  if (out.length > 1 && keyOf(first[0], first[1]) === keyOf(last[0], last[1])) out.pop()
  return out
}

function contains(ring: Point[], [px, py]: Point): boolean {
  let hit = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit
  }
  return hit
}

interface Edge {
  from: Point
  to: Point
  fromKey: string
  toKey: string
  used: boolean
}

export function dissolveTouching(geometry: MultiPolygon): MultiPolygon {
  if (geometry.coordinates.length < 2) return geometry

  const centroid = geoCentroid(geometry)
  const centre = Number.isFinite(centroid[0]) ? centroid[0] : 0

  /*
   * Every ring in the one frame, outer rings anticlockwise and holes clockwise, so that
   * where two pieces meet, the edge they share is walked in opposite directions. The
   * convention the geometry arrived in is remembered and given back at the end.
   */
  let arrivedAnticlockwise: boolean | null = null
  const rings: Point[][] = []
  for (const polygon of geometry.coordinates) {
    polygon.forEach((source, index) => {
      const ring = unwrap(source, centre)
      if (ring.length < 3) return
      const area = signedArea(ring)
      if (index === 0 && arrivedAnticlockwise === null) arrivedAnticlockwise = area > 0
      if (area > 0 !== (index === 0)) ring.reverse()
      rings.push(ring)
    })
  }

  /*
   * Edges along the antimeridian cut, split at every vertex either half has on it. The
   * two halves walk the cut with different vertices; once both carry all of them, every
   * stretch of it is one edge in each direction. Only the cut: every other boundary two
   * pieces share is already the same line on both sides, and splitting other meridian
   * edges at unrelated vertices that happen to share a longitude invents coincidences.
   */
  const columns = new Map<number, number[]>()
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]
      const b = ring[(i + 1) % ring.length]
      const column = Math.round(a[0] * SCALE)
      if (column !== Math.round(b[0] * SCALE) || a[1] === b[1] || !onCut(a[0])) continue
      const ys = columns.get(column) ?? []
      ys.push(a[1], b[1])
      columns.set(column, ys)
    }
  }
  const split = rings.map((ring) => {
    if (columns.size === 0) return ring
    const out: Point[] = []
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]
      const b = ring[(i + 1) % ring.length]
      out.push(a)
      const column = Math.round(a[0] * SCALE)
      if (column !== Math.round(b[0] * SCALE) || !onCut(a[0])) continue
      const ys = columns.get(column)
      if (!ys) continue
      const lo = Math.min(a[1], b[1])
      const hi = Math.max(a[1], b[1])
      const between = [...new Set(ys)].filter((y) => y > lo && y < hi)
      between.sort((p, q) => (a[1] < b[1] ? p - q : q - p))
      for (const y of between) out.push([a[0], y])
    }
    return out
  })

  // Directed edges; one walked both ways is a boundary between two pieces, and goes.
  const directed = new Map<string, Edge[]>()
  let cancelled = 0
  for (const ring of split) {
    for (let i = 0; i < ring.length; i++) {
      const from = ring[i]
      const to = ring[(i + 1) % ring.length]
      const fromKey = keyOf(from[0], from[1])
      const toKey = keyOf(to[0], to[1])
      if (fromKey === toKey) continue
      const reverse = directed.get(`${toKey}>${fromKey}`)
      if (reverse && reverse.length > 0) {
        reverse.pop()
        cancelled++
        continue
      }
      const list = directed.get(`${fromKey}>${toKey}`) ?? []
      list.push({ from, to, fromKey, toKey, used: false })
      directed.set(`${fromKey}>${toKey}`, list)
    }
  }
  if (cancelled === 0) return geometry

  const outgoing = new Map<string, Edge[]>()
  for (const list of directed.values()) {
    for (const edge of list) {
      const out = outgoing.get(edge.fromKey) ?? []
      out.push(edge)
      outgoing.set(edge.fromKey, out)
    }
  }

  /*
   * Walk the edges that are left back into rings, keeping the inside on the left. Where
   * two rings touch at a single vertex, the next edge is the first one clockwise from the
   * way back, which keeps each ring whole rather than figure-of-eight.
   */
  const assembled: Point[][] = []
  for (const list of outgoing.values()) {
    for (const start of list) {
      if (start.used) continue
      const ring: Point[] = []
      let edge: Edge | undefined = start
      while (edge && !edge.used) {
        edge.used = true
        ring.push(edge.from)
        const candidates: Edge[] = (outgoing.get(edge.toKey) ?? []).filter((e) => !e.used)
        if (candidates.length <= 1) {
          edge = candidates[0]
          continue
        }
        const back = Math.atan2(edge.from[1] - edge.to[1], edge.from[0] - edge.to[0])
        let best: Edge | undefined
        let bestTurn = Infinity
        for (const candidate of candidates) {
          const angle = Math.atan2(candidate.to[1] - candidate.from[1], candidate.to[0] - candidate.from[0])
          let turn = back - angle
          while (turn <= 0) turn += Math.PI * 2
          if (turn < bestTurn) {
            bestTurn = turn
            best = candidate
          }
        }
        edge = best
      }
      if (ring.length >= 3) assembled.push(ring)
    }
  }

  // Outer rings anticlockwise, holes clockwise; each hole goes to the smallest outer around it.
  const outers = assembled
    .filter((ring) => signedArea(ring) > MIN_AREA)
    .map((ring) => ({ ring, area: signedArea(ring), holes: [] as Point[][] }))
  for (const hole of assembled.filter((ring) => signedArea(ring) < -MIN_AREA)) {
    let owner: (typeof outers)[number] | null = null
    for (const outer of outers) {
      if (contains(outer.ring, hole[0]) && (!owner || outer.area < owner.area)) owner = outer
    }
    owner?.holes.push(hole)
  }

  const close = (ring: Point[]): Position[] => {
    const oriented = arrivedAnticlockwise === false ? [...ring].reverse() : ring
    return [...oriented, oriented[0]]
  }
  const dissolved: MultiPolygon = {
    type: 'MultiPolygon',
    coordinates: outers
      .sort((a, b) => b.area - a.area)
      .map((outer) => [close(outer.ring), ...outer.holes.map(close)]),
  }

  /*
   * Joining pieces that touch removes boundaries and nothing else, so the territory
   * covers exactly the water it covered before. Anything else means the input was not
   * what this assumes — and the pieces are drawn as they came, seams and all, rather
   * than as a shape nobody can vouch for.
   */
  const before = geometry.coordinates.reduce(
    (sum, polygon) => sum + geoArea({ type: 'Polygon', coordinates: polygon }),
    0,
  )
  const after = geoArea(dissolved)
  if (!(Math.abs(after - before) <= before * 1e-6 + 1e-12)) return geometry
  return dissolved
}
