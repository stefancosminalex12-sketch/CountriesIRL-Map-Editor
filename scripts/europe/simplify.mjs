/**
 * Simplifies a TopoJSON topology arc by arc.
 *
 * Arcs, not polygons: a border is one arc that both neighbours use, so simplifying it once
 * changes both sides identically and the map can never open a gap or an overlap along it.
 * Douglas–Peucker with the tolerance in metres on the ground (longitude scaled by the
 * latitude), endpoints always kept, since they are where three units meet.
 *
 * Nothing disappears. An arc that has points between its ends keeps at least one (two for a
 * closed arc, which is a whole ring on its own), so the smallest island still has an outline
 * and a ring made of two arcs still encloses ground.
 */
import { geoArea } from 'd3-geo'

const toRad = Math.PI / 180

export function simplifyTopology(topology, toleranceMetres) {
  if (!(toleranceMetres > 0)) return topology
  const [sx, sy] = topology.transform.scale
  const [tx, ty] = topology.transform.translate
  const tolDeg = toleranceMetres / 111195
  const arcs = topology.arcs.map((arc) => {
    // Decode.
    let x = 0
    let y = 0
    const q = arc.map(([dx, dy]) => [(x += dx), (y += dy)])
    if (q.length <= 2) return arc
    const pts = q.map(([qx, qy]) => [tx + qx * sx, ty + qy * sy])
    const closed = q[0][0] === q[q.length - 1][0] && q[0][1] === q[q.length - 1][1]
    const keep = new Uint8Array(q.length)
    keep[0] = 1
    keep[q.length - 1] = 1
    const cos = Math.cos(((pts[0][1] + pts[pts.length - 1][1]) / 2) * toRad)
    const stack = [[0, q.length - 1]]
    while (stack.length) {
      const [a, b] = stack.pop()
      let worst = -1
      let at = -1
      const [ax, ay] = pts[a]
      const [bx, by] = pts[b]
      const vx = (bx - ax) * cos
      const vy = by - ay
      const l2 = vx * vx + vy * vy
      for (let i = a + 1; i < b; i++) {
        const px = (pts[i][0] - ax) * cos
        const py = pts[i][1] - ay
        const t = l2 ? Math.max(0, Math.min(1, (px * vx + py * vy) / l2)) : 0
        const d = Math.hypot(px - t * vx, py - t * vy)
        if (d > worst) (worst = d), (at = i)
      }
      if (at > 0 && worst > tolDeg) {
        keep[at] = 1
        stack.push([a, at], [at, b])
      }
    }
    // Never fewer than the ring needs: one point between the ends, two for a closed arc.
    const needed = closed ? 2 : 1
    let inner = 0
    for (let i = 1; i < q.length - 1; i++) inner += keep[i]
    if (inner < needed) {
      // The points farthest from the ends, in order along the arc.
      const ranked = []
      for (let i = 1; i < q.length - 1; i++) {
        const d0 = Math.hypot((pts[i][0] - pts[0][0]) * cos, pts[i][1] - pts[0][1])
        ranked.push([d0, i])
      }
      ranked.sort((m, n) => n[0] - m[0])
      if (closed) {
        keep[ranked[0][1]] = 1
        // The second: the farthest from both the start and the first pick.
        const first = pts[ranked[0][1]]
        let best = -1
        let pick = -1
        for (let i = 1; i < q.length - 1; i++) {
          if (keep[i]) continue
          const d = Math.min(
            Math.hypot((pts[i][0] - first[0]) * cos, pts[i][1] - first[1]),
            Math.hypot((pts[i][0] - pts[0][0]) * cos, pts[i][1] - pts[0][1]),
          )
          if (d > best) (best = d), (pick = i)
        }
        if (pick > 0) keep[pick] = 1
      } else {
        keep[ranked[0][1]] = 1
      }
    }
    // Re-encode as deltas.
    const out = []
    let px = 0
    let py = 0
    for (let i = 0; i < q.length; i++) {
      if (!keep[i]) continue
      out.push([q[i][0] - px, q[i][1] - py])
      px = q[i][0]
      py = q[i][1]
    }
    return out
  })
  return { ...topology, arcs }
}

export const pointCount = (topology) => topology.arcs.reduce((sum, arc) => sum + arc.length, 0)

/**
 * The same hygiene the editor's loader gives every dataset (`src/geo/repair.ts`), done once at
 * build time so the files are clean on their own: a ring that quantisation or simplification
 * left with fewer than three distinct corners encloses nothing and is dropped, and a polygon
 * read as covering more than half the globe is turned the right way round.
 */

export function cleanTopology(topology) {
  const [sx, sy] = topology.transform.scale
  const [tx, ty] = topology.transform.translate
  const absolute = topology.arcs.map((arc) => {
    let x = 0
    let y = 0
    return arc.map(([dx, dy]) => [tx + (x += dx) * sx, ty + (y += dy) * sy])
  })
  const coords = (ring) => {
    const out = []
    ring.forEach((a, k) => {
      const pts = a >= 0 ? absolute[a] : [...absolute[~a]].reverse()
      out.push(...(k ? pts.slice(1) : pts))
    })
    return out
  }
  const corners = (ring) => new Set(ring.map((p) => `${p[0]},${p[1]}`)).size
  const report = { droppedPolygons: 0, droppedHoles: 0, turned: 0, emptied: [] }
  for (const g of topology.objects.units.geometries) {
    if (g.type !== 'Polygon' && g.type !== 'MultiPolygon') continue
    const polygons = g.type === 'Polygon' ? [g.arcs] : g.arcs
    const kept = []
    for (const polygon of polygons) {
      if (corners(coords(polygon[0])) < 3) {
        report.droppedPolygons++
        continue
      }
      let rings = [polygon[0]]
      for (const hole of polygon.slice(1)) {
        if (corners(coords(hole)) < 3) report.droppedHoles++
        else rings.push(hole)
      }
      if (geoArea({ type: 'Polygon', coordinates: rings.map(coords) }) > 2 * Math.PI) {
        rings = rings.map((ring) => [...ring].reverse().map((a) => ~a))
        report.turned++
      }
      kept.push(rings)
    }
    if (kept.length === 0) report.emptied.push(g.id)
    g.type = 'MultiPolygon'
    g.arcs = kept
  }
  return report
}
