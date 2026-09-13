/**
 * Assisted interaction and magnification for geographically tiny features.
 *
 * A country of a few square kilometres is a fraction of a pixel at continental zoom.
 * Two editor-only affordances make the map usable without forcing the user to zoom,
 * and they are deliberately independent of one another:
 *
 *   - **assisted selection**: an invisible catchment that follows a country's actual
 *     islands, so a speck or a scattered archipelago can be clicked. It spills over
 *     whatever larger country surrounds it, because clicking "near Monaco" should
 *     select Monaco even though the pixel under the cursor belongs to France.
 *   - **the magnifier**: an enlarged copy of a selected feature's own projected
 *     outline, so a selected speck is actually visible.
 *
 * There is deliberately no third: nothing draws a small country larger than it is. A
 * size floor held specks at a few pixels for the current zoom, which made them grow as
 * the camera zoomed out and shrink as it zoomed in — the opposite of the land around
 * them. A speck is drawn at its true size; the catchment is what makes it selectable.
 *
 * None of them touches the map. The real polygons keep their real coordinates, their
 * real area and their real position; these overlays are computed alongside them and
 * are what get thrown away at export time.
 *
 * Everything here is geographic, projected through the same d3 projection as the
 * map, so it follows pan, zoom, projection changes and region changes for free.
 */
import { geoPath, type GeoPath, type GeoProjection } from 'd3-geo'
import { ASSIST_ISLAND_AREA_KM2, SMALL_ENTITY_AREA_KM2 } from '../geo/metrics'
import type { EntityFeature, LoadedDataset } from '../geo/datasets'
import type { Slicer } from '../geo/slices'
import type { ResolvedInset } from '../maps/insets'
import type { CountryId } from '../types/map'

/* ----------------------------------------------------------------- magnifier */

/** Lens radius in screen px — roughly a 68 px lens. */
export const SMALL_ENTITY_LENS_RADIUS_PX = 34

/** Breathing room between the lens rim and the magnified shape. */
export const SMALL_ENTITY_LENS_PADDING_PX = 6

/** Screen offset of the lens from the feature, so the lens does not cover it. */
export const SMALL_ENTITY_LENS_OFFSET_PX = { x: 30, y: -46 }

/**
 * How strongly the magnified shapes are compressed towards a common size.
 *
 * 0 would draw every feature at the same size in the lens, destroying any sense of
 * which is bigger; 1 would preserve true relative size, leaving the smallest ones
 * invisible again. The exponent keeps the ordering — a magnified Malta still reads
 * as much larger than a magnified Vatican City — while keeping both legible.
 */
export const SMALL_ENTITY_SIZE_COMPRESSION = 0.15

/** Smallest a magnified outline may be drawn, in screen px. */
export const SMALL_ENTITY_MIN_MAGNIFIED_PX = 14

/**
 * How far a feature may spread beyond its main landmass and still be magnified whole.
 *
 * Measured as the feature's full projected extent divided by its largest polygon's.
 * A country whose outlying parts sit close to its main island is one coherent place
 * and belongs in the lens complete — Bahrain scores 1.6, Malta 1.6, Antigua 4.1.
 * A country scattered across open ocean is not: fitting all of Kiribati (804) or the
 * Maldives (87) into the lens would shrink every island to nothing, so those keep to
 * their main landmass. The observed gap between the two groups runs from about 4 to
 * about 31, so this sits comfortably in the middle of empty space.
 */
export const SMALL_ENTITY_MAX_LENS_SPREAD = 6

export interface SmallEntityAnchor {
  id: CountryId
  name: string
  areaKm2: number
  /** Representative point, projected. Drives hit resolution and the lens tether. */
  x: number
  y: number
  /** Centre of the feature's projected bounds; centres the shape inside the lens. */
  centerX: number
  centerY: number
  /** Largest projected dimension of the representative polygon, in projected units. */
  projectedSize: number
  /**
   * What the magnifier fits: the whole feature for a compact country, or just its
   * main landmass for one scattered across open ocean.
   */
  lensSize: number
  lensCenterX: number
  lensCenterY: number
  /** Largest projected dimension of the WHOLE feature, in projected units. */
  featureSize: number
  /** Centre of the whole feature's projected bounds. */
  featureCenterX: number
  featureCenterY: number
  /** Scale factor from projected units to screen px inside the lens. */
  magnification: number
}

const clamp = (value: number, min: number, max: number) =>
  value < min ? min : value > max ? max : value

/** On-screen diameter the magnified outline should occupy, in px. */
export function magnifiedSizeForArea(areaKm2: number): number {
  const lensInner = 2 * (SMALL_ENTITY_LENS_RADIUS_PX - SMALL_ENTITY_LENS_PADDING_PX)
  const ratio = clamp(Math.max(areaKm2, 0) / SMALL_ENTITY_AREA_KM2, 0, 1)
  const size = lensInner * Math.pow(ratio, SMALL_ENTITY_SIZE_COMPRESSION)
  return clamp(size, SMALL_ENTITY_MIN_MAGNIFIED_PX, lensInner)
}

/**
 * Projects the anchors for a dataset's small entities.
 *
 * Runs once per projection or dataset change — never on pointer movement, which only
 * does a distance comparison against this precomputed list.
 */
export function computeSmallEntityAnchors(
  dataset: LoadedDataset | null,
  projection: GeoProjection | null,
  insets: readonly ResolvedInset[] = [],
): SmallEntityAnchor[] {
  if (!dataset || !projection) return []

  const through = projectorFor(projection, insets)
  const anchors: SmallEntityAnchor[] = []

  for (const feature of dataset.features) {
    const anchor = drawnAnchor(dataset, feature, through)
    if (anchor) anchors.push(anchor)
  }

  return anchors
}

/**
 * How one entity is put on screen: through its inset's projection when it is drawn in an
 * inset, the main map's otherwise — with a path for it and, for an inset, the frame it is
 * clipped to.
 *
 * An inset member is measured where it is drawn. Guam's legibility floor is a scale about
 * its own centre, its lens is tethered to it and its click target surrounds it, so all
 * three belong in Guam's box — not at Guam's real position through a projection fitted to
 * Kansas, thousands of pixels off the canvas, where they used to be computed.
 */
interface Drawn {
  projection: GeoProjection
  path: GeoPath
  clip: ResolvedInset['clip'] | null
}

function projectorFor(projection: GeoProjection, insets: readonly ResolvedInset[]): (id: CountryId) => Drawn {
  const main: Drawn = { projection, path: geoPath(projection), clip: null }
  const own = new Map<ResolvedInset, Drawn>(
    insets.map((resolved) => [resolved, { projection: resolved.projection, path: geoPath(resolved.projection), clip: resolved.clip }]),
  )
  return (id) => {
    const inset = insets.find((resolved) => resolved.members.has(id))
    return inset ? (own.get(inset) as Drawn) : main
  }
}

/** Whether a projected point lies inside an inset's frame. */
function withinClip(clip: ResolvedInset['clip'], x: number, y: number): boolean {
  return x >= clip.x && x <= clip.x + clip.width && y >= clip.y && y <= clip.y + clip.height
}

/**
 * One feature's anchor through the projection that draws it — or `null`, as `anchorFor`
 * gives, and also when an inset's member is anchored outside the inset's frame, where the
 * inset draws nothing of it.
 */
function drawnAnchor(
  dataset: LoadedDataset,
  feature: EntityFeature,
  through: (id: CountryId) => Drawn,
): SmallEntityAnchor | null {
  const drawn = through(feature.properties.countryId)
  const anchor = anchorFor(dataset, feature, drawn.path, drawn.projection)
  if (anchor && drawn.clip && !withinClip(drawn.clip, anchor.x, anchor.y)) return null
  return anchor
}

/**
 * The same anchors, measured a slice at a time — see `createSlicer`. Resolves to `null` if
 * `cancelled` turns true while it pauses.
 */
export async function computeSmallEntityAnchorsInSlices(
  dataset: LoadedDataset,
  projection: GeoProjection,
  insets: readonly ResolvedInset[],
  slicer: Slicer,
  cancelled: () => boolean,
): Promise<SmallEntityAnchor[] | null> {
  const through = projectorFor(projection, insets)
  const anchors: SmallEntityAnchor[] = []

  for (const feature of dataset.features) {
    if (slicer.due()) {
      await slicer.pause()
      if (cancelled()) return null
    }
    const anchor = drawnAnchor(dataset, feature, through)
    if (anchor) anchors.push(anchor)
  }

  return anchors
}

/** One feature's anchor, or `null` when it is not a small entity or cannot be projected. */
function anchorFor(
  dataset: LoadedDataset,
  feature: EntityFeature,
  path: GeoPath,
  projection: GeoProjection,
): SmallEntityAnchor | null {
  const id = feature.properties.countryId
  const metrics = dataset.metrics.get(id)
  if (!metrics?.small) return null

  const point = projection(metrics.representativePoint)
  if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) return null

  // The main landmass, which anchors both the representative point and — for a
  // scattered archipelago — the lens.
  const bounds = path.bounds({
    type: 'Polygon',
    coordinates: metrics.representativePolygon,
  })
  const hasBounds = Number.isFinite(bounds[0][0]) && Number.isFinite(bounds[1][0])
  const width = hasBounds ? bounds[1][0] - bounds[0][0] : 0
  const height = hasBounds ? bounds[1][1] - bounds[0][1] : 0

  // A degenerate projected size would blow the magnification up to infinity.
  const projectedSize = Math.max(width, height, 1e-4)

  // The whole feature, islands included. Cheap here because these are the
  // smallest features in the dataset.
  const full = path.bounds(feature)
  const fullOk = Number.isFinite(full[0][0]) && Number.isFinite(full[1][0])
  const featureSize = fullOk
    ? Math.max(full[1][0] - full[0][0], full[1][1] - full[0][1], 1e-4)
    : projectedSize

  /**
   * Magnify the whole country when its parts hang together, and only the main
   * landmass when they do not. Bahrain's Hawar group sits a short way off its main
   * island and is part of the same place, so the lens should show it; the Maldives
   * stretch over hundreds of kilometres of ocean, so fitting them all in would
   * leave every atoll invisible.
   */
  const compact = fullOk && featureSize <= projectedSize * SMALL_ENTITY_MAX_LENS_SPREAD
  const lensSize = compact ? featureSize : projectedSize
  const lensBounds = compact ? full : bounds
  const lensCenterX = hasBounds || fullOk ? (lensBounds[0][0] + lensBounds[1][0]) / 2 : point[0]
  const lensCenterY = hasBounds || fullOk ? (lensBounds[0][1] + lensBounds[1][1]) / 2 : point[1]

  return {
    id,
    name: feature.properties.name,
    areaKm2: metrics.areaKm2,
    x: point[0],
    y: point[1],
    centerX: hasBounds ? (bounds[0][0] + bounds[1][0]) / 2 : point[0],
    centerY: hasBounds ? (bounds[0][1] + bounds[1][1]) / 2 : point[1],
    projectedSize,
    lensSize,
    lensCenterX,
    lensCenterY,
    featureSize,
    featureCenterX: fullOk ? (full[0][0] + full[1][0]) / 2 : point[0],
    featureCenterY: fullOk ? (full[0][1] + full[1][1]) / 2 : point[1],
    magnification: magnifiedSizeForArea(metrics.areaKm2) / lensSize,
  }
}

export interface Transform {
  k: number
  x: number
  y: number
}

/** Screen position of an anchor under the current camera. */
export function anchorScreenPosition(
  anchor: SmallEntityAnchor,
  transform: Transform,
): [number, number] {
  return [transform.x + transform.k * anchor.x, transform.y + transform.k * anchor.y]
}


/* -------------------------------------------------------- assisted selection */

/**
 * The click target an island too small to aim at is grown to, in screen px.
 *
 * Assistance is the difference between what an island already occupies on screen and
 * this: a sub-pixel speck is padded out to a comfortable target, an island already
 * this big is padded by nothing and answers clicks on its own outline. So the help
 * fades out smoothly as the camera zooms in, and no catchment is ever fixed in
 * geographic units — the same handful of pixels beside a Maldivian atoll is 1,591 km
 * at world zoom, 436 km at 4x and 92 km at 16x, which is the right answer at each.
 */
export const ASSIST_TARGET_PX = 44

/**
 * Hard ceiling on the padding, in screen px.
 *
 * Reached by anything sub-pixel, so in practice this is the catchment radius of a
 * microstate. It is what keeps island groups that are genuinely far apart from
 * fusing into one hitbox across open ocean: Kiribati's Gilberts, Phoenix and Line
 * groups sit 15° apart, and no zoom that shows them as separate places puts them
 * within 2 × 22 px of each other.
 */
export const ASSIST_MAX_PADDING_PX = 22

/**
 * How far a catchment may reach over a *neighbour's* land, in screen px, for a
 * country at the small-entity threshold and for one of no size at all.
 *
 * Reaching over open water only has to answer "is anything else out there", and the
 * padding above answers it. Reaching over another country's territory is a different
 * claim — that the cursor was aimed at the tiny thing and missed — so it is both
 * shorter than the padding and scaled by how badly the country needs it. Vatican City
 * owns no pixels at continental zoom and must be reachable from the Roman ones around
 * it; the Isle of Man owns plenty and has no business answering for the middle of
 * Ireland sixteen pixels away, nor Bahrain for inland Oman, nor the Caymans for
 * western Cuba. The range is set by that gap: every one of those misfires reaches
 * from 16 px out, and no microstate needs more than a comfortable finger's width.
 */
export const ASSIST_OVER_LAND_MIN_PX = 10
export const ASSIST_OVER_LAND_MAX_PX = 18

/**
 * The over-land allowance for a country of this area, in screen px.
 *
 * Scaled by the square root of the area so it tracks linear extent rather than area:
 * a country just under the small-entity threshold gets the minimum, a speck gets the
 * maximum, and anything larger gets nothing at all.
 */
export function overLandReachForArea(areaKm2: number): number {
  const ratio = clamp(Math.sqrt(Math.max(areaKm2, 0) / SMALL_ENTITY_AREA_KM2), 0, 1)
  return (
    ASSIST_OVER_LAND_MIN_PX +
    (ASSIST_OVER_LAND_MAX_PX - ASSIST_OVER_LAND_MIN_PX) * (1 - ratio)
  )
}

/**
 * One island's catchment: the projected bounds of a single polygon.
 *
 * A box rather than a point, and one per polygon rather than one per country. That
 * is the whole fix: a country is wherever its islands are, so the Maldives get 175
 * catchments strung along their atolls instead of one circle over the largest island
 * with 174 unclickable neighbours. Boxes near each other overlap and read as one
 * region, which is what makes the water inside an atoll or between two islands of a
 * group selectable; boxes far apart stay far apart, and the ocean between them stays
 * ocean.
 *
 * Bounds are in projected units, before the zoom transform, so panning and zooming
 * cost nothing and only the padding has to be recomputed.
 */
export interface AssistIsland {
  id: CountryId
  minX: number
  minY: number
  maxX: number
  maxY: number
  /** Largest projected dimension, for the zoom-dependent padding. */
  extent: number
  /**
   * Whether this island may take a click, or is only here to defend its own ground.
   *
   * Only islands of countries that need assistance may claim. The rest are carried
   * because a country that is not in the index cannot answer for its own land:
   * Finland's Turku skerries are here to stop Åland answering for them, not to give
   * Finland a catchment it never needed.
   */
  claims: boolean
  /**
   * Whether standing on this island settles the question outright.
   *
   * True only for a genuinely small island of a country that needs no help — a
   * skerry, an islet, something whose bounding box really is the island. A mainland
   * is excluded even though it projects small at world zoom, both because its box is
   * a poor likeness of it (Italy's reaches clear across the Adriatic) and because
   * being somewhere in Italy is the exact situation Vatican City's catchment exists
   * for.
   */
  blocks: boolean
  /**
   * How far this catchment may reach over another country's land, in screen px.
   *
   * Zero for everything that is not a small entity, which is the privilege they have
   * always had: Monaco has to be selectable from the French pixels around it, because
   * at continental zoom there are no Monegasque pixels to click. It is not granted to
   * an archipelago that merely has small islands, and that asymmetry is doing real
   * work — the Bahamas' nearest cay sits a dozen pixels off the Cuban coast, and a
   * click well inside Cuba means Cuba. An archipelago's problem is the ocean between
   * its islands, not a neighbour's territory on top of it.
   */
  overLandPx: number
}

export interface AssistIndex {
  islands: AssistIsland[]
  /** Countries that have at least one catchment, for the direct-hit rule. */
  ids: Set<CountryId>
}

export const EMPTY_ASSIST_INDEX: AssistIndex = { islands: [], ids: new Set() }

/**
 * Projects a catchment for every island small enough to need one, plus the islands
 * that are only here to answer for themselves.
 *
 * Islands are projected from their geographic bounds rather than from every vertex:
 * a candidate here is by definition a few pixels across, and any projection is
 * locally affine at that size. Anything already larger than the target at the widest
 * view is dropped, since the zoom floor is 1x — it can only get easier to click from
 * here, and its own outline is a better hit target than any box around it.
 *
 * Runs once per projection or dataset change, never while the pointer moves.
 */
export function buildAssistIndex(
  dataset: LoadedDataset | null,
  projection: GeoProjection | null,
  insets: readonly ResolvedInset[] = [],
): AssistIndex {
  if (!dataset || !projection) return EMPTY_ASSIST_INDEX

  const through = projectorFor(projection, insets)
  const islands: AssistIsland[] = []
  const ids = new Set<CountryId>()

  for (const feature of dataset.features) {
    const id = feature.properties.countryId
    const metrics = dataset.metrics.get(id)
    if (!metrics) continue
    const drawn = through(id)
    const claims = metrics.assisted
    const overLandPx = metrics.small ? overLandReachForArea(metrics.areaKm2) : 0

    for (const island of metrics.islands) {
      const [west, south, east, north] = island.bounds
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity

      for (const corner of [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
      ] as [number, number][]) {
        const point = drawn.projection(corner)
        if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
          minX = Infinity
          break
        }
        if (point[0] < minX) minX = point[0]
        if (point[0] > maxX) maxX = point[0]
        if (point[1] < minY) minY = point[1]
        if (point[1] > maxY) maxY = point[1]
      }

      if (!Number.isFinite(minX)) continue
      // An inset cuts away what lies outside its frame, so an island there has nothing to click.
      if (drawn.clip && !withinClip(drawn.clip, (minX + maxX) / 2, (minY + maxY) / 2)) continue

      const extent = Math.max(maxX - minX, maxY - minY)
      if (extent >= ASSIST_TARGET_PX) continue

      // A country that needs no help is only here to answer for its own islands, so
      // only the islands it could plausibly be answering for are worth carrying.
      const blocks = !claims && island.areaKm2 < ASSIST_ISLAND_AREA_KM2
      if (!claims && !blocks) continue

      islands.push({ id, minX, minY, maxX, maxY, extent, claims, blocks, overLandPx })
      if (claims) ids.add(id)
    }
  }

  return { islands, ids }
}

/** Reach of an island that may not claim the point under the cursor at all. */
const NO_REACH = -1

/** Padding an island of this on-screen size is grown by, in screen px. */
function paddingFor(extentPx: number): number {
  return Math.min(ASSIST_MAX_PADDING_PX, (ASSIST_TARGET_PX - extentPx) / 2)
}

/**
 * The country whose assisted-selection area claims a screen point, or null.
 *
 * Catchments overlap each other and overlap the countries around them on purpose, so
 * the contest has to be settled by geography rather than by who was given the larger
 * radius. Two facts are gathered in one pass: which island is *nearest* to the
 * cursor, and which island actually *reaches* it. A claim stands only when those two
 * agree on the country.
 *
 * That single test is what stops a catchment swallowing its neighbours. A speck
 * padded out to 22 px sitting beside a larger island padded by 4 px cannot take the
 * water in front of that island, because the larger island is nearer there and does
 * not reach; the point resolves to nothing and the click falls through to the real
 * geometry underneath. Islands of the same country never compete with each other,
 * so a group still reads as one continuous region.
 *
 * `covering` is the country whose rendered polygon lies under the cursor, if any.
 * A catchment reaches its full padding over open water and over its own country's
 * land; over a neighbour's it reaches only its {@link AssistIsland.overLandPx}
 * allowance, which shrinks with area because it is a measure of how badly the
 * country needs to borrow someone else's pixels.
 *
 * Islands of countries that need no assistance take no part in the contest, with one
 * exception: standing on one settles the question outright. That is a statement
 * about the pixel under the cursor and not about the neighbourhood — an island the
 * user is *on* is unambiguously what they meant, whereas an island merely nearby is
 * not, and at world zoom everything in central Italy is nearby. It keeps Åland from
 * answering for the Finnish skerry under the cursor and the Isle of Man from
 * answering for the middle of Ireland, without costing Vatican City the Roman pixels
 * it has nothing else to be clicked from.
 */
export function pickAssistedCountryAt(
  index: AssistIndex,
  localX: number,
  localY: number,
  transform: Transform,
  covering: CountryId | null = null,
): CountryId | null {
  const { k } = transform

  // Into projection space once, so the catchments themselves never have to move.
  const x = (localX - transform.x) / k
  const y = (localY - transform.y) / k

  let nearestId: CountryId | null = null
  let nearestDistance = Infinity
  let claimedId: CountryId | null = null
  let claimedDistance = Infinity
  let standingOnPlainLand = false

  for (const island of index.islands) {
    const dx = x < island.minX ? island.minX - x : x > island.maxX ? x - island.maxX : 0
    const dy = y < island.minY ? island.minY - y : y > island.maxY ? y - island.maxY : 0

    // An island of a country that needs no help takes no part in the contest, except
    // to settle it outright when the cursor is standing on it.
    if (!island.claims) {
      if (island.blocks && dx === 0 && dy === 0) standingOnPlainLand = true
      continue
    }

    const extentPx = island.extent * k
    if (extentPx >= ASSIST_TARGET_PX) continue

    const distance = Math.sqrt(dx * dx + dy * dy) * k

    if (distance < nearestDistance) {
      nearestDistance = distance
      nearestId = island.id
    }

    // Over its own ground — open water, or its own country's land — a catchment
    // reaches its full padding. Over a neighbour's it reaches its area-scaled
    // allowance, and never more than the padding, so borrowing fades out with the
    // rest of the assistance as the camera zooms in and the island becomes its own
    // best target. It reaches nothing at all if it is not a small entity. `NO_REACH` is
    // negative rather than zero so a catchment that may not reach here does not take
    // the point when the cursor lands inside its bounding box, which happens where a
    // neighbour's island brackets an enclave — Oecusse sits inside Indonesian Timor,
    // and the box around a nearby Indonesian islet covers part of it.
    const onOwnGround = covering === null || island.id === covering
    const padding = paddingFor(extentPx)
    let reach = NO_REACH
    if (onOwnGround) reach = padding
    else if (island.overLandPx > 0) reach = Math.min(island.overLandPx, padding)

    if (distance <= reach && distance < claimedDistance) {
      claimedDistance = distance
      claimedId = island.id
    }
  }

  if (standingOnPlainLand) return null
  return claimedId !== null && claimedId === nearestId ? claimedId : null
}

