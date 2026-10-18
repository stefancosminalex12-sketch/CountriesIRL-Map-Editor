/**
 * The map's box: where every map is drawn when no canvas frame is set.
 *
 * One box, the shape of the World map's globe — Equal Earth's whole outline — outlined on screen,
 * and every map fitted into it: the globe fills it exactly, Europe and the United States fit inside
 * it, and nothing is drawn outside it. So switching maps never moves where the map starts or ends.
 * The same small gap is kept above it and at its sides on every screen; a screen too narrow for the
 * globe's shape gets a smaller box of the same shape, with the room left over below it.
 *
 * Exports are cropped to it, as they are to a canvas frame: the box is the picture.
 */
import { geoEqualEarth, geoPath } from 'd3-geo'
import type { ScreenRect } from './screenFrame'

/** Width over height of the World's globe outline, about 2.05. */
export const GLOBE_ASPECT = (() => {
  const [[x0, y0], [x1, y1]] = geoPath(geoEqualEarth()).bounds({ type: 'Sphere' })
  return (x1 - x0) / (y1 - y0)
})()

/** The gap kept round the box: 2.5% of the canvas's short side, never under 12px. */
export function boxGap(width: number, height: number): number {
  return Math.max(12, 0.025 * Math.min(width, height))
}

/** The box on a canvas of this size, in the canvas's own pixels. */
export function homeBox(width: number, height: number): ScreenRect {
  const gap = boxGap(width, height)
  const room = { width: Math.max(1, width - 2 * gap), height: Math.max(1, height - 2 * gap) }
  let boxWidth = room.width
  let boxHeight = boxWidth / GLOBE_ASPECT
  if (boxHeight > room.height) {
    boxHeight = room.height
    boxWidth = boxHeight * GLOBE_ASPECT
  }
  return { x: (width - boxWidth) / 2, y: gap, width: boxWidth, height: boxHeight }
}
