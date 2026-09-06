/**
 * Legend styles, as tokens rather than as components.
 *
 * A style is a set of measurements and colours plus, optionally, a decoration. The
 * renderer reads those tokens and draws one legend; adding a style means adding an
 * entry here, not another component with its own copy of the layout, the text fitting
 * and the resize handling. That is the difference between four styles and four legends
 * that happen to look similar.
 *
 * Colours come in two forms. Most are literal, because a style like the parchment one
 * is a deliberate look rather than a reading of the map theme; `null` means "take the
 * document's own legend colour", which is how Classic stays exactly what it was under
 * every theme.
 */
import { LABEL_FONTS } from '../types/map'
import type { LegendConfig, MapStyle } from '../types/map'

export type LegendStyleId = 'classic' | 'modern' | 'minimal' | 'historical'

export interface LegendStyleTokens {
  id: LegendStyleId
  name: string

  /**
   * The face the panel is set in.
   *
   * On the tokens rather than as a constant in the renderer because the *measurement*
   * needs it too: the layout wraps and ellipsises against a real text metric, and a
   * legend measured in one face and drawn in another wraps in the wrong places. The two
   * used to be separate constants that did not even agree with each other.
   */
  font: string

  /** The panel itself. `null` on a colour defers to the document's legend palette. */
  surface: {
    fill: string | null
    fillOpacity: number
    stroke: string | null
    strokeOpacity: number
    strokeWidth: number
    radius: number
  }
  /** Ink for text, or `null` to take the document's legend text colour. */
  ink: string | null

  /** Space inside the panel edge, and between blocks. */
  pad: number
  gap: number

  title: {
    size: number
    weight: number
    letterSpacing: number
    /** Small caps is Classic's signature; the others set the title as written. */
    uppercase: boolean
    lineHeight: number
  }
  subtitle: { size: number; opacity: number; lineHeight: number }
  /** A ramp's bar and the labels beneath it. */
  ramp: { height: number; labelSize: number; labelGap: number; radius: number }
  /** A row of swatch + label, as used by thresholds and comparison groups. */
  row: { height: number; labelSize: number; swatch: number; swatchRadius: number }
  /** The author's free line, set under the body. */
  note: { size: number; opacity: number; lineHeight: number }
  /** The icon element's natural side, before the author's own multiplier. */
  icon: { size: number }

  /** Drawn behind the content. Receives the panel box so it can fit itself to it. */
  decoration?: (box: { width: number; height: number; ink: string }) => DecorationSpec
}

/**
 * A decoration, described rather than drawn.
 *
 * Paths and their paint, in the panel's own coordinates, so the renderer can place them
 * behind the content without the style needing to know anything about React.
 */
export interface DecorationSpec {
  paths: { d: string; fill?: string; stroke?: string; strokeWidth?: number; opacity?: number }[]
}

/**
 * A serpent, drawn to the panel rather than placed on it.
 *
 * The body runs along the bottom and right edges — the two the content leaves clear,
 * since the title sits top-left and rows run left-aligned down the panel — so it frames
 * the legend instead of sitting under the words. The head rests in the bottom-right
 * corner, the tail curls off the top-right, and every coordinate is derived from the
 * current width and height, so resizing re-draws it rather than stretching it.
 *
 * Kept to a thin outline at low opacity: it has to read as an engraving on the
 * parchment, not as an illustration the data is competing with.
 */
function serpent({ width, height, ink }: { width: number; height: number; ink: string }): DecorationSpec {
  const w = width
  const h = height
  // Inset the frame so the body sits between the panel edge and the content.
  const m = 3.5
  const r = Math.min(10, h / 4)

  // The body: up the right edge, round the bottom-right, along the bottom.
  const body =
    `M ${w - m} ${m + r * 1.4}` +
    ` C ${w - m} ${h * 0.45}, ${w - m - 1.5} ${h * 0.62}, ${w - m} ${h - m - r}` +
    ` Q ${w - m} ${h - m}, ${w - m - r} ${h - m}` +
    ` L ${m + r * 1.6} ${h - m}` +
    ` Q ${m} ${h - m}, ${m} ${h - m - r * 0.7}`

  // The tail, curling off the top-right corner and back on itself.
  const tail =
    `M ${w - m} ${m + r * 1.4}` +
    ` C ${w - m} ${m + r * 0.3}, ${w - m - r * 0.4} ${m}, ${w - m - r * 1.1} ${m + r * 0.2}` +
    ` C ${w - m - r * 1.7} ${m + r * 0.5}, ${w - m - r * 1.5} ${m + r * 1.1}, ${w - m - r * 0.8} ${m + r}`

  // The head, tucked into the bottom-left where the body ends.
  const hx = m
  const hy = h - m - r * 0.7
  const head =
    `M ${hx} ${hy}` +
    ` c -2.6 -0.2, -4.4 -2.0, -4.2 -4.2` +
    ` c 0.2 -2.0, 2.0 -3.5, 4.0 -3.4` +
    ` c 2.2 0.1, 3.8 2.0, 3.6 4.2` +
    ` c -0.1 1.9, -1.6 3.3, -3.4 3.4 Z`

  return {
    paths: [
      { d: body, stroke: ink, strokeWidth: 1.6, opacity: 0.3 },
      { d: body, stroke: ink, strokeWidth: 0.5, opacity: 0.45 },
      { d: tail, stroke: ink, strokeWidth: 1.2, opacity: 0.28 },
      { d: head, fill: ink, opacity: 0.32 },
      // The eye, which is what makes it read as a creature rather than a squiggle.
      { d: `M ${hx - 1.4} ${hy - 4.6} a 0.7 0.7 0 1 0 0.01 0`, fill: ink, opacity: 0.75 },
    ],
  }
}

const DEFAULT_FONT =
  "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"

export const LEGEND_STYLES: Record<LegendStyleId, LegendStyleTokens> = {
  /**
   * What the legend has always been. Its numbers are the ones the previous layout used,
   * so choosing Classic reproduces the old legend rather than approximating it.
   */
  classic: {
    font: DEFAULT_FONT,
    id: 'classic',
    name: 'Classic',
    surface: {
      fill: null,
      fillOpacity: 0.92,
      stroke: null,
      strokeOpacity: 0.5,
      strokeWidth: 1,
      radius: 6,
    },
    ink: null,
    pad: 10,
    gap: 3,
    title: { size: 10, weight: 600, letterSpacing: 0.04, uppercase: true, lineHeight: 12 },
    subtitle: { size: 9, opacity: 0.62, lineHeight: 11 },
    ramp: { height: 11, labelSize: 9, labelGap: 3, radius: 0 },
    row: { height: 17, labelSize: 9.5, swatch: 9, swatchRadius: 2 },
    note: { size: 8.5, opacity: 0.55, lineHeight: 10.5 },
    icon: { size: 16 },
  },

  modern: {
    font: DEFAULT_FONT,
    id: 'modern',
    name: 'Modern',
    surface: {
      fill: null,
      fillOpacity: 0.96,
      stroke: null,
      strokeOpacity: 0.22,
      strokeWidth: 1,
      radius: 12,
    },
    ink: null,
    pad: 14,
    gap: 6,
    title: { size: 11.5, weight: 650, letterSpacing: 0, uppercase: false, lineHeight: 14 },
    subtitle: { size: 9.5, opacity: 0.55, lineHeight: 12.5 },
    ramp: { height: 9, labelSize: 9, labelGap: 6, radius: 4.5 },
    row: { height: 20, labelSize: 10, swatch: 10, swatchRadius: 5 },
    note: { size: 9, opacity: 0.5, lineHeight: 11.5 },
    icon: { size: 20 },
  },

  minimal: {
    font: DEFAULT_FONT,
    id: 'minimal',
    name: 'Minimal',
    surface: {
      fill: null,
      // Barely there: enough to hold the text off the map, no more.
      fillOpacity: 0.55,
      stroke: null,
      strokeOpacity: 0,
      strokeWidth: 0,
      radius: 3,
    },
    ink: null,
    pad: 8,
    gap: 4,
    title: { size: 10, weight: 600, letterSpacing: 0.02, uppercase: false, lineHeight: 12 },
    subtitle: { size: 9, opacity: 0.5, lineHeight: 11 },
    ramp: { height: 6, labelSize: 8.5, labelGap: 4, radius: 3 },
    row: { height: 15, labelSize: 9, swatch: 7, swatchRadius: 3.5 },
    note: { size: 8, opacity: 0.45, lineHeight: 10 },
    icon: { size: 14 },
  },

  historical: {
    font: DEFAULT_FONT,
    id: 'historical',
    name: 'Historical',
    surface: {
      // Literal parchment, not the theme's panel: the look is the point of the style.
      fill: '#efe3c8',
      fillOpacity: 0.97,
      stroke: '#8a6f47',
      strokeOpacity: 0.85,
      strokeWidth: 1.2,
      radius: 3,
    },
    ink: '#4a3a24',
    pad: 13,
    gap: 5,
    title: { size: 11, weight: 700, letterSpacing: 0.09, uppercase: true, lineHeight: 13.5 },
    subtitle: { size: 9, opacity: 0.72, lineHeight: 11.5 },
    ramp: { height: 10, labelSize: 8.5, labelGap: 4, radius: 0 },
    row: { height: 18, labelSize: 9.5, swatch: 9, swatchRadius: 1 },
    note: { size: 8.5, opacity: 0.6, lineHeight: 10.5 },
    icon: { size: 18 },
    decoration: serpent,
  },
}

export const LEGEND_STYLE_IDS = Object.keys(LEGEND_STYLES) as LegendStyleId[]

/**
 * The chosen style, with the author’s own settings folded into it.
 *
 * Everything the legend can be customised about is expressed here as a change to the
 * style tokens, and that is the whole of the integration: the layout, the fitting, the
 * cache and the renderer already read tokens, so spacing, colour, border weight and the
 * face all reach them without a single one of those needing to learn a new concept.
 *
 * The result must be memoised by the caller. The layout cache compares tokens by
 * identity, so a fresh object every render would quietly turn the cache off.
 */
export function legendTokens(legend: LegendConfig): LegendStyleTokens {
  const base = LEGEND_STYLES[legend.style] ?? LEGEND_STYLES.classic
  const spacing = legend.spacing > 0 ? legend.spacing : 1
  const stack = (LABEL_FONTS.find((f) => f.id === legend.font) ?? LABEL_FONTS[0]).stack
  return {
    ...base,
    font: stack,
    pad: base.pad * spacing,
    gap: base.gap * spacing,
    ink: legend.ink ?? base.ink,
    surface: {
      ...base.surface,
      fill: legend.surface ?? base.surface.fill,
      stroke: legend.border ?? base.surface.stroke,
      strokeWidth: base.surface.strokeWidth * legend.borderWidth,
    },
  }
}

/** Resolves a style's `null` colours against the document's own legend palette. */
export function resolveLegendPaint(tokens: LegendStyleTokens, style: MapStyle) {
  return {
    surfaceFill: tokens.surface.fill ?? style.legendSurface,
    surfaceStroke: tokens.surface.stroke ?? style.border,
    ink: tokens.ink ?? style.legendText,
  }
}
