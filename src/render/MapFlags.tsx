/**
 * Flags as paint.
 *
 * A country's flag is the `fill` of the country's own `<path>` — not an image laid on
 * top of it. That single decision is what makes the mode correct and what makes it
 * fast, and it replaces an earlier version that positioned a rectangular `<image>`
 * near each country's centre:
 *
 * - **Shape.** A paint server is clipped by the geometry it fills, exactly and for
 *   free. The flag follows the coastline, fills every bay, stops at every border and
 *   covers every offshore island, because it *is* the country's fill. Nothing is
 *   masked, nothing overflows onto water, and there is no rectangle to see.
 *
 * - **Cost.** The overlay added a group, an image and a rect per country — some 717
 *   extra nodes on a world map, each image an SVG the browser parsed and rasterised
 *   on its own. This adds no rendered elements at all. The 254 paths that were always
 *   there simply take a different `fill`, and each flag is rasterised once as a
 *   pattern tile and reused wherever it appears.
 *
 * Everything else about the map keeps working untouched, because nothing else about
 * the map changed: hit-testing, hover, selection outlines, borders, lakes, the
 * graticule and the magnifier all still operate on the same paths they always did.
 *
 * The tile is placed in the projected user space of the country layer, so it pans,
 * zooms and reprojects with the geography and needs no recomputation when the camera
 * moves — only when the projection itself changes.
 */
import { memo } from 'react'
import { geoPath, type GeoProjection } from 'd3-geo'
import type { MultiPolygon, Position } from 'geojson'
import { hasFlag, useFlagStore } from '../flags/flagStore'

/** Prefix for pattern ids, so a country's fill is `url(#map-flag-DEU)`. */
const FLAG_PATTERN_PREFIX = 'map-flag-'

/**
 * The id of the pattern a country's land points at.
 *
 * A country with separately framed territories has one pattern per placement; the
 * unsuffixed id is always the main one, so the country path's own fill is unchanged by
 * the existence of the others.
 */
export function flagPatternId(countryId: string): string {
  return `${FLAG_PATTERN_PREFIX}${countryId}`
}

/** The id of the pattern for one separately framed territory. */
export function flagTerritoryPatternId(key: string): string {
  return `${FLAG_PATTERN_PREFIX}${key}`
}

/**
 * The border flags mode draws, which is not the border the data modes draw.
 *
 * Those choose a tone by measuring contrast against the fill, because a palette runs
 * from near-white to near-black and one fixed colour cannot separate both ends. A flag
 * is many colours at once, so there is nothing to measure — and the job is different
 * too: neighbours here are not two steps of one ramp but two unrelated flags that may
 * share a colour outright, so the line between them has to be legible against anything.
 * Black is, against every flag in the set, and it is the convention for a political
 * boundary besides.
 *
 * Heavier than the data modes' line for the same reason, and the multiplier is applied
 * to the document's own border width so the setting still means something. The stroke
 * stays non-scaling, so the line holds its weight at every zoom instead of thickening
 * as the map is magnified.
 */
export const FLAG_BORDER_COLOR = '#000000'
export const FLAG_BORDER_SCALE = 2.25

/**
 * The layered line drawn where two countries meet.
 *
 * Two neighbouring flags can share a colour outright — Kuwait against Iraq — so the
 * boundary between them carries the whole separation, and a single dark line against two
 * dark flags is not enough. A pale edge either side of a heavier black core reads against
 * anything: white | black | white, with the country's own flag on each outside.
 *
 * It is drawn on the *international boundary network* and nowhere else. That network
 * comes from the dataset's topology, where an arc shared by two neighbours is recorded
 * once — so a coast, which has the same country on both sides, is simply not in it. No
 * outline is added around any country's exterior, around any island, or along any
 * coastline, and a country meeting only water keeps the plain border it always had.
 *
 * Both widths are non-scaling, so the line holds its weight at every zoom.
 */
export const FLAG_BOUNDARY_INK = '#000000'
export const FLAG_BOUNDARY_EDGE = '#ffffff'

/** The black core at world zoom, as a multiple of the document's border width. */
const BOUNDARY_INK_SCALE = 1.25
/** How much wider the pale line is, which is what leaves an edge either side. */
const BOUNDARY_EDGE_SCALE = 1.7

/**
 * How the line answers the camera, and the range it is held to.
 *
 * A non-scaling stroke holds a constant *screen* width, which is the wrong behaviour
 * here: zooming out shrinks every country while the line stays put, so at world zoom a
 * fixed 2.7px band swamped countries only a few pixels across. Scaling with the map is
 * equally wrong in the other direction — it would reach tens of pixels when zoomed in.
 *
 * So the width follows the zoom, but far more slowly than the map does. At an exponent
 * of 0.3 a forty-fold magnification thickens the line threefold: about 0.7px zoomed out
 * to half scale, 1.0px at world zoom, 1.9px at continental, 3.0px on a single country.
 * The clamps stop either end running away.
 */
const BOUNDARY_ZOOM_EXPONENT = 0.3
const BOUNDARY_INK_MIN = 0.45
const BOUNDARY_INK_MAX = 3.2

/** Width of the black core of an international boundary at the current zoom. */
export function boundaryInkWidth(base: number, zoomK: number): number {
  const scaled =
    base * BOUNDARY_INK_SCALE * Math.pow(Math.max(zoomK, 0.01), BOUNDARY_ZOOM_EXPONENT)
  return Math.max(BOUNDARY_INK_MIN, Math.min(BOUNDARY_INK_MAX, scaled))
}

/** Width of the pale line beneath it; the difference is the edge either side. */
export function boundaryEdgeWidth(base: number, zoomK: number): number {
  return boundaryInkWidth(base, zoomK) * BOUNDARY_EDGE_SCALE
}

/** How much of a feature its border may take, and the thinnest line worth drawing. */
const BORDER_FEATURE_SHARE = 0.2
const BORDER_MIN_WIDTH = 0.25

/**
 * The border width for a country at the current zoom.
 *
 * A fixed non-scaling line is right for a country big enough to hold it and wrong for
 * one that is not. At world zoom a Bahamian island is about a pixel across while the
 * line is centred on its outline, so the island is entirely border: measured over its
 * interior, 69% of the Bahamas rendered black and only 31% showed any flag. Zooming in
 * uncovered more of it, which is precisely the reported symptom of flags appearing and
 * disappearing with zoom — the flags were there all along, painted over by their own
 * outline.
 *
 * So the line is capped at a fifth of the land it is drawn on, taken from the country's
 * own geometry and scaled by the zoom, with a floor so a boundary never vanishes. Large
 * countries are unaffected and keep the full weight; small islands get a line in
 * proportion to themselves that grows as you zoom in until it too reaches full weight.
 */
export function flagBorderWidth(
  tile: FlagTile | undefined,
  base: number,
  zoomK: number,
): number {
  const full = base * FLAG_BORDER_SCALE
  if (!tile || !(tile.featureSize > 0)) return full
  return Math.max(BORDER_MIN_WIDTH, Math.min(full, tile.featureSize * zoomK * BORDER_FEATURE_SHARE))
}

/**
 * Opacity of maritime territory.
 *
 * The same half-opacity the flag system has always used for water: enough that the zone
 * reads as the country's without competing with the land, which stays fully opaque.
 */
export const MARITIME_OPACITY = 0.5

/**
 * The outline width for a maritime zone at the current zoom.
 *
 * The same rule the land border follows and for the same reason — a line must not
 * consume the thing it outlines — but measured against the zone rather than against the
 * islands inside it. Zones are large, so this is nearly always the full weight.
 */
export function maritimeBorderWidth(size: number, base: number, zoomK: number): number {
  const full = base * FLAG_BORDER_SCALE
  if (!(size > 0)) return full
  return Math.max(BORDER_MIN_WIDTH, Math.min(full, size * zoomK * BORDER_FEATURE_SHARE))
}

const FLAG_W = 640
const FLAG_H = 480
const FLAG_ASPECT = FLAG_W / FLAG_H

/**
 * How far the flag may be stretched from its true proportions to suit a country.
 *
 * The single number that trades distortion against cropping. At 1 the flag keeps
 * perfect proportions and everything off-square is cropped — which is what turned
 * Russia into a blue rectangle. Unbounded, a country's shape dictates the flag's and
 * tall states like Chile smear vertically.
 *
 * 3.5 puts essentially the whole dataset inside the cap, so nearly every country shows
 * its complete flag with a stretch nobody reads as wrong, while the few genuinely
 * extreme outlines crop only what is left over.
 */
const MAX_STRETCH = 3.5

export interface FlagTile {
  id: string
  iso2: string
  /** Projected rectangle the flag is stretched across, before the path clips it. */
  x: number
  y: number
  width: number
  height: number
  /**
   * The flag's own box inside the tile, pre-solved to *cover* it at true 4:3.
   *
   * Computed rather than delegated to `preserveAspectRatio`, because a nested SVG
   * resolves its own aspect and overrides what the `<image>` asks for. Overflow is
   * clipped by the pattern tile, which is exactly what covering means.
   */
  imageX: number
  imageY: number
  imageWidth: number
  imageHeight: number
  /** Detached territories framed separately — Alaska, French Guiana. Usually empty. */
  territories: FlagTerritory[]
  /**
   * The size of the land this country is actually made of, in projected units: the
   * diagonal below which half its area lies.
   *
   * Canada reports its mainland, the Bahamas report an island rather than the spread of
   * the whole chain. Used to keep the border from swallowing the country it outlines —
   * see `flagBorderWidth`.
   */
  featureSize: number
}

/**
 * A second flag for the same country, over a territory far enough away and large
 * enough to deserve its own.
 *
 * Carries a complete framing of its own plus the region it applies over, so it is
 * drawn exactly like the country's main placement, just somewhere else.
 */
export interface FlagTerritory {
  key: string
  x: number
  y: number
  width: number
  height: number
  imageX: number
  imageY: number
  imageWidth: number
  imageHeight: number
  /** The territory's own projected outline — what the flag is drawn on. */
  d: string
}

/**
 * Projected framing rectangles, one per country that has artwork.
 *
 * Depends only on the footprints and the projection, so the caller memoises it on
 * those: a hover, a selection, a theme change or a pointer move recomputes nothing,
 * and neither does zooming or panning, since the tile lives in the same user space as
 * the paths and the camera transform carries both.
 */
/**
 * Smallest tile the pattern is allowed, in projected units.
 *
 * Only a guard against a degenerate tile, and deliberately far below the size of any
 * real country.
 *
 * It used to sit at 14 units, on the reasoning that Macau's 0.26 x 0.41 framing was too
 * small to rasterise well. That floor did more harm than the problem it was guarding
 * against: it does not shrink a tile, it *grows* one, so a microstate 0.2 units across
 * was given a flag 14 units wide and showed a seventieth of it — a single flat colour.
 * Sixty-five entities were in that state, San Marino, Monaco, Nauru, Macau, Gibraltar
 * and the Vatican among them, and no amount of zooming recovered the flag, because the
 * tile lives in projected units and scales with the map.
 *
 * A country's flag is therefore fitted to the country's own size, however small that
 * is. This floor exists only so that a zero-width or otherwise degenerate box cannot
 * produce an invalid pattern.
 */
const MIN_TILE = 0.08

/**
 * Share of a country's area the framing box may leave outside, at each end of an axis.
 *
 * The chain that builds a cluster admits anything within a dozen degrees, which is
 * right for keeping Corsica with France but wrong for Portugal: Madeira sits inside
 * that reach, and the Azores chain on from Madeira, so the framing box stretched a
 * thousand kilometres into the Atlantic and mainland Portugal saw only the red half of
 * its flag. Trimming by *area* removes exactly that kind of passenger — an island
 * holding a per cent of the country cannot move the box — while leaving a genuine
 * archipelago, where no single piece dominates, untouched.
 */
const FRAME_AREA_TAIL = 0.04

interface Piece {
  x0: number
  x1: number
  y0: number
  y1: number
  area: number
}

/** The interval holding all but `tail` of the area at each end, on one axis. */
function coreInterval(
  pieces: Piece[],
  lo: (p: Piece) => number,
  hi: (p: Piece) => number,
  total: number,
  tail: number,
): [number, number] {
  const budget = total * tail
  const ascending = [...pieces].sort((a, b) => lo(a) - lo(b))
  let acc = 0
  let low = lo(ascending[0])
  for (const piece of ascending) {
    if (acc + piece.area > budget) {
      low = lo(piece)
      break
    }
    acc += piece.area
  }
  const descending = [...pieces].sort((a, b) => hi(b) - hi(a))
  acc = 0
  let high = hi(descending[0])
  for (const piece of descending) {
    if (acc + piece.area > budget) {
      high = hi(piece)
      break
    }
    acc += piece.area
  }
  return low < high ? [low, high] : [lo(ascending[0]), hi(descending[0])]
}

/**
 * The country's islands as projected boxes, taken from its entire geometry.
 *
 * Distinct from the framing pieces on purpose: framing works from the dominant
 * cluster, while this has to account for every island the country has, wherever it
 * lies.
 */
/**
 * Projected bounds and area of one polygon, measured once per projection.
 *
 * Every stage of this file needs the same numbers for the same rings: framing measures
 * a country's cluster and the border rule measures its land — and there were once four
 * such passes, with the island floor, since removed, measuring twice more. Each pass over
 * the whole world costs about 1.3 seconds: the bulk of what was left of the ten-second
 * toggle.
 *
 * They can share, because they are looking at the same arrays: `flagPlacement.ts` puts
 * the feature's own coordinate arrays into the clusters it returns rather than copying
 * them, so a cluster's polygon is reference-identical to the country's. A `WeakMap` keyed
 * on the array therefore hits for every stage after the first, and holds nothing alive
 * once the dataset is dropped.
 *
 * Keyed on the projection as well, since a new projection makes every number stale.
 */
let measureCache = new WeakMap<object, Piece>()
let measuredWith: unknown = null

function measurePolygon(
  polygon: Position[][],
  path: ReturnType<typeof geoPath>,
  projection: GeoProjection,
): Piece | null {
  if (measuredWith !== projection) {
    measuredWith = projection
    measureCache = new WeakMap()
  }
  const hit = measureCache.get(polygon)
  if (hit) return hit

  const shape = { type: 'Polygon' as const, coordinates: polygon }
  const [[x0, y0], [x1, y1]] = path.bounds(shape)
  if (![x0, y0, x1, y1].every(Number.isFinite)) return null
  const piece: Piece = { x0, x1, y0, y1, area: Math.abs(path.area(shape)) }
  measureCache.set(polygon, piece)
  return piece
}

interface LandPiece extends Piece {
  polygon: number[][][]
}

/**
 * The size of a country's typical land, as the diagonal below which half its area lies.
 *
 * Area-weighted rather than a plain median, so a country is described by where its land
 * actually is: the Bahamas' forty-one islands report an island, not the span of the
 * chain, and Canada's four hundred report the mainland rather than an Arctic islet.
 */
function typicalLandSize(pieces: LandPiece[]): number {
  if (pieces.length === 0) return 0
  const sized = pieces
    .map((piece) => ({
      diagonal: Math.hypot(piece.x1 - piece.x0, piece.y1 - piece.y0),
      area: piece.area,
    }))
    .sort((a, b) => a.diagonal - b.diagonal)
  const total = sized.reduce((sum, piece) => sum + piece.area, 0)
  if (!(total > 0)) return sized[sized.length - 1].diagonal
  let seen = 0
  for (const piece of sized) {
    seen += piece.area
    if (seen >= total / 2) return piece.diagonal
  }
  return sized[sized.length - 1].diagonal
}

function landPiecesOf(
  feature: Parameters<ReturnType<typeof geoPath>['area']>[0] | undefined,
  path: ReturnType<typeof geoPath>,
  projection: GeoProjection,
): LandPiece[] {
  const geometry = (feature as { geometry?: { type: string; coordinates: unknown } })?.geometry
  if (!geometry) return []
  const polygons =
    geometry.type === 'Polygon'
      ? [geometry.coordinates as number[][][]]
      : geometry.type === 'MultiPolygon'
        ? (geometry.coordinates as number[][][][])
        : []

  const pieces: LandPiece[] = []
  for (const polygon of polygons) {
    const measured = measurePolygon(polygon as Position[][], path, projection)
    if (measured) pieces.push({ ...measured, polygon })
  }
  return pieces
}

/** A flag laid over one stretch of territory: where its artwork sits, and how big. */
export interface FlagFit {
  x: number
  y: number
  width: number
  height: number
  imageX: number
  imageY: number
  imageWidth: number
  imageHeight: number
  /** Extent before the small-territory floor, for the archipelago test. */
  rawArea: number
}

/** Grid resolution and refinement depth for `deepestPoint`. */
const GRID_STEPS = 12
const GRID_PASSES = 4

/** Outline points kept when searching for the deepest interior point. */
const ANCHOR_POINTS = 80

/**
 * The interior point of a shape that lies furthest from its edge.
 *
 * The area centroid is the obvious anchor, and it is wrong for exactly the shapes that
 * most need one: on a crescent, a horseshoe, or a country wrapped around a bay it falls
 * on water or on a neighbour, and the flag is then centred on land that is not there.
 * This searches for the deepest interior point instead — the "point that maximises
 * distance from the country's borders" — by scoring a grid, keeping the best cell and
 * subdividing around it.
 *
 * Fixed grid, fixed refinement count, no randomness: the same outline always returns
 * the same point, which is part of what keeps placement reproducible.
 */
function deepestPoint(ring: [number, number][]): [number, number] | null {
  if (ring.length < 3) return null
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const [px, py] of ring) {
    if (px < x0) x0 = px
    if (px > x1) x1 = px
    if (py < y0) y0 = py
    if (py > y1) y1 = py
  }
  if (!(x1 > x0) || !(y1 > y0)) return null

  const inside = (px: number, py: number): boolean => {
    let hit = false
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]
      const [xj, yj] = ring[j]
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit
    }
    return hit
  }

  /** How far a point sits from the outline, by its nearest segment. */
  const toEdge = (px: number, py: number): number => {
    let best = Infinity
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]
      const [xj, yj] = ring[j]
      const dx = xj - xi
      const dy = yj - yi
      const len = dx * dx + dy * dy
      const t = len > 0 ? Math.max(0, Math.min(1, ((px - xi) * dx + (py - yi) * dy) / len)) : 0
      const d = Math.hypot(px - (xi + t * dx), py - (yi + t * dy))
      if (d < best) best = d
    }
    return best
  }

  let bestX = (x0 + x1) / 2
  let bestY = (y0 + y1) / 2
  let bestScore = -Infinity
  let lo: [number, number] = [x0, y0]
  let hi: [number, number] = [x1, y1]

  for (let pass = 0; pass < GRID_PASSES; pass++) {
    for (let i = 0; i <= GRID_STEPS; i++) {
      for (let j = 0; j <= GRID_STEPS; j++) {
        const px = lo[0] + ((hi[0] - lo[0]) * i) / GRID_STEPS
        const py = lo[1] + ((hi[1] - lo[1]) * j) / GRID_STEPS
        if (!inside(px, py)) continue
        const score = toEdge(px, py)
        if (score > bestScore) {
          bestScore = score
          bestX = px
          bestY = py
        }
      }
    }
    if (bestScore === -Infinity) return null
    // Narrow to the neighbourhood of the best cell and look again, more finely.
    const stepX = (hi[0] - lo[0]) / GRID_STEPS
    const stepY = (hi[1] - lo[1]) / GRID_STEPS
    lo = [bestX - stepX, bestY - stepY]
    hi = [bestX + stepX, bestY + stepY]
  }

  return [bestX, bestY]
}

/**
 * Where a flag should be centred over a cluster: the deepest point inside its largest
 * landmass, falling back to the area centroid when no interior point can be found.
 *
 * The largest polygon, because that is the land a viewer reads the flag against.
 */
function anchorOf(
  cluster: MultiPolygon,
  path: ReturnType<typeof geoPath>,
  project: GeoProjection,
): [number, number] {
  let largest: Position[][] | null = null
  let largestArea = -Infinity
  for (const polygon of cluster.coordinates) {
    const area = Math.abs(path.area({ type: 'Polygon', coordinates: polygon }))
    if (area > largestArea) {
      largestArea = area
      largest = polygon
    }
  }

  if (largest && largest[0]) {
    const source = largest[0]
    const stride = Math.max(1, Math.round(source.length / ANCHOR_POINTS))
    const ring: [number, number][] = []
    for (let i = 0; i < source.length; i += stride) {
      const projected = project(source[i] as [number, number])
      if (projected && Number.isFinite(projected[0]) && Number.isFinite(projected[1])) {
        ring.push([projected[0], projected[1]])
      }
    }
    const deep = deepestPoint(ring)
    if (deep) return deep
  }

  const [cx, cy] = path.centroid(cluster)
  return [cx, cy]
}

/**
 * Frame a flag over one cluster of land.
 *
 * Shared by a country's main placement and by each territory framed separately, so
 * Alaska is fitted by exactly the rules the lower 48 are.
 */
export function fitFlag(
  cluster: MultiPolygon,
  path: ReturnType<typeof geoPath>,
  project: GeoProjection,
): FlagFit | null {
  /*
   * The box the flag is fitted to: the cluster's area core, not its raw extent.
   * Every polygon contributes its projected bounds weighted by its projected area,
   * and the outer few per cent of area is trimmed off each end. Land outside the box
   * is still painted — the pattern repeats — so this changes where the flag is
   * *framed*, never which territory is covered.
   */
  const pieces: Piece[] = []
  for (const polygon of cluster.coordinates) {
    const measured = measurePolygon(polygon, path, project)
    if (measured) pieces.push(measured)
  }
  return frameFlag(pieces, () => anchorOf(cluster, path, project), FRAME_AREA_TAIL)
}

/**
 * Frame a flag over shapes that are already in the plane of the map.
 *
 * For the maritime layer, whose water is projected before it gets here so that it can be
 * split where the map's edge cuts it. Measured in the plane directly rather than through
 * `measurePolygon`, whose cache belongs to the land and is keyed on the projection.
 *
 * The whole of the shape is framed: no area is trimmed from either end of an axis. That
 * trim exists so an islet a thousand kilometres out cannot drag a country's frame into
 * the ocean; water is one continuous surface, and any of it left outside the frame would
 * show a second, partial flag where the pattern repeats.
 */
export function fitFlagToPlanar(polygons: Position[][][]): FlagFit | null {
  const plane = geoPath()
  const pieces: Piece[] = []
  let largest: Position[][] | null = null
  let largestArea = -Infinity
  for (const polygon of polygons) {
    const shape = { type: 'Polygon' as const, coordinates: polygon }
    const [[x0, y0], [x1, y1]] = plane.bounds(shape)
    if (![x0, y0, x1, y1].every(Number.isFinite)) continue
    const area = Math.abs(plane.area(shape))
    pieces.push({ x0, x1, y0, y1, area })
    if (area > largestArea) {
      largestArea = area
      largest = polygon
    }
  }
  const anchor = (): [number, number] => {
    if (largest && largest[0]) {
      const source = largest[0]
      const stride = Math.max(1, Math.round(source.length / ANCHOR_POINTS))
      const ring: [number, number][] = []
      for (let i = 0; i < source.length; i += stride) ring.push([source[i][0], source[i][1]])
      const deep = deepestPoint(ring)
      if (deep) return deep
    }
    const [cx, cy] = plane.centroid({ type: 'MultiPolygon', coordinates: polygons })
    return [cx, cy]
  }
  return frameFlag(pieces, anchor, 0)
}

/**
 * The fitting both of the above share: a box from the pieces, with `tail` of the area
 * allowed outside it at each end of an axis, and the artwork fitted to that box.
 */
function frameFlag(
  pieces: Piece[],
  anchor: () => [number, number],
  tail: number,
): FlagFit | null {
  if (pieces.length === 0) return null

  const totalArea = pieces.reduce((sum, p) => sum + p.area, 0)
  const [x0, x1] =
    totalArea > 0
      ? coreInterval(pieces, (p) => p.x0, (p) => p.x1, totalArea, tail)
      : [Math.min(...pieces.map((p) => p.x0)), Math.max(...pieces.map((p) => p.x1))]
  const [y0, y1] =
    totalArea > 0
      ? coreInterval(pieces, (p) => p.y0, (p) => p.y1, totalArea, tail)
      : [Math.min(...pieces.map((p) => p.y0)), Math.max(...pieces.map((p) => p.y1))]
  if (![x0, y0, x1, y1].every(Number.isFinite)) return null

  let width = x1 - x0
  let height = y1 - y0
  if (!(width >= 0) || !(height >= 0)) return null

  // Kept before the floor below, because the archipelago test measures how much of
  // its *real* extent a country fills — and an inflated tile would make every
  // microstate look like a scatter of islands.
  const rawArea = width * height

  // Grow a degenerate tile around its own centre rather than dropping the country.
  let x = x0
  let y = y0
  if (width < MIN_TILE) {
    x = x0 + width / 2 - MIN_TILE / 2
    width = MIN_TILE
  }
  if (height < MIN_TILE) {
    y = y0 + height / 2 - MIN_TILE / 2
    height = MIN_TILE
  }

  /*
   * Fit the *whole* flag into the country's shape.
   *
   * A pure cover fit — scale the 4:3 artwork until it spans the box, crop the rest —
   * guarantees coverage but destroys the flag on any country far from 4:3. Russia's
   * framing is 7.8:1, so covering it cropped away everything except the middle band:
   * the country read as a plain blue rectangle rather than as a tricolour. A pure
   * contain fit has the opposite failure, leaving most of the country unpainted, which
   * is the water bug all over again.
   *
   * So the flag is allowed to *stretch* toward the country's proportions, up to
   * `MAX_STRETCH`, and only what the cap cannot absorb is cropped. Almost every
   * country in the dataset sits inside the cap and therefore shows its complete flag;
   * only genuinely extreme shapes crop at all, and then far less than before. Coverage
   * is preserved unconditionally, because the drawn box is derived from the tile and is
   * never smaller than it on either axis.
   */
  const tileAspect = width / height
  const drawAspect = Math.min(
    FLAG_ASPECT * MAX_STRETCH,
    Math.max(FLAG_ASPECT / MAX_STRETCH, tileAspect),
  )
  const imageHeight = Math.max(height, width / drawAspect)
  const imageWidth = drawAspect * imageHeight

  /*
   * Centred on the deepest point inside the land rather than on the middle of the
   * bounding box. When a crop does happen this keeps the visible part of the flag over
   * the part of the country people are actually looking at, and on a shape wrapped
   * around a bay it keeps the anchor on land at all. Clamped so the box still covers
   * the tile: placement may shift the flag, never uncover the country.
   */
  /*
   * The anchor is only asked for when the flag is actually cropped.
   *
   * Where the artwork fits the tile — which is every country whose proportions the
   * stretch cap can absorb — the drawn box equals the tile on both axes, the clamp below
   * pins it to the corner, and the anchor cannot move anything. Searching for one was
   * pure waste: it ran for all 254 countries when 14 can crop, at about 108,000 distance
   * tests each, and accounted for roughly six of the ten seconds the mode took to turn
   * on. Skipping it where it cannot matter changes no placement at all.
   */
  const cropped = imageWidth > width + 1e-9 || imageHeight > height + 1e-9
  const [ax, ay] = cropped ? anchor() : [NaN, NaN]
  const centreX = Number.isFinite(ax) ? ax - x : width / 2
  const centreY = Number.isFinite(ay) ? ay - y : height / 2
  const imageX = Math.min(0, Math.max(width - imageWidth, centreX - imageWidth / 2))
  const imageY = Math.min(0, Math.max(height - imageHeight, centreY - imageHeight / 2))

  return { x, y, width, height, imageX, imageY, imageWidth, imageHeight, rawArea }
}

/**
 * A flag placement expressed the way a `<pattern>` can actually rasterise it.
 *
 * The obvious encoding — tile and image sized directly in projected units — silently
 * fails once a country is small. Monaco's framing is 0.139 x 0.121 units, and an
 * `<image>` declared that size renders *nothing at all*: not a wrong colour, not a
 * blur, zero pixels. Measured on Monaco's own path, the same artwork gives 0 lit
 * pixels declared in user units and 208,751 declared at its natural size and scaled by
 * a `patternTransform`.
 *
 * That failure is what the old 14-unit tile floor was really working around, and the
 * floor cost far more than it saved: it inflated a microstate's flag until the country
 * showed a single flat colour, which is why sixty-five entities displayed no
 * recognisable flag at any zoom. Declaring the artwork at 640 x 480 and letting the
 * transform do the scaling removes the failure at its source, so the tile can simply be
 * the country's own size however small that is.
 *
 * Pure arithmetic on the same numbers — the flag lands in exactly the same place, and
 * nothing about the fitting changes.
 */
export function patternGeometry(placement: {
  x: number
  y: number
  width: number
  height: number
  imageX: number
  imageY: number
  imageWidth: number
  imageHeight: number
}) {
  const scale = placement.width / FLAG_W
  if (!(scale > 0)) return null
  return {
    transform: `translate(${placement.x} ${placement.y}) scale(${scale})`,
    width: FLAG_W,
    height: placement.height / scale,
    imageX: placement.imageX / scale,
    imageY: placement.imageY / scale,
    imageWidth: placement.imageWidth / scale,
    imageHeight: placement.imageHeight / scale,
  }
}

export function buildFlagTiles(
  footprints: Map<string, MultiPolygon>,
  projection: GeoProjection | null,
  codeById: (id: string) => string | undefined,
  featureById: (id: string) => Parameters<ReturnType<typeof geoPath>['area']>[0] | undefined,
  territoriesById?: Map<string, MultiPolygon[]>,
): FlagTile[] {
  if (!projection) return []
  const path = geoPath(projection)
  const tiles: FlagTile[] = []

  /*
   * Every country the map draws, with no scope filter.
   *
   * There was one, and it was a mistake: out-of-scope land is still drawn (muted), so
   * filtering here meant a map of Europe rendered Algeria and Turkiye with no flag at
   * all while showing their geography — countries silently disappearing from the mode.
   * The renderer decides what is on the map; this decides what colour it is painted,
   * and the two must not disagree about which countries exist.
   */
  for (const [id, cluster] of footprints) {
    const code = codeById(id)
    // Never reference artwork that does not exist: the country keeps its land colour.
    if (!hasFlag(code)) continue

    const fit = fitFlag(cluster, path, projection)
    if (!fit) continue
    const { x, y, width, height, imageX, imageY, imageWidth, imageHeight } = fit

    /*
     * Detached territories large enough to be framed in their own right.
     *
     * Alaska is the case this exists for. It is a fifth of the United States and some
     * 830 km from the lower 48, and folding it into one framing meant a single flag
     * stretched from the Bering Sea to Florida — under which the mainland showed a
     * couple of stripes and Alaska a corner of the canton. Framed separately, each
     * carries a whole flag at a size that suits it. French Guiana is the same shape of
     * problem, and Crimea is the counter-case: it is close enough to the Russian
     * mainland to be part of that cluster, so it never reaches this at all.
     *
     * Which clusters qualify is decided in `flagPlacement.ts`, on land area and real
     * coastline distance. Here they are only fitted and given a region to apply over.
     */
    const territories: FlagTerritory[] = []
    for (const [index, area] of (territoriesById?.get(id) ?? []).entries()) {
      const placed = fitFlag(area, path, projection)
      if (!placed) continue
      /*
       * The territory is drawn on its own geometry, not inside a box around it.
       *
       * A bounding rectangle looks like a reasonable container and is not one, because
       * a rectangle around dispersed geometry covers everything between the pieces.
       * Alaska is the case that proves it: the Aleutians cross the antimeridian, so the
       * cluster spans -179 deg to +180 deg, its projected box runs nearly the full width
       * of the map, and the Alaska-framed flag was being painted straight across the
       * northern contiguous United States. Clipping to the real outline cannot do that
       * — the flag reaches exactly the land it belongs to and no further, which is also
       * what stops any territory spilling into a neighbour.
       */
      const outline = path(area)
      if (!outline) continue
      territories.push({
        key: `${id}-t${index}`,
        x: placed.x,
        y: placed.y,
        width: placed.width,
        height: placed.height,
        imageX: placed.imageX,
        imageY: placed.imageY,
        imageWidth: placed.imageWidth,
        imageHeight: placed.imageHeight,
        d: outline,
      })
    }

    /*
     * How big the land actually is, which decides how heavy a border it can carry.
     * Measured over the whole country, not the framing cluster, because it is the small
     * outlying islands that a border can swallow.
     */
    const featureSize = typicalLandSize(landPiecesOf(featureById(id), path, projection))

    tiles.push({
      id,
      iso2: (code as string).toLowerCase(),
      x,
      y,
      width,
      height,
      imageX,
      imageY,
      imageWidth,
      imageHeight,
      territories,
      featureSize,
    })
  }
  return tiles
}


export interface FlagPatternsProps {
  tiles: FlagTile[]
}

/**
 * The `<defs>` the country fills point at.
 *
 * `preserveAspectRatio="xMidYMid slice"` is the whole aspect-ratio policy: the flag
 * is scaled to *cover* its framing rectangle with its proportions intact, so it is
 * never stretched and never leaves part of the country unpainted. Where a country is
 * far from 4:3 the flag is cropped rather than distorted — coverage without
 * distortion is the trade the brief asks for, and a fitted flag would leave gaps.
 */
export const FlagPatterns = memo(function FlagPatterns({ tiles }: FlagPatternsProps) {
  const flags = useFlagStore((s) => s.flags)

  return (
    <defs>
      {tiles.flatMap((tile) => {
        const href = flags[tile.iso2]
        // Still loading: no pattern, so the country keeps its land colour until the
        // artwork arrives rather than flashing an empty fill.
        if (!href) return []
        const geometry = patternGeometry(tile)
        if (!geometry) return []
        return [(
          <pattern
            key={tile.id}
            id={flagPatternId(tile.id)}
            patternUnits="userSpaceOnUse"
            x={0}
            y={0}
            width={geometry.width}
            height={geometry.height}
            patternTransform={geometry.transform}
          >
            <image
              href={href}
              x={geometry.imageX}
              y={geometry.imageY}
              width={geometry.imageWidth}
              height={geometry.imageHeight}
              /*
               * `none`, with the box already sized to the flag's exact 4:3 — so it
               * introduces no distortion and, crucially, takes the decision away from
               * the nested SVG.
               *
               * `preserveAspectRatio="slice"` here does NOT work: the referenced flag
               * carries its own `viewBox` and its own default `meet`, and that inner
               * value wins, so the flag was letterboxed inside the tile and everything
               * around it left transparent. On a compact country the letterbox is
               * invisible; on Russia's 736x94 framing it was almost the whole country,
               * which is why large elongated countries rendered as open water. Sizing
               * the box for cover ourselves removes the ambiguity entirely.
               */
              preserveAspectRatio="none"
            />
          </pattern>
        ),
        /*
         * One more pattern per separately framed territory, built exactly like the one
         * above and differing only in where it is framed.
         */
        ...tile.territories.flatMap((territory) => {
          const placed = patternGeometry(territory)
          if (!placed) return []
          return [(
            <pattern
              key={territory.key}
              id={flagTerritoryPatternId(territory.key)}
              patternUnits="userSpaceOnUse"
              x={0}
              y={0}
              width={placed.width}
              height={placed.height}
              patternTransform={placed.transform}
            >
              <image
                href={href}
                x={placed.imageX}
                y={placed.imageY}
                width={placed.imageWidth}
                height={placed.imageHeight}
                preserveAspectRatio="none"
              />
            </pattern>
          )]
        }),
        ]
      })}
    </defs>
  )
})

export interface FlagTerritoriesProps {
  tiles: FlagTile[]
  shapeById: Map<string, string>
  borderColor: string
  /** Same width the country path uses, so the coast keeps one consistent line. */
  borderWidth: (tile: FlagTile) => number
  /**
   * Whether the territory is outlined, exactly when the country path under it is. Its
   * outline is coast and land border in one stroke — Alaska's meets Canada — so it is
   * drawn only when both switches are on, and otherwise the two networks draw each layer.
   */
  showOutline: boolean
}

/**
 * The second flag of a country that has one, drawn over the territory it belongs to.
 *
 * The territory's own outline is drawn and filled from that territory's pattern, so the
 * flag is bounded by the real coastline exactly as the main placement is, and no
 * geometry is invented to hold it. Everywhere else the country goes on showing its main
 * flag.
 *
 * It carries the same stroke as the country path underneath, because it covers that
 * path's border where the two overlap; without it Alaska's coastline would lose its
 * outline. Pointer events stay off and no country id is set, so hit-testing continues
 * to run against the single country path beneath and selection is untouched.
 */
export const FlagTerritories = memo(function FlagTerritories({
  tiles,
  shapeById,
  borderColor,
  borderWidth,
  showOutline,
}: FlagTerritoriesProps) {
  const flags = useFlagStore((s) => s.flags)
  const placements = tiles.flatMap((tile) =>
    flags[tile.iso2] && shapeById.has(tile.id)
      ? tile.territories.map((territory) => ({ tile, territory }))
      : [],
  )
  if (placements.length === 0) return null

  return (
    <>
      {placements.map(({ tile, territory }) => (
        <path
          key={territory.key}
          d={territory.d}
          fill={`url(#${flagTerritoryPatternId(territory.key)})`}
          stroke={showOutline ? borderColor : 'none'}
          strokeWidth={showOutline ? borderWidth(tile) : 0}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          paintOrder="stroke"
          pointerEvents="none"
        />
      ))}
    </>
  )
})

/* ------------------------------------------------------------ world domination */

/** The id of the single pattern that covers the world when one flag has taken it. */
export const WORLD_FLAG_PATTERN_ID = `${FLAG_PATTERN_PREFIX}world`

/**
 * Frame one flag over the whole projected world.
 *
 * The same cover policy every other placement uses — the artwork's own 4:3 scaled up
 * until it fills the box, centred, cropped rather than stretched — applied once to the
 * extent of everything the map draws instead of once per country.
 *
 * That "once" is the point. Painting the same flag into 250 separate per-country
 * patterns would repeat the design 250 times, each country showing a complete little
 * flag, which reads as a map of one country's flag rather than as a world wearing it.
 * One pattern spanning the world means the design runs *across* the borders: a country
 * shows whichever part of the flag it happens to sit on, and the planet reads as a
 * single covered surface.
 *
 * It also costs one image instead of 250, and because the box is in the same projected
 * user space as the country paths, the camera transform carries it — the flag stays
 * pinned to the world through any zoom or pan with nothing recomputed.
 */
export function worldFlagPlacement(bounds: {
  x0: number
  y0: number
  x1: number
  y1: number
}) {
  const width = bounds.x1 - bounds.x0
  const height = bounds.y1 - bounds.y0
  if (!(width > 0) || !(height > 0)) return null

  const imageHeight = Math.max(height, width / FLAG_ASPECT)
  const imageWidth = FLAG_ASPECT * imageHeight
  return {
    x: bounds.x0,
    y: bounds.y0,
    width,
    height,
    imageX: (width - imageWidth) / 2,
    imageY: (height - imageHeight) / 2,
    imageWidth,
    imageHeight,
  }
}

export interface WorldFlagPatternProps {
  /** Two-letter code for the chosen flag's artwork. */
  iso2: string
  bounds: { x0: number; y0: number; x1: number; y1: number } | null
}

/**
 * The one paint server every country points at while the world is dominated.
 *
 * Built exactly like the per-country patterns — same `patternGeometry`, same
 * `preserveAspectRatio="none"` over a box already sized for cover, for the same reason
 * given there — and differing only in what it is framed to.
 */
export const WorldFlagPattern = memo(function WorldFlagPattern({
  iso2,
  bounds,
}: WorldFlagPatternProps) {
  const flags = useFlagStore((s) => s.flags)
  const href = flags[iso2]
  if (!href || !bounds) return null

  const placement = worldFlagPlacement(bounds)
  if (!placement) return null
  const geometry = patternGeometry(placement)
  if (!geometry) return null

  return (
    <defs>
      <pattern
        id={WORLD_FLAG_PATTERN_ID}
        patternUnits="userSpaceOnUse"
        x={0}
        y={0}
        width={geometry.width}
        height={geometry.height}
        patternTransform={geometry.transform}
      >
        <image
          href={href}
          x={geometry.imageX}
          y={geometry.imageY}
          width={geometry.imageWidth}
          height={geometry.imageHeight}
          preserveAspectRatio="none"
        />
      </pattern>
    </defs>
  )
})
