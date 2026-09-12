/**
 * Fetches the maritime territory of every country and territory on the map.
 *
 * The source is Marine Regions' World EEZ, served by VLIZ over public WFS. It is the
 * authoritative dataset for this: one polygon per exclusive economic zone, attributed to
 * the territory that holds it and to its sovereign, and already reconciled between
 * neighbours. Natural Earth, which supplies everything else here, has no equivalent —
 * it carries maritime *indicator lines*, bathymetry and named sea regions, none of which
 * is a country-associated area — so nothing in the existing pipeline could stand in.
 *
 *   Flanders Marine Institute (2019). Maritime Boundaries Geodatabase: Maritime
 *   Boundaries and Exclusive Economic Zones (200NM), version 11.
 *   https://www.marineregions.org/  https://doi.org/10.14284/386   CC BY 4.0
 *
 * Two things are decided here rather than at render time.
 *
 * **Which zones are kept.** Only `200NM` zones, which is what makes the result
 * non-overlapping: the dataset separates ordinary zones from `Overlapping claim` and
 * `Joint regime` areas, so dropping those two resolves every contested water according
 * to the source rather than by drawing one country over another. Overlaps are therefore
 * a property of the data, not something the renderer has to arbitrate.
 *
 * **How much detail survives — without breaking the partition.** The raw layer is
 * roughly 354 MB — a 200-mile offset is smooth, but the coastal half of each zone carries
 * the coastline at full resolution, and none of that is legible on a world map. It is
 * thinned with Douglas–Peucker at `TOLERANCE` degrees, and the thinning is done on the
 * *shared boundaries*, not on each zone by itself.
 *
 * That distinction is the whole of this file. Two neighbours' zones meet along one line —
 * Fiji's and Tuvalu's water share a median line, vertex for vertex, in the source — and
 * thinning each zone on its own thinned that line twice, differently: the two copies
 * drifted apart by up to twenty kilometres, so neighbouring water territories no longer
 * met. Zoomed in, the ocean showed through between them as white slivers, and elsewhere
 * they overlapped. So the zones are first built into one topology, where every boundary
 * two zones share is a single arc, and each arc is simplified once. Both neighbours are
 * then drawn from the same simplified line and cannot come apart.
 *
 * Before the topology is built the raw coordinates are snapped to a `SNAP`-degree grid.
 * A shared vertex snaps to the same grid point from either side, so nothing that is
 * shared stops being shared, and the coastline's sub-kilometre wiggle — which the
 * simplification would discard anyway — collapses into repeated points that are dropped,
 * so the topology is built over a manageable number of vertices.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as topojsonServer from 'topojson-server'
import * as topojsonClient from 'topojson-client'
import { geoArea } from 'd3-geo'
import { readEntityMeta } from './entity-meta.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/**
 * Raw zones, snapped but not simplified. Not the old `.cache/eez`, which held zones that
 * had already been thinned one at a time — exactly the geometry that cannot be repaired.
 */
const CACHE = join(root, '.cache', 'eez-snapped')
const OUT = join(root, 'public', 'geo', 'eez-territories.geojson')
const META = join(root, 'public', 'geo', 'country-meta.json')

const WFS = 'https://geo.vliz.be/geoserver/MarineRegions/wfs'
const LAYER = 'MarineRegions:eez'

/** Simplification tolerance in degrees, and coordinate precision in decimals. */
const TOLERANCE = Number(process.env.EEZ_TOLERANCE ?? 0.04)
const PRECISION = 3

/**
 * The grid raw coordinates are snapped to before the topology is built, in degrees.
 * About 550 metres: an order of magnitude inside the simplification tolerance, so it
 * decides nothing the simplification would have kept, and on the grid of `PRECISION`.
 */
const SNAP = 0.005

/** Unshared rings smaller than this after simplification carry no information at map scale. */
const MIN_RING_AREA = 0.004

const round = (n) => Number(n.toFixed(PRECISION))
const snap = (n) => round(Math.round(n / SNAP) * SNAP)

/** Perpendicular distance from a point to the segment ab. */
function deviation(p, a, b) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1])
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

/**
 * Douglas–Peucker, iterative so a long coastline cannot overflow the stack. The two
 * ends are always kept, which for an arc is what keeps every junction between zones.
 */
function simplify(points, tolerance) {
  if (points.length <= 2) return points
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const stack = [[0, points.length - 1]]
  while (stack.length) {
    const [lo, hi] = stack.pop()
    let worst = 0
    let index = -1
    for (let i = lo + 1; i < hi; i++) {
      const d = deviation(points[i], points[lo], points[hi])
      if (d > worst) {
        worst = d
        index = i
      }
    }
    if (index !== -1 && worst > tolerance) {
      keep[index] = 1
      stack.push([lo, index], [index, hi])
    }
  }
  return points.filter((_, i) => keep[i])
}

/** Shoelace area, for discarding rings too small to see. */
function ringArea(ring) {
  let sum = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1])
  }
  return Math.abs(sum / 2)
}

/** A ring on the snapping grid, with the repeats the snapping made dropped. */
function snapRing(ring) {
  const out = []
  for (const [x, y] of ring) {
    const point = [snap(x), snap(y)]
    const last = out[out.length - 1]
    if (!last || last[0] !== point[0] || last[1] !== point[1]) out.push(point)
  }
  if (out.length < 3) return null
  const [fx, fy] = out[0]
  const [lx, ly] = out[out.length - 1]
  if (fx !== lx || fy !== ly) out.push([fx, fy])
  return out.length >= 4 ? out : null
}

function snapGeometry(geometry) {
  if (!geometry) return null
  const polygons =
    geometry.type === 'Polygon'
      ? [geometry.coordinates]
      : geometry.type === 'MultiPolygon'
        ? geometry.coordinates
        : []
  const kept = []
  for (const polygon of polygons) {
    const outer = snapRing(polygon[0])
    if (!outer) continue
    const rings = [outer]
    for (const hole of polygon.slice(1)) {
      const ring = snapRing(hole)
      if (ring) rings.push(ring)
    }
    kept.push(rings)
  }
  if (kept.length === 0) return null
  return { type: 'MultiPolygon', coordinates: kept }
}

async function featureCount() {
  const url = `${WFS}?service=WFS&version=2.0.0&request=GetFeature&typeName=${LAYER}&resultType=hits`
  const text = await fetch(url).then((r) => r.text())
  const match = text.match(/numberMatched="(\d+)"/)
  if (!match) throw new Error('could not read feature count')
  return Number(match[1])
}

async function fetchOne(index) {
  const cached = join(CACHE, `${index}.json`)
  if (existsSync(cached)) return JSON.parse(readFileSync(cached, 'utf8'))

  const url =
    `${WFS}?service=WFS&version=2.0.0&request=GetFeature&typeName=${LAYER}` +
    `&outputFormat=application/json&count=1&startIndex=${index}`
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const json = await response.json()
      const feature = json.features?.[0]
      if (!feature) throw new Error('no feature')
      const slim = {
        properties: {
          iso_ter1: feature.properties.iso_ter1,
          iso_sov1: feature.properties.iso_sov1,
          territory1: feature.properties.territory1,
          sovereign1: feature.properties.sovereign1,
          pol_type: feature.properties.pol_type,
          geoname: feature.properties.geoname,
        },
        geometry: snapGeometry(feature.geometry),
      }
      writeFileSync(cached, JSON.stringify(slim), 'utf8')
      return slim
    } catch (error) {
      if (attempt === 3) throw error
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
    }
  }
  return null
}

const known = new Set(Object.keys(readEntityMeta(META)))

mkdirSync(CACHE, { recursive: true })
const total = await featureCount()
console.log(`[eez] ${total} zones in MarineRegions:eez`)

const features = []
const skipped = { type: new Map(), unmatched: new Map(), empty: 0 }

for (let i = 0; i < total; i++) {
  const slim = await fetchOne(i)
  if ((i + 1) % 25 === 0) console.log(`[eez] ${i + 1}/${total}`)
  if (!slim) continue
  const p = slim.properties

  if (p.pol_type !== '200NM') {
    skipped.type.set(p.pol_type, (skipped.type.get(p.pol_type) ?? 0) + 1)
    continue
  }
  /*
   * The territory's own code where it has one, and the sovereign's where it does not.
   *
   * A zone belonging to a place that is not a separate country carries no territory
   * code — the Azores and Madeira, Hawaii and Alaska, the Canaries, the Galapagos,
   * the Andamans. Those waters belong to Portugal, the United States, Spain, Ecuador
   * and India respectively, and this map draws those countries, so the sovereign is
   * exactly the right owner. Eighteen zones reach the map only this way.
   */
  const id = p.iso_ter1 && known.has(p.iso_ter1) ? p.iso_ter1 : p.iso_sov1
  if (!id || !known.has(id)) {
    skipped.unmatched.set(p.geoname, p.iso_ter1 ?? p.iso_sov1 ?? '—')
    continue
  }
  if (!slim.geometry) {
    skipped.empty++
    continue
  }

  features.push({
    type: 'Feature',
    properties: { id, sovereign: p.iso_sov1 ?? null, name: p.geoname },
    geometry: slim.geometry,
  })
}

// Sorted by id so the topology, and so the file, is byte-stable between runs.
features.sort(
  (a, b) =>
    a.properties.id.localeCompare(b.properties.id) ||
    a.properties.name.localeCompare(b.properties.name),
)

/*
 * One topology over every kept zone: each stretch of boundary two zones share becomes a
 * single arc that both refer to. No quantisation — the coordinates are already on the
 * snapping grid, and a shared vertex is the same number on both sides.
 */
const rawPoints = features.reduce(
  (sum, f) => sum + f.geometry.coordinates.flat(2).length,
  0,
)
const topology = topojsonServer.topology({
  zones: { type: 'FeatureCollection', features },
})
const geometries = topology.objects.zones.geometries

/*
 * Which arcs lie between two *different* zones. Only those are the partition: an arc a
 * zone shares with itself — an islet's hole and the islet-sized piece of water inside it —
 * separates nothing from anybody.
 */
const arcZone = new Int32Array(topology.arcs.length).fill(-1)
const arcShared = new Uint8Array(topology.arcs.length)
geometries.forEach((geometry, zone) => {
  for (const polygon of geometry.type === 'Polygon' ? [geometry.arcs] : geometry.arcs ?? []) {
    for (const ring of polygon) {
      for (const arc of ring) {
        const index = arc < 0 ? ~arc : arc
        if (arcZone[index] === -1) arcZone[index] = zone
        else if (arcZone[index] !== zone) arcShared[index] = 1
      }
    }
  }
})
const sharedArcs = arcShared.reduce((n, shared) => n + shared, 0)

// Each arc thinned once: a boundary two zones share is the same line for both of them.
topology.arcs = topology.arcs.map((arc) => simplify(arc, TOLERANCE).map(([x, y]) => [round(x), round(y)]))

/*
 * Rings too small to see are dropped, but only where nothing else depends on them. A ring
 * whose every arc belongs to this zone alone is a speck of coast or an islet's hole; a
 * ring that shares an arc is part of the partition, and removing it would open a hole in
 * the neighbour on the other side of that arc.
 */
function decodeRing(ring) {
  const points = []
  for (const index of ring) {
    const arc = index < 0 ? [...topology.arcs[~index]].reverse() : topology.arcs[index]
    points.push(...(points.length ? arc.slice(1) : arc))
  }
  return points
}
const ownRing = (ring) => ring.every((index) => !arcShared[index < 0 ? ~index : index])
const visible = (ring) => {
  const points = decodeRing(ring)
  return points.length >= 4 && ringArea(points) >= MIN_RING_AREA
}
let droppedRings = 0
for (const geometry of geometries) {
  if (geometry.type !== 'MultiPolygon' && geometry.type !== 'Polygon') continue
  const polygons = geometry.type === 'Polygon' ? [geometry.arcs] : geometry.arcs
  const kept = []
  for (const polygon of polygons) {
    const [outer, ...holes] = polygon
    if (ownRing(outer) && !visible(outer)) {
      droppedRings += polygon.length
      continue
    }
    const rings = [outer]
    for (const hole of holes) {
      if (ownRing(hole) && !visible(hole)) droppedRings++
      else rings.push(hole)
    }
    kept.push(rings)
  }
  geometry.type = 'MultiPolygon'
  geometry.arcs = kept
}

/*
 * Every polygon checked against the sphere before it is written.
 *
 * Thinning each arc on its own can turn a sliver inside out: a polygon of a few square
 * kilometres whose sides are simplified separately can come back with its outline walked
 * the other way round, and a spherical renderer reads a reversed outline as everything
 * *except* the polygon — Sweden's water in the Bay of Bothnia came back as the whole globe
 * less eighteen square kilometres. No exclusive economic zone is larger than a hemisphere,
 * so one that measures larger is reversed and is turned back. Rings with no area left, a
 * line walked out and back, are dropped.
 */
let reoriented = 0
const out = []
for (const zone of topojsonClient.feature(topology, topology.objects.zones).features) {
  const polygons = (zone.geometry?.coordinates ?? [])
    .map((polygon) => polygon.filter((ring) => ring.length >= 4 && ringArea(ring) > 0))
    .filter((polygon) => polygon.length > 0)
    .map((polygon) => {
      if (!(geoArea({ type: 'Polygon', coordinates: polygon }) > 2 * Math.PI)) return polygon
      reoriented++
      return polygon.map((ring) => [...ring].reverse())
    })
  if (polygons.length === 0) {
    skipped.empty++
    continue
  }
  out.push({
    type: 'Feature',
    properties: zone.properties,
    geometry:
      polygons.length === 1
        ? { type: 'Polygon', coordinates: polygons[0] }
        : { type: 'MultiPolygon', coordinates: polygons },
  })
}

writeFileSync(OUT, JSON.stringify({ type: 'FeatureCollection', features: out }), 'utf8')

const keptPoints = topology.arcs.reduce((sum, arc) => sum + arc.length, 0)
console.log(`[eez] ${out.length} zones -> public/geo/eez-territories.geojson (${(readFileSync(OUT).length / 1e6).toFixed(1)} MB)`)
console.log(`[eez] ${topology.arcs.length} arcs, ${sharedArcs} shared between two zones`)
console.log(`[eez] ${rawPoints} snapped points -> ${keptPoints} arc points; ${droppedRings} unshared specks dropped; ${reoriented} inverted polygons turned back`)
console.log(`[eez] tolerance ${TOLERANCE}°, snap ${SNAP}°, precision ${PRECISION} dp`)
for (const [type, n] of skipped.type) console.log(`[eez] skipped ${n} × ${type}`)
if (skipped.empty) console.log(`[eez] skipped ${skipped.empty} that simplified away`)
if (skipped.unmatched.size) {
  console.log(`[eez] ${skipped.unmatched.size} zones match no entity on this map:`)
  for (const [name, id] of skipped.unmatched) console.log(`  ${id} — ${name}`)
}
