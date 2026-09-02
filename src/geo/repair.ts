/**
 * Geometry hygiene shared by every geographic layer.
 *
 * Source data is not always well-formed, and the failure mode is severe: a single
 * ring wound the wrong way is read by the spherical clipper as covering the entire
 * globe, which paints the whole projection outline as one filled shape. Both the
 * country layer and the lake layer run their polygons through this.
 */
import { geoArea } from 'd3-geo'
import type { Position } from 'geojson'

/** More than half the globe — no country polygon can legitimately reach this. */
const INVERTED_AREA_THRESHOLD = 2 * Math.PI

export type Ring = Position[]

/** Drops consecutive duplicate positions, which quantisation introduces. */
function dedupeRing(ring: Ring): Ring {
  const out: Ring = []
  for (const position of ring) {
    const previous = out[out.length - 1]
    if (!previous || previous[0] !== position[0] || previous[1] !== position[1]) out.push(position)
  }
  // A closed ring repeats its first position; ignore that when counting corners.
  const closed =
    out.length > 1 &&
    out[0][0] === out[out.length - 1][0] &&
    out[0][1] === out[out.length - 1][1]
  return closed ? out.slice(0, -1) : out
}

/**
 * Repairs one source polygon, or returns null if nothing renderable is left.
 *
 * Natural Earth's TopoJSON quantises longitude to ~0.0036° (about 400 m). At 10m
 * detail the data contains islets smaller than that step, so their rings collapse to
 * two or three distinct corners. Such a ring encloses no area, and d3-geo cannot
 * derive an orientation for it — several Maldivian ones come back wound the wrong
 * way, which the spherical clipper reads as "this polygon covers the globe" and
 * paints as the entire projection outline.
 *
 * Both problems are handled here, so every dataset gets the same treatment:
 *   - rings left with fewer than three distinct corners are dropped (they are not
 *     valid polygon rings and enclose nothing, so nothing visible is lost);
 *   - a polygon whose spherical area exceeds half the globe has its winding
 *     inverted, so the outer ring is reversed to restore the intended orientation.
 */
export function repairPolygon(polygon: Ring[]): Ring[] | null {
  const rings: Ring[] = []
  for (const ring of polygon) {
    const cleaned = dedupeRing(ring)
    if (cleaned.length < 3) continue
    // Re-close the ring, as GeoJSON requires.
    rings.push([...cleaned, cleaned[0]])
  }

  if (rings.length === 0) return null

  if (geoArea({ type: 'Polygon', coordinates: rings }) > INVERTED_AREA_THRESHOLD) {
    rings[0] = [...rings[0]].reverse()
  }

  return rings
}

