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
 * **How much detail survives.** The raw layer is roughly 354 MB — a 200-mile offset is
 * smooth, but the coastal half of each zone carries the coastline at full resolution,
 * and none of that is legible on a world map. Douglas–Peucker at `TOLERANCE` degrees,
 * with coordinates rounded to `PRECISION` decimals, brings it to a few megabytes while
 * leaving the shape of every zone intact. The raw responses are cached, so re-running
 * with a different tolerance costs nothing.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readEntityMeta } from './entity-meta.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = join(root, '.cache', 'eez')
const OUT = join(root, 'public', 'geo', 'eez-territories.geojson')
const META = join(root, 'public', 'geo', 'country-meta.json')

const WFS = 'https://geo.vliz.be/geoserver/MarineRegions/wfs'
const LAYER = 'MarineRegions:eez'

/** Simplification tolerance in degrees, and coordinate precision in decimals. */
const TOLERANCE = Number(process.env.EEZ_TOLERANCE ?? 0.04)
const PRECISION = 3

/** Rings smaller than this after simplification carry no information at map scale. */
const MIN_RING_AREA = 0.004

const round = (n) => Number(n.toFixed(PRECISION))

/** Perpendicular distance from a point to the segment ab. */
function deviation(p, a, b) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1])
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

/** Douglas–Peucker, iterative so a long coastline cannot overflow the stack. */
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

function simplifyRing(ring) {
  const out = simplify(ring, TOLERANCE).map(([x, y]) => [round(x), round(y)])
  // A ring must close, and needs four points to enclose anything.
  if (out.length < 4) return null
  const [fx, fy] = out[0]
  const [lx, ly] = out[out.length - 1]
  if (fx !== lx || fy !== ly) out.push([fx, fy])
  return out.length >= 4 ? out : null
}

function simplifyGeometry(geometry) {
  const polygons =
    geometry.type === 'Polygon'
      ? [geometry.coordinates]
      : geometry.type === 'MultiPolygon'
        ? geometry.coordinates
        : []

  const kept = []
  for (const polygon of polygons) {
    const outer = simplifyRing(polygon[0])
    if (!outer || ringArea(outer) < MIN_RING_AREA) continue
    const rings = [outer]
    // Holes are kept only where they still enclose something: a zone with an enclave
    // cut out of it must keep that enclave, or it would cover a neighbour's water.
    for (const hole of polygon.slice(1)) {
      const ring = simplifyRing(hole)
      if (ring && ringArea(ring) >= MIN_RING_AREA) rings.push(ring)
    }
    kept.push(rings)
  }
  if (kept.length === 0) return null
  return kept.length === 1
    ? { type: 'Polygon', coordinates: kept[0] }
    : { type: 'MultiPolygon', coordinates: kept }
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
      // Cached already thinned: the raw coastline detail is never needed again, and
      // keeping it would put hundreds of megabytes on disk for nothing.
      const slim = {
        properties: {
          iso_ter1: feature.properties.iso_ter1,
          iso_sov1: feature.properties.iso_sov1,
          territory1: feature.properties.territory1,
          sovereign1: feature.properties.sovereign1,
          pol_type: feature.properties.pol_type,
          geoname: feature.properties.geoname,
        },
        geometry: simplifyGeometry(feature.geometry),
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

  if ((i + 1) % 25 === 0) console.log(`[eez] ${i + 1}/${total}`)
}

// Sorted by id so the file is byte-stable between runs.
features.sort((a, b) => a.properties.id.localeCompare(b.properties.id))

writeFileSync(OUT, JSON.stringify({ type: 'FeatureCollection', features }), 'utf8')

const bytes = readdirSync(join(root, 'public', 'geo'))
  .filter((f) => f === 'eez-territories.geojson')
  .map(() => readFileSync(OUT).length)[0]

console.log(`[eez] ${features.length} zones -> public/geo/eez-territories.geojson (${(bytes / 1e6).toFixed(1)} MB)`)
console.log(`[eez] tolerance ${TOLERANCE}°, precision ${PRECISION} dp`)
for (const [type, n] of skipped.type) console.log(`[eez] skipped ${n} × ${type}`)
if (skipped.empty) console.log(`[eez] skipped ${skipped.empty} that simplified away`)
if (skipped.unmatched.size) {
  console.log(`[eez] ${skipped.unmatched.size} zones match no entity on this map:`)
  for (const [name, id] of skipped.unmatched) console.log(`  ${id} — ${name}`)
}
