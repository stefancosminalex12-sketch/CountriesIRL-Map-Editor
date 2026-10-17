/**
 * A whole TopoJSON topology at a coarser detail: its arcs simplified together by
 * `simplify-lines.mjs`, and — for the coarsest details — the islets and lakes too small to be
 * seen at that scale taken out, as Natural Earth's own 50m and 110m leave them out.
 *
 * Taking out is careful about what it may take:
 * - a whole piece of land at a time — the rings sharing arcs, so an island split between two
 *   entities goes or stays whole — and a hole only when it is a lake, never an enclave's;
 * - never an entity's largest polygon, so every entity keeps its land;
 * - never anything of an entity smaller than `smallEntityKm2`, whose rings are all kept whole.
 *
 * Arcs no ring uses any more are dropped and the rest renumbered; everything else — the objects,
 * their ids and properties, the grid — is the source's own.
 */
import { feature } from 'topojson-client'
import { geoArea } from 'd3-geo'
import { simplifyLines } from './simplify-lines.mjs'

const EARTH_KM2 = 6371.0088 ** 2
const indexOf = (i) => (i >= 0 ? i : ~i)

/** Polygons of a geometry, as lists of rings of arc indexes. */
function polygonsOf(g) {
  return g.type === 'Polygon' ? [g.arcs] : g.type === 'MultiPolygon' ? g.arcs : []
}

/** Area in km² of a polygon given by arc indexes (outer ring and holes). */
function polygonKm2(topology, polygon) {
  return geoArea(feature(topology, { type: 'Polygon', arcs: polygon })) * EARTH_KM2
}

/** Area in km² of one ring as its own polygon, whichever way it winds. */
function ringKm2(topology, ring) {
  const a = geoArea(feature(topology, { type: 'Polygon', arcs: [ring] }))
  return Math.min(a, 4 * Math.PI - a) * EARTH_KM2
}

/**
 * @param topology TopoJSON with one object of polygons, quantised (`transform`).
 * @param options.toleranceKm how far a dropped point may lie from the line that replaces it.
 * @param options.smallEntityKm2 entities smaller than this keep every point and every ring.
 * @param options.dropRingKm2 isolated polygons and holes smaller than this are taken out (0: none).
 * @param options.smallRingSpan see `simplifyLines`.
 */
export function simplifyTopology(topology, { toleranceKm, smallEntityKm2 = 2500, dropRingKm2 = 0, smallRingSpan, pinBaseline = true, maxRefines = 12, gentleRepair = true }) {
  const [sx, sy] = topology.transform.scale
  const [tx, ty] = topology.transform.translate
  const lonOf = (x) => x * sx + tx
  const latOf = (y) => y * sy + ty
  const objectName = Object.keys(topology.objects)[0]
  const object = topology.objects[objectName]

  /* Which entities are small: kept whole and never thinned. */
  const small = feature(topology, object).features.map((f) => geoArea(f) * EARTH_KM2 < smallEntityKm2)

  /* Taking out the islets and lakes this scale cannot show. */
  let droppedPolygons = 0
  let droppedHoles = 0
  const geometries = [...object.geometries]
  if (dropRingKm2) {
    /*
     * Islands, not polygons: rings that share an arc belong to one piece of land — an island split
     * between two entities (Åland's islets and Finland's), an enclave and the hole it fills — and
     * go or stay together. A piece goes when its land is smaller than `dropRingKm2`, it holds no
     * entity's largest polygon and no small entity's ring.
     */
    const rings = []
    object.geometries.forEach((g, gi) => {
      polygonsOf(g).forEach((polygon, pi) => polygon.forEach((ring, ri) => rings.push({ gi, pi, ri, ring })))
    })
    const parent = rings.map((_, i) => i)
    const find = (i) => {
      while (parent[i] !== i) i = parent[i] = parent[parent[i]]
      return i
    }
    const byArc = new Map()
    rings.forEach((r, i) => {
      for (const a of r.ring) {
        const k = indexOf(a)
        const other = byArc.get(k)
        if (other === undefined) byArc.set(k, i)
        else parent[find(i)] = find(other)
      }
    })
    // A polygon's holes go with it.
    const outerOf = new Map()
    rings.forEach((r, i) => {
      const key = `${r.gi}:${r.pi}`
      if (r.ri === 0) outerOf.set(key, i)
    })
    rings.forEach((r, i) => {
      if (r.ri > 0) parent[find(i)] = find(outerOf.get(`${r.gi}:${r.pi}`))
    })

    const largest = new Map()
    const polygonArea = new Map()
    object.geometries.forEach((g, gi) => {
      const polygons = polygonsOf(g)
      const areas = polygons.map((p) => polygonKm2(topology, p))
      areas.forEach((a, pi) => polygonArea.set(`${gi}:${pi}`, a))
      if (areas.length) largest.set(gi, areas.indexOf(Math.max(...areas)))
    })
    const pieces = new Map()
    rings.forEach((r, i) => {
      const root = find(i)
      let piece = pieces.get(root)
      if (!piece) pieces.set(root, (piece = { km2: 0, keep: false, polygons: new Set() }))
      if (r.ri === 0) {
        piece.km2 += polygonArea.get(`${r.gi}:${r.pi}`)
        piece.polygons.add(`${r.gi}:${r.pi}`)
        if (largest.get(r.gi) === r.pi || small[r.gi]) piece.keep = true
      }
    })
    const dropped = new Set()
    for (const piece of pieces.values()) {
      if (piece.keep || piece.km2 >= dropRingKm2) continue
      for (const key of piece.polygons) dropped.add(key)
    }
    // Holes whose own piece is only themselves and small: lakes, gone; an enclave's hole stays with its enclave.
    const droppedHole = new Set()
    rings.forEach((r, i) => {
      if (r.ri === 0 || small[r.gi]) return
      const alone = r.ring.every((a) => byArc.get(indexOf(a)) === i)
      if (alone && ringKm2(topology, r.ring) < dropRingKm2) droppedHole.add(`${r.gi}:${r.pi}:${r.ri}`)
    })
    droppedPolygons = dropped.size
    droppedHoles = droppedHole.size
    object.geometries.forEach((g, gi) => {
      const polygons = polygonsOf(g)
      if (polygons.length === 0) return
      const kept = []
      polygons.forEach((polygon, pi) => {
        if (dropped.has(`${gi}:${pi}`)) return
        kept.push(polygon.filter((_, ri) => ri === 0 || !droppedHole.has(`${gi}:${pi}:${ri}`)))
      })
      if (kept.length === polygons.length && kept.every((p, pi) => p.length === polygons[pi].length)) return
      geometries[gi] = kept.length === 1 ? { ...g, type: 'Polygon', arcs: kept[0] } : { ...g, type: 'MultiPolygon', arcs: kept }
    })
  }

  /* The arcs still used, renumbered. */
  const used = new Map()
  for (const g of geometries) for (const polygon of polygonsOf(g)) for (const ring of polygon) for (const i of ring) {
    const k = indexOf(i)
    if (!used.has(k)) used.set(k, used.size)
  }
  const order = [...used.keys()]
  const remap = (i) => (i >= 0 ? used.get(i) : ~used.get(~i))

  const lines = order.map((k) => {
    const arc = topology.arcs[k]
    const xy = new Int32Array(arc.length * 2)
    let x = 0
    let y = 0
    for (let i = 0; i < arc.length; i++) {
      x += arc[i][0]
      y += arc[i][1]
      xy[i * 2] = x
      xy[i * 2 + 1] = y
    }
    return xy
  })
  const newGeometries = geometries.map((g) => {
    const polygons = polygonsOf(g)
    if (polygons.length === 0) return g
    const arcs = polygons.map((p) => p.map((ring) => ring.map(remap)))
    return { ...g, arcs: g.type === 'Polygon' ? arcs[0] : arcs }
  })

  const rings = []
  const whole = new Set()
  newGeometries.forEach((g, gi) => {
    for (const polygon of polygonsOf(g)) for (const ring of polygon) {
      rings.push(ring)
      if (small[gi]) for (const i of ring) whole.add(indexOf(i))
    }
  })

  const result = simplifyLines(lines, rings, { toleranceKm, lonOf, latOf, whole, smallRingSpan, pinBaseline, maxRefines, gentleRepair })

  const arcs = result.lines.map((xy) => {
    const arc = []
    let px = 0
    let py = 0
    for (let i = 0; i < xy.length; i += 2) {
      arc.push([xy[i] - px, xy[i + 1] - py])
      px = xy[i]
      py = xy[i + 1]
    }
    return arc
  })

  return {
    topology: { ...topology, arcs, objects: { ...topology.objects, [objectName]: { ...object, geometries: newGeometries } } },
    stats: { ...result, droppedPolygons, droppedHoles, arcsBefore: topology.arcs.length, arcsAfter: arcs.length },
  }
}

/** Points of a topology's arcs inside a lon/lat box — what a detail costs to draw in one place. */
export function pointsInBox(topology, [west, south, east, north]) {
  const [sx, sy] = topology.transform.scale
  const [tx, ty] = topology.transform.translate
  let n = 0
  for (const arc of topology.arcs) {
    let x = 0
    let y = 0
    for (const [dx, dy] of arc) {
      x += dx
      y += dy
      const lon = x * sx + tx
      const lat = y * sy + ty
      if (lon >= west && lon <= east && lat >= south && lat <= north) n++
    }
  }
  return n
}
