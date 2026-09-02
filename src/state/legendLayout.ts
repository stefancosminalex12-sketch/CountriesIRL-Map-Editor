/**
 * Legend layout: fitting the content to the panel, in both directions.
 *
 * The legend is one component, not a box with something drawn in the corner of it. So
 * the panel's size is an *input to the layout*, and everything inside is solved
 * against it: the type, the palette bar, the swatches, the spacing and the wrapping.
 * Make the panel bigger and the content gets bigger; make it smaller and the content
 * reflows down to meet it.
 *
 * This is deliberately not a transform. A `scale()` on the group would multiply the
 * stroke widths, blur the type off the pixel grid and — worst — freeze the line breaks
 * that were computed at the old size, so a wider legend would show the same wrapped
 * ragged column with empty space beside it. Here the sizes are real numbers that go
 * into real attributes, and the text is re-wrapped at every candidate size, so a wider
 * panel genuinely re-flows rather than being stretched.
 *
 * Everything is measured with a canvas rather than estimated from character counts,
 * because the wrap has to agree exactly with what the browser will draw, and the same
 * measurement has to hold for the copy the exporter serialises.
 */
import type { LegendModel } from './legend'
import type { LegendStyleTokens } from './legendStyles'
import type { LegendElementSizes } from '../types/map'

const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'

/**
 * One canvas for the life of the page.
 *
 * `measureText` is synchronous and needs no layout, so this costs a context switch and
 * nothing else. Falling back to an estimate keeps the legend rendering in an
 * environment without a canvas rather than throwing.
 */
let ctx: CanvasRenderingContext2D | null | undefined

function measurer(): CanvasRenderingContext2D | null {
  if (ctx === undefined) {
    try {
      ctx = document.createElement('canvas').getContext('2d')
    } catch {
      ctx = null
    }
  }
  return ctx
}

export function textWidth(text: string, size: number, weight = 400, letterSpacing = 0): number {
  const c = measurer()
  if (!c) return text.length * size * 0.55
  c.font = `${weight} ${size}px ${FONT_STACK}`
  return c.measureText(text).width + letterSpacing * size * Math.max(0, text.length - 1)
}

/**
 * Greedy wrap to a width, breaking inside a word only when a single word cannot fit.
 *
 * Breaking mid-word is a last resort because it is unreadable; but a legend is a narrow
 * panel and "Nationalversammlung" is a real title, so the fallback has to exist or the
 * text would overflow the one case the author most needs handled.
 */
export function wrapText(
  text: string,
  maxWidth: number,
  size: number,
  weight = 400,
  letterSpacing = 0,
): string[] {
  if (!text) return []
  const width = (s: string) => textWidth(s, size, weight, letterSpacing)
  const lines: string[] = []
  let line = ''

  const pushBrokenWord = (word: string) => {
    let chunk = ''
    for (const ch of word) {
      if (chunk && width(chunk + ch) > maxWidth) {
        lines.push(chunk)
        chunk = ch
      } else {
        chunk += ch
      }
    }
    line = chunk
  }

  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word
    if (width(candidate) <= maxWidth) {
      line = candidate
      continue
    }
    if (line) lines.push(line)
    if (width(word) <= maxWidth) line = word
    else pushBrokenWord(word)
  }
  if (line) lines.push(line)
  return lines
}

/** Shortens to fit a width, with an ellipsis. Only used where wrapping is not possible. */
export function fitOneLine(text: string, maxWidth: number, size: number, weight = 400): string {
  if (!text || textWidth(text, size, weight) <= maxWidth) return text
  let out = text
  while (out.length > 1 && textWidth(`${out}…`, size, weight) > maxWidth) {
    out = out.slice(0, -1)
  }
  return `${out}…`
}

/* ------------------------------------------------------------------ shapes */

/** A run of wrapped lines, already positioned and sized. */
export interface TextBlock {
  lines: string[]
  /** Font size in user units — a real size, not a multiplier. */
  size: number
  lineHeight: number
  /** Baseline of the first line. */
  baseline: number
  x: number
  width: number
}

export interface RampBody {
  kind: 'ramp'
  y: number
  height: number
  x: number
  width: number
  stepWidth: number
  radius: number
  labelSize: number
  labelBaseline: number
}

export interface RowsBody {
  kind: 'rows'
  y: number
  rowHeight: number
  swatch: number
  swatchRadius: number
  labelSize: number
  labelX: number
  x: number
  width: number
  /** Labels already fitted to the room left beside their swatch. */
  labels: { label: string; detail: string }[]
}

export interface LegendLayout {
  /** The solved content scale. Above 1 when the panel is bigger than the content needs. */
  scale: number
  pad: number
  title: TextBlock
  subtitle: TextBlock
  note: TextBlock
  icon: { x: number; y: number; size: number } | null
  body: RampBody | RowsBody
  /** The height the content wants, which is what auto-sizing reports. */
  contentHeight: number
}

/**
 * How far the content may be scaled.
 *
 * The floor is where type stops being readable; below it the layout gives up lines
 * rather than shrinking further. The ceiling stops a nearly-empty legend stretched to
 * 460x420 from setting two group names in 30-point type — past a point the answer to
 * "more room" is more spacing, not more size, which is what the slack below is for.
 */
const MIN_SCALE = 0.7
const MAX_SCALE = 2.4

/** Bisection steps used to solve the scale. Each is a handful of `measureText` calls. */
const SOLVE_STEPS = 16

/**
 * The element sizes the scale is solved against.
 *
 * Deliberately the style's own proportions rather than the author's: see the note in
 * {@link layoutLegend} for why the solve must not see the multipliers.
 */
const NEUTRAL_SIZES: LegendElementSizes = { title: 1, subtitle: 1, text: 1, icon: 1, items: 1 }

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

/**
 * Baseline of a line, centring the em box inside its line box.
 *
 * Derived rather than hardcoded because the leading is a ratio of the font size, and
 * the font size is what the author's multiplier moves: a fixed offset would drift off
 * centre the moment either changed.
 */
function baselineOf(top: number, lineHeight: number, size: number): number {
  return top + (lineHeight - size) / 2 + size * 0.8
}

/**
 * Padding grows with the content, but more slowly than it does.
 *
 * Linear padding would take a third of a large panel and leave the content no better
 * off than before; none at all would put 20-point type hard against the border. The
 * curve keeps the frame legible at both ends.
 */
function padFor(tokens: LegendStyleTokens, scale: number): number {
  return tokens.pad * (0.55 + 0.45 * scale)
}

interface Measured {
  pad: number
  gap: number
  iconSize: number
  headerX: number
  headerWidth: number
  titleLines: string[]
  titleSize: number
  titleLineHeight: number
  subtitleLines: string[]
  subtitleSize: number
  subtitleLineHeight: number
  headerHeight: number
  bodyHeight: number
  rampHeight: number
  rampLabelSize: number
  rampLabelGap: number
  rowHeight: number
  rowLabelSize: number
  rowLabelGap: number
  noteLines: string[]
  noteSize: number
  noteLineHeight: number
  noteHeight: number
  total: number
}

/**
 * Measures the whole component at one candidate scale.
 *
 * Every size here is absolute, and the text is wrapped at the size it will actually be
 * drawn at — which is what makes the solve below meaningful. A cheaper estimate would
 * find a scale that fits an approximation of the content rather than the content.
 */
function measure(
  model: LegendModel,
  tokens: LegendStyleTokens,
  sizes: LegendElementSizes,
  width: number,
  height: number,
  scale: number,
): Measured {
  const pad = padFor(tokens, scale)
  const gap = tokens.gap * scale
  const inner = Math.max(8, width - pad * 2)

  /*
   * The icon is capped against the panel in both directions, not just by its own
   * multiplier. At 2.5x it would otherwise leave the title a two-character column, or
   * take a header so tall that the body it is introducing has nowhere left to go — and
   * a control that can destroy the layout is a control the author cannot use freely.
   */
  const iconSize = model.icon
    ? clamp(tokens.icon.size * scale * sizes.icon, 6, Math.min(inner * 0.45, height * 0.4, 96))
    : 0
  const iconGap = iconSize ? gap * 1.6 : 0
  const headerX = pad + iconSize + iconGap
  const headerWidth = Math.max(8, width - headerX - pad)

  const titleSize = tokens.title.size * scale * sizes.title
  const titleLineHeight = titleSize * (tokens.title.lineHeight / tokens.title.size)
  const titleLines = wrapText(
    tokens.title.uppercase ? model.title.toUpperCase() : model.title,
    headerWidth,
    titleSize,
    tokens.title.weight,
    tokens.title.letterSpacing,
  )

  const subtitleSize = tokens.subtitle.size * scale * sizes.subtitle
  const subtitleLineHeight = subtitleSize * (tokens.subtitle.lineHeight / tokens.subtitle.size)
  const subtitleLines = model.subtitle ? wrapText(model.subtitle, headerWidth, subtitleSize) : []

  const textHeight =
    titleLines.length * titleLineHeight + subtitleLines.length * subtitleLineHeight
  // The icon may be taller than the words beside it, and the header has to clear both.
  const headerHeight = Math.max(textHeight, iconSize)

  /*
   * The body — the entries the legend exists to list — takes its own multiplier.
   *
   * It covers the whole entry rather than the swatch alone: a colour and the words
   * beside it are one item, and sizing them apart makes a legend whose colours and
   * labels disagree about how important they are. The gaps travel with them for the
   * same reason, or a doubled swatch would sit against a label it used to clear.
   */
  const items = sizes.items
  const rampHeight = tokens.ramp.height * scale * items
  const rampLabelSize = tokens.ramp.labelSize * scale * items
  const rampLabelGap = tokens.ramp.labelGap * scale * items
  const rowHeight = tokens.row.height * scale * items
  const rowLabelSize = tokens.row.labelSize * scale * items
  const rowLabelGap = 7 * scale * items
  const bodyHeight =
    model.kind === 'ramp'
      ? rampHeight + rampLabelGap + rampLabelSize
      : model.rows.length * rowHeight

  const noteSize = tokens.note.size * scale * sizes.text
  const noteLineHeight = noteSize * (tokens.note.lineHeight / tokens.note.size)
  const noteLines = model.text ? wrapText(model.text, inner, noteSize) : []
  const noteHeight = noteLines.length ? noteLines.length * noteLineHeight + gap : 0

  return {
    pad,
    gap,
    iconSize,
    headerX,
    headerWidth,
    titleLines,
    titleSize,
    titleLineHeight,
    subtitleLines,
    subtitleSize,
    subtitleLineHeight,
    headerHeight,
    bodyHeight,
    rampHeight,
    rampLabelSize,
    rampLabelGap,
    rowHeight,
    rowLabelSize,
    rowLabelGap,
    noteLines,
    noteSize,
    noteLineHeight,
    noteHeight,
    total: pad * 2 + headerHeight + gap + bodyHeight + noteHeight,
  }
}

/**
 * Lays a model out inside a panel of a given size.
 *
 * The scale is *solved*, not stepped down from 1: bisection finds the largest size at
 * which the content still fits the height it has been given. That is the whole
 * difference between this and a fitting pass — a panel dragged larger reports a larger
 * scale, so the palette bar, the swatches, the type and the spacing all grow together,
 * and a panel dragged smaller reflows instead of spilling.
 *
 * Height is what the scale is solved against; width participates by changing where the
 * text wraps, which changes the height at every candidate. So widening a legend really
 * does let the content grow, rather than only stretching the box.
 */
export function layoutLegend(
  model: LegendModel,
  tokens: LegendStyleTokens,
  sizes: LegendElementSizes,
  width: number,
  height: number,
): LegendLayout {
  const hit = cached(model, tokens, sizes, width, height)
  if (hit) return hit
  const result = solveLayout(model, tokens, sizes, width, height)
  remember(model, tokens, sizes, width, height, result)
  return result
}

/**
 * The layout is solved twice by bisection and re-wraps every string at each candidate,
 * which costs a couple of milliseconds — cheap for an edit, but the legend re-renders
 * with the rest of the map, and paying it on every frame of a pan would spend an eighth
 * of the frame budget recomputing an answer that has not changed.
 *
 * Identity is a sound key here because all four object inputs are immutable: the
 * document is replaced rather than mutated on every edit, the tokens come from a frozen
 * registry, and the model is memoised on the document. So an unchanged legend during a
 * pan is a pointer comparison, and any real edit misses the cache by construction.
 *
 * One entry, because there is one legend. A larger cache would hold sizes nothing is
 * about to ask for again.
 */
let last: {
  model: LegendModel
  tokens: LegendStyleTokens
  sizes: LegendElementSizes
  width: number
  height: number
  result: LegendLayout
} | null = null

function cached(
  model: LegendModel,
  tokens: LegendStyleTokens,
  sizes: LegendElementSizes,
  width: number,
  height: number,
): LegendLayout | null {
  if (!last) return null
  return last.model === model &&
    last.tokens === tokens &&
    last.sizes === sizes &&
    last.width === width &&
    last.height === height
    ? last.result
    : null
}

function remember(
  model: LegendModel,
  tokens: LegendStyleTokens,
  sizes: LegendElementSizes,
  width: number,
  height: number,
  result: LegendLayout,
): void {
  last = { model, tokens, sizes, width, height, result }
}

function solveLayout(
  model: LegendModel,
  tokens: LegendStyleTokens,
  sizes: LegendElementSizes,
  width: number,
  height: number,
): LegendLayout {
  /*
   * The scale is solved against *neutral* element sizes, and the author's multipliers
   * are applied afterwards.
   *
   * This matters more than it looks. If the multipliers fed into the solve, the solve
   * would cancel them: asking for a title at 250% would make the content taller, the
   * fit would answer by lowering the scale in almost exactly the same proportion, and
   * the title would come out the size it already was — while everything around it
   * quietly shrank. The control would appear broken, and would in fact be doing the
   * opposite of what it says.
   *
   * Solving against neutral sizes asks a question the multipliers cannot distort — how
   * big is this panel, relative to the content at the style's own proportions — and
   * leaves the multipliers to mean exactly what they say. Anything they overflow is
   * handled below, by giving up lines and, in the last resort, by the renderer's clip.
   *
   * Bisection rather than stepping, because the content is re-wrapped at every
   * candidate and stepping in small increments would cost several times as many
   * measurements to land on the same answer. `total` is non-decreasing in the scale —
   * bigger type is never shorter — so the search is sound despite wrapping making it a
   * step function.
   */
  let lo = MIN_SCALE
  let hi = MAX_SCALE
  const fitted = (candidate: number) =>
    measure(model, tokens, NEUTRAL_SIZES, width, height, candidate).total <= height

  if (!fitted(lo)) {
    // Too small for even the floor: take the floor, and degrade below.
    hi = lo
  } else if (fitted(hi)) {
    lo = hi
  } else {
    for (let i = 0; i < SOLVE_STEPS; i++) {
      const mid = (lo + hi) / 2
      if (fitted(mid)) lo = mid
      else hi = mid
    }
  }

  /*
   * Then the author's multipliers, damped together if they overrun the panel.
   *
   * Damping the whole layout by one factor is what makes a size control mean something
   * when the panel is fixed. The alternative — leaving the sizes as asked and letting
   * the degradation below drop whatever no longer fits — would answer "make the
   * subtitle bigger" by removing the subtitle, which is the least useful reading of the
   * request available. Scaling everything by a common factor keeps the *ratios* the
   * author set (a 2.5x subtitle stays two and a half times the title's size) while the
   * absolute sizes come back inside the box.
   *
   * The floor is well below `MIN_SCALE`: this is the path where the author has asked
   * for something that does not comfortably fit, and small-but-present beats absent.
   * Past the floor the degradation takes over.
   */
  let scale = lo
  if (measure(model, tokens, sizes, width, height, scale).total > height) {
    let dampLo = MIN_SCALE * 0.55
    let dampHi = scale
    if (measure(model, tokens, sizes, width, height, dampLo).total <= height) {
      for (let i = 0; i < SOLVE_STEPS; i++) {
        const mid = (dampLo + dampHi) / 2
        if (measure(model, tokens, sizes, width, height, mid).total <= height) dampLo = mid
        else dampHi = mid
      }
      scale = dampLo
    } else {
      scale = dampLo
    }
  }

  const m = measure(model, tokens, sizes, width, height, scale)
  const pad = m.pad
  const inner = Math.max(8, width - pad * 2)

  /*
   * Last resort, when the smallest readable type still does not fit.
   *
   * The renderer clips the panel, so nothing can escape it either way — but a clip cuts
   * through the middle of a glyph, and a legend ending in half a letter reads as broken
   * rather than as abbreviated. So the header gives lines up deliberately: the free line
   * first, then the subtitle, then title lines from the bottom with the last survivor
   * ellipsised at a word boundary.
   *
   * The body keeps its room throughout. A ramp or a list of bands is the thing the
   * legend exists to explain; losing a row of it to make space for a subtitle would be
   * the wrong trade in every case.
   */
  let titleLines = m.titleLines
  let subtitleLines = m.subtitleLines
  let noteLines = m.noteLines
  let noteHeight = m.noteHeight

  if (m.total > height) {
    let budget = height - pad * 2 - m.gap - m.bodyHeight

    if (noteLines.length && budget - noteHeight < m.titleLineHeight) {
      noteLines = []
      noteHeight = 0
    }
    budget -= noteHeight

    if (
      subtitleLines.length &&
      budget - subtitleLines.length * m.subtitleLineHeight < m.titleLineHeight
    ) {
      subtitleLines = []
    }

    const room = budget - subtitleLines.length * m.subtitleLineHeight
    // Always keep one line: a legend with no title explains less than a shortened one,
    // and the clip contains that single line regardless.
    const keep = Math.max(1, Math.min(titleLines.length, Math.floor(room / m.titleLineHeight)))
    if (keep < titleLines.length) {
      titleLines = titleLines.slice(0, keep)
      titleLines[keep - 1] = fitOneLine(
        `${titleLines[keep - 1]}…`,
        m.headerWidth,
        m.titleSize,
        tokens.title.weight,
      )
    }
  }

  const textHeight =
    titleLines.length * m.titleLineHeight + subtitleLines.length * m.subtitleLineHeight
  const headerHeight = Math.max(textHeight, m.iconSize)
  const contentHeight = pad * 2 + headerHeight + m.gap + m.bodyHeight + noteHeight

  /*
   * Whatever the ceiling on the scale left over.
   *
   * Only reached when the panel is bigger than `MAX_SCALE` can fill, and it goes to the
   * things that read as generosity rather than as size: a taller palette bar, roomier
   * rows, more air between the blocks. Leaving it at the bottom instead is exactly the
   * dead space that makes a resized legend look broken.
   *
   * Measured against the body at its *neutral* item size, and for the same reason the
   * scale is solved that way. Slack is what is left over, so it moves opposite to the
   * body: ask for smaller entries and the leftover grows and hands it straight back,
   * ask for larger ones and there is none left to give. Distributed naively that does
   * not merely weaken the item control, it inverts it — the colour bar measured
   * *shorter* at 250% than at 50%, which is the control doing the opposite of what it
   * says. Filling the panel against a fixed baseline and then applying the author's
   * multiplier keeps the two independent: the panel decides the baseline, the author
   * decides the size relative to it.
   */
  const items = Math.max(0.01, sizes.items)
  // The body scales linearly with `items`, so dividing recovers the neutral figure
  // without measuring the whole layout a second time.
  const neutralBodyHeight = m.bodyHeight / items
  const slack = Math.max(
    0,
    height - (pad * 2 + headerHeight + m.gap + neutralBodyHeight + noteHeight),
  )

  let rampHeight = m.rampHeight / items
  let rowHeight = m.rowHeight / items

  if (slack > 0) {
    /*
     * Most of the leftover grows the body; the rest becomes spacing, which is settled
     * further down once the body's final size is known.
     */
    if (model.kind === 'ramp') {
      // The bar is the subject of a ramp legend, so it takes the larger share — but not
      // so much that it stops reading as a scale and starts reading as a block of colour.
      rampHeight += Math.max(0, Math.min(slack * 0.62, height * 0.42 - rampHeight))
    } else if (model.rows.length > 0) {
      rowHeight += (slack * 0.78) / model.rows.length
    }
  }

  /*
   * Now the author's item size, on top of the size that fills the panel.
   *
   * Growth comes out of the spacing first. The gaps opened up by the slack above are
   * the compressible part of the panel and the entries are the point of it, so the room
   * available to the body is measured with the gaps squeezed back to their minimum —
   * turning the control up closes the air between the blocks before it runs out of
   * room, rather than stopping at whatever the baseline happened to leave.
   */
  const gapCount = noteLines.length ? 2 : 1
  // The note carries its own leading inside `noteHeight`; the lines alone are fixed.
  const noteLinesHeight = noteHeight > 0 ? noteHeight - m.gap : 0
  const fixedHeight = pad * 2 + headerHeight + noteLinesHeight
  const bodyRoom = Math.max(1, height - fixedHeight - m.gap * gapCount)

  rowHeight *= items
  rampHeight *= items
  let rampLabelGap = m.rampLabelGap
  let rampLabelSize = m.rampLabelSize
  let finalBodyHeight = 0

  if (model.kind === 'rows' && model.rows.length > 0) {
    rowHeight = Math.min(rowHeight, bodyRoom / model.rows.length)
    finalBodyHeight = rowHeight * model.rows.length
  } else if (model.kind === 'ramp') {
    /*
     * The bar and its end labels are clamped *together*, in proportion.
     *
     * Clamping only the bar let the labels claim the room first, so past a point asking
     * for larger entries measured a shorter colour bar — the one reading of the control
     * nobody wants. Scaling the pair by a common factor keeps the ramp looking like a
     * ramp at every setting and lets it stop growing without going backwards.
     */
    const desired = rampHeight + rampLabelGap + rampLabelSize
    if (desired > bodyRoom) {
      const k = bodyRoom / desired
      rampHeight *= k
      rampLabelGap *= k
      rampLabelSize *= k
    }
    finalBodyHeight = rampHeight + rampLabelGap + rampLabelSize
  }

  /*
   * The gaps take whatever is genuinely left, which is what keeps the panel filled at
   * every item size: small entries open the spacing out, large ones close it up.
   */
  const leftover = Math.max(0, height - fixedHeight - finalBodyHeight - m.gap * gapCount)
  const gap = m.gap + leftover / gapCount

  const headerTop = pad
  const bodyY = headerTop + headerHeight + gap

  const title: TextBlock = {
    lines: titleLines,
    size: m.titleSize,
    lineHeight: m.titleLineHeight,
    baseline: baselineOf(headerTop, m.titleLineHeight, m.titleSize),
    x: m.headerX,
    width: m.headerWidth,
  }

  const subtitleTop = headerTop + titleLines.length * m.titleLineHeight
  const subtitle: TextBlock = {
    lines: subtitleLines,
    size: m.subtitleSize,
    lineHeight: m.subtitleLineHeight,
    baseline: baselineOf(subtitleTop, m.subtitleLineHeight, m.subtitleSize),
    x: m.headerX,
    width: m.headerWidth,
  }

  const icon = m.iconSize
    ? {
        x: pad,
        // Centred against the words it sits beside, so it reads as part of the header
        // rather than as something resting on top of it.
        y: headerTop + Math.max(0, (headerHeight - m.iconSize) / 2),
        size: m.iconSize,
      }
    : null

  let body: RampBody | RowsBody
  let bodyHeight: number

  if (model.kind === 'ramp') {
    const labelTop = bodyY + rampHeight + rampLabelGap
    body = {
      kind: 'ramp',
      y: bodyY,
      height: rampHeight,
      x: pad,
      width: inner,
      // Steps divide the full inner width, so a wider panel is a wider palette with
      // wider steps rather than the same bar with space beside it.
      stepWidth: inner / Math.max(1, model.colors.length),
      radius: tokens.ramp.radius * scale,
      labelSize: rampLabelSize,
      labelBaseline: baselineOf(labelTop, rampLabelSize * 1.2, rampLabelSize),
    }
    bodyHeight = rampHeight + rampLabelGap + rampLabelSize
  } else {
    /*
     * The swatch is a proportion of the row, not a size of its own.
     *
     * That is what keeps each style's look intact as the legend grows: Modern's swatch
     * is half its row height and stays half of it at every size, and the swatch grows
     * with the slack the rows absorbed rather than staying a chip in an empty band.
     */
    const swatch = Math.min(rowHeight * (tokens.row.swatch / tokens.row.height), rowHeight * 0.78)
    const labelSize = m.rowLabelSize
    const labelX = pad + swatch + m.rowLabelGap
    const labels = model.rows.map((row) => {
      const detailWidth = row.detail ? textWidth(row.detail, labelSize) + m.rowLabelGap : 0
      const room = pad + inner - labelX - detailWidth
      return {
        label: fitOneLine(row.label, Math.max(12, room), labelSize),
        detail: row.detail ?? '',
      }
    })
    body = {
      kind: 'rows',
      y: bodyY,
      rowHeight,
      swatch,
      swatchRadius: Math.min(tokens.row.swatchRadius * scale * sizes.items, swatch / 2),
      labelSize,
      labelX,
      x: pad,
      width: inner,
      labels,
    }
    bodyHeight = rowHeight * model.rows.length
  }

  const noteTop = bodyY + bodyHeight + gap
  const note: TextBlock = {
    lines: noteLines,
    size: m.noteSize,
    lineHeight: m.noteLineHeight,
    baseline: baselineOf(noteTop, m.noteLineHeight, m.noteSize),
    x: pad,
    width: inner,
  }

  return { scale, pad, title, subtitle, note, icon, body, contentHeight }
}

/**
 * The size a model wants at its natural scale, used when the author has not set one.
 *
 * Measured at exactly 1 rather than solved: an unbounded height would let the solve run
 * to the ceiling and report the largest legend allowed instead of the one the content
 * asks for.
 */
export function naturalLegendSize(
  model: LegendModel,
  tokens: LegendStyleTokens,
  sizes: LegendElementSizes,
  width: number,
): { width: number; height: number } {
  // Height is unbounded here, so the icon's height cap cannot bite; the width cap and
  // the multiplier are what decide its size, which is what "natural" should mean.
  return {
    width,
    height: Math.ceil(measure(model, tokens, sizes, width, Number.POSITIVE_INFINITY, 1).total),
  }
}
