/**
 * Which sticker each entity wears.
 *
 * Two sources, in order. A sticker the author put on an entity by hand (`overrides`) wins,
 * including the explicit "no sticker here". Otherwise, with **Follow the data** on and the map in
 * Data mode, the entity's number picks a rung of the ladder through the scale already colouring
 * it, so the face and the fill always agree about where a country stands:
 *
 * - **Predefined** (threshold): the band the value is in, spread over the ladder. With as many
 *   stickers as bands it is one each; with fewer, neighbouring bands share; with more, the ends
 *   are kept and the middle rungs spaced out.
 * - **Palette** (relative): the value's position between the map's lowest and highest number,
 *   sampled the way the colour ramp samples it (`paletteBucket`), so the lowest value takes the
 *   first sticker and the highest the last.
 *
 * Categorical data, Compare and Flags have no low-to-high order, so they place no stickers of
 * their own; hand-placed ones still show.
 */
import { colourModeOf } from './colourMode'
import { computeDomain, normalizedPosition, paletteBucket } from './colors'
import { classifyValue, describeBand, getPreset } from './presets'
import { formatDataValue } from './legend'
import { DEFAULT_STICKER_LADDER } from '../stickers/builtin'
import { savedLadder } from '../stickers/stickerLibrary'
import { STICKER_SIZE, type CountryId, type MapDocument, type StickerMode } from '../types/map'

/** A new map's settings: off, following the data, with the tiers last used in this browser. */
export function createStickerMode(): StickerMode {
  return {
    enabled: false,
    auto: true,
    ladder: savedLadder() ?? [...DEFAULT_STICKER_LADDER],
    overrides: {},
    size: STICKER_SIZE.default,
  }
}

const DEFAULT_MODE = createStickerMode()

/** The document's sticker settings, or the defaults for a document made before they existed. */
export function stickersOf(doc: MapDocument): StickerMode {
  return doc.stickers ?? DEFAULT_MODE
}

/** Which of `rungs` ladder positions band `band` of `bands` lands on. */
export function rungForBand(band: number, bands: number, rungs: number): number {
  if (rungs <= 1) return 0
  if (bands <= 1) return rungs - 1
  return Math.round((band * (rungs - 1)) / (bands - 1))
}

/** How the active scale reads numbers for stickers, or null when it has no low-to-high order. */
function dataReading(doc: MapDocument) {
  if (colourModeOf(doc) !== 'data') return null
  const layer = doc.layers.find((l) => l.id === doc.activeLayerId) ?? doc.layers[0]
  if (!layer) return null
  const mode = layer.colorScale.mode
  if (mode === 'threshold') {
    const preset = getPreset(doc.activePresetId)
    return preset ? { kind: 'threshold' as const, layer, preset } : null
  }
  if (mode === 'numeric') {
    const domain = layer.colorScale.domain ?? computeDomain(doc.countries, layer.dataKey)
    return domain ? { kind: 'numeric' as const, layer, domain } : null
  }
  return null
}

/**
 * The ladder rung a value earns under the active scale, or null when it earns none.
 *
 * Exported for the panel, which shows the author what each rung covers.
 */
export function rungForValue(doc: MapDocument, value: unknown, rungs: number): number | null {
  if (rungs === 0 || typeof value !== 'number' || !Number.isFinite(value)) return null
  const reading = dataReading(doc)
  if (!reading) return null
  if (reading.kind === 'threshold') {
    const band = classifyValue(value, reading.preset)
    if (!band) return null
    return rungForBand(reading.preset.bands.indexOf(band), reading.preset.bands.length, rungs)
  }
  return paletteBucket(normalizedPosition(value, reading.domain), rungs)
}

/**
 * Every entity that wears a sticker, and which.
 *
 * Entities only: whether one is drawn, hidden or out of scope is the renderer's question.
 */
export function resolveStickers(doc: MapDocument): Map<CountryId, string> {
  const mode = stickersOf(doc)
  const out = new Map<CountryId, string>()
  if (!mode.enabled) return out

  if (mode.auto && mode.ladder.length > 0) {
    const reading = dataReading(doc)
    if (reading) {
      for (const [id, entry] of Object.entries(doc.countries)) {
        const rung = rungForValue(doc, entry.properties[reading.layer.dataKey], mode.ladder.length)
        if (rung !== null) out.set(id, mode.ladder[rung])
      }
    }
  }

  for (const [id, stickerId] of Object.entries(mode.overrides)) {
    if (stickerId === null) out.delete(id)
    else out.set(id, stickerId)
  }
  return out
}

/**
 * What each rung of the ladder covers under the active scale, for the panel: "0.8 and above",
 * "12.4 – 20.1", or null for a rung no value can reach (more rungs than bands).
 *
 * Null as a whole when the active scale places no stickers.
 */
export function describeRungs(doc: MapDocument): Array<string | null> | null {
  const mode = stickersOf(doc)
  const reading = dataReading(doc)
  const rungs = mode.ladder.length
  if (!reading || rungs === 0) return null

  if (reading.kind === 'threshold') {
    const { bands } = reading.preset
    const unit = reading.layer.unit || reading.preset.unit
    const out: Array<string | null> = Array.from({ length: rungs }, () => null)
    const labels: string[][] = Array.from({ length: rungs }, () => [])
    bands.forEach((band, i) => labels[rungForBand(i, bands.length, rungs)].push(band.label))
    labels.forEach((names, rung) => {
      if (names.length === 0) return
      const first = bands.find((b) => b.label === names[0])!
      const last = bands.find((b) => b.label === names[names.length - 1])!
      const range = describeBand({ ...first, max: last.max }, unit)
      out[rung] = `${names.join(', ')} (${range})`
    })
    return out
  }

  const [min, max] = reading.domain
  const unit = reading.layer.unit
  const span = max - min
  if (!(span > 0)) return Array.from({ length: rungs }, (_, i) => (i === rungs - 1 ? 'every value' : null))
  const fmt = (v: number) => formatDataValue(Number(v.toPrecision(4)), unit) ?? String(v)
  if (rungs === 1) return [`${fmt(min)} – ${fmt(max)}`]
  // `paletteBucket` rounds to the nearest stop, so each rung covers half a step either side of it.
  return Array.from({ length: rungs }, (_, i) => {
    const lo = Math.max(0, (i - 0.5) / (rungs - 1))
    const hi = Math.min(1, (i + 0.5) / (rungs - 1))
    return `${fmt(min + lo * span)} – ${fmt(min + hi * span)}`
  })
}
