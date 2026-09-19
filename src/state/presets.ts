/**
 * Predefined threshold scales.
 *
 * The other way to colour a number. The palette scale asks *"where does this country
 * sit between the lowest and highest value on this map?"* — it is relative, it moves
 * when the data moves, and it is the right question for a quantity that has no
 * external meaning. A threshold scale asks *"which band does this number fall in?"*,
 * and the bands come from the indicator's own published definition rather than from
 * whatever countries happen to be on screen.
 *
 * The difference matters most exactly where the relative scale misleads. Put the
 * twenty highest-HDI countries on a map and the relative scale will stretch them
 * across the whole ramp, painting the lowest of them in the colour it would give
 * Somalia. The threshold scale paints all twenty "Very high", because all twenty
 * *are* very high — the answer does not depend on who else is in the frame. Nothing
 * here reads `computeDomain`, and that is the entire point.
 *
 * ### Adding a preset
 *
 * Append a {@link ThresholdPreset} to {@link THRESHOLD_PRESETS}. Bands run low to
 * high, are contiguous, and the outermost two are open-ended, so every finite number
 * lands in exactly one. Nothing else in the app needs to change: the executor
 * validates against the ids here, the renderer looks the preset up by id, and the
 * panel renders whatever bands it finds. Obvious next candidates are GDP per capita,
 * population density, life expectancy, literacy and internet penetration — each is a
 * `name`, a `unit`, a `source` and a list of bands.
 *
 * ### Colours
 *
 * Band colours are categorical, not a ramp, and none of them is white or near it. A
 * threshold map's lowest band is a real reading — "this country is in the bottom
 * group" — and if it were drawn in paper white it would be indistinguishable from
 * "this country has no value at all", which is the one confusion a threshold scale
 * cannot afford. Countries with no value keep the theme's land colour, and that is
 * the only thing that ever does.
 */

/** One band of a threshold scale. Half-open: `min` inclusive, `max` exclusive. */
export interface ThresholdBand {
  /** Inclusive lower bound. `-Infinity` on the first band. */
  min: number
  /** Exclusive upper bound. `Infinity` on the last band. */
  max: number
  label: string
  color: string
}

export interface ThresholdPreset {
  id: string
  name: string
  /** What the number is, in one line. Shown under the selector. */
  description: string
  /** Suffix for readouts — `'%'`, `' yrs'`, `''`. */
  unit: string
  /** Where the thresholds come from, so nobody has to reverse-engineer them. */
  source: string
  /** Ordered low → high, contiguous, open at both ends. */
  bands: ThresholdBand[]
}

/**
 * Human Development Index.
 *
 * The four groups the UNDP has used since the 2010 Human Development Report: low
 * below 0.550, medium to 0.699, high to 0.799, very high from 0.800 up. These are the
 * published cut-offs, not quartiles of anything on screen — that is what makes them
 * usable on a map of one continent.
 *
 * Colours are ColorBrewer's RdYlBu at four classes, which is colour-blind safe: the
 * bands stay separable for red–green deficiency, where a red-to-green "bad to good"
 * ramp collapses into two indistinguishable pairs.
 */
const HDI: ThresholdPreset = {
  id: 'hdi',
  name: 'HDI',
  description: 'Human Development Index, 0–1',
  unit: '',
  source: 'UNDP Human Development Report, 2010 onwards',
  bands: [
    { min: -Infinity, max: 0.55, label: 'Low', color: '#d7191c' },
    { min: 0.55, max: 0.7, label: 'Medium', color: '#fdae61' },
    { min: 0.7, max: 0.8, label: 'High', color: '#abd9e9' },
    { min: 0.8, max: Infinity, label: 'Very high', color: '#2c7bb6' },
  ],
}

/**
 * GDP per capita, current US$.
 *
 * The World Bank's income-group thresholds for fiscal year 2025 — low income up to $1,145, lower
 * middle to $4,515, upper middle to $14,005, high above — the one published set of cut-offs for
 * "how rich is a country per person". The Bank sets them on GNI per capita (Atlas method); applied
 * here to GDP per capita, the indicator the dataset carries, which is close to it for most
 * economies. The source line says so. Colours: ColorBrewer YlGnBu, four classes.
 */
const GDP_PER_CAPITA: ThresholdPreset = {
  id: 'gdp-per-capita',
  name: 'GDP per capita',
  description: 'Current US dollars, in the World Bank’s income groups',
  unit: '',
  source: 'World Bank income-group thresholds, FY2025 (set on GNI per capita)',
  bands: [
    { min: -Infinity, max: 1146, label: 'Low (< $1,146)', color: '#edf8b1' },
    { min: 1146, max: 4516, label: 'Lower middle ($1,146–4,515)', color: '#7fcdbb' },
    { min: 4516, max: 14006, label: 'Upper middle ($4,516–14,005)', color: '#2c7fb8' },
    { min: 14006, max: Infinity, label: 'High (> $14,005)', color: '#253494' },
  ],
}

/**
 * Inflation, consumer prices, annual %.
 *
 * There is no official banding, so these are stated as the editor's own: falling prices, then the
 * ranges around the 2% target most central banks set, then high and very high. Diverging colours,
 * because deflation and high inflation are both departures from the middle: blue below zero, red
 * rising above the target (ColorBrewer RdYlBu, six classes).
 */
const INFLATION: ThresholdPreset = {
  id: 'inflation',
  name: 'Inflation',
  description: 'Consumer prices, annual % change',
  unit: '%',
  source: 'Editor-defined ranges around the 2% target common to central banks',
  bands: [
    { min: -Infinity, max: 0, label: 'Deflation', color: '#4575b4' },
    { min: 0, max: 2, label: 'Low', color: '#91bfdb' },
    { min: 2, max: 5, label: 'Moderate', color: '#fee090' },
    { min: 5, max: 10, label: 'High', color: '#fc8d59' },
    { min: 10, max: 25, label: 'Very high', color: '#d73027' },
    { min: 25, max: Infinity, label: 'Extreme', color: '#a50026' },
  ],
}

/*
 * Population, three ways. One number, but a country, a US state and a US county live orders of
 * magnitude apart, and bands that separate countries would put every county in the first one — so
 * each level has its own, and a predefined dataset picks the one for the map it is applied to.
 * No official banding exists for any of them; these are round orders of magnitude, stated as the
 * editor's own. Colours: ColorBrewer YlOrRd.
 */
const POPULATION: ThresholdPreset = {
  id: 'population',
  name: 'Population',
  description: 'People, countries',
  unit: '',
  source: 'Editor-defined orders of magnitude',
  bands: [
    { min: -Infinity, max: 1e6, label: 'Under 1 million', color: '#ffffb2' },
    { min: 1e6, max: 1e7, label: '1–10 million', color: '#fed976' },
    { min: 1e7, max: 5e7, label: '10–50 million', color: '#feb24c' },
    { min: 5e7, max: 1e8, label: '50–100 million', color: '#fd8d3c' },
    { min: 1e8, max: 1e9, label: '100 million–1 billion', color: '#f03b20' },
    { min: 1e9, max: Infinity, label: 'Over 1 billion', color: '#bd0026' },
  ],
}

const POPULATION_US_STATES: ThresholdPreset = {
  id: 'population-us-states',
  name: 'Population (US states)',
  description: 'People, US states',
  unit: '',
  source: 'Editor-defined orders of magnitude',
  bands: [
    { min: -Infinity, max: 1e6, label: 'Under 1 million', color: '#ffffb2' },
    { min: 1e6, max: 5e6, label: '1–5 million', color: '#fecc5c' },
    { min: 5e6, max: 1e7, label: '5–10 million', color: '#fd8d3c' },
    { min: 1e7, max: 2e7, label: '10–20 million', color: '#f03b20' },
    { min: 2e7, max: Infinity, label: 'Over 20 million', color: '#bd0026' },
  ],
}

const POPULATION_US_COUNTIES: ThresholdPreset = {
  id: 'population-us-counties',
  name: 'Population (US counties)',
  description: 'People, US counties',
  unit: '',
  source: 'Editor-defined orders of magnitude',
  bands: [
    { min: -Infinity, max: 1e4, label: 'Under 10,000', color: '#ffffb2' },
    { min: 1e4, max: 5e4, label: '10,000–50,000', color: '#fed976' },
    { min: 5e4, max: 1e5, label: '50,000–100,000', color: '#feb24c' },
    { min: 1e5, max: 5e5, label: '100,000–500,000', color: '#fd8d3c' },
    { min: 5e5, max: 1e6, label: '500,000–1 million', color: '#f03b20' },
    { min: 1e6, max: Infinity, label: 'Over 1 million', color: '#bd0026' },
  ],
}

export const THRESHOLD_PRESETS: ThresholdPreset[] = [
  HDI,
  GDP_PER_CAPITA,
  INFLATION,
  POPULATION,
  POPULATION_US_STATES,
  POPULATION_US_COUNTIES,
]

export const DEFAULT_PRESET_ID = HDI.id

export const PRESET_IDS = new Set(THRESHOLD_PRESETS.map((p) => p.id))

/** The preset with this id, or undefined. */
export function getPreset(id: string | null | undefined): ThresholdPreset | undefined {
  return id ? THRESHOLD_PRESETS.find((p) => p.id === id) : undefined
}

/**
 * The band a value falls in, or null when the preset is missing or the number is not
 * one. Half-open bands mean a value on a boundary belongs to the band above it —
 * 0.800 is "Very high", exactly as the published definition reads.
 */
export function classifyValue(
  value: number,
  preset: ThresholdPreset | undefined,
): ThresholdBand | null {
  if (!preset || typeof value !== 'number' || !Number.isFinite(value)) return null
  for (const band of preset.bands) {
    if (value >= band.min && value < band.max) return band
  }
  return null
}

/** Human-readable range for a band, for the legend. */
export function describeBand(band: ThresholdBand, unit: string): string {
  const lo = Number.isFinite(band.min) ? `${band.min}${unit}` : null
  const hi = Number.isFinite(band.max) ? `${band.max}${unit}` : null
  if (lo === null) return `below ${hi}`
  if (hi === null) return `${lo} and above`
  return `${lo} – ${hi}`
}
