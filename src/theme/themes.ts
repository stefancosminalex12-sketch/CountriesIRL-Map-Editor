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
  /**
   * The same surface as `panelAlt`, translucent, for a panel that floats over the map.
   *
   * An open tool panel used to be a wall: the map behind it was simply gone, which on a
   * phone is most of the map. It is glass now — around 70%, enough that coastlines, borders
   * and the colours being worked on are plainly visible through it, while the controls keep
   * their own opaque surfaces so nothing about reading them changed. Each theme sets its own
   * alpha rather than one being applied to all three: the light themes need more of
   * themselves to hold text over a busy map than the dark one does.
   */
  panelOverlay: string
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
 * Dark — midnight navy, lifted.
 *
 * The chrome is the author's two colours: the top bar, the rail and the panels are `#0b1624`, and
 * what is chosen in the interface is the off-white `#fefefc` with that navy as its text. Around
 * them every surface sits a step lighter than a pure midnight would — controls, wells and
 * hairlines readable at a glance rather than found by peering.
 *
 * The map is lifted most. Countries are a clear slate blue well above a navy sea, so the land is
 * the brightest large thing on the screen; borders are cut a little darker than the land, and a
 * hovered country goes a step brighter still. A selected territory is royal blue, edged in the
 * off-white. Land outside the chosen region sits between land and sea. Water is one hue
 * throughout — the sea, the lakes and the rivers — the rivers a lighter tone of it, so they read
 * as water and never as one more border.
 */
const dark: Theme = {
  id: 'dark',
  name: 'Dark',
  description: 'Midnight navy, lifted, with a royal-blue selection and an off-white accent.',
  scheme: 'dark',
  ui: {
    bg: '#0a1321',
    panel: '#0b1624',
    panelAlt: '#132136',
    panelOverlay: 'rgba(19, 33, 54, 0.74)',
    surface: '#1b2c44',
    surfaceHover: '#253a55',
    inset: '#08111d',
    line: '#2a3e58',
    lineStrong: '#425a78',
    text: '#f1f5f9',
    textDim: '#a3b2c4',
    accent: '#fefefc',
    accentText: '#0b1624',
    accentSoft: '#1f3350',
  },
  map: {
    background: '#14253b',
    land: '#334b68',
    // A shade under the land on the base map and on light data fills; a pale grey for data
    // fills dark enough to swallow it. See `resolveBorderColor`.
    border: '#1a2c42',
    borderOnDark: '#a3b2c4',
    // The chrome's panel and text, restated as map tokens: the legend lives inside the SVG, so
    // it cannot read a CSS variable and still survive being exported to a standalone file.
    legendSurface: '#0b1624',
    legendText: '#f1f5f9',
    hover: '#446285',
    selected: '#3478f6',
    selectedOutline: '#fefefc',
    outsideScopeColor: '#1f3249',
    graticule: '#1e324b',
    lake: '#14253b',
    lakeOutline: '#1a2c42',
    river: '#5487c0',
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
    panelOverlay: 'rgba(238, 240, 243, 0.70)',
    surface: '#f4f6f8',
    surfaceHover: '#fbfcfd',
    inset: '#d3d7dd',
    line: '#c6cad1',
    lineStrong: '#a3a9b3',
    // The author's navy for what is chosen and for the ink, and an off-white instead of pure white.
    text: '#0b1725',
    textDim: '#657081',
    accent: '#0b1725',
    accentText: '#fffffd',
    accentSoft: '#d5dbe3',
  },
  map: {
    // White water under light-grey land.
    background: '#ffffff',
    land: '#e6e6e6',
    // A blue-charcoal rather than the old '#a8afb8', which measured 1.00 against the
    // middle of Red — the same luminance as the fill it was meant to divide.
    border: '#4f5762',
    borderOnDark: '#fdfeff',
    legendSurface: '#e9ebef',
    legendText: '#242a33',
    // A step darker than the land, so the country under the pointer still shows.
    hover: '#d4d4d4',
    selected: '#3b7ea8',
    selectedOutline: '#1b4c69',
    // Between the land and the white water: still there, plainly not the region.
    outsideScopeColor: '#f2f2f2',
    graticule: '#b4c6d2',
    lake: '#ffffff',
    lakeOutline: '#c4c4c4',
    river: '#6f9fbb',
  },
}

/**
 * Geographic — a clean modern atlas, in teal.
 *
 * The accent is a deep teal (`#0e7c86`): the blue-green between the map's steel-blue and sage
 * country tones, and clear of its pale-blue water, so the chrome and the sheet read as one design.
 * Every chosen control — a chip, a tool on the rail, a slider — is that teal with off-white on it;
 * the panels are near-white with a breath of the same teal, and the text a deep teal-slate.
 * Champagne gold (`#C49A55`) is the second colour, kept for highlights on the map.
 *
 * The map is a political atlas sheet. Countries take four light tones — steel blue, sage, sand
 * and lavender (`landTints`) — assigned so that no two countries sharing a border take the same
 * one (`geo/metrics.ts`); four are enough because neighbours are read from real shared borders.
 * The water is a clean pale blue, the lakes the same water, and the rivers a deeper tone of that
 * blue so they plainly belong to it. Borders are a soft slate, hover a light teal, and a selected
 * territory the teal itself, edged in the gold. Land outside the chosen region drops to a quiet
 * pale grey, so the region keeps all the colour.
 */
const geographic: Theme = {
  id: 'geographic',
  name: 'Geographic',
  description: 'A clean modern atlas in teal: four light country tones on pale blue water.',
  scheme: 'light',
  ui: {
    bg: '#e4eded',
    panel: '#f3f8f7',
    panelAlt: '#f9fbfb',
    panelOverlay: 'rgba(249, 251, 251, 0.82)',
    surface: '#ffffff',
    surfaceHover: '#eaf4f3',
    inset: '#dae6e6',
    line: '#cfdcdc',
    lineStrong: '#a7bcbd',
    text: '#132a2f',
    textDim: '#566d72',
    accent: '#0e7c86',
    accentText: '#fefefc',
    accentSoft: '#d8eeee',
  },
  map: {
    background: '#e0eef8',
    land: '#a9c3db',
    // A soft slate on the light tones and on light data fills; near-white on dark data fills.
    border: '#8a9bb0',
    borderOnDark: '#f4f7fa',
    legendSurface: '#f3f8f7',
    legendText: '#132a2f',
    hover: '#86c5d3',
    selected: '#0e8a94',
    selectedOutline: '#c49a55',
    outsideScopeColor: '#eceff2',
    graticule: '#c6dcec',
    lake: '#e0eef8',
    lakeOutline: '#a9c8de',
    river: '#6aa6d6',
  },
  graticuleByDefault: true,
  // The four country tones, the first being `map.land`: steel blue, sage, sand, lavender.
  landTints: ['#a9c3db', '#bcd5c1', '#e4d7b8', '#cbc1e2'],
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
