/**
 * Maritime territory, drawn as the country's flag over the water it holds.
 *
 * The geometry is real: Marine Regions' exclusive economic zones, one per country or
 * dependency, projected exactly as the land is. Nothing is buffered, offset, or grown
 * from where the islands sit — French Polynesia's water is the shape the dataset gives
 * it, and Kiribati's three groups are three zones because that is what the geography is.
 *
 * The paint comes from the existing flag system unchanged: the same `<pattern>` a
 * country's land points at, so the water carries the same flag, framed the same way, and
 * a country never disagrees with itself. Nothing about land placement is touched.
 *
 * **Drawn beneath every country path.** That ordering is the whole of the containment
 * rule: land is painted afterwards, so no country's water can cover anyone's coast, and
 * the simplification that keeps the file small — which pulls a zone's inner edge a few
 * kilometres off the true coastline — cannot show. Zones cannot overlap each other
 * either, because the fetch keeps only undisputed 200-nautical-mile zones and drops
 * overlapping claims and joint regimes, so the sea is partitioned by the source data
 * rather than by draw order.
 */
import { memo, useMemo } from 'react'
import { geoArea, geoCentroid, geoPath, type GeoProjection } from 'd3-geo'
import type { MultiPolygon } from 'geojson'
import type { MaritimeZone } from '../geo/maritime'
import { useFlagStore } from '../flags/flagStore'
import { fitFlag, patternGeometry } from './MapFlags'

/** One country's water, ready to draw. */
export interface MaritimeShape {
  id: string
  iso2: string
  d: string
  /** Largest projected dimension, for sizing the outline against the zone. */
  size: number
  /** The one flag laid across this territory. */
  pattern: NonNullable<ReturnType<typeof patternGeometry>>
}

/** Pattern id for a country's water. Distinct from the one its land uses. */
export function maritimePatternId(countryId: string): string {
  return `map-sea-${countryId}`
}

/** Longitude brought into the frame of `centreLon`, so a zone at the dateline is whole. */
function normaliseLon(lon: number, centreLon: number): number {
  let x = lon
  while (x - centreLon > 180) x -= 360
  while (centreLon - x > 180) x += 360
  return x
}

/** Extent of a set of polygons, measured in one frame so the dateline cannot split it. */
function boundsOf(
  polygons: number[][][][],
  centreLon: number,
): { west: number; east: number; south: number; north: number } | null {
  let west = Infinity
  let east = -Infinity
  let south = Infinity
  let north = -Infinity
  for (const polygon of polygons) {
    for (const [lon, lat] of polygon[0] ?? []) {
      const x = normaliseLon(lon, centreLon)
      if (x < west) west = x
      if (x > east) east = x
      if (lat < south) south = lat
      if (lat > north) north = lat
    }
  }
  return Number.isFinite(west) && Number.isFinite(south) ? { west, east, south, north } : null
}

/**
 * How much of a zone may be land before the zone stops being an island territory.
 *
 * This is the whole distinction between a country whose water is part of how its
 * territory reads and one where it is not. It is asked of each zone separately rather
 * than of the country, which is what tells Hawaii apart from the country that owns it:
 * the United States holds three zones, and only the Hawaiian one is an island territory.
 *
 * A twentieth separates them with room to spare. Above it sit the mainlands — Germany's
 * land is six times its water, Romania's ten, China's eleven, Brazil's more than twice,
 * Canada's nearly twice, and mainland France, Spain, Italy, the United States and Alaska
 * all hold more land than a twentieth of their seas. Below it sit the island
 * territories: Fiji at a seventieth, Hawaii and the Canaries at a hundredth, French
 * Polynesia and Kiribati at a thousandth, Tuvalu at a thirty-thousandth.
 */
const ISLAND_LAND_SHARE = 0.05

/**
 * The zones that belong to island territories, grouped one shape per entity.
 *
 * Worked out in geographic coordinates, so it does not depend on the projection and is
 * computed once for the dataset rather than on every camera change.
 *
 * A zone is attributed to its own entity where this map draws one, and to the sovereign
 * where it does not. French Guiana is the case for the fallback: it holds its own zone
 * and has a flag of its own, but Natural Earth draws it inside France, so nothing here
 * is painted with that flag. (Its zone is then rejected anyway — Guiana is a continental
 * coast, not an island — which is exactly right: no water is drawn around France.)
 *
 * Whatever survives is merged per entity, so a country is one water territory carrying
 * one flag however many zones and islands it is made of. French Polynesia's islands run
 * to dozens and Kiribati's zones to three; each country still gets a single shape and a
 * single flag, because the fill is the one pattern that country's land already uses.
 */
export function selectIslandZones(
  zones: MaritimeZone[] | undefined,
  landById: (id: string) => Parameters<typeof geoArea>[0] | undefined,
  isDrawn: (id: string) => boolean,
): Map<string, MultiPolygon> {
  const selected = new Map<string, MultiPolygon>()
  if (!zones) return selected

  for (const zone of zones) {
    const owner = isDrawn(zone.id) ? zone.id : zone.sovereign
    if (!owner || !isDrawn(owner)) continue

    const water = geoArea(zone.geometry)
    if (!(water > 0)) continue

    /*
     * The land this particular zone belongs to — not the country's whole land, which
     * would judge Hawaii by the size of the United States.
     *
     * Land *beside* the zone, not inside it: an exclusive economic zone is water, and
     * its inner boundary is the coastline, so a country's land lies outside its own
     * zone almost by definition. Asking what the zone contains returns nothing for
     * everybody, mainlands included, and would hand every country in the world a sea.
     * Adjacency is the question that separates them, and bounding boxes answer it —
     * a coast always touches the box of the water off it.
     */
    const centre = geoCentroid(zone.geometry)
    const centreLon = Number.isFinite(centre[0]) ? centre[0] : 0
    const zoneBox = boundsOf(zone.geometry.coordinates, centreLon)
    if (!zoneBox) continue

    const land = landById(owner)
    const geometry = (land as { geometry?: { type: string; coordinates: unknown } })?.geometry
    const polygons =
      geometry?.type === 'Polygon'
        ? [geometry.coordinates as number[][][]]
        : geometry?.type === 'MultiPolygon'
          ? (geometry.coordinates as number[][][][])
          : []

    let beside = 0
    for (const polygon of polygons) {
      const box = boundsOf([polygon], centreLon)
      if (!box) continue
      if (box.west > zoneBox.east || box.east < zoneBox.west) continue
      if (box.south > zoneBox.north || box.north < zoneBox.south) continue
      beside += geoArea({ type: 'Polygon', coordinates: polygon })
    }

    if (beside / water > ISLAND_LAND_SHARE) continue

    const existing = selected.get(owner)
    if (existing) existing.coordinates.push(...zone.geometry.coordinates)
    else selected.set(owner, { type: 'MultiPolygon', coordinates: [...zone.geometry.coordinates] })
  }

  return selected
}

/**
 * Projects each selected territory once per projection.
 *
 * Keyed on the projection alone, so panning and zooming reproject nothing — the paths
 * live in the same user space as the country paths and the camera transform carries
 * both, exactly as the land does.
 */
export function buildMaritimeShapes(
  selected: Map<string, MultiPolygon>,
  projection: GeoProjection | null,
  codeById: (id: string) => string | undefined,
): MaritimeShape[] {
  if (!projection) return []
  const path = geoPath(projection)
  const merged = selected

  const shapes: MaritimeShape[] = []
  for (const [id, geometry] of merged) {
    const code = codeById(id) as string
    const d = path(geometry)
    if (!d) continue
    const [[x0, y0], [x1, y1]] = path.bounds(geometry)
    if (![x0, y0, x1, y1].every(Number.isFinite)) continue

    /*
     * One flag, fitted to the water territory itself.
     *
     * The land's pattern cannot be borrowed for this. It is framed to the country's
     * islands, and a territory's sea is hundreds of times their size, so the pattern
     * simply repeats across it — Palau's water came out as a field of identical yellow
     * discs and Micronesia's as rows of stars, which is precisely the one-flag-per-island
     * look this is meant to avoid. Framed to the water it is one flag over one territory.
     *
     * The fitting is the same routine the land uses, applied to a different shape: the
     * area core of the geometry, the same bounded stretch toward its proportions, and the
     * same deepest-interior anchor. Nothing about land placement is touched.
     */
    const fit = fitFlag(geometry, path, projection)
    if (!fit) continue
    const pattern = patternGeometry(fit)
    if (!pattern) continue

    shapes.push({
      id,
      iso2: code.toLowerCase(),
      d,
      size: Math.max(x1 - x0, y1 - y0),
      pattern,
    })
  }

  // Sorted by id so the drawing order is fixed by the data and never by iteration
  // chance — the same map always produces the same layer.
  return shapes.sort((a, b) => a.id.localeCompare(b.id))
}

export interface MapMaritimeProps {
  shapes: MaritimeShape[]
  zoomK: number
  borderColor: string
  /** Outline width for a zone of this projected size, at this zoom. */
  borderWidth: (size: number, zoomK: number) => number
  showBorders: boolean
  opacity: number
  /**
   * One paint server for every zone, replacing each island nation's own.
   *
   * Set while the world is dominated, so the water an island country claims carries the
   * same continuous flag as the land — the feature keeps working, painted from one
   * source instead of many.
   */
  patternOverride?: string
}

export const MapMaritime = memo(function MapMaritime({
  shapes,
  zoomK,
  borderColor,
  borderWidth,
  showBorders,
  opacity,
  patternOverride,
}: MapMaritimeProps) {
  const flags = useFlagStore((s) => s.flags)
  /*
   * A zone is drawn once there is artwork to fill it with. Normally that is the
   * country's own flag; under an override there is one flag for everything, so the
   * per-country test would hold every zone back waiting for a file nothing is loading.
   */
  const drawn = useMemo(
    () => (patternOverride ? shapes : shapes.filter((shape) => flags[shape.iso2])),
    [shapes, flags, patternOverride],
  )
  if (drawn.length === 0) return null

  return (
    <>
      <defs>
        {drawn.map((shape) => (
          <pattern
            key={shape.id}
            id={maritimePatternId(shape.id)}
            patternUnits="userSpaceOnUse"
            x={0}
            y={0}
            width={shape.pattern.width}
            height={shape.pattern.height}
            patternTransform={shape.pattern.transform}
          >
            <image
              href={flags[shape.iso2]}
              x={shape.pattern.imageX}
              y={shape.pattern.imageY}
              width={shape.pattern.imageWidth}
              height={shape.pattern.imageHeight}
              preserveAspectRatio="none"
            />
          </pattern>
        ))}
      </defs>
      <g className="map-maritime" pointerEvents="none" opacity={opacity}>
      {drawn.map((shape) => (
        <path
          key={shape.id}
          d={shape.d}
          fill={patternOverride ?? `url(#${maritimePatternId(shape.id)})`}
          stroke={showBorders ? borderColor : 'none'}
          strokeWidth={showBorders ? borderWidth(shape.size, zoomK) : 0}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      </g>
    </>
  )
})
