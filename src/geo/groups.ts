/**
 * Selecting a region that is not a unit at the level on screen.
 *
 * On a map of Spanish provinces Catalonia is four provinces; on a map of Kreise, Upper
 * Bavaria is twenty-three. The build records, on every unit, the regions it lies in
 * (`EntityMeta.groups`) — and every unit is in its country — so a region is simply the units
 * that name it. Nothing here is geometry, and nothing is stored: the members are read off
 * the loaded dataset whenever they are asked for, so they are always the units the current
 * level draws.
 */
import type { EntityGroup, EntityMeta } from './countryMeta'

export interface SelectableGroup {
  id: string
  name: string
  /** "Autonomous community", "Country". */
  scheme: string
  /** The country it is in, for telling Galicia in Spain from any other. */
  country: string
  approximate: boolean
  members: string[]
}

/** Every region the dataset's units name, and every country with more than one unit. */
export function selectableGroups(meta: Record<string, EntityMeta>): SelectableGroup[] {
  const groups = new Map<string, SelectableGroup>()
  const add = (group: EntityGroup | { id: string; name: string; scheme: string; approximate?: boolean }, country: string, member: string) => {
    const existing = groups.get(group.id)
    if (existing) existing.members.push(member)
    else
      groups.set(group.id, {
        id: group.id,
        name: group.name,
        scheme: group.scheme,
        country,
        approximate: !!group.approximate,
        members: [member],
      })
  }
  for (const entity of Object.values(meta)) {
    const parent = entity.parent
    if (!parent) continue
    add({ id: `country:${parent.id}`, name: parent.name, scheme: parent.kind ?? 'Country' }, parent.name, entity.id)
    for (const group of entity.groups ?? []) add(group, parent.name, entity.id)
  }
  // A group of one is the unit itself, and a country of one is already one click.
  return [...groups.values()].filter((g) => g.members.length > 1)
}

/** The units of one region, as the current dataset draws it. */
export function membersOf(meta: Record<string, EntityMeta>, groupId: string): string[] {
  const out: string[] = []
  const country = groupId.startsWith('country:') ? groupId.slice('country:'.length) : null
  for (const entity of Object.values(meta)) {
    if (country ? entity.parent?.id === country : entity.groups?.some((g) => g.id === groupId)) out.push(entity.id)
  }
  return out
}
