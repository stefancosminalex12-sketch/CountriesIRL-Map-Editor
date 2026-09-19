/**
 * Makes EuroGlobalMap's administrative areas meet exactly.
 *
 * EuroGlobalMap stores each area as its own polygon, and two neighbours draw their common
 * border independently: measured over the whole of Europe, 12,400 border segments are held by
 * one side only, the two copies typically 1–100 m apart and a few up to a kilometre. Drawn as
 * delivered, that is a hairline of background along every border and a sliver of double
 * coverage beside it; a map that shares borders exactly cannot be built from it directly.
 *
 * Two passes, on Clipper (`../admin/clip.mjs`), which keeps every input point's exact
 * coordinates and records the few it creates:
 *
 *   1. **Overlaps.** Areas are taken in a fixed order, and each gives way to those already
 *      placed: it keeps only the ground no earlier area holds. Where two copies of a border
 *      overlap, the earlier area's copy becomes the border for both.
 *   2. **Gaps.** What the areas leave uncovered inside the land shows up as holes in their
 *      union, found by merging the noded areas as one topology. A hole that is a lake stays water. Every other hole is a strip between two
 *      copies of a border, and it joins the area that shares the most of its edge.
 *
 * The noding (`../admin/node.mjs`) then puts every point clipping created onto every ring
 * that passes through it, so both sides of a border hold the same points in the same order
 * and TopoJSON finds one arc there. The geography is EuroGlobalMap's throughout: no point is
 * moved, the strips reassigned are the width of the disagreement, and the report says how much.
 */
import * as topojsonServer from 'topojson-server'
import { merge } from 'topojson-client'
import * as clip from '../admin/clip.mjs'
import { areaKm2, boundsOf, boxesMeet, interiorPoint, km, polygonAreaKm2, ringLengthKm, oriented } from '../admin/geometry.mjs'

const CELL = 1

/** A grid over boxes: which of the placed items might meet a box. */
function boxIndex() {
  const cells = new Map()
  return {
    add(item, box) {
      for (let x = Math.floor(box[0] / CELL); x <= Math.floor(box[2] / CELL); x++)
        for (let y = Math.floor(box[1] / CELL); y <= Math.floor(box[3] / CELL); y++) {
          const k = `${x},${y}`
          const list = cells.get(k)
          if (list) list.push(item)
          else cells.set(k, [item])
        }
    },
    query(box) {
      const out = new Set()
      for (let x = Math.floor(box[0] / CELL); x <= Math.floor(box[2] / CELL); x++)
        for (let y = Math.floor(box[1] / CELL); y <= Math.floor(box[3] / CELL); y++)
          for (const item of cells.get(`${x},${y}`) ?? []) out.add(item)
      return [...out]
    },
  }
}

const polygonBox = (polygon) => boundsOf([polygon])

/**
 * Pass 1: each area keeps only what no earlier area holds.
 * `areas`: `[{ id, polygons }]`, in priority order. Mutates `polygons`; returns a report.
 */
export function resolveOverlaps(areas, log = () => {}) {
  const index = boxIndex()
  const report = { areas: areas.length, trimmed: 0, trimmedKm2: 0, emptied: [], failures: [] }
  let done = 0
  for (const area of areas) {
    const box = boundsOf(area.polygons)
    // Only the placed polygons whose own box meets this area: a Norwegian county's
    // thousands of islands are not all neighbours of the one beside it.
    const clips = []
    for (const other of index.query(box)) {
      for (const polygon of other.polygons) if (boxesMeet(polygonBox(polygon), box)) clips.push(polygon)
    }
    if (clips.length > 0) {
      try {
        const before = areaKm2(area.polygons)
        const rest = clip.difference(area.polygons, clips)
        const after = areaKm2(rest)
        if (before - after > 1e-6) {
          report.trimmed++
          report.trimmedKm2 += before - after
        }
        if (rest.length === 0) report.emptied.push(area.id)
        area.polygons = rest
      } catch (error) {
        report.failures.push({ id: area.id, error: String(error.message ?? error) })
      }
    }
    area.box = boundsOf(area.polygons)
    index.add(area, area.box)
    if (++done % 2000 === 0) log(`overlaps: ${done}/${areas.length}`)
  }
  report.trimmedKm2 = Number(report.trimmedKm2.toFixed(3))
  return report
}

/**
 * Pass 2: the strips no area covers join the area beside them.
 *
 * `isWater(point)` says whether a hole is a lake, which stays a hole. Holes larger than
 * `maxKm2` are left alone too and reported: a strip between two copies of a border is never
 * that big, and anything that is deserves a look rather than a silent owner.
 */
export function fillGaps(areas, isWater, { maxKm2 = 25, log = () => {} } = {}) {
  const report = { holes: 0, filled: 0, filledKm2: 0, water: 0, large: [], orphan: 0 }
  const index = boxIndex()
  for (const area of areas) index.add(area, area.box ?? boundsOf(area.polygons))

  /*
   * The holes in the union of everything, found by merging a topology rather than by clipping:
   * once the borders are noded (both sides hold the same points), a merge cancels every border
   * two areas share, in time proportional to the number of arcs, and what is left inside the
   * land's rings is exactly the ground nobody covers.
   */
  const topology = topojsonServer.topology({
    all: { type: 'GeometryCollection', // One winding for every ring (d3's): the merge tells holes from outer rings by it.
    geometries: areas.filter((a) => a.polygons.length).map((a) => ({ type: 'MultiPolygon', coordinates: a.polygons.map(oriented) })) },
  })
  const merged = merge(topology, topology.objects.all.geometries)
  const holes = merged.coordinates.flatMap((polygon) => polygon.slice(1))
  log(`gaps: ${holes.length} holes in the union`)
  report.holes = holes.length

  for (const hole of holes) {
    const polygon = [hole]
    const km2 = polygonAreaKm2(polygon)
    // A ring that encloses nothing (a border traced out and back) reads as the whole sphere.
    if (!(km2 > 0) || km2 > 1e7) {
      report.degenerate = (report.degenerate ?? 0) + 1
      continue
    }
    const point = interiorPoint(polygon)
    if (point && isWater(point)) {
      report.water++
      continue
    }
    if (km2 > maxKm2) {
      report.large.push({ km2: Number(km2.toFixed(2)), at: point?.map((v) => Number(v.toFixed(4))) })
      continue
    }
    // The area that holds the most of the hole's edge.
    const box = polygonBox(polygon)
    const candidates = index.query(box).filter((a) => boxesMeet(a.box, box, 1e-6))
    const score = new Map()
    for (let i = 1; i < hole.length; i++) {
      const a = hole[i - 1]
      const b = hole[i]
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
      const length = km(a[0], a[1], b[0], b[1])
      for (const area of candidates) {
        if (onBoundary(area, mid)) score.set(area, (score.get(area) ?? 0) + length)
      }
    }
    const best = [...score].sort((x, y) => y[1] - x[1])[0]
    if (!best) {
      report.orphan++
      continue
    }
    const area = best[0]
    try {
      area.polygons = clip.union(area.polygons, [polygon])
      report.filled++
      report.filledKm2 += km2
    } catch {
      report.orphan++
    }
  }
  report.filledKm2 = Number(report.filledKm2.toFixed(3))
  return report
}

/** Whether a point lies on one of an area's edges (within about 10 cm). */
function onBoundary(area, p) {
  for (const polygon of area.polygons) {
    const b = polygonBox(polygon)
    if (p[0] < b[0] - 1e-6 || p[0] > b[2] + 1e-6 || p[1] < b[1] - 1e-6 || p[1] > b[3] + 1e-6) continue
    for (const ring of polygon) {
      for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1]
        const c = ring[i]
        const dx = c[0] - a[0]
        const dy = c[1] - a[1]
        const l2 = dx * dx + dy * dy
        const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2))
        if (Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]) <= 1e-6) return true
      }
    }
  }
  return false
}

export { ringLengthKm, oriented }
