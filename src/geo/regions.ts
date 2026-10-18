/**
 * Region presets and multi-region composition.
 *
 * MEMBERSHIP and FRAMING are deliberately separate concerns:
 *
 *   `includes` / `alsoInclude`  -> which countries BELONG to the region
 *   `framing`                   -> which geography the CAMERA should fit
 *
 * They are not the same question. Norway belongs to Europe, but Svalbard — part of
 * Norway's geometry, 1500 km north of the mainland — must not drag the camera north.
 * The framing spec says which geography the camera may consider and how to reject
 * remote outliers; the geometry itself still renders in full. See `framing.ts`.
 *
 * Selecting several regions composes them into one framing (europe + asia =>
 * Eurasia), so the UI never needs a hardcoded "eurasia" entry.
 */
import { getAtlas } from '../maps/atlas'
import type { EntityMeta } from './countryMeta'
import type { ProjectionId, RegionId } from '../types/map'
import { SUBREGIONS, type ContinentId, type SubregionDef } from './subregions'
import SUBREGION_PARTS from './subregionParts.json'

/** [west, south, east, north] in degrees. `east` may exceed 180 to cross the antimeridian. */
export type BBox = [number, number, number, number]

export interface RegionPreset {
  id: RegionId
  name: string
  /** Membership test against the ISO region/subregion of a country. */
  includes: (meta: EntityMeta) => boolean
  /**
   * Transcontinental countries that ISO puts in another region but that belong on
   * this region's map (e.g. Turkey and Cyprus on a map of Europe).
   */
  alsoInclude?: string[]
  /**
   * Geography that does NOT belong to this region even though its country does.
   *
   * Membership is otherwise decided per country, which cannot express "Norway is in
   * Europe but Svalbard is not" — Natural Earth carries Svalbard inside Norway's own
   * geometry, with no separate ISO code. These named areas are removed from the
   * region before anything else looks at it, so they never reach the framing
   * pipeline. The dataset itself is untouched: the geometry still exists, still
   * renders, and is still available to any other region or future context.
   */
  excludedAreas?: ExcludedArea[]
  /** How the camera frames this region. See `RegionFraming`. */
  framing: RegionFraming
  /**
   * Static window used before any geometry is available (first paint, load errors).
   * Once the dataset is loaded, `framing` derives the window from real geometry.
   */
  bbox: BBox
  projectionId: ProjectionId
  /** Standard parallels for conic projections. */
  parallels?: [number, number]
  /** The continent a subregion sits under in the selector; absent for a top-level region. */
  parentId?: RegionId
  /** A subregion's stated definition — see `geo/subregions.ts`. */
  definition?: string
  /**
   * Members that belong only in part, and the part's extent: country id → the lon/lat box
   * the camera may consider for that country instead of the region's `domain`. New England
   * frames the six states' extent inside the United States, not Alaska to Florida.
   */
  memberDomains?: Record<string, BBox>
  /**
   * Standard parallels read off the framed geometry rather than declared: one sixth of the way
   * in from each edge of the fitted extent, the rule of thumb for an Albers map of any area.
   * Used by subregions, which are too many to tune by hand.
   */
  autoParallels?: boolean
  /**
   * The members are named one by one, so each is part of the composition: every member's
   * largest landmass is framed however small it is (Cyprus in the European Mediterranean,
   * Cape Verde in West Africa), and a member cut by the domain is clipped to it, so the frame
   * reaches the region's real edge inland rather than stopping at the last coastline inside.
   * Subregions only; the continents keep the outlier policy they were tuned with.
   */
  explicitMembers?: boolean
}

/**
 * Camera framing policy for a region.
 *
 * `domain` is a declarative geographic scope — a cartographic statement such as
 * "European Russia ends around the 50th meridian" or "the world view crops
 * Antarctica". Geometry outside it is still rendered, just not considered by the
 * camera. Within the domain the bounds come from the actual polygons, so the
 * framing adapts to whichever dataset is loaded (110m/50m/10m, and later
 * historical ones) instead of being a fixed camera position.
 */
export interface RegionFraming {
  domain: BBox
  /**
   * Automatic outlier rejection inside the domain.
   *
   * The region's major landmasses form a "core"; a minor polygon is framed only if
   * it sits close to that core. Islands that hang together as a chain are admitted
   * one hop at a time, so dense archipelagos (Indonesia, the Pacific groups) survive
   * while genuinely detached territory (Svalbard, the Azores) drops out of the
   * camera — it still renders, it just stops deciding where the edges are.
   */
  trim: {
    /** A polygon holding at least this share of the region's area anchors the core. */
    coreAreaFraction: number
    /** How far, in degrees, a minor polygon may sit from the core and still be framed. */
    maxDetachmentDegrees: number
  }
  /** Breathing room around the fitted geography, as a fraction of the viewport. */
  margin: number
  /** How the camera closes the letterbox a plain fit leaves behind. */
  fill: FillPolicy
  /**
   * Under Mercator, how far south the camera reaches whatever the domain says: the World's -72°,
   * so Antarctica's coast shows as a strip along the bottom. Mercator stretches it towards
   * infinity, so the domain's -60° left it off the map entirely.
   */
  mercatorSouth?: number
}

/**
 * Letterbox policy.
 *
 * A plain `fitExtent` *contains* the framed geography, so whichever axis is not
 * binding keeps its slack — and that slack is where the neighbouring continent
 * shows up. `amount` says how much of the reclaimable space to take by scaling in.
 *
 * What is reclaimable depends entirely on `keep`. With no `keep`, every framed
 * vertex must stay on screen, so the zoom can only eat padding: the region ends up
 * flush against the viewport on its binding axis and the letterbox on the other
 * axis survives, because closing it would cut the region in half. That is the right
 * answer for a continent whose own outline is the composition — Africa is 0.727
 * wide per unit tall in Equal Earth, and a cover fit in any landscape viewport
 * would take Tunis and Cape Town with it.
 *
 * Naming a `keep` box says the opposite: the geography inside it is the
 * composition, and framed geometry outside it may be cropped to close the
 * letterbox. Europe uses that — the Atlantic and the Russian steppe running out to
 * the 50th meridian are what the camera is allowed to spend, so the continent can
 * fill the canvas from the North Cape down to Crete.
 */
export interface FillPolicy {
  /** How much of the reclaimable space to take, 0..1. */
  amount: number
  /**
   * Geography the fill must not crop, as a lon/lat box.
   *
   * The cap is computed from the projected bounds of the framed vertices inside
   * this box, and the crop is balanced around them rather than around the full
   * target — so the surplus is taken from whichever side actually holds it.
   * Omitted means "keep everything", which is the conservative default.
   */
  keep?: BBox
}

/** A named piece of geography carved out of a region's membership. */
export interface ExcludedArea {
  name: string
  bbox: BBox
}

/** Trim policy that leaves the domain's own edges as the bounds. */
const NO_TRIM = { coreAreaFraction: 0, maxDetachmentDegrees: Infinity }

const AMERICAS_NORTH = new Set(['North America', 'Central America', 'Caribbean'])

/**
 * The margin round the three maps' own regions — the World, Europe and the United States — so
 * each opens with the same breathing room inside the canvas or its frame.
 */
const HOME_MARGIN = 0.02

export const REGIONS: RegionPreset[] = [
  {
    id: 'world',
    name: 'World',
    includes: () => true,
    // Antarctica is cropped by the domain: that is a cartographic choice about the
    // world view, not an outlier problem, so no trimming is applied.
    framing: { domain: [-180, -60, 180, 84], trim: NO_TRIM, margin: HOME_MARGIN, fill: { amount: 0 }, mercatorSouth: -72 },
    bbox: [-179.9, -58, 179.9, 84],
    projectionId: 'equalEarth',
  },
  {
    id: 'europe',
    name: 'Europe',
    includes: (m) => m.region === 'Europe',
    alsoInclude: ['TUR', 'CYP', 'XNC', 'GEO', 'ARM', 'AZE'],
    // Remote dependencies that are politically European but have no place on a map of
    // continental Europe. Each sits inside a member country's own geometry (Svalbard,
    // Jan Mayen and Bouvet inside Norway; the Azores and Madeira inside Portugal; the
    // Canaries inside Spain), which is exactly why per-country membership cannot
    // express it. Sovereign island countries such as Iceland and the Faroes are NOT
    // listed here — they remain part of Europe, and are simply outside the
    // continental camera window below.
    excludedAreas: [
      { name: 'Svalbard and Bjørnøya', bbox: [8, 73.5, 36, 81.5] },
      { name: 'Jan Mayen', bbox: [-10, 70.4, -7, 71.6] },
      { name: 'Bouvet Island', bbox: [2, -55.5, 5, -53.5] },
      { name: 'Azores', bbox: [-32, 36, -24, 40.5] },
      { name: 'Madeira and the Selvagens', bbox: [-18, 29.5, -15, 33.5] },
      { name: 'Canary Islands', bbox: [-19, 27, -13, 30] },
    ],
    // The conventional continental-Europe window: North Cape down to just past Crete
    // and Malta, Ireland across to the European side of Russia. Within it the real
    // coastlines still decide the bounds, so the camera adapts to whichever dataset
    // is loaded. West stops at 13°W, which leaves Iceland outside the default
    // composition without removing it from the region.
    framing: {
      domain: [-13, 34, 50, 71.6],
      trim: { coreAreaFraction: 0.005, maxDetachmentDegrees: 3 },
      margin: HOME_MARGIN,
      /*
       * A plain contain-fit, like the World and the United States: the continent whole, with
       * the same margin round it, rather than filling the canvas edge to edge. It used to close
       * the letterbox (amount 1, keeping [-13, 34, 45, 71.6]), which ran Europe off every edge
       * of the canvas and of a frame while the World map sat inside them — and that showed in
       * videos cutting from one map to the other.
       */
      fill: { amount: 0 },
    },
    bbox: [-13, 34, 50, 71.5],
    projectionId: 'conicEqualArea',
    parallels: [43, 62],
  },
  {
    id: 'asia',
    name: 'Asia',
    includes: (m) => m.region === 'Asia',
    alsoInclude: ['RUS'],
    framing: {
      // North stops short of Franz Josef Land, and west of the Urals so European
      // Russia does not drag the frame into Europe.
      domain: [26, -11, 180, 78],
      trim: { coreAreaFraction: 0.005, maxDetachmentDegrees: 4 },
      margin: 0.015,
      fill: { amount: 1 },
    },
    bbox: [26, -11, 180, 78],
    projectionId: 'equalEarth',
  },
  {
    id: 'africa',
    name: 'Africa',
    includes: (m) => m.region === 'Africa',
    framing: {
      // Brackets the continent: Cap Blanc down to Cape Agulhas, Cap-Vert across to
      // Ras Hafun, with Madagascar and the Mozambique Channel islands inside it.
      // Cape Verde and the Mascarenes sit outside and stay off the camera.
      domain: [-19, -36, 52, 38],
      trim: { coreAreaFraction: 0.005, maxDetachmentDegrees: 4 },
      margin: 0.015,
      // No keep box, deliberately. Every edge of Africa's frame is mainland coast —
      // Tunisia at the top, the Cape at the bottom, Senegal and Somalia at the
      // sides — so there is nothing here the camera may spend. The height binds in
      // any landscape viewport, which makes the plain fit already the largest
      // uniform scale that keeps the continent whole; the ocean left and right is
      // the continent's own proportions, not slack. Handing this region a keep box
      // would buy width by cutting Tunis and Cape Town off the map.
      fill: { amount: 1 },
    },
    bbox: [-19, -36, 52, 38],
    /**
     * Azimuthal equal-area rather than the general-purpose Equal Earth.
     *
     * Since the height binds, the projection alone decides how much of the canvas
     * Africa occupies, and Equal Earth is the worst of the six for this continent:
     * it is a whole-world compromise that compresses meridians and stretches
     * parallels near the equator, drawing Africa 0.727 wide per unit tall against a
     * true figure near 0.94. Centred on the continent an azimuthal equal-area shows
     * it at 0.937 — the same geography and the same uniform scale, a third larger on
     * screen, with the Atlantic and Indian Ocean margins cut from a fifth of the
     * canvas to a ninth. Africa straddles the equator, so the equatorial aspect the
     * camera rotates to is the natural one; distortion stays low right across the
     * region and area is still preserved exactly.
     */
    projectionId: 'azimuthalEqualArea',
  },
  {
    id: 'north-america',
    name: 'North America',
    includes: (m) => m.region === 'Americas' && AMERICAS_NORTH.has(m.subregion),
    framing: {
      // Greenland stays a member, but the frame stops at its populated west so the
      // continent is not squeezed by an ice sheet reaching to 11°W — which is also
      // what kept Europe on screen.
      domain: [-168, 7, -50, 74],
      trim: { coreAreaFraction: 0.005, maxDetachmentDegrees: 4 },
      margin: 0.015,
      fill: { amount: 1 },
    },
    bbox: [-169, 6, -11, 80],
    projectionId: 'conicEqualArea',
    parallels: [20, 60],
  },
  {
    id: 'south-america',
    name: 'South America',
    includes: (m) => m.region === 'Americas' && m.subregion === 'South America',
    framing: {
      domain: [-82, -56, -34, 13],
      trim: { coreAreaFraction: 0.005, maxDetachmentDegrees: 4 },
      margin: 0.015,
      fill: { amount: 1 },
    },
    bbox: [-82, -56, -33, 14],
    projectionId: 'conicEqualArea',
    parallels: [-40, -5],
  },
  {
    id: 'oceania',
    name: 'Oceania',
    includes: (m) => m.region === 'Oceania',
    // Extends past 180 so Fiji/Samoa stay contiguous with Australia. The gap
    // threshold is large because scattered Pacific island groups ARE the region —
    // they must not be mistaken for outliers.
    framing: {
      // North stops above the Marshalls and Guam but below mainland South-East Asia,
      // so Micronesia stays in the composition while Thailand and China leave it.
      domain: [110, -50, 200, 16],
      trim: { coreAreaFraction: 0.005, maxDetachmentDegrees: 12 },
      margin: 0.015,
      // A little short of the others: Oceania's members are spread across the
      // Pacific, and the ocean between them is part of the composition.
      fill: { amount: 0.85 },
    },
    bbox: [110, -49, 200, 22],
    projectionId: 'equalEarth',
  },
  /* ------------------------------------------------------------ USA States */
  {
    id: 'usa',
    name: 'United States',
    // Every entity in the atlas belongs; the dataset is already only the United States.
    includes: () => true,
    /*
     * The camera is the **contiguous** United States, and that is the whole trick.
     *
     * Alaska and Hawaii are drawn from their real coordinates as insets — see
     * `maps/atlas.ts` — so the main projection must not try to hold them. The domain
     * says so declaratively: the lower 48 run from the Olympic coast to Maine and from
     * the Florida Keys to the Canadian line, and geography outside that window is
     * still rendered but stops deciding where the edges of the map are.
     *
     * This is the same mechanism that keeps Svalbard from setting the top of a map of
     * Europe. Nothing new was needed for it — the exclusion of geography from framing,
     * without excluding it from the map, was already the model.
     */
    framing: {
      domain: [-125.1, 24.3, -66.8, 49.5],
      trim: { coreAreaFraction: 0.004, maxDetachmentDegrees: 3 },
      margin: HOME_MARGIN,
      /*
       * A plain contain-fit, with no letterbox reclaimed.
       *
       * Unlike a continent, this map has a second job for its slack: the corner a
       * contain-fit leaves below the Pacific coast is exactly where the Alaska and
       * Hawaii insets go. Closing it would put the lower 48 flush against the canvas
       * and leave the insets no room that is not already someone's coastline.
       */
      fill: { amount: 0 },
    },
    bbox: [-125.1, 24.3, -66.8, 49.5],
    // Albers' conic for the United States: the projection every atlas of the country
    // uses, with its published standard parallels.
    projectionId: 'conicEqualArea',
    parallels: [29.5, 45.5],
  },
]

/* ------------------------------------------------------------- Subregions */

const PARTS = SUBREGION_PARTS as unknown as Record<string, BBox>

/**
 * A hair around each part's measured extent, so a coastline drawn at 1:110m, whose vertices
 * sit a little off the 1:10m admin-1 lines the extent was measured on, is not cut.
 */
const PART_PAD = 0.15

/** Union of two boxes, the second shifted by whole turns to sit next to the first. */
function unionBBox(a: BBox | null, b: BBox): BBox {
  if (!a) return b
  const c = alignBBox(b, lonCenter(a))
  return [Math.min(a[0], c[0]), Math.min(a[1], c[1]), Math.max(a[2], c[2]), Math.max(a[3], c[3])]
}

/** The extent of a country's listed units, padded; null if none of the codes is known. */
function partsExtent(codes: string[]): BBox | null {
  let box: BBox | null = null
  for (const code of codes) {
    const unit = PARTS[code]
    if (!unit) {
      if (import.meta.env?.DEV) console.warn(`[regions] no extent for ${code}; run scripts/build-subregion-parts.mjs`)
      continue
    }
    box = unionBBox(box, unit)
  }
  return box && [box[0] - PART_PAD, Math.max(-90, box[1] - PART_PAD), box[2] + PART_PAD, Math.min(90, box[3] + PART_PAD)]
}

/**
 * A subregion as a region preset.
 *
 * It borrows its continent's camera policy (the outlier trim, the margin, the excluded areas)
 * so a subregion of Europe drops Svalbard and the Azores just as Europe does. Only the domain
 * changes: the feature's own extent when the definition gives one, otherwise the continent's,
 * widened to take in any part-members. Each part-member is held to its own units' extent.
 * No keep box: that is a statement about one composition, and Europe's would crop the Baltic.
 */
function subregionPreset(parent: RegionPreset, def: SubregionDef): RegionPreset {
  const whole = new Set(def.countries ?? [])
  const memberDomains: Record<string, BBox> = {}
  for (const [country, codes] of Object.entries(def.parts ?? {})) {
    const box = partsExtent(codes)
    if (box) memberDomains[country] = box
  }
  const partBoxes = Object.values(memberDomains)
  const members = new Set([...whole, ...Object.keys(memberDomains)])

  let domain: BBox | null = def.domain ?? (whole.size > 0 ? parent.framing.domain : null)
  for (const box of partBoxes) domain = unionBBox(domain, box)
  const window = domain ?? parent.bbox
  const [, south, , north] = window
  const band = (north - south) / 6

  return {
    id: `${parent.id}/${def.slug}` as RegionId,
    name: def.name,
    parentId: parent.id,
    definition: def.definition,
    includes: (m) => members.has(m.id) || (m.parent != null && members.has(m.parent.id)),
    excludedAreas: def.excludedAreas ?? parent.excludedAreas,
    memberDomains: partBoxes.length ? memberDomains : undefined,
    framing: {
      domain: window,
      trim: parent.framing.trim,
      margin: 0.02,
      fill: { amount: parent.framing.fill.amount },
    },
    // Only the first paint before any geometry: the framing reads the real extent after.
    bbox: def.domain ?? (partBoxes.length && whole.size === 0 ? window : parent.bbox),
    projectionId: 'conicEqualArea',
    parallels: [south + band, north - band],
    autoParallels: true,
    explicitMembers: true,
  }
}

for (const [continent, defs] of Object.entries(SUBREGIONS) as [ContinentId, SubregionDef[]][]) {
  const parent = REGIONS.find((r) => r.id === continent)!
  for (const def of defs) REGIONS.push(subregionPreset(parent, def))
}

/* ------------------------------------------------------- USA Census regions */

/**
 * The US Census Bureau's four regions and nine divisions, for the region bar of the USA maps.
 *
 * Framing presets like the subregions: choosing one moves the camera to it and marks what is in
 * it, and draws no new border. Every unit of both USA maps carries its Census region and division
 * (`region`, `subregion`), its state's for a county or a subdivision, so the membership is read
 * from the data rather than listed. The domain is each one's contiguous extent: Alaska and Hawaii
 * belong to the West and the Pacific division, but drawn where they are they would set a frame
 * a quarter of the globe wide, so — as on the United States' own frame — they do not decide it.
 */
interface CensusArea {
  slug: string
  name: string
  /** The Census region (`region`) or division (`subregion`) the units carry. */
  match: { region: string } | { division: string }
  definition: string
  domain: BBox
}

const CENSUS_AREAS: CensusArea[] = [
  { slug: 'northeast', name: 'Northeast', match: { region: 'Northeast' }, definition: 'US Census Northeast region: New England and the Middle Atlantic', domain: [-80.6, 38.9, -66.9, 47.5] },
  { slug: 'midwest', name: 'Midwest', match: { region: 'Midwest' }, definition: 'US Census Midwest region: the East and West North Central divisions', domain: [-104.1, 36, -80.5, 49.4] },
  { slug: 'south', name: 'South', match: { region: 'South' }, definition: 'US Census South region: the South Atlantic, East South Central and West South Central divisions', domain: [-106.7, 24.4, -75, 40.7] },
  { slug: 'west', name: 'West', match: { region: 'West' }, definition: 'US Census West region: the Mountain and Pacific divisions, Alaska and Hawaii included', domain: [-124.8, 31.3, -102, 49.1] },
  { slug: 'new-england', name: 'New England', match: { division: 'New England' }, definition: 'US Census New England division: Connecticut, Maine, Massachusetts, New Hampshire, Rhode Island, Vermont', domain: [-73.8, 40.9, -66.9, 47.5] },
  { slug: 'mid-atlantic', name: 'Mid-Atlantic', match: { division: 'Middle Atlantic' }, definition: 'US Census Middle Atlantic division: New Jersey, New York, Pennsylvania', domain: [-80.6, 38.9, -71.8, 45.1] },
  { slug: 'east-north-central', name: 'East North Central', match: { division: 'East North Central' }, definition: 'US Census East North Central division: Illinois, Indiana, Michigan, Ohio, Wisconsin', domain: [-92.9, 36.9, -80.5, 48.3] },
  { slug: 'west-north-central', name: 'West North Central', match: { division: 'West North Central' }, definition: 'US Census West North Central division: Iowa, Kansas, Minnesota, Missouri, Nebraska, North Dakota, South Dakota', domain: [-104.1, 36, -89.1, 49.4] },
  { slug: 'south-atlantic', name: 'South Atlantic', match: { division: 'South Atlantic' }, definition: 'US Census South Atlantic division: Delaware, DC, Florida, Georgia, Maryland, North Carolina, South Carolina, Virginia, West Virginia', domain: [-87.7, 24.4, -75, 40.7] },
  { slug: 'east-south-central', name: 'East South Central', match: { division: 'East South Central' }, definition: 'US Census East South Central division: Alabama, Kentucky, Mississippi, Tennessee', domain: [-91.7, 30.1, -81.9, 39.2] },
  { slug: 'west-south-central', name: 'West South Central', match: { division: 'West South Central' }, definition: 'US Census West South Central division: Arkansas, Louisiana, Oklahoma, Texas', domain: [-106.7, 25.8, -88.8, 37] },
  { slug: 'mountain', name: 'Mountain', match: { division: 'Mountain' }, definition: 'US Census Mountain division: Arizona, Colorado, Idaho, Montana, Nevada, New Mexico, Utah, Wyoming', domain: [-120.1, 31.3, -102, 49.1] },
  { slug: 'pacific', name: 'Pacific', match: { division: 'Pacific' }, definition: 'US Census Pacific division: California, Oregon, Washington, Alaska and Hawaii', domain: [-124.8, 32.5, -114.1, 49.1] },
]

{
  const usa = REGIONS.find((r) => r.id === 'usa')!
  for (const area of CENSUS_AREAS) {
    const [, south, , north] = area.domain
    const band = (north - south) / 6
    const match = area.match
    REGIONS.push({
      id: `usa/${area.slug}`,
      name: area.name,
      parentId: 'usa',
      definition: area.definition,
      includes: 'region' in match ? (m) => m.region === match.region : (m) => m.subregion === match.division,
      framing: { domain: area.domain, trim: usa.framing.trim, margin: HOME_MARGIN, fill: { amount: 0 } },
      bbox: area.domain,
      projectionId: 'conicEqualArea',
      parallels: [south + band, north - band],
      autoParallels: true,
    })
  }
}

/** The subregions listed under one continent, in the order they are declared. */
export function subregionsOf(id: RegionId): RegionPreset[] {
  return REGIONS.filter((r) => r.parentId === id)
}

export function getRegion(id: RegionId): RegionPreset {
  return REGIONS.find((r) => r.id === id) ?? REGIONS[0]
}

/** Resolved framing for one or more regions. */
export interface ScopeFraming {
  regionIds: RegionId[]
  /** Fallback window, possibly shifted past ±180 to stay contiguous. */
  bbox: BBox
  /** Composed camera policy; `framing.ts` turns this into geometry-derived bounds. */
  framing: RegionFraming
  /** Geography carved out of the region, composed across every selected region. */
  excludedAreas: ExcludedArea[]
  projectionId: ProjectionId
  parallels?: [number, number]
  /** Longitude the projection is rotated to. */
  centerLon: number
  centerLat: number
  /** Parallels to read off the framed extent rather than use as given. */
  autoParallels?: boolean
  /** See `RegionPreset.explicitMembers`. */
  explicitMembers?: boolean
}

function lonCenter(b: BBox) {
  return (b[0] + b[2]) / 2
}

/**
 * Shifts a bbox by whole turns so it sits closest to `referenceLon`. This is what
 * lets North America + Oceania compose without wrapping the long way round the globe.
 */
function alignBBox(bbox: BBox, referenceLon: number): BBox {
  let best = bbox
  let bestDist = Math.abs(lonCenter(bbox) - referenceLon)
  for (const turn of [-360, 360]) {
    const shifted: BBox = [bbox[0] + turn, bbox[1], bbox[2] + turn, bbox[3]]
    const dist = Math.abs(lonCenter(shifted) - referenceLon)
    if (dist < bestDist) {
      best = shifted
      bestDist = dist
    }
  }
  return best
}

/** Composes any number of regions into a single framing. */
export function resolveFraming(regionIds: RegionId[]): ScopeFraming {
  const ids = regionIds.length ? regionIds : (['world'] as RegionId[])

  if (ids.includes('world')) {
    const world = getRegion('world')
    return {
      regionIds: ['world'],
      bbox: world.bbox,
      framing: world.framing,
      excludedAreas: world.excludedAreas ?? [],
      projectionId: world.projectionId,
      centerLon: 0,
      centerLat: 0,
    }
  }

  const presets = ids.map(getRegion)
  const reference = lonCenter(presets[0].bbox)

  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity

  // The camera policy composes alongside the window: the union of the domains, the
  // most permissive area budget, and the largest gap threshold — so combining a
  // region that tolerates scattered islands (Oceania) never makes another region's
  // islands look like outliers.
  let dWest = Infinity
  let dSouth = Infinity
  let dEast = -Infinity
  let dNorth = -Infinity
  let coreAreaFraction = Infinity
  let maxDetachmentDegrees = 0
  let margin = 0
  let fillAmount = 1

  for (const preset of presets) {
    const b = alignBBox(preset.bbox, reference)
    west = Math.min(west, b[0])
    south = Math.min(south, b[1])
    east = Math.max(east, b[2])
    north = Math.max(north, b[3])

    const d = alignBBox(preset.framing.domain, reference)
    dWest = Math.min(dWest, d[0])
    dSouth = Math.min(dSouth, d[1])
    dEast = Math.max(dEast, d[2])
    dNorth = Math.max(dNorth, d[3])
    coreAreaFraction = Math.min(coreAreaFraction, preset.framing.trim.coreAreaFraction)
    maxDetachmentDegrees = Math.max(maxDetachmentDegrees, preset.framing.trim.maxDetachmentDegrees)
    margin = Math.max(margin, preset.framing.margin)
    fillAmount = Math.min(fillAmount, preset.framing.fill.amount)
  }

  // A composition spanning most of the globe is just the world.
  if (east - west >= 350) {
    const world = getRegion('world')
    return {
      regionIds: ids,
      bbox: world.bbox,
      framing: world.framing,
      excludedAreas: world.excludedAreas ?? [],
      projectionId: world.projectionId,
      centerLon: 0,
      centerLat: 0,
    }
  }

  const bbox: BBox = [west, south, east, north]
  const single = presets.length === 1 ? presets[0] : null

  return {
    regionIds: ids,
    bbox,
    // Exclusions accumulate across a composition: an area that has no place on a map
    // of Europe has none on a map of Europe + Asia either.
    excludedAreas: presets.flatMap((p) => p.excludedAreas ?? []),
    framing: single
      ? single.framing
      : {
          domain: [dWest, dSouth, dEast, dNorth],
          trim: { coreAreaFraction, maxDetachmentDegrees },
          margin,
          // No keep box on a composition. One region's surplus is the next one's
          // subject — the eastern strip Europe may spend is the western edge of
          // Asia — so a composed scope keeps everything it frames.
          fill: { amount: fillAmount },
        },
    // Composed regions fall back to a general-purpose equal-area projection,
    // since a conic tuned for one region distorts badly across a wider window.
    projectionId: single ? single.projectionId : 'equalEarth',
    parallels: single?.parallels,
    autoParallels: single?.autoParallels,
    explicitMembers: presets.every((p) => p.explicitMembers),
    centerLon: (west + east) / 2,
    centerLat: (south + north) / 2,
  }
}

/**
 * Whether an entity belongs to a region. One that lists its continents (`regions`: a historical
 * state on two of them, like the Ottoman Empire of 1914) is on exactly those; anything else is
 * decided by the preset's own rule. The world takes everything either way.
 */
export function belongsTo(preset: RegionPreset, m: EntityMeta): boolean {
  if (m.regions && !preset.parentId && preset.id !== 'world') return m.regions.includes(preset.id)
  return preset.includes(m)
}

/** Country ids belonging to the given regions, used for scope highlighting/cropping. */
export function countriesInRegions(
  regionIds: RegionId[],
  meta: Record<string, EntityMeta>,
): Set<string> {
  const ids = regionIds.length ? regionIds : (['world'] as RegionId[])
  const presets = ids.map(getRegion)
  const out = new Set<string>()
  for (const m of Object.values(meta)) {
    // A subdivision belongs wherever its country does — including a country a preset
    // names as a transcontinental extra, so Türkiye's provinces are on a map of Europe.
    if (presets.some((p) => belongsTo(p, m) || (m.parent && p.alsoInclude?.includes(m.parent.id)))) {
      out.add(m.id)
    }
  }
  for (const p of presets) {
    for (const id of p.alsoInclude ?? []) out.add(id)
  }
  return out
}

/**
 * The camera domain for one member of a scope: its own part's extent when every selected
 * region that has it holds it only in part, otherwise null for "the scope's domain".
 *
 * `countryId` is the entity's country: itself for a country, its parent for a subdivision.
 * A country that any selected region takes whole is taken whole, so Europe + New England
 * frames all of the United States' in-domain geometry, not only its north-east.
 */
export function memberDomain(regionIds: RegionId[], countryId: string, meta: EntityMeta | undefined): BBox | null {
  let box: BBox | null = null
  for (const id of regionIds) {
    const preset = getRegion(id)
    const part = preset.memberDomains?.[countryId]
    if (part) box = unionBBox(box, part)
    else if (meta && (belongsTo(preset, meta) || preset.alsoInclude?.includes(countryId))) return null
  }
  return box
}

/** The regions one atlas offers along its bar, in the order it declares them. */
export function regionsForAtlas(atlasId: string): RegionPreset[] {
  const atlas = getAtlas(atlasId)
  const ids = atlas.regionBar ? atlas.regionBar.map((entry) => entry.id) : atlas.regionIds
  return ids.map(getRegion)
}

/**
 * What a region's ▾ opens on an atlas's bar: the atlas's own list where it gives one — Northern
 * Europe's Scandinavia, Baltic States, British Isles — otherwise every subregion under it.
 */
export function barChildren(atlasId: string, id: RegionId): RegionPreset[] {
  const entry = getAtlas(atlasId).regionBar?.find((e) => e.id === id)
  return entry ? (entry.children ?? []).map(getRegion) : subregionsOf(id)
}

export function describeRegions(regionIds: RegionId[]): string {
  if (!regionIds.length) return 'World'
  return regionIds.map((id) => getRegion(id).name).join(' + ')
}
