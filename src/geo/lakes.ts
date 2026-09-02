/**
 * Lake layer.
 *
 * Lakes are a geographic layer in their own right, sitting alongside the country
 * layer rather than inside it. The country datasets are never touched, and adding
 * another layer later (rivers, glaciers, urban areas) means another module like this
 * one — not a change to the country geometry or to the renderer's structure.
 *
 * The data is Natural Earth's lakes, filtered to `scalerank <= 5` and vendored under
 * `data/natural-earth/` by `scripts/fetch-lakes.mjs`. That is the cartographers' own
 * judgement of which lakes belong on a general-purpose map: every major lake in the
 * world plus small-but-notable ones such as Geneva and Bodensee, without the
 * thousand ponds the unfiltered file carries.
 *
 * Two things are deliberately NOT here. Lakes carry no identity in the map document —
 * they are background geography, not selectable entities — and they are loaded
 * separately from the countries, so the map paints before they arrive.
 */
import type { Feature, MultiPolygon, Polygon } from 'geojson'
import { repairPolygon } from './repair'

export interface LakeProperties {
  name: string | null
  /** Natural Earth prominence rank; lower is more prominent. */
  scalerank: number
}

export type LakeFeature = Feature<Polygon | MultiPolygon, LakeProperties>

export type LakeDetail = '10m' | '50m'

export interface LakeLayer {
  id: string
  detail: LakeDetail
  url: string
}

export const LAKE_LAYERS: LakeLayer[] = [
  { id: 'lakes-10m', detail: '10m', url: 'geo/lakes-10m.geojson' },
  { id: 'lakes-50m', detail: '50m', url: 'geo/lakes-50m.geojson' },
]

/**
 * Picks the lake detail that matches a country dataset.
 *
 * Deliberately a plain lookup rather than a level-of-detail engine: the lake layer
 * simply follows whichever country resolution is loaded.
 */
export function lakeLayerForDetail(detail: '110m' | '50m' | '10m'): LakeLayer {
  return detail === '10m' ? LAKE_LAYERS[0] : LAKE_LAYERS[1]
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
