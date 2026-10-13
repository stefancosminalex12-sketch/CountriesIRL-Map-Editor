/**
 * Where some territories' stickers go instead of the middle the geometry finds
 * (`render/labelPlacement.ts`, `stickerSpot`), as [longitude, latitude], and how much smaller or
 * larger than usual they are drawn (`scale`, 1 for as usual).
 *
 * - **Russia**: in its European part, east of Moscow towards Yaroslavl — clear of the Baltic
 *   states', Belarus's and Ukraine's stickers and inside a Europe map's frame, where the middle of
 *   the whole country is in Siberia and off it. A little over half the size its area earns, which
 *   in a Europe frame was a face larger than its neighbours put together.
 * - **Italy**: inland near Benevento, below San Marino's sticker and its word and east of the
 *   Vatican's, which the middle of the peninsula sat on.
 *
 * A point that is not on the territory's land as drawn is ignored, and the usual middle is used.
 * A sticker dragged by hand still goes where it was dragged.
 */
export interface StickerAnchor {
  at: readonly [number, number]
  scale?: number
}

export const STICKER_ANCHORS: Readonly<Record<string, StickerAnchor>> = {
  RUS: { at: [39.5, 58.0], scale: 0.55 },
  ITA: { at: [15.0, 41.4] },
}
