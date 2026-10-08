/**
 * The built-in stickers: six 3D faces, one per mood, from furious to starstruck.
 *
 * Microsoft's Fluent Emoji 3D artwork (MIT), each recoloured to its tier — red, orange, yellow,
 * green, blue, purple — so the tiers stay apart at sizes too small to read an expression. The
 * artwork lives in `builtinArt.ts` as data URIs, for the same reason flag artwork is inlined (see
 * `flags/flagStore.ts`): an image the map references by URL is blank in every export, because the
 * exporter rasterises the map inside an `<img>`, which may not fetch anything.
 *
 * Ordered lowest to highest, which is the order the default ladder uses: the lowest value on the
 * map gets the furious face and the highest the starstruck one.
 */
import { BUILTIN_ART } from './builtinArt'
import type { Sticker } from './types'

export const BUILTIN_STICKERS: Sticker[] = BUILTIN_ART.map(({ id, name, src }) => ({
  id: `builtin:${id.replace(/^builtin:/, '')}`,
  name,
  src,
  builtin: true,
}))

/** The ladder a new map starts with: every built-in face, lowest value first. */
export const DEFAULT_STICKER_LADDER: string[] = BUILTIN_STICKERS.map((s) => s.id)
