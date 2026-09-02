/**
 * Palettes for the relative (normalised) data scale.
 *
 * Four families — blue, red, green and a red→blue diverging ramp — each at two
 * resolutions. Six steps is enough for most maps and stays readable in a legend; nine
 * gives finer gradation when the data spreads far enough to earn it. Nothing else is
 * offered on purpose: the point of a data map is that the reader works out what the
 * colours mean without being told, and a chooser with twenty ramps in it is a chooser
 * nobody reads.
 *
 * The three sequential ramps run **lightest first**. Index 0 is the lowest value and
 * the palest shade, the last index is the highest value and the deepest, so a map
 * darkens as the numbers climb — more of the thing being measured reads as more ink.
 * `sampleRamp` in `colors.ts` maps t = 0 to index 0, so the ordering here is the
 * ordering on the map, and it is monotonic: a larger value can never come out lighter
 * than a smaller one.
 *
 * The **diverging** ramp is a different shape and deliberately so. It is dark at both
 * ends and light in the middle, because what it shows is distance from the centre of
 * the range in one of two directions: the lowest values are deep red, the highest
 * deep blue, and the middle of the data is the pale stop between them. It is still the
 * same normalised position driving it — only the colours at each end differ.
 *
 * ### No ramp reaches white
 *
 * Every stop here is a colour, never paper. ColorBrewer's sequential schemes open on
 * `#f7fbff`, `#fff5f0`, `#f7fcf5` — all within a couple of percent of white — and
 * RdBu's centre is a flat `#f7f7f7`. On a map those stops are indistinguishable from
 * blank, so a country at the bottom of the scale reads as a country with no data,
 * which is the one thing a choropleth must never say by accident. The two or three
 * palest stops of each sequential scheme are therefore dropped and the ramp rebuilt
 * from what is left, and the diverging centre is a light lilac rather than paper.
 *
 * The floor is set by the land, not by an abstract idea of "light". Every stop stays
 * under a relative luminance of about 0.90 *and* at least ~40 in RGB distance from
 * every land tone the three themes use — which is why green opens on `#a1d99b`
 * rather than `#c7e9c0`, a stop close enough to the Geographic theme's khaki land to
 * be mistaken for it, and why the diverging centre is `#d8d1e2` rather than a paler
 * lilac that sat too near the Light theme's `#f2f0ea`.
 */
import type { Palette } from '../types/map'

export type PaletteFamilyId = 'blue' | 'red' | 'green' | 'diverging'
export type PaletteSteps = 6 | 9

export interface PaletteFamily {
  id: PaletteFamilyId
  name: string
  /** `sequential` runs light → dark; `diverging` runs dark → light → dark. */
  kind: 'sequential' | 'diverging'
  /** Ramps by step count, lowest value first. */
  ramps: Record<PaletteSteps, string[]>
}

export const PALETTE_FAMILIES: PaletteFamily[] = [
  {
    id: 'blue',
    name: 'Blue',
    kind: 'sequential',
    ramps: {
      6: ['#c6dbef', '#9ecae1', '#6baed6', '#3182bd', '#08519c', '#08306b'],
      9: [
        '#c6dbef',
        '#b2d2e8',
        '#9ecae1',
        '#84bcdc',
        '#6baed6',
        '#4292c6',
        '#2171b5',
        '#08519c',
        '#08306b',
      ],
    },
  },
  {
    id: 'red',
    name: 'Red',
    kind: 'sequential',
    ramps: {
      6: ['#fcbba1', '#fc9272', '#fb6a4a', '#de2d26', '#a50f15', '#67000d'],
      9: [
        '#fcbba1',
        '#fca68a',
        '#fc9272',
        '#fb6a4a',
        '#f5533b',
        '#ef3b2c',
        '#cb181d',
        '#a50f15',
        '#67000d',
      ],
    },
  },
  {
    id: 'green',
    name: 'Green',
    kind: 'sequential',
    ramps: {
      6: ['#a1d99b', '#74c476', '#41ab5d', '#238b45', '#006d2c', '#00441b'],
      9: [
        '#a1d99b',
        '#8bce89',
        '#74c476',
        '#5bb86a',
        '#41ab5d',
        '#2f9c4e',
        '#238b45',
        '#006d2c',
        '#00441b',
      ],
    },
  },
  {
    /*
     * Red at the bottom, blue at the top, pale in between — ColorBrewer's RdBu with
     * its white centre replaced. At six steps there is no centre stop to land on, so
     * the ramp is three reds and three blues and the change of hue happens between
     * the middle pair; at nine, index 4 is the midpoint of the data and takes the
     * pale stop.
     *
     * The direction is stated once, here, and nowhere else. `sampleRamp` maps t = 0 to
     * index 0 for every palette and the legend draws index 0 under its `min` label, so
     * the order of this array *is* the order on the map and in the legend — there is no
     * second place that could disagree with it.
     */
    id: 'diverging',
    name: 'Diverging',
    kind: 'diverging',
    ramps: {
      6: ['#67001f', '#b2182b', '#f4a582', '#92c5de', '#2166ac', '#053061'],
      9: [
        '#67001f',
        '#b2182b',
        '#d6604d',
        '#f4a582',
        '#d8d1e2',
        '#92c5de',
        '#4393c3',
        '#2166ac',
        '#053061',
      ],
    },
  },
]

export const PALETTE_STEPS: PaletteSteps[] = [6, 9]

/** `blue-6`, `diverging-9`… The id is the pair, so the document records both choices. */
export function paletteId(family: PaletteFamilyId, steps: PaletteSteps): string {
  return `${family}-${steps}`
}

/** Splits a palette id back into the two choices the UI presents. */
export function parsePaletteId(
  id: string,
): { family: PaletteFamilyId; steps: PaletteSteps } | null {
  const [family, steps] = id.split('-')
  const known = PALETTE_FAMILIES.find((f) => f.id === family)
  const count = Number(steps)
  if (!known || (count !== 6 && count !== 9)) return null
  return { family: known.id, steps: count }
}

/** Every family at every resolution, as documents store them. */
export function buildPalettes(): Palette[] {
  const out: Palette[] = []
  for (const family of PALETTE_FAMILIES) {
    for (const steps of PALETTE_STEPS) {
      out.push({
        id: paletteId(family.id, steps),
        name: `${family.name} · ${steps}`,
        kind: family.kind,
        colors: family.ramps[steps],
      })
    }
  }
  return out
}

export const DEFAULT_PALETTE_ID = paletteId('blue', 6)
