/**
 * Outlines projected the way the data is actually stored: once per shared arc.
 *
 * Every dataset here is TopoJSON, where a border two units share is *one* arc that both
 * reference. Drawing entity by entity through `geoPath` throws that away: each border is
 * projected twice, once for each side, and each of d3's streams re-does the clipping and
 * resampling machinery around it. On Europe Administrative that is 1.68 million vertices of
 * work for 1.19 million distinct ones, about 1.4 seconds, and 26 MB of path text.
 *
 * Here each arc is projected once and the entities' paths are assembled from the results. It
 * is the same geography — the same source points through the same projection — and it is what
 * makes the two things below safe and cheap:
 *
 * **Shared borders stay shared, exactly.** Both sides of a border quote the same arc, so both
 * get the same points in the same places. That is what allows the second part:
 *
 * **Points that change no pixel are left out.** Douglas–Peucker, with the tolerance in screen
 * pixels: a point is kept when the line drawn without it would pass more than `tolerance` from
 * it. At the fitted view that takes Europe Administrative from 1.19 million source points to
 * 222,000 — the corners, without the straight runs between them — which is what the projection,
 * the path text, the memory and every frame's rasterising then cost. Simplifying per *arc*
 * rather than per entity is what keeps neighbours identical: a walk along each feature's own
 * ring would drop different points on the two sides of a border and open hairlines between
 * them. `tolerance` is 0 for every point, which is what exports and the deepest zooms ask for.
 *
 * **The projecting is done once per projection, not once per detail.** Zooming does not change
 * the projection — the camera is a transform over the drawn map — so when the detail steps
 * change, the same points would be projected again for nothing. Projecting and simplifying are
 * separate here (`projectTopologyArcs`, `simplifyArcs`) and `projectedLand.ts` keeps the
 * projected arcs, so a detail step costs the simplifying alone: on Europe Administrative about
 * 60 ms instead of 1.1 s, which is what a pinch that crosses a step has to pay.
 *
 * **Where this cannot be right, it says so.** `geoPath` also clips: to the antimeridian, to a
 * projection's horizon, to its clip extent. This does not clip at all, so an arc that crosses a
 * cut, or leaves the projectable world, is marked unusable and the caller draws that entity
 * with `geoPath` instead (`projectedLand.ts`). Nothing is approximated: an entity is either
 * assembled from arcs, exactly, or drawn the old way.
 */
import type { GeoProjection } from 'd3-geo'
import type { GeometryObject, Topology } from 'topojson-specification'

/** A projected arc: x, y pairs, or `null` where the arc cannot be drawn without clipping. */
type ProjectedArc = Float64Array | null

export interface ArcPaths {
  /** The projection these were made with, so a caller can check what it holds. */
  projection: GeoProjection
  /** Screen pixels: points nearer than this to the last kept point are left out. */
  tolerance: number
  /** How many source points were projected, and how many survived — for the report. */
  stats: { points: number; kept: number; unusableArcs: number }
  /**
   * The path for one topology geometry, or `null` when it crosses something that has to be
   * clipped and the caller should use `geoPath` for it.
   */
  path(geometry: GeometryObject): string | null
  /**
   * One stitched line of arcs — a border network's, from `meshArcs` — as an open path, or
   * `null` when one of its arcs has to be clipped.
   */
  line(indexes: number[]): string | null
}

/**
 * A jump longer than this fraction of the projection's own scale means the line left the map
 * and came back — the antimeridian, or a projection's horizon. Such an arc is handed back to
 * `geoPath`, which clips it properly.
 */
const CUT_FRACTION = 0.35

/**
 * How many decimals a coordinate is written with, from the detail it was simplified to.
 *
 * The camera scales what is drawn, so the rounding is scaled with it: a tenth of a pixel
 * written at the projection's scale is more than a pixel once the map is at 24x. These keep
 * the written error under a twentieth of the tolerance that detail level allows — and three
 * decimals, d3's own default, for the full-detail level the deepest zooms and exports use.
 */
const digitsFor = (tolerance: number) => (tolerance >= 0.2 ? 1 : tolerance > 0 ? 2 : 3)

/** Every arc of a topology, projected in full: the input `simplifyArcs` draws its detail from. */
export interface ProjectedArcs {
  /** The projection these were made with — identity and behaviour are both checked by callers. */
  projection: GeoProjection
  /** One entry per topology arc, `null` where it crosses something that has to be clipped. */
  arcs: ProjectedArc[]
  points: number
  unusableArcs: number
}

/**
 * How far a projected line may stray from the straight one drawn between two of its points
 * before a point is put in between — the same 0.5 px² d3's `geoPath` uses by default, since
 * this has to agree with it.
 */
const DELTA2 = 0.5
/** A turn wider than 30° between two points is subdivided whatever the distance, as in d3. */
const COS_MIN_DISTANCE = Math.cos(30 * (Math.PI / 180))
/** d3's own ceiling on the subdivision, which keeps a pathological segment from recursing away. */
const MAX_DEPTH = 16

/**
 * Projects every point of every arc once, resampling as `geoPath` does. Cache this: it depends
 * on the projection alone.
 *
 * The resampling is the part that cannot be left out. A projection bends a straight line, so
 * d3 walks each segment and puts a point at its geographic middle whenever the projected middle
 * strays from the chord — which is how a long line follows its true course instead of cutting
 * across it. Drawing arcs without it moved borders by more than a pixel on the longest segments
 * even at full detail. This is the same rule, applied to the same points, with the same
 * threshold: the midpoint of the two ends on the sphere, projected, and subdivided while it
 * misses the chord by more than `DELTA2`.
 */
export function projectTopologyArcs(topology: Topology, projection: GeoProjection): ProjectedArcs {
  const transform = topology.transform
  const [sx, sy] = transform?.scale ?? [1, 1]
  const [tx, ty] = transform?.translate ?? [0, 0]
  const scale = typeof projection.scale === 'function' ? projection.scale() : 1000
  const cut = Math.max(200, scale * CUT_FRACTION)
  const source = topology.arcs
  const arcs: ProjectedArc[] = new Array(source.length)
  let points = 0
  let unusableArcs = 0

  // Scratch for one arc's projected points, grown as resampling adds to them.
  let capacity = 1024
  let xs = new Float64Array(capacity * 2)
  let count = 0
  let usable = true

  const RADIANS = Math.PI / 180
  const push = (x: number, y: number) => {
    if (count >= capacity) {
      capacity *= 2
      const grown = new Float64Array(capacity * 2)
      grown.set(xs.subarray(0, count * 2))
      xs = grown
    }
    if (count > 0) {
      const jumpX = x - xs[(count - 1) * 2]
      const jumpY = y - xs[(count - 1) * 2 + 1]
      // A jump this long means the line left the map and came back: `geoPath` must clip it.
      if (jumpX * jumpX + jumpY * jumpY > cut * cut) usable = false
    }
    xs[count * 2] = x
    xs[count * 2 + 1] = y
    count++
  }

  /** The projected point, or null where the projection has nothing to say about it. */
  const at = (lon: number, lat: number): [number, number] | null => {
    const p = projection([lon, lat] as [number, number])
    points++
    return p && Number.isFinite(p[0]) && Number.isFinite(p[1]) ? (p as [number, number]) : null
  }

  /**
   * d3's own recursion, point for point: subdivide while the projected midpoint misses the
   * chord, sits far from its middle, or the two ends are more than 30° apart on the sphere.
   */
  const between = (
    x0: number, y0: number, lon0: number, a0: number, b0: number, c0: number,
    x1: number, y1: number, lon1: number, a1: number, b1: number, c1: number,
    depth: number,
  ): void => {
    const dx = x1 - x0
    const dy = y1 - y0
    const d2 = dx * dx + dy * dy
    if (!(d2 > 4 * DELTA2) || depth <= 0) return
    let a = a0 + a1
    let b = b0 + b1
    let c = c0 + c1
    const m = Math.sqrt(a * a + b * b + c * c)
    if (!(m > 0)) return
    c /= m
    const lat2 = Math.asin(c > 1 ? 1 : c < -1 ? -1 : c) / RADIANS
    const lon2 =
      Math.abs(Math.abs(c) - 1) < 1e-6 || Math.abs(lon0 - lon1) < 1e-6
        ? (lon0 + lon1) / 2
        : Math.atan2(b, a) / RADIANS
    const p = at(lon2, lat2)
    if (!p) {
      usable = false
      return
    }
    const x2 = p[0]
    const y2 = p[1]
    const dx2 = x2 - x0
    const dy2 = y2 - y0
    const dz = dy * dx2 - dx * dy2
    if (
      (dz * dz) / d2 > DELTA2 ||
      Math.abs((dx * dx2 + dy * dy2) / d2 - 0.5) > 0.3 ||
      a0 * a1 + b0 * b1 + c0 * c1 < COS_MIN_DISTANCE
    ) {
      a /= m
      b /= m
      between(x0, y0, lon0, a0, b0, c0, x2, y2, lon2, a, b, c, depth - 1)
      if (!usable) return
      push(x2, y2)
      between(x2, y2, lon2, a, b, c, x1, y1, lon1, a1, b1, c1, depth - 1)
    }
  }

  for (let arcIndex = 0; arcIndex < source.length; arcIndex++) {
    const arc = source[arcIndex]
    const n = arc.length
    if (n < 2) {
      arcs[arcIndex] = null
      unusableArcs++
      continue
    }
    count = 0
    usable = true
    let qx = 0
    let qy = 0
    let lastLon = 0
    let lastA = 0
    let lastB = 0
    let lastC = 0
    let lastX = 0
    let lastY = 0
    for (let i = 0; i < n && usable; i++) {
      const point = arc[i]
      if (transform) {
        qx += point[0]
        qy += point[1]
      } else {
        qx = point[0]
        qy = point[1]
      }
      const lon = tx + qx * sx
      const lat = ty + qy * sy
      const projected = at(lon, lat)
      if (!projected) {
        usable = false
        break
      }
      const rLon = lon * RADIANS
      const rLat = lat * RADIANS
      const cosLat = Math.cos(rLat)
      const ax = cosLat * Math.cos(rLon)
      const by = cosLat * Math.sin(rLon)
      const cz = Math.sin(rLat)
      if (i > 0) {
        between(lastX, lastY, lastLon, lastA, lastB, lastC, projected[0], projected[1], lon, ax, by, cz, MAX_DEPTH)
        if (!usable) break
      }
      push(projected[0], projected[1])
      lastLon = lon
      lastA = ax
      lastB = by
      lastC = cz
      lastX = projected[0]
      lastY = projected[1]
    }
    if (!usable || count < 2) {
      arcs[arcIndex] = null
      unusableArcs++
      continue
    }
    arcs[arcIndex] = xs.slice(0, count * 2)
  }

  return { projection, arcs, points, unusableArcs }
}

/**
 * Douglas–Peucker over already projected arcs, and the paths assembled from the result.
 *
 * The tolerance is in screen pixels: a point is kept when the line drawn without it would pass
 * more than `tolerance` from it. Dropping points merely because they sit close together — the
 * obvious rule — keeps every point of a long straight coast, which is most of them; this keeps
 * the corners and throws the straight runs away, for the same picture.
 *
 * Run per arc, so both sides of a shared border keep exactly the same points.
 */
export function simplifyArcs(source: ProjectedArcs, tolerance: number): ArcPaths {
  const tol2 = tolerance * tolerance
  const unit = 10 ** digitsFor(tolerance)
  const round = (v: number) => Math.round(v * unit) / unit
  const full = source.arcs
  const arcs: ProjectedArc[] = tolerance <= 0 ? full : new Array(full.length)
  const stats = { points: source.points, kept: 0, unusableArcs: source.unusableArcs }

  if (tolerance > 0) {
    let capacity = 1024
    let kept = new Uint8Array(capacity)
    const stack: number[] = []
    for (let a = 0; a < full.length; a++) {
      const xs = full[a]
      if (!xs) {
        arcs[a] = null
        continue
      }
      const n = xs.length / 2
      if (n <= 2) {
        arcs[a] = xs
        stats.kept += n
        continue
      }
      if (capacity < n) {
        capacity = n
        kept = new Uint8Array(capacity)
      }
      kept.fill(0, 0, n)
      kept[0] = 1
      kept[n - 1] = 1
      let count = 2
      stack.length = 0
      stack.push(0, n - 1)
      while (stack.length > 0) {
        const last = stack.pop() as number
        const first = stack.pop() as number
        if (last - first < 2) continue
        const ax = xs[first * 2]
        const ay = xs[first * 2 + 1]
        const bx = xs[last * 2]
        const by = xs[last * 2 + 1]
        const vx = bx - ax
        const vy = by - ay
        const length2 = vx * vx + vy * vy
        let worst = -1
        let at = -1
        for (let i = first + 1; i < last; i++) {
          const px = xs[i * 2] - ax
          const py = xs[i * 2 + 1] - ay
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

      /*
       * A ring of its own — an island — simplified to its two ends encloses nothing. Rather
       * than lose it, keep three points spread along it, so the smallest island keeps its
       * own shape.
       */
      if (count < 4 && n >= 4) {
        for (const i of [0, (n / 3) | 0, ((2 * n) / 3) | 0, n - 1]) {
          if (!kept[i]) {
            kept[i] = 1
            count++
          }
        }
      }

      const out = new Float64Array(count * 2)
      let at = 0
      for (let i = 0; i < n; i++) {
        if (!kept[i]) continue
        out[at * 2] = xs[i * 2]
        out[at * 2 + 1] = xs[i * 2 + 1]
        at++
      }
      stats.kept += count
      arcs[a] = out
    }
  } else {
    for (const xs of full) if (xs) stats.kept += xs.length / 2
  }

  /** One ring: its arcs in order, each after the first dropping the point it shares with the last. */
  const ring = (indexes: number[]): string | null => {
    let d = ''
    for (let k = 0; k < indexes.length; k++) {
      const index = indexes[k]
      const arc = arcs[index >= 0 ? index : ~index]
      if (!arc) return null
      const count = arc.length / 2
      if (index >= 0) {
        for (let i = k === 0 ? 0 : 1; i < count; i++) {
          d += (d === '' ? 'M' : 'L') + round(arc[i * 2]) + ',' + round(arc[i * 2 + 1])
        }
      } else {
        for (let i = k === 0 ? count - 1 : count - 2; i >= 0; i--) {
          d += (d === '' ? 'M' : 'L') + round(arc[i * 2]) + ',' + round(arc[i * 2 + 1])
        }
      }
    }
    return d === '' ? null : d + 'Z'
  }

  const path = (geometry: GeometryObject): string | null => {
    const polygons =
      geometry.type === 'Polygon'
        ? [geometry.arcs]
        : geometry.type === 'MultiPolygon'
          ? geometry.arcs
          : null
    if (!polygons) return null
    let d = ''
    for (const polygon of polygons) {
      for (const indexes of polygon) {
        const part = ring(indexes as number[])
        // An unusable arc anywhere in the entity: the whole entity goes to `geoPath`.
        if (part === null) return null
        d += part
      }
    }
    return d
  }

  /** The same walk as a ring, left open: a border is a line, not an outline. */
  const line = (indexes: number[]): string | null => {
    const d = ring(indexes)
    return d === null ? null : d.slice(0, -1)
  }

  return { projection: source.projection, tolerance, stats, path, line }
}

/** Both steps at once, for a caller with nothing to reuse. */
export function projectArcs(
  topology: Topology,
  projection: GeoProjection,
  tolerance: number,
): ArcPaths {
  return simplifyArcs(projectTopologyArcs(topology, projection), tolerance)
}
