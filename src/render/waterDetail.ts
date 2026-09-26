/**
 * The lakes and the rivers, drawn at the detail the land is drawn at.
 *
 * The land has long been drawn from points that change a pixel and no others: each arc is
 * simplified with a tolerance in screen pixels that follows the settled zoom, and every point
 * comes back at full detail for an export or the deepest zooms (`arcPaths.ts`, `landDetail.ts`).
 * The lakes and the rivers never were. They went to the screen at their source's full detail
 * at every zoom — on the World map at 10m, 3.4 MB of lake outline where the land, drawn to the
 * same standard of accuracy, is a fraction of that — and every zoom frame rasterised all of it:
 * on the World map, 70 % of a zoom frame's GPU time was the lakes.
 *
 * This applies the land's rule to them, unchanged: the same tolerance, from the same place (the
 * land on screen reports the tolerance it was drawn with), the same Douglas–Peucker test, the
 * same keeping of every small ring's shape, the same rounding for that tolerance, and every
 * point at an export. A lake is drawn to exactly the accuracy of the shore of the country
 * around it — never coarser than the land it sits in.
 *
 * Two steps, as for the land. Projecting is the expensive one and depends on the projection
 * alone (`projectWater`); simplifying and writing depends on the tolerance as well
 * (`waterPaths`), so a detail step costs the second step only. At tolerance 0 the text written
 * is character for character what `geoPath` writes, because the points are `geoPath`'s own —
 * collected from it through a drawing context, resampling, clipping and all.
 */
import { geoPath, type GeoProjection } from 'd3-geo'
import type { Feature } from 'geojson'
import type { PathPiece } from './pathChunks'

/** One projected line: x, y pairs, and whether it is a closed ring (a polygon's). */
interface ProjectedLine {
  xy: Float64Array
  closed: boolean
}

/** Every feature's lines, projected in full: the input `waterPaths` draws its detail from. */
export interface ProjectedWater {
  projection: GeoProjection
  features: ProjectedLine[][]
}

/**
 * Projects every feature once, through `geoPath` itself.
 *
 * `geoPath` with a drawing context hands over the very points it would have written — after
 * its resampling and its clipping — so nothing about which points exist, or where, is decided
 * here.
 */
export function projectWater(features: readonly Feature[], projection: GeoProjection): ProjectedWater {
  let lines: ProjectedLine[] = []
  let points: number[] = []
  const finish = (closed: boolean) => {
    if (points.length >= 2) lines.push({ xy: Float64Array.from(points), closed })
    points = []
  }
  const context = {
    beginPath() {},
    moveTo(x: number, y: number) {
      finish(false)
      points.push(x, y)
    },
    lineTo(x: number, y: number) {
      points.push(x, y)
    },
    closePath() {
      finish(true)
    },
    // A point geometry. Lakes and rivers have none; it is drawn whole if one ever appears.
    arc() {},
  }
  const path = geoPath(projection, context as unknown as CanvasRenderingContext2D)
  const out: ProjectedLine[][] = []
  for (const feature of features) {
    lines = []
    points = []
    path(feature as Parameters<typeof path>[0])
    finish(false)
    out.push(lines)
  }
  return { projection, features: out }
}

/** The land's own rounding for a tolerance — see `digitsFor` in `arcPaths.ts`. */
const digitsFor = (tolerance: number) => (tolerance >= 0.2 ? 1 : tolerance > 0 ? 2 : 3)

/**
 * Which points of one line to keep: Douglas–Peucker at `tolerance`, exactly as `simplifyArcs`
 * does it — ends always kept, and a ring that would shrink below four points keeps four spread
 * along it, so the smallest lake keeps its own shape.
 */
function keptPoints(xy: Float64Array, tol2: number, closed: boolean): Uint8Array | null {
  const n = xy.length / 2
  if (n <= 2 || tol2 <= 0) return null
  const kept = new Uint8Array(n)
  kept[0] = 1
  kept[n - 1] = 1
  let count = 2
  const stack = [0, n - 1]
  while (stack.length > 0) {
    const last = stack.pop() as number
    const first = stack.pop() as number
    if (last - first < 2) continue
    const ax = xy[first * 2]
    const ay = xy[first * 2 + 1]
    const vx = xy[last * 2] - ax
    const vy = xy[last * 2 + 1] - ay
    const length2 = vx * vx + vy * vy
    let worst = -1
    let at = -1
    for (let i = first + 1; i < last; i++) {
      const px = xy[i * 2] - ax
      const py = xy[i * 2 + 1] - ay
      let d: number
      if (length2 === 0) {
        d = px * px + py * py
      } else {
        const t = (px * vx + py * vy) / length2
        const cx = px - (t < 0 ? 0 : t > 1 ? 1 : t) * vx
        const cy = py - (t < 0 ? 0 : t > 1 ? 1 : t) * vy
        d = cx * cx + cy * cy
      }
      if (d > worst) {
        worst = d
        at = i
      }
    }
    if (at > 0 && worst > tol2) {
      kept[at] = 1
      count++
      stack.push(first, at, at, last)
    }
  }
  if (closed && count < 4 && n >= 4) {
    for (const i of [0, (n / 3) | 0, ((2 * n) / 3) | 0, n - 1]) kept[i] = 1
  }
  return kept
}

/**
 * Each feature as one path at `tolerance`, with the box it covers, ready for `chunkPieces`.
 * Features that draw nothing are left out.
 */
export function waterPaths(source: ProjectedWater, tolerance: number): PathPiece[] {
  const tol2 = tolerance > 0 ? tolerance * tolerance : 0
  const unit = 10 ** digitsFor(tolerance)
  const round = (v: number) => Math.round(v * unit) / unit
  const pieces: PathPiece[] = []
  for (const lines of source.features) {
    let d = ''
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const { xy, closed } of lines) {
      const kept = keptPoints(xy, tol2, closed)
      const n = xy.length / 2
      let first = true
      for (let i = 0; i < n; i++) {
        if (kept && !kept[i]) continue
        const x = xy[i * 2]
        const y = xy[i * 2 + 1]
        d += (first ? 'M' : 'L') + round(x) + ',' + round(y)
        first = false
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
      if (closed) d += 'Z'
    }
    if (d) pieces.push({ d, x0, y0, x1, y1 })
  }
  return pieces
}
