/**
 * Built-in templates: fixed presets that set up the editor for a kind of map in one click.
 *
 * Not user templates. There is nothing to create, save, sync or sign in to: each template is a
 * constant in this file, and applying one writes its settings into the open map through the same
 * operations the controls use — so it is validated like any edit, and changing any setting by hand
 * afterwards works exactly as it always does.
 *
 * **Keyed by setting, not by control.** A template names the document's own settings — `style`,
 * `labels`, the colouring mode, the region — never a panel, a switch or a component, so rearranging
 * the sidebar cannot break one. Only what a template names is changed; everything else about the
 * map is left as it is.
 *
 * **Fixed.** Every template is deep-frozen, and applying one builds fresh operations from it, so
 * nothing — applying another template, changing settings by hand, undoing — can alter the preset
 * itself. The same template applied twice gives the same map settings both times.
 *
 * Adding one is adding an entry to `TEMPLATES`.
 */
import type { MapOperation } from './operations'
import type { CountryLabels, FlagMode, LegendConfig, MapDocument, MapStyle, ProjectionId, RegionId, StickerMode } from '../types/map'
import type { LoadedDataset } from '../geo/datasets'
import { colourModeOps, type ColourMode } from './colourMode'

/** The sidebar sections a template can open once applied, by their stable ids. */
export type TemplateSection = 'select' | 'merge' | 'hide' | 'overlay' | 'data' | 'legend' | 'canvas'

/**
 * A template that asks one thing first: which of its options.
 *
 * The options are a list the template reads from somewhere else, so adding an option never touches
 * the template or the panel. An option can be unavailable on the map that is open, and says why.
 */
export interface TemplateChoices {
  /** What the list asks, above it. */
  prompt: string
  options: readonly { id: string; name: string; detail: string }[]
  /** Null when the option applies to the open map; otherwise the reason it does not. */
  unavailable: (optionId: string, geo: LoadedDataset | null) => string | null
  /** The operations for one option on the open map, and what to say afterwards. */
  build: (
    optionId: string,
    doc: MapDocument,
    geo: LoadedDataset | null,
  ) => Promise<{ ops: MapOperation[]; message: string } | { error: string }>
}

/**
 * A square composition frame placed round the geography rather than at fixed pixels: its left edge
 * just west of `west`, its top just above the highest of `top`, its bottom just below the lowest of
 * `bottom` — measured on the map as drawn once the template's region and projection are in, so it
 * lands in the same place on every screen. See `TemplatePicker`.
 */
export interface TemplateFrame {
  west: readonly [number, number][]
  top: readonly [number, number][]
  bottom: readonly [number, number][]
  /**
   * Where the square, at the size the points above give it, is then placed: its top just above
   * this territory's main landmass and its left edge just west of that one's — the whole of each
   * in the picture, measured on its outline as drawn rather than at a point.
   */
  place?: { topOf: string; westOf: string }
}

export interface MapTemplate {
  /** Stable id: never shown, never changed once a template ships. */
  id: string
  name: string
  /** One sentence: what the template sets the editor up for. */
  description: string
  /** What it sets, by the document's own setting names. Absent means "leave as it is". */
  settings: {
    /** The colouring mode — Off, Data, Compare or Flags — moved exactly as the mode chips move it. */
    colourMode?: ColourMode
    flags?: Partial<Omit<FlagMode, 'enabled' | 'overrides'>>
    style?: Partial<MapStyle>
    labels?: Partial<CountryLabels>
    regions?: RegionId[]
    projection?: ProjectionId
    palette?: string
    legend?: Partial<LegendConfig>
    stickers?: Partial<Pick<StickerMode, 'enabled' | 'auto' | 'moods'>>
    uploadDefaults?: MapDocument['uploadDefaults']
    exportTransparent?: boolean
  }
  /** A square frame, placed once the map is drawn. */
  frame?: TemplateFrame
  /** When present, the template asks which option first; see {@link TemplateChoices}. */
  choices?: TemplateChoices
  /** The section to open afterwards: where the work the template sets up is done. */
  openSection?: TemplateSection
  /** Shown once applied: what to do next. */
  next: string
}

/** Freezes a template and everything in it, so no code path can edit a built-in. */
function frozen<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) frozen((value as Record<string, unknown>)[key])
    Object.freeze(value)
  }
  return value
}

/**
 * **Europe Mapping** — the "Is your country richer than Romania?" video, set up in one click.
 *
 * - Europe, in Albers (conic equal-area), in a 1:1 frame from Portugal's coast and Iceland's top
 *   down to Crete and Cyprus.
 * - Data on, Custom, the Moods colours; and so an uploaded SVG's numbers go straight onto that
 *   scale with the faces on — whatever colours the file has — and the legend stays off, for the
 *   first upload and every one after (`uploadDefaults`).
 * - Coastlines on, at the usual 0.8; borders at twice the usual width (1.6) for a phone screen.
 * - Export with Transparent background on, so the map drops onto the video as it is.
 */
const EUROPE_MAPPING: MapTemplate = {
  id: 'europe-mapping',
  name: 'Europe Mapping',
  description: 'Europe in Albers, a square frame, Moods colours and faces, no legend, transparent export.',
  settings: {
    colourMode: 'data',
    regions: ['europe'],
    projection: 'conicEqualArea',
    palette: 'moods-9',
    legend: { visible: false },
    // Borders doubled for a phone screen, where a hairline is lost; the coast stays at 0.8.
    style: { showCoastlines: true, borderWidth: 1.6, coastlineWidth: 0.8 },
    stickers: { enabled: true, auto: false, moods: true },
    uploadDefaults: { moods: true, legend: false },
    exportTransparent: true,
  },
  frame: {
    // Cabo da Roca, Portugal's westmost point.
    west: [[-9.5, 38.78]],
    // Iceland's north coast, and Norway's North Cape.
    top: [[-16.1, 66.55], [25.8, 71.2]],
    // Crete's and Cyprus's south coasts, and Malta.
    bottom: [[24.7, 34.8], [32.9, 34.56], [14.4, 35.8]],
    // Then moved so all of Iceland and all of mainland Portugal are in, at the same size.
    place: { topOf: 'ISL', westOf: 'PRT' },
  },
  openSection: 'data',
  next: 'Upload your SVG with the data and the faces appear; right-click a country to make it the main one.',
}

/** Every built-in template, in the order the list shows them. */
export const TEMPLATES: readonly MapTemplate[] = frozen([EUROPE_MAPPING])

/**
 * The operations that apply a template to a document: fresh objects every time, built from the
 * frozen preset and the document as it is now, dispatched together so they are one edit.
 */
export function templateOps(template: MapTemplate, doc: MapDocument): MapOperation[] {
  const { settings } = template
  const ops: MapOperation[] = []
  if (settings.regions) ops.push({ op: 'set_scope_regions', regionIds: [...settings.regions] })
  if (settings.projection) ops.push({ op: 'set_scope_projection', projectionId: settings.projection })
  if (settings.colourMode) ops.push(...colourModeOps(doc, settings.colourMode))
  if (settings.palette) ops.push({ op: 'set_active_palette', paletteId: settings.palette })
  if (settings.flags) ops.push({ op: 'set_flags', patch: { ...settings.flags } })
  if (settings.style) ops.push({ op: 'set_style', patch: { ...settings.style } })
  if (settings.labels) ops.push({ op: 'set_labels', patch: { ...settings.labels } })
  if (settings.legend) ops.push({ op: 'set_legend', patch: { ...settings.legend } })
  if (settings.stickers) ops.push({ op: 'set_stickers', patch: { ...settings.stickers } })
  if (settings.uploadDefaults) ops.push({ op: 'set_upload_defaults', patch: { ...settings.uploadDefaults } })
  if (settings.exportTransparent !== undefined) {
    ops.push({ op: 'set_export_transparent', transparent: settings.exportTransparent })
  }
  return ops
}
