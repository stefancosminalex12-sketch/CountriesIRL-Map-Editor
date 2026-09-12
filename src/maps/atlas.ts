/**
 * The atlas registry: which maps this editor can open.
 *
 * An **atlas** is a family of geography the editor can work on — the world's countries,
 * the United States' states, and whatever comes next. It is deliberately a thin
 * description rather than a second application: an atlas names its datasets, its
 * regions, what one of its entities is called, and any inset layout its geography
 * needs. Everything downstream — selection, values, palettes, comparison, merging,
 * flags, the legend, the screen frame, export — reads entities and knows nothing about
 * which atlas produced them.
 *
 * That is the whole point of this file. Adding Canadian provinces or English counties
 * later should be a dataset, an entity table and an entry here; it should not require
 * touching the renderer, the store, the operation vocabulary or any panel.
 *
 * **Entity identifiers are namespaced by construction.** Countries are ISO 3166-1
 * alpha-3 (`USA`), states are ISO 3166-2 (`US-CA`), and the administrative world's
 * subdivisions are Natural Earth's `adm1_code` (`FRA-2000`), so no two atlases can ever
 * mint the same id. That is what makes per-atlas documents safe to hold side by side: a value
 * written against `US-CA` can never be mistaken for one written against a country.
 */
import type { GeoDataset } from '../geo/datasets'
import type { RegionId } from '../types/map'

export type AtlasId = 'world' | 'admin-world' | 'usa-states'

/**
 * Geography drawn away from where it actually is.
 *
 * Alaska is 3,000 km from the contiguous United States and reaches across the
 * antimeridian; Hawaii is 4,000 km out into the Pacific. A single projection that holds
 * all three at once — which is what fitting the map to all fifty states would produce —
 * spends almost the entire canvas on empty ocean and leaves the part anyone came to
 * look at the size of a postage stamp. Every printed atlas solves this the same way, and
 * so does this one: the contiguous states are the map, and the other two are drawn
 * beside it at their own scale.
 *
 * An inset is a **viewport, not a geometry edit**. The states inside it keep their real
 * coordinates in the dataset and are drawn from them; what changes is which projection
 * puts them on screen and where. So an inset state stays a first-class entity — it
 * selects, takes a value, joins a comparison group, merges, flies a flag and exports
 * exactly like one in the main map, because it *is* one.
 */
export interface MapInset {
  id: string
  name: string
  /** The entities drawn here instead of in the main projection. */
  members: string[]
  /**
   * The inset's own conic, as `[lambda, phi]` rotation and standard parallels.
   *
   * Its own rather than the main map's, because the main map's is wrong for it by
   * construction — a projection centred on Kansas tears Alaska across the antimeridian
   * and stretches it beyond recognition. These are the parameters a cartographer would
   * choose for a map of that state alone, and they are the same ones d3's own
   * `geoAlbersUsa` composite uses.
   */
  rotate: [number, number]
  parallels: [number, number]
  /**
   * The inset's scale as a multiple of the main map's.
   *
   * A multiple rather than a fitted box, so the relationship between the pieces stays
   * honest and constant: Alaska really is drawn at ~35% of true size and Hawaii at true
   * size, which is the conventional treatment and is why Alaska does not read as
   * larger than Texas. Fitting each inset to its own rectangle instead would make the
   * relative sizes an accident of how much room each box happened to have.
   */
  scaleFactor: number
  /**
   * The inset's centre, in the projection's own rotated frame.
   *
   * Hawaii is the reason this is stated rather than derived from the members' bounds.
   * The state runs 2,400 km past the main islands to Kure Atoll, so centring on
   * everything would put the eight islands anyone recognises in a corner of the box.
   * This names the composition; the rest of the geometry is still drawn from its real
   * coordinates and simply falls outside the inset's frame.
   *
   * Setting `center` is also what makes placement exact: a projection's centre lands on
   * its `translate`, so anchoring the inset is one assignment rather than a bounds
   * measurement.
   */
  center: [number, number]
  /** Where the focus lands, as a fraction of the viewport. */
  anchor: { x: number; y: number }
  /** The inset's frame, as viewport fractions — geography outside it is clipped away. */
  frame: { width: number; height: number }
}

export interface Atlas {
  id: AtlasId
  name: string
  /**
   * What one of this atlas's entities is called.
   *
   * The editor says "Click a country to select it" in half a dozen places, and on a map
   * of Nevada that sentence is simply false. Naming the noun once here is what lets
   * every panel be correct without any of them knowing which atlas is open.
   */
  noun: { one: string; many: string }
  datasets: GeoDataset[]
  defaultDatasetId: string
  /** The regions this atlas offers, as ids into the region registry. */
  regionIds: RegionId[]
  defaultRegionIds: RegionId[]
  /** See {@link MapInset}. Empty for an atlas whose geography holds together. */
  insets: MapInset[]
  /**
   * Whether this atlas's entities have flags of their own.
   *
   * States do not: the flag library is keyed on ISO 3166-1 country codes, and there is
   * no honest artwork for `US-CA` in it. Flags mode still works on a states map — a
   * state can be *assigned* another entity's flag, and merged bodies can fly one — it
   * simply has no default of its own to fall back to.
   */
  ownFlags: boolean
}

const WORLD_DATASETS: GeoDataset[] = [
  {
    id: 'modern-110m',
    atlasId: 'world',
    name: 'Modern world',
    era: 'modern',
    year: null,
    detail: '110m',
    url: 'geo/countries-110m.json',
    objectName: 'countries',
    metaUrl: 'geo/country-meta.json',
    identify: 'iso-country',
  },
  {
    id: 'modern-50m',
    atlasId: 'world',
    name: 'Modern world',
    era: 'modern',
    year: null,
    detail: '50m',
    url: 'geo/countries-50m.json',
    objectName: 'countries',
    metaUrl: 'geo/country-meta.json',
    identify: 'iso-country',
  },
  {
    id: 'modern-10m',
    atlasId: 'world',
    name: 'Modern world',
    era: 'modern',
    year: null,
    detail: '10m',
    url: 'geo/countries-10m.json',
    objectName: 'countries',
    metaUrl: 'geo/country-meta.json',
    identify: 'iso-country',
  },
]

/**
 * The modern world by first-level subdivision: states, provinces, regions, territories.
 *
 * Natural Earth's 10m admin-1 layer, built by `scripts/fetch-admin1.mjs` into one topology
 * on the country map's own quantisation grid, so a subdivision is drawn at exactly the
 * country map's detail and every boundary two subdivisions share is one arc. Its entity
 * table (see `prepare-data.mjs`) names each subdivision's parent country, which is what
 * the national-border layer and the regions read.
 */
const ADMIN_DATASETS: GeoDataset[] = [
  {
    id: 'admin1-10m',
    atlasId: 'admin-world',
    name: 'Modern administrative world',
    era: 'modern',
    year: null,
    detail: '10m',
    url: 'geo/admin1-10m.json',
    objectName: 'provinces',
    metaUrl: 'geo/admin1-meta.json',
    // Natural Earth's `adm1_code` is on every feature, unique, and is the entity id.
    identify: 'feature-id',
  },
]

const USA_DATASETS: GeoDataset[] = [
  {
    id: 'usa-states-10m',
    atlasId: 'usa-states',
    name: 'United States',
    era: 'modern',
    year: null,
    detail: '10m',
    url: 'geo/us-states-10m.json',
    objectName: 'states',
    metaUrl: 'geo/us-state-meta.json',
    // Natural Earth already carries `US-CA` on the feature, so nothing has to be
    // matched by name or numeric code the way a country dataset does.
    identify: 'feature-id',
  },
]

export const ATLASES: Atlas[] = [
  {
    id: 'world',
    name: 'World',
    noun: { one: 'country', many: 'countries' },
    datasets: WORLD_DATASETS,
    defaultDatasetId: 'modern-10m',
    regionIds: ['world', 'europe', 'asia', 'africa', 'north-america', 'south-america', 'oceania'],
    defaultRegionIds: ['world'],
    insets: [],
    ownFlags: true,
  },
  {
    id: 'admin-world',
    name: 'Modern Administrative World',
    noun: { one: 'subdivision', many: 'subdivisions' },
    datasets: ADMIN_DATASETS,
    defaultDatasetId: 'admin1-10m',
    /*
     * The world's regions, unchanged. A subdivision takes its country's region and
     * subregion, so "Europe" means the subdivisions of European countries without a
     * second definition of Europe.
     */
    regionIds: ['world', 'europe', 'asia', 'africa', 'north-america', 'south-america', 'oceania'],
    defaultRegionIds: ['world'],
    insets: [],
    /*
     * Subdivisions have no artwork of their own: the flag library is keyed on ISO 3166-1
     * country codes. Flags mode works here as it does on the states map — any subdivision
     * can be assigned a flag, and a merged body can fly one.
     */
    ownFlags: false,
  },
  {
    id: 'usa-states',
    name: 'USA States',
    noun: { one: 'state', many: 'states' },
    datasets: USA_DATASETS,
    defaultDatasetId: 'usa-states-10m',
    regionIds: ['usa'],
    defaultRegionIds: ['usa'],
    /*
     * Alaska and Hawaii, on the conventional plan: both in the bottom-left, Alaska
     * larger and outboard, Hawaii smaller and inboard of it. The rotations and
     * parallels are the ones `geoAlbersUsa` uses for the same two states, so the
     * shapes are the ones every US map shows.
     */
    insets: [
      {
        id: 'alaska',
        name: 'Alaska',
        members: ['US-AK'],
        rotate: [154, 0],
        parallels: [55, 65],
        // A conventional reduction, in the same spirit as the 0.35 AlbersUsa applies —
        // trimmed slightly so the state sits clear of California's coast in the corner
        // the contiguous fit actually leaves empty.
        scaleFactor: 0.3,
        // The mainland and the Alaska Peninsula. The Aleutian chain runs on past the
        // antimeridian and is framed out rather than allowed to shrink the state.
        center: [-2, 58.5],
        anchor: { x: 0.1, y: 0.835 },
        frame: { width: 0.175, height: 0.29 },
      },
      {
        id: 'hawaii',
        name: 'Hawaii',
        members: ['US-HI'],
        rotate: [157, 0],
        parallels: [8, 18],
        scaleFactor: 1,
        // The eight main islands. The Northwestern chain out to Kure is still drawn
        // from its real coordinates; it simply lies outside this frame.
        // The centroid of the eight main islands in the rotated frame — lon -157.3,
        // lat 20.4 — so the chain sits centred in its box rather than running off the
        // right edge and losing the Big Island.
        center: [-0.3, 20.4],
        anchor: { x: 0.26, y: 0.845 },
        frame: { width: 0.125, height: 0.2 },
      },
    ],
    ownFlags: false,
  },
]

export const DEFAULT_ATLAS_ID: AtlasId = 'world'

export function getAtlas(id: string): Atlas {
  return ATLASES.find((a) => a.id === id) ?? ATLASES[0]
}

/** The atlas a dataset belongs to, so a loaded map can answer for itself. */
export function atlasForDataset(datasetId: string): Atlas {
  for (const atlas of ATLASES) {
    if (atlas.datasets.some((d) => d.id === datasetId)) return atlas
  }
  return ATLASES[0]
}

/** Every dataset in every atlas, for the registry lookups in `datasets.ts`. */
export const ALL_DATASETS: GeoDataset[] = ATLASES.flatMap((a) => a.datasets)
