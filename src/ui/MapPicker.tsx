/**
 * Choosing which map the editor is working on.
 *
 * A list rather than a row of chips, because this is the one control whose options grow
 * without bound — countries, US states, Canadian provinces, European regions, counties,
 * historical maps — and a control that has to stay usable at forty entries cannot be a
 * grid of buttons. It scrolls in place inside the section rather than pushing everything
 * below it down the panel.
 *
 * Switching parks the current map's work and restores the target's; see `setAtlas` in
 * `mapStore`. Nothing here knows how that is done, which is the point: this component
 * lists atlases and names one.
 */
import { useMapStore } from '../state/mapStore'
import { playSfx } from '../audio/sfx'
import { ATLASES } from '../maps/atlas'

export function MapPicker() {
  const atlasId = useMapStore((s) => s.doc.scope.atlasId)
  const setAtlas = useMapStore((s) => s.setAtlas)

  return (
    <div className="stack">
      <div className="map-list" role="listbox" aria-label="Map">
        {ATLASES.map((atlas) => {
          const active = atlas.id === atlasId
          return (
            <button
              key={atlas.id}
              type="button"
              role="option"
              aria-selected={active}
              className={`map-list__item${active ? ' map-list__item--on' : ''}`}
              onClick={() => {
                if (active) return
                setAtlas(atlas.id)
                playSfx('confirm')
              }}
            >
              <span className="map-list__name">{atlas.name}</span>
              <span className="map-list__note">
                {atlas.noun.many.replace(/^./, (c) => c.toUpperCase())}
                {atlas.insets.length > 0
                  ? ` · ${atlas.insets.map((i) => i.name).join(' and ')} inset`
                  : ''}
              </span>
            </button>
          )
        })}
      </div>

      <p className="hint">
        Each map keeps its own selections, values, groups and merges. Switching away and
        back returns the map exactly as it was left.
      </p>
    </div>
  )
}
