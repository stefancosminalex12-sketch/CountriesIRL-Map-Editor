/**
 * The ground Hide Territories takes off the map, for the layers that are not drawn per entity.
 *
 * The land, its flag, its name, its share of the border network, its island water and its
 * magnifier are all drawn per territory, and each of those already leaves a hidden one out.
 * Lakes and rivers are not: each is one path for the whole map, because they are never
 * addressed one by one. So they are masked instead, with this footprint: everything inside a
 * hidden territory goes, down to the half of a lake that lies on its side of a border, and
 * everything outside it stays.
 *
 * **The footprint is the territory's own outline, with its lakes filled in.** Some datasets cut
 * a lake out of the land around it as a hole (the Census Bureau's cartographic boundaries do,
 * and Natural Earth does for a few), and a lake in a hole is still in the territory. So a hole
 * with a lake in it is filled. Every other hole is kept, because another territory's land is in
 * it: Lesotho inside South Africa, San Marino and the Vatican inside Italy. Hiding South Africa
 * hides nothing of Lesotho's, rivers and lakes included.
 *
 * Nothing here changes the geography. It is a footprint computed from the loaded geometry,
 * used as a clip, and gone the moment the territory is shown again.
 */
import { geoContains } from 'd3-geo'
import type { Feature, MultiPolygon, Polygon, Position } from 'geojson'
import type { LoadedDataset } from '../geo/datasets'

/** Any lake layer: only its features are read. */
type Lakes = { features: readonly Feature[] }

type LakeIndex = { box: [number, number, number, number]; feature: Feature }[]

const lakeIndexes = new WeakMap<object, LakeIndex>()

/** Each lake with its lon/lat box, so a hole is tested only against lakes that could hold it. */
function indexLakes(lakes: Lakes): LakeIndex {
  const cached = lakeIndexes.get(lakes)
  if (cached) return cached
  const index: LakeIndex = []
  for (const feature of lakes.features) {
    const g = feature.geometry
    if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) continue
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
    const polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
    for (const polygon of polygons) {
      for (const [lon, lat] of polygon[0]) {
        if (lon < w) w = lon
        if (lon > e) e = lon
        if (lat < s) s = lat
        if (lat > n) n = lat
      }
    }
    index.push({ box: [w, s, e, n], feature })
  }
  lakeIndexes.set(lakes, index)
  return index
}

/** Planar point-in-ring, for finding a point inside a hole; the hole is small enough for it. */
function inRing(x: number, y: number, ring: Position[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** A point strictly inside a ring: its vertex average when that works, else a chord's midpoint. */
function pointInside(ring: Position[]): Position | null {
  const count = ring.length - 1
  if (count < 3) return null
  let x = 0
  let y = 0
  for (let i = 0; i < count; i++) {
    x += ring[i][0]
    y += ring[i][1]
  }
  if (inRing(x / count, y / count, ring)) return [x / count, y / count]
  const half = Math.floor(count / 2)
  for (let i = 0; i < count; i++) {
    const a = ring[i]
    for (const step of [half, Math.floor(count / 3), 2]) {
      const b = ring[(i + step) % count]
      const mx = (a[0] + b[0]) / 2
      const my = (a[1] + b[1]) / 2
      if (inRing(mx, my, ring)) return [mx, my]
    }
  }
  return null
}

function holeIsLake(hole: Position[], lakes: LakeIndex): boolean {
  const point = pointInside(hole)
  if (!point) return false
  const [x, y] = point
  for (const { box, feature } of lakes) {
    if (x < box[0] || x > box[2] || y < box[1] || y > box[3]) continue
    if (geoContains(feature, point as [number, number])) return true
  }
  return false
}

/**
 * The hidden territories' footprints as one MultiPolygon in lon/lat, or null when nothing is
 * hidden. Project it with the same projection the lakes and rivers use and clip them by it.
 */
export function hiddenFootprint(
  geo: LoadedDataset,
  hiddenIds: ReadonlySet<string>,
  lakes: Lakes | null,
): MultiPolygon | null {
  if (hiddenIds.size === 0) return null
  const lakeIndex = lakes ? indexLakes(lakes) : []
  const coordinates: Position[][][] = []
  for (const id of hiddenIds) {
    const geometry = geo.byId.get(id)?.geometry as Polygon | MultiPolygon | undefined
    if (!geometry) continue
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
    for (const [outer, ...holes] of polygons) {
      coordinates.push([outer, ...holes.filter((hole) => !holeIsLake(hole, lakeIndex))])
    }
  }
  return coordinates.length ? { type: 'MultiPolygon', coordinates } : null
}
