/**
 * Predefined datasets: real published figures, ready to put on the map in one step.
 *
 * Each dataset is an entry below — its name, its unit, and which fixed-threshold scale (see
 * `state/presets.ts`) suits each *level* it has values at — plus a JSON file of values in
 * `./predefined/`, built from the publishers' own releases by `scripts/build-predefined-data.mjs`.
 * The file is imported only when the dataset is applied, so the page never loads data nobody asked
 * for. Adding a dataset is a new file from the build script and a new entry in
 * `PREDEFINED_DATASETS`; the Templates panel lists whatever is here.
 *
 * **Levels.** Values are keyed by the entity ids the maps already use, grouped by what the entities
 * are: countries (ISO 3166-1 alpha-3), US states (both USA maps' ids) and US counties (FIPS). The
 * map on screen decides the level — a world map takes the countries' values, the USA map the states'
 * — and every entity of the map with a value gets it, whatever region is framed: a map of Europe
 * shows Europe's values, and reframing it to the world shows the world's without applying anything
 * again. A map whose entities no dataset describes — the administrative world's provinces, the US
 * county subdivisions — is told so rather than given values that belong to something else.
 */
import type { LoadedDataset } from '../geo/datasets'
import type { MapDocument } from '../types/map'
import type { MapOperation } from '../state/operations'
import { colourModeOps } from '../state/colourMode'

export type DatasetLevel = 'countries' | 'us-states' | 'us-counties'

/** What a dataset's file holds. */
export interface PredefinedValues {
  source: string
  year: string
  levels: Partial<Record<DatasetLevel, Record<string, number>>>
}

export interface PredefinedDataset {
  /** Stable id: the file's name, never shown. */
  id: string
  name: string
  /** One line: what the number is. */
  description: string
  /** How a value is printed on the map (Display → Data Values): "$", "%", or nothing. */
  unit: string
  /** The fixed-threshold scale for each level the dataset has values at. */
  presets: Partial<Record<DatasetLevel, string>>
  /** Who published it, short, for the legend's subtitle. */
  credit: Partial<Record<DatasetLevel, string>>
  load: () => Promise<PredefinedValues>
}

/** How to tell which level a map's entities are, from their ids alone. */
const LEVEL_IDS: Record<DatasetLevel, RegExp> = {
  countries: /^[A-Z]{3}$/,
  'us-states': /^(US-[A-Z]{2}|state-\d{2})$/,
  'us-counties': /^county-\d{5}$/,
}

/**
 * The level of the map that is loaded: the one most of its entities' ids are, or null for a map
 * of something no dataset describes. Decided from the ids, not from a list of maps, so a future
 * map of countries or of US states is covered without anything here changing.
 */
export function levelOf(geo: LoadedDataset | null): DatasetLevel | null {
  if (!geo || geo.features.length === 0) return null
  let best: DatasetLevel | null = null
  let bestCount = 0
  for (const level of Object.keys(LEVEL_IDS) as DatasetLevel[]) {
    let count = 0
    for (const feature of geo.features) if (LEVEL_IDS[level].test(feature.properties.countryId)) count++
    if (count > bestCount) {
      best = level
      bestCount = count
    }
  }
  return best && bestCount >= geo.features.length * 0.5 ? best : null
}

const LEVEL_NAMES: Record<DatasetLevel, string> = {
  countries: 'countries',
  'us-states': 'US states',
  'us-counties': 'US counties',
}

export const levelName = (level: DatasetLevel) => LEVEL_NAMES[level]

export const PREDEFINED_DATASETS: readonly PredefinedDataset[] = Object.freeze([
  {
    id: 'hdi',
    name: 'HDI',
    description: 'Human Development Index, 0–1',
    unit: '',
    presets: { countries: 'hdi' },
    credit: { countries: 'UNDP' },
    load: () => import('./predefined/hdi.json').then((m) => m.default as PredefinedValues),
  },
  {
    id: 'gdp-per-capita',
    name: 'GDP per capita',
    description: 'Current US dollars',
    unit: '$',
    presets: { countries: 'gdp-per-capita' },
    credit: { countries: 'World Bank' },
    load: () => import('./predefined/gdp-per-capita.json').then((m) => m.default as PredefinedValues),
  },
  {
    id: 'inflation',
    name: 'Inflation',
    description: 'Consumer prices, annual %',
    unit: '%',
    presets: { countries: 'inflation' },
    credit: { countries: 'World Bank' },
    load: () => import('./predefined/inflation.json').then((m) => m.default as PredefinedValues),
  },
  {
    id: 'population',
    name: 'Population',
    description: 'People',
    unit: '',
    presets: { countries: 'population', 'us-states': 'population-us-states', 'us-counties': 'population-us-counties' },
    credit: { countries: 'World Bank', 'us-states': 'US Census Bureau', 'us-counties': 'US Census Bureau' },
    load: () => import('./predefined/population.json').then((m) => m.default as PredefinedValues),
  },
])

export interface PredefinedApplied {
  ops: MapOperation[]
  /** How many of the map's entities got a value. */
  count: number
  level: DatasetLevel
  year: string
}

/**
 * The operations that put a dataset on the open map: its values on every entity of the map that
 * has one, the layer's old values cleared first so nothing stale is left, Data mode on the
 * Predefined (fixed-threshold) scale with the dataset's own bands for this level, the layer named
 * and given the dataset's unit, and the legend shown with its source and year. One batch, so one
 * edit — and Data mode's relative Palette is left exactly as it was, one chip away.
 *
 * Null when the dataset has no values for this map's entities.
 */
export async function predefinedDataOps(
  dataset: PredefinedDataset,
  doc: MapDocument,
  geo: LoadedDataset | null,
): Promise<PredefinedApplied | null> {
  const level = levelOf(geo)
  if (!geo || !level) return null
  const presetId = dataset.presets[level]
  if (!presetId) return null
  const data = await dataset.load()
  const table = data.levels[level]
  if (!table) return null

  const layer = doc.layers.find((l) => l.id === doc.activeLayerId) ?? doc.layers[0]
  const ops: MapOperation[] = []
  for (const [id, entry] of Object.entries(doc.countries)) {
    const old = entry.properties[layer.dataKey]
    if (old !== undefined && old !== null && geo.byId.has(id)) ops.push({ op: 'clear_country_value', countryId: id, layerId: layer.id })
  }
  let count = 0
  for (const feature of geo.features) {
    const id = feature.properties.countryId
    const value = table[id]
    if (value === undefined || !Number.isFinite(value)) continue
    ops.push({ op: 'set_country_value', countryId: id, value, layerId: layer.id })
    count++
  }
  if (count === 0) return null

  const year = data.year.split(/[\s;(]/)[0]
  ops.push(...colourModeOps(doc, 'data', 'threshold'))
  ops.push({ op: 'set_active_preset', presetId })
  ops.push({ op: 'set_layer', layerId: layer.id, patch: { name: dataset.name, unit: dataset.unit } })
  ops.push({
    op: 'set_legend',
    patch: { visible: true, source: 'auto', entries: [], title: '', subtitle: `${dataset.credit[level] ?? data.source}, ${year}` },
  })
  return { ops, count, level, year: data.year }
}
