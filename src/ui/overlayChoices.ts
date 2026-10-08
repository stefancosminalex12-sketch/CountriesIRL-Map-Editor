/**
 * An overlay's choices — its display modes and textures — and the flag a Flag texture takes,
 * shared by the Overlay panel and the menu a right-click on an overlay opens.
 */
import { useMapStore } from '../state/mapStore'
import { entityFlagCode } from '../flags/flagChoices'
import type { MapOverlay, OverlayMode, OverlayTexture } from '../types/map'

export const OVERLAY_MODES: Array<[OverlayMode, string, string]> = [
  ['shape', 'Shape', 'Its shape exactly as the map draws it, carried anywhere unchanged.'],
  [
    'projection',
    'Projection-aware',
    'Moved across the globe: it grows and shrinks with the projection, as land there would.',
  ],
]

export const OVERLAY_TEXTURES: Array<[OverlayTexture, string]> = [
  ['land', 'Land'],
  ['hatch', 'Hatching'],
  ['dots', 'Dots'],
  ['flag', 'Flag'],
  ['none', 'None'],
  ['solid', 'Solid Color'],
]

/** The flag an entity flies now: a merged group's own, or the one assigned to it, or its default. */
export function flagOfEntity(id: string): string | null {
  const { doc, geo } = useMapStore.getState()
  const merge = doc.merges.find((m) => m.id === id)
  if (merge) return merge.flag ?? null
  return geo ? (entityFlagCode(id, doc.flags.overrides, geo.meta) ?? null) : null
}

/**
 * The patch that gives an overlay a texture. Flag takes the flag the entity flies now, once, if
 * the overlay has none of its own yet; `needsFlag` says the entity flies none, so one must be
 * chosen.
 */
export function texturePatch(overlay: MapOverlay, texture: OverlayTexture): { patch: Partial<MapOverlay>; needsFlag: boolean } {
  if (texture === 'flag' && !overlay.flag) {
    const flag = flagOfEntity(overlay.sourceId)
    return { patch: { texture, flag }, needsFlag: !flag }
  }
  return { patch: { texture }, needsFlag: false }
}
