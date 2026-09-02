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

export const THRESHOLD_PRESETS: ThresholdPreset[] = [HDI]

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
