/**
 * How thick the map's lines are: the borders between territories (`MapStyle.borderWidth`) and the
 * coastlines (`MapStyle.coastlineWidth`), each set on its own in Display → Appearance.
 *
 * 0.8 for both on a fresh map. The Europe Mapping template doubles the borders for phone videos,
 * where a hairline is lost, and leaves the coast at 0.8.
 */
import type { MapStyle } from '../types/map'

/** The range the two sliders cover, in the same units as the map's other strokes. */
export const LINE_WIDTH = { min: 0.2, max: 4, step: 0.1, default: 0.8 }

/** The coastline's width, or the default for a map made before it had its own. */
export function coastlineWidthOf(style: MapStyle): number {
  return style.coastlineWidth ?? LINE_WIDTH.default
}
