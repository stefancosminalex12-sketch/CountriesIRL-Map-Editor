/**
 * An entity's codes and source, fetched when they are asked for.
 *
 * The official USA map's county subdivision level is some 32,000 units, and each one's GEOID,
 * FIPS codes, LSAD and source line are needed by exactly one thing: the inspector, for the unit
 * it is showing. So a dataset with `detailsUrl` keeps them out of its entity table — which is
 * loaded, parsed and held with the geometry — in a file of their own, fetched once, the first
 * time the inspector shows one of its units.
 */
import type { EntityMeta } from './countryMeta'

export type EntityDetails = Record<string, { source?: EntityMeta['source'] }>

const cache = new Map<string, Promise<EntityDetails>>()

export function loadEntityDetails(url: string): Promise<EntityDetails> {
  const existing = cache.get(url)
  if (existing) return existing
  const promise = fetch(`${import.meta.env.BASE_URL}${url}`)
    .then((r) => {
      if (!r.ok) throw new Error(`Failed to load "${url}" (${r.status})`)
      return r.json() as Promise<{ entities: EntityDetails }>
    })
    .then((file) => file.entities)
  promise.catch(() => cache.delete(url))
  cache.set(url, promise)
  return promise
}
