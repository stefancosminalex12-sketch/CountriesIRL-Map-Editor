/**
 * Dissolving countries into one body.
 *
 * The operation is `topojson.merge`, and choosing it is the whole design. In TopoJSON a
 * border between two neighbours is stored *once*, as a single arc that both countries
 * reference; merging is then a matter of keeping the arcs that appear once and dropping
 * the ones that appear twice, which leaves exactly the outline of the union. That is an
 * exact, combinatorial answer:
 *
 *   - the shared border disappears completely, because it was one object and it is gone,
 *     not because two nearly-identical lines were reconciled to some tolerance;
 *   - no slivers or hairlines appear along the seam, which is what polygon clipping on
 *     floating-point coordinates produces where two outlines were meant to coincide;
 *   - islands and exclaves survive untouched, because a ring that shares no arc with
 *     anything is simply carried through;
 *   - countries that do not touch stay separate rings of one MultiPolygon — one entity,
 *     still geographically honest, with nothing invented to connect them.
 *
 * Nothing here approximates: no bounding box, no hull, no buffer. And nothing here is
 * destructive — the source topology is read, never written, so a merge is a view over
 * the dataset that deleting the merge simply removes.
 */
import { merge as mergeArcs } from 'topojson-client'
import type { MultiPolygon } from 'geojson'
import type { LoadedDataset } from './datasets'
import type { CountryId } from '../types/map'

/**
 * Cached by dataset and membership.
 *
 * Merging walks every arc of every member, which is real work and exactly the kind that
 * must not happen on a pointer move. The key carries the dataset id, so switching
 * resolution recomputes rather than reusing geometry from a different source, and the
 * members are sorted so the same set in a different order is the same cache entry.
 */
const cache = new Map<string, MultiPolygon | null>()

function keyFor(dataset: LoadedDataset, members: CountryId[]): string {
  return `${dataset.dataset.id}|${[...members].sort().join('+')}`
}

/**
 * The dissolved geometry for a set of countries, or `null` when it cannot be built.
 *
 * Null rather than a fallback shape: a source without usable topology cannot be
 * dissolved exactly, and drawing an approximation of a country's borders would be
 * inventing geography. The caller leaves the countries as they were instead.
 */
export function mergeCountries(
  dataset: LoadedDataset | null,
  members: CountryId[],
): MultiPolygon | null {
  if (!dataset?.topology || members.length === 0) return null

  const key = keyFor(dataset, members)
  const cached = cache.get(key)
  if (cached !== undefined) return cached

  const geometries = members.flatMap((id) => dataset.topoById.get(id) ?? [])

  let result: MultiPolygon | null = null
  if (geometries.length > 0) {
    try {
      const merged = mergeArcs(
        dataset.topology,
        geometries as Parameters<typeof mergeArcs>[1],
      )
      result = merged && merged.coordinates.length > 0 ? merged : null
    } catch {
      // A malformed or partial topology: leave the countries alone rather than guess.
      result = null
    }
  }

  cache.set(key, result)
  return result
}

/** A name for a merge the author has not named, from the countries it holds. */
export function defaultMergeName(
  dataset: LoadedDataset | null,
  members: CountryId[],
): string {
  const names = members
    .map((id) => dataset?.byId.get(id)?.properties.name ?? id)
    .filter(Boolean)
  if (names.length === 0) return 'Merged area'
  if (names.length <= 2) return names.join(' & ')
  return `${names[0]} & ${names.length - 1} more`
}
