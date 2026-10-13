/**
 * Where some territories' stickers go instead of the middle the geometry finds
 * (`render/labelPlacement.ts`, `stickerSpot`), as [longitude, latitude].
 *
 * - **Russia**: in its European part, between Moscow and Tver — inside a Europe map's frame,
 *   where the middle of the whole country is in Siberia and off it.
 * - **Italy**: inland near Benevento, below San Marino's sticker and its word and east of the
 *   Vatican's, which the middle of the peninsula sat on.
 *
 * A point that is not on the territory's land as drawn is ignored, and the usual middle is used.
 * A sticker dragged by hand still goes where it was dragged.
 */
export const STICKER_ANCHORS: Readonly<Record<string, readonly [number, number]>> = {
  RUS: [37.5, 57.0],
  ITA: [15.0, 41.4],
}
