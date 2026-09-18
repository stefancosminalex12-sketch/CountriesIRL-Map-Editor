/**
 * The projection the map is drawing with, for the few things outside the canvas that need it.
 *
 * One consumer today: Canvas → *Fit to region*, which measures where the region actually is on
 * screen and puts a frame round it. That needs the live projection, and the canvas is the only
 * thing that has it — it is derived from the dataset, the region, the viewport and the chosen
 * projection, all inside `MapCanvas`.
 *
 * A module-level handle rather than store state, because it is not state: it changes exactly
 * when the projection is rebuilt, nothing renders from it, and putting a function in the store
 * would mean every subscriber re-rendering when the camera refits. It is also deliberately not
 * `window.__mapProjection`, which is a development aid published only in dev builds — Fit to
 * region read that global and therefore did nothing at all in production.
 */
import type { GeoProjection } from 'd3-geo'

let live: GeoProjection | null = null

/** Published by `MapCanvas` whenever the projection is rebuilt. */
export function setLiveProjection(projection: GeoProjection | null): void {
  live = projection
}

/** The projection on screen, or `null` before the first map has been drawn. */
export function getLiveProjection(): GeoProjection | null {
  return live
}
