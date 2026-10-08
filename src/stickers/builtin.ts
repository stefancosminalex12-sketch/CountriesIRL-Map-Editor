/**
 * The built-in stickers: six faces from the sticker gallery, one per mood from furious to
 * starstruck, each in its tier's colour — red, orange, yellow, green, blue, purple — so the tiers
 * stay apart even where a face is too small to read.
 *
 * Drawn by the face maker (`faceMaker.ts`) as SVG data URIs, for the same reason flag artwork is
 * inlined (see `flags/flagStore.ts`): an image the map references by URL is blank in every
 * export, because the exporter rasterises the map inside an `<img>`, which may not fetch anything.
 *
 * Ordered lowest to highest, which is the order the default ladder uses.
 */
import { faceDataUri } from './faceMaker'
import { FACE_PRESETS, presetFace } from './facePresets'
import type { Sticker } from './types'

const TIERS: Array<[id: string, name: string, preset: string, color: string]> = [
  ['furious', 'Furious', 'furious', '#b00302'],
  ['sad', 'Sad', 'sad', '#f57c1f'],
  ['meh', 'Meh', 'unimpressed', '#faca15'],
  ['happy', 'Happy', 'grinning', '#82c431'],
  ['joyful', 'Joyful', 'big-laugh', '#1b4fd8'],
  ['starstruck', 'Starstruck', 'star-struck', '#9062f9'],
]

export const BUILTIN_STICKERS: Sticker[] = TIERS.map(([id, name, presetId, color]) => {
  const preset = FACE_PRESETS.find((p) => p.id === presetId)!
  return { id: `builtin:${id}`, name, src: faceDataUri(presetFace(preset, color)), builtin: true }
})

/** The ladder a new map starts with: every built-in face, lowest value first. */
export const DEFAULT_STICKER_LADDER: string[] = BUILTIN_STICKERS.map((s) => s.id)
