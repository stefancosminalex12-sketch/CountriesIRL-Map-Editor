/**
 * The geometry the administrative engine needs, and nothing else.
 *
 * Three operations, each chosen so that the result is still exactly Natural Earth wherever
 * Natural Earth is the source:
 *
 *   - `dissolve` joins units that share edges through TopoJSON, which removes exactly the
 *     arcs two members share. No clipping, no tolerance: the outline of Slovenia's Gorenjska
 *     is the outer edge of its municipalities, vertex for vertex.
 *   - `split` cuts a unit into finer official units from another source (Germany's
 *     Regierungsbezirke inside a Land). The unit's own outline — its coast and its borders
 *     with the neighbours — stays Natural Earth's; only the new internal lines come from the
 *     finer source. Where the two sources' outlines disagree, the strip between them is
 *     given to the finer unit it borders, so the pieces cover the unit exactly.
 *   - `node` makes every vertex a cut introduced appear on every ring that passes through
 *     it, so neighbours still share their border vertex for vertex and TopoJSON still finds
 *     one arc where two units meet — the fact the borders, coastlines and merging rely on.
 */
import { geoArea, geoCentroid, geoContains } from 'd3-geo'
import * as topojsonServer from 'topojson-server'
import { merge } from 'topojson-client'
import * as clipper from './clip.mjs'

export const EARTH_KM = 6371

export const polygonsOf = (geometry) =>
  !geometry
    ? []
    : geometry.type === 'Polygon'
      ? [geometry.coordinates]
      : geometry.type === 'MultiPolygon'
        ? geometry.coordinates
        : []

/** A polygon wound the way d3 reads it: one enclosing more than a hemisphere is turned round. */
export function oriented(polygon) {
  return geoArea({ type: 'Polygon', coordinates: polygon }) > 2 * Math.PI
    ? polygon.map((ring) => [...ring].reverse())
    : polygon
}

export const polygonAreaKm2 = (polygon) =>
  geoArea({ type: 'Polygon', coordinates: oriented(polygon) }) * EARTH_KM * EARTH_KM

export const areaKm2 = (polygons) => polygons.reduce((sum, p) => sum + polygonAreaKm2(p), 0)

export function boundsOf(polygons) {
  let w = Infinity
  let s = Infinity
  let e = -Infinity
  let n = -Infinity
  for (const polygon of polygons) {
    for (const [x, y] of polygon[0] ?? []) {
      if (x < w) w = x
      if (x > e) e = x
      if (y < s) s = y
      if (y > n) n = y
    }
  }
  return [w, s, e, n]
}

export const boxesMeet = (a, b, pad = 0) =>
  a[0] - pad <= b[2] && b[0] - pad <= a[2] && a[1] - pad <= b[3] && b[1] - pad <= a[3]

/** Distance in km between two lon/lat points, locally flat — only used over short distances. */
export function km(lon1, lat1, lon2, lat2) {
  const x = (lon2 - lon1) * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180))
  const y = lat2 - lat1
  return Math.sqrt(x * x + y * y) * 111.195
}

export function ringLengthKm(ring) {
  let length = 0
  for (let i = 1; i < ring.length; i++) length += km(ring[i - 1][0], ring[i - 1][1], ring[i][0], ring[i][1])
  return length
}

/** A point inside a polygon set's largest polygon: its centroid if inside, else one nearby that is. */
export function interiorPoint(polygons) {
  let best = null
  let bestArea = -1
  for (const p of polygons) {
    const q = oriented(p)
    const a = geoArea({ type: 'Polygon', coordinates: q })
    if (a > bestArea) {
      bestArea = a
      best = q
    }
  }
  if (!best) return null
  const polygon = { type: 'Polygon', coordinates: best }
  const c = geoCentroid(polygon)
  if (geoContains(polygon, c)) return c
  const ring = best[0]
  for (let i = 0; i < ring.length; i += Math.max(1, Math.floor(ring.length / 80))) {
    for (const t of [0.5, 0.25, 0.75, 0.1, 0.9, 0.02]) {
      const q = [c[0] + (ring[i][0] - c[0]) * t, c[1] + (ring[i][1] - c[1]) * t]
      if (geoContains(polygon, q)) return q
    }
  }
  // A ring so thin that no sampled point falls inside: the midpoint of its first edge's inner side.
  const [a, b] = [ring[0], ring[1]]
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
}

/** Whether a polygon set contains a point, with a box test first. */
export function contains(entry, point) {
  const [w, s, e, n] = entry.bounds
  if (point[0] < w || point[0] > e || point[1] < s || point[1] > n) return false
  return entry.oriented.some((p) => geoContains({ type: 'Polygon', coordinates: p }, point))
}

export const indexed = (polygons) => ({ polygons, bounds: boundsOf(polygons), oriented: polygons.map(oriented) })

/* ------------------------------------------------------------------ dissolve */

/**
 * A polygon set with exact repeats removed.
 *
 * Natural Earth's admin-1 layer carries a few islands twice in one unit — Camarines Sur and
 * Batangas each hold the same islet two times over. Drawn, a repeat is invisible; dissolved, it
 * is fatal, because every arc of the islet is then shared by two members and the merge removes
 * the islet entirely. Compared by outer ring, from its lowest point, in either direction.
 */
export function uniquePolygons(polygons) {
  const seen = new Set()
  const out = []
  for (const polygon of polygons) {
    const key = ringKey(polygon[0] ?? [])
    if (seen.has(key)) continue
    seen.add(key)
    out.push(polygon)
  }
  return out
}

/** A polygon's identity for spotting exact repeats: its outer ring, from its lowest point. */
export const polygonKey = (polygon) => ringKey(polygon[0] ?? [])

function ringKey(ring) {
  const n = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.length - 1 : ring.length
  if (n === 0) return ''
  let start = 0
  for (let i = 1; i < n; i++) {
    if (ring[i][0] < ring[start][0] || (ring[i][0] === ring[start][0] && ring[i][1] < ring[start][1])) start = i
  }
  const walk = (step) => {
    const parts = []
    for (let k = 0; k < n; k++) {
      const p = ring[(start + step * k + n) % n]
      parts.push(`${p[0]},${p[1]}`)
    }
    return parts.join(';')
  }
  const forward = walk(1)
  const backward = walk(-1)
  return forward < backward ? forward : backward
}

/**
 * The union of polygon sets that meet along shared edges, exactly.
 *
 * Built as one TopoJSON topology without quantisation, so a shared edge is recognised by
 * identical coordinates and removed; everything else — every island, every coastal vertex —
 * comes back as it went in. Members that merely overlap (a minor island laid over the coast)
 * stay separate polygons of the result, as they were in the source.
 */
export function dissolve(polygonSets) {
  const sets = polygonSets.filter((s) => s.length > 0)
  if (sets.length === 0) return []
  if (sets.length === 1) return uniquePolygons(sets[0]).map(oriented)
  // A polygon repeated in two members would cancel itself out, exactly as within one.
  const seen = new Set()
  const geometries = sets.map((set) => ({
    type: 'MultiPolygon',
    coordinates: set.filter((polygon) => {
      const key = ringKey(polygon[0] ?? [])
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }),
  }))
  const topology = topojsonServer.topology({ g: { type: 'GeometryCollection', geometries } })
  const merged = merge(topology, topology.objects.g.geometries)
  return merged.coordinates.map(oriented)
}

/* --------------------------------------------------------------------- split */

const clip = {
  intersection: (a, b) => safely(() => clipper.intersection(a, b)),
  difference: (a, ...b) => safely(() => clipper.difference(a, ...b)),
  union: (a, ...b) => safely(() => clipper.union(a, ...b)),
}

function safely(run) {
  try {
    return run()
  } catch (error) {
    return { error }
  }
}

/** Closed rings only: the clipper returns them closed, and TopoJSON expects them so. */
const closed = (polygons) =>
  polygons.map((polygon) =>
    polygon.map((ring) => {
      const first = ring[0]
      const last = ring[ring.length - 1]
      return first[0] === last[0] && first[1] === last[1] ? ring : [...ring, first]
    }),
  )

/**
 * How thin a piece of a cut may be before it is taken for a seam between two sources rather
 * than land. Twice its area over its perimeter is its mean width: a strip the two sources'
 * outlines leave between them is tens of metres wide, and a real district is kilometres.
 */
const SLIVER_WIDTH_KM = 0.2
const SLIVER_MAX_AREA_KM2 = 50
/** Below this a scrap is nothing at all (well under a hectare). */
const SCRAP_KM2 = 0.001


/**
 * Cuts `bases` into the finer `sources`.
 *
 * `bases`: `[{ id, polygons }]`, Natural Earth derived — their outline is kept.
 * `sources`: `[{ key, polygons, ... }]`, the finer official units — their internal lines are
 * used. Returns one piece per source unit that lies in a base, carrying its base id, plus a
 * report of what had to be reconciled.
 */
export function split(bases, sources) {
  const report = { unassignedSources: [], reconciledKm2: 0, clipFailures: [], emptyBases: [] }
  const baseIndex = bases.map((b) => ({ ...b, bounds: boundsOf(b.polygons) }))

  // Each finer unit belongs to the base holding most of it — the one it really nests in.
  const assigned = new Map(bases.map((b) => [b.id, []]))
  for (const source of sources) {
    const bounds = boundsOf(source.polygons)
    let best = null
    for (const base of baseIndex) {
      if (!boxesMeet(bounds, base.bounds)) continue
      const cut = clip.intersection(base.polygons, source.polygons)
      if (cut.error) {
        report.clipFailures.push({ source: source.key, base: base.id, error: String(cut.error.message ?? cut.error) })
        continue
      }
      const area = areaKm2(cut)
      if (area > 0 && (!best || area > best.area)) best = { base, area, cut }
    }
    if (!best || best.area < SCRAP_KM2) {
      report.unassignedSources.push(source.key)
      continue
    }
    assigned.get(best.base.id).push({ source, polygons: best.cut })
  }

  const pieces = []
  for (const base of baseIndex) {
    const parts = assigned.get(base.id)
    if (parts.length === 0) {
      report.emptyBases.push(base.id)
      pieces.push({ source: null, baseId: base.id, polygons: base.polygons })
      continue
    }
    if (parts.length === 1) {
      // One finer unit fills the base: its outline is the base's, exactly.
      pieces.push({ source: parts[0].source, baseId: base.id, polygons: base.polygons })
      continue
    }

    // A clean source does not overlap itself; where one does, the later unit gives way.
    for (let i = 0; i < parts.length; i++) {
      const bi = boundsOf(parts[i].polygons)
      for (let j = i + 1; j < parts.length; j++) {
        if (!boxesMeet(bi, boundsOf(parts[j].polygons))) continue
        const overlap = clip.intersection(parts[i].polygons, parts[j].polygons)
        if (overlap.error || areaKm2(overlap) < SCRAP_KM2) continue
        const rest = clip.difference(parts[j].polygons, parts[i].polygons)
        if (!rest.error) parts[j].polygons = rest
      }
    }

    // Thin scraps of a piece away from its body are seams, not land of that unit.
    const loose = []
    for (const part of parts) {
      const kept = []
      const ranked = part.polygons
        .map((p) => ({ p, area: polygonAreaKm2(p), perimeter: ringLengthKm(p[0]) }))
        .sort((a, b) => b.area - a.area)
      ranked.forEach(({ p, area, perimeter }, k) => {
        const width = perimeter > 0 ? (2 * area) / perimeter : 0
        const seam = area < SCRAP_KM2 || (width < SLIVER_WIDTH_KM && area < SLIVER_MAX_AREA_KM2)
        if (k === 0 || !seam) kept.push(p)
        else loose.push(p)
      })
      part.polygons = kept
    }

    // What the finer source leaves of the base: its outline disagrees with Natural Earth's.
    const residual = clip.difference(base.polygons, ...parts.map((p) => p.polygons))
    if (residual.error) {
      report.clipFailures.push({ base: base.id, stage: 'residual', error: String(residual.error.message ?? residual.error) })
    } else {
      loose.push(...residual)
    }

    /*
     * Each leftover joins the piece it shares the most edge with, or the nearest when it is an
     * island. "Shares" is asked of the geometry: an edge of the leftover whose middle lies on a
     * piece's boundary. Not of vertex identity — the leftover's corners are crossings clipping
     * computed again for it, a couple of centimetres from the piece's own copies, and a strip
     * matched by identity alone went to whichever piece happened to be nearest.
     */
    const running = boundaryIndex(parts)
    const extra = parts.map(() => [])
    for (const polygon of loose) {
      const area = polygonAreaKm2(polygon)
      if (area <= 0) continue
      report.reconciledKm2 += area
      const score = new Array(parts.length).fill(0)
      for (const ring of polygon) {
        for (let i = 1; i < ring.length; i++) {
          const a = ring[i - 1]
          const b = ring[i]
          const middle = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
          const owners = running(middle)
          if (owners.size === 0) continue
          const length = km(a[0], a[1], b[0], b[1])
          for (const index of owners) score[index] += length
        }
      }
      let pick = score.indexOf(Math.max(...score))
      if (!(score[pick] > 0)) pick = nearestPart(parts, polygon)
      extra[pick].push(polygon)
    }

    parts.forEach((part, index) => {
      let polygons = part.polygons
      if (extra[index].length > 0) {
        const joined = clip.union(polygons, ...extra[index].map((p) => [p]))
        if (joined.error) {
          report.clipFailures.push({ base: base.id, source: part.source.key, stage: 'join', error: String(joined.error.message ?? joined.error) })
          polygons = [...polygons, ...extra[index]]
        } else {
          polygons = joined
        }
      }
      pieces.push({ source: part.source, baseId: base.id, polygons: despiked(closed(polygons)).map(oriented), derived: true })
    })
  }
  report.reconciledKm2 = Number(report.reconciledKm2.toFixed(3))
  return { pieces, report }
}

/**
 * Rings without the zero-area back-tracks clipping can leave on a straight edge.
 *
 * Kept collinear, a union along a long straight Natural Earth edge — the Belgian coast is one
 * 15 km segment — can come back running along it, doubling back over a stretch, and running
 * on: 3.176 → 3.227 → 3.191 → 3.349. The tip of such a doubling-back bounds nothing, whether
 * clipping created it or it is a vertex further along the line; removed, the ring runs straight
 * along the edge as its neighbour does. A tip a neighbour holds as a vertex of its own stays on
 * the neighbour's ring, which runs straight through it — the two still agree once the noding
 * has put the crossings on both.
 */
export function despiked(polygons) {
  /*
   * A tip is a vertex the ring steps out to and comes straight back from along the same line:
   * the next point lies back on the segment just walked (or the previous one on the segment
   * about to be walked), within a centimetre. Deliberately not "the path turns almost all the
   * way round": a real strip a few metres wide and twenty kilometres long turns almost all the
   * way round at its end too, and peeling it that way collapsed it into a chord across the land.
   */
  const RETRACE = 1e-7
  const onSegment = (p, a, b) => {
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const length2 = dx * dx + dy * dy
    if (length2 === 0) return p[0] === a[0] && p[1] === a[1]
    const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length2
    if (t < 0 || t > 1) return false
    return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]) <= RETRACE
  }
  const backtracks = (a, b, c) => onSegment(c, a, b) || onSegment(a, b, c)
  return polygons
    .map((polygon) =>
      polygon
        .map((ring) => {
          let points = ring.slice(0, -1)
          for (let changed = true; changed && points.length > 3; ) {
            changed = false
            for (let i = 0; i < points.length && points.length > 3; i++) {
              const a = points[(i - 1 + points.length) % points.length]
              const b = points[i]
              const c = points[(i + 1) % points.length]
              if (backtracks(a, b, c)) {
                points.splice(i, 1)
                changed = true
                i--
              }
            }
          }
          // A ring that encloses nothing — every point on one line — is not a ring.
          return points.length >= 3 && Math.abs(planarArea(points)) > 1e-14 ? [...points, points[0]] : null
        })
        // An outer ring that did not survive takes its holes with it.
        .filter((ring, index, rings) => ring !== null && rings[0] !== null),
    )
    .filter((polygon) => polygon.length > 0)
}

/** Twice the signed area of an open ring in the lon/lat plane — only its size is ever used. */
function planarArea(points) {
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    sum += a[0] * b[1] - b[0] * a[1]
  }
  return sum
}

/** Within this many degrees (about 10 cm) of a boundary, a point is on it. */
const ON_BOUNDARY = 1e-6
const BOUNDARY_CELL = 0.01

/**
 * A lookup of which pieces' boundaries pass through a point: every boundary segment of every
 * piece, filed in the cells it crosses.
 */
export function boundaryIndex(parts) {
  const cellOf = (x, y) => `${Math.floor(x / BOUNDARY_CELL)},${Math.floor(y / BOUNDARY_CELL)}`
  const cells = new Map()
  parts.forEach((part, index) => {
    for (const polygon of part.polygons) {
      for (const ring of polygon) {
        for (let i = 1; i < ring.length; i++) {
          const a = ring[i - 1]
          const b = ring[i]
          const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (BOUNDARY_CELL / 2)))
          const seen = new Set()
          for (let s = 0; s <= steps; s++) {
            const c = cellOf(a[0] + ((b[0] - a[0]) * s) / steps, a[1] + ((b[1] - a[1]) * s) / steps)
            if (seen.has(c)) continue
            seen.add(c)
            const list = cells.get(c)
            if (list) list.push({ index, a, b })
            else cells.set(c, [{ index, a, b }])
          }
        }
      }
    }
  })
  // A segment is filed where its half-cell samples fall, which for a point on it can be a
  // diagonal neighbour of the point's own cell — so the cells around it are asked too.
  return (point) => {
    const owners = new Set()
    const cx = Math.floor(point[0] / BOUNDARY_CELL)
    const cy = Math.floor(point[1] / BOUNDARY_CELL)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const s of cells.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (owners.has(s.index)) continue
          if (distanceToSegment(point, s.a, s.b) <= ON_BOUNDARY) owners.add(s.index)
        }
      }
    }
    return owners
  }
}

function distanceToSegment(p, a, b) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const length2 = dx * dx + dy * dy
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length2))
  return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1])
}

export function nearestPart(parts, polygon) {
  const [x, y] = polygon[0][0]
  let best = 0
  let bestKm = Infinity
  parts.forEach((part, index) => {
    for (const p of part.polygons) {
      const ring = p[0]
      const step = Math.max(1, Math.floor(ring.length / 400))
      for (let i = 0; i < ring.length; i += step) {
        const d = km(x, y, ring[i][0], ring[i][1])
        if (d < bestKm) {
          bestKm = d
          best = index
        }
      }
    }
  })
  return best
}

/* ---------------------------------------------------------------------- node */

// Noding lives in its own module: node.mjs.
export { node } from './node.mjs'
