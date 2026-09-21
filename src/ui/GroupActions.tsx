/**
 * "Select all of Catalonia": the regions one selected unit lies in, each a button that adds
 * the rest of that region's units to the selection.
 *
 * Shown under a single selected subdivision, because that is where the question comes up —
 * the author has clicked Barcelona and wants the whole community. The region's units are
 * read from the loaded dataset (`membersOf`), so the button always selects what the current
 * level draws: four provinces of Catalonia, or its own unit at a level where it is one.
 */
import { useMapStore } from '../state/mapStore'
import { membersOf } from '../geo/groups'
import type { EntityMeta } from '../geo/countryMeta'

export function GroupActions({ meta }: { meta: EntityMeta }) {
  const geo = useMapStore((s) => s.geo)
  const addToSelection = useMapStore((s) => s.addToSelection)
  if (!geo || !meta.parent) return null

  const groups = [
    ...(meta.groups ?? []),
    { id: `country:${meta.parent.id}`, name: meta.parent.name, scheme: meta.parent.kind ?? 'Country', approximate: false },
  ]
    .map((group) => ({ ...group, members: membersOf(geo.meta, group.id) }))
    .filter((group) => group.members.length > 1)
  if (groups.length === 0) return null

  return (
    <div className="group-actions">
      <span className="field__label">Select the whole region</span>
      <div className="group-actions__list">
        {groups.map((group) => (
          <button
            key={group.id}
            type="button"
            className="btn btn--ghost group-actions__button"
            title={`${group.scheme}: ${group.name}${group.approximate ? ' (approximated by whole units)' : ''}`}
            onClick={() => {
              addToSelection(group.members)
            }}
          >
            <span className="group-actions__scheme">{group.scheme}</span>
            <span className="group-actions__name">
              {group.name}
              {group.approximate ? ' ≈' : ''}
            </span>
            <span className="group-actions__count">{group.members.length}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
