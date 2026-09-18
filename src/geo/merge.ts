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
  if (!dataset || members.length === 0) return null
  // Without a topology only supplemented members can be merged, as they are drawn.
  if (!dataset.topology && !members.some((id) => dataset.supplemented.includes(id))) return null

  const key = keyFor(dataset, members)
  const cached = cache.get(key)
  if (cached !== undefined) return cached

  /*
   * A member drawn from supplemental geometry is merged *as it is drawn*. Its arcs in the
   * topology are not its shape — they are the source's placeholder, or nothing at all where the
   * layer omits it — so dissolving them would give the group a Vatican a tenth the size of the
   * one on the map, and would drop a supplemented speck from a 110m group altogether. Its own
   * polygons are carried into the group instead, exactly as an island that shares no arc with
   * anything is carried: one entity, geographically where it is, with nothing invented.
   */
  const supplemented = new Set(dataset.supplemented)
  const dissolved = members.filter((id) => !supplemented.has(id))
  const carried = members.filter((id) => supplemented.has(id))
  const geometries = dissolved.flatMap((id) => dataset.topoById.get(id) ?? [])

  let result: MultiPolygon | null = null
  if (geometries.length > 0 && dataset.topology) {
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
  if (carried.length > 0) {
    const polygons: MultiPolygon['coordinates'] = carried.flatMap((id) => {
      const geometry = dataset.byId.get(id)?.geometry
      if (!geometry) return []
      return geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
    })
    if (polygons.length > 0) {
      result = { type: 'MultiPolygon', coordinates: [...(result?.coordinates ?? []), ...polygons] }
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
