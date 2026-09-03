/**
 * Turns a resolved framing + viewport size into a configured d3 projection.
 *
 * Fitting always uses a uniform scale, so geographic proportions are preserved —
 * the composition is cropped to the region, never stretched to fill the viewport.
 */
import { geoPath, type GeoProjection } from 'd3-geo'
import type { MultiPoint } from 'geojson'
import { getProjectionDef, resolveProjectionId } from './projections'
import type { ResolvedFraming } from './framing'
import type { BBox } from './regions'
import type { ProjectionId } from '../types/map'

/** Mercator cannot represent the poles; clamp the fit target into a usable band. */
function clampForMercator(target: MultiPoint): MultiPoint {
  return {
    type: 'MultiPoint',
    coordinates: target.coordinates.filter(([, lat]) => lat >= -80 && lat <= 80),
  }
}

/**
 * The subset of the fit target the letterbox fill is not allowed to crop.
 *
 * Fit-target longitudes are already normalised into the framing's own frame, which
 * may run past +/-180 for a scope crossing the antimeridian, so the box is shifted
 * by whole turns to meet them there.
 *
 * Returns indices rather than a new geometry, so the caller can read the matching
 * area weights off the parallel array without re-deriving them.
 *
 * Falls back to the whole target whenever the box would leave the camera with
 * nothing to anchor on — a region whose keep box misses the loaded dataset's
 * geometry gets the conservative framing rather than an arbitrary one.
 */
function keepIndices(target: MultiPoint, keep: BBox | undefined, centerLon: number): number[] | null {
  if (!keep) return null

  let [west, south, east, north] = keep
  while ((west + east) / 2 - centerLon > 180) {
    west -= 360
    east -= 360
  }
  while (centerLon - (west + east) / 2 > 180) {
    west += 360
    east += 360
  }

  const indices: number[] = []
  target.coordinates.forEach(([lon, lat], i) => {
    if (lon >= west && lon <= east && lat >= south && lat <= north) indices.push(i)
  })
  return indices.length >= 2 ? indices : null
}

/**
 * Where the framed target sits on one axis after the fill has scaled it.
 *
 * The target is centred, and then slid the shortest distance that brings the kept
 * geography back inside the viewport. Cropping therefore comes off whichever side
 * is actually carrying the surplus — for Europe the steppe on the right, never
 * Portugal on the left — and only as far as the overflow demands. When nothing is
 * croppable the two are the same geometry and the slide is zero, so the region
 * lands exactly where a plain centring puts it.
 */
function placement(
  full: [number, number],
  kept: [number, number],
  size: number,
  residual: number,
): number {
  let shift = size / 2 - (full[0] + full[1]) / 2
  if (kept[0] + shift < residual) shift = residual - kept[0]
  else if (kept[1] + shift > size - residual) shift = size - residual - kept[1]
  return shift
}

/** Breathing room always kept between the framed region and the viewport edge. */
const RESIDUAL_MARGIN = 0.02

/**
 * How much of a region's area the camera may push off screen at each end of an axis.
 *
 * This is the one number the fill policy needs, and it is deliberately expressed in
 * *area* rather than in degrees, pixels or zoom. A zoom constant would mean the same
 * multiplier for Africa and for Europe under nine different projections, which is
 * exactly the framing that made every region look loose in some projections and
 * cropped in others. A share of area asks the question that actually matters — "how
 * much of this region leaves the frame if I zoom in?" — and every region and
 * projection answers it differently from its own geometry.
 *
 * At 0.4% per end, what is spendable is genuinely fringe: the outer scatter of an
 * archipelago, a peninsula's last kilometres, the far tail of a steppe. A continent
 * whose edges are mainland coast — Africa top to bottom, South America — has almost
 * no mass out there, so its core is nearly its full extent and it barely moves,
 * which is the correct answer rather than a special case for it.
 */
const CROPPABLE_AREA_TAIL = 0.004

/**
 * How far the framed region may extend past the viewport, as a share of the viewport
 * on each edge.
 *
 * The area core answers "what may I push off screen"; this answers "how far past the
 * edge may the rest of it go", and the two are not the same question. The core is a
 * share of *area*, so a region whose outer geography is thin — a peninsula, an island
 * arc, a tapering steppe — can put a great deal of *extent* outside the frame while
 * spending almost no area, and the core will not object.
 *
 * That gap was invisible while the viewport happened to be the binding axis. `limit`
 * takes the smaller of the two axes' room, so when one axis has slack the fill spends
 * it by scaling until the other binds — and widening the map from 963 to 1224px handed
 * the horizontal axis so much slack that Europe came out at 2.9x the viewport wide and
 * 3.7x its height, a quarter of its vertices off screen.
 *
 * So the scale is capped by the region's whole projected extent as well as by its core.
 * A small allowance rather than none: cropping the outermost fringe is what makes a
 * continent map look composed instead of letterboxed, and 6% a side is about the coast
 * of a peninsula, not a country.
 */
const EDGE_OVERFLOW_ALLOWANCE = 0.06

/** Projected fit points and the area each one carries. */
interface Cloud {
  xs: number[]
  ys: number[]
  weights: number[]
}

/** Projects the fit target once, dropping anything the projection cannot place. */
function projectCloud(
  projection: GeoProjection,
  target: MultiPoint,
  weights: number[],
): Cloud {
  const xs: number[] = []
  const ys: number[] = []
  const w: number[] = []
  target.coordinates.forEach((coordinate, i) => {
    const point = projection(coordinate as [number, number])
    if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) return
    xs.push(point[0])
    ys.push(point[1])
    // A fallback window carries no weights; every point then counts the same.
    w.push(weights[i] ?? 1)
  })
  return { xs, ys, weights: w }
}

/** The smallest interval containing both, ignoring an absent second one. */
function union(a: [number, number], b: [number, number] | null | undefined): [number, number] {
  if (!b) return a
  return [Math.min(a[0], b[0]), Math.max(a[1], b[1])]
}

/** Like {@link extent}, but absent rather than infinite when there is nothing to bound. */
function extentOrNull(values: number[]): [number, number] | null {
  return values.length > 0 ? extent(values) : null
}

function extent(values: number[]): [number, number] {
  let lo = Infinity
  let hi = -Infinity
  for (const v of values) {
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  return [lo, hi]
}

/**
 * The interval on one axis holding all but `tail` of the region's area at each end.
 *
 * A weighted quantile, computed on projected coordinates so the answer belongs to
 * the projection actually in use: Nell-Hammer squeezes Europe's latitudes into a
 * third of the height Robinson gives them, and the two therefore have different
 * cores over identical geography, which is the entire point.
 */
function coreInterval(values: number[], weights: number[], tail: number): [number, number] {
  if (values.length === 0) return [0, 0]

  let total = 0
  for (const weight of weights) total += weight
  const span = extent(values)
  if (!(total > 0) || tail <= 0) return span

  const order = values.map((_, i) => i).sort((a, b) => values[a] - values[b])
  const lowMark = total * tail
  const highMark = total * (1 - tail)

  let low = span[0]
  let high = span[1]
  let seenLow = false
  let accumulated = 0

  for (const i of order) {
    accumulated += weights[i]
    if (!seenLow && accumulated >= lowMark) {
      low = values[i]
      seenLow = true
    }
    if (accumulated >= highMark) {
      high = values[i]
      break
    }
  }

  return low <= high ? [low, high] : span
}

export interface ProjectionSpec {
  framing: ResolvedFraming
  /** Overrides the framing's own projection when the author picked one. */
  projectionId: ProjectionId | 'auto'
  width: number
  height: number
  padding: number
}

/*
 * The projection is fitted to the canvas, and deliberately knows nothing about the
 * composition frame.
 *
 * It briefly did: the region was fitted to the Screen's rectangle, which made the
 * aspect-awareness fall out for free — and made switching the Screen on re-frame the
 * map, which is precisely what a frame must not do. A frame is placed *over* a
 * composition; it does not decide one. The Screen sizes itself to the projected region
 * instead, which is the same geometry read the other way round.
 */
export function buildProjection(spec: ProjectionSpec): GeoProjection {
  const { framing, width, height } = spec
  const projectionId = resolveProjectionId(spec.projectionId)
  const def = getProjectionDef(projectionId)
  const projection = def.factory()

  projection.rotate([-framing.centerLon, 0])

  if (def.conic && framing.parallels && 'parallels' in projection) {
    ;(projection as GeoProjection & { parallels(p: [number, number]): unknown }).parallels(
      framing.parallels,
    )
  }

  let target = framing.fitTarget
  if (projectionId === 'mercator') {
    const clamped = clampForMercator(target)
    if (clamped.coordinates.length > 0) target = clamped
  }

  // The region's margin is applied as viewport padding rather than by inflating the
  // geographic window, so it adds breathing room without altering the geometry.
  /*
   * On a phone the document's 32px is not breathing room, it is a fifth of the map:
   * 32px either side of a 345px canvas leaves 275px to draw the world in. Below 480px on
   * the short side the padding is capped at 10 — enough to keep a coastline off the edge,
   * and it gives the map back about a sixth of its size.
   *
   * Gated on the viewport rather than applied everywhere, because the desktop value is
   * the one every region's framing was tuned against and must not move.
   */
  const compact = Math.min(width, height) < 480
  const basePadding = compact ? Math.min(spec.padding, 10) : spec.padding
  const padding = basePadding + framing.margin * Math.min(width, height)
  const pad = Math.min(padding, Math.min(width, height) / 4)
  const fitBox: [[number, number], [number, number]] = [
    [pad, pad],
    [Math.max(pad + 1, width - pad), Math.max(pad + 1, height - pad)],
  ]

  projection.fitExtent(fitBox, target)

  /**
   * Close the letterbox.
   *
   * `fitExtent` *contains* the target inside the padded extent, so whichever axis is
   * not binding keeps its slack — and that slack is where the neighbouring continent
   * shows up. Reclaiming it means scaling in, which costs geography at the edges, so
   * the only question is which geography the region can afford to lose.
   *
   * The answer is read off the geometry rather than declared. Every fit point
   * carries the area of the polygon it came from (`fitWeights`), so the projected
   * cloud can be asked for its **core**: the interval holding all but a small share
   * of the region's area at each end of each axis. Everything outside that core is
   * fringe — the outer scatter of an archipelago, the last kilometres of a
   * peninsula, the tail of a steppe — and the camera may spend it.
   *
   * This is what makes the fill projection-aware for free. The core is computed on
   * *projected* coordinates, so the same continent has a different core under every
   * projection, and each one gets the scale its own projected shape allows. It is
   * also what makes the fill self-limiting: a continent whose edges are mainland
   * coast has almost no area out in the tails, its core is nearly its full extent,
   * and it barely moves. Africa stays whole because Africa's geometry says so, not
   * because a rule names it.
   *
   * A region may still override the core with an explicit `fill.keep` box when the
   * composition is a cartographic judgement rather than a property of the outline.
   *
   * `placement` then decides where what is left sits, so the crop comes off
   * whichever side is actually carrying the surplus.
   *
   * Only the single uniform scale changes, so the geography is never stretched.
   */
  const fill = Math.max(0, Math.min(1, framing.framing.fill.amount))
  if (fill > 0) {
    const cloud = projectCloud(projection, target, framing.fitWeights)
    const anchorTarget: MultiPoint = { type: 'MultiPoint', coordinates: framing.fitAnchors }

    if (cloud.xs.length >= 2) {
      /*
       * What must stay on screen.
       *
       * Two constraints, and they compose rather than override. The area core is
       * always in force: whatever else is true, the camera may not push more than
       * `CROPPABLE_AREA_TAIL` of the region off each end of an axis. A region may
       * additionally declare a `fill.keep` box when its composition is a
       * cartographic judgement its outline does not express — Europe's is, since
       * nothing in the geometry says the Caspian shore matters less than the Atlantic
       * approaches.
       *
       * Taking the union is what makes the declared box safe under every projection.
       * On its own it is a statement about one projected shape, and Europe's was
       * written against the conic: under Robinson and Nell-Hammer the same box
       * contain-fits differently and was pushing 6% of the continent off screen. The
       * core caps that at the tail budget no matter which projection is active,
       * while the box still keeps the camera from spending anything inside it.
       */
      const keep = keepIndices(target, framing.framing.fill.keep, framing.centerLon)
      const anchors = projectCloud(projection, anchorTarget, [])

      const coreX = union(
        union(
          coreInterval(cloud.xs, cloud.weights, CROPPABLE_AREA_TAIL),
          extentOrNull(anchors.xs),
        ),
        keep && extent(keep.map((i) => cloud.xs[i])),
      )
      const coreY = union(
        union(
          coreInterval(cloud.ys, cloud.weights, CROPPABLE_AREA_TAIL),
          extentOrNull(anchors.ys),
        ),
        keep && extent(keep.map((i) => cloud.ys[i])),
      )

      const usedWidth = coreX[1] - coreX[0]
      const usedHeight = coreY[1] - coreY[0]
      const residual = RESIDUAL_MARGIN * Math.min(width, height)

      if (usedWidth > 0 && usedHeight > 0) {
        /*
         * The largest uniform scale that still contains the core, less a residual so
         * it never sits flush against the edge. `min` rather than `max`: a cover fit
         * would push the core itself off screen, and the core is by definition the
         * part that may not go.
         */
        const coreLimit = Math.min(
          (width - 2 * residual) / usedWidth,
          (height - 2 * residual) / usedHeight,
        )

        /*
         * And the same question asked of the region's whole extent, which is the one
         * the core cannot answer — see `EDGE_OVERFLOW_ALLOWANCE`. Whichever of the two
         * binds first is the honest limit: the core may not leave, and the rest may not
         * leave by more than the allowance.
         */
        const fullX = extent(cloud.xs)
        const fullY = extent(cloud.ys)
        const fullWidth = fullX[1] - fullX[0]
        const fullHeight = fullY[1] - fullY[0]
        const spill = 1 + 2 * EDGE_OVERFLOW_ALLOWANCE
        const extentLimit =
          fullWidth > 0 && fullHeight > 0
            ? Math.min((width * spill) / fullWidth, (height * spill) / fullHeight)
            : coreLimit

        const limit = Math.min(coreLimit, extentLimit)

        const factor = 1 + (limit - 1) * fill

        if (factor > 1) {
          projection.scale(projection.scale() * factor)

          // Scaling happens about the projection origin, so re-place the target.
          const scaled = projectCloud(projection, target, framing.fitWeights)
          const sx = extent(scaled.xs)
          const sy = extent(scaled.ys)
          /*
           * Placement anchors on the *core*, not on the full extent: the slide is
           * what brings the core back inside, and the fringe the scale just spent is
           * allowed to fall off whichever side was carrying it.
           *
           * Re-derived from the scaled cloud rather than scaled arithmetically.
           * `projection.scale()` scales about the projection's own origin and leaves
           * `translate` where it was, so the screen position of a point moves by
           * `factor * p + translate * (1 - factor)` — not by `factor * p`. Asking the
           * new cloud is exact and cannot drift from whatever d3 actually did; the
           * quantile is an order statistic, so it survives the affine map unchanged.
           */
          const scaledAnchors = projectCloud(projection, anchorTarget, [])
          const anchorX = union(
            union(
              coreInterval(scaled.xs, scaled.weights, CROPPABLE_AREA_TAIL),
              extentOrNull(scaledAnchors.xs),
            ),
            keep && extent(keep.map((i) => scaled.xs[i])),
          )
          const anchorY = union(
            union(
              coreInterval(scaled.ys, scaled.weights, CROPPABLE_AREA_TAIL),
              extentOrNull(scaledAnchors.ys),
            ),
            keep && extent(keep.map((i) => scaled.ys[i])),
          )

          const translate = projection.translate()
          projection.translate([
            translate[0] + placement(sx, anchorX, width, residual),
            translate[1] + placement(sy, anchorY, height, residual),
          ])
        }
      }
    }
  }

  return projection
}

/** Screen-space bounds of a projected geometry, used for zoom-to-country. */
export function projectedBounds(
  projection: GeoProjection,
  geometry: Parameters<ReturnType<typeof geoPath>['bounds']>[0],
): [[number, number], [number, number]] {
  return geoPath(projection).bounds(geometry)
}
