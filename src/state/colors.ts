/**
 * Country fill resolution.
 *
 * One ordered pipeline decides every country's colour:
 *
 *   1. the active colouring mode — comparison, or the data scale, never both
 *   2. selection / hover, but only where the mode had nothing to say
 *   3. outside-scope treatment
 *   4. the theme's land colour
 *
 * The data scale itself comes in two shapes, and they are alternatives rather than
 * layers. **Relative** (`numeric`) normalises a value against every value on the map
 * and samples a ramp; **threshold** sorts it into the fixed bands of a published
 * indicator and ignores the rest of the map entirely. Both read the country's own
 * stored value and nothing else.
 *
 * **Data outranks interaction.** Selecting a country is a statement about what the
 * next edit will touch, not about what the country is worth, so it must never repaint
 * one. A selected country that carries a value keeps that value's colour and is marked
 * by its outline instead — otherwise the map lies for as long as the selection lasts,
 * and the moment the author moves on to the next batch the previous one appears to
 * "change colour" when all that happened is that the selection stopped covering it.
 * The same goes for hover. Only a country the active mode leaves uncoloured is
 * available for the interaction states to paint.
 *
 * Exactly one thing decides a country's colour, and which one is a question of mode
 * rather than of precedence. There is no per-country override sitting above the
 * modes: an override always wins, so a map carrying a handful of them is a map where
 * some countries answer to the palette and some silently do not, and nothing on
 * screen says which. Colour is a reading of the data, so the way to change it is to
 * change the data.
 *
 * Anything the active mode does not colour falls through to `style.land`, which the
 * theme owns. "No value" and "no side" therefore look like land rather than like a
 * category — and follow the theme when it changes, because the fallback is read at
 * render time and never stored.
 */
import { classifyValue, type ThresholdPreset } from './presets'
import type {
  ComparisonMode,
  CountryEntry,
  CountryId,
  MapLayer,
  MapStyle,
  MapValue,
  Palette,
} from '../types/map'

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t
}

/**
 * Where a value sits between the lowest and the highest value on the map, as a
 * fraction in [0, 1].
 *
 *   t = (value - min) / (max - min)
 *
 * This is the whole reason raw numbers never reach a palette: 10…90, 100…900 and
 * 0.1…0.9 describe the same map and must colour it the same way. The domain comes
 * from the document (see {@link computeDomain}), so the scale is a property of the
 * data as a whole rather than of any one country.
 *
 * A domain with no spread — one valued country, or several that agree — has no
 * relative position to report, so it answers **1**: the darkest end of the ramp. Every
 * such country is simultaneously the minimum and the maximum, and reading it as the
 * maximum is the choice that stays still. Give five countries 100 and they are all
 * darkest; add four at 70 and the 100s are *still* darkest while the 70s come in pale.
 * Answering 0 instead would flip all five from pale to dark the instant the second
 * value arrived, and a mid-ramp answer would invent a spread the data does not have.
 *
 * Never returns NaN. A zero, negative or non-finite span — values far enough apart
 * that the subtraction overflows — all fall back to that same single stop.
 */
export function normalizedPosition(value: number, domain: [number, number]): number {
  const [min, max] = domain
  const span = max - min
  if (!Number.isFinite(span) || span <= 0) return 1
  const t = (value - min) / span
  return Number.isFinite(t) ? clamp01(t) : 1
}

/**
 * Which step of a `steps`-colour ramp a normalised position falls on.
 *
 * The stops sit at 0, 1/(steps-1) … 1 and each position takes the nearest, so the
 * minimum lands squarely on the lightest step, the maximum on the darkest, and a
 * six-colour ramp puts its remaining four stops at 20%, 40%, 60% and 80% of the
 * range. Nine colours divides the same 0…1 into nine evenly spaced steps.
 *
 * Monotonic by construction: the index rises with `t` and the ramp darkens with the
 * index, so a larger value can never be drawn lighter than a smaller one.
 */
export function paletteBucket(t: number, steps: number): number {
  if (steps <= 1) return 0
  return Math.round(clamp01(t) * (steps - 1))
}

/** Samples a colour ramp at `t` in [0, 1] by picking the nearest stop. */
export function sampleRamp(colors: string[], t: number): string {
  if (colors.length === 0) return '#888888'
  return colors[paletteBucket(t, colors.length)]
}

/**
 * Numeric domain across the countries that have a value for `dataKey`.
 *
 * Every country in the document is considered, and nothing else is: the selection has
 * no say in what the scale is built from. Assigning a value to one country therefore
 * rescales the map against *all* the values on it, which is the point — and a country
 * that has been deselected, or was never selected in this session, still counts.
 *
 * `null` when nothing on the map carries a number, which is how the renderer knows to
 * leave every country its land colour rather than colour them all identically.
 */
export function computeDomain(
  countries: Record<string, CountryEntry>,
  dataKey: string,
): [number, number] | null {
  let min = Infinity
  let max = -Infinity
  for (const entry of Object.values(countries)) {
    const value = entry.properties[dataKey]
    if (typeof value === 'number' && Number.isFinite(value)) {
      if (value < min) min = value
      if (value > max) max = value
    }
  }
  return min === Infinity ? null : [min, max]
}

/** How many countries currently carry a usable number for `dataKey`. */
export function countValued(countries: Record<string, CountryEntry>, dataKey: string): number {
  let n = 0
  for (const entry of Object.values(countries)) {
    const value = entry.properties[dataKey]
    if (typeof value === 'number' && Number.isFinite(value)) n++
  }
  return n
}

/** Distinct non-numeric values, in first-seen order — the basis for categorical colouring. */
export function computeCategories(
  countries: Record<string, CountryEntry>,
  dataKey: string,
): string[] {
  const seen: string[] = []
  for (const entry of Object.values(countries)) {
    const value = entry.properties[dataKey]
    if (value === null || value === undefined) continue
    const key = String(value)
    if (!seen.includes(key)) seen.push(key)
  }
  return seen
}

export interface ScaleContext {
  layer: MapLayer | undefined
  palette: Palette | undefined
  domain: [number, number] | null
  categories: string[]
  /**
   * The fixed-threshold scale's preset, when that is the active mode.
   *
   * Resolved from `doc.activePresetId` by whoever builds the context, so the renderer
   * never contains a threshold of its own — the numbers live in `state/presets.ts`
   * and nothing else knows what an HDI is.
   */
  preset?: ThresholdPreset
}

/** Colour for a value under the active scale, or null when the scale does not apply. */
export function resolveScaleColor(value: MapValue, ctx: ScaleContext): string | null {
  const { layer, palette } = ctx
  if (!layer || layer.colorScale.mode === 'none') return null
  if (value === null || value === undefined) return layer.colorScale.noDataColor

  /*
   * Fixed bands, and deliberately blind to `ctx.domain`. What the rest of the map
   * holds cannot change which band a number is in — that independence is the whole
   * reason this mode exists, and reading the domain here would quietly turn it back
   * into the relative scale.
   */
  if (layer.colorScale.mode === 'threshold') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return layer.colorScale.noDataColor
    return classifyValue(value, ctx.preset)?.color ?? layer.colorScale.noDataColor
  }

  if (!palette) return null

  if (layer.colorScale.mode === 'numeric') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return layer.colorScale.noDataColor
    // An author-pinned domain wins; otherwise the scale is derived from the document.
    const domain = layer.colorScale.domain ?? ctx.domain
    if (!domain) return layer.colorScale.noDataColor
    return sampleRamp(palette.colors, normalizedPosition(value, domain))
  }

  const key = String(value)
  const pinned = layer.colorScale.categoryColors[key]
  if (pinned) return pinned
  const index = ctx.categories.indexOf(key)
  return palette.colors[(index < 0 ? 0 : index) % palette.colors.length]
}

/**
 * Which comparison side each country lands on, and the two colours.
 *
 * Resolved once per document change rather than per country per frame, and resolved
 * by *document order*: the first group holding a side claims its members. That rule
 * is what makes a country in two opposed groups predictable — it is always the older
 * group that wins, the answer never changes between renders, and nothing is written
 * back, so the country stays in both groups exactly as the author left it.
 */
export interface ComparisonContext {
  enabled: boolean
  /** Country -> the colour of the first group in play that claims it. */
  colorByCountry: Map<CountryId, string>
}

export interface FillContext extends ScaleContext {
  style: MapStyle
  /**
   * Whether the flag overlay is on. When it is, no data colouring applies: a flag
   * drawn over a choropleth fill is neither readable, and the two are answering
   * different questions anyway. Suspends rather than clears — the values, groups and
   * palette are untouched and come straight back when it is switched off.
   */
  flags?: boolean
  inScope: boolean
  hovered: boolean
  selected: boolean
  comparison?: ComparisonContext
  /**
   * Theme-supplied land tone for this country, when the active theme separates
   * neighbours by tint. Ranks below anything the author or the data decided, so it
   * can never mask real map content.
   */
  landTint?: string | null
}

/**
 * Builds the per-country colour lookup from the comparison's own groups.
 *
 * Only the first `groupCount` groups are read, so lowering the count neutralises the
 * rest without touching their membership. Where a country is in more than one, the
 * first in order wins — later groups do not overwrite — which is the same precedence
 * the previous side-based model used and is stated in `ComparisonMode`.
 */
export function buildComparisonContext(comparison: ComparisonMode): ComparisonContext {
  const colorByCountry = new Map<CountryId, string>()
  if (comparison.enabled) {
    for (const group of comparison.groups.slice(0, comparison.groupCount)) {
      for (const id of group.members) if (!colorByCountry.has(id)) colorByCountry.set(id, group.color)
    }
  }
  return { enabled: comparison.enabled, colorByCountry }
}

/**
 * The colour the active mode gives a country, or null when it has nothing to say.
 *
 * Split out from {@link resolveCountryFill} because two callers need this answer on its
 * own: the border ink measures against the colour the data gave a country, and the legend
 * mirrors this precedence exactly.
 */
export function resolveDataFill(
  entry: CountryEntry | undefined,
  ctx: FillContext,
  countryId?: CountryId,
): string | null {
  if (ctx.flags) return null

  /*
   * Comparison replaces the data scale rather than sitting beside it, and a country
   * on no side is genuinely neutral: it falls through to the land colour instead of
   * being given a third colour that would read as a third category.
   */
  if (ctx.comparison?.enabled) {
    if (!countryId) return null
    return ctx.comparison.colorByCountry.get(countryId) ?? null
  }

  if (!entry || !ctx.layer) return null
  return resolveScaleColor(entry.properties[ctx.layer.dataKey] ?? null, ctx)
}

/**
 * What a country is when the active mode has nothing to say about it.
 *
 * The land, or whatever the pointer and the scope have made of it. Split out because
 * two callers need this answer: the fill below falls through to it, and the border
 * measures against it in comparison mode — see {@link resolveBorderBasis}.
 */
export function resolveBaseFill(ctx: FillContext): string {
  const { style } = ctx
  if (ctx.selected) return style.selected
  if (ctx.hovered) return style.hover
  if (!ctx.inScope && style.outsideScope === 'muted') return style.outsideScopeColor
  return ctx.landTint ?? style.land
}

export function resolveCountryFill(
  entry: CountryEntry | undefined,
  ctx: FillContext,
  countryId?: CountryId,
): string {
  /*
   * Selection first, because on this map selection *is* a fill and nothing else.
   *
   * It used to be the other way round — the data colour won and a heavy outline was
   * drawn round the country to mark it — which meant a selected country carried two
   * signals at once and the outline sat on top of the borders, thickening them wherever
   * the pointer had been. The outline is gone, so this colour is the whole of what
   * "selected" looks like and it has to win over the data underneath.
   *
   * Hover is unchanged: it still colours only what the active mode left uncoloured, so
   * moving the pointer across a finished map never repaints the work.
   */
  if (ctx.selected) return ctx.style.selected

  const authored = resolveDataFill(entry, ctx, countryId)
  if (authored) return authored

  return resolveBaseFill(ctx)
}

/**
 * The colour a country's border is actually drawn in.
 *
 * `style.border` is the author's choice and it wins, which sounds obvious and was not
 * true before: the border used to be whichever of the theme's two tones read better
 * over the fill, so on the dark theme the swatch said `#0d1116` while the map drew
 * `#93a1b3`, and a colour picked on the light theme could be discarded outright. A
 * control that is only a *candidate* is not a control.
 *
 * The two-tone rule still exists, because the problem it solves is real: a data ramp
 * runs from near-black to near-white, and a line chosen for one end disappears at the
 * other. So it is scoped to the case it was built for — a country coloured by a
 * *scale*. There, and only there, the paler tone can take over from a border that the
 * fill would otherwise swallow.
 *
 * Everywhere else the border is exactly what was chosen. That covers the base map, and
 * it covers comparison — whose colours are not a scale but four hues an author gave
 * four groups, so measuring against them would make the border a consequence of a
 * choice made for entirely unrelated reasons, and give one group white outlines and
 * not the others. It also means a monochrome map is expressible: black land with black
 * borders stays black, rather than being "corrected" into visibility.
 */
export function resolveBorderInk(
  entry: CountryEntry | undefined,
  ctx: FillContext,
  countryId?: CountryId,
): string {
  const { style } = ctx
  if (ctx.comparison?.enabled) return style.border
  const scaleFill = resolveDataFill(entry, ctx, countryId)
  if (!scaleFill) return style.border
  return resolveBorderColor(scaleFill, style)
}

/* --------------------------------------------------------------- land tints */

/** `#rgb` / `#rrggbb` to HSL, each component 0..1. */
function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const raw = hex.trim().replace('#', '')
  const full = raw.length === 3 ? raw.replace(/./g, (c) => c + c) : raw
  if (full.length !== 6) return null
  const n = Number.parseInt(full, 16)
  if (!Number.isFinite(n)) return null
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0, l }
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return { h, s, l }
}

function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 1) + 1) % 1
  const sat = Math.min(1, Math.max(0, s))
  const lig = Math.min(1, Math.max(0, l))
  const c = (1 - Math.abs(2 * lig - 1)) * sat
  const x = c * (1 - Math.abs(((hue * 6) % 2) - 1))
  const m = lig - c / 2
  const seg = Math.floor(hue * 6) % 6
  const [r, g, b] = (
    [
      [c, x, 0],
      [x, c, 0],
      [0, c, x],
      [0, x, c],
      [x, 0, c],
      [c, 0, x],
    ] as const
  )[seg]
  const to = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${to(r)}${to(g)}${to(b)}`
}

/**
 * Re-anchors a theme's family of land tones onto a chosen base colour.
 *
 * The Geographic theme separates neighbouring countries with several closely related
 * khakis rather than one flat fill, which is the whole of its look. Replacing them with
 * the author's single colour would delete that; ignoring the author — which is what
 * happened before — made the Land control silently inert on that theme.
 *
 * So the palette is treated as a set of *relationships* rather than a set of colours.
 * Each tone's distance from the theme's own land tone is measured and re-applied to the
 * base: hue and lightness as offsets, saturation as a ratio. That keeps the spread the
 * theme was designed with — the same subtle three-or-more-tone effect — at whatever hue
 * the author picks, so a green base gives closely related greens and a red base gives
 * closely related reds.
 *
 * Saturation is a ratio rather than an offset so a grey base stays grey: adding the
 * khakis' saturation to it would introduce a colour cast nobody asked for, where
 * scaling zero leaves zero.
 */
export function deriveLandTints(base: string, tints: string[], themeLand: string): string[] {
  const b = hexToHsl(base)
  const anchor = hexToHsl(themeLand)
  if (!b || !anchor || tints.length === 0) return tints

  const parsed = tints.map((tint) => ({ tint, hsl: hexToHsl(tint) }))
  const offsets = parsed.map((p) => (p.hsl ? p.hsl.l - anchor.l : 0))

  /*
   * The family is moved as a whole when it would run off either end, rather than each
   * tone being clamped where it lands.
   *
   * Clamping individually collapses the spread exactly where it is most needed: a base
   * of pure black pins every tone to the floor and the map goes flat, which is the one
   * outcome this function exists to avoid. Shifting keeps every gap intact and gives up
   * a little of the base's own lightness instead, which is far less visible than losing
   * the separation between neighbouring countries.
   */
  const FLOOR = 0.03
  const CEIL = 0.97
  const lo = Math.min(...offsets)
  const hi = Math.max(...offsets)
  let shift = 0
  if (b.l + lo < FLOOR) shift = FLOOR - (b.l + lo)
  else if (b.l + hi > CEIL) shift = CEIL - (b.l + hi)

  return parsed.map(({ tint, hsl: t }, i) => {
    if (!t) return tint
    const h = b.h + (t.h - anchor.h)
    const s = anchor.s > 0.01 ? b.s * (t.s / anchor.s) : b.s
    return hslToHex(h, s, b.l + offsets[i] + shift)
  })
}

/**
 * One tone re-anchored onto a new base, keeping its relationship to an old one.
 *
 * The single-colour case of {@link deriveLandTints}, and it exists for pairs: a theme
 * gives its selection a fill *and* a companion outline chosen to sit against it, and
 * when the author replaces the fill the outline has to move with it or the pair stops
 * agreeing — a red selection ringed in the old theme's green reads as two mistakes
 * rather than one colour.
 */
export function reanchorTone(base: string, tone: string, anchor: string): string {
  return deriveLandTints(base, [tone], anchor)[0] ?? tone
}

/* ------------------------------------------------------------------ contrast */

/** One sRGB channel, linearised. */
function channel(value: number): number {
  const c = value / 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/** WCAG relative luminance of a `#rgb` / `#rrggbb` colour, 0 (black) to 1 (white). */
export function relativeLuminance(color: string): number {
  const hex = color.trim().replace('#', '')
  const full = hex.length === 3 ? hex.replace(/./g, (c) => c + c) : hex
  if (full.length !== 6) return 0.5
  const n = Number.parseInt(full, 16)
  if (!Number.isFinite(n)) return 0.5
  return (
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255)
  )
}

/** WCAG contrast ratio between two colours, 1 (identical) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/**
 * Whichever of two colours is easier to see against `over`.
 *
 * Measured rather than guessed at with a lightness threshold. A threshold has to
 * assume the pair sits symmetrically about it, and these never do: the dark theme's
 * ink and its pale tone are not equidistant from mid-grey, so a fixed cut sends
 * mid-luminance fills — `#41ab5d` in the middle of the Green ramp — to the tone that
 * happens to be *closer* to them. Comparing the two ratios cannot make that mistake,
 * and it is the same question the eye is actually asking.
 */
export function moreLegible(a: string, b: string, over: string): string {
  return contrastRatio(a, over) >= contrastRatio(b, over) ? a : b
}

/**
 * Which of the theme's two border tones to draw over a given fill.
 *
 * A political boundary has one job — to separate two countries — and a single colour
 * provably cannot do it here. The line has to read against the theme's land *and*
 * against every stop of every data palette, and those run from `#08306b` to `#c6dbef`.
 * Measured as WCAG contrast, the best single tone available bottoms out at 1.0–1.15:1
 * in each theme, which is not a faint line but no line at all: the light theme's old
 * `#a8afb8` sat at exactly 1.00 against the middle of the Red ramp — the same
 * luminance as the fill it was meant to divide.
 *
 * So the theme supplies a pair and this picks the one that reads. Two tones chosen by
 * one measured rule is not a colour per country: a map shows at most two line colours,
 * and which one appears is a legible consequence of how dark the country is. On the
 * dark theme the ink carries roughly four fills in five; the pale tone appears only
 * where the fill is genuinely dark enough to swallow it.
 *
 * Reached only for a country coloured by a data scale — see {@link resolveBorderInk},
 * which is what the renderer calls. Applied to every country it would override the
 * author's own border colour on the base map, which is a control, not a fill.
 */
export function resolveBorderColor(fill: string, style: MapStyle): string {
  return moreLegible(style.border, style.borderOnDark, fill)
}

/**
 * An ink guaranteed to read against `background`.
 *
 * Selection is drawn as an outline now that it no longer repaints the country, and a
 * single themed outline colour cannot survive a ramp running from near-black to
 * near-white: chosen for one end, it vanishes at the other. So the casing under the
 * themed outline is picked from the fill it is actually being drawn over.
 */
export function contrastInk(background: string): string {
  return moreLegible('#10161d', '#f4f8fc', background)
}
