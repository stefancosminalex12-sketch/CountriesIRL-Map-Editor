/**
 * The geometry of a map overlay: a movable copy of an entity's shape. See {@link MapOverlay}.
 *
 * Nothing here is stored. An overlay records which entity it copies and where it has been put,
 * and its outline is worked out from the map's own data every time — so it is exact at every
 * resolution and in every projection, islands, holes and all, and nothing done to it can reach
 * the entity it copies.
 *
 * Both modes are placed by a point on the globe, the `anchor`:
 *
 * - **Shape** draws the entity's outline exactly as the map draws it where it is, translated so
 *   the centre of its main landmass lands on the anchor. Same outline, same size on screen,
 *   wherever it goes.
 * - **Projection-aware** rotates the entity's land across the sphere so that same centre lands on
 *   the anchor, and draws the result with the active projection. A rotation keeps true size and
 *   shape on the globe, so what changes on the map is only what the projection does to land at
 *   the new place — Greenland moved to the equator on Mercator comes out the size it really is.
 *
 * Either way the result is then scaled by the overlay's `scale` about that same centre: one
 * uniform transform of the drawn outline, so its proportions are exact, every island and
 * exclave keeps its place relative to the rest, and resizing never moves the overlay.
 */
import { geoArea, geoCentroid, geoPath, geoRotation, type GeoProjection } from 'd3-geo'
import type { Geometry, MultiPolygon, Polygon, Position } from 'geojson'
import type { MapOverlay } from '../types/map'

export type OverlayGeometry = Polygon | MultiPolygon

/** Everything about a copied entity an overlay is drawn from, worked out once per projection. */
export interface OverlaySource {
  /** The entity's land, in longitude and latitude. */
  geometry: OverlayGeometry
  /** Its outline exactly as the map draws it where it is, in the zoomed group's coordinates. */
  homePath: string
  /** Where the centre of its main landmass is drawn: the point a Shape overlay is carried by. */
  homeCentre: [number, number]
  /** The centre of its main landmass on the globe: the point a Projection-aware overlay turns about. */
  geoCentre: [number, number]
}

/** Where an overlay is drawn. */
export interface OverlayPlacement {
  d: string
  /**
   * How `d` is placed, as the `s`, `x` and `y` of `matrix(s, 0, 0, s, x, y)` — a translation
   * (Shape mode) and the overlay's scale about its centre — or `null` when `d` is already
   * exactly where it belongs.
   */
  matrix: [number, number, number] | null
  /** Where its centre is drawn, in the zoomed group's coordinates: its drag handle, and what it scales about. */
  centre: [number, number]
}

const finite = (values: number[]) => values.every(Number.isFinite)

/** A geometry's polygons, or none for anything that is not land. */
function polygonsOf(geometry: Geometry | null | undefined): Position[][][] {
  if (geometry?.type === 'Polygon') return [geometry.coordinates]
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates
  return []
}

/**
 * The main landmass: the polygon with the most area on the globe.
 *
 * The centre an overlay is carried by is this one's, not the whole entity's. France's centre
 * taken over all its land lies in the Atlantic, between Paris and French Guiana; its mainland's
 * is in France — which is where the hand that drags France expects to be holding it.
 */
function mainLandmass(geometry: OverlayGeometry): Polygon {
  let best: Polygon = { type: 'Polygon', coordinates: polygonsOf(geometry)[0] ?? [] }
  let bestArea = -1
  for (const coordinates of polygonsOf(geometry)) {
    const polygon: Polygon = { type: 'Polygon', coordinates }
    const area = geoArea(polygon)
    if (area > bestArea) {
      bestArea = area
      best = polygon
    }
  }
  return best
}

/** The centre of an entity's main landmass on the globe, as [longitude, latitude]. */
export function landCentre(geometry: Geometry | null | undefined): [number, number] | null {
  if (polygonsOf(geometry).length === 0) return null
  const centre = geoCentroid(mainLandmass(geometry as OverlayGeometry))
  return finite(centre) ? [centre[0], centre[1]] : null
}

/**
 * What an overlay of an entity is drawn from.
 *
 * `homePath` is the map's own path for the entity and `homeProjection` the projection that drew
 * it — an inset's, for an entity the map draws in one — so an overlay starts exactly over the
 * entity it copies. `null` for anything with no land to copy, or none on this side of the globe.
 */
export function overlaySource(
  geometry: Geometry | null | undefined,
  homePath: string | null | undefined,
  homeProjection: GeoProjection,
): OverlaySource | null {
  if (!homePath || polygonsOf(geometry).length === 0) return null
  const land = geometry as OverlayGeometry
  const main = mainLandmass(land)
  const path = geoPath(homeProjection)
  let centre = path.centroid(main)
  // The main landmass can be out of sight — on the far side of a globe — while the rest is not.
  if (!finite(centre)) centre = path.centroid(land)
  const geoCentre = geoCentroid(main)
  if (!finite(centre) || !finite(geoCentre)) return null
  return { geometry: land, homePath, homeCentre: [centre[0], centre[1]], geoCentre: [geoCentre[0], geoCentre[1]] }
}

/**
 * The land moved across the globe so that `from` lands on `to`.
 *
 * Two rotations of the sphere: `from` to the point where the equator meets the prime meridian,
 * then from there to `to`. Rotations keep every distance and area on the globe, so the land keeps
 * its true size and shape; and a move along a parallel or a meridian comes out as a single turn
 * about the axis that move is around, so north stays north.
 */
export function carry(geometry: OverlayGeometry, from: [number, number], to: [number, number]): OverlayGeometry {
  const lift = geoRotation([-from[0], -from[1]])
  const lower = geoRotation([-to[0], -to[1]])
  const move = (point: Position): Position => lower.invert(lift([point[0], point[1]]))
  const ring = (points: Position[]) => points.map(move)
  return geometry.type === 'Polygon'
    ? { type: 'Polygon', coordinates: geometry.coordinates.map(ring) }
    : { type: 'MultiPolygon', coordinates: geometry.coordinates.map((polygon) => polygon.map(ring)) }
}

/**
 * Where an overlay is drawn by this projection — or `null` when the place it has been moved to
 * is not on this map at all (the far side of a globe).
 */
export function placeOverlay(
  overlay: Pick<MapOverlay, 'mode' | 'anchor' | 'scale'>,
  source: OverlaySource,
  projection: GeoProjection,
): OverlayPlacement | null {
  const scale = Number.isFinite(overlay.scale) && overlay.scale > 0 ? overlay.scale : 1
  /* `d`, where the centre of its main landmass is drawn in it, and where that centre belongs. */
  let d = source.homePath
  let from = source.homeCentre
  let centre = source.homeCentre
  if (overlay.anchor) {
    const at = projection(overlay.anchor)
    if (!at || !finite(at)) return null
    centre = [at[0], at[1]]
    if (overlay.mode === 'projection') {
      d = geoPath(projection)(carry(source.geometry, source.geoCentre, overlay.anchor)) ?? ''
      if (!d) return null
      from = centre
    }
  }
  // p ↦ centre + scale · (p − from): carried to where it belongs, and scaled about its centre.
  const x = centre[0] - scale * from[0]
  const y = centre[1] - scale * from[1]
  const matrix: OverlayPlacement['matrix'] = scale === 1 && x === 0 && y === 0 ? null : [scale, x, y]
  return { d, matrix, centre }
}

/**
 * The anchor that puts an overlay's centre at `point`, in the zoomed group's coordinates.
 *
 * `null` off the globe: some projections invert a point outside their outline to somewhere on
 * the Earth anyway, so the answer is projected back and kept only if it comes back to the point.
 */
export function anchorAt(point: [number, number], projection: GeoProjection): [number, number] | null {
  const lonLat = projection.invert?.(point)
  if (!lonLat || !finite(lonLat)) return null
  const back = projection(lonLat)
  if (!back || !finite(back) || Math.hypot(back[0] - point[0], back[1] - point[1]) > 0.5) return null
  const lon = ((((lonLat[0] + 180) % 360) + 360) % 360) - 180
  return [lon, Math.max(-90, Math.min(90, lonLat[1]))]
}
