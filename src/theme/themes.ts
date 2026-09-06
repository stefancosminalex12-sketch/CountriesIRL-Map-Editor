/**
 * Theme definitions.
 *
 * A theme is two things kept deliberately apart:
 *
 *   - `ui`   — interface tokens, applied as CSS custom properties. Nothing in the
 *              components hardcodes a colour; they all read these variables.
 *   - `map`  — the map's own colours. These are map *content*, so they are applied
 *              through the normal `set_style` operation and live in the document,
 *              which is what keeps them in an eventual export.
 *
 * The surface ladder matters as much as the hue. Every theme defines five distinct
 * levels — app backdrop, sidebar, panel, control, inset — with a large enough step
 * between them that the structure of the interface is legible without borders doing
 * all the work. Adding a theme means adding one entry here.
 */
import type { MapStyle } from '../types/map'

export type ThemeId = 'dark' | 'light' | 'geographic'

export interface UiTokens {
  /** Application backdrop, behind and between the panels. */
  bg: string
  /** Side panels. One step off the backdrop. */
  panel: string
  /** Section bodies inside a panel. */
  panelAlt: string
  /** Raised control surface — inputs, chips, buttons. */
  surface: string
  /** Control surface under the pointer. */
  surfaceHover: string
  /** Recessed surface, used for slider tracks and wells. */
  inset: string
  /** Dividers and control outlines. */
  line: string
  /** Stronger divider, for hovered controls. */
  lineStrong: string
  text: string
  textDim: string
  /** Accent used for active controls and focus rings. */
  accent: string
  /** Foreground drawn on top of the accent. */
  accentText: string
  /** Tint behind a subtly active row. */
  accentSoft: string
}

export interface Theme {
  id: ThemeId
  name: string
  description: string
  /** Sets the browser's built-in control colouring. */
  scheme: 'dark' | 'light'
  ui: UiTokens
  map: Pick<
    MapStyle,
    | 'background'
    | 'land'
    | 'border'
    | 'borderOnDark'
    | 'legendSurface'
    | 'legendText'
    | 'hover'
    | 'selected'
    | 'selectedOutline'
    | 'river'
    | 'outsideScopeColor'
    | 'graticule'
    | 'lake'
    | 'lakeOutline'
  >
  /** Whether this theme shows the graticule by default. */
  graticuleByDefault?: boolean
  /**
   * Closely related land tones used to keep neighbouring countries legible.
   *
   * These are a cartographic device for telling one country from the next — the same
   * job a political map's colouring does — and carry NO claim about the land itself.
   * They are not elevation. Country polygons contain no terrain data, and none is
   * invented here; see `terrain` for where real hypsometric shading would go.
   */
  landTints?: string[]
  /**
   * Reference ramps for real terrain and depth data, lowest/shallowest first.
   *
   * Nothing renders from these yet, and deliberately so: hypsometric land shading
   * needs an elevation raster and bathymetry needs sounding data, neither of which
   * country outlines provide. They are kept here so the palette is already decided
   * when such a dataset is added.
   */
  terrain?: string[]
  bathymetry?: string[]
}

/**
 * Dark — a graphite studio.
 *
 * Built on cool graphite rather than black: the backdrop sits around 12% lightness,
 * so the panels above it can step up several times and still stay comfortable. Text
 * is a soft blue-white, never pure. The accent is a muted slate blue that reads as
 * "selected" without glowing.
 */
const dark: Theme = {
  id: 'dark',
  name: 'Dark',
  description: 'Cool graphite surfaces with a muted slate accent.',
  scheme: 'dark',
  ui: {
    bg: '#1a1e24',
    panel: '#22272f',
    panelAlt: '#262c35',
    surface: '#2f3641',
    surfaceHover: '#3a424f',
    inset: '#191d23',
    line: '#39404b',
    lineStrong: '#4d5765',
    text: '#e2e6ec',
    textDim: '#9aa4b2',
    accent: '#6fa8dc',
    accentText: '#12171d',
    accentSoft: '#2b3a4b',
  },
  map: {
    background: '#161a20',
    land: '#39424e',
    // Graphite ink for light fills, a cool pale slate for dark ones. Together they
    // clear 3:1 against every palette stop; the old single '#242a33' managed 1.13
    // against the deep end of Blue and 1.09 against Red.
    border: '#0d1116',
    borderOnDark: '#93a1b3',
    // The panel and text tones this theme already uses in the chrome, restated as map
    // tokens: the legend lives inside the SVG, so it cannot read a CSS variable and
    // still survive being exported to a standalone file.
    legendSurface: '#22272f',
    legendText: '#e2e6ec',
    hover: '#4b5666',
    selected: '#6fa8dc',
    selectedOutline: '#cfe4f7',
    outsideScopeColor: '#22272e',
    graticule: '#2a313a',
    lake: '#23303d',
    lakeOutline: '#1b2530',
    river: '#3c6d8e',
  },
}

/**
 * Light — soft daylight, not a white page.
 *
 * The backdrop is a cool light grey and the panels sit lighter than it, so the eye
 * reads depth without a single field of white anywhere. Text is a blue-charcoal that
 * keeps strong contrast while staying softer than black.
 */
const light: Theme = {
  id: 'light',
  name: 'Light',
  description: 'Soft daylight greys with a calm blue accent.',
  scheme: 'light',
  ui: {
    bg: '#dcdfe4',
    panel: '#e9ebef',
    panelAlt: '#eef0f3',
    surface: '#f4f6f8',
    surfaceHover: '#fbfcfd',
    inset: '#d3d7dd',
    line: '#c6cad1',
    lineStrong: '#a3a9b3',
    text: '#242a33',
    textDim: '#657081',
    accent: '#3b7ea8',
    accentText: '#ffffff',
    accentSoft: '#d6e4ee',
  },
  map: {
    background: '#c9d8e2',
    land: '#f2f0ea',
    // A blue-charcoal rather than the old '#a8afb8', which measured 1.00 against the
    // middle of Red — the same luminance as the fill it was meant to divide.
    border: '#4f5762',
    borderOnDark: '#fdfeff',
    legendSurface: '#e9ebef',
    legendText: '#242a33',
    hover: '#e2ded2',
    selected: '#3b7ea8',
    selectedOutline: '#1b4c69',
    outsideScopeColor: '#e4e6e6',
    graticule: '#b4c6d2',
    lake: '#bcd3e2',
    lakeOutline: '#94b3c8',
    river: '#6f9fbb',
  },
}

/**
 * Geographic — a printed physical map.
 *
 * The chrome is warm stone and the map is a layered sea under natural land tones,
 * with the graticule on by default and hairline boundaries so the sheet reads as
 * cartography rather than as a UI with a green fill. `landTints` keeps neighbouring
 * countries distinguishable; it is not terrain shading, and no terrain is invented.
 */
const geographic: Theme = {
  id: 'geographic',
  name: 'Geographic',
  description: 'Warm stone interface over a printed physical map.',
  scheme: 'light',
  ui: {
    bg: '#cdc4b2',
    panel: '#ded6c6',
    panelAlt: '#e5ded0',
    surface: '#f0ebe0',
    surfaceHover: '#f8f5ee',
    inset: '#c2b8a4',
    line: '#b6ab93',
    lineStrong: '#95886d',
    text: '#2f2b23',
    textDim: '#6b6350',
    accent: '#38705f',
    accentText: '#ffffff',
    accentSoft: '#d3e0d8',
  },
  map: {
    background: '#8fb3c9',
    land: '#d8d3ae',
    // Both tones stay in the sheet's warm family so the printed look survives: a
    // sepia ink and an unbleached paper highlight, never neutral grey or white.
    border: '#4f4835',
    borderOnDark: '#f6f1de',
    legendSurface: '#ded6c6',
    legendText: '#2f2b23',
    hover: '#e6dfb8',
    selected: '#38705f',
    selectedOutline: '#1c3f35',
    outsideScopeColor: '#c9c7b4',
    graticule: '#7ba0b8',
    // Inland water shares the sea's colour family, as it would on a printed sheet,
    // with a deeper rim so each lake keeps a defined edge against the land.
    lake: '#8fb3c9',
    lakeOutline: '#63899f',
    river: '#4a7f9c',
  },
  graticuleByDefault: true,
  // Closely spaced natural tones — enough to separate neighbours, not enough to
  // suggest relief. Lowland straw through to a soft sage.
  landTints: ['#d8d3ae', '#cfcea6', '#d9d0a2', '#c9cca6', '#dcd6b4'],
  // Where hypsometric shading would go, given an elevation raster.
  terrain: ['#cfd8a8', '#bccb8f', '#cfc684', '#c3a86f', '#a6835c', '#87684f', '#f0ece6'],
  // Where bathymetry would go, given sounding data.
  bathymetry: ['#bcd8e6', '#9dc0d4', '#7ea6c0', '#628ba8', '#4a7190', '#365a78'],
}

/*
 * The order the settings panel lists them in, and the first is the base: `getTheme`
 * falls back to `THEMES[0]` for an id it does not recognise, so the default below and
 * the head of this array are deliberately the same theme rather than two independent
 * answers to "what is this application's base look".
 */
export const THEMES: Theme[] = [light, dark, geographic]

export const DEFAULT_THEME_ID: ThemeId = 'light'

export function getTheme(id: ThemeId): Theme {
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0]
}

/** Writes a theme's UI tokens onto the document root as CSS custom properties. */
export function applyUiTokens(theme: Theme): void {
  const root = document.documentElement
  for (const [name, value] of Object.entries(theme.ui)) {
    // camelCase token -> --kebab-case custom property
    root.style.setProperty(`--${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, value)
  }
  root.style.setProperty('color-scheme', theme.scheme)
  root.dataset.theme = theme.id
}
