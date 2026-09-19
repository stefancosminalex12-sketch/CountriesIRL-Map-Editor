/**
 * Built-in templates: fixed presets that set up the editor for a kind of map in one click.
 *
 * Not user templates. There is nothing to create, save, sync or sign in to: each template is a
 * constant in this file, and applying one writes its settings into the open map through the same
 * operations the controls use — so it is validated like any edit, and changing any setting by hand
 * afterwards works exactly as it always does.
 *
 * **Keyed by setting, not by control.** A template names the document's own settings — `flags`,
 * `style`, `labels`, the colouring mode — never a panel, a switch or a component, so rearranging
 * the sidebar cannot break one. Only what a template names is changed; everything else about the
 * map (its data, groups, merges, overlays, colours, region, projection) is left as it is.
 *
 * **Fixed.** Every template is deep-frozen, and applying one builds fresh operations from it, so
 * nothing — applying another template, changing settings by hand, undoing — can alter the preset
 * itself. The same template applied twice gives the same map settings both times.
 *
 * Adding one is adding an entry to `TEMPLATES`.
 */
import type { MapOperation } from './operations'
import type { CountryLabels, FlagMode, MapDocument, MapStyle } from '../types/map'
import type { LoadedDataset } from '../geo/datasets'
import { colourModeOps, type ColourMode } from './colourMode'
import { levelName, levelOf, PREDEFINED_DATASETS, predefinedDataOps } from '../data/predefinedData'

/** The sidebar sections a template can open once applied, by their stable ids. */
export type TemplateSection = 'maps' | 'select' | 'edit' | 'display' | 'data' | 'overlays' | 'legend' | 'canvas'

/**
 * A template that asks one thing first: which of its options.
 *
 * The options are a list the template reads from somewhere else — Predefined Data lists the
 * datasets in `data/predefinedData.ts` — so adding an option never touches the template or the
 * panel. An option can be unavailable on the map that is open, and says why.
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
  }
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
 * **World Domination** — a map of flags where countries take each other's.
 *
 * - Flags mode, so every country flies its flag, with the World Domination override armed but no
 *   dominating country chosen yet: every country keeps its own flag until one is picked, and the
 *   picker is right there in Styles & Data.
 * - Borders off, so a country that has taken its neighbours reads as one territory; coastlines stay,
 *   so the land still has its shape. High-Contrast Borders off for the same reason.
 * - Island water off, and names, data values and group values off: a flag map says it with flags.
 * - Water regions off, so a click on the sea never gets in the way of picking countries.
 *
 * It opens Styles & Data, where a selected country's flag is changed (Change Flag) and the
 * dominating flag is chosen.
 */
const WORLD_DOMINATION: MapTemplate = {
  id: 'world-domination',
  name: 'World Domination',
  description: 'Flags on every country, borders off, and the World Domination flag ready to choose.',
  settings: {
    colourMode: 'flags',
    flags: {
      worldDomination: true,
      dominationCountryId: null,
      internationalBorders: false,
      islandWater: false,
    },
    style: {
      showBorders: false,
      showCoastlines: true,
      showWaterRegions: false,
    },
    labels: {
      enabled: false,
      values: false,
      compareValues: false,
    },
  },
  openSection: 'data',
  next: 'Select countries and use Change Flag to give them a flag, or choose one flag to cover the whole world.',
}

/**
 * **Predefined Data** — a published dataset on the map, with nothing typed in.
 *
 * One template for every dataset: it asks which (HDI, GDP per capita, inflation, population, and
 * whatever `data/predefinedData.ts` lists later), then fills the open map with that dataset's real
 * values for the entities it shows — the world's countries, or the USA's states or counties — and
 * turns on Data mode's Predefined scale with the dataset's own fixed thresholds. It is the fast way
 * into Data → Predefined, which is still there on its own; Data → Palette, where the author types
 * values and the scale follows their range, is untouched.
 */
const PREDEFINED_DATA: MapTemplate = {
  id: 'predefined-data',
  name: 'Predefined Data',
  description: 'Choose a published dataset and its values appear on the map, on fixed thresholds.',
  settings: {},
  choices: {
    prompt: 'Choose a dataset',
    options: PREDEFINED_DATASETS.map((dataset) => ({ id: dataset.id, name: dataset.name, detail: dataset.description })),
    unavailable: (optionId, geo) => {
      const dataset = PREDEFINED_DATASETS.find((d) => d.id === optionId)
      const level = levelOf(geo)
      if (!dataset) return 'Unknown dataset'
      if (!level) return 'No values for this map’s entities — it is published for countries and US states or counties'
      return dataset.presets[level] ? null : `Not published for ${levelName(level)}`
    },
    build: async (optionId, doc, geo) => {
      const dataset = PREDEFINED_DATASETS.find((d) => d.id === optionId)
      if (!dataset) return { error: 'Unknown dataset.' }
      const applied = await predefinedDataOps(dataset, doc, geo)
      if (!applied) return { error: `${dataset.name} has no values for this map’s entities.` }
      return {
        ops: applied.ops,
        message: `${dataset.name} on ${applied.count} ${levelName(applied.level)} (${applied.year}).`,
      }
    },
  },
  openSection: 'data',
  next: 'Switch the region and the values follow; Data → Palette still takes values of your own.',
}

/** Every built-in template, in the order the list shows them. */
export const TEMPLATES: readonly MapTemplate[] = frozen([WORLD_DOMINATION, PREDEFINED_DATA])

/**
 * The operations that apply a template to a document: fresh objects every time, built from the
 * frozen preset and the document as it is now, dispatched together so they are one edit.
 */
export function templateOps(template: MapTemplate, doc: MapDocument): MapOperation[] {
  const { settings } = template
  const ops: MapOperation[] = []
  if (settings.colourMode) ops.push(...colourModeOps(doc, settings.colourMode))
  if (settings.flags) ops.push({ op: 'set_flags', patch: { ...settings.flags } })
  if (settings.style) ops.push({ op: 'set_style', patch: { ...settings.style } })
  if (settings.labels) ops.push({ op: 'set_labels', patch: { ...settings.labels } })
  return ops
}
