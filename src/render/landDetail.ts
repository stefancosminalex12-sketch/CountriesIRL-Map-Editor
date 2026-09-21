/**
 * How finely the land is drawn, and how to ask for all of it.
 *
 * Outlines are assembled from projected arcs and may leave out points that land closer
 * together than a screen can show them (`arcPaths.ts`). How close that is depends on how far
 * the map is zoomed in: at the fitted view a quarter of a pixel is invisible, and at sixteen
 * times that zoom the same points are a quarter of a pixel apart on screen only if they were
 * projected for it. So the canvas picks a tolerance from the camera, in steps, and reprojects
 * when it crosses one — the same way the names decide which of them are large enough to draw.
 *
 * **Exports take everything.** A PNG at twice the screen's scale, or an SVG someone will open
 * and zoom into, must not inherit the tolerance that suited the view it was captured from. An
 * export asks for full detail, waits for the map to be drawn with it, captures, and releases
 * it. Nothing about the export path changes otherwise: it still copies the live map.
 */
import { useSyncExternalStore } from 'react'

/**
 * Tolerance by zoom, in screen pixels at the projection's own scale.
 *
 * The camera is a transform over the drawn map, so a point left out because it sat a quarter
 * of a pixel from the line is a quarter of a pixel times the zoom once the map is scaled up.
 * The steps below hold that product under 0.3 px at every zoom — below what a screen can
 * show — and hand over every point the source has beyond 20x, which is also what exports ask
 * for. Crossing a step costs the simplifying and a redraw, not a reprojection (`arcPaths.ts`),
 * and it is taken once the camera has settled, never during a gesture.
 */
export function toleranceForZoom(k: number): number {
  if (!(k > 0)) return 0.25
  if (k < 1.2) return 0.25
  if (k < 5) return 0.06
  if (k < 20) return 0.015
  return 0
}

let fullDetailHolds = 0
const listeners = new Set<() => void>()
const notify = () => {
  for (const listener of listeners) listener()
}

/** Whether something (an export) is currently asking for every point. */
export const fullDetailWanted = () => fullDetailHolds > 0

/** Subscribes the canvas to that request. */
export function useFullDetail(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    fullDetailWanted,
    () => false,
  )
}

/**
 * Held while `run` is doing something that needs the full geometry — an export. Waits for the
 * map to report that it is drawn at full detail, runs, and releases even if `run` throws.
 * Nested holds are counted, so two exports at once still leave the map at full detail until
 * both are done.
 */
export async function withFullDetail<T>(run: () => Promise<T> | T): Promise<T> {
  fullDetailHolds++
  notify()
  try {
    await drawnAtFullDetail()
    return await run()
  } finally {
    fullDetailHolds--
    notify()
  }
}

let drawnTolerance: number | null = null
const waiters = new Set<() => void>()

/** Published by the canvas after each commit: the tolerance the land on screen was drawn at. */
export function reportDrawnTolerance(tolerance: number | null): void {
  drawnTolerance = tolerance
  if (tolerance === 0) {
    for (const waiter of [...waiters]) waiter()
    waiters.clear()
  }
}

/** Resolves once the land on screen is the full-detail one — or at once if it already is. */
function drawnAtFullDetail(): Promise<void> {
  if (drawnTolerance === 0) return Promise.resolve()
  return new Promise((resolve) => {
    waiters.add(resolve)
    // A map with no land at all (a dataset still loading) must not hold an export for ever.
    setTimeout(() => {
      if (waiters.delete(resolve)) resolve()
    }, 20000)
  })
}
