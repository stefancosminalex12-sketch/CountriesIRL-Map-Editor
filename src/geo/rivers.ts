/**
 * River layer.
 *
 * A geographic layer in its own right, sitting alongside the countries and the lakes
 * rather than inside them — the same arrangement `lakes.ts` describes, and deliberately
 * the same shape of module, so the renderer treats water the same way whichever kind it
 * is drawing.
 *
 * The data is the curated river layer `scripts/build-geography.mjs` prepares for every
 * map: every one of Natural Earth's 10m `rivers_lake_centerlines`, its whole Europe
 * supplement, and the major rank of its North America supplement — the real surveyed
 * course of each river and its branches, including the line it takes through the lakes it
 * runs through; nothing here is drawn approximately or by hand. The North America
 * supplement's two lowest ranks are left out because they are creeks at this scale, and
 * would draw that one continent many times denser than the rest of the world.
 *
 * Two differences from lakes, both of which follow from a river being a *line*:
 *
 *  - the geometry is LineString / MultiLineString, so there is no ring to repair and no
 *    winding to get wrong. The polygon hygiene the lake and country layers need has no
 *    equivalent here; a line is drawn exactly as it is given.
 *  - it is stroked and never filled. `d3-geo`'s path renders an unclosed line as an open
 *    subpath, so the same projected path data works for every projection the app offers,
 *    and the projection's own clipping is what keeps a river off the parts of the world
 *    that are not on screen.
 *
 * Like lakes, rivers carry no identity in the map document — they are background
 * geography, never selectable entities — and they load separately from the countries so
 * the map paints before they arrive.
 */
import type { Feature, LineString, MultiLineString } from 'geojson'

export interface RiverProperties {
  name: string | null
  /** Natural Earth prominence rank; lower is more prominent. */
  scalerank: number
}

export type RiverFeature = Feature<LineString | MultiLineString, RiverProperties>

export type RiverDetail = '10m' | '50m'

export interface RiverLayer {
  id: string
  detail: RiverDetail
  url: string
}

/** USGS major rivers (Strahler order 6 and up), 1:1,000,000, for the Official USA Administrative Map. */
export const USGS_RIVERS: RiverLayer = { id: 'usgs-rivers-1m', detail: '10m', url: 'geo/usa-official/rivers.geojson' }

export const RIVER_LAYERS: RiverLayer[] = [
  { id: 'rivers-10m', detail: '10m', url: 'geo/rivers-10m.geojson' },
  { id: 'rivers-50m', detail: '50m', url: 'geo/rivers-50m.geojson' },
  USGS_RIVERS,
]

/**
 * Picks the river detail that matches a country dataset.
 *
 * A plain lookup, exactly as for lakes: the river layer follows whichever country
 * resolution is loaded rather than deciding anything for itself.
 */
export function riverLayerForDetail(detail: '110m' | '50m' | '10m'): RiverLayer {
  return detail === '10m' ? RIVER_LAYERS[0] : RIVER_LAYERS[1]
}

export interface LoadedRivers {
  layer: RiverLayer
  features: RiverFeature[]
}

const cache = new Map<string, Promise<LoadedRivers>>()

/** Fetches and normalises a river layer. Cached per layer id. */
export function loadRivers(layer: RiverLayer): Promise<LoadedRivers> {
  const existing = cache.get(layer.id)
  if (existing) return existing

  const promise = (async (): Promise<LoadedRivers> => {
    const response = await fetch(`${import.meta.env.BASE_URL}${layer.url}`)
    if (!response.ok) throw new Error(`Failed to load rivers "${layer.id}" (${response.status})`)
    const collection = (await response.json()) as {
      features: Feature<LineString | MultiLineString, RiverProperties>[]
    }

    const features: RiverFeature[] = []
    for (const raw of collection.features) {
      if (!raw.geometry) continue
      if (raw.geometry.type !== 'LineString' && raw.geometry.type !== 'MultiLineString') continue

      features.push({
        type: 'Feature',
        geometry: raw.geometry,
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
