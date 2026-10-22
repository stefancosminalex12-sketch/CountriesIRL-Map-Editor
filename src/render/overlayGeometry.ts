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
import type { Geometry, MultiLineString, MultiPolygon, Polygon, Position } from 'geojson'
import type { MapOverlay } from '../types/map'
import { clampOverlayScale } from './overlayScale'

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
  /** The projection that drew `homePath`: the map's, or an inset's. */
  homeProjection: GeoProjection
  /**
   * For a group copy, the borders between its members, in longitude and latitude, and as the map
   * draws them where they are. Null for a single entity, which has none.
   */
  borders: MultiLineString | null
  homeBordersPath: string | null
}

/**
 * What an overlay's source is looked up by: the entity it copies, or for a group copy all of its
 * members — so two overlays of the same entities share one source, and moving or recolouring an
 * overlay reprojects nothing.
 */
export function overlayKey(overlay: Pick<MapOverlay, 'sourceId' | 'members'>): string {
  return overlay.members && overlay.members.length > 1 ? overlay.members.join('+') : overlay.sourceId
}

/** Where an overlay is drawn. */
export interface OverlayPlacement {
  d: string
  /** The borders between a group copy's members, placed exactly as `d` is; null for a single entity. */
  bordersD: string | null
  /**
   * How `d` is placed: its scale `s`, the `x` and `y` of `matrix(a, b, c, d, x, y)`, and the
   * turn in degrees clockwise — a translation (Shape mode), the overlay's scale about its centre
   * and, in Shape mode, its rotation about it — or `null` when `d` is already exactly where it
   * belongs.
   */
  matrix: [number, number, number, number] | null
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
  borders: MultiLineString | null = null,
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
  const homeBordersPath = borders ? geoPath(homeProjection)(borders) || null : null
  return {
    geometry: land,
    homePath,
    homeCentre: [centre[0], centre[1]],
    geoCentre: [geoCentre[0], geoCentre[1]],
    homeProjection,
    borders,
    homeBordersPath,
  }
}

/**
 * The land moved across the globe so that `from` lands on `to`, and turned there by `turn`
 * degrees clockwise about it.
 *
 * Rotations of the sphere: `from` to the point where the equator meets the prime meridian, turned
 * about the axis through that point, then from there to `to`. Rotations keep every distance and
 * area on the globe, so the land keeps its true size and shape; and a move along a parallel or a
 * meridian comes out as a single turn about the axis that move is around, so north stays north.
 */
export function carry<G extends OverlayGeometry | MultiLineString>(
  geometry: G,
  from: [number, number],
  to: [number, number],
  turn = 0,
): G {
  const lift = geoRotation([-from[0], -from[1]])
  // d3's roll turns east towards north, counter-clockwise as a map is read.
  const spin = geoRotation([0, 0, -turn])
  const lower = geoRotation([-to[0], -to[1]])
  const move = (point: Position): Position => lower.invert(spin(lift([point[0], point[1]])))
  const ring = (points: Position[]) => points.map(move)
  if (geometry.type === 'Polygon') return { type: 'Polygon', coordinates: geometry.coordinates.map(ring) } as G
  if (geometry.type === 'MultiLineString') return { type: 'MultiLineString', coordinates: geometry.coordinates.map(ring) } as G
  return { type: 'MultiPolygon', coordinates: geometry.coordinates.map((polygon) => polygon.map(ring)) } as G
}

/**
 * Where an overlay is drawn by this projection — or `null` when the place it has been moved to
 * is not on this map at all (the far side of a globe).
 */
/** An overlay's turn in degrees clockwise, within (-180, 180]. */
export function overlayRotation(rotation: number | undefined): number {
  if (!rotation || !Number.isFinite(rotation)) return 0
  const turn = ((((rotation + 180) % 360) + 360) % 360) - 180
  return turn === -180 ? 180 : turn
}

/**
 * Where a Projection-aware overlay's land is put on the globe, or `null` when it is drawn as the
 * map draws the entity: where it has been moved to, or — turned but not moved — where it is.
 */
export function globeTarget(
  overlay: Pick<MapOverlay, 'mode' | 'anchor' | 'rotation'>,
  source: Pick<OverlaySource, 'geoCentre'>,
): [number, number] | null {
  if (overlay.mode !== 'projection') return null
  return overlay.anchor ?? (overlayRotation(overlay.rotation) !== 0 ? source.geoCentre : null)
}

export function placeOverlay(
  overlay: Pick<MapOverlay, 'mode' | 'anchor' | 'scale' | 'rotation'>,
  source: OverlaySource,
  projection: GeoProjection,
): OverlayPlacement | null {
  const scale = clampOverlayScale(overlay.scale)
  const rotation = overlayRotation(overlay.rotation)
  /* `d`, where the centre of its main landmass is drawn in it, and where that centre belongs. */
  let d = source.homePath
  let bordersD = source.homeBordersPath
  let from = source.homeCentre
  let centre = source.homeCentre
  // Turned on the screen, or — Projection-aware — on the globe, where the land is put.
  let screenTurn = rotation
  if (overlay.anchor) {
    const at = projection(overlay.anchor)
    if (!at || !finite(at)) return null
    centre = [at[0], at[1]]
  }
  const target = globeTarget(overlay, source)
  if (target) {
    d = geoPath(projection)(carry(source.geometry, source.geoCentre, target, rotation)) ?? ''
    if (!d) return null
    bordersD = source.borders ? geoPath(projection)(carry(source.borders, source.geoCentre, target, rotation)) || null : null
    if (!overlay.anchor) {
      const at = projection(target)
      if (!at || !finite(at)) return null
      centre = [at[0], at[1]]
    }
    from = centre
    screenTurn = 0
  }
  /*
   * p ↦ centre + scale · R · (p − from): carried to where it belongs, and scaled and turned about
   * its centre. With y pointing down, (cos, sin, −sin, cos) turns clockwise.
   */
  const t = (screenTurn * Math.PI) / 180
  const a = scale * Math.cos(t)
  const b = scale * Math.sin(t)
  const x = centre[0] - (a * from[0] - b * from[1])
  const y = centre[1] - (b * from[0] + a * from[1])
  const matrix: OverlayPlacement['matrix'] =
    scale === 1 && screenTurn === 0 && x === 0 && y === 0 ? null : [scale, x, y, screenTurn]
  return { d, bordersD, matrix, centre }
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
