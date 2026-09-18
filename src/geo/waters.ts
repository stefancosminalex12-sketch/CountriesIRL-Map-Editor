/**
 * Water region layer: the named oceans and seas, as selectable entities.
 *
 * A geographic layer in its own right, in the same shape of module as `lakes.ts` and
 * `rivers.ts` — one file, loaded once, independent of whichever country dataset is open, so
 * it serves the World map, the administrative world, the USA maps and anything a later atlas
 * brings without a variant per map.
 *
 * The data is `scripts/build-waters.mjs`'s: Natural Earth's 1:50m marine geography, its named
 * features folded into the sixteen major oceans and seas, the water it names nowhere given to
 * the region beside it, and everything cut at 60°S. Real marine polygons with a hole for
 * every island the source cuts out — nothing here is a circle, a box or a bounding shape.
 *
 * ## Water is not land, and the ids say so
 *
 * Unlike lakes and rivers, these *are* entities: they are selected, they are painted, and
 * they go in the legend and the exports. What they are not is land, and the separation is
 * structural rather than a matter of care at each call site:
 *
 *  - every id begins with {@link WATER_ID_PREFIX}, which no country (ISO 3166-1 alpha-3 or a
 *    `X..` code), subdivision (`US-CA`, `DEU-3488`), merged body (`merge-…`) or overlay
 *    (`overlay-…`) id can look like, so {@link isWaterId} is a total answer to "is this a
 *    sea?" wherever an id turns up;
 *  - the selection keeps them apart: `selectedWaterIds` beside `selectedCountryIds`, and the
 *    store's own selection actions route by that prefix (see `mapStore`), so nothing that
 *    reads the land selection can ever see a sea;
 *  - their paint is `doc.waters`, beside `doc.countries` rather than in it;
 *  - the merge executor refuses them outright, so no group of countries can contain one.
 *
 * The layer is off by default (`MapStyle.showWaterRegions`) and this module is what the map
 * fetches when it is switched on — a megabyte, once, and never before.
 */
import type { Feature, MultiPolygon, Polygon } from 'geojson'
import { repairPolygon } from './repair'

/**
 * What every water region's id starts with.
 *
 * The whole of the separation between water and land, so it is deliberately not a value
 * anything else in the editor can produce.
 */
export const WATER_ID_PREFIX = 'water-'

/** Whether an entity id names a water region rather than land. */
export function isWaterId(id: string): boolean {
  return id.startsWith(WATER_ID_PREFIX)
}

/** Splits ids into the land ones and the water ones, in the order given. */
export function partitionByWater(ids: readonly string[]): { land: string[]; water: string[] } {
  const land: string[] = []
  const water: string[] = []
  for (const id of ids) (isWaterId(id) ? water : land).push(id)
  return { land, water }
}

export type WaterCategory = 'ocean' | 'sea'

export interface WaterProperties {
  id: string
  name: string
  category: WaterCategory
}

export type WaterFeature = Feature<MultiPolygon, WaterProperties>

/**
 * The regions the editor offers, in the order the file holds them: oceans first, so a sea
 * lying inside one is drawn over it rather than under it.
 *
 * Listed here as well as in the data because the UI, the legend and the executor's
 * validation need to know which seas exist without waiting for a megabyte of geometry — the
 * list of regions is small, fixed, and part of the feature; the coordinates are the payload.
 * `loadWaters` checks the two agree.
 */
export const WATER_REGIONS: ReadonlyArray<{ id: string; name: string; category: WaterCategory }> = [
  { id: 'water-pacific-ocean', name: 'Pacific Ocean', category: 'ocean' },
  { id: 'water-atlantic-ocean', name: 'Atlantic Ocean', category: 'ocean' },
  { id: 'water-indian-ocean', name: 'Indian Ocean', category: 'ocean' },
  { id: 'water-southern-ocean', name: 'Southern Ocean', category: 'ocean' },
  { id: 'water-arctic-ocean', name: 'Arctic Ocean', category: 'ocean' },
  { id: 'water-caribbean-sea', name: 'Caribbean Sea', category: 'sea' },
  { id: 'water-mediterranean-sea', name: 'Mediterranean Sea', category: 'sea' },
  { id: 'water-black-sea', name: 'Black Sea', category: 'sea' },
  { id: 'water-baltic-sea', name: 'Baltic Sea', category: 'sea' },
  { id: 'water-north-sea', name: 'North Sea', category: 'sea' },
  { id: 'water-red-sea', name: 'Red Sea', category: 'sea' },
  { id: 'water-arabian-sea', name: 'Arabian Sea', category: 'sea' },
  { id: 'water-south-china-sea', name: 'South China Sea', category: 'sea' },
  { id: 'water-east-china-sea', name: 'East China Sea', category: 'sea' },
  { id: 'water-sea-of-japan', name: 'Sea of Japan', category: 'sea' },
  { id: 'water-caspian-sea', name: 'Caspian Sea', category: 'sea' },
]

const WATER_NAMES = new Map(WATER_REGIONS.map((region) => [region.id, region.name]))

/** Whether this is the id of a region that actually exists. */
export function isKnownWaterId(id: string): boolean {
  return WATER_NAMES.has(id)
}

/** A region's name, or the id itself if it is not one of them. */
export function waterName(id: string): string {
  return WATER_NAMES.get(id) ?? id
}

const URL_PATH = 'geo/waters.geojson'

export interface LoadedWaters {
  /** Every region, in draw order. */
  features: WaterFeature[]
  byId: Map<string, WaterFeature>
}

let cached: Promise<LoadedWaters> | null = null

/**
 * Fetches and normalises the water regions. Cached for the session, like the maritime layer.
 *
 * The polygons get the same hygiene the country and lake layers get: one ring wound the wrong
 * way would be read by the spherical clipper as covering the globe, which would paint the
 * whole projection as one sea.
 */
export function loadWaters(): Promise<LoadedWaters> {
  if (cached) return cached

  cached = (async (): Promise<LoadedWaters> => {
    const response = await fetch(`${import.meta.env.BASE_URL}${URL_PATH}`)
    if (!response.ok) throw new Error(`Failed to load water regions (${response.status})`)
    const collection = (await response.json()) as {
      features: Feature<Polygon | MultiPolygon, WaterProperties>[]
    }

    const byId = new Map<string, WaterFeature>()
    const features: WaterFeature[] = []
    for (const raw of collection.features) {
      const id = raw.properties?.id
      if (!raw.geometry || !id || !isKnownWaterId(id)) continue

      const source = raw.geometry.type === 'Polygon' ? [raw.geometry.coordinates] : raw.geometry.coordinates
      const polygons: MultiPolygon['coordinates'] = []
      for (const polygon of source) {
        const repaired = repairPolygon(polygon)
        if (repaired) polygons.push(repaired)
      }
      if (polygons.length === 0) continue

      const feature: WaterFeature = {
        type: 'Feature',
        geometry: { type: 'MultiPolygon', coordinates: polygons },
        properties: { id, name: waterName(id), category: raw.properties.category === 'ocean' ? 'ocean' : 'sea' },
      }
      features.push(feature)
      byId.set(id, feature)
    }

    return { features, byId }
  })()

  return cached
}
