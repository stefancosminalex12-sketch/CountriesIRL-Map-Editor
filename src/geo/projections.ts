/**
 * Projection registry. Regions name a projection; the renderer never hardcodes one.
 *
 * Six come from `d3-geo` and three from `d3-geo-projection`, d3's extended set. All
 * nine are ordinary `GeoProjection` objects built by the same `geoProjection`
 * constructor, so every one of them rotates, scales, translates and — crucially —
 * `fitExtent`s identically. Nothing downstream branches on which projection is
 * active: `fit.ts` fits real projected geometry through the same code path for all
 * of them, and `geoPath` draws countries, graticule, sphere and lakes the same way.
 *
 * The three extended ones are the genuine projections, taken from the library rather
 * than reimplemented: Robinson from the author's published coefficient table,
 * Winkel Tripel as the mean of Aitoff and equirectangular at φ₁ = arccos(2/π), and
 * Nell–Hammer as x = λ(1 + cos φ)/2, y = 2(φ − tan(φ/2)). Note `geoNellHammer` and
 * `geoHammer` are different projections in that library; this uses the former.
 */
import {
  geoEqualEarth,
  geoNaturalEarth1,
  geoMercator,
  geoConicEqualArea,
  geoAzimuthalEqualArea,
  geoEquirectangular,
  type GeoProjection,
} from 'd3-geo'
import { geoNellHammer, geoRobinson, geoWinkel3 } from 'd3-geo-projection'
import type { ProjectionId } from '../types/map'

export interface ProjectionDef {
  id: ProjectionId
  name: string
  factory: () => GeoProjection
  /** Whether `parallels` applies (conics only). */
  conic: boolean
}

/**
 * What "Auto" resolves to.
 *
 * A single fixed projection rather than the region's own preference. Each region still
 * carries a `projectionId` and still uses it for its framing — the centre, the standard
 * parallels and the extent it fits to are untouched — this only decides which projection
 * the *author's* "Auto" setting means when it is turned into a concrete one.
 *
 * Equal Earth is not conic, so the `parallels` a region carries go unused under Auto,
 * exactly as they do under any other non-conic choice.
 *
 * Equal Earth rather than Robinson because it is the projection the world region already
 * names as its own (see `regions.ts`), so this is the base the map was framed against —
 * and because it is equal-area, which is the honest default for a map whose whole subject
 * is comparing countries to one another. Robinson is a compromise projection: it distorts
 * area to flatter the shapes, and a reader colouring countries by a value should not be
 * handed a Greenland that is quietly too big.
 *
 * Every projection, Robinson included, remains selectable by hand; nothing about the list
 * changes, and a map that names a projection explicitly never reaches this at all.
 */
export const AUTO_PROJECTION_ID: ProjectionId = 'equalEarth'

/** Turns the author's choice into the projection to build, resolving "Auto". */
export function resolveProjectionId(chosen: ProjectionId | 'auto'): ProjectionId {
  return chosen === 'auto' ? AUTO_PROJECTION_ID : chosen
}

export const PROJECTIONS: ProjectionDef[] = [
  { id: 'equalEarth', name: 'Equal Earth', factory: geoEqualEarth, conic: false },
  { id: 'naturalEarth1', name: 'Natural Earth', factory: geoNaturalEarth1, conic: false },
  { id: 'conicEqualArea', name: 'Albers (conic equal-area)', factory: geoConicEqualArea, conic: true },
  { id: 'azimuthalEqualArea', name: 'Azimuthal equal-area', factory: geoAzimuthalEqualArea, conic: false },
  { id: 'mercator', name: 'Mercator', factory: geoMercator, conic: false },
  { id: 'equirectangular', name: 'Equirectangular', factory: geoEquirectangular, conic: false },
  { id: 'robinson', name: 'Robinson', factory: geoRobinson, conic: false },
  { id: 'winkel3', name: 'Winkel Tripel', factory: geoWinkel3, conic: false },
  { id: 'nellHammer', name: 'Nell–Hammer', factory: geoNellHammer, conic: false },
]

export function getProjectionDef(id: ProjectionId): ProjectionDef {
  return PROJECTIONS.find((p) => p.id === id) ?? PROJECTIONS[0]
}
