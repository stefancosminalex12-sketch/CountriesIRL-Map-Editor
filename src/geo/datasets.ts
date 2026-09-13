/**
 * Geographic dataset loading.
 *
 * A dataset is "some set of entity polygons" — the modern world's countries, the
 * United States' states, and later whatever else. The registry itself lives in
 * `maps/atlas.ts`, because which datasets exist is a fact about which *maps* exist;
 * this file is the machinery that turns one of them into geometry the editor can use.
 *
 * Nothing below is country-specific. Where a dataset differs — whether its features
 * carry their own identifier or have to be matched to an ISO table — it says so in its
 * own spec and this loader follows it.
 */
import { geoArea, geoContains } from 'd3-geo'
import { feature, mesh, meshArcs } from 'topojson-client'
import type {
  Feature,
  FeatureCollection,
  LineString,
  MultiLineString,
  MultiPolygon,
  Polygon,
  Position,
} from 'geojson'
import type { Topology, GeometryCollection, GeometryObject } from 'topojson-specification'
import { loadEntityMeta, type EntityMeta, type EntityMetaIndex } from './countryMeta'
import { fetchTopology, loadComposed, type DetailPreset } from './composition'
import type { LakeLayer } from './lakes'
import type { RiverLayer } from './rivers'
import { SUPPLEMENTAL_COUNTRIES } from './supplemental'
import { computeDatasetMetricsInSlices, type CountryMetrics } from './metrics'
import { repairPolygon } from './repair'
import { createSlicer } from './slices'
import { ALL_DATASETS } from '../maps/atlas'
import type { EntityId } from '../types/map'

export interface EntityProperties {
  /**
   * The entity's stable id.
   *
   * Still called `countryId` because it is read under that name across the renderer,
   * the interaction layer and the export path, and a rename there would be churn
   * without meaning: what the field holds is an entity id, and an atlas decides what
   * kind of entity that is.
   */
  countryId: EntityId
  name: string
  /** ISO 3166-1 alpha-2 where the entity is a country, `null` otherwise. */
  iso2: string | null
  /** The entity's own short code — `US`, `CA`. */
  code: string
  region: string
  subregion: string
}

export type CountryProperties = EntityProperties
export type EntityFeature = Feature<Polygon | MultiPolygon, EntityProperties>
export type CountryFeature = EntityFeature

export interface GeoDataset {
  id: string
  /** Which atlas this dataset belongs to. See `maps/atlas.ts`. */
  atlasId: string
  name: string
  /** Grouping for the dataset/time-period picker. */
  era: 'modern' | 'historical'
  /** Year the geography represents; `null` for "current". */
  year: number | null
  detail: '110m' | '50m' | '10m'
  url: string
  /** Name of the TopoJSON object holding the entity polygons. */
  objectName: string
  /** The entity table this dataset's features are described by. */
  metaUrl: string
  /**
   * How a source geometry is matched to an entity id.
   *
   * `iso-country` is the world's case: Natural Earth carries a numeric code, or a name
   * that has to be looked up. `feature-id` is for a source that already states the id
   * it means, which is both simpler and exact.
   */
  identify: 'iso-country' | 'feature-id'
  /**
   * How the dataset is named in the picker, where "Modern world · 10m" is not the right
   * description — the administrative world's levels are "Curated Default", "More Detailed".
   */
  label?: string
  /** One line saying what choosing this dataset changes, shown under the picker. */
  description?: string
  /**
   * What one entity of this dataset is called, where the atlas's noun is too general: the
   * official USA map is states, counties or county subdivisions depending on the level.
   */
  noun?: { one: string; many: string }
  /**
   * The water drawn over this dataset's land, where it is not Natural Earth's: the official
   * USA map draws USGS lakes and rivers, at the scale of its Census boundaries.
   */
  water?: { lakes: LakeLayer; rivers: RiverLayer }
  /**
   * The entities' codes and sources, kept out of the entity table and fetched only when the
   * inspector asks — for a dataset of tens of thousands of units. See `entityDetails.ts`.
   */
  detailsUrl?: string
  /**
   * A dataset assembled from `url` as the base and the per-country fragments `index` lists
   * for `preset`. See `composition.ts`.
   */
  compose?: { index: string; preset: DetailPreset }
  /**
   * Whether this dataset is heavy enough that the canvas prepares it off the render path.
   *
   * Set on the administrative world: 4,595 subdivisions and 20 MB of projected outline,
   * which in one render held the page for seconds. Such a dataset is projected in slices
   * while the page stays responsive, and the layers drawn over it — lakes, border networks,
   * names — follow one render after the land rather than lengthening the first. See
   * `projectedLand.ts`. Nothing about what is drawn differs; only when.
   *
   * Absent on the world and states maps, which are drawn exactly as they always were.
   */
  progressive?: boolean
}

/** Highest detail by default — this tool exists to produce high-quality exports. */
export const DEFAULT_DATASET_ID = 'modern-10m'

export function getDataset(id: string): GeoDataset {
  return ALL_DATASETS.find((d) => d.id === id) ?? ALL_DATASETS[0]
}

/** The datasets one atlas offers, which is what the resolution picker lists. */
export function datasetsForAtlas(atlasId: string): GeoDataset[] {
  return ALL_DATASETS.filter((d) => d.atlasId === atlasId)
}

export interface LoadedDataset {
  dataset: GeoDataset
  features: EntityFeature[]
  byId: Map<EntityId, EntityFeature>
  meta: Record<EntityId, EntityMeta>
  /** Entities whose geometry came from `supplemental.ts` rather than the dataset. */
  supplemented: EntityId[]
  /**
   * Area and representative point per country, computed once here so the interaction
   * layer never does geographic maths while the pointer moves.
   */
  metrics: Map<EntityId, CountryMetrics>
  /**
   * Where two different countries actually touch, and nowhere else.
   *
   * A coastline is not in here. Neither is the seam between two pieces of one country.
   * This is the genuine international boundary network, and it exists because the
   * dataset is TopoJSON: a border shared by two neighbours is stored once, as one arc
   * that both reference, so "shared" is a fact recorded in the file rather than
   * something to be inferred by comparing coordinates.
   *
   * `null` where the source carries no usable topology — a supplemented or hand-built
   * dataset — in which case nothing is drawn rather than something invented.
   */
  borders: MultiLineString | null
  /**
   * Where two different *countries* touch, on a map whose entities are parts of countries.
   *
   * On the administrative world map every line between two subdivisions is a border, and
   * `borders` holds them all; only some are between countries. Those are this network: the
   * arcs whose two sides belong to subdivisions of different parents (`EntityMeta.parent`).
   * It is drawn as its own layer over the internal ones, so a map of provinces still reads
   * as a map of countries. `null` wherever entities have no parent — on the country map
   * `borders` already is the national network.
   */
  nationalBorders: MultiLineString | null
  /**
   * The coast of each supplemented entity, as line strings.
   *
   * A supplemented polygon has no arcs to ask, so its rings are classified directly: a
   * stretch of outline is coast unless it lies on another entity's land. Kept per entity
   * so that hiding a territory, or drawing an inset, can include or leave it out.
   */
  supplementalCoast: Map<EntityId, Position[][]>
  /**
   * The source topology, kept so geometries can be *dissolved* rather than overlaid.
   *
   * Merging countries has to remove the borders between them, and in TopoJSON that is
   * an exact operation: a border shared by two neighbours is one arc that both
   * reference, so dropping the arcs that appear twice leaves precisely the outline of
   * the union. No polygon clipping, no tolerance to tune, no slivers along a seam the
   * two countries already agreed on — and islands survive untouched, because a
   * disconnected ring shares no arc with anything.
   *
   * `null` for a source with no usable topology, in which case merging is unavailable
   * rather than approximated.
   */
  topology: Topology | null
  /** The topology geometries each entity is made of, for {@link mergeCountries}. */
  topoById: Map<EntityId, GeometryObject[]>
}

/**
 * The boundary network again, with some countries taken out of it.
 *
 * Hiding a territory has to remove its borders too, and the border network is one path
 * built from the whole topology — so the only honest way to drop part of it is to build
 * it again while excluding what is hidden.
 *
 * An arc is kept when it separates two countries that are *both* still shown. That is
 * the rule that makes "the world without France" look right rather than nearly right:
 * France's border with Germany is also Germany's border, and Germany still has an edge
 * there, so the arc stays; but a border between two hidden neighbours would be a line
 * drawn across empty space, and it goes.
 *
 * Returns the original network when nothing is hidden, so the common case costs one
 * comparison and no work at all.
 *
 * `include`, when given, keeps only the arcs whose countries it accepts — which is how an
 * atlas with insets draws each inset's borders through that inset's own projection.
 *
 * `nationalOnly` asks the same of {@link LoadedDataset.nationalBorders}: only the arcs
 * between subdivisions of two different countries.
 */
export function bordersWithout(
  loaded: LoadedDataset,
  hidden: ReadonlySet<EntityId>,
  include?: (id: EntityId) => boolean,
  nationalOnly = false,
): MultiLineString | null {
  const whole = nationalOnly ? loaded.nationalBorders : loaded.borders
  if (nationalOnly && !whole) return null
  if ((hidden.size === 0 && !include) || !loaded.topology) return whole

  const object = loaded.topology.objects[loaded.dataset.objectName] as GeometryCollection
  if (!object) return whole

  /* The same resolution the network was built with, so the two cannot disagree. */
  const idOf = new Map<unknown, EntityId>()
  for (const [id, geometries] of loaded.topoById) for (const g of geometries) idOf.set(g, id)

  try {
    const network = mesh(loaded.topology, object, (a, b) => {
      if (a === b) return false
      const left = idOf.get(a)
      const right = idOf.get(b)
      if (!left || !right || left === right) return false
      if (nationalOnly) {
        const leftCountry = loaded.meta[left]?.parent?.id
        const rightCountry = loaded.meta[right]?.parent?.id
        if (!leftCountry || !rightCountry || leftCountry === rightCountry) return false
      }
      if (include && !(include(left) && include(right))) return false
      return !hidden.has(left) && !hidden.has(right)
    })
    return network && network.coordinates.length > 0 ? network : null
  } catch {
    return whole
  }
}

/**
 * Each entity's coast on its own: the part of its outline with no neighbour on the other
 * side.
 *
 * An entity's outline is its coast and its borders in one line. Its coast is every arc of
 * the topology that belongs to that entity alone — the sea, or the edge of the map's
 * land, is on the other side — so these lines are exactly the stretches of the outline
 * that meet the sea, and nothing of its borders. Drawn with the outline's own stroke they
 * are the coast the outline draws, which is what lets the Coastlines layer stand without
 * the Borders layer and look no different (see `paintCountry` in `MapCanvas`).
 *
 * Supplemented entities have no arcs of their own in the topology, so their coast is the
 * one classified from their own rings — see `supplementalCoast`.
 *
 * Built once per dataset, the first time the coast is drawn without the borders.
 */
export interface EntityCoast {
  /** Stretches of shore that end where the entity meets a neighbour. */
  lines: Position[][]
  /**
   * Whole islands, kept as closed rings: an outline is joined all the way round, where a
   * line would have two square ends meeting at its first point.
   */
  rings: Position[][]
}

/**
 * A whole island's ring exactly as the land has it.
 *
 * Every country polygon is put through `repairPolygon` when the dataset loads: islets that
 * quantisation collapsed to fewer than three corners are dropped, and a ring wound the
 * wrong way is turned round. The coast is read from the same topology, so it goes through
 * the same repair — otherwise it would outline a speck of an islet the land does not
 * draw, or hand d3 a ring it reads as the rest of the globe.
 */
function asLandHasIt(ring: Position[]): Position[] | null {
  return repairPolygon([ring])?.[0] ?? null
}

/** A stretch of shore with somewhere to go: at least two distinct points. */
const hasLength = (line: Position[]) =>
  line.some((point) => point[0] !== line[0][0] || point[1] !== line[0][1])

const isClosed = (line: Position[]) =>
  line.length > 3 &&
  line[0][0] === line[line.length - 1][0] &&
  line[0][1] === line[line.length - 1][1]

const coastCache = new WeakMap<LoadedDataset, Map<EntityId, EntityCoast>>()

export function coastByEntity(loaded: LoadedDataset): Map<EntityId, EntityCoast> {
  const cached = coastCache.get(loaded)
  if (cached) return cached

  const coasts = new Map<EntityId, EntityCoast>()
  const topology = loaded.topology
  const object = topology?.objects[loaded.dataset.objectName] as GeometryCollection | undefined

  if (topology && object) {
    /*
     * The one geometry each arc belongs to, or `null` once a second geometry uses it:
     * "an arc of a single geometry is coast", asked of the whole map in one pass.
     */
    const owner = new Map<number, GeometryObject | null>()
    /*
     * On a composed map — units cut from one source into another's outline — an arc one unit
     * uses twice is a seam between two of its own polygons, where a strip joined to it across
     * a hairline stayed a polygon of its own. It is inside the unit, not its coast. The maps
     * built whole are left exactly as they were drawn.
     */
    const seams = loaded.dataset.compose != null
    const visit = (arcs: unknown, geometry: GeometryObject): void => {
      if (typeof arcs === 'number') {
        const index = arcs < 0 ? ~arcs : arcs
        const seen = owner.get(index)
        if (seen === undefined) owner.set(index, geometry)
        else if (seen !== geometry || seams) owner.set(index, null)
        return
      }
      if (Array.isArray(arcs)) for (const arc of arcs) visit(arc, geometry)
    }
    for (const geometry of object.geometries) {
      visit((geometry as { arcs?: unknown }).arcs, geometry)
    }

    const coastal = (arc: number) => owner.get(arc < 0 ? ~arc : arc) != null
    const decode = (arcs: number[]): Position[] =>
      (feature(topology, { type: 'LineString', arcs } as never) as unknown as Feature<LineString>)
        .geometry.coordinates

    const supplemented = new Set(loaded.supplemented)
    for (const [id, geometries] of loaded.topoById) {
      if (supplemented.has(id) || !loaded.byId.has(id)) continue

      // The entity's whole outline as stitched lines, then cut wherever it meets a neighbour.
      const outline = meshArcs(
        topology,
        { type: 'GeometryCollection', geometries } as GeometryCollection,
        (a, b) => a === b,
      )
      const lines: Position[][] = []
      const rings: Position[][] = []
      for (const line of outline.arcs as number[][]) {
        const isCoast = line.map(coastal)
        if (!isCoast.some(Boolean)) continue

        const runs: number[][] = []
        let run: number[] = []
        line.forEach((arc, k) => {
          if (isCoast[k]) run.push(arc)
          else {
            if (run.length) runs.push(run)
            run = []
          }
        })
        if (run.length) runs.push(run)

        const points = decode(line)
        const first = points[0]
        const last = points[points.length - 1]
        const closed = points.length > 2 && first[0] === last[0] && first[1] === last[1]
        /*
         * A ring starts wherever the stitching started it. Cut by a border, its coast
         * comes out as a run at the start and a run at the end that are really one
         * stretch of shore, and two line ends meeting at a point leave a notch the
         * outline does not have — so the two are joined back into one line.
         */
        if (closed && runs.length > 1 && isCoast[0] && isCoast[isCoast.length - 1]) {
          const tail = runs.pop() as number[]
          runs[0] = [...tail, ...runs[0]]
        }
        const island = closed && runs.length === 1 && isCoast.every(Boolean)
        for (const stretch of runs) {
          const coordinates = decode(stretch)
          if (island) {
            const ring = asLandHasIt(coordinates)
            if (ring) rings.push(ring)
          } else if (hasLength(coordinates)) {
            lines.push(coordinates)
          }
        }
      }
      if (lines.length > 0 || rings.length > 0) coasts.set(id, { lines, rings })
    }
  }

  for (const [id, stretches] of loaded.supplementalCoast) {
    const lines = stretches.filter((line) => !isClosed(line) && hasLength(line))
    const rings = stretches
      .filter(isClosed)
      .map(asLandHasIt)
      .filter((ring): ring is Position[] => ring !== null)
    if (lines.length > 0 || rings.length > 0) coasts.set(id, { lines, rings })
  }

  coastCache.set(loaded, coasts)
  return coasts
}

/** Longitude/latitude extent of a feature's outer rings, for a cheap containment prefilter. */
function extentOf(geometry: MultiPolygon): [number, number, number, number] {
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity
  for (const polygon of geometry.coordinates) {
    for (const [lon, lat] of polygon[0] ?? []) {
      if (lon < west) west = lon
      if (lon > east) east = lon
      if (lat < south) south = lat
      if (lat > north) north = lat
    }
  }
  return [west, south, east, north]
}

/**
 * The coast of each supplemented entity, read from its own rings.
 *
 * Walked segment by segment: a segment whose midpoint lies on another entity's land is a
 * border there — the Vatican's whole outline is Italy — and everything else is coast, so a
 * run of coast becomes one line. Only supplemented entities are walked, because everything
 * else already has an exact answer in the topology.
 */
function coastOfSupplements(
  ids: EntityId[],
  features: EntityFeature[],
  byId: Map<EntityId, EntityFeature>,
): Map<EntityId, Position[][]> {
  const coasts = new Map<EntityId, Position[][]>()
  if (ids.length === 0) return coasts
  const others = features.map((f) => ({ f, box: extentOf(f.geometry as MultiPolygon) }))

  const onOtherLand = (own: EntityFeature, point: [number, number]) =>
    others.some(
      ({ f, box }) =>
        f !== own &&
        point[0] >= box[0] &&
        point[0] <= box[2] &&
        point[1] >= box[1] &&
        point[1] <= box[3] &&
        geoContains(f, point),
    )

  for (const id of ids) {
    const own = byId.get(id)
    if (!own) continue
    const lines: Position[][] = []
    for (const polygon of (own.geometry as MultiPolygon).coordinates) {
      for (const ring of polygon) {
        let run: Position[] = []
        for (let i = 1; i < ring.length; i++) {
          const a = ring[i - 1]
          const b = ring[i]
          const middle: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
          if (onOtherLand(own, middle)) {
            if (run.length > 1) lines.push(run)
            run = []
          } else {
            if (run.length === 0) run.push(a)
            run.push(b)
          }
        }
        if (run.length > 1) lines.push(run)
      }
    }
    if (lines.length > 0) coasts.set(id, lines)
  }
  return coasts
}

const cache = new Map<string, Promise<LoadedDataset>>()

/** Fetches, decodes and normalises a dataset. Cached per dataset id. */
export function loadGeoDataset(id: string): Promise<LoadedDataset> {
  const existing = cache.get(id)
  if (existing) return existing

  const dataset = getDataset(id)
  const promise = (async (): Promise<LoadedDataset> => {
    const { topology, metaIndex } = dataset.compose
      ? await loadComposed({ ...dataset, compose: dataset.compose })
      : await Promise.all([fetchTopology(dataset.url), loadEntityMeta(dataset.metaUrl)]).then(
          ([topology, metaIndex]): { topology: Topology; metaIndex: EntityMetaIndex } => ({ topology, metaIndex }),
        )

    /*
     * Everything below is one long computation over every entity — decoding, repairing,
     * measuring — and on the administrative world it ran as seconds of uninterrupted work in
     * which the page could not paint or answer a click. It now runs in slices (see
     * `createSlicer`): the same steps in the same order, pausing between entities whenever a
     * slice's budget is spent, so the result is identical and the editor stays responsive
     * while a map opens.
     */
    const slicer = createSlicer()

    const collection = feature(
      topology,
      topology.objects[dataset.objectName] as GeometryCollection,
    ) as FeatureCollection<Polygon | MultiPolygon>
    await slicer.pause()

    /*
     * The international boundary network, extracted before the features are regrouped.
     *
     * `mesh` walks the topology's arcs and hands each one the two geometries that share
     * it; keeping only the arcs whose two sides resolve to *different* countries leaves
     * exactly the borders between neighbours. An arc on a coast has the same geometry on
     * both sides and is dropped, which is what keeps coastlines out of this entirely.
     *
     * Compared by country id rather than by object identity, because one country can be
     * several geometries here — Natural Earth 50m carries Australia as two — and the
     * seam between two pieces of the same country is not an international border.
     */
    const idOfGeometry = (geometry: unknown): string | null => {
      const g = geometry as { id?: unknown; properties?: { name?: string } | null } | null
      if (!g) return null
      /*
       * A dataset that states its own ids is taken at its word. Natural Earth's admin-1
       * layer carries `US-CA` on the feature, so there is nothing to match and nothing
       * to get wrong; the country path below exists because Natural Earth's country
       * layer carries a numeric code, or only a name, instead.
       */
      if (dataset.identify === 'feature-id') {
        const id = g.id != null ? String(g.id) : null
        return id && metaIndex.entities[id] ? id : null
      }
      const numeric = g.id != null ? String(g.id) : null
      return (
        (numeric ? metaIndex.numericToId[numeric] : undefined) ??
        metaIndex.nameToId[String(g.properties?.name ?? '')] ??
        null
      )
    }

    /*
     * Which topology geometries belong to each country, resolved exactly the way the
     * border mesh resolves them, so the two can never disagree about what a country is.
     */
    const topoById = new Map<EntityId, GeometryObject[]>()
    {
      const collection = topology.objects[dataset.objectName] as GeometryCollection
      for (const geometry of collection.geometries ?? []) {
        const id = idOfGeometry(geometry)
        if (!id) continue
        const list = topoById.get(id)
        if (list) list.push(geometry as GeometryObject)
        else topoById.set(id, [geometry as GeometryObject])
      }
    }

    let borders: MultiLineString | null = null
    try {
      const network = mesh(
        topology,
        topology.objects[dataset.objectName] as GeometryCollection,
        (a, b) => {
          if (a === b) return false
          const left = idOfGeometry(a)
          const right = idOfGeometry(b)
          return left !== null && right !== null && left !== right
        },
      )
      borders = network && network.coordinates.length > 0 ? network : null
    } catch {
      // A dataset without usable topology simply gets no border network.
      borders = null
    }
    if (slicer.due()) await slicer.pause()

    /*
     * The national network, for a map whose entities have parent countries: the arcs whose
     * two sides are subdivisions of *different* countries. Resolved through the same ids as
     * the border mesh above, then up to the parent each one names.
     */
    let nationalBorders: MultiLineString | null = null
    const parentOf = (id: string | null) => (id ? (metaIndex.entities[id]?.parent?.id ?? null) : null)
    if (Object.values(metaIndex.entities).some((entity) => entity.parent)) {
      try {
        const network = mesh(
          topology,
          topology.objects[dataset.objectName] as GeometryCollection,
          (a, b) => {
            if (a === b) return false
            const left = parentOf(idOfGeometry(a))
            const right = parentOf(idOfGeometry(b))
            return left !== null && right !== null && left !== right
          },
        )
        nationalBorders = network && network.coordinates.length > 0 ? network : null
      } catch {
        nationalBorders = null
      }
      if (slicer.due()) await slicer.pause()
    }

    /**
     * A country is exactly one feature, whatever the source shape.
     *
     * Datasets do not guarantee one geometry per country — Natural Earth 50m, for
     * example, carries Australia as two separate geometries. Grouping by the stable
     * id keeps every country addressable as a single unit for styling, hit-testing
     * and future geometry edits, and historical datasets with fragmented territories
     * rely on the same guarantee.
     */
    const groups = new Map<EntityId, { name: string; polygons: MultiPolygon['coordinates'] }>()

    for (const raw of collection.features) {
      if (slicer.due()) await slicer.pause()
      const neName = String((raw.properties as { name?: string } | null)?.name ?? '')
      // Exactly the resolution the border mesh used, so the two can never disagree
      // about which entity a polygon belongs to.
      const countryId = idOfGeometry(raw)

      // Anything we cannot pin to a stable identifier is dropped rather than
      // rendered with an unstable key — every polygon must be addressable.
      if (!countryId || !raw.geometry) continue

      const group = groups.get(countryId) ?? { name: neName, polygons: [] }
      const source =
        raw.geometry.type === 'Polygon' ? [raw.geometry.coordinates] : raw.geometry.coordinates
      for (const polygon of source) {
        const repaired = repairPolygon(polygon)
        if (repaired) group.polygons.push(repaired)
      }
      groups.set(countryId, group)
    }

    /**
     * Apply supplemental geometry.
     *
     * `fallback` entries fill a gap: they are used only where the dataset produced no
     * usable polygon, so a dataset that does describe the country always wins and
     * nothing is ever drawn twice. `replace` entries override geometry that exists
     * but is incomplete — the simplified country layer merges Bahrain's archipelago
     * down to its main island, losing Hawar next to Qatar.
     *
     * Either way a supplement only applies to the resolutions it was sourced for, so
     * 10m coastlines never leak into the 110m map.
     *
     * A supplement is a *country's* shape, so on a map of countries it is the shape of
     * the entity with that id. On a map whose entities are parts of countries it is the
     * shape of a country's only part, when the country is a single entity there: Vatican
     * City is one subdivision of the administrative world, its admin-1 ring collapses to
     * two corners under the same quantisation that loses it from the country map, and
     * the country's supplement is exactly that subdivision's outline. A country divided
     * into several parts is never given a country outline — it would lie over all of
     * them — and a map whose entities belong to no country takes none.
     */
    const supplemented: EntityId[] = []
    const partsOfCountry = new Map<string, EntityId[]>()
    if (dataset.identify === 'feature-id') {
      for (const entity of Object.values(metaIndex.entities)) {
        const parent = entity.parent?.id
        if (!parent) continue
        const parts = partsOfCountry.get(parent)
        if (parts) parts.push(entity.id)
        else partsOfCountry.set(parent, [entity.id])
      }
    }
    const supplementTarget = (countryId: string): EntityId | null => {
      if (dataset.identify === 'iso-country' || metaIndex.entities[countryId]) return countryId
      const parts = partsOfCountry.get(countryId)
      return parts && parts.length === 1 ? parts[0] : null
    }

    for (const supplement of SUPPLEMENTAL_COUNTRIES) {
      if (supplement.appliesToDetail && !supplement.appliesToDetail.includes(dataset.detail)) {
        continue
      }
      const targetId = supplementTarget(supplement.id)
      if (!targetId) continue

      const existing = groups.get(targetId)
      const hasGeometry = Boolean(existing && existing.polygons.length > 0)
      /*
       * On a map of subdivisions, a country's only unit can come through as a shard of it:
       * Natural Earth's admin-1 Vatican is 0.012 km² of a 0.44 km² state. That describes the
       * country no better than nothing does, so there the supplement stands in for anything
       * under half its own size. The World map's own entity is left exactly as it is drawn.
       */
      const viaPart = targetId !== supplement.id
      const shard =
        viaPart &&
        hasGeometry &&
        geoArea({ type: 'MultiPolygon', coordinates: existing!.polygons }) <
          0.5 * geoArea({ type: 'MultiPolygon', coordinates: supplement.polygons })
      if (supplement.mode === 'fallback' && hasGeometry && !shard) continue

      const polygons: MultiPolygon['coordinates'] = []
      for (const polygon of supplement.polygons) {
        const repaired = repairPolygon(polygon)
        if (repaired) polygons.push(repaired)
      }
      if (polygons.length === 0) continue

      groups.set(targetId, { name: existing?.name ?? supplement.name, polygons })
      supplemented.push(targetId)
    }

    const features: EntityFeature[] = []
    const byId = new Map<EntityId, EntityFeature>()
    const unrepresentable: string[] = []

    for (const [countryId, group] of groups) {
      // Nothing survived the repair and no supplement covers it: the country is
      // smaller than the dataset's quantisation step. Keeping a feature that can never
      // be drawn or clicked would only inflate the counts, so leave it out.
      if (group.polygons.length === 0) {
        unrepresentable.push(countryId)
        continue
      }

      const meta = metaIndex.entities[countryId]
      const feat: EntityFeature = {
        type: 'Feature',
        id: countryId,
        geometry: { type: 'MultiPolygon', coordinates: group.polygons },
        properties: {
          countryId,
          name: meta?.name ?? group.name,
          iso2: meta?.iso2 ?? null,
          code: meta?.code ?? countryId,
          region: meta?.region ?? 'Unknown',
          subregion: meta?.subregion ?? 'Unknown',
        },
      }
      features.push(feat)
      byId.set(countryId, feat)
    }

    const metrics = await computeDatasetMetricsInSlices(features, slicer)

    /*
     * The coast of each supplemented entity, classified from its own rings. The coast of
     * everything else is read off the topology when it is first drawn — `coastByEntity`.
     */
    const supplementalCoast = coastOfSupplements(supplemented, features, byId)

    /**
     * Paint order: hosts first, the things inside them last.
     *
     * SVG has no z-index, so a country is covered by whatever is drawn after it, and
     * an enclave that loses that race is simply not on the map. Sorting by name left
     * that to the alphabet — which is fine for Vatican City over Italy and wrong for
     * Andorra under France, Gibraltar under Spain and Baikonur under Kazakhstan. It
     * only became visible once the coarse layers stopped omitting those entities,
     * because the finer ones cut a hole in the host for them and the coarse ones do
     * not.
     *
     * Descending area settles it for every containment there can be: a shape that
     * encloses another is necessarily the larger of the two, so ordering by size puts
     * every host before everything it holds, without anyone naming a single pair.
     * Name is the tie-breaker, so the order stays stable between loads.
     */
    features.sort((a, b) => {
      const areaA = metrics.get(a.properties.countryId)?.areaKm2 ?? 0
      const areaB = metrics.get(b.properties.countryId)?.areaKm2 ?? 0
      if (areaA !== areaB) return areaB - areaA
      return a.properties.name.localeCompare(b.properties.name)
    })

    if (supplemented.length > 0) {
      console.info(
        `[geo] ${dataset.id}: ${supplemented.join(', ')} supplied from supplemental geometry`,
      )
    }
    if (unrepresentable.length > 0) {
      console.info(
        `[geo] ${dataset.id}: ${unrepresentable.join(', ')} ` +
          'have no geometry at this resolution and were omitted',
      )
    }

    return {
      dataset,
      features,
      byId,
      meta: metaIndex.entities,
      supplemented,
      metrics,
      borders,
      nationalBorders,
      supplementalCoast,
      topology,
      topoById,
    }
  })()

  cache.set(id, promise)
  // A failed load is not remembered, so switching back to the dataset tries again.
  promise.catch(() => {
    if (cache.get(id) === promise) cache.delete(id)
  })
  evictHeavy(id)
  return promise
}

/**
 * Keeps at most two heavy datasets decoded at once: the one being opened and the last one.
 *
 * Each level of the administrative world decodes to tens of megabytes of coordinates, and a
 * phone that has visited all three would hold every one of them for the rest of the session.
 * Switching straight back to the previous level stays instant; a third is decoded again from
 * the raw files, which stay cached, so nothing is fetched twice.
 */
const heavyOrder: string[] = []
function evictHeavy(id: string) {
  if (!getDataset(id).progressive) return
  const at = heavyOrder.indexOf(id)
  if (at >= 0) heavyOrder.splice(at, 1)
  heavyOrder.push(id)
  while (heavyOrder.length > 2) cache.delete(heavyOrder.shift() as string)
}
