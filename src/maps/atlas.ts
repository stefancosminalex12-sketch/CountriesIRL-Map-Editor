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
import { EGM_LAKES, USGS_LAKES } from '../geo/lakes'
import { RIVER_LAYERS, USGS_RIVERS } from '../geo/rivers'
import type { RegionId } from '../types/map'

export type AtlasId = 'world' | 'admin-world' | 'europe-countries' | 'europe-admin' | 'usa-states' | 'usa-official'

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
   * Parents whose every entity is drawn here, and the parents themselves: `state-02` puts
   * Alaska, its boroughs and its county subdivisions in the Alaska inset at whichever level
   * is loaded. Resolved against the loaded dataset (`buildInsets`).
   */
  parents?: string[]
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

/** The groups of the Maps list, in order: what a map is of. */
export const ATLAS_FAMILIES = [
  { id: 'world', name: 'World' },
  { id: 'europe', name: 'Europe' },
  { id: 'usa', name: 'USA' },
] as const

export type AtlasFamilyId = (typeof ATLAS_FAMILIES)[number]['id']

export interface Atlas {
  id: AtlasId
  name: string
  /** Which group of the Maps list it sits in — see {@link ATLAS_FAMILIES}. */
  family: AtlasFamilyId
  /**
   * What the Maps list calls it, where its group makes `name` read oddly — the World map is
   * "Modern World" under "World". Only the list; everywhere else it is `name`.
   */
  menuName?: string
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
  /** What the dataset picker is called on this map: "Dataset", or "Detail". */
  datasetLabel?: string
  /**
   * The line under the map's name in the Maps list, when the one made from its noun and
   * insets would not read well — five insets joined by "and" is a sentence, not a caption.
   */
  note?: string
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
    // Built by `build-geography.mjs`, which stamps each country with its entity id.
    identify: 'feature-id',
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
    // Built by `build-geography.mjs`, which stamps each country with its entity id.
    identify: 'feature-id',
  },
  {
    id: 'modern-25m',
    atlasId: 'world',
    name: 'Modern world',
    era: 'modern',
    year: null,
    detail: '25m',
    url: 'geo/countries-25m.json',
    objectName: 'countries',
    metaUrl: 'geo/country-meta.json',
    // The 10m map simplified between 50m and 10m by `build-25m.mjs`: 10m's entities, ids and arcs.
    identify: 'feature-id',
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
    // Built by `build-geography.mjs`, which stamps each country with its entity id.
    identify: 'feature-id',
  },
]

/**
 * The modern world by region: each country drawn at the level of subdivision that suits it.
 *
 * Not one administrative level everywhere — Slovenia's 193 municipalities and Germany's 16
 * Länder are both "admin-1", and a map drawn with both is fragmented in one place and coarse
 * in the other. Which level each country uses is decided country by country in
 * `scripts/admin/countries.mjs`, from Natural Earth's admin-1 layer (whose coast, islands and
 * borders are the World map's own) and, where that layer is too coarse or out of date, the
 * official finer division from geoBoundaries cut into Natural Earth's outline. See
 * `scripts/admin/build-admin.mjs`.
 *
 * Three levels of detail, three datasets over one base: "Curated Default" is the table's
 * choice for every country; "More Detailed" and "Maximum Available Detail" swap in a finer
 * level for the countries that have one, as fragments loaded on demand (`composition.ts`).
 * A unit whose land is the same at two levels has the same id at both, so a value given to
 * a French department survives switching level; one that exists only at another level waits
 * in the document until that level is shown again.
 */
const ADMIN_BASE = {
  atlasId: 'admin-world',
  name: 'Modern administrative world',
  era: 'modern',
  year: null,
  detail: '10m',
  url: 'geo/admin/base.json',
  objectName: 'provinces',
  metaUrl: 'geo/admin/base-meta.json',
  // The build stamps every unit with its id.
  identify: 'feature-id',
  progressive: true,
} as const

const ADMIN_DATASETS: GeoDataset[] = [
  {
    ...ADMIN_BASE,
    id: 'admin-curated',
    label: 'Curated Default',
    description:
      'A level chosen for each country: counties in Romania, departments in France, regions in Slovenia.',
    compose: { index: 'geo/admin/index.json', preset: 'curated' },
  },
  {
    ...ADMIN_BASE,
    id: 'admin-detailed',
    label: 'More Detailed',
    description:
      'A finer official level where one is useful: Germany’s districts, France’s arrondissements, UK counties.',
    compose: { index: 'geo/admin/index.json', preset: 'detailed' },
  },
  {
    ...ADMIN_BASE,
    id: 'admin-maximum',
    label: 'Maximum Available Detail',
    description:
      'The finest level available and practical for each country — municipalities and local councils included.',
    compose: { index: 'geo/admin/index.json', preset: 'maximum' },
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

/**
 * The United States from official U.S. government data, at three levels.
 *
 * Separate from the USA States map, which stays Natural Earth's and unchanged. Built by
 * `scripts/usa/build-usa.mjs` from the Census Bureau's 2024 cartographic boundary files
 * (1:500,000) — states and state-equivalents, counties and county-equivalents, county
 * subdivisions — with USGS 1:1,000,000 hydrography for the lakes and rivers drawn over them.
 * Each level is its own topology and entity table, loaded only when it is chosen; each unit
 * is identified by its Census GEOID and names its state as its parent, so state lines are
 * the heavier border network at the county and subdivision levels.
 */
const USA_OFFICIAL_BASE = {
  atlasId: 'usa-official',
  name: 'Official USA administrative map',
  era: 'modern',
  year: 2024,
  detail: '10m',
  objectName: 'units',
  // The build stamps every unit with its GEOID-based id.
  identify: 'feature-id',
  water: { lakes: USGS_LAKES, rivers: USGS_RIVERS },
} as const

const USA_OFFICIAL_DATASETS: GeoDataset[] = [
  {
    ...USA_OFFICIAL_BASE,
    id: 'usa-official-states',
    label: 'States',
    description:
      'The 50 states, the District of Columbia, and Puerto Rico, Guam, the Northern Mariana Islands, American Samoa and the U.S. Virgin Islands.',
    noun: { one: 'state', many: 'states' },
    url: 'geo/usa-official/states.json',
    metaUrl: 'geo/usa-official/states-meta.json',
    detailsUrl: 'geo/usa-official/states-details.json',
  },
  {
    ...USA_OFFICIAL_BASE,
    id: 'usa-official-counties',
    label: 'Counties',
    description:
      'Counties and county-equivalents: parishes, boroughs and census areas, independent cities, municipios, Connecticut’s planning regions.',
    noun: { one: 'county', many: 'counties' },
    url: 'geo/usa-official/counties.json',
    metaUrl: 'geo/usa-official/counties-meta.json',
    detailsUrl: 'geo/usa-official/counties-details.json',
    progressive: true,
  },
  {
    ...USA_OFFICIAL_BASE,
    id: 'usa-official-subdivisions',
    label: 'More Detailed',
    description:
      'County subdivisions that are legal units — towns, townships, boroughs, barrios. Where a state’s subdivisions are only statistical, its counties.',
    noun: { one: 'subdivision', many: 'subdivisions' },
    url: 'geo/usa-official/subdivisions.json',
    metaUrl: 'geo/usa-official/subdivisions-meta.json',
    detailsUrl: 'geo/usa-official/subdivisions-details/{parent}.json',
    progressive: true,
  },
]

/**
 * Europe from EuroGlobalMap: the national mapping agencies' own 1:1,000,000 data, harmonised by
 * EuroGeographics so neighbouring countries meet exactly. Built by `scripts/europe/build-europe.mjs`
 * (sources, licence and the reconciliation of borders are described there).
 *
 * Separate from the World and Modern Administrative World maps, which stay Natural Earth's and
 * unchanged. Lakes are EuroGlobalMap's own, drawn at the scale of its coastlines; rivers are the
 * World map's Natural Earth rivers.
 */
const EUROPE_BASE = {
  name: 'Europe',
  era: 'modern',
  year: 2026,
  detail: '10m',
  objectName: 'units',
  // The build stamps every unit with its id.
  identify: 'feature-id',
  water: { lakes: EGM_LAKES, rivers: RIVER_LAYERS[0] },
} as const

const EUROPE_COUNTRY_DATASETS: GeoDataset[] = [
  {
    ...EUROPE_BASE,
    atlasId: 'europe-countries',
    id: 'europe-countries-full',
    label: 'Full Detail (1:1M)',
    description: 'EuroGlobalMap’s full 1:1,000,000 coastlines, islands and borders.',
    url: 'geo/europe/countries-full.json',
    metaUrl: 'geo/europe/countries-meta.json',
    progressive: true,
  },
  {
    ...EUROPE_BASE,
    atlasId: 'europe-countries',
    id: 'europe-countries-standard',
    label: 'Standard',
    description: 'Generalised to about 120 m: every island and border kept, lighter to draw.',
    url: 'geo/europe/countries-standard.json',
    metaUrl: 'geo/europe/countries-meta.json',
  },
  {
    ...EUROPE_BASE,
    atlasId: 'europe-countries',
    id: 'europe-countries-light',
    label: 'Light',
    description: 'Generalised to about 600 m, for the whole continent at a glance.',
    url: 'geo/europe/countries-light.json',
    metaUrl: 'geo/europe/countries-meta.json',
  },
]

const EUROPE_ADMIN_DATASETS: GeoDataset[] = [
  {
    ...EUROPE_BASE,
    atlasId: 'europe-admin',
    id: 'europe-admin-regions',
    label: 'Regions',
    description: 'First-order divisions: French régions, German Länder, Spanish autonomous communities, Polish voivodeships.',
    url: 'geo/europe/admin-regions.json',
    metaUrl: 'geo/europe/admin-regions-meta.json',
    progressive: true,
  },
  {
    ...EUROPE_BASE,
    atlasId: 'europe-admin',
    id: 'europe-admin-standard',
    label: 'Standard',
    description: 'Each country’s own recognised level: départements, Kreise, provinces, powiats, județe, oblasti.',
    url: 'geo/europe/admin-standard.json',
    metaUrl: 'geo/europe/admin-standard-meta.json',
    progressive: true,
  },
  {
    ...EUROPE_BASE,
    atlasId: 'europe-admin',
    id: 'europe-admin-detailed',
    label: 'Detailed',
    description: 'The finest official level available: Bosnia’s municipalities, Belgium’s arrondissements, Slovenia’s municipalities.',
    url: 'geo/europe/admin-detailed.json',
    metaUrl: 'geo/europe/admin-detailed-meta.json',
    progressive: true,
  },
]

export const ATLASES: Atlas[] = [
  {
    id: 'world',
    name: 'World',
    family: 'world',
    menuName: 'Modern World',
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
    family: 'world',
    noun: { one: 'subdivision', many: 'subdivisions' },
    datasets: ADMIN_DATASETS,
    defaultDatasetId: 'admin-curated',
    datasetLabel: 'Detail',
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
    id: 'europe-countries',
    name: 'Europe Countries',
    family: 'europe',
    noun: { one: 'country', many: 'countries' },
    datasets: EUROPE_COUNTRY_DATASETS,
    defaultDatasetId: 'europe-countries-full',
    datasetLabel: 'Detail',
    note: 'Countries and territories · EuroGlobalMap 1:1M',
    /*
     * Europe and its subregions. The countries around it (North Africa, the Middle East,
     * Kazakhstan, Russia beyond 51°E) are on the map as context, outside the region.
     */
    regionIds: ['europe'],
    defaultRegionIds: ['europe'],
    insets: [],
    ownFlags: true,
  },
  {
    id: 'europe-admin',
    name: 'Europe Administrative',
    family: 'europe',
    noun: { one: 'subdivision', many: 'subdivisions' },
    datasets: EUROPE_ADMIN_DATASETS,
    defaultDatasetId: 'europe-admin-standard',
    datasetLabel: 'Detail',
    note: 'Each country’s own subdivisions · EuroGlobalMap 1:1M',
    regionIds: ['europe'],
    defaultRegionIds: ['europe'],
    insets: [],
    // Subdivisions have no artwork of their own; any unit can be assigned a flag.
    ownFlags: false,
  },
  {
    id: 'usa-states',
    name: 'USA States',
    family: 'usa',
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
      /*
       * The territories where the Official USA Administrative Map puts them, drawn from the
       * same Census coastline: Guam with the Northern Mariana Islands and American Samoa in
       * the Pacific corner, Puerto Rico with the Virgin Islands in the open Atlantic east of
       * Florida.
       */
      {
        id: 'pacific-territories',
        name: 'Guam and the Northern Mariana Islands',
        members: ['US-GU', 'US-MP'],
        rotate: [-145.5, 0],
        parallels: [13, 20],
        scaleFactor: 0.6,
        center: [0.2, 16.9],
        anchor: { x: 0.365, y: 0.885 },
        frame: { width: 0.06, height: 0.19 },
      },
      {
        id: 'american-samoa',
        name: 'American Samoa',
        members: ['US-AS'],
        rotate: [170, 0],
        parallels: [-15, -12],
        scaleFactor: 1,
        center: [0.3, -13.4],
        // A little lower than on the Official USA Administrative Map, whose frame reaches
        // over the southern tip of Texas.
        anchor: { x: 0.43, y: 0.945 },
        frame: { width: 0.07, height: 0.095 },
      },
      {
        id: 'caribbean-territories',
        name: 'Puerto Rico and the U.S. Virgin Islands',
        members: ['US-PR', 'US-VI'],
        rotate: [66, 0],
        parallels: [17, 19],
        scaleFactor: 1.4,
        center: [0.4, 18.15],
        anchor: { x: 0.921, y: 0.9 },
        frame: { width: 0.135, height: 0.1 },
      },
      /*
       * Navassa, between Florida and Puerto Rico as it lies, at Puerto Rico's scale. Five
       * kilometres across, so at this scale it is a speck drawn at its true size, selected
       * through its click catchment.
       */
      {
        id: 'navassa',
        name: 'Navassa Island',
        members: ['UM-76'],
        rotate: [75.02, 0],
        parallels: [17, 20],
        scaleFactor: 1.4,
        center: [0, 18.41],
        anchor: { x: 0.8, y: 0.935 },
        frame: { width: 0.045, height: 0.06 },
      },
      /*
       * The Pacific's remote islands, in their true relation to one another — Wake in the
       * west, Midway in the north, Jarvis on the equator in the east. Below the Gulf coast:
       * off the Pacific coast, where they would belong, a phone's narrow canvas has no room
       * beside California, and this stretch is open on a phone as on a desktop. They span a
       * third of the ocean and none is ten kilometres across, so every one is a speck drawn
       * at its true size, selected through its click catchment.
       */
      {
        id: 'pacific-remote-islands',
        name: 'Pacific remote islands',
        members: ['UM-81', 'UM-84', 'UM-86', 'UM-67', 'UM-71', 'UM-95', 'UM-79'],
        rotate: [176.7, 0],
        parallels: [5, 23],
        scaleFactor: 0.13,
        center: [0, 13.9],
        anchor: { x: 0.6, y: 0.925 },
        frame: { width: 0.1, height: 0.14 },
      },
    ],
    note: 'States and territories · Alaska, Hawaii and territory insets',
    ownFlags: false,
  },
  {
    id: 'usa-official',
    name: 'Official USA Administrative Map',
    family: 'usa',
    menuName: 'USA Administrative Map',
    note: 'States, counties, subdivisions · U.S. Census 2024',
    noun: { one: 'area', many: 'areas' },
    datasets: USA_OFFICIAL_DATASETS,
    defaultDatasetId: 'usa-official-counties',
    datasetLabel: 'Detail',
    regionIds: ['usa'],
    defaultRegionIds: ['usa'],
    /*
     * Alaska and Hawaii where the USA States map puts them, and the territories beside them:
     * Puerto Rico with the Virgin Islands off Florida, Guam with the Northern Mariana Islands
     * and American Samoa in the Pacific corner. Named by state, so each inset holds that
     * state's units at whichever level is loaded. Every shape is still drawn from its real
     * coordinates; only the projection placing it on the canvas is the inset's own.
     */
    insets: [
      {
        id: 'alaska',
        name: 'Alaska',
        members: [],
        parents: ['state-02'],
        rotate: [154, 0],
        parallels: [55, 65],
        scaleFactor: 0.3,
        center: [-2, 58.5],
        anchor: { x: 0.1, y: 0.835 },
        frame: { width: 0.175, height: 0.29 },
      },
      {
        id: 'hawaii',
        name: 'Hawaii',
        members: [],
        parents: ['state-15'],
        rotate: [157, 0],
        parallels: [8, 18],
        scaleFactor: 1,
        center: [-0.3, 20.4],
        anchor: { x: 0.26, y: 0.845 },
        frame: { width: 0.125, height: 0.2 },
      },
      {
        id: 'pacific-territories',
        name: 'Guam and the Northern Mariana Islands',
        members: [],
        parents: ['state-66', 'state-69'],
        rotate: [-145.5, 0],
        parallels: [13, 20],
        scaleFactor: 0.6,
        center: [0.2, 16.9],
        anchor: { x: 0.365, y: 0.885 },
        frame: { width: 0.06, height: 0.19 },
      },
      {
        id: 'american-samoa',
        name: 'American Samoa',
        members: [],
        parents: ['state-60'],
        rotate: [170, 0],
        parallels: [-15, -12],
        scaleFactor: 1,
        center: [0.3, -13.4],
        anchor: { x: 0.43, y: 0.92 },
        frame: { width: 0.07, height: 0.11 },
      },
      {
        id: 'caribbean-territories',
        name: 'Puerto Rico and the U.S. Virgin Islands',
        members: [],
        parents: ['state-72', 'state-78'],
        rotate: [66, 0],
        parallels: [17, 19],
        scaleFactor: 1.4,
        center: [0.4, 18.15],
        // In the open Atlantic east of Florida, whose coast reaches 84% of the width down there.
        anchor: { x: 0.921, y: 0.9 },
        frame: { width: 0.135, height: 0.1 },
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
