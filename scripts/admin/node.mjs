/**
 * Makes shared borders share their vertices after units have been cut.
 *
 * TopoJSON finds a shared border by finding the same run of points on both sides, and
 * quantises identical coordinates to identical grid points. So a border stays one arc as long
 * as both sides hold exactly the same points, in floating point, before it quantises them.
 *
 * Cutting a unit with a finer source (`split`, on Clipper — `clip.mjs`) keeps every point it
 * was given exactly and creates new ones only where a finer source's line crosses an edge.
 * Clipping records those. Each lies within a couple of centimetres of the line it was cut
 * from, and the units on the other side of that line — a sibling, the neighbour across a
 * national border, the same country at another level — do not have it: they have the line
 * whole, or cut at crossings of their own. So:
 *
 *   1. a created point within 10 cm of a point already on the map is that point — the same
 *      crossing computed twice, or a crossing at a vertex;
 *   2. every other created point is given one position — exactly on the original edge it
 *      lies on — and holds it in every ring;
 *   3. it is inserted into every edge it lies on, in every ring: the original edge, or the
 *      piece of it between two other crossings. Every side of a line then holds every
 *      crossing on it, in the same order.
 *
 * Nothing is rounded here and no other point moves; TopoJSON's quantisation does the rest.
 * Mutates the features' polygons in place; returns counts for the report.
 */

/** Within this many degrees (about 10 cm) two points are one, and a point is on an edge. */
const TOLERANCE = 1e-6

/** Cell size of the index of edges near created points, in degrees. */
const CELL = 0.02

const keyOf = (p) => `${p[0]},${p[1]}`
const cellOf = (x, y, size) => `${Math.floor(x / size)},${Math.floor(y / size)}`

function* ringsOf(features) {
  for (const f of features) for (const polygon of f.polygons) for (const ring of polygon) yield ring
}

export function node(features, createdPoints) {
  const createdKeys = new Set(createdPoints.map(keyOf))

  // The created points the map still holds.
  const fresh = new Map()
  for (const ring of ringsOf(features)) for (const p of ring) if (createdKeys.has(keyOf(p))) fresh.set(keyOf(p), p)
  if (fresh.size === 0) return { created: 0, snapped: 0, placed: 0, inserted: 0 }

  /* 1. A created point within the tolerance of another point is that point. */
  const FINE = TOLERANCE * 4
  const fineCells = new Set()
  for (const p of fresh.values()) {
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) fineCells.add(cellOf(p[0] + dx * FINE, p[1] + dy * FINE, FINE))
  }
  const nearby = new Map()
  for (const ring of ringsOf(features)) {
    for (const q of ring) {
      const c = cellOf(q[0], q[1], FINE)
      if (!fineCells.has(c)) continue
      const list = nearby.get(c)
      if (list) list.push(q)
      else nearby.set(c, [q])
    }
  }
  const moved = new Map()
  for (const [k, p] of fresh) {
    let target = null
    let targetReceived = false
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const q of nearby.get(cellOf(p[0] + dx * FINE, p[1] + dy * FINE, FINE)) ?? []) {
          const qk = keyOf(q)
          if (qk === k || Math.abs(q[0] - p[0]) > TOLERANCE || Math.abs(q[1] - p[1]) > TOLERANCE) continue
          const received = !createdKeys.has(qk)
          // A received point wins; between two created ones, the smaller key, so it is deterministic.
          const better = received
            ? !targetReceived || qk < keyOf(target)
            : !targetReceived && qk < k && (!target || qk < keyOf(target))
          if (better) {
            target = q
            targetReceived = received
          }
        }
      }
    }
    if (target) moved.set(k, target)
  }
  for (const [k, target] of moved) {
    let end = target
    for (let guard = 0; guard < 16; guard++) {
      const next = moved.get(keyOf(end))
      if (!next || next === end) break
      end = next
    }
    moved.set(k, end)
  }
  let snapped = 0
  if (moved.size > 0) {
    replaceIn(features, (p) => {
      const to = moved.get(keyOf(p))
      if (to) snapped++
      return to ?? p
    })
    for (const k of moved.keys()) fresh.delete(k)
  }

  const coarse = new Set()
  for (const p of fresh.values()) {
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) coarse.add(cellOf(p[0] + dx * CELL, p[1] + dy * CELL, CELL))
  }
  const indexEdges = () => {
    const byCell = new Map()
    for (const ring of ringsOf(features)) {
      for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1]
        const b = ring[i]
        if (a[0] === b[0] && a[1] === b[1]) continue
        for (const c of cellsAlong(a, b)) {
          if (!coarse.has(c)) continue
          const list = byCell.get(c)
          const edge = { ring, i, a, b }
          if (list) list.push(edge)
          else byCell.set(c, [edge])
        }
      }
    }
    return byCell
  }

  /*
   * The edges that may pass through a point: those filed in its cell or any cell around it.
   * An edge is filed where its half-cell samples fall, and a point on it is always within a
   * cell of a sample — but the sample's cell can be a diagonal neighbour of the point's.
   */
  const edgesNear = (byCell, p) => {
    const found = new Set()
    const cx = Math.floor(p[0] / CELL)
    const cy = Math.floor(p[1] / CELL)
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const e of byCell.get(`${cx + dx},${cy + dy}`) ?? []) found.add(e)
    return found
  }

  /* 2. One position per created point: exactly on the original edge it lies on. */
  let edgesByCell = indexEdges()
  const onto = new Map()
  for (const [k, p] of fresh) {
    let best = null
    for (const e of edgesNear(edgesByCell, p)) {
      if (createdKeys.has(keyOf(e.a)) || createdKeys.has(keyOf(e.b))) continue
      const hit = onEdge(p, e.a, e.b)
      if (hit && (!best || hit.d2 < best.d2)) best = { e, ...hit }
    }
    if (best) onto.set(k, [best.e.a[0] + best.t * (best.e.b[0] - best.e.a[0]), best.e.a[1] + best.t * (best.e.b[1] - best.e.a[1])])
  }
  if (onto.size > 0) replaceIn(features, (p) => onto.get(keyOf(p)) ?? p)
  const placedPoints = [...fresh.keys()].map((k) => onto.get(k) ?? fresh.get(k))

  /* 3. Every created point into every edge it lies on, in every ring. */
  /*
   * Into every edge it lies on — including an edge of a ring that already has the point
   * elsewhere: a strip joined to a piece can come back as a loop pinched at a vertex, and its
   * edge along the line still needs the crossings on it. `onEdge` leaves out a point at an
   * edge's end, so nothing goes in twice beside a vertex.
   */
  edgesByCell = indexEdges()
  const pending = new Map() // ring -> [{ i, t, p }]
  for (const q of placedPoints) {
    for (const e of edgesNear(edgesByCell, q)) {
      const hit = onEdge(q, e.a, e.b)
      if (!hit) continue
      const list = pending.get(e.ring)
      if (list) list.push({ i: e.i, t: hit.t, p: q })
      else pending.set(e.ring, [{ i: e.i, t: hit.t, p: q }])
    }
  }
  let inserted = 0
  for (const f of features) {
    f.polygons = f.polygons.map((polygon) =>
      polygon.map((ring) => {
        const hitsInRing = pending.get(ring)
        if (!hitsInRing) return ring
        const bySegment = new Map()
        for (const h of hitsInRing) {
          const list = bySegment.get(h.i)
          if (list) list.push(h)
          else bySegment.set(h.i, [h])
        }
        const out = [ring[0]]
        for (let i = 1; i < ring.length; i++) {
          const hits = bySegment.get(i)
          if (hits) {
            hits.sort((x, y) => x.t - y.t)
            for (const h of hits) {
              out.push(h.p)
              inserted++
            }
          }
          out.push(ring[i])
        }
        return out
      }),
    )
  }
  return { created: fresh.size + moved.size, snapped, placed: onto.size, inserted }
}

function replaceIn(features, map) {
  for (const f of features) {
    f.polygons = f.polygons.map((polygon) =>
      polygon.map((ring) => {
        const out = []
        for (const p of ring) {
          const q = map(p)
          const last = out[out.length - 1]
          if (last && last[0] === q[0] && last[1] === q[1]) continue
          out.push(q)
        }
        return out
      }),
    )
  }
}

/** The index cells a segment passes through, sampled at half a cell. */
function cellsAlong(a, b) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (CELL / 2)))
  const cells = new Set()
  for (let s = 0; s <= steps; s++) cells.add(cellOf(a[0] + (dx * s) / steps, a[1] + (dy * s) / steps, CELL))
  return [...cells]
}

/** Where along a–b the point p lies, when it lies on the edge within the tolerance, clear of its ends. */
function onEdge(p, a, b) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const length2 = dx * dx + dy * dy
  if (length2 === 0) return null
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length2
  if (t <= 0 || t >= 1) return null
  const ex = a[0] + t * dx - p[0]
  const ey = a[1] + t * dy - p[1]
  const d2 = ex * ex + ey * ey
  if (d2 > TOLERANCE * TOLERANCE) return null
  // Within the tolerance of an end it is that end, which the snapping above already settled.
  const ends = TOLERANCE * TOLERANCE
  if ((p[0] - a[0]) ** 2 + (p[1] - a[1]) ** 2 <= ends || (p[0] - b[0]) ** 2 + (p[1] - b[1]) ** 2 <= ends) return null
  return { t, d2 }
}
