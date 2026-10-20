/**
 * Borders made one line where two units' outlines run a few metres apart.
 *
 * `admin/node.mjs` puts every point the clipper created on each edge it lies on, which keeps a cut
 * shared by the two pieces either side of it. It does not touch the points the pieces came with,
 * and those are not always the same on both sides: OpenHistoricalMap draws some borders twice
 * (one way for each country), and simplifying each kept a slightly different set of points — one
 * side has a point 3–10 m off the other's straight edge. TopoJSON shares an edge only where both
 * sides have the very same points, so there neither side's edge was the other's, and the border
 * between them was drawn as two coasts, or not at all (Germany and Poland on the Oder in 1945,
 * Aden and Oman, Nejd and the Ottoman Empire).
 *
 * So: on the edges no other ring shares (a seam, or a coast), every point of another ring's
 * unshared edges that lies within `TOLERANCE_M` of it, between its ends, is put into it, in order
 * along it. Edges two rings already share are left exactly as they are: touching them broke
 * borders that were right (Kamerun and Nigeria, when a point went into one side only). Both sides then run through the same
 * points and share the edge. Nothing moves more than the tolerance — invisible at any zoom.
 * A ring's own points are never put into its own edges, and no point goes into a ring that
 * already passes through it elsewhere: either would pinch the ring (a ring through one point
 * twice), and a merge across a pinched ring takes a chord — Siam lost 158,000 km² that way.
 */

const TOLERANCE_M = 15
const M_PER_DEG = 111_320
const CELL = 0.02

const cellKey = (x, y) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`

/** Heals the rings of `pieces` ([{ polygons }]) in place. Returns how many points were put in. */
export function healSeams(pieces) {
  // Every ring, and every point of it in a grid.
  const rings = []
  for (const piece of pieces) for (const polygon of piece.polygons) for (const ring of polygon) rings.push(ring)
  // Which edges two rings share: those are right already.
  const pk = (p) => `${p[0]},${p[1]}`
  const edgeKey = (a, b) => {
    const x = pk(a)
    const y = pk(b)
    return x < y ? `${x}|${y}` : `${y}|${x}`
  }
  const edgeUses = new Map()
  for (const ring of rings) for (let i = 1; i < ring.length; i++) edgeUses.set(edgeKey(ring[i - 1], ring[i]), (edgeUses.get(edgeKey(ring[i - 1], ring[i])) ?? 0) + 1)
  let unshared = (a, b) => edgeUses.get(edgeKey(a, b)) === 1

  /*
   * First, spikes on unshared edges: a point the outline runs out to and straight back from,
   * within the tolerance — Luxembourg's 300 m needle into Germany in 1945, which left its edge
   * A → tip → B where Germany's runs A → B. Taken out, the two edges are the same.
   */
  const tol = TOLERANCE_M / M_PER_DEG
  const nearSegment = (p, a, b) => {
    const kx = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180)
    const dx = (b[0] - a[0]) * kx
    const dy = b[1] - a[1]
    const len2 = dx * dx + dy * dy
    if (len2 === 0) return false
    const px = (p[0] - a[0]) * kx
    const py = p[1] - a[1]
    const t = (px * dx + py * dy) / len2
    if (t <= 0 || t >= 1) return false
    const ex = px - t * dx
    const ey = py - t * dy
    return ex * ex + ey * ey <= tol * tol
  }
  let spikes = 0
  for (const ring of rings) {
    for (let changed = true; changed && ring.length > 4; ) {
      changed = false
      const open = ring.slice(0, -1)
      for (let i = 0; i < open.length && open.length > 3; i++) {
        const a = open[(i - 1 + open.length) % open.length]
        const s = open[i]
        const b = open[(i + 1) % open.length]
        if (!unshared(a, s) || !unshared(s, b)) continue
        if (nearSegment(b, a, s) || nearSegment(a, s, b)) {
          open.splice(i, 1)
          spikes++
          changed = true
          break
        }
      }
      if (changed) ring.splice(0, ring.length, ...open, open[0])
    }
  }
  if (spikes > 0) {
    edgeUses.clear()
    for (const ring of rings) for (let i = 1; i < ring.length; i++) edgeUses.set(edgeKey(ring[i - 1], ring[i]), (edgeUses.get(edgeKey(ring[i - 1], ring[i])) ?? 0) + 1)
    unshared = (a, b) => edgeUses.get(edgeKey(a, b)) === 1
  }

  // The points that end an unshared edge: the only ones that can be the other side of a seam.
  const grid = new Map()
  rings.forEach((ring, r) => {
    for (let i = 0; i < ring.length - 1; i++) {
      const p = ring[i]
      const prev = ring[i === 0 ? ring.length - 2 : i - 1]
      if (!unshared(prev, p) && !unshared(p, ring[i + 1])) continue
      const k = cellKey(p[0], p[1])
      const list = grid.get(k)
      if (list) list.push([p, r])
      else grid.set(k, [[p, r]])
    }
  })

  let inserted = 0
  rings.forEach((ring, r) => {
    const has = new Set(ring.map((p) => `${p[0]},${p[1]}`))
    const out = [ring[0]]
    for (let i = 1; i < ring.length; i++) {
      const a = ring[i - 1]
      const b = ring[i]
      const kx = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180)
      const dx = (b[0] - a[0]) * kx
      const dy = b[1] - a[1]
      const len2 = dx * dx + dy * dy
      const tol = TOLERANCE_M / M_PER_DEG
      const found = []
      if (len2 > 0 && unshared(a, b)) {
        // The cells the edge crosses, and those around them.
        const seen = new Set()
        const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (CELL / 2)))
        for (let s = 0; s <= steps; s++) {
          const x = a[0] + ((b[0] - a[0]) * s) / steps
          const y = a[1] + ((b[1] - a[1]) * s) / steps
          for (let ox = -1; ox <= 1; ox++) {
            for (let oy = -1; oy <= 1; oy++) {
              const k = cellKey(x + ox * CELL, y + oy * CELL)
              if (seen.has(k)) continue
              seen.add(k)
              for (const [p, owner] of grid.get(k) ?? []) {
                if (owner === r) continue
                if ((p[0] === a[0] && p[1] === a[1]) || (p[0] === b[0] && p[1] === b[1])) continue
                const px = (p[0] - a[0]) * kx
                const py = p[1] - a[1]
                const t = (px * dx + py * dy) / len2
                if (t <= 1e-9 || t >= 1 - 1e-9) continue
                const ex = px - t * dx
                const ey = py - t * dy
                if (ex * ex + ey * ey <= tol * tol) found.push([t, p])
              }
            }
          }
        }
      }
      if (found.length) {
        found.sort((x, y) => x[0] - y[0])
        let last = a
        for (const [, p] of found) {
          if (p[0] === last[0] && p[1] === last[1]) continue
          const key = `${p[0]},${p[1]}`
          if (has.has(key)) continue
          has.add(key)
          out.push([p[0], p[1]])
          last = p
          inserted++
        }
      }
      out.push(b)
    }
    if (out.length !== ring.length) ring.splice(0, ring.length, ...out)
  })
  return inserted
}
