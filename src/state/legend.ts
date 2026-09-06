/**
 * What the legend says, and how big it is.
 *
 * Pure derivation from the document: the same three colouring modes that decide a
 * country's fill decide what the legend explains, so the two can never disagree. If
 * the active mode has nothing to explain — colouring off, or a numeric scale with no
 * values on the map yet — this returns `null` and the legend does not render at all.
 *
 * Layout is computed here rather than measured from the DOM because the renderer has
 * to know the legend's size *before* it can place it: the anchor is a fraction of
 * `viewport - legend`, and the drag clamps against the same figure. A fixed panel
 * width and a row-counted height give an exact answer with no measurement pass, and
 * keep the SVG the exporter serialises identical to the one on screen.
 */
import { computeDomain } from './colors'
import { getPreset } from './presets'
import type { LegendIconId, MapDocument } from '../types/map'

/* ------------------------------------------------------------------ layout */

/**
 * Common titles, offered as shortcuts.
 *
 * Shortcuts and nothing more: picking one writes its text into the title field and
 * the author edits it from there — "GDP per Capita" becomes "GDP per Capita (USD)",
 * or gets deleted and replaced outright. The list exists because typing "Human
 * Development Index" by hand for the fiftieth time is not authorship, not
 * because these are the titles a map is allowed to have. Nothing anywhere validates
 * a title against this array.
 */
export const TITLE_PRESETS = [
  'GDP',
  'GDP per Capita',
  'Population',
  'Population Density',
  'Human Development Index',
  'Unemployment Rate',
  'Literacy Rate',
  'Life Expectancy',
  'Median Age',
  'Area',
] as const

export const LEGEND_WIDTH = 186
const PAD = 10
const TITLE_H = 16
const SUBTITLE_H = 12
const RAMP_H = 11
const RAMP_LABELS_H = 15
const ROW_H = 17

export interface LegendSize {
  width: number
  height: number
}

/* ------------------------------------------------------------------- model */

export interface LegendRow {
  color: string
  label: string
  /** Right-aligned detail, e.g. a threshold range. Optional. */
  detail?: string
}

interface LegendHeader {
  title: string
  /** Empty when the author has not set one; the header shrinks to match. */
  subtitle: string
  /** The author's free line, under the body. Empty when unset. */
  text: string
  /** The icon element, or null for none. */
  icon: LegendIconId | null
}

export type LegendModel = LegendHeader &
  (
    | {
        kind: 'ramp'
        colors: string[]
        minLabel: string
        maxLabel: string
        /** Diverging ramps also label the middle, so the two directions are explicit. */
        midLabel?: string
      }
    | { kind: 'rows'; rows: LegendRow[] }
  )

/** Height of the title block, which the subtitle extends only when there is one. */
export function headerHeight(model: LegendHeader): number {
  return (model.title ? TITLE_H : 0) + (model.subtitle ? SUBTITLE_H : 0)
}

export function legendSize(model: LegendModel): LegendSize {
  const header = headerHeight(model)
  const height =
    model.kind === 'ramp'
      ? PAD + header + RAMP_H + 3 + RAMP_LABELS_H + PAD
      : PAD + header + model.rows.length * ROW_H + PAD
  return { width: LEGEND_WIDTH, height }
}

export const LEGEND_LAYOUT = { PAD, TITLE_H, SUBTITLE_H, RAMP_H, RAMP_LABELS_H, ROW_H }

/* -------------------------------------------------------------- formatting */

/** Compact, readable, and never scientific soup: `1.2M`, `0.734`, `-40`. */
export function formatValue(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  if (abs >= 1e5) {
    return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(
      value,
    )
  }
  if (Number.isInteger(value)) return String(value)
  return String(Number(value.toPrecision(4)))
}

/* ------------------------------------------------------------- derivation */

/**
 * The legend for the document's active colouring mode, or `null` when none applies.
 *
 * Mirrors `resolveDataFill`'s precedence exactly — comparison first, then the layer's
 * scale — so the legend describes whichever mode is actually painting the map.
 */
export function defaultLegendTitle(doc: MapDocument): string {
  if (doc.comparison.enabled) return 'Comparison'
  const layer = doc.layers.find((l) => l.id === doc.activeLayerId) ?? doc.layers[0]
  if (layer?.colorScale.mode === 'threshold') return getPreset(doc.activePresetId)?.name ?? 'Legend'
  return layer?.name ?? 'Legend'
}

/**
 * Memoised on the document, which is replaced rather than mutated on every edit — so
 * identity is an exact answer to "has anything that could change this changed?".
 *
 * The layout downstream keys its own cache on the model's identity, and that only helps
 * if a model survives between renders; without this it would be a fresh object every
 * frame and never hit.
 */
const models = new WeakMap<MapDocument, LegendModel | null>()

export function buildLegendModel(doc: MapDocument): LegendModel | null {
  if (models.has(doc)) return models.get(doc) ?? null
  const built = deriveLegendModel(doc)
  models.set(doc, built)
  return built
}

function deriveLegendModel(doc: MapDocument): LegendModel | null {
  if (!doc.legend.visible) return null

  /*
   * Flags are not a scale, so there is nothing for a legend to explain — a ramp or a
   * band list here would be describing data the map is not currently showing. The
   * mode switch already says the map is showing flags, and a flag is its own label.
   * The author's title and subtitle are left alone, ready for when the data comes
   * back.
   */
  if (doc.flags.enabled) return null

  /*
   * An empty title is not a missing one: it means "describe yourself". The fallback
   * follows the active mode, so a legend always says what it is about even before the
   * author has typed anything — and the moment they do, their words win outright and
   * nothing here ever writes back over them.
   */
  /*
   * Switched off, the model simply has no title — the one change this feature makes to
   * the pipeline. Everything downstream already copes with a legend that has nothing to
   * head it, because an empty string was always possible here; what was not possible was
   * *asking* for one, since an empty field means "describe yourself" and fills itself in.
   */
  const title = doc.legend.showTitle ? doc.legend.title || defaultLegendTitle(doc) : ''
  const subtitle = doc.legend.subtitle
  /*
   * Authored outright, unlike the title's fallback: an empty free line means the author
   * did not want one, and there is no sensible thing to write there on their behalf.
   */
  const text = doc.legend.text
  const icon = doc.legend.icon

  /*
   * Comparison reads no values, so its legend is the groups and their colours.
   */
  if (doc.comparison.enabled) {
    const inPlay = doc.comparison.groups.slice(0, doc.comparison.groupCount)
    const assigned = inPlay.filter((g) => g.members.length > 0)
    /*
     * Once anything has been assigned, only the groups that hold something: a group
     * with no members is neutral on the map, and a legend entry for a colour that
     * appears nowhere explains nothing.
     *
     * Before anything has been assigned there is no such colour to misreport, and the
     * useful thing to state is the scheme the author has just set up — four groups,
     * their names and their colours. That is also what makes switching into Compare
     * show a legend straight away rather than an empty corner waiting for a click.
     */
    const rows = (assigned.length ? assigned : inPlay)
      // The full name, not a shortened one: the panel is resizable now, so how much of
      // a name fits is a question about the width the author has given it, and only the
      // layout knows that. A cap here would keep eliding "Central and Eastern Europe"
      // on a legend wide enough to spell it out.
      .map((g) => ({ color: g.color, label: g.name }))
    if (rows.length === 0) return null
    return {
      kind: 'rows',
      title,
      subtitle,
      text,
      icon,
      rows,
    }
  }

  const layer = doc.layers.find((l) => l.id === doc.activeLayerId) ?? doc.layers[0]
  if (!layer) return null

  /*
   * Fixed bands are a list, not a ramp, and are drawn as one — a gradient strip would
   * claim the scale is continuous when the whole point of the mode is that it is not.
   */
  if (layer.colorScale.mode === 'threshold') {
    const preset = getPreset(doc.activePresetId)
    if (!preset) return null
    return {
      kind: 'rows',
      title,
      subtitle,
      text,
      icon,
      rows: preset.bands.map((band) => ({
        color: band.color,
        label: band.label,
        detail: describeRange(band.min, band.max, preset.unit),
      })),
    }
  }

  if (layer.colorScale.mode === 'numeric') {
    const palette = doc.palettes.find((p) => p.id === doc.activePaletteId)
    // No palette is a broken document rather than an empty one; there is no ramp to draw.
    if (!palette) return null

    const domain = layer.colorScale.domain ?? computeDomain(doc.countries, layer.dataKey)
    const diverging = palette.kind === 'diverging'

    /*
     * Nothing valued yet, but the scale is still real: the palette is chosen, the
     * direction is decided, and the first value entered will be read against exactly
     * this ramp. So the ramp is drawn and the ends are named by their direction rather
     * than by numbers that do not exist yet — "Low" and "High" are true now and stay
     * true, where a 0 and a 1 would be a pair of numbers the map never contained.
     *
     * The midpoint label is dropped with them. A diverging ramp's middle is the middle
     * of the data, and there is no data to be in the middle of.
     */
    if (!domain) {
      return {
        kind: 'ramp',
        title,
        subtitle,
        text,
        icon,
        colors: palette.colors,
        minLabel: 'Low',
        maxLabel: 'High',
      }
    }

    const [min, max] = domain
    return {
      kind: 'ramp',
      title,
      subtitle,
      text,
      icon,
      colors: palette.colors,
      minLabel: formatValue(min),
      maxLabel: formatValue(max),
      ...(diverging ? { midLabel: formatValue((min + max) / 2) } : {}),
    }
  }

  return null
}

/** Band range as the legend prints it: `below 0.55`, `0.55 – 0.7`, `0.8 and above`. */
function describeRange(min: number, max: number, unit: string): string {
  const lo = Number.isFinite(min) ? `${formatValue(min)}${unit}` : null
  const hi = Number.isFinite(max) ? `${formatValue(max)}${unit}` : null
  if (lo === null) return `< ${hi}`
  if (hi === null) return `≥ ${lo}`
  return `${lo}–${hi}`
}
