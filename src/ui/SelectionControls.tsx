/**
 * The Selection panel: two ways to select many territories at once, on every map — countries,
 * subdivisions or states, in the map's own words (`Atlas.noun`).
 *
 * Both add to the ordinary selection — the one a click builds and the inspector, the
 * palette and merging read — so everything that works on a selection works on theirs. The
 * gestures themselves live on the map; see `selectionGestures.ts`.
 *
 * The switches are session state in the store rather than document content: which tool is in
 * hand is a fact about how the author is working, not about the map, so it is not undoable,
 * not saved and not exported.
 */
import { useMapStore } from '../state/mapStore'
import { nounFor } from '../maps/useNoun'
import { MapToggle } from './MapToggle'
import { RegionGroupPicker } from './RegionGroupPicker'
import { playSfx } from '../audio/sfx'

export function SelectionControls() {
  const tools = useMapStore((s) => s.selectionTools)
  const setSelectionTool = useMapStore((s) => s.setSelectionTool)
  const count = useMapStore((s) => s.selectedCountryIds.length)
  const clearSelection = useMapStore((s) => s.clearSelection)
  const noun = nounFor(useMapStore((s) => s.doc.scope))

  return (
    <div className="stack">
      <div className="toggles">
        <MapToggle
          icon="rectangle"
          label="Rectangle selection"
          checked={tools.rectangle}
          onChange={(on) => setSelectionTool('rectangle', on)}
        />
        <MapToggle
          icon="brush"
          label="Brush mode"
          checked={tools.brush}
          onChange={(on) => setSelectionTool('brush', on)}
        />
      </div>
      <p className="hint">
        <strong>Rectangle</strong>: hold the middle mouse button and drag across the map. Every{' '}
        {noun.one} the box touches is added to the selection when you let go.
      </p>
      <p className="hint">
        <strong>Brush</strong>: hold the left button, or a finger, and drag. Every {noun.one} you
        pass over is added as you go. While it is on, dragging paints instead of panning; the
        wheel, the zoom buttons and a two-finger pinch still move the map.
      </p>
      {/* A whole region in one go — Catalonia, Transylvania — on a map of subdivisions. */}
      <RegionGroupPicker />
      <div className="selection-summary">
        <span>
          {count} {count === 1 ? noun.one : noun.many} selected
        </span>
        <button
          type="button"
          className="btn btn--ghost"
          disabled={count === 0}
          onClick={() => {
            clearSelection()
            playSfx('click')
          }}
        >
          Clear
        </button>
      </div>
    </div>
  )
}
