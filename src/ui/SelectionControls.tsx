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
import { MenuButton, MenuItem } from './Menu'
import { RegionGroupPicker } from './RegionGroupPicker'

export function SelectionControls() {
  const tools = useMapStore((s) => s.selectionTools)
  /* Ctrl held on a desktop arms the brush for as long as it is held — see `heldBrush.ts`. */
  const brushHeld = useMapStore((s) => s.brushHeld)
  const brush = tools.brush || brushHeld
  const setSelectionTool = useMapStore((s) => s.setSelectionTool)
  /*
   * Every kind of entity the editor can select — countries, subdivisions, territories, merged
   * groups (all in `selectedCountryIds`) and water regions (in their own list) — which is why the
   * count is of *entities*: a count of "countries" read wrong the moment a sea or a province was
   * in it.
   */
  const count = useMapStore((s) => s.selectedCountryIds.length + s.selectedWaterIds.length)
  const clearSelection = useMapStore((s) => s.clearSelection)

  /*
   * Normal selection is what a click always does, with either tool on or off: a click selects,
   * a second click deselects. What it means as a *tool* is that a drag pans the map and nothing
   * else is armed — so choosing it turns the two others off, and it shows as chosen whenever
   * neither of them is on. It changes nothing a click does.
   */
  const normal = !tools.rectangle && !brush

  const toolName = normal ? 'Normal' : [tools.rectangle && 'Rectangle', brush && 'Brush'].filter(Boolean).join(' + ')

  return (
    <div className="stack">
      {/*
        The tool in hand, as one compact dropdown like the File menu's, rather than three
        switches and three paragraphs: each choice carries its one line of how it is used.
        Rectangle and Brush can both be on — the rectangle is the middle button, the brush the
        left — so those two tick on and off; Normal turns both off.
      */}
      <div className="field__row select-tool">
        <span className="field__label">Tool</span>
        <MenuButton value={toolName} title="Selection tool" className="select-tool__button">
          {(close) => (
            <div className="top-menu__group">
              <span className="top-menu__heading">Selection tool</span>
              <MenuItem
                name="Normal"
                active={normal}
                onChoose={() => {
                  setSelectionTool('rectangle', false)
                  setSelectionTool('brush', false)
                  close()
                }}
              />
              <MenuItem
                name="Rectangle"
                active={tools.rectangle}
                onChoose={() => {
                  setSelectionTool('rectangle', !tools.rectangle)
                  close()
                }}
              />
              <MenuItem
                name="Brush"
                active={brush}
                onChoose={() => {
                  setSelectionTool('brush', !brush)
                  close()
                }}
              />
            </div>
          )}
        </MenuButton>
      </div>

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
