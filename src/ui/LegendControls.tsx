/**
 * The legend's editing controls.
 *
 * Five elements, each with its own size: the title, its preset shortcuts, the subtitle,
 * a free line of text, and an icon. Then the panel's own width and height. Every
 * control writes one field of `doc.legend`, and `coalesceKey` gives every `set_legend`
 * the same key, so dragging a slider across forty steps is one history entry rather
 * than forty.
 *
 * The title's preset list is a shortcut, not a mode: picking one writes its text into
 * the field and stops there — no flag is stored and nothing reads the list back, so
 * "GDP per Capita" becomes "GDP per Capita (USD)" by typing or gets replaced outright.
 * Which is why the selector shows "Custom" by deriving whether the current title
 * happens to match a preset rather than tracking it; a stored "is custom" flag would be
 * a second opinion about the same fact, and the two would drift.
 *
 * An empty title is not missing — it means "describe yourself", and the legend falls
 * back to the active mode's own name. That fallback is the field's placeholder, so the
 * author can see what they are overriding before they override it.
 */
import { buildLegendModel, defaultLegendTitle, LEGEND_WIDTH, TITLE_PRESETS } from '../state/legend'
import { useMapStore } from '../state/mapStore'
import { SelectField } from './Select'
import { LEGEND_STYLES, LEGEND_STYLE_IDS } from '../state/legendStyles'
import { LEGEND_ICON_IDS, LEGEND_ICONS } from '../state/legendIcons'
import { naturalLegendSize } from '../state/legendLayout'
import { playSfx } from '../audio/sfx'
import {
  LEGEND_ELEMENT_SIZE,
  LEGEND_MAX_SIZE,
  LEGEND_MIN_SIZE,
  type LegendElementSizes,
} from '../types/map'

/** Sentinel for the selector's "not one of the presets" row. */
const CUSTOM = ''

/** Sentinel for "no icon". A select cannot carry `null`, so the empty string stands in. */
const NO_ICON = ''

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

export function LegendControls() {
  const doc = useMapStore((s) => s.doc)
  const dispatch = useMapStore((s) => s.dispatch)

  const { title, subtitle, text, icon, sizes, style } = doc.legend

  const matched = TITLE_PRESETS.find((preset) => preset === title) ?? CUSTOM

  /*
   * Dispatched per keystroke, exactly like the map-name field in the header, so the
   * legend updates as it is typed rather than only on blur.
   */
  const patch = (next: Record<string, unknown>) => dispatch({ op: 'set_legend', patch: next })

  const setTitle = (next: string) => patch({ title: next })
  const setSize = (key: keyof LegendElementSizes, value: number) =>
    patch({ sizes: { [key]: clamp(value, LEGEND_ELEMENT_SIZE.min, LEGEND_ELEMENT_SIZE.max) } })

  /*
   * What the width and height controls show while the legend is still sizing itself.
   *
   * There is only one stored size — `doc.legend.size`, which the corner drag and these
   * controls both write — and it is null until the author sets one. Rather than show
   * blank fields, the controls report the size the legend has actually taken, so moving
   * a slider starts from where the legend is instead of jumping. That keeps the two
   * ways of resizing in agreement without a second copy of the size to disagree with.
   */
  return (
    <>
      <div className="field">
        <span className="field__label">Legend title</span>
        <input
          className="input"
          type="text"
          value={title}
          placeholder={defaultLegendTitle(doc)}
          aria-label="Legend title"
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>
      <SizeSlider
        label="Title size"
        value={sizes.title}
        onChange={(value) => setSize('title', value)}
      />

      <SelectField
        label="Preset"
        value={matched}
        onChange={(preset) => {
          // The blank row is a state, not a command: choosing it should not wipe a
          // title the author typed.
          if (preset === CUSTOM) return
          setTitle(preset)
          playSfx('click')
        }}
      >
        <option value={CUSTOM}>{matched === CUSTOM && title ? 'Custom' : 'Choose a preset…'}</option>
        {TITLE_PRESETS.map((preset) => (
          <option key={preset} value={preset}>
            {preset}
          </option>
        ))}
      </SelectField>

      <div className="field">
        <span className="field__label">Subtitle</span>
        <input
          className="input"
          type="text"
          value={subtitle}
          placeholder="optional — unit, year…"
          aria-label="Legend subtitle"
          onChange={(event) => patch({ subtitle: event.target.value })}
        />
      </div>
      <SizeSlider
        label="Subtitle size"
        value={sizes.subtitle}
        onChange={(value) => setSize('subtitle', value)}
      />

      {/*
        A line of the author's own, set under the body.

        Its own element rather than something appended to the subtitle, because it is a
        different kind of statement: the subtitle qualifies what is being measured, this
        credits or annotates it. It wraps to the legend's width like any other text.
      */}
      <div className="field">
        <span className="field__label">Text</span>
        <input
          className="input"
          type="text"
          value={text}
          placeholder="e.g. Source: World Bank"
          aria-label="Legend text"
          onChange={(event) => patch({ text: event.target.value })}
        />
      </div>
      <SizeSlider
        label="Text size"
        value={sizes.text}
        onChange={(value) => setSize('text', value)}
      />

      <SelectField
        label="Icon"
        value={icon ?? NO_ICON}
        onChange={(next) => {
          patch({ icon: next === NO_ICON ? null : next })
          playSfx('click')
        }}
      >
        <option value={NO_ICON}>None</option>
        {LEGEND_ICON_IDS.map((id) => (
          <option key={id} value={id}>
            {LEGEND_ICONS[id].name}
          </option>
        ))}
      </SelectField>
      {/* Only once there is an icon to size: a control over nothing is noise. */}
      {icon && (
        <SizeSlider
          label="Icon size"
          value={sizes.icon}
          onChange={(value) => setSize('icon', value)}
        />
      )}

      {/*
        The entries themselves.

        The one size control with no field above it, because its content is not typed —
        the swatches and their labels come from the palette's bands or the comparison's
        groups. So it carries a line saying what it moves; every other slider is named
        by the input it sits under.
      */}
      <SizeSlider
        label="Item size"
        value={sizes.items}
        onChange={(value) => setSize('items', value)}
      />
      <p className="hint">Colour swatches and the labels beside them.</p>

      {/*
        The look, kept apart from the wording above: what the legend says and how it is
        set are different decisions, and Classic is the default so an existing map opens
        exactly as it did.
      */}
      <SelectField
        label="Style"
        value={style}
        onChange={(next) => {
          patch({ style: next })
          playSfx('click')
        }}
      >
        {LEGEND_STYLE_IDS.map((id) => (
          <option key={id} value={id}>
            {LEGEND_STYLES[id].name}
          </option>
        ))}
      </SelectField>

    </>
  )
}

/**
 * The panel's own size.
 *
 * The same `legend.size` the corner drag writes, so the two are one control in two
 * forms: drag the corner and these move, move these and the legend resizes. There is no
 * second state for them to disagree about.
 *
 * Its own component so the sidebar can fold it away. It is the one part of the legend's
 * settings that has a direct manipulation alternative — the corner of the legend itself
 * — so it is the part most often left alone.
 */
export function LegendSizeControls() {
  const doc = useMapStore((s) => s.doc)
  const dispatch = useMapStore((s) => s.dispatch)
  const { sizes, style } = doc.legend
  const tokens = LEGEND_STYLES[style] ?? LEGEND_STYLES.classic
  const patch = (next: Record<string, unknown>) => dispatch({ op: 'set_legend', patch: next })

  const model = buildLegendModel(doc)
  const natural = model
    ? naturalLegendSize(model, tokens, sizes, LEGEND_WIDTH)
    : { width: LEGEND_WIDTH, height: LEGEND_MIN_SIZE.height }
  const current = doc.legend.size ?? natural
  const isAuto = doc.legend.size === null

  const setPanel = (next: { width?: number; height?: number }) =>
    patch({
      size: {
        width: clamp(next.width ?? current.width, LEGEND_MIN_SIZE.width, LEGEND_MAX_SIZE.width),
        height: clamp(next.height ?? current.height, LEGEND_MIN_SIZE.height, LEGEND_MAX_SIZE.height),
      },
    })

  return (
    <>
      <div className="field">
        <span className="field__row">
          <span className="field__label">Legend size</span>
          <span className="field__value">{isAuto ? 'Auto' : 'Custom'}</span>
        </span>
      </div>

      <PixelSlider
        label="Width"
        value={Math.round(current.width)}
        min={LEGEND_MIN_SIZE.width}
        max={LEGEND_MAX_SIZE.width}
        onChange={(width) => setPanel({ width })}
      />
      <PixelSlider
        label="Height"
        value={Math.round(current.height)}
        min={LEGEND_MIN_SIZE.height}
        max={LEGEND_MAX_SIZE.height}
        onChange={(height) => setPanel({ height })}
      />

      {!isAuto && (
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => {
            // Back to sizing itself to its content — the state a legend starts in.
            patch({ size: null })
            playSfx('click')
          }}
        >
          Reset legend size
        </button>
      )}
    </>
  )
}

/**
 * One element's type scale.
 *
 * Shown as a percentage because the underlying number is a multiplier on whatever the
 * active style asks for, not a point size — "120%" says "a fifth bigger than this style
 * sets it", which survives a change of style where "12px" would not.
 */
function SizeSlider({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (value: number) => void
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
        min={LEGEND_ELEMENT_SIZE.min}
        max={LEGEND_ELEMENT_SIZE.max}
        step={LEGEND_ELEMENT_SIZE.step}
        value={value}
        aria-label={label}
        aria-valuetext={`${percent} percent`}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  )
}

/**
 * A dimension in pixels, as a slider and a number together.
 *
 * The slider is for finding a size and the field is for stating one, which are
 * different jobs: dragging to exactly 300 is fiddly, and nudging a number by two is
 * impossible on a track 200 pixels long. Both write the same value.
 */
function PixelSlider({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}) {
  return (
    <div className="field">
      <span className="field__row">
        <span className="field__label">{label}</span>
        <input
          className="input input--compact"
          type="number"
          min={min}
          max={max}
          step={1}
          value={value}
          aria-label={`${label} in pixels`}
          onChange={(event) => {
            const next = Number(event.target.value)
            // An empty or half-typed field parses to NaN; ignoring it leaves the legend
            // where it is instead of collapsing it to the minimum mid-keystroke.
            if (Number.isFinite(next)) onChange(next)
          }}
        />
      </span>
      <input
        className="slider"
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  )
}
