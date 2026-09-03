/**
 * Colouring controls: how the map turns data into colour.
 *
 * Three mutually exclusive top-level modes, because a map can only answer one
 * question at a time. **Off** leaves every country its land colour. **Data** reads the
 * active layer's values. And **Compare** puts two groups against each other, reading
 * no values at all.
 *
 * Data then splits again, into the two ways a number can become a colour:
 *
 * - **Palette** — relative. A country's colour is its position between the lowest and
 *   the highest value on the map, so the scale moves when the data moves. Right for a
 *   quantity that means nothing on its own.
 * - **Predefined** — fixed. A country's colour is the published band its number falls
 *   in, and it does not depend on which countries are on screen. Right for an
 *   indicator that already has agreed thresholds.
 *
 * The split is a second row of chips rather than four entries in one row, because the
 * two questions are not siblings: "am I colouring by data or by group?" comes before
 * "which kind of data scale?", and flattening them would put Compare next to HDI.
 *
 * Every control is one operation, like the rest of the editor, so the assistant will
 * reach the same settings the same way.
 */
import { computeDomain, countValued } from '../state/colors'
import { useMapStore } from '../state/mapStore'
import { MapToggle } from './MapToggle'
import {
  PALETTE_FAMILIES,
  PALETTE_STEPS,
  paletteId,
  parsePaletteId,
  type PaletteFamilyId,
  type PaletteSteps,
} from '../state/palettes'
import { describeBand, getPreset, THRESHOLD_PRESETS } from '../state/presets'
import { CountryPicker } from './CountryPicker'
import { Inspector } from './Inspector'
import { FlagOverrideControls } from './FlagOverrideControls'
import { useRef, useState } from 'react'
import { SelectField } from './Select'
import { playSfx } from '../audio/sfx'

type ColorMode = 'none' | 'data' | 'comparison' | 'flags'
/** Which shape the data scale takes. Mirrors `ColorScale.mode`'s two numeric values. */
type DataScale = 'palette' | 'predefined'

export function DataPalette() {
  const doc = useMapStore((s) => s.doc)
  const dispatch = useMapStore((s) => s.dispatch)

  const layer = doc.layers.find((l) => l.id === doc.activeLayerId) ?? doc.layers[0]
  const key = layer?.dataKey ?? 'value'

  /*
   * Which visualisation is in force. Flags outrank the others because turning them on
   * is what suspends them — the layer's scale and the comparison keep their settings
   * underneath, ready to resume.
   */
  const mode: ColorMode = doc.flags.enabled
    ? 'flags'
    : doc.comparison.enabled
      ? 'comparison'
      : layer?.colorScale.mode === 'numeric' || layer?.colorScale.mode === 'threshold'
        ? 'data'
        : 'none'

  const scale: DataScale = layer?.colorScale.mode === 'threshold' ? 'predefined' : 'palette'

  /**
   * All three settings move together, so the four modes stay exclusive.
   *
   * Nothing is deleted on the way out. Switching to Flags writes `none` to the
   * layer's scale and turns the comparison off, but every stored value, group, side
   * assignment and palette choice is left exactly where it was — coming back to Data
   * restores the scale that was in use, because the panel remembers which one it was.
   */
  const setMode = (next: ColorMode) => {
    if (next === mode) return
    const scaleMode = next === 'data' ? (scale === 'predefined' ? 'threshold' : 'numeric') : 'none'
    dispatch([
      {
        op: 'set_layer',
        layerId: layer.id,
        patch: { colorScale: { ...layer.colorScale, mode: scaleMode } },
      },
      { op: 'set_comparison', patch: { enabled: next === 'comparison' } },
      { op: 'set_flags', patch: { enabled: next === 'flags' } },
    ])
    playSfx('click')
  }

  /** Switches which kind of scale reads the values. Never touches the values. */
  const setScale = (next: DataScale) => {
    if (next === scale) return
    dispatch({
      op: 'set_layer',
      layerId: layer.id,
      patch: {
        colorScale: { ...layer.colorScale, mode: next === 'predefined' ? 'threshold' : 'numeric' },
      },
    })
    playSfx('click')
  }

  return (
    <div className="stack">
      <div className="mode-switch mode-switch--quad" role="group" aria-label="Visualisation mode">
        {([
          ['none', 'Off'],
          ['data', 'Data'],
          ['comparison', 'Compare'],
          ['flags', 'Flags'],
        ] as [ColorMode, string][]).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`chip${mode === id ? ' chip--active' : ''}`}
            aria-pressed={mode === id}
            onClick={() => setMode(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === 'data' && (
        <>
          <div className="mode-switch mode-switch--pair" role="group" aria-label="Data scale">
            {([
              ['palette', 'Palette'],
              ['predefined', 'Predefined'],
            ] as [DataScale, string][]).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`chip${scale === id ? ' chip--active' : ''}`}
                aria-pressed={scale === id}
                onClick={() => setScale(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {scale === 'palette' ? <PaletteControls dataKey={key} /> : <PresetControls dataKey={key} />}

          {/*
            The selection, under the scale it feeds.

            Both scales colour countries by a value the author types, so picking the
            countries and setting their number is one task; it used to be split across
            two sidebar sections, which meant opening one panel to see what was selected
            and another to give it a value.

            Only in this mode. Comparison assigns countries to groups and flags reads no
            values at all — each has its own workflow for what a selection means, and
            neither wants a value editor.
          */}
          <hr className="rule" />
          {/*
            Bounded, so a large selection scrolls here instead of pushing everything
            below it — the Merge panel in particular — down the section.
          */}
          <div className="selection-scroll">
            <Inspector />
          </div>
        </>
      )}

      {mode === 'comparison' && <ComparisonControls />}

      {mode === 'flags' && (
        <>
          <p className="hint">
            Each country shows its own flag. Data colouring is paused while this is on —
            your values, groups and palette are kept and come back when you switch to
            Data or Compare.
          </p>
          {/*
            Shown with the mode it belongs to rather than in the settings panel, because
            it is only meaningful while flags are on. It governs the maritime layer and
            nothing else: the flags on land stay exactly as they are either way.
          */}
          <div className="toggles">
            <MapToggle
              icon="lakes"
              label="Island Water Coverage"
              checked={doc.flags.islandWater}
              onChange={(islandWater) =>
                dispatch({ op: 'set_flags', patch: { islandWater } })
              }
            />
            <MapToggle
              icon="borders"
              label="International Borders"
              checked={doc.flags.internationalBorders}
              onChange={(internationalBorders) =>
                dispatch({ op: 'set_flags', patch: { internationalBorders } })
              }
            />
            {/*
              An override over the mode, not a change to it: every country keeps the flag
              it has, and switching this off returns the map to what it was drawing a
              moment before.
            */}
            <MapToggle
              icon="globe"
              label="World Domination"
              checked={doc.flags.worldDomination}
              onChange={(worldDomination) =>
                dispatch({ op: 'set_flags', patch: { worldDomination } })
              }
            />
          </div>

          {/*
            The chooser appears with the override and nowhere else — a country to plant
            over the world is a meaningless thing to pick while every country keeps its
            own flag.

            The previous choice is kept when the toggle goes off, so flicking it back on
            returns to the same flag rather than an empty field.
          */}
          {doc.flags.worldDomination && (
            <>
              <CountryPicker
                label="Choose flag"
                value={doc.flags.dominationCountryId}
                onChange={(dominationCountryId) =>
                  dispatch({ op: 'set_flags', patch: { dominationCountryId } })
                }
              />
              <p className="hint">
                {doc.flags.dominationCountryId
                  ? 'This flag covers the whole map. Turn the switch off to restore each country’s own.'
                  : 'Pick a country and its flag takes the entire world.'}
              </p>
            </>
          )}

          {/*
            The selection, and what it flies.

            The same country panel the Data section shows, so selecting a country in
            Flags mode reports the same information it does everywhere else — with the
            one control that is specific to this mode underneath it.
          */}
          <hr className="rule" />
          <div className="selection-scroll">
            <Inspector />
          </div>
          <FlagOverrideControls />
        </>
      )}

    </div>
  )
}

/**
 * The relative scale: a ramp, a resolution, and what the ramp is stretched over.
 *
 * The family is a dropdown rather than a row of chips because there are four of them
 * now and the panel is 244 px wide — four chips plus two step chips wraps into three
 * ragged rows, and a `<select>` is one line that names the current choice. The step
 * count stays a pair of chips: two options, always both worth seeing.
 */
function PaletteControls({ dataKey }: { dataKey: string }) {
  const doc = useMapStore((s) => s.doc)
  const dispatch = useMapStore((s) => s.dispatch)

  const palette = doc.palettes.find((p) => p.id === doc.activePaletteId)
  const chosen = parsePaletteId(doc.activePaletteId) ?? {
    family: 'blue' as PaletteFamilyId,
    steps: 6 as PaletteSteps,
  }

  /*
   * How much data there is to colour, read through the same two functions the
   * renderer uses, over the whole document. A second copy of "which values count"
   * here is a second answer waiting to disagree with the map, and the panel that
   * explains the scale is the last place that can afford one.
   */
  const valued = countValued(doc.countries, dataKey)
  const domain = computeDomain(doc.countries, dataKey)

  return (
    <>
      <SelectField
        label="Palette"
        value={chosen.family}
        onChange={(family) => {
          dispatch({
            op: 'set_active_palette',
            paletteId: paletteId(family as PaletteFamilyId, chosen.steps),
          })
          playSfx('click')
        }}
      >
        {PALETTE_FAMILIES.map((family) => (
          <option key={family.id} value={family.id}>
            {family.name}
          </option>
        ))}
      </SelectField>

      <div className="field">
        <span className="field__label">Steps</span>
        <div className="mode-switch mode-switch--pair">
          {PALETTE_STEPS.map((steps) => (
            <button
              key={steps}
              type="button"
              className={`chip${chosen.steps === steps ? ' chip--active' : ''}`}
              aria-pressed={chosen.steps === steps}
              onClick={() => {
                dispatch({ op: 'set_active_palette', paletteId: paletteId(chosen.family, steps) })
                playSfx('click')
              }}
            >
              {steps}
            </button>
          ))}
        </div>
      </div>

      {/* The ramp itself, low on the left. Nothing explains a palette like it. */}
      <div className="ramp" aria-hidden="true">
        {palette?.colors.map((color, i) => (
          <span key={i} style={{ background: color }} />
        ))}
      </div>

      {/*
        What the ramp is stretched over. Stating the domain is the difference between
        "why is Germany pale?" and "Germany is near the bottom of 40–90": the colours
        mean a country's position between the lowest and highest value on the map, not
        the number itself, so the two ends have to be on screen.
      */}
      <p className="hint">
        {valued === 0 || !domain
          ? `No values yet. Select countries and set a “${dataKey}” value to colour them.`
          : `${valued} valued · ${domain[0]} → ${domain[1]} across ${
              palette?.colors.length ?? chosen.steps
            } steps, lightest to darkest. Every value is scaled against this range; countries without one keep the land colour.`}
      </p>
    </>
  )
}

/**
 * The fixed scale: a preset and its bands.
 *
 * The legend is the control's explanation. A threshold scale's whole claim is that
 * the cut-offs come from somewhere real, so the bands and their ranges are shown
 * rather than described, and the source is named underneath — otherwise "Predefined"
 * is just a word and the reader has no way to tell these thresholds from invented
 * ones.
 */
function PresetControls({ dataKey }: { dataKey: string }) {
  const doc = useMapStore((s) => s.doc)
  const dispatch = useMapStore((s) => s.dispatch)

  const preset = getPreset(doc.activePresetId) ?? THRESHOLD_PRESETS[0]
  const valued = countValued(doc.countries, dataKey)

  return (
    <>
      <SelectField
        label="Preset"
        value={preset.id}
        onChange={(presetId) => {
          dispatch({ op: 'set_active_preset', presetId })
          playSfx('click')
        }}
      >
        {THRESHOLD_PRESETS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </SelectField>

      <ul className="bands">
        {preset.bands.map((band) => (
          <li key={band.label} className="band">
            <span className="band__swatch" style={{ background: band.color }} aria-hidden="true" />
            <span className="band__label">{band.label}</span>
            <span className="band__range">{describeBand(band, preset.unit)}</span>
          </li>
        ))}
      </ul>

      <p className="hint">
        {preset.description}. Thresholds are fixed — {preset.source}. {valued} valued;
        a country’s band does not change when other countries do, so a map of only
        high scorers stays all-high instead of being stretched across the whole scale.
        Countries without a value keep the land colour.
      </p>
    </>
  )
}

/**
 * Compare mode, whole.
 *
 * Everything the mode needs is here: how many groups there are, what colour each one
 * is, which countries are in it, and which one the next selection will go to. It owns
 * its groups outright rather than borrowing the document's `MapGroup` collection, which
 * is what the previous version did and what made it confusing — countries had to be
 * gathered in one panel, then mapped onto an A/B side in another, and neither panel
 * said what the other was for.
 *
 * The workflow is one sentence: choose a group, select countries on the map, add them.
 * The active group is named in the action itself, so the question "where is this going?"
 * is answered by the button the author is about to press.
 *
 * Selection is the map's own — tapping entities, the existing outlines. Nothing here
 * selects anything; it only reads what is selected and writes it into a group.
 */
function ComparisonControls() {
  const doc = useMapStore((s) => s.doc)
  const dispatch = useMapStore((s) => s.dispatch)
  const selected = useMapStore((s) => s.selectedCountryIds)
  const clearSelection = useMapStore((s) => s.clearSelection)
  const { comparison } = doc

  /** Which group the next assignment writes to. A pointer, not authored content. */
  const [activeIndex, setActiveIndex] = useState(0)
  /** The group whose name is being edited, and the text so far. */
  const [renaming, setRenaming] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  /*
   * Set by Escape so the blur that follows does not save what Escape just discarded.
   * A ref rather than state because the blur handler has to read it in the same tick.
   */
  const cancelled = useRef(false)

  /**
   * Ends the edit, saving unless Escape asked otherwise.
   *
   * The name is written once, here — not on every keystroke — so a rename is one
   * operation and one undo step whatever its length. An empty or unchanged name saves
   * nothing: a group always has a name, and there is no step to undo if nothing moved.
   */
  const commitRename = (index: number) => {
    if (cancelled.current) {
      cancelled.current = false
      setRenaming(null)
      return
    }
    const name = draft.trim()
    if (name && name !== comparison.groups[index]?.name) {
      dispatch({ op: 'set_comparison_group', index, patch: { name } })
    }
    setRenaming(null)
  }

  const groups = comparison.groups.slice(0, comparison.groupCount)
  // Lowering the count can leave the pointer past the end; fall back to the first.
  const active = Math.min(activeIndex, comparison.groupCount - 1)

  const setCount = (groupCount: number) => {
    dispatch({ op: 'set_comparison', patch: { groupCount } })
    if (activeIndex > groupCount - 1) setActiveIndex(0)
    playSfx('tick')
  }

  return (
    <>
      <p className="field__label">How many groups?</p>
      <div className="mode-switch mode-switch--sextet" role="group" aria-label="Comparison groups">
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <button
            key={n}
            type="button"
            className={`chip${comparison.groupCount === n ? ' chip--active' : ''}`}
            aria-pressed={comparison.groupCount === n}
            onClick={() => setCount(n)}
          >
            {n}
          </button>
        ))}
      </div>

      <ul className="groups">
        {groups.map((group, index) => {
          const isActive = index === active
          return (
            <li key={group.id}>
              <div className={`compare-group${isActive ? ' compare-group--active' : ''}`}>
                {renaming === index ? (
                  /*
                    The whole row becomes the editor rather than the name alone: a text
                    input cannot live inside a button, and swapping the button out keeps
                    the markup valid without moving anything — same class, same metrics,
                    so the panel does not change size while a name is being typed.
                  */
                  <span className="compare-group__pick compare-group__pick--editing">
                    <span className="compare-group__dot" style={{ background: group.color }} />
                    <input
                      className="compare-group__rename"
                      type="text"
                      value={draft}
                      aria-label={`Rename ${group.name}`}
                      autoFocus
                      onFocus={(e) => e.currentTarget.select()}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => commitRename(index)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          commitRename(index)
                        } else if (e.key === 'Escape') {
                          e.preventDefault()
                          cancelled.current = true
                          setRenaming(null)
                        }
                      }}
                    />
                  </span>
                ) : (
                  <button
                    type="button"
                    className="compare-group__pick"
                    aria-pressed={isActive}
                    onClick={() => {
                      setActiveIndex(index)
                      playSfx('tick')
                    }}
                  >
                    {/*
                      The swatch is a label on the button, not a control inside it — the
                      colour input beside it is the control. Nesting one in the other
                      would make picking a colour also change which group is active.
                    */}
                    <span className="compare-group__dot" style={{ background: group.color }} />
                    <span
                      className="compare-group__name"
                      title="Double-click to rename"
                      onDoubleClick={(e) => {
                        // The row's own click still runs and makes this group active,
                        // which is what a double-click on it would have done anyway.
                        e.stopPropagation()
                        setDraft(group.name)
                        cancelled.current = false
                        setRenaming(index)
                      }}
                    >
                      {group.name}
                    </span>
                    {isActive && <span className="compare-group__state">ACTIVE</span>}
                    <span className="group-row__count">{group.members.length}</span>
                  </button>
                )}
                <input
                  className="compare-group__color"
                  type="color"
                  value={group.color}
                  aria-label={`${group.name} colour`}
                  onChange={(e) =>
                    dispatch({
                      op: 'set_comparison_group',
                      index,
                      patch: { color: e.target.value },
                    })
                  }
                />
              </div>

              {/*
                Membership, as codes and nothing else.

                A readout rather than a second way to pick countries: the map is where
                countries are chosen, and anything more here — names, regions, values, a
                control per row — would compete with the group's own controls for a job
                the map already does. Codes wrap, so a group of thirty costs a couple of
                lines rather than thirty, and adding countries barely changes the height
                of the panel.
              */}
              {group.members.length > 0 && (
                <ul className="compare-members" aria-label={`${group.name} members`}>
                  {group.members.map((id) => (
                    <li key={id} className="compare-members__item">
                      {id}
                    </li>
                  ))}
                </ul>
              )}

              {/*
                The actions belong to the group they write to, so they sit under it
                rather than in a shared block whose target has to be inferred. Only the
                active group carries them: four copies of the same pair would be noise,
                and which group is active is the one thing this panel already states.
              */}
              {isActive && (
                <div className="compare-group__actions">
                  <button
                    type="button"
                    className="btn"
                    disabled={selected.length === 0}
                    onClick={() => {
                      // The whole selection in one operation, so twelve countries are
                      // one undo step rather than twelve.
                      dispatch({ op: 'add_to_comparison', index, countryIds: selected })
                      clearSelection()
                      playSfx('confirm')
                    }}
                  >
                    {selected.length > 0 ? `Add ${selected.length} selected` : 'Add selected'}
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    disabled={selected.length === 0}
                    onClick={() => {
                      dispatch({ op: 'remove_from_comparison', index, countryIds: selected })
                      playSfx('click')
                    }}
                  >
                    Remove selected
                  </button>
                </div>
              )}

            </li>
          )
        })}
      </ul>

      <p className="hint">
        {selected.length === 0
          ? 'Pick a group, then tap countries on the map to add them.'
          : 'Countries in no group stay neutral. Where a country is in more than one, the first group wins.'}
      </p>
    </>
  )
}
