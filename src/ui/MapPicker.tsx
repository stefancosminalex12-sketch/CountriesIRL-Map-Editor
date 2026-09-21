/**
 * Choosing which map the editor is working on.
 *
 * Grouped by what the map is of — the world, or the United States — each group a disclosure
 * that opens onto its maps. The group holding the map in use starts open, so the map in use is
 * never hidden when the section opens, and a closed group still names it on its header. Every
 * group opens and closes on its own; opening one does not close the other.
 *
 * Switching parks the current map's work and restores the target's; see `setAtlas` in
 * `mapStore`. Nothing here knows how that is done, which is the point: this component lists
 * atlases and names one.
 */
import { useId, useState } from 'react'
import { useMapStore } from '../state/mapStore'
import { ATLAS_FAMILIES, ATLASES, type Atlas, type AtlasFamilyId } from '../maps/atlas'

/** The line under a map's name: its own note, or one made from its noun and insets. */
function noteFor(atlas: Atlas): string {
  if (atlas.note) return atlas.note
  const noun = atlas.noun.many.replace(/^./, (c) => c.toUpperCase())
  return atlas.insets.length > 0 ? `${noun} · ${atlas.insets.map((i) => i.name).join(' and ')} inset` : noun
}

function MapFamily({
  name,
  atlases,
  atlasId,
  expanded,
  onToggle,
  onChoose,
}: {
  name: string
  atlases: Atlas[]
  atlasId: string
  expanded: boolean
  onToggle: () => void
  onChoose: (id: string) => void
}) {
  const bodyId = useId()
  const current = atlases.find((atlas) => atlas.id === atlasId) ?? null
  return (
    <div className={`map-family${expanded ? ' map-family--open' : ''}${current ? ' map-family--current' : ''}`}>
      <button
        type="button"
        className="map-family__toggle"
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={onToggle}
      >
        <span className="map-family__name">{name}</span>
        {/* The map in use, named on its group's header — most useful while the group is closed. */}
        {current && <span className="map-family__current">{current.menuName ?? current.name}</span>}
      </button>
      {expanded && (
        <div className="map-family__body" id={bodyId} role="group" aria-label={`${name} maps`}>
          {atlases.map((atlas) => {
            const active = atlas.id === atlasId
            return (
              <button
                key={atlas.id}
                type="button"
                aria-current={active ? 'true' : undefined}
                className={`map-list__item${active ? ' map-list__item--on' : ''}`}
                onClick={() => onChoose(atlas.id)}
              >
                <span className="map-list__name">{atlas.menuName ?? atlas.name}</span>
                <span className="map-list__note">{noteFor(atlas)}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function MapPicker() {
  const atlasId = useMapStore((s) => s.doc.scope.atlasId)
  const setAtlas = useMapStore((s) => s.setAtlas)
  /*
   * Every group closed to begin with, like every other collapsible in the sidebar. The map in use
   * is still named on its group's header, in the accent, so which one is current reads without
   * opening anything.
   */
  const [open, setOpen] = useState<ReadonlySet<AtlasFamilyId>>(() => new Set())

  const toggle = (id: AtlasFamilyId) => {
    const next = new Set(open)
    const opening = !next.has(id)
    if (opening) next.add(id)
    else next.delete(id)
    setOpen(next)
  }

  const choose = (id: string) => {
    if (id === atlasId) return
    setAtlas(id)
  }

  return (
    <div className="stack">
      <div className="map-families">
        {ATLAS_FAMILIES.map((family) => (
          <MapFamily
            key={family.id}
            name={family.name}
            atlases={ATLASES.filter((atlas) => atlas.family === family.id)}
            atlasId={atlasId}
            expanded={open.has(family.id)}
            onToggle={() => toggle(family.id)}
            onChoose={choose}
          />
        ))}
      </div>

      <p className="hint">
        Each map keeps its own selections, values, groups and merges. Switching away and
        back returns the map exactly as it was left.
      </p>
    </div>
  )
}
