/**
 * Geometry-derived camera framing.
 *
 * The camera is fitted to the geography that is actually on the map, not to a
 * lat/lon rectangle. Two things make that safe:
 *
 *   1. a per-region `domain` — a declarative cartographic scope (e.g. "European
 *      Russia ends near the 50th meridian", "the world view crops Antarctica");
 *   2. automatic outlier rejection inside that domain — the region's major
 *      landmasses define a core, and a minor polygon is framed only if it sits
 *      close to that core (island chains connecting one hop at a time).
 *
 * Rule 2 is what keeps Svalbard from deciding where the top of a map of Europe is,
 * without hiding it: Svalbard holds well under 1% of Europe's area and stays 3°+
 * clear of the core, so it drops out of the camera while still rendering. A dense
 * archipelago such as Indonesia or the Pacific island groups connects to its core
 * and is never mistaken for an outlier.
 *
 * Because the bounds come from real polygons, the framing adapts on its own to
 * whichever dataset is loaded (110m / 50m / 10m, and later historical ones).
 */
import { geoArea } from 'd3-geo'
import type { MultiPoint, Position } from 'geojson'
import type { LoadedDataset } from './datasets'
import {
  countriesInRegions,
  memberDomain,
  resolveFraming,
  type BBox,
  type ExcludedArea,
  type ScopeFraming,
} from './regions'
import type { RegionId } from '../types/map'

/** One polygon reduced to what the camera needs to know about it. */
interface PolygonExtent {
  west: number
  south: number
  east: number
  north: number
  /** Approximate area of the part inside the domain, in steradians. */
  weight: number
  /**
   * The polygon itself, and how many of its vertices lie inside the domain.
   *
   * The in-domain vertices used to be copied out here as `[lon, lat]` pairs — one small
   * array per vertex of every member, 858,000 of them on the administrative world — only
   * for all but 6,000 to be thrown away by the sampling in `buildFitTarget`. The count is
   * what the weighting needs; the few vertices the fit keeps are read back from the
   * polygon there, by the same test and in the same order.
   */
  polygon: Position[][]
  inside: number
  /**
   * The four real vertices reaching this polygon's edges. Sampling may thin the vertices,
   * but these must always survive or the fit would quietly clip the extremes.
   */
  extremes: [number, number][]
  /** The box this polygon's vertices were tested against: the scope's, or its part's. */
  domain: BBox
  /** Framed whatever its size or distance: a named member's main landmass. */
  anchor?: boolean
}

export interface ResolvedFraming extends ScopeFraming {
  /** Points the projection is fitted to. */
  fitTarget: MultiPoint
  /**
   * Area carried by each fit-target point, as a parallel array.
   *
   * A vertex on Ukraine's steppe and a vertex on a Hebridean skerry are both one
   * point to `fitExtent`, which is why a plain fit cannot tell the region's body
   * from its fringe. The weight is the polygon's own area shared out across its
   * vertices, so the camera can ask a question a point cloud alone cannot answer:
   * *how much of this region would actually leave the frame if I zoomed in?*
   *
   * Deliberately geographic and projection-free. Where those points land on screen
   * depends on the active projection, so the decision that uses these weights lives
   * in `fit.ts` and is recomputed per projection.
   */
  fitWeights: number[]
  /**
   * One representative point per framed landmass.
   *
   * Area weights alone cannot protect an archipelago. Guam, Palau, the Marshalls and
   * the Marianas together hold a rounding error of Oceania's area, so an area budget
   * will spend all of them to gain a few percent of zoom on Australia — and half the
   * region leaves the frame while the budget still reads as untouched. But
   * `selectFramedPolygons` has already decided these are part of the composition,
   * and that decision has to mean something downstream.
   *
   * So each framed polygon contributes a point the camera must keep on screen. The
   * budget then spends only what lies *between* landmasses — a peninsula's last
   * kilometres, the outer edge of a steppe — and never a whole island.
   */
  fitAnchors: [number, number][]
  /** Geographic bounds the camera settled on, for display and debugging. */
  fitBBox: BBox
  /** Extra viewport padding requested by the region's margin, as a fraction. */
  margin: number
  /** Whether real geometry drove the result, or the static fallback window did. */
  source: 'geometry' | 'fallback'
}

/** Brings a longitude into the frame centred on `centerLon`, crossing the antimeridian. */
function normaliseLon(lon: number, centerLon: number): number {
  let x = lon
  while (x - centerLon > 180) x -= 360
  while (centerLon - x > 180) x += 360
  return x
}

/** True when a polygon lies wholly inside an area the region excludes. */
function isExcluded(
  west: number,
  south: number,
  east: number,
  north: number,
  excluded: ExcludedArea[],
): boolean {
  for (const area of excluded) {
    const [aw, as, ae, an] = area.bbox
    if (west >= aw && east <= ae && south >= as && north <= an) return true
  }
  return false
}

/**
 * Reduces every member polygon to its in-domain extent.
 *
 * Excluded areas are applied first, against each polygon's full extent, so geography
 * the region does not contain never influences anything downstream — not the area
 * budget, not the core, not the bounds. Polygons fully outside the domain are skipped.
 */
function collectExtents(
  memberIds: Set<string>,
  dataset: LoadedDataset,
  scopeDomain: BBox,
  excluded: ExcludedArea[],
  domainFor: (id: string) => BBox | null = () => null,
  explicitMembers = false,
): PolygonExtent[] {
  const centerLon = (scopeDomain[0] + scopeDomain[2]) / 2
  const out: PolygonExtent[] = []

  for (const id of memberIds) {
    const feature = dataset.byId.get(id)
    if (!feature) continue
    // A member held only in part (the United States in New England) is tested against its
    // part's extent, brought into the same longitude frame as everything else.
    const domain = alignDomain(domainFor(id) ?? scopeDomain, centerLon)
    const [dw, ds, de, dn] = domain

    const polygons =
      feature.geometry.type === 'Polygon'
        ? [feature.geometry.coordinates]
        : feature.geometry.coordinates
    /*
     * Each polygon's area was measured when the dataset loaded — `IslandMetrics.area` is
     * `geoArea` of this very polygon — so it is read rather than measured again.
     */
    const islands = dataset.metrics.get(id)?.islands
    const measured = islands && islands.length === polygons.length ? islands : null
    const firstOfMember = out.length

    for (let k = 0; k < polygons.length; k++) {
      let polygon = polygons[k]
      // Full extent, used for the exclusion test.
      let fullWest = Infinity
      let fullSouth = Infinity
      let fullEast = -Infinity
      let fullNorth = -Infinity

      // In-domain extent and vertices, used for framing.
      let west = Infinity
      let south = Infinity
      let east = -Infinity
      let north = -Infinity
      let inside = 0
      let total = 0
      let atWest: [number, number] | null = null
      let atEast: [number, number] | null = null
      let atSouth: [number, number] | null = null
      let atNorth: [number, number] | null = null

      for (const ring of polygon) {
        for (const [lon, lat] of ring) {
          total++
          const x = normaliseLon(lon, centerLon)
          if (x < fullWest) fullWest = x
          if (x > fullEast) fullEast = x
          if (lat < fullSouth) fullSouth = lat
          if (lat > fullNorth) fullNorth = lat

          if (x < dw || x > de || lat < ds || lat > dn) continue
          inside++
          if (x < west) {
            west = x
            atWest = [x, lat]
          }
          if (x > east) {
            east = x
            atEast = [x, lat]
          }
          if (lat < south) {
            south = lat
            atSouth = [x, lat]
          }
          if (lat > north) {
            north = lat
            atNorth = [x, lat]
          }
        }
      }

      if (inside === 0) continue
      if (isExcluded(fullWest, fullSouth, fullEast, fullNorth, excluded)) continue

      /*
       * Cut by the domain: frame the part inside it, edges included. Only the polygon's own
       * vertices would otherwise be seen, and inland there are none, so the American
       * Southwest, whose northern edge runs across the middle of the United States, would be
       * framed only as far north as the Mexican border reaches.
       */
      // Scale the polygon's area by the share of it that lies inside the domain, so
      // a country straddling the edge (Russia across Europe/Asia) contributes only
      // its in-domain mass to the outlier budget.
      const polygonArea = measured
        ? measured[k].area
        : geoArea({ type: 'Polygon', coordinates: polygon })
      let share = inside / total

      const partial = inside < total
      if (explicitMembers && partial) {
        const clipped = clipRing(polygon[0], domain, centerLon)
        if (clipped.length < 3) continue
        // The share by area, not by vertex count: a coast is drawn in far more vertices
        // than a straight inland edge, so counting them would make the cut side weigh nothing.
        const whole = planarArea(polygon[0].map(([lon, lat]) => [normaliseLon(lon, centerLon), lat]))
        share = whole > 0 ? Math.min(1, planarArea(clipped) / whole) : share
        polygon = [clipped]
        inside = clipped.length
        west = south = Infinity
        east = north = -Infinity
        for (const point of clipped) {
          const [x, lat] = point
          if (x < west) (west = x), (atWest = point)
          if (x > east) (east = x), (atEast = point)
          if (lat < south) (south = lat), (atSouth = point)
          if (lat > north) (north = lat), (atNorth = point)
        }
      }

      const area = polygonArea * share
      const extremes = [atWest, atEast, atSouth, atNorth].filter(
        (p): p is [number, number] => p !== null,
      )
      out.push({ west, south, east, north, weight: area, polygon, inside, extremes, domain })
    }

    if (explicitMembers && out.length > firstOfMember) {
      let main = out[firstOfMember]
      for (let i = firstOfMember + 1; i < out.length; i++) if (out[i].weight > main.weight) main = out[i]
      main.anchor = true
    }
  }

  return out
}

/**
 * A ring clipped to a lon/lat box (Sutherland–Hodgman, one box edge at a time), in the
 * longitude frame centred on `centerLon`. The points on the box's edges are exactly on
 * them, so the domain test downstream keeps them.
 */
function clipRing(ring: Position[], box: BBox, centerLon: number): [number, number][] {
  let points: [number, number][] = ring.map(([lon, lat]) => [normaliseLon(lon, centerLon), lat])
  const [w, s, e, n] = box
  const edges: [(p: [number, number]) => boolean, (a: [number, number], b: [number, number]) => [number, number]][] = [
    [(p) => p[0] >= w, (a, b) => [w, a[1] + ((b[1] - a[1]) * (w - a[0])) / (b[0] - a[0])]],
    [(p) => p[0] <= e, (a, b) => [e, a[1] + ((b[1] - a[1]) * (e - a[0])) / (b[0] - a[0])]],
    [(p) => p[1] >= s, (a, b) => [a[0] + ((b[0] - a[0]) * (s - a[1])) / (b[1] - a[1]), s]],
    [(p) => p[1] <= n, (a, b) => [a[0] + ((b[0] - a[0]) * (n - a[1])) / (b[1] - a[1]), n]],
  ]
  for (const [inside, cross] of edges) {
    if (points.length === 0) break
    const next: [number, number][] = []
    for (let i = 0; i < points.length; i++) {
      const current = points[i]
      const previous = points[(i + points.length - 1) % points.length]
      if (inside(current)) {
        if (!inside(previous)) next.push(cross(previous, current))
        next.push(current)
      } else if (inside(previous)) {
        next.push(cross(previous, current))
      }
    }
    points = next
  }
  return points
}

/** Unsigned shoelace area of a ring in plain degrees: only ever compared with another. */
function planarArea(ring: number[][]): number {
  let sum = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) sum += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1])
  return Math.abs(sum) / 2
}

/** A box shifted by whole turns so its centre sits within 180° of `centerLon`. */
function alignDomain(box: BBox, centerLon: number): BBox {
  let [w, s, e, n] = box
  while ((w + e) / 2 - centerLon > 180) {
    w -= 360
    e -= 360
  }
  while (centerLon - (w + e) / 2 > 180) {
    w += 360
    e += 360
  }
  return [w, s, e, n]
}

/** Union of polygon extents. */
function unionExtents(extents: PolygonExtent[]): BBox {
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity
  for (const e of extents) {
    if (e.west < west) west = e.west
    if (e.south < south) south = e.south
    if (e.east > east) east = e.east
    if (e.north > north) north = e.north
  }
  return [west, south, east, north]
}

/**
 * Separation between two polygon extents, in degrees; zero when they overlap.
 *
 * Measured on both axes and combined with `max`, so proximity means genuinely
 * nearby — not merely "inside the same bounding box". Comparing against a union box
 * instead would let Iceland pass as a neighbour of Ireland purely because Norway had
 * already stretched the box's latitude range over it.
 */
function separation(a: PolygonExtent, b: PolygonExtent): number {
  const lon = Math.max(0, a.west - b.east, b.west - a.east)
  const lat = Math.max(0, a.south - b.north, b.south - a.north)
  return Math.max(lon, lat)
}

/** Safety bound on the chain-admission loop below. */
const MAX_ADMISSION_PASSES = 8

/**
 * Decides which polygons the camera should frame.
 *
 * Major landmasses (anything holding at least `coreAreaFraction` of the region's
 * area) always count. Minor polygons are admitted when they sit within
 * `maxDetachmentDegrees` of what has been accepted so far, and the pass repeats so
 * an island chain can connect hop by hop.
 *
 * Pairwise gap-walking along one edge is not enough here: Svalbard reaches the
 * Norwegian mainland through Bear Island and Jan Mayen in short hops, and would
 * sneak back into a map of Europe. Measuring detachment from the accumulated core
 * instead closes that path, because the whole Arctic group stays 3°+ clear of it.
 */
function selectFramedPolygons(
  extents: PolygonExtent[],
  totalWeight: number,
  coreAreaFraction: number,
  maxDetachmentDegrees: number,
): PolygonExtent[] {
  if (coreAreaFraction <= 0 || !Number.isFinite(maxDetachmentDegrees)) return extents

  const threshold = coreAreaFraction * totalWeight
  const isCore = (e: PolygonExtent) => e.weight >= threshold || e.anchor === true
  let accepted = extents.filter(isCore)

  // Nothing dominant enough to anchor the region (a scatter of small islands):
  // fall back to framing everything rather than picking an arbitrary anchor.
  if (accepted.length === 0) return extents

  let pending = extents.filter((e) => !isCore(e))
  const index = nearIndex(maxDetachmentDegrees)
  for (const extent of accepted) index.add(extent)

  for (let pass = 0; pass < MAX_ADMISSION_PASSES && pending.length > 0; pass++) {
    const admitted: PolygonExtent[] = []
    const remaining: PolygonExtent[] = []

    for (const extent of pending) {
      if (index.near(extent)) admitted.push(extent)
      else remaining.push(extent)
    }

    if (admitted.length === 0) break
    accepted = accepted.concat(admitted)
    // After the pass, as before: a pass tests only what was accepted before it began.
    for (const extent of admitted) index.add(extent)
    pending = remaining
  }

  return accepted
}

/** A query covering more cells than this scans every extent instead. */
const MAX_QUERY_CELLS = 4096
/** An extent covering more cells than this is kept in a list every query checks. */
const MAX_EXTENT_CELLS = 64

/**
 * The accepted extents, bucketed by a grid of cells at least `reach` wide, for one question:
 * is this extent within `reach` of any of them?
 *
 * The answer is exactly the linear scan's — `separation` decides every candidate — but it
 * looks only at the extents near the one asked about. On a map of countries that changes
 * nothing; on 32,000 county subdivisions it is the difference between a moment and seconds,
 * because every Pacific atoll was being compared with every township in Ohio, on every pass.
 */
function nearIndex(reach: number) {
  const size = Math.max(reach, 0.25)
  const cells = new Map<string, PolygonExtent[]>()
  const wide: PolygonExtent[] = []
  const all: PolygonExtent[] = []
  const span = (lo: number, hi: number): [number, number] => [Math.floor(lo / size), Math.floor(hi / size)]
  return {
    add(extent: PolygonExtent) {
      all.push(extent)
      const [x0, x1] = span(extent.west, extent.east)
      const [y0, y1] = span(extent.south, extent.north)
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_EXTENT_CELLS) {
        wide.push(extent)
        return
      }
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          const key = `${x},${y}`
          const list = cells.get(key)
          if (list) list.push(extent)
          else cells.set(key, [extent])
        }
      }
    },
    near(extent: PolygonExtent): boolean {
      const [x0, x1] = span(extent.west - reach, extent.east + reach)
      const [y0, y1] = span(extent.south - reach, extent.north + reach)
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_QUERY_CELLS) {
        return all.some((other) => separation(extent, other) <= reach)
      }
      for (const other of wide) if (separation(extent, other) <= reach) return true
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          for (const other of cells.get(`${x},${y}`) ?? []) if (separation(extent, other) <= reach) return true
        }
      }
      return false
    },
  }
}

/** Caps how many points reach `fitExtent`; the projection pass is linear in this. */
const MAX_FIT_POINTS = 6000

interface FitTarget {
  target: MultiPoint
  weights: number[]
  anchors: [number, number][]
}

function buildFitTarget(framed: PolygonExtent[], bbox: BBox, scopeDomain: BBox): FitTarget {
  let keptCount = 0
  for (const extent of framed) keptCount += extent.inside

  if (keptCount === 0) {
    const [w, s, e, n] = bbox
    return {
      target: {
        type: 'MultiPoint',
        coordinates: [
          [w, s],
          [e, s],
          [e, n],
          [w, n],
        ],
      },
      weights: [1, 1, 1, 1],
      anchors: [],
    }
  }

  /*
   * Every `stride`-th in-domain vertex, counted across the framed polygons in order — read
   * back from the polygons by the same test `collectExtents` counted them with, so these are
   * exactly the vertices a list of all of them would have been sampled down to.
   */
  const stride = Math.ceil(keptCount / MAX_FIT_POINTS)
  const centerLon = (scopeDomain[0] + scopeDomain[2]) / 2
  const sampled: [number, number][] = []
  const sampledWeights: number[] = []
  const extremes: [number, number][] = []
  const extremeWeights: number[] = []
  let index = 0

  for (const extent of framed) {
    // The polygon's area, shared equally across the vertices that represent it, so a
    // large landmass outweighs a reef no matter how finely either is drawn.
    const perPoint = extent.inside > 0 ? extent.weight / extent.inside : 0
    const [dw, ds, de, dn] = extent.domain
    for (const ring of extent.polygon) {
      for (const [lon, lat] of ring) {
        const x = normaliseLon(lon, centerLon)
        if (x < dw || x > de || lat < ds || lat > dn) continue
        if (index % stride === 0) {
          sampled.push([x, lat])
          // Sampling thins the cloud; scaling by the stride keeps each polygon's total
          // area intact, so the weights still say what they said before it was thinned.
          sampledWeights.push(perPoint * stride)
        }
        index++
      }
    }
    for (const point of extent.extremes) {
      extremes.push(point)
      extremeWeights.push(perPoint)
    }
  }

  /**
   * Only real vertices go into the fit.
   *
   * Adding the corners of the bounding box instead would put points where no land is:
   * on a conic the meridian fan is widest at the low-latitude corners, so those
   * phantom points stretch the horizontal fit and leave vertical slack above the
   * map — which is precisely where Svalbard reappeared on a map of Europe.
   */
  return {
    target: { type: 'MultiPoint', coordinates: sampled.concat(extremes) },
    weights: sampledWeights.concat(extremeWeights),
    // The centre of each framed polygon's in-domain extent. A marker saying "a
    // landmass is here", not a claim about its shape.
    anchors: framed.map((e) => [(e.west + e.east) / 2, (e.south + e.north) / 2]),
  }
}

/** Window sampled when no geometry is available yet, matching the old behaviour. */
function fallbackTarget(bbox: BBox, steps = 24): MultiPoint {
  const [w, s, e, n] = bbox
  const coordinates: [number, number][] = []
  for (let i = 0; i <= steps; i++) {
    const lon = w + ((e - w) * i) / steps
    for (let j = 0; j <= steps; j++) {
      const lat = s + ((n - s) * j) / steps
      coordinates.push([lon, Math.max(-89.5, Math.min(89.5, lat))])
    }
  }
  return { type: 'MultiPoint', coordinates }
}

/** Albers' rule of thumb: standard parallels one sixth in from each edge of the extent. */
function sixthParallels([, south, , north]: BBox): [number, number] {
  const band = (north - south) / 6
  return [south + band, north - band]
}

const cache = new Map<string, ResolvedFraming>()

/**
 * Resolves the camera for a scope. Cached per dataset + region combination, since
 * this walks every vertex of every member country.
 */
export function computeFraming(
  regionIds: RegionId[],
  dataset: LoadedDataset | null,
): ResolvedFraming {
  const scope = resolveFraming(regionIds)

  if (!dataset) {
    return {
      ...scope,
      fitTarget: fallbackTarget(scope.bbox),
      // A sampled lat/lon window has no polygons behind it, so every point counts
      // the same and the core below degenerates to the window itself.
      fitWeights: [],
      fitAnchors: [],
      fitBBox: scope.bbox,
      margin: scope.framing.margin,
      source: 'fallback',
    }
  }

  const key = `${dataset.dataset.id}|${[...scope.regionIds].sort().join('+')}`
  const cached = cache.get(key)
  if (cached) return cached

  const members = countriesInRegions(scope.regionIds, dataset.meta)
  const extents = collectExtents(
    members,
    dataset,
    scope.framing.domain,
    scope.excludedAreas,
    (id) => {
      const meta = dataset.meta[id]
      return memberDomain(scope.regionIds, meta?.parent?.id ?? id, meta)
    },
    scope.explicitMembers,
  )

  let resolved: ResolvedFraming

  if (extents.length === 0) {
    resolved = {
      ...scope,
      fitTarget: fallbackTarget(scope.bbox),
      // A sampled lat/lon window has no polygons behind it, so every point counts
      // the same and the core below degenerates to the window itself.
      fitWeights: [],
      fitAnchors: [],
      fitBBox: scope.bbox,
      margin: scope.framing.margin,
      source: 'fallback',
    }
  } else {
    const totalWeight = extents.reduce((sum, x) => sum + x.weight, 0)
    const { coreAreaFraction, maxDetachmentDegrees } = scope.framing.trim
    const framed = selectFramedPolygons(
      extents,
      totalWeight,
      coreAreaFraction,
      maxDetachmentDegrees,
    )
    const fitBBox = unionExtents(framed)

    const fit = buildFitTarget(framed, fitBBox, scope.framing.domain)

    resolved = {
      ...scope,
      fitTarget: fit.target,
      fitWeights: fit.weights,
      fitAnchors: fit.anchors,
      fitBBox,
      margin: scope.framing.margin,
      centerLon: (fitBBox[0] + fitBBox[2]) / 2,
      centerLat: (fitBBox[1] + fitBBox[3]) / 2,
      parallels: scope.autoParallels ? sixthParallels(fitBBox) : scope.parallels,
      source: 'geometry',
    }
  }

  cache.set(key, resolved)
  return resolved
}
