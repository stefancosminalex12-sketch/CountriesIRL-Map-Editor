/**
 * Maritime territory layer.
 *
 * The water a country holds, as real geography rather than anything derived from where
 * its islands happen to sit. The source is Marine Regions' World EEZ — the authoritative
 * dataset for exclusive economic zones — vendored by `scripts/fetch-eez.mjs`, which also
 * records the attribution the licence requires.
 *
 * Like lakes, this is a layer beside the country layer rather than inside it: the
 * country datasets are untouched, and the document knows nothing about it. Unlike lakes
 * it *is* keyed to entities, because the whole point is which country a stretch of water
 * belongs to — but the key is only an id, resolved against the country table the same way
 * a flag is.
 *
 * Zones arrive already reconciled. The dataset separates ordinary 200-nautical-mile zones
 * from overlapping claims and joint regimes, and the fetch script keeps only the first, so
 * two countries' water can never cover the same sea. Nothing here arbitrates between
 * claimants and nothing here invents a boundary.
 */
import type { Feature, MultiPolygon, Polygon } from 'geojson'

export interface MaritimeProperties {
  /** Entity id of the country or territory the zone belongs to. */
  id: string
  /** Sovereign's ISO3, where the zone belongs to a dependency. */
  sovereign: string | null
  /** The dataset's own name for the zone, e.g. "Portuguese EEZ (Azores)". */
  name: string
}

export type MaritimeFeature = Feature<Polygon | MultiPolygon, MaritimeProperties>

export interface LoadedMaritime {
  /** Every zone, in file order. */
  features: MaritimeFeature[]
  /**
   * Each zone with the entity it belongs to and the sovereign behind it.
   *
   * Grouping is left to the renderer, because which entities exist depends on the
   * country dataset that is loaded: French Guiana is its own zone in this data and its
   * own entry in the country table, but Natural Earth draws it inside France, so its
   * water has to end up on France. Only the renderer knows that.
   */
  zones: MaritimeZone[]
}

export interface MaritimeZone {
  /** Entity the zone belongs to, from the dataset. */
  id: string
  /** Sovereign's ISO3, used when the entity itself is not drawn on this map. */
  sovereign: string | null
  geometry: MultiPolygon
}

const URL_PATH = 'geo/eez-territories.geojson'

let cached: Promise<LoadedMaritime> | null = null

/** Fetches and indexes the maritime layer. Cached for the session. */
export function loadMaritime(): Promise<LoadedMaritime> {
  if (cached) return cached

  cached = (async (): Promise<LoadedMaritime> => {
    const response = await fetch(`${import.meta.env.BASE_URL}${URL_PATH}`)
    if (!response.ok) throw new Error(`Failed to load maritime territory (${response.status})`)
    const collection = (await response.json()) as { features: MaritimeFeature[] }

    const features: MaritimeFeature[] = []
    const zones: MaritimeZone[] = []

    for (const feature of collection.features) {
      if (!feature.geometry || !feature.properties?.id) continue
      const polygons =
        feature.geometry.type === 'Polygon'
          ? [feature.geometry.coordinates]
          : feature.geometry.type === 'MultiPolygon'
            ? feature.geometry.coordinates
            : []
      if (polygons.length === 0) continue

      features.push(feature)
      zones.push({
        id: feature.properties.id,
        sovereign: feature.properties.sovereign ?? null,
        geometry: { type: 'MultiPolygon', coordinates: polygons },
      })
    }

    return { features, zones }
  })()

  return cached
}
