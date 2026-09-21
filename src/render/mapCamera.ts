/**
 * Moving the map from outside the map.
 *
 * The sidebar's grip — the transparent strip at the bottom of an open panel on a phone —
 * has to pan and pinch the map that is behind it. There is exactly one way this is worth
 * doing: by driving the camera the map already has. A second pan implementation would be a
 * second set of limits, a second idea of what a pinch means, and two transforms to keep in
 * agreement; the first frame they disagreed the map would jump.
 *
 * So this is a doorway, not a mechanism. The canvas registers what it can already do
 * ({@link setMapCamera}), and a caller borrows it for the length of one gesture:
 *
 *     const drag = beginMapDrag()
 *     drag?.panBy(dx, dy)          // screen pixels, as the finger moved
 *     drag?.zoomBy(1.04, x, y)     // a pinch, about a point on screen
 *     drag?.end()
 *
 * Inside, those are the very calls d3's zoom behaviour makes for a drag and a pinch on the
 * map itself, through the same behaviour instance: the same scale limits, the same pan
 * bounds, the same camera written straight to the DOM once a frame, and one commit to the
 * document when the gesture ends. A gesture through this doorway and the same gesture on
 * the exposed map differ in nothing but where the finger was.
 */

/** What the canvas offers: one gesture at a time, borrowed and handed back. */
export interface MapDrag {
  /** Moves the map by a distance in screen pixels. */
  panBy(dx: number, dy: number): void
  /** Scales about a point in client coordinates, as a pinch does. */
  zoomBy(factor: number, clientX: number, clientY: number): void
  /** Ends the gesture: the camera is committed to the document once, here. */
  end(): void
}

type Begin = () => MapDrag | null

let begin: Begin | null = null

/** Registered by the canvas while it is mounted. */
export function setMapCamera(next: Begin | null): void {
  begin = next
}

/**
 * Starts a gesture, or returns `null` when there is no map to move — before the first
 * render, or between two datasets.
 */
export function beginMapDrag(): MapDrag | null {
  return begin ? begin() : null
}

/** Whether the map can be driven from outside right now. */
export function mapCameraReady(): boolean {
  return begin !== null
}
