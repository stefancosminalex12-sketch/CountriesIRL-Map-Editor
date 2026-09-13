/**
 * Per-country geographic metrics, computed once when a dataset is loaded.
 *
 * These are properties of the geography itself — area and a representative point —
 * so they are independent of projection, zoom, region and viewport. Everything the
 * interaction layer needs is derived here and cached on the dataset, which keeps
 * pointer handling free of geographic maths.
 *
 * Nothing here modifies geometry. The polygons stay exactly as the dataset (or the
 * supplemental layer) provided them.
 */
import { geoArea, geoCentroid, geoContains } from 'd3-geo'
import type { Position } from 'geojson'
import { Adder } from './adder'
import type { Slicer } from './slices'
import type { CountryFeature } from './datasets'
import type { CountryId } from '../types/map'

const EARTH_RADIUS_KM = 6371

/**
 * Below this area a feature is treated as a "small entity": too small to hit
 * reliably at normal regional zoom, so the interaction layer gives it an assisted
 * target and a selection marker.
 *
 * The rule is purely geographic — there is no list of microstates anywhere. Whatever
 * falls under the threshold qualifies, whether it is a country, an island, a
 * dependency or something a future dataset introduces. Tune this one number to change
 * what counts as small.
 */
export const SMALL_ENTITY_AREA_KM2 = 1000

/**
 * Below this a single island is too small to aim at, whatever its country's total.
 *
 * Assisted selection is a property of an island, not of a nation: Guadalcanal is
 * easy to click and the Solomons' other forty-seven islands are not, even though
 * they share a passport. This threshold is what tells the two apart.
 */
export const ASSIST_ISLAND_AREA_KM2 = 2000

/** How many separate polygons a country needs before it counts as an archipelago. */
export const ASSIST_MIN_ISLANDS = 2

/**
 * Share of a country's area its largest polygon may hold and still leave the country
 * archipelagic.
 *
 * This is what separates an island nation from a mainland country that happens to
 * own islands. The measured split is wide and empty: the Bahamas' largest island
 * holds 0.28 of the country, the Solomons' 0.20, French Polynesia's 0.31, Fiji's
 * 0.58 — against Japan 0.61, Denmark 0.67, Norway 0.79, Greece 0.81, the UK 0.90.
 * Greece's Aegean islands are numerous and small, but a map of Greece is a map of a
 * mainland, and its coastline must keep answering clicks normally.
 */
export const ASSIST_DOMINANCE = 0.6

/** [west, south, east, north] of one polygon, longitudes unwrapped. */
export type IslandBounds = [number, number, number, number]

/** One polygon of a feature, reduced to what assisted selection needs. */
export interface IslandMetrics {
  bounds: IslandBounds
  areaKm2: number
  /**
   * The same area in steradians, exactly as `geoArea` returns it for this polygon.
   *
   * Kept because the camera's framing weighs every polygon by it, and used to measure
   * it again — a second pass over every vertex of every member, on every region.
   */
  area: number
}

export interface CountryMetrics {
  /** Spherical area of the whole feature, in km². */
  areaKm2: number
  /**
   * A geographic point standing in for the feature. Lies inside the feature's
   * largest polygon where possible, so it is a sensible anchor for irregular
   * islands rather than a bounding-box corner.
   */
  representativePoint: [number, number]
  /**
   * The polygon the representative point sits in — the feature's largest.
   *
   * Held by reference (no copy) so overlays can size themselves against the part of
   * the entity that actually matters. Kiribati's islands span 2,400 km of ocean; the
   * whole feature's bounds describe that ocean, not any island in it.
   */
  representativePolygon: Position[][]
  /** True when `areaKm2` is below {@link SMALL_ENTITY_AREA_KM2}. */
  small: boolean
  /**
   * Whether this country's geometry is hard enough to hit to deserve assisted
   * selection. See {@link needsAssistance}.
   *
   * Deliberately separate from `small`, which still governs the magnifier and the
   * minimum rendered size. A country can be far too large to be a "small entity"
   * and still be unclickable island by island — that is exactly the Bahamas.
   */
  assisted: boolean
  /**
   * Every polygon in the feature, with its bounds and its own area.
   *
   * The raw material for assisted selection: one entry per island, so the
   * interaction layer can follow where a country's land actually is instead of
   * standing in one place for all of it.
   *
   * Carried for every country, not only the assisted ones. A country that needs no
   * help still has to be able to answer for its own islands — the Turku skerries
   * interleave with Åland's, and Finland cannot defend them if the interaction layer
   * cannot see them.
   */
  islands: IslandMetrics[]
  /**
   * Group index used by themes that tint neighbouring countries differently.
   *
   * Assigned by graph-colouring the countries so that adjacent ones land in
   * different groups. This is a legibility device — the same job a political map's
   * colouring does — and says nothing whatsoever about the land. It is not
   * elevation, and no terrain data is implied or invented.
   */
  tintGroup: number
}

/** How many distinct groups the colouring may use. */
export const TINT_GROUP_COUNT = 5

function toPolygons(feature: CountryFeature): Position[][][] {
  return feature.geometry.type === 'Polygon'
    ? [feature.geometry.coordinates]
    : feature.geometry.coordinates
}

/** The vertex of `ring` closest to `target`; used when a centroid falls outside. */
function nearestVertex(ring: Position[], target: [number, number]): [number, number] {
  let best: [number, number] = [ring[0][0], ring[0][1]]
  let bestDistance = Infinity
  for (const [lon, lat] of ring) {
    const dLon = lon - target[0]
    const dLat = lat - target[1]
    const distance = dLon * dLon + dLat * dLat
    if (distance < bestDistance) {
      bestDistance = distance
      best = [lon, lat]
    }
  }
  return best
}

/**
 * Picks the representative point for a feature.
 *
 * The centroid of the feature's largest polygon is the anchor, because the centroid
 * of a scattered archipelago lands in open water between its islands. Even a single
 * polygon can put its centroid outside itself — a ring-shaped atoll centres on its
 * lagoon — so the result is checked for containment and falls back to the nearest
 * point on the boundary.
 */
function representativeOf(
  polygons: Position[][][],
  areas: number[],
): {
  point: [number, number]
  polygon: Position[][]
} {
  let largest = polygons[0]
  let largestArea = -Infinity
  polygons.forEach((polygon, i) => {
    const area = areas[i]
    if (area > largestArea) {
      largestArea = area
      largest = polygon
    }
  })

  const polygon = { type: 'Polygon' as const, coordinates: largest }
  const centroid = geoCentroid(polygon) as [number, number]

  if (!Number.isFinite(centroid[0]) || !Number.isFinite(centroid[1])) {
    return { point: [largest[0][0][0], largest[0][0][1]], polygon: largest }
  }
  if (geoContains(polygon, centroid)) return { point: centroid, polygon: largest }

  return { point: nearestVertex(largest[0], centroid), polygon: largest }
}

/**
 * Geographic bounds of one polygon, with longitudes unwrapped.
 *
 * A ring that crosses the antimeridian carries vertices at both +179 and -179, and
 * taking min/max naively reports a 360° span for an island a few kilometres across —
 * which would classify Fiji's eastern islands, and two of Canada's and the United
 * States', as too large to need any help. Walking the ring and following each step
 * to the nearer side keeps the span honest; the projection accepts longitudes past
 * ±180 unchanged.
 */
function unwrappedBounds(polygon: Position[][]): IslandBounds {
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity

  for (const ring of polygon) {
    let previous: number | null = null
    for (const [lon, lat] of ring) {
      let x = lon
      if (previous !== null) {
        while (x - previous > 180) x -= 360
        while (previous - x > 180) x += 360
      }
      previous = x
      if (x < west) west = x
      if (x > east) east = x
      if (lat < south) south = lat
      if (lat > north) north = lat
    }
  }

  return [west, south, east, north]
}

/**
 * Whether a country's geometry is hard enough to hit to deserve assisted selection.
 *
 * Two ways to qualify, and no list of names anywhere:
 *
 *   - the whole country is a small entity — the microstates, and every island
 *     nation that fits under the threshold;
 *   - the country is an archipelago: several separate polygons, and no single
 *     landmass that both dominates its area and is large enough to click. Either
 *     the largest island is itself small (Comoros, Mauritius, Samoa), or the land
 *     is spread thin enough that the largest island is a minority of it (the
 *     Bahamas, the Solomons, French Polynesia, Fiji, the Philippines, Indonesia).
 *
 * A mainland country with islands fails both tests, which is the point: Greece,
 * Norway, Japan, Croatia and Chile keep ordinary geometry selection everywhere.
 */
function needsAssistance(areaKm2: number, polygonAreas: number[]): boolean {
  if (areaKm2 < SMALL_ENTITY_AREA_KM2) return true
  if (polygonAreas.length < ASSIST_MIN_ISLANDS) return false

  let largest = 0
  for (const area of polygonAreas) if (area > largest) largest = area

  if (largest < ASSIST_ISLAND_AREA_KM2) return true
  return areaKm2 > 0 && largest / areaKm2 < ASSIST_DOMINANCE
}

export function computeCountryMetrics(feature: CountryFeature): CountryMetrics {
  const polygons = toPolygons(feature)
  /*
   * Each polygon's area, measured once. The largest polygon, the per-island areas and the
   * total are all read from these; they used to be three separate passes over every vertex.
   *
   * The total is summed the way `geoArea(feature)` sums it — see `Adder` — so it is the
   * very number that call returned, bit for bit. `geoArea` returns twice its accumulator,
   * and for a single polygon that accumulator holds one value, so halving the polygon's
   * area recovers it exactly (a power of two costs no precision).
   */
  const areas = polygons.map((polygon) => geoArea({ type: 'Polygon', coordinates: polygon }))
  const total = new Adder()
  for (const area of areas) total.add(area / 2)
  const areaKm2 = +total * 2 * EARTH_RADIUS_KM * EARTH_RADIUS_KM
  const representative = representativeOf(polygons, areas)
  const polygonAreas = areas.map((area) => area * EARTH_RADIUS_KM * EARTH_RADIUS_KM)
  const assisted = needsAssistance(areaKm2, polygonAreas)

  return {
    areaKm2,
    representativePoint: representative.point,
    representativePolygon: representative.polygon,
    small: areaKm2 < SMALL_ENTITY_AREA_KM2,
    assisted,
    islands: polygons.map((polygon, i) => ({
      bounds: unwrappedBounds(polygon),
      areaKm2: polygonAreas[i],
      area: areas[i],
    })),
    // Replaced by `assignTintGroups` once every country is known.
    tintGroup: 0,
  }
}

/** Lon/lat bounds of a polygon's outer ring. */
function ringBounds(polygon: Position[][]): [number, number, number, number] {
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity
  for (const ring of polygon) {
    for (const [lon, lat] of ring) {
      if (lon < west) west = lon
      if (lon > east) east = lon
      if (lat < south) south = lat
      if (lat > north) north = lat
    }
  }
  return [west, south, east, north]
}

/** Degrees of slack when deciding whether two countries touch. */
const ADJACENCY_MARGIN_DEG = 0.75

/**
 * Assigns each country a tint group so that neighbours differ.
 *
 * Adjacency is approximated by overlap of the countries' main-landmass bounds,
 * grown slightly. That over-reports neighbours — two countries near each other but
 * not touching are treated as adjacent — which is the safe direction: it costs an
 * occasional extra colour and never lets a real border go unmarked. Greedy colouring
 * then walks the countries largest-first, giving each the lowest group none of its
 * already-coloured neighbours used.
 *
 * Runs once per dataset load, from geometry alone, so it is independent of theme,
 * projection and zoom.
 */
function assignTintGroups(
  features: CountryFeature[],
  metrics: Map<CountryId, CountryMetrics>,
): void {
  const bounds = new Map<CountryId, [number, number, number, number]>()
  for (const feature of features) {
    const id = feature.properties.countryId
    const entry = metrics.get(id)
    if (entry) bounds.set(id, ringBounds(entry.representativePolygon))
  }

  const order = [...bounds.keys()].sort(
    (a, b) => (metrics.get(b)?.areaKm2 ?? 0) - (metrics.get(a)?.areaKm2 ?? 0),
  )

  /*
   * Every pair whose grown boxes overlap, found by sweeping west to east rather than by
   * testing every pair: 4,595 subdivisions are ten million pairs, and all but a few
   * thousand of them are nowhere near each other. Sorted by western edge, a box can only
   * overlap the ones whose western edge comes before its own eastern edge (plus the
   * margin), so the scan for each stops there. The pairs found are exactly the ones the
   * pairwise test found, and a neighbour list is only ever read as a set of groups
   * already taken, so the colouring is unchanged.
   */
  const neighbours = new Map<CountryId, CountryId[]>()
  for (const a of order) neighbours.set(a, [])
  const byWest = order
    .map((id) => ({ id, box: bounds.get(id)! }))
    .sort((a, b) => a.box[0] - b.box[0])
  for (let i = 0; i < byWest.length; i++) {
    const { id: a, box: ba } = byWest[i]
    const reach = ba[2] + ADJACENCY_MARGIN_DEG
    for (let j = i + 1; j < byWest.length; j++) {
      const { id: b, box: bb } = byWest[j]
      if (bb[0] > reach) break
      const touches =
        ba[0] - ADJACENCY_MARGIN_DEG <= bb[2] &&
        bb[0] - ADJACENCY_MARGIN_DEG <= ba[2] &&
        ba[1] - ADJACENCY_MARGIN_DEG <= bb[3] &&
        bb[1] - ADJACENCY_MARGIN_DEG <= ba[3]
      if (touches) {
        neighbours.get(a)!.push(b)
        neighbours.get(b)!.push(a)
      }
    }
  }

  const assigned = new Map<CountryId, number>()
  for (const id of order) {
    const used = new Set<number>()
    for (const other of neighbours.get(id) ?? []) {
      const group = assigned.get(other)
      if (group !== undefined) used.add(group)
    }
    let group = 0
    while (group < TINT_GROUP_COUNT - 1 && used.has(group)) group++
    assigned.set(id, group)
    const entry = metrics.get(id)
    if (entry) entry.tintGroup = group
  }
}

export function computeDatasetMetrics(
  features: CountryFeature[],
): Map<CountryId, CountryMetrics> {
  const metrics = new Map<CountryId, CountryMetrics>()
  for (const feature of features) {
    metrics.set(feature.properties.countryId, computeCountryMetrics(feature))
  }
  assignTintGroups(features, metrics)
  return metrics
}

/**
 * The same metrics, measured a slice at a time.
 *
 * Between features the slicer is asked whether its time budget is spent, and only then
 * does the loop hand the thread back — so a dataset of thousands of entities is measured
 * without holding the page. The work is identical and so is the result; the browser simply
 * gets to paint and answer input in between. See `createSlicer`.
 */
export async function computeDatasetMetricsInSlices(
  features: CountryFeature[],
  slicer: Slicer,
): Promise<Map<CountryId, CountryMetrics>> {
  const metrics = new Map<CountryId, CountryMetrics>()
  for (const feature of features) {
    metrics.set(feature.properties.countryId, computeCountryMetrics(feature))
    if (slicer.due()) await slicer.pause()
  }
  assignTintGroups(features, metrics)
  return metrics
}
