/**
 * Which flag an entity flies, and which flags there are to choose from.
 *
 * One place for both, so the map, the Flags panel, the Merge panel and the overlays can never
 * disagree about either. Nothing here fetches artwork — see `flagStore` for that.
 */
import { FLAG_EXTRAS } from './manifest'
import { flagCodeFor, hasFlag } from './flagStore'
import type { CountryId } from '../types/map'

/** What these functions read of an entity's metadata. */
interface FlagMeta {
  name: string
  iso2?: string | null
  parent?: { name?: string | null; iso2?: string | null } | null
}
type MetaById = Record<string, FlagMeta | undefined>

/** An entity's own flag, before anything is assigned to it: its iso2, or the one the territory list gives it. */
export function defaultFlagCode(id: CountryId, meta: MetaById): string | undefined {
  return flagCodeFor(id, meta[id]?.iso2)
}

/**
 * The flag an entity flies: the one assigned to it in `overrides`, or its own.
 *
 * An assignment names either another entity, whose flag is borrowed — resolved through
 * `flagCodeFor` exactly as its owner's is, so a flag that comes from an alias or the territory
 * policy is found correctly — or the artwork itself (`de`, `x-rome`), for an entity on a map where
 * no other entity carries the flag wanted: a region of the administrative map, or a state. Checked
 * against the flag library rather than assumed, so an id that means nothing stays meaning nothing.
 *
 * A merged group is not resolved here: its flag is its own `flag` field.
 */
export function entityFlagCode(
  id: CountryId,
  overrides: Record<CountryId, CountryId>,
  meta: MetaById,
): string | undefined {
  const source = overrides[id] ?? id
  const viaEntity = flagCodeFor(source, meta[source]?.iso2)
  if (viaEntity) return viaEntity
  const code = source.toLowerCase()
  return hasFlag(code) ? code : undefined
}

export interface FlagOption {
  code: string
  name: string
}

/**
 * Every flag there is to choose, by name, one entry per flag.
 *
 * Each entity's own flag first — so on the world map the list is what it has always been — then
 * the flags only the territory list knows (Somaliland, Northern Cyprus), then the country of each
 * region, which is what gives a map of provinces or states every country's flag to choose from
 * although none of its own units carries one, and the historical set. One entry per flag, not
 * per entity: Kosovo is in the dataset as both UNK and XKX, both carrying `xk`.
 */
export function flagOptions(meta: MetaById): FlagOption[] {
  const byCode = new Map<string, string>()
  const offer = (code: string | null | undefined, name: string | null | undefined) => {
    if (!code || !name || !hasFlag(code)) return
    const key = code.toLowerCase()
    if (!byCode.has(key)) byCode.set(key, name)
  }
  for (const extra of FLAG_EXTRAS) byCode.set(extra.code, extra.name)
  const entries = Object.entries(meta)
  for (const [, m] of entries) offer(m?.iso2, m?.name)
  for (const [id, m] of entries) offer(defaultFlagCode(id, meta), m?.name)
  for (const [, m] of entries) offer(m?.parent?.iso2, m?.parent?.name)
  return [...byCode].map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name))
}

/** A flag's name as the list gives it, or its code when the list does not have it. */
export function flagName(code: string, options: readonly FlagOption[]): string {
  return options.find((option) => option.code === code)?.name ?? code.toUpperCase()
}
