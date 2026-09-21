/**
 * The Select section: which tool a drag on the map uses, and what is selected.
 *
 * The tools add to the ordinary selection — the one a click builds and the inspector, the
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
import { Disclosure } from './Panels'

export function SelectionControls() {
  const tools = useMapStore((s) => s.selectionTools)
  const setSelectionTool = useMapStore((s) => s.setSelectionTool)
  /*
   * Every kind of entity the editor can select — countries, subdivisions, territories, merged
   * groups (all in `selectedCountryIds`) and water regions (in their own list) — which is why the
   * count is of *entities*: a count of "countries" read wrong the moment a sea or a province was
   * in it.
   */
  const count = useMapStore((s) => s.selectedCountryIds.length + s.selectedWaterIds.length)
  const clearSelection = useMapStore((s) => s.clearSelection)
  const noun = nounFor(useMapStore((s) => s.doc.scope))

  /*
   * Normal selection is what a click always does, with either tool on or off: a click selects,
   * a second click deselects. What it means as a *tool* is that a drag pans the map and nothing
   * else is armed — so choosing it turns the two others off, and it shows as chosen whenever
   * neither of them is on. It changes nothing a click does.
   */
  const normal = !tools.rectangle && !tools.brush

  return (
    <div className="stack">
      <div className="toggles">
        <MapToggle
          icon="pointer"
          label="Normal Selection"
          checked={normal}
          onChange={() => {
            setSelectionTool('rectangle', false)
            setSelectionTool('brush', false)
          }}
        />
        <MapToggle
          icon="rectangle"
          label="Rectangle Selection"
          checked={tools.rectangle}
          onChange={(on) => setSelectionTool('rectangle', on)}
        />
        <MapToggle
          icon="brush"
          label="Brush Mode"
          checked={tools.brush}
          onChange={(on) => setSelectionTool('brush', on)}
        />
      </div>

      {/*
        How each tool is used, folded away: the three paragraphs are worth reading once and
        then only take room from the controls, so they are one tap away rather than always
        on screen.
      */}
      <Disclosure title="How the tools work">
        <div className="stack">
          <p className="hint">
            <strong>Normal</strong>: click or tap to select; click a selected {noun.one} again to
            deselect it. Shift-click works the same way. Dragging moves the map.
          </p>
          <p className="hint">
            <strong>Rectangle</strong>: hold the middle mouse button and drag across the map.
            Every {noun.one} the box touches is added to the selection when you let go.
          </p>
          <p className="hint">
            <strong>Brush</strong>: hold the left button, or a finger, and drag. Every {noun.one}{' '}
            you pass over is added as you go. While it is on, dragging paints instead of panning;
            the wheel, the zoom buttons and a two-finger pinch still move the map.
          </p>
        </div>
      </Disclosure>

      {/* A whole region in one go — Catalonia, Transylvania — on a map of subdivisions. */}
      <RegionGroupPicker />

      <div className="selection-summary">
        <span>
          Entities Selected: <strong>{count}</strong>
        </span>
        <button
          type="button"
          className="btn btn--ghost"
          disabled={count === 0}
          onClick={() => {
            clearSelection()
          }}
        >
          Clear Selection
        </button>
      </div>
    </div>
  )
}
