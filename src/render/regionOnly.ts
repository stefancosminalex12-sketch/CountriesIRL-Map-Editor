/**
 * Region only: the land outside the map's region left out of the drawing for as long as an export
 * asks — what **Transparent background** needs, so the picture is the region's countries on
 * nothing, not them beside a ring of greyed-out neighbours.
 *
 * Held, like full detail (`landDetail.ts`): the canvas draws the outside as hidden while any hold
 * is out, whatever the document's own setting, and goes back the moment the export lets go. The
 * document is never touched, so there is nothing to undo.
 */
import { useSyncExternalStore } from 'react'

let holds = 0
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of [...listeners]) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Whether the canvas should draw only the region right now. */
export function useRegionOnly(): boolean {
  return useSyncExternalStore(subscribe, () => holds > 0)
}

/**
 * Two frames: React has committed the change and the browser has drawn it. A tab in the
 * background gets no frames, so a short timer stands in — the export reads the SVG, which React
 * has committed by then, not pixels.
 */
const drawn = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    setTimeout(resolve, 150)
  })

/** Runs `run` with only the region drawn. */
export async function withRegionOnly<T>(run: () => Promise<T> | T): Promise<T> {
  holds++
  notify()
  try {
    await drawn()
    return await run()
  } finally {
    holds--
    notify()
  }
}
