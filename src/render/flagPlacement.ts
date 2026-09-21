/**
 * How a country's flag is framed.
 *
 * The flag is the *fill* of the country's existing path (see `MapFlags.tsx`), so what
 * has to be decided here is not a position but a rectangle: the region of the map the
 * flag is stretched across before the path clips it. Everything inside the country
 * shows flag; everything outside is clipped away by the geometry itself.
 *
 * The obvious rectangle — the country's own bounding box — is wrong for a specific
 * and common class of country. France's geometry includes French Guiana and Réunion,
 * so its bounding box spans the Atlantic and the Indian Ocean; stretch a flag across
 * that and mainland France shows about eight per cent of it, which is one solid blue
 * stripe. The United States, Portugal, Spain, the Netherlands, Chile, Ecuador and New
 * Zealand all have the same shape of problem.
 *
 * So the flag is framed to the country's **dominant landmass cluster** instead: the
 * largest polygon plus everything whose coastline comes within `TERRITORY_GAP_KM` of
 * something already in it. Corsica joins mainland France, Guiana does not. An
 * archipelago whose islands are genuinely spread — Indonesia, the Philippines, the
 * Maldives — chains together into one cluster and the flag spans the whole chain,
 * which is the intended reading.
 *
 * A cluster that is substantial enough in its own right is framed separately rather
 * than left to the repeat — see `flagTerritories`. Alaska and French Guiana get their
 * own flag that way; Hawaii and the Azores are too small a share to warrant one and go
 * on sharing the mainland's.
 *
 * Territory outside every framed cluster still gets the flag: the pattern repeats, so
 * Réunion is painted in French colours rather than left blank. What a cluster decides
 * is only where a flag is *centred and scaled*, never which land is covered.
 *
 * Computed in geographic coordinates and cached per dataset, so it survives every
 * projection, zoom, pan and region change; the rectangle it becomes on screen is
 * derived from the active projection at render time.
 */
import { geoArea, geoCentroid, geoDistance } from 'd3-geo'
import type { Feature, MultiPolygon, Polygon, Position } from 'geojson'
import type { LoadedDataset } from '../geo/datasets'

interface Landmass {
  polygon: Position[][]
  west: number
  south: number
  east: number
  north: number
  area: number
  /** A thinned copy of the outline, for measuring how far this land is from another. */
  sample: Position[]
}

/**
 * How close two landmasses must be to count as one place.
 *
 * Measured between the coastlines themselves, in kilometres, and this is the whole
 * reason the measurement is not taken from bounding boxes. Alaska's panhandle runs
 * far enough south that its box all but touches Washington's, so by boxes Alaska is
 * adjacent to the lower 48 and the United States is one landmass with one flag
 * stretched over it — which is the complaint. Coast to coast the two are some 830 km
 * apart and the answer comes out right.
 *
 * At 500 km the separations that matter fall either side cleanly: Sicily (3 km),
 * Crimea across the Kerch Strait (4 km), Corsica (85 km), Sardinia (190 km) and
 * Tasmania (240 km) stay with their mainlands, while Alaska (830 km), Madeira
 * (900 km), the Canaries (1,100 km), the Azores (1,400 km), Hawaii (3,800 km) and
 * French Guiana (7,000 km) each stand on their own.
 */
const TERRITORY_GAP_KM = 500
const EARTH_RADIUS_KM = 6371
const TERRITORY_GAP_RAD = TERRITORY_GAP_KM / EARTH_RADIUS_KM

/**
 * Outline points kept per landmass when measuring separation.
 *
 * Scaled to the landmass, not fixed. What matters is the gap between samples along
 * the coast, since that bounds how much the measurement can overstate the true
 * distance — and on an islet a handful of points already resolve it to within a few
 * kilometres, against a threshold of five hundred. Sampling every islet as heavily as
 * a mainland is what made this slow: Canada alone is 410 polygons, nearly all of them
 * small.
 */
const SAMPLE_MIN = 6
const SAMPLE_MAX = 24

/** Brings a longitude into the frame centred on `centerLon`. Mirrors `framing.ts`. */
function normaliseLon(lon: number, centerLon: number): number {
  let x = lon
  while (x - centerLon > 180) x -= 360
  while (centerLon - x > 180) x += 360
  return x
}

function polygonsOf(feature: Feature<Polygon | MultiPolygon>): Position[][][] {
  return feature.geometry.type === 'Polygon'
    ? [feature.geometry.coordinates]
    : feature.geometry.coordinates
}

/** Evenly thinned ring points, so the measurement is cheap and deterministic. */
function thin(ring: Position[]): Position[] {
  const points = Math.min(SAMPLE_MAX, Math.max(SAMPLE_MIN, Math.round(ring.length / 8)))
  if (ring.length <= points) return ring
  const step = ring.length / points
  const out: Position[] = []
  for (let i = 0; i < points; i++) out.push(ring[Math.floor(i * step)])
  return out
}

/**
 * Shortest distance between two coastlines, in radians, or `Infinity` once it is
 * clear the answer is beyond what the caller cares about.
 *
 * The box test first: boxes are cheap and, scaled for how longitude narrows towards
 * the poles, give a sound lower bound. Only the pairs it cannot settle are measured
 * point by point, which leaves very few.
 */
function separation(a: Landmass, b: Landmass, limit: number): number {
  const lonGap = Math.max(0, a.west - b.east, b.west - a.east)
  const latGap = Math.max(0, a.south - b.north, b.south - a.north)
  const lat = Math.max(Math.abs(a.north), Math.abs(a.south), Math.abs(b.north), Math.abs(b.south))
  const scaled = lonGap * Math.cos(Math.min(89, lat) * (Math.PI / 180))
  const lower = Math.hypot(scaled, latGap) * (Math.PI / 180)
  if (lower > limit) return Infinity

  let best = Infinity
  for (const p of a.sample) {
    for (const q of b.sample) {
      const d = geoDistance(p as [number, number], q as [number, number])
      if (d < best) best = d
      // Nothing beyond this point can change the answer the caller asked for.
      if (best <= limit) return best
    }
  }
  return best
}

function describe(polygon: Position[][], centerLon: number): Landmass {
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity
  for (const [lon, lat] of polygon[0]) {
    const x = normaliseLon(lon, centerLon)
    if (x < west) west = x
    if (x > east) east = x
    if (lat < south) south = lat
    if (lat > north) north = lat
  }
  return {
    polygon,
    west,
    south,
    east,
    north,
    area: geoArea({ type: 'Polygon', coordinates: polygon }),
    sample: thin(polygon[0]),
  }
}

/**
 * Every cluster of a country, largest first.
 *
 * The chaining rule is the one described above: a landmass joins a cluster when it
 * sits within `CLUSTER_GAP_DEG` of something already in it. Run once it yields the
 * dominant cluster; run repeatedly over what is left it yields all of them, which is
 * what tells Alaska apart from Kansas and French Guiana apart from Corsica.
 */
/**
 * Clusters per geometry object, shared by every consumer.
 *
 * Keyed on the geometry rather than the dataset so that anything holding the same
 * geometry — the flag framing, the country names, a merged entity's dissolve — asks once
 * and every later ask is free. The dataset's features are stable objects for the life of
 * the dataset, so the idle warm-up that frames the flags also warms the names.
 */
const clusterByGeometry = new WeakMap<Polygon | MultiPolygon, Landmass[][]>()

function clustersOf(feature: Feature<Polygon | MultiPolygon>): Landmass[][] {
  const known = clusterByGeometry.get(feature.geometry)
  if (known) return known

  const polygons = polygonsOf(feature)
  if (polygons.length === 0) return []

  // Measured in the frame of the country's own centre, so a country straddling the
  // antimeridian is contiguous rather than split across ±180.
  const centre = geoCentroid(feature)
  const centerLon = Number.isFinite(centre[0]) ? centre[0] : 0

  const masses = polygons
    .filter((polygon) => polygon[0] && polygon[0].length >= 3)
    .map((polygon) => describe(polygon, centerLon))
  if (masses.length === 0) return []

  const order = [...masses].sort((a, b) => b.area - a.area)

  /*
   * Union-find over the pairs, rather than repeated passes over a growing cluster.
   *
   * The passes re-measured pairs they had already measured, once per pass and once per
   * member, which for a country of a few hundred islands ran to seconds. Here every
   * pair is considered at most once, and a pair already known to be connected is not
   * measured at all — which, with the box test rejecting the distant ones outright,
   * leaves very little actual work.
   */
  const parent = order.map((_, i) => i)
  const find = (i: number): number => {
    let root = i
    while (parent[root] !== root) root = parent[root]
    while (parent[i] !== root) {
      const next = parent[i]
      parent[i] = root
      i = next
    }
    return root
  }

  for (let a = 0; a < order.length; a++) {
    for (let b = a + 1; b < order.length; b++) {
      if (find(a) === find(b)) continue
      if (separation(order[a], order[b], TERRITORY_GAP_RAD) <= TERRITORY_GAP_RAD) {
        parent[find(a)] = find(b)
      }
    }
  }

  const grouped = new Map<number, Landmass[]>()
  for (let i = 0; i < order.length; i++) {
    const root = find(i)
    const seen = grouped.get(root)
    if (seen) seen.push(order[i])
    else grouped.set(root, [order[i]])
  }
  const clusters = [...grouped.values()]

  // Sorted by the land they hold, not by their largest single piece, so a cluster of
  // many medium islands is ranked above one big island where that is the truth.
  const sorted = clusters.sort((a, b) => total(b) - total(a))
  clusterByGeometry.set(feature.geometry, sorted)
  return sorted
}

function total(cluster: Landmass[]): number {
  return cluster.reduce((sum, mass) => sum + mass.area, 0)
}

function asGeometry(cluster: Landmass[]): MultiPolygon {
  return { type: 'MultiPolygon', coordinates: cluster.map((m) => m.polygon) }
}

/**
 * The dominant landmass cluster of any geometry — the same grouping the flags are framed to.
 *
 * Exported for the country names, which need exactly this unit and must not invent a
 * second definition of it: Cape Verde's nine islands are one place carrying one name,
 * while Réunion is not part of France's name and Bouvet Island is not part of Norway's.
 * Accepts any geometry, so a merged entity is grouped by the same rule as a country.
 */
export function mainLandCluster(geometry: Polygon | MultiPolygon): MultiPolygon {
  const clusters = clustersOf({ type: 'Feature', properties: {}, geometry })
  if (clusters.length > 0) return asGeometry(clusters[0])
  return geometry.type === 'MultiPolygon'
    ? geometry
    : { type: 'MultiPolygon', coordinates: [geometry.coordinates] }
}

/**
 * How much land a detached cluster must hold, against the country's main one, before
 * it is framed as a territory of its own.
 *
 * The judgement the brief asks for is "large and/or geographically distant". Distance
 * is already settled by the time this is asked — a cluster exists precisely because it
 * is more than `CLUSTER_GAP_DEG` from everything else — so all that is left to decide
 * is whether it is substantial enough to be worth its own flag.
 *
 * A share rather than an absolute area, because the question is about the country. At
 * a twelfth, Alaska (a fifth of the United States) and French Guiana (a seventh of
 * France) are territories; the Azores (a fortieth of Portugal) and the Galápagos (a
 * thirtieth of Ecuador) are outlying islands that go on sharing the mainland's flag.
 * Crimea never reaches the question: it is within the gap of the Russian mainland, so
 * it is part of that cluster and shares its flag, which is the wanted answer.
 */
const TERRITORY_SHARE = 0.08

/** The detached clusters that earn a flag of their own, largest first — never the dominant one. */
function territoriesOf(clusters: Landmass[][]): Landmass[][] {
  if (clusters.length < 2) return []
  const main = total(clusters[0])
  if (!(main > 0)) return []
  return clusters.slice(1).filter((cluster) => total(cluster) / main >= TERRITORY_SHARE)
}

/**
 * How flags are framed over any one geometry: its dominant cluster, and the detached clusters that
 * earn a flag of their own.
 *
 * The answer `flagFootprints` and `flagTerritories` give for an entity of a dataset, for a geometry
 * that is not one — an overlay's copy of an entity, or a merged group — by the same rule, so a flag
 * filling an overlay of France is framed over mainland France and French Guiana carries its own,
 * exactly as on the map.
 */
export function flagFraming(geometry: Polygon | MultiPolygon): { main: MultiPolygon; territories: MultiPolygon[] } {
  const clusters = clustersOf({ type: 'Feature', properties: {}, geometry })
  if (clusters.length === 0) return { main: mainLandCluster(geometry), territories: [] }
  return { main: asGeometry(clusters[0]), territories: territoriesOf(clusters).map(asGeometry) }
}

/**
 * Clusters per dataset, computed once and read by both consumers.
 *
 * Framing wants the dominant cluster and territory placement wants the rest, and they
 * are the same computation — running it twice doubled the only expensive step here.
 */
const clusterCache = new Map<string, Map<string, Landmass[][]>>()

function clustersFor(dataset: LoadedDataset): Map<string, Landmass[][]> {
  const key = dataset.dataset.id
  const cached = clusterCache.get(key)
  if (cached) return cached

  const all = new Map<string, Landmass[][]>()
  for (const [id, feature] of dataset.byId) {
    all.set(id, clustersOf(feature as Feature<Polygon | MultiPolygon>))
  }
  clusterCache.set(key, all)
  return all
}

/**
 * Clusters one entity, for a caller warming a dataset a few entities at a time.
 *
 * The clustering is memoised on the geometry, so this is exactly the work `flagFootprints`
 * would have done for that entity and nothing is computed twice. It exists so the warm-up can
 * stop between entities: done in one pass it held the main thread for over two seconds on
 * Europe Countries, which is a freeze, not a load.
 */
export function warmEntityClusters(dataset: LoadedDataset, id: string): void {
  const feature = dataset.byId.get(id)
  if (feature) clustersOf(feature as Feature<Polygon | MultiPolygon>)
}

const territoryCache = new Map<string, Map<string, MultiPolygon[]>>()

/**
 * The detached territories of each country that earn a flag placement of their own,
 * largest first and never including the dominant cluster.
 *
 * Empty for the overwhelming majority of countries, which is the point: a country with
 * one landmass is untouched by any of this.
 */
export function flagTerritories(dataset: LoadedDataset): Map<string, MultiPolygon[]> {
  const key = dataset.dataset.id
  const cached = territoryCache.get(key)
  if (cached) return cached

  const territories = new Map<string, MultiPolygon[]>()
  for (const [id, clusters] of clustersFor(dataset)) {
    const qualifying = territoriesOf(clusters)
    if (qualifying.length) territories.set(id, qualifying.map(asGeometry))
  }
  territoryCache.set(key, territories)
  return territories
}

const cache = new Map<string, Map<string, MultiPolygon>>()

/**
 * The framing geometry for every country in a dataset, computed once and cached.
 *
 * Keyed on the dataset alone: nothing about the camera enters into it, so the same
 * answer serves every projection, zoom level and region.
 */
export function flagFootprints(dataset: LoadedDataset): Map<string, MultiPolygon> {
  const key = dataset.dataset.id
  const cached = cache.get(key)
  if (cached) return cached

  const footprints = new Map<string, MultiPolygon>()
  for (const [id, clusters] of clustersFor(dataset)) {
    if (clusters.length) footprints.set(id, asGeometry(clusters[0]))
  }
  cache.set(key, footprints)
  return footprints
}
