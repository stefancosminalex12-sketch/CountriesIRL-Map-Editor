/**
 * The land around Europe, so a map of Europe does not float in an empty sea.
 *
 * EuroGlobalMap stops at Europe: North Africa, the Middle East, Kazakhstan and Russia east of
 * 51°E are not in it, yet they are on every map framed on Europe. They come from the World
 * map's own Natural Earth countries (public domain), as whole countries, and meet
 * EuroGlobalMap's borders without a gap or an overlap:
 *
 *   - each is first given a few kilometres of the land beside it (its outline grown, then held
 *     to Natural Earth's land), so it reaches past any border Natural Earth draws short;
 *   - then everything EuroGlobalMap holds is taken away, so it stops exactly at
 *     EuroGlobalMap's border.
 *
 * The border between a European country and its neighbour is therefore always
 * EuroGlobalMap's, and the neighbour fills the ground up to it.
 */
import ClipperLib from 'clipper-lib'
import * as clip from '../admin/clip.mjs'
import { boundsOf, boxesMeet, despiked, oriented } from '../admin/geometry.mjs'

const SCALE = 5e6

/** A polygon set grown by `km` on every side (round joins), for reaching across a strip. */
export function grown(polygons, km) {
  const offset = new ClipperLib.ClipperOffset(2, 0.25 * SCALE * 1e-5)
  for (const polygon of polygons) {
    polygon.forEach((ring, index) => {
      const path = ring.slice(0, -1).map(([x, y]) => ({ X: Math.round(x * SCALE), Y: Math.round(y * SCALE) }))
      if (path.length < 3) return
      if (ClipperLib.Clipper.Orientation(path) !== (index === 0)) path.reverse()
      offset.AddPath(path, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon)
    })
  }
  const lat = (() => {
    const b = boundsOf(polygons)
    return (b[1] + b[3]) / 2
  })()
  // Degrees of latitude; longitude is stretched by the latitude, so the ring is a little
  // wider east–west than north–south. Only its reach matters, not its exact shape.
  const delta = (km / 111.195) * SCALE / Math.max(0.3, Math.cos((lat * Math.PI) / 180)) ** 0.5
  const tree = new ClipperLib.PolyTree()
  offset.Execute(tree, delta)
  return ClipperLib.JS.PolyTreeToExPolygons(tree)
    .filter((ex) => ex.outer.length >= 3)
    .map((ex) => [ex.outer, ...ex.holes].map((path) => {
      const ring = path.map(({ X, Y }) => [X / SCALE, Y / SCALE])
      ring.push([ring[0][0], ring[0][1]])
      return ring
    }))
}

/**
 * Neighbours cut to meet `europe` exactly.
 *
 * `neighbours`: `[{ id, polygons }]` from Natural Earth, in order (earlier ones keep contested
 * ground). `neLand`: every Natural Earth polygon near them, whoever holds it, which is the land a
 * neighbour may grow into. `europe`: EuroGlobalMap's countries, `[{ id, polygons }]`.
 */
export function fitNeighbours(neighbours, neLand, europe, { reachKm = 4 } = {}) {
  const placed = []
  const report = []
  for (const n of neighbours) {
    const box = boundsOf(n.polygons)
    const pad = 0.5
    const near = (list) => list.filter((x) => boxesMeet(x.box ?? (x.box = boundsOf(x.polygons)), box, pad)).flatMap((x) => x.polygons)
    // Natural Earth draws a few countries in overlapping pieces (Egypt across the Halaib
    // triangle): one union first, so the neighbour is one clean outline.
    let polygons = clip.union(n.polygons)
    const europeNear = near(europe)
    if (europeNear.length > 0) {
      // Reach across whatever strip lies between the two sources' borders, over land only.
      const reach = clip.intersection(grown(n.polygons, reachKm), near(neLand))
      polygons = clip.union(polygons, reach)
      polygons = clip.difference(polygons, europeNear)
    }
    const others = near(placed)
    if (others.length > 0) polygons = clip.difference(polygons, others)
    // No zero-width retraces (one ran 115 km along Egypt's 22nd parallel).
    polygons = despiked(polygons).map(oriented)
    placed.push({ id: n.id, polygons, box: boundsOf(polygons) })
    report.push({ id: n.id, touchesEurope: europeNear.length > 0 })
  }
  return { placed, report }
}
