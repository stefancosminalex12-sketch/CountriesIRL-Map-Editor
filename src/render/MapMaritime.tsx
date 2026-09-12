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
 * rather than by draw order — and the fetch simplifies that partition as one topology,
 * so two neighbours' water still meets along one line after thinning.
 *
 * **One territory, one body of water, one flag.** A territory's zones are joined into
 * the polygon they really form before anything is drawn (`dissolveTouching`), so no line
 * runs through the middle of its water where the source happened to cut it. And the flag
 * is framed over each body of water the map actually shows: one for the whole territory,
 * except where the edge of the map cuts it in two, when each side carries the complete
 * flag rather than a sliver of one stretched across the world.
 */
import { memo, useMemo } from 'react'
import { geoArea, geoCentroid, geoDistance, geoInterpolate, geoPath, type GeoProjection } from 'd3-geo'
import { geoProject } from 'd3-geo-projection'
import type { MultiPolygon, Polygon, Position } from 'geojson'
import type { MaritimeZone } from '../geo/maritime'
import { dissolveTouching } from '../geo/dissolve'
import { useFlagStore } from '../flags/flagStore'
import { fitFlagToPlanar, patternGeometry } from './MapFlags'

/** One body of a country's water, ready to draw. */
export interface MaritimeShape {
  /**
   * Unique per drawn body: the entity's id for its water, suffixed for a second body
   * where the edge of the map cuts the territory in two.
   */
  key: string
  /** The entity whose water this is. */
  id: string
  iso2: string
  d: string
  /** Largest projected dimension, for sizing the outline against the zone. */
  size: number
  /** The one flag laid across this body of water. */
  pattern: NonNullable<ReturnType<typeof patternGeometry>>
}

/** Pattern id for one body of a country's water. Distinct from the one its land uses. */
export function maritimePatternId(key: string): string {
  return `map-sea-${key}`
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
 * A zone is attributed to its own entity where this map has one, and to the sovereign
 * where it does not. French Guiana is the case for the fallback: it holds its own zone
 * and has a flag of its own, but Natural Earth draws it inside France, so nothing here
 * is painted with that flag. (Its zone is then rejected anyway — Guiana is a continental
 * coast, not an island — which is exactly right: no water is drawn around France.)
 *
 * "Has one" is `isOnMap`, and it is deliberately not the same question as `isDrawn`. A
 * territory the author has hidden is still on the map — it is simply not shown — so its
 * water is hidden with it. Asking `isDrawn` there instead is what handed a hidden Guam's
 * and American Samoa's water to the United States, painted with the Stars and Stripes
 * around islands that were no longer on the map.
 *
 * Whatever survives is merged per entity, so a country is one water territory carrying
 * one flag however many zones and islands it is made of. French Polynesia's islands run
 * to dozens and Kiribati's zones to three; each country still gets a single shape and a
 * single flag, because the fill is the one pattern that country's land already uses.
 * The zones of one entity are then dissolved into the polygon they form together, so
 * the seams the source cut into them — at the antimeridian, between neighbouring zones of
 * one owner — are not drawn as lines through its water.
 */
export function selectIslandZones(
  zones: MaritimeZone[] | undefined,
  landById: (id: string) => Parameters<typeof geoArea>[0] | undefined,
  isDrawn: (id: string) => boolean,
  isOnMap: (id: string) => boolean,
): Map<string, MultiPolygon> {
  const selected = new Map<string, MultiPolygon>()
  if (!zones) return selected

  for (const zone of zones) {
    const owner = isOnMap(zone.id) ? zone.id : zone.sovereign
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

  for (const [owner, geometry] of selected) selected.set(owner, dissolveTouching(geometry))
  return selected
}

/**
 * The largest step between two projected points, as a share of the map, that can still
 * be a step across the sea rather than a jump across the edge of the map.
 *
 * Following a territory from one of its pieces to another, a great circle sampled every
 * `SEAM_STEP` moves a few pixels at a time — even on Mercator at Svalbard's latitude it
 * is a small fraction of the map. Crossing the edge of the map it jumps the whole width
 * at once. A quarter separates the two by an order of magnitude either way.
 */
const SEAM_SHARE = 0.25

/** Sampling step along the great circle between two pieces, in radians (two degrees). */
const SEAM_STEP = (2 * Math.PI) / 180

/**
 * The bodies of water a projected territory is drawn as: its pieces, grouped by which
 * side of the map's edge they lie on.
 *
 * Almost always one group — the whole territory. It is two where the projection's edge
 * runs through the territory: on a world map centred on Greenwich, Fiji's water is cut at
 * the antimeridian and drawn at both edges of the map. Framing one flag over both put the
 * flag's two ends a map apart and showed a sliver of it in each; framed per side, each
 * carries the whole flag.
 *
 * Two pieces are on the same side when the great circle between them can be followed on
 * the map without jumping. That is a statement about the projection, not about distance:
 * Kiribati's three groups are thousands of kilometres apart and stay one body wherever
 * no edge falls between them.
 */
function sidesOf(polygons: Position[][][], projection: GeoProjection, span: number): Position[][][][] {
  if (polygons.length < 2) return [polygons]
  const plane = geoPath()
  const [[x0, y0], [x1, y1]] = plane.bounds({ type: 'MultiPolygon', coordinates: polygons })
  // A territory cut by the edge of the map reaches across a large part of it.
  if (!(Math.max(x1 - x0, y1 - y0) > span * SEAM_SHARE)) return [polygons]

  const pieces = polygons.map((polygon) => {
    const shape: Polygon = { type: 'Polygon', coordinates: polygon }
    const centroid = plane.centroid(shape)
    const inverted = projection.invert?.(centroid as [number, number])
    const geo =
      inverted && Number.isFinite(inverted[0]) && Number.isFinite(inverted[1])
        ? (inverted as [number, number])
        : null
    return { polygon, area: Math.abs(plane.area(shape)), geo }
  })

  const sameSide = (a: (typeof pieces)[number], b: (typeof pieces)[number]): boolean => {
    // A piece that cannot be placed on the globe is kept with the rest.
    if (!a.geo || !b.geo) return true
    const along = geoInterpolate(a.geo, b.geo)
    const steps = Math.max(2, Math.ceil(geoDistance(a.geo, b.geo) / SEAM_STEP))
    let previous = projection(a.geo)
    for (let step = 1; step <= steps; step++) {
      const next = projection(along(step / steps))
      if (!previous || !next) return false
      if (Math.hypot(next[0] - previous[0], next[1] - previous[1]) > span * SEAM_SHARE) return false
      previous = next
    }
    return true
  }

  const parent = pieces.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  for (let a = 0; a < pieces.length; a++) {
    for (let b = a + 1; b < pieces.length; b++) {
      if (find(a) !== find(b) && sameSide(pieces[a], pieces[b])) parent[find(a)] = find(b)
    }
  }

  const groups = new Map<number, { polygons: Position[][][]; area: number }>()
  pieces.forEach((piece, i) => {
    const root = find(i)
    const group = groups.get(root) ?? { polygons: [], area: 0 }
    group.polygons.push(piece.polygon)
    group.area += piece.area
    groups.set(root, group)
  })
  // The largest side first, so the entity's own id names its main body of water.
  return [...groups.values()].sort((a, b) => b.area - a.area).map((group) => group.polygons)
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
  const plane = geoPath()
  const [[sx0, sy0], [sx1, sy1]] = geoPath(projection).bounds({ type: 'Sphere' })
  const span = Math.max(sx1 - sx0, sy1 - sy0)
  if (!(span > 0)) return []

  const shapes: MaritimeShape[] = []
  for (const [id, geometry] of selected) {
    const code = codeById(id) as string
    /*
     * The territory in the plane of the map, cut and clipped exactly as its path is
     * drawn — so the pieces measured here are the pieces on screen.
     */
    const projected = geoProject(geometry, projection) as MultiPolygon | Polygon | null
    if (!projected) continue
    const polygons = projected.type === 'Polygon' ? [projected.coordinates] : projected.coordinates
    if (polygons.length === 0) continue

    sidesOf(polygons, projection, span).forEach((side, index) => {
      const body: MultiPolygon = { type: 'MultiPolygon', coordinates: side }
      const d = plane(body)
      if (!d) return
      const [[x0, y0], [x1, y1]] = plane.bounds(body)
      if (![x0, y0, x1, y1].every(Number.isFinite)) return

      /*
       * One flag, fitted to the body of water itself — all of it.
       *
       * The land's pattern cannot be borrowed for this. It is framed to the country's
       * islands, and a territory's sea is hundreds of times their size, so the pattern
       * simply repeats across it — Palau's water came out as a field of identical yellow
       * discs and Micronesia's as rows of stars, which is precisely the one-flag-per-island
       * look this is meant to avoid. Framed to the water it is one flag over one territory.
       *
       * The fitting is the one the land uses — the same bounded stretch toward the
       * shape's proportions and the same deepest-interior anchor — with one difference:
       * nothing is trimmed from the ends. A country's land may leave an outlying islet
       * outside its frame, where the pattern repeats, because the islet is a speck; a
       * territory's water is one surface, and any of it left outside the frame showed a
       * second, partial flag with a hard rectangular edge.
       */
      const fit = fitFlagToPlanar(side)
      if (!fit) return
      const pattern = patternGeometry(fit)
      if (!pattern) return

      shapes.push({
        key: index === 0 ? id : `${id}-${index + 1}`,
        id,
        iso2: code.toLowerCase(),
        d,
        size: Math.max(x1 - x0, y1 - y0),
        pattern,
      })
    })
  }

  // Sorted by key so the drawing order is fixed by the data and never by iteration
  // chance — the same map always produces the same layer.
  return shapes.sort((a, b) => a.key.localeCompare(b.key))
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
            key={shape.key}
            id={maritimePatternId(shape.key)}
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
          key={shape.key}
          d={shape.d}
          fill={patternOverride ?? `url(#${maritimePatternId(shape.key)})`}
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
