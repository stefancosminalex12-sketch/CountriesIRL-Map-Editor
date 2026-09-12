/** Dataset, projection and rendering controls. Every change goes through an operation. */
import { datasetsForAtlas } from '../geo/datasets'
import { AUTO_PROJECTION_ID, PROJECTIONS } from '../geo/projections'
import { useMapStore } from '../state/mapStore'
import { playSfx } from '../audio/sfx'
import { MapToggle } from './MapToggle'
import { SelectField } from './Select'
import {
  CAPTION_OUTLINE,
  CAPTION_SIZE,
  CAPTION_WEIGHTS,
  LABEL_FONTS,
  LABEL_OUTLINE,
  LABEL_SIZE,
  type CountryLabels,
  type LabelFontId,
  type MapCaption,
  type MapStyle,
  type ProjectionId,
} from '../types/map'

/**
 * What the map is *of*: which data, drawn how, and what to do with everything outside
 * the chosen region.
 *
 * Split from the display switches and the colour wells below so the sidebar can file
 * them under different headings. Same hooks and the same operations — the only thing
 * that changed is which section each control appears in.
 */
export function MapScopeSettings() {
  const scope = useMapStore((s) => s.doc.scope)
  // Only the datasets belonging to the map that is open: offering the world's 110m
  // countries while a states map is on screen would be offering to break it.
  const datasets = datasetsForAtlas(scope.atlasId)
  const style = useMapStore((s) => s.doc.style)
  const dispatch = useMapStore((s) => s.dispatch)
  const setStyle = (patch: Partial<MapStyle>) => dispatch({ op: 'set_style', patch })

  /** Changing how the map is drawn gets a short click; colours stay silent. */
  const tick = () => playSfx('click')

  return (
    <div className="stack">
      <SelectField
        label="Dataset"
        value={scope.datasetId}
        onChange={(datasetId) => {
          dispatch({ op: 'set_scope_dataset', datasetId })
          tick()
        }}
      >
        {datasets.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name} · {d.detail}
          </option>
        ))}
      </SelectField>

      <SelectField
        label="Projection"
        value={scope.projectionId}
        onChange={(value) => {
          dispatch({
            op: 'set_scope_projection',
            projectionId: value as ProjectionId | 'auto',
          })
          tick()
        }}
      >
        <option value="auto">
          Auto ({PROJECTIONS.find((p) => p.id === AUTO_PROJECTION_ID)?.name ?? 'Albers'})
        </option>
        {PROJECTIONS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </SelectField>

      <SelectField
        label="Outside the region"
        value={style.outsideScope}
        onChange={(value) => {
          setStyle({ outsideScope: value as MapStyle['outsideScope'] })
          tick()
        }}
      >
        <option value="muted">Muted</option>
        <option value="hidden">Hidden</option>
        <option value="normal">Same as in-region</option>
      </SelectField>
    </div>
  )
}

/**
 * The layers the map draws, as switches.
 *
 * The first four go through the same `set_style` operation as the rest of the panel;
 * the legend's visibility lives on the legend rather than the style, because that is
 * where every other thing about the legend already lives and splitting it across two
 * places would mean two opinions about one component.
 */
/**
 * Taking territories off the map without taking them out of the document.
 *
 * An action on the current selection rather than a switch, which is why it is a pair of
 * buttons and not another tile in the grid above: the grid answers "does the map draw
 * this layer", and this answers "does the map draw *these*".
 *
 * Hidden is not deleted, and the difference is the whole point. A hidden country keeps
 * its geometry, its id, its value, its group, its flag and any merge it belongs to; it
 * simply is not painted. So "the world without France" is one button, and the world with
 * France is the other one — and in between, France is still a country every other part
 * of the editor can work with.
 */
function HideTerritories() {
  const dispatch = useMapStore((s) => s.dispatch)
  const selected = useMapStore((s) => s.selectedCountryIds)
  const countries = useMapStore((s) => s.doc.countries)

  const hiddenIds = Object.entries(countries)
    .filter(([, entry]) => entry?.hidden)
    .map(([id]) => id)

  /*
   * What the button does depends on what is selected, because the alternative — one
   * button that hides and a separate one that shows — makes the reader work out which
   * applies. If everything selected is already hidden, the obvious next act is to bring
   * it back.
   */
  const allHidden = selected.length > 0 && selected.every((id) => countries[id]?.hidden)

  const apply = (ids: string[], hidden: boolean) => {
    if (ids.length === 0) return
    playSfx('click')
    dispatch({ op: 'set_countries_hidden', countryIds: ids, hidden })
  }

  return (
    <div className="sidebar__group">
      <div className="field__label">Hide territories</div>
      <p className="hint">
        Takes the selected territories off the map. They keep their data and come back
        exactly as they were.
      </p>
      <div className="merge-actions">
        <button
          type="button"
          className="btn"
          disabled={selected.length === 0}
          onClick={() => apply([...selected], !allHidden)}
        >
          {allHidden ? 'Show' : 'Hide'}
          {selected.length > 1 ? ` ${selected.length}` : ''}
          {selected.length === 0 ? ' selected' : ''}
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          disabled={hiddenIds.length === 0}
          onClick={() => apply(hiddenIds, false)}
        >
          Show all{hiddenIds.length > 0 ? ` (${hiddenIds.length})` : ''}
        </button>
      </div>
    </div>
  )
}

export function MapDisplayToggles() {
  const style = useMapStore((s) => s.doc.style)
  const legendVisible = useMapStore((s) => s.doc.legend.visible)
  const labels = useMapStore((s) => s.doc.labels)
  const caption = useMapStore((s) => s.doc.caption)
  const dispatch = useMapStore((s) => s.dispatch)
  const setStyle = (patch: Partial<MapStyle>) => dispatch({ op: 'set_style', patch })

  // `MapToggle` owns the sound, so all five behave alike.
  return (
    <div className="stack">
      <div className="toggles">
        <MapToggle
          icon="borders"
          label="Borders"
          checked={style.showBorders}
          onChange={(showBorders) => setStyle({ showBorders })}
        />
        {/*
          The coast, and only the coast. Borders and Coastlines are independent layers,
          and the coast is stroked the same way whichever of them is on — see
          `showCoastlines`.
        */}
        <MapToggle
          icon="coastline"
          label="Coastlines"
          checked={style.showCoastlines}
          onChange={(showCoastlines) => setStyle({ showCoastlines })}
        />
        <MapToggle
          icon="lakes"
          label="Lakes"
          checked={style.showLakes}
          onChange={(showLakes) => setStyle({ showLakes })}
        />
        {/*
          Rivers, beside the lakes because they are the same kind of thing: a geographic
          water layer that belongs to no country. Its own switch rather than sharing the
          lakes' one, so either can be drawn without the other.
        */}
        <MapToggle
          icon="rivers"
          label="Rivers"
          checked={style.showRivers}
          onChange={(showRivers) => setStyle({ showRivers })}
        />
        <MapToggle
          icon="graticule"
          label="Graticule"
          checked={style.showGraticule}
          onChange={(showGraticule) => setStyle({ showGraticule })}
        />
        <MapToggle
          icon="globe"
          label="Globe outline"
          checked={style.showSphere}
          onChange={(showSphere) => setStyle({ showSphere })}
        />
        {/*
          Visibility only. What the legend *says* follows the colouring mode and is
          derived in `buildLegendModel`; this decides whether any of it is drawn, so
          switching modes never needs the toggle touched.
        */}
        <MapToggle
          icon="legend"
          label="Legend"
          checked={legendVisible}
          onChange={(visible) => dispatch({ op: 'set_legend', patch: { visible } })}
        />
        {/*
          Names on the territories. A layer switch like the five above it, in the same
          grid, because that is what it is — what it draws is decided by the map's own
          entities, so there is nothing to choose before turning it on.
        */}
        <MapToggle
          icon="names"
          label="Country Names"
          checked={labels.enabled}
          onChange={(enabled) => dispatch({ op: 'set_labels', patch: { enabled } })}
        />
        {/*
          A headline for the picture. In this grid with the other layers because that is
          what it is — something the map draws or does not draw — even though what it
          says comes from the author rather than from the geography.
        */}
        <MapToggle
          icon="caption"
          label="Top Caption"
          checked={caption.enabled}
          onChange={(enabled) => dispatch({ op: 'set_caption', patch: { enabled } })}
        />
      </div>

      {/*
        The appearance controls, and only while there is something to apply them to.

        Under the switch rather than in a section of their own: they are one feature's
        settings, they are meaningless with the feature off, and five controls that
        appear when a switch is turned on ask nothing of anyone who leaves it alone.
      */}
      {labels.enabled && <CountryNameStyle labels={labels} />}

      <HideTerritories />
      {caption.enabled && <TopCaptionStyle caption={caption} />}
    </div>
  )
}

/**
 * The caption's own text and how it is set.
 *
 * Appears with the switch, like the country names' controls above it, and for the same
 * reason: five fields that mean nothing while the feature is off are five fields an
 * author who leaves it off never has to read past.
 */
function TopCaptionStyle({ caption }: { caption: MapCaption }) {
  const dispatch = useMapStore((s) => s.dispatch)
  const set = (patch: Partial<MapCaption>) => dispatch({ op: 'set_caption', patch })

  return (
    <div className="stack">
      <label className="field">
        <span className="field__label">Caption</span>
        <input
          className="input"
          type="text"
          value={caption.text}
          placeholder="Type a caption…"
          aria-label="Caption text"
          onChange={(event) => set({ text: event.target.value })}
        />
      </label>

      <div className="swatches">
        <label className="swatch">
          <input
            type="color"
            value={caption.color}
            onChange={(e) => set({ color: e.target.value })}
          />
          <span>Text</span>
        </label>
        <label className="swatch">
          <input
            type="color"
            value={caption.outlineColor}
            onChange={(e) => set({ outlineColor: e.target.value })}
          />
          <span>Outline</span>
        </label>
      </div>

      <SelectField
        label="Font"
        value={caption.font}
        onChange={(value) => {
          set({ font: value as LabelFontId })
          playSfx('click')
        }}
      >
        {LABEL_FONTS.map((font) => (
          <option key={font.id} value={font.id}>
            {font.name}
          </option>
        ))}
      </SelectField>

      <SelectField
        label="Weight"
        value={String(caption.weight)}
        onChange={(value) => {
          set({ weight: Number(value) })
          playSfx('click')
        }}
      >
        {CAPTION_WEIGHTS.map((weight) => (
          <option key={weight.value} value={String(weight.value)}>
            {weight.name}
          </option>
        ))}
      </SelectField>

      {/*
        A size in canvas pixels rather than a multiplier: the caption is not fitted to
        any shape, so there is nothing for a multiplier to be relative to.
      */}
      <PixelField
        label="Size"
        value={caption.size}
        range={CAPTION_SIZE}
        onChange={(size) => set({ size })}
      />
      <ScaleField
        label="Outline width"
        value={caption.outlineWidth}
        range={CAPTION_OUTLINE}
        onChange={(outlineWidth) => set({ outlineWidth })}
      />
    </div>
  )
}

/** A slider over an absolute size, shown in the pixels it is. */
function PixelField({
  label,
  value,
  range,
  onChange,
}: {
  label: string
  value: number
  range: { min: number; max: number; step: number }
  onChange: (next: number) => void
}) {
  return (
    <label className="field">
      <span className="field__row">
        <span className="field__label">{label}</span>
        <span className="field__value">{Math.round(value)}px</span>
      </span>
      <input
        className="slider"
        type="range"
        min={range.min}
        max={range.max}
        step={range.step}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  )
}

/**
 * How the names look: two colours, a face, a size and an outline.
 *
 * None of these decides *where* a name goes or how big it is relative to its country —
 * that comes from the projected geometry, and Size is a multiplier over it rather than
 * an absolute. Which is why dragging any of them is cheap: the renderer's placement
 * memo does not read this object at all, so nothing here recomputes any geometry.
 */
function CountryNameStyle({ labels }: { labels: CountryLabels }) {
  const dispatch = useMapStore((s) => s.dispatch)
  const set = (patch: Partial<CountryLabels>) => dispatch({ op: 'set_labels', patch })

  return (
    <div className="stack">
      <div className="swatches">
        <label className="swatch">
          <input
            type="color"
            value={labels.color}
            onChange={(e) => set({ color: e.target.value })}
          />
          <span>Text</span>
        </label>
        <label className="swatch">
          <input
            type="color"
            value={labels.outlineColor}
            onChange={(e) => set({ outlineColor: e.target.value })}
          />
          <span>Outline</span>
        </label>
      </div>

      <SelectField
        label="Font"
        value={labels.font}
        onChange={(value) => {
          set({ font: value as LabelFontId })
          playSfx('click')
        }}
      >
        {LABEL_FONTS.map((font) => (
          <option key={font.id} value={font.id}>
            {font.name}
          </option>
        ))}
      </SelectField>

      {/*
        A scale, not a size in pixels. Every name is already fitted to the country it
        sits on, so one number that moves all of them together keeps that relationship
        — a map where every name is 14px is a map where Russia is captioned and Belgium
        is buried.
      */}
      <ScaleField
        label="Font size"
        value={labels.size}
        range={LABEL_SIZE}
        onChange={(size) => set({ size })}
      />
      <ScaleField
        label="Outline thickness"
        value={labels.outlineWidth}
        range={LABEL_OUTLINE}
        onChange={(outlineWidth) => set({ outlineWidth })}
      />
    </div>
  )
}

/** A slider over a proportion, showing it as the percentage it is. */
function ScaleField({
  label,
  value,
  range,
  onChange,
}: {
  label: string
  value: number
  range: { min: number; max: number; step: number }
  onChange: (next: number) => void
}) {
  const percent = Math.round(value * 100)
  return (
    <label className="field">
      <span className="field__row">
        <span className="field__label">{label}</span>
        <span className="field__value">{percent}%</span>
      </span>
      <input
        className="slider"
        type="range"
        min={range.min}
        max={range.max}
        step={range.step}
        value={value}
        aria-label={label}
        aria-valuetext={`${percent} percent`}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  )
}

/**
 * The base map's three colours: the water, the land and the boundaries.
 *
 * Base appearance, which means they rank below anything a visualisation mode decided —
 * a palette fill, a comparison group, a flag. See `resolveCountryFill` and
 * `resolveBorderInk`.
 */
export function MapColorSwatches() {
  const style = useMapStore((s) => s.doc.style)
  const dispatch = useMapStore((s) => s.dispatch)
  const setStyle = (patch: Partial<MapStyle>) => dispatch({ op: 'set_style', patch })

  /*
   * The label wraps the input, so the caption and the surround open the picker as well
   * as the well itself — and the container carries the focus ring, so the native input
   * never has to draw one of its own.
   */
  return (
      <div className="swatches">
        <label className="swatch">
          <input
            type="color"
            value={style.background}
            onChange={(e) => setStyle({ background: e.target.value })}
          />
          <span>Background</span>
        </label>
        <label className="swatch">
          <input type="color" value={style.land} onChange={(e) => setStyle({ land: e.target.value })} />
          <span>Land</span>
        </label>
        <label className="swatch">
          <input
            type="color"
            value={style.border}
            onChange={(e) => setStyle({ border: e.target.value })}
          />
          <span>Border</span>
        </label>
      </div>
  )
}
