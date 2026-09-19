/**
 * Rings that pass through a vertex twice, split there into rings that do not.
 *
 * Clipping can return a ring pinched at a point: an area whose two parts touch at one vertex,
 * held as a single ring through it twice. TopoJSON pairs a pinched ring with a pinched ring
 * and a simple ring with a simple ring, but not one with the other, and a merge of a country
 * across a pinched ring takes a chord through it: joining Germany's areas dropped 440 points of
 * its border on the Oder, so the two sides of the border stopped being one arc. Split, every
 * ring is simple and the border is shared again.
 *
 * The same treatment the official USA map gives its counties (`scripts/usa/build-usa.mjs`,
 * `unpinched`), here as a module of its own. A pinched outer ring becomes two polygons, each
 * keeping the holes inside it; a pinched hole becomes two holes.
 */
import { interiorPoint } from '../admin/geometry.mjs'

function splitRing(ring) {
  const out = []
  let stack = []
  const seen = new Map()
  for (const p of ring.slice(0, -1)) {
    const k = `${p[0]},${p[1]}`
    if (seen.has(k)) {
      const loop = stack.slice(seen.get(k))
      stack = stack.slice(0, seen.get(k))
      for (const q of loop) seen.delete(`${q[0]},${q[1]}`)
      if (loop.length >= 3) out.push([...loop, loop[0]])
    }
    seen.set(k, stack.length)
    stack.push(p)
  }
  if (stack.length >= 3) out.push([...stack, stack[0]])
  return out
}

function insideRing(point, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > point[1] !== yj > point[1] && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Polygons with no pinched ring, and how many splits that took. */
export function unpinched(polygons) {
  let split = 0
  const out = []
  for (const [outer, ...holes] of polygons) {
    const outers = splitRing(outer)
    const inner = holes.flatMap((hole) => {
      const parts = splitRing(hole)
      split += Math.max(0, parts.length - 1)
      return parts
    })
    split += Math.max(0, outers.length - 1)
    if (outers.length === 1) {
      out.push([outers[0], ...inner])
      continue
    }
    const pieces = outers.map((ring) => [ring])
    for (const hole of inner) {
      const point = interiorPoint([[hole]])
      const home = pieces.find(([ring]) => point && insideRing(point, ring)) ?? pieces[0]
      home.push(hole)
    }
    out.push(...pieces)
  }
  return { polygons: out, split }
}
