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
import { computeCategories, computeDomain } from './colors'
import { getPreset } from './presets'
import { waterName, WATER_REGIONS } from '../geo/waters'
import type { LegendIconId, MapDocument, MapValue } from '../types/map'

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

/**
 * The coloured seas, as legend rows — in the order the regions are listed rather than the
 * order they were painted, so the same map always reads the same way.
 *
 * Only those actually coloured, and only while Water Regions is on: a row for a colour that is
 * nowhere on the map explains nothing. Selection is deliberately not in here — a selected sea
 * is the editor showing the author what they have in hand, not a statement the picture makes,
 * exactly as a selected country is absent from every legend.
 */
function waterRows(doc: MapDocument): LegendRow[] {
  if (!doc.style.showWaterRegions) return []
  const painted = doc.waters ?? {}
  return WATER_REGIONS.flatMap((region) => {
    const entry = painted[region.id]
    return entry?.color ? [{ color: entry.color, label: waterName(region.id) }] : []
  })
}

function deriveLegendModel(doc: MapDocument): LegendModel | null {
  if (!doc.legend.visible) return null
  const waters = waterRows(doc)

  /*
   * Flags are not a scale, so there is nothing for a legend to explain — a ramp or a
   * band list here would be describing data the map is not currently showing. The
   * mode switch already says the map is showing flags, and a flag is its own label.
   * The author's title and subtitle are left alone, ready for when the data comes
   * back.
   */
  if (doc.flags.enabled) {
    return waters.length > 0
      ? {
          kind: 'rows',
          title: doc.legend.showTitle ? doc.legend.title || 'Water' : '',
          subtitle: doc.legend.subtitle,
          text: doc.legend.text,
          icon: doc.legend.icon,
          rows: waters,
        }
      : null
  }

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
    const withWater = [...rows, ...waters]
    if (withWater.length === 0) return null
    return {
      kind: 'rows',
      title,
      subtitle,
      text,
      icon,
      rows: withWater,
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
      rows: [
        ...preset.bands.map((band) => ({
          color: band.color,
          label: band.label,
          detail: describeRange(band.min, band.max, preset.unit),
        })),
        ...waters,
      ],
    }
  }

  /*
   * The categorical scale: one colour per value, which is how an imported SVG keeps the exact
   * colours it was given (see `io/svgExchange.ts`). Its rows are the legend that came with the
   * file — `legend.source: 'manual'`, in the file's order and wording — or, without one, each
   * category in use beside its colour.
   */
  if (layer.colorScale.mode === 'categorical') {
    const manual = doc.legend.source === 'manual' && doc.legend.entries.length > 0
    const palette = doc.palettes.find((p) => p.id === doc.activePaletteId)
    const rows: LegendRow[] = manual
      ? doc.legend.entries.map((entry) => ({ color: entry.color, label: entry.label }))
      : computeCategories(doc.countries, layer.dataKey).map((category, index) => ({
          color:
            layer.colorScale.categoryColors[category] ??
            palette?.colors[index % Math.max(1, palette.colors.length)] ??
            doc.style.land,
          label: category,
        }))
    const all = [...rows, ...waters]
    if (all.length === 0) return null
    return { kind: 'rows', title, subtitle, text, icon, rows: all }
  }

  /*
   * Under a numeric scale the legend is a ramp, and a ramp has no rows to add a sea to: the
   * model is one shape or the other, and drawing a swatch list under a gradient would be a
   * second legend inside the first. So a coloured sea is not listed there — it is listed in
   * every other mode, including with colouring off, which is where a map about the seas
   * actually sits.
   */
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

  /*
   * Colouring off. Nothing about the land to explain — but if the author has painted seas,
   * that is what this map says, and the legend says it.
   */
  if (waters.length > 0) {
    return {
      kind: 'rows',
      title: doc.legend.showTitle ? doc.legend.title || 'Water' : '',
      subtitle,
      text,
      icon,
      rows: waters,
    }
  }

  return null
}

/**
 * A data value as the map prints it: "45,200", "1.2M", "0.734", "$45,200", "42%".
 *
 * Grouped thousands below a million and compact above it, so a value set inside a country
 * stays short enough to fit there; small numbers keep up to four significant figures, as the
 * legend's do. The unit is the active scale's — the layer's own (`MapLayer.unit`), or the
 * fixed preset's when that is the scale in use — and goes where it is read: a currency symbol
 * before the number, anything else ("%", " years") after it. Text values are printed as they
 * are.
 */
export function formatDataValue(value: MapValue, unit = ''): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'string') return value.trim() || null
  if (!Number.isFinite(value)) return null
  const abs = Math.abs(value)
  const number =
    abs >= 1e6
      ? new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
      : abs >= 1000
        ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)
        : Number.isInteger(value)
          ? String(value)
          : String(Number(value.toPrecision(4)))
  const u = unit ?? ''
  if (!u) return number
  return /^[$€£¥₹₩₽¢]/.test(u.trim()) ? `${u.trim()}${number}` : `${number}${u}`
}

/** Band range as the legend prints it: `below 0.55`, `0.55 – 0.7`, `0.8 and above`. */
function describeRange(min: number, max: number, unit: string): string {
  const lo = Number.isFinite(min) ? `${formatValue(min)}${unit}` : null
  const hi = Number.isFinite(max) ? `${formatValue(max)}${unit}` : null
  if (lo === null) return `< ${hi}`
  if (hi === null) return `≥ ${lo}`
  return `${lo}–${hi}`
}
