/**
 * Polygon clipping for the administrative engine, on Clipper (Angus Johnson's, the
 * `clipper-lib` port).
 *
 * Clipper works in integers, which is what makes it dependable on real boundary data: two
 * sources' outlines crossing each other thousands of times, a coastline touching itself, a
 * district filed in pieces that overlap — floating-point sweep-line clippers lose their place
 * on exactly these and give up. Coordinates are scaled to a 2 cm grid, inside the range
 * Clipper computes with plain doubles.
 *
 * Fine enough to matter: a finer source's outline often runs within tens of metres of
 * Natural Earth's, and the strip between the two must survive clipping so it can be handed to
 * the unit beside it (see `split`). On a coarser grid it collapses, and the unit keeps the
 * other source's outline instead of Natural Earth's.
 *
 * Two things keep the result exact where it should be:
 *
 *   - collinear points are kept, and every output point that was an input point is given back
 *     its original coordinates — so a cut unit's coast and borders are the very points its
 *     neighbours hold;
 *   - every point clipping creates — where a finer source's line crosses an outline — is
 *     recorded in `created`, so the noding (`node.mjs`) knows exactly which points are new and
 *     puts each on every ring that runs through it.
 *
 * Polygons in and out are GeoJSON-style coordinate arrays: `[[ring, hole, ...], ...]`.
 */
import ClipperLib from 'clipper-lib'

const SCALE = 5e6

/** Points (as `[lon, lat]`) that clipping created rather than received, across every call. */
export const created = []

const pointKey = (X, Y) => `${X},${Y}`

function toPaths(polygons, originals) {
  const paths = []
  for (const polygon of polygons) {
    polygon.forEach((ring, index) => {
      const n = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.length - 1 : ring.length
      const path = []
      for (let i = 0; i < n; i++) {
        const X = Math.round(ring[i][0] * SCALE)
        const Y = Math.round(ring[i][1] * SCALE)
        const last = path[path.length - 1]
        if (last && last.X === X && last.Y === Y) continue
        path.push({ X, Y })
        const k = pointKey(X, Y)
        if (!originals.has(k)) originals.set(k, ring[i])
      }
      if (path.length < 3) return
      // Outer rings one way round, holes the other, so non-zero filling reads them right
      // whichever way the source wound them — and overlapping outer rings simply union.
      if (ClipperLib.Clipper.Orientation(path) !== (index === 0)) path.reverse()
      paths.push(path)
    })
  }
  return paths
}

function fromTree(tree, originals) {
  const back = (path) => {
    const ring = path.map(({ X, Y }) => {
      const original = originals.get(pointKey(X, Y))
      if (original) return [original[0], original[1]]
      const point = [X / SCALE, Y / SCALE]
      created.push(point)
      return point
    })
    if (ring.length > 0) ring.push([ring[0][0], ring[0][1]])
    return ring
  }
  return ClipperLib.JS.PolyTreeToExPolygons(tree)
    .filter((ex) => ex.outer.length >= 3)
    .map((ex) => [back(ex.outer), ...ex.holes.filter((h) => h.length >= 3).map(back)])
}

function run(type, subjects, clips) {
  const originals = new Map()
  const clipper = new ClipperLib.Clipper()
  clipper.PreserveCollinear = true
  for (const s of subjects) clipper.AddPaths(toPaths(s, originals), ClipperLib.PolyType.ptSubject, true)
  for (const c of clips) clipper.AddPaths(toPaths(c, originals), ClipperLib.PolyType.ptClip, true)
  const tree = new ClipperLib.PolyTree()
  const ok = clipper.Execute(type, tree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero)
  if (!ok) throw new Error('Clipper could not complete the operation')
  return fromTree(tree, originals)
}

export const intersection = (a, b) => run(ClipperLib.ClipType.ctIntersection, [a], [b])
export const difference = (a, ...b) => run(ClipperLib.ClipType.ctDifference, [a], b)
export const union = (...sets) => run(ClipperLib.ClipType.ctUnion, sets, [])
