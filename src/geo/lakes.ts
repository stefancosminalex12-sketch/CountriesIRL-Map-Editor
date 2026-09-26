/**
 * Lake layer.
 *
 * Lakes are a geographic layer in their own right, sitting alongside the country
 * layer rather than inside it. The country datasets are never touched, and adding
 * another layer later (rivers, glaciers, urban areas) means another module like this
 * one — not a change to the country geometry or to the renderer's structure.
 *
 * The data is the curated inland-water layer `scripts/build-geography.mjs` prepares for
 * every map: all of Natural Earth's 10m lakes, reservoirs and lagoons, and its Europe and
 * North America supplements where the main layer does not already draw the lake — 3,283
 * bodies of water at 10m. It used to be cut to the most prominent 336 (`scalerank <= 5`),
 * which left the Dniester liman, the Danube delta's Yalpuh and Kuhurlui, the Étang de Thau
 * and a thousand more drawn as land. At world zoom the small ones are sub-pixel, as any
 * small geography is; zoomed in, they are where they belong.
 *
 * Two things are deliberately NOT here. Lakes carry no identity in the map document —
 * they are background geography, not selectable entities — and they are loaded
 * separately from the countries, so the map paints before they arrive.
 */
import type { Feature, MultiPolygon, Polygon } from 'geojson'
import type { GeoDetail } from './datasets'
import { repairPolygon } from './repair'

export interface LakeProperties {
  name: string | null
  /** Natural Earth prominence rank; lower is more prominent. */
  scalerank: number
}

export type LakeFeature = Feature<Polygon | MultiPolygon, LakeProperties>

export type LakeDetail = '10m' | '25m' | '50m'

export interface LakeLayer {
  id: string
  detail: LakeDetail
  url: string
}

/**
 * USGS lakes and reservoirs, 1:1,000,000, for the Official USA Administrative Map — whose
 * Census land keeps inland water, so it is drawn over it here. See `scripts/usa/build-usa.mjs`.
 */
export const USGS_LAKES: LakeLayer = { id: 'usgs-lakes-1m', detail: '10m', url: 'geo/usa-official/lakes.geojson' }

/**
 * EuroGlobalMap's lakes and reservoirs, 1:1,000,000, for the Europe maps — drawn at the scale of
 * their coastlines and borders, and cut by the same national data. See `scripts/europe/build-europe.mjs`.
 */
export const EGM_LAKES: LakeLayer = { id: 'egm-lakes-1m', detail: '10m', url: 'geo/europe/lakes.geojson' }

export const LAKE_LAYERS: LakeLayer[] = [
  { id: 'lakes-10m', detail: '10m', url: 'geo/lakes-10m.geojson' },
  { id: 'lakes-50m', detail: '50m', url: 'geo/lakes-50m.geojson' },
  // 10m's lakes simplified with the 25m land, by `scripts/build-25m.mjs`.
  { id: 'lakes-25m', detail: '25m', url: 'geo/lakes-25m.geojson' },
  USGS_LAKES,
  EGM_LAKES,
]

const LAKE_25M = LAKE_LAYERS.find((layer) => layer.id === 'lakes-25m') as LakeLayer

/**
 * Picks the lake detail that matches a country dataset.
 *
 * Deliberately a plain lookup rather than a level-of-detail engine: the lake layer
 * simply follows whichever country resolution is loaded.
 */
export function lakeLayerForDetail(detail: GeoDetail): LakeLayer {
  return detail === '10m' ? LAKE_LAYERS[0] : detail === '25m' ? LAKE_25M : LAKE_LAYERS[1]
}

export interface LoadedLakes {
  layer: LakeLayer
  features: LakeFeature[]
}

const cache = new Map<string, Promise<LoadedLakes>>()

/** Fetches and normalises a lake layer. Cached per layer id. */
export function loadLakes(layer: LakeLayer): Promise<LoadedLakes> {
  const existing = cache.get(layer.id)
  if (existing) return existing

  const promise = (async (): Promise<LoadedLakes> => {
    const response = await fetch(`${import.meta.env.BASE_URL}${layer.url}`)
    if (!response.ok) throw new Error(`Failed to load lakes "${layer.id}" (${response.status})`)
    const collection = (await response.json()) as {
      features: Feature<Polygon | MultiPolygon, LakeProperties>[]
    }

    const features: LakeFeature[] = []
    for (const raw of collection.features) {
      if (!raw.geometry) continue

      // Same hygiene the country layer gets. A single inverted ring here would be
      // painted as a lake covering the entire globe.
      const source =
        raw.geometry.type === 'Polygon' ? [raw.geometry.coordinates] : raw.geometry.coordinates
      const polygons: MultiPolygon['coordinates'] = []
      for (const polygon of source) {
        const repaired = repairPolygon(polygon)
        if (repaired) polygons.push(repaired)
      }
      if (polygons.length === 0) continue

      features.push({
        type: 'Feature',
        geometry: { type: 'MultiPolygon', coordinates: polygons },
        properties: {
          name: raw.properties?.name ?? null,
          scalerank: raw.properties?.scalerank ?? 0,
        },
      })
    }

    return { layer, features }
  })()

  cache.set(layer.id, promise)
  return promise
}
