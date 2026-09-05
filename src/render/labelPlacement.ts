/**
 * Fitting a name into a territory.
 *
 * The question this module answers is not "where is the middle of this country" but
 * **"what is the largest readable setting of this name that fits inside this shape, and
 * where"** — position, size and line breaks decided together, because they are one
 * decision. A name that fits on one line in Kazakhstan needs two in Bosnia and
 * Herzegovina, and the place it fits is not the place a single line would have gone.
 *
 * Everything is measured against the *projected* outline, through the very projection
 * the paths are drawn with. A centroid computed in degrees and then projected is not
 * the centroid of the projected shape, and every projection here bends the difference
 * somewhere visible.
 *
 * The work is in two stages, split by what makes it change:
 *
 *   1. `buildLabelShape` — geometry. Candidate positions inside each territory, each
 *      with a measurement of how much room it has *at a range of block shapes*. Depends
 *      on the projection, the dataset and the merges, and on nothing else. Expensive,
 *      and run once per camera projection.
 *
 *   2. `layoutLabels` — typography. The names wrapped, sized and fitted into that room,
 *      then resolved against each other so they do not collide. Depends on the names and
 *      the author's settings. Cheap, and run whenever those change.
 *
 * Because the room is measured once and read back as numbers, changing the font size or
 * renaming a merge never reprojects anything, and panning and zooming never touch either
 * stage: the labels live in projected user space, so the camera carries them.
 */
import { geoPath, type GeoProjection } from 'd3-geo'
import { geoProject } from 'd3-geo-projection'
import type { MultiPolygon, Polygon, Position } from 'geojson'
import { LABEL_FONTS } from '../types/map'

/** A projected polygon: outer ring first, then holes. */
type Ring = Position[]
type Flat = Ring[]

/* ------------------------------------------------------------------ tuning */

/**
 * Vertices any one ring is reduced to, **before it is projected**.
 *
 * Fitting is a question about a shape, not about a coastline, and every test below walks
 * every edge — so cost is the vertex count times the number of tests. At 10m the world is
 * 545,000 vertices and projecting all of them costs 800ms, almost entirely on detail that
 * moves the answer by less than the text is tall. Reducing first means the projection
 * sees a twentieth of the points, and it is a *sample* rather than a real simplification
 * because keeping every nth vertex is one pass and cannot fail.
 */
const MAX_RING_POINTS = 96

/** Cells the pole search may examine before taking the best answer it has. */
const MAX_CELLS = 700

/** Baseline-to-baseline distance as a multiple of font size. Tight, as map type is. */
const LINE_HEIGHT = 1.06

/**
 * The vertical space one line of glyphs actually occupies, in ems.
 *
 * Not the same number as the line advance, and conflating the two was why blocks that
 * fitted on paper overhung on screen: the advance is how far apart baselines are set,
 * while this is ascender to descender — 1.19 em as the browser renders it. A block of
 * *n* lines is therefore n-1 advances plus one of these, which is what the fit has
 * to be measured against.
 */
const LINE_BOX = 1.2

/** Most lines a name may be broken into. Beyond three it is a paragraph, not a label. */
const MAX_LINES = 3

/**
 * How a projected area becomes a font size: the ceiling every label is held under.
 *
 * Calibrated against this dataset rather than chosen: projected areas span six orders of
 * magnitude — Monaco is 1 square unit at a European framing where Russia is 573,000 — and
 * a size that tracked them linearly would be unreadable at one end and absurd at the
 * other. A fifth power turns that range into roughly a four-fold spread of type, which is
 * about as much variation as a map can carry legibly.
 *
 * The two numbers are fixed by two anchors: Russia, the largest name on the map, and
 * Slovenia, about the smallest worth setting inside its own borders. Everything else
 * follows from those — France lands near 12, Germany near 11, Bulgaria near 8, and the
 * ordering matches what a reader sees, which is the whole purpose of varying size at all.
 */
const AREA_SIZE_FACTOR = 1.65
const AREA_SIZE_EXPONENT = 0.202

/**
 * The weight the names are set in.
 *
 * Shared with the renderer rather than written twice, because it is an input to the text
 * measurement: a semibold string is wider than a regular one, and a fit computed at one
 * weight and drawn at another is a fit computed for the wrong text.
 */
export const LABEL_WEIGHT = 600

/** Smallest and largest a name may be drawn, in projected units, before the scale. */
export const LABEL_MIN_SIZE = 2.6
export const LABEL_MAX_SIZE = 26

/**
 * Smallest a name may be *rendered*, in screen pixels.
 *
 * A legibility floor rather than a style choice: below about five pixels a word is a grey
 * smear that still collides with its neighbours. A name under the floor is not shrunk, it
 * waits — zooming in brings it back at full size, which is how every atlas has ever
 * handled having more names than room.
 *
 * It sits **below** the size an outside label is set at, and that relationship is the
 * whole of the rule for choosing between them. With the floor above that size the two
 * fought and the wrong one won: a country whose name fitted inside it at 5.45 px failed
 * the floor by a twentieth of a pixel and was then captioned from *outside* at 6.5 px —
 * a label moved off its own territory in exchange for being fractionally larger. Bulgaria,
 * Greece, Hungary, Portugal, Czechia, Serbia and Ireland all left their borders that way.
 * Keeping the floor lower means inside always wins while inside is legible at all, and
 * outside is reached only by territories that genuinely cannot hold their name.
 */
export const LABEL_MIN_RENDERED_PX = 6

/**
 * The size range an outside label is set in, in projected units.
 *
 * A fixed size in the map's own space, like every other label — **not** a fixed size on
 * screen. Screen-constant was the earlier answer and it was the single largest source of
 * instability in this feature: holding a caption at 6.5 px means halving its projected
 * size at every doubling of the zoom, so it shrank by a factor of two at every step and
 * drifted by up to 1.4x between them. Sixty to seventy labels did that on every zoom.
 *
 * Within the range the size follows the territory, so a caption stays in proportion to
 * the thing it names: Luxembourg's is smaller than Slovenia's, and both are far smaller
 * than any name set inside its own borders.
 */
const EXTERNAL_MIN_SIZE = 2.6
const EXTERNAL_MAX_SIZE = 7
const EXTERNAL_OF_TERRITORY = 0.75

function clampSize(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

/**
 * How large a territory must be on screen before it is named from outside.
 *
 * Without this every speck in the dataset would carry a caption at every zoom, which is
 * two hundred captions pointing at territories the reader cannot see. A microstate earns
 * its name once it is a visible thing on the map; until then it waits like everything
 * else. It is a *visibility* rule and nothing more — it decides when a label is drawn,
 * never where it goes or how large it is.
 */
const EXTERNAL_MIN_TERRITORY_PX = 5

/**
 * Interior positions considered per territory, and how the room at each is sampled.
 *
 * Both numbers are a budget rather than an ideal, and they are where this module's cost
 * actually lives: measuring one position at one block shape is a walk over every edge, so
 * the work is spots × levels × the binary search, per territory, per projection.
 */
const MAX_SPOTS = 3
const PROFILE_LEVELS = [0.25, 0.55, 0.95, 1.5, 2.5]

/** Steps in each binary search for how far a block reaches. Resolution is limit / 2^n. */
const REACH_STEPS = 7

/* --------------------------------------------------------------- geometry */

function ringArea(ring: Ring): number {
  let sum = 0
  for (let i = 0, len = ring.length, j = len - 1; i < len; j = i++) {
    sum += (ring[j][0] - ring[i][0]) * (ring[i][1] + ring[j][1])
  }
  return Math.abs(sum) / 2
}

/** Every nth vertex, keeping the ring closed. */
function sampleRing(ring: Ring): Ring {
  if (ring.length <= MAX_RING_POINTS) return ring
  const step = Math.ceil(ring.length / MAX_RING_POINTS)
  const out: Ring = []
  for (let i = 0; i < ring.length; i += step) out.push(ring[i])
  const last = ring[ring.length - 1]
  if (out[out.length - 1] !== last) out.push(last)
  return out
}

/**
 * A projected polygon's edges, flattened to ax, ay, bx, by quads.
 *
 * Every question this module asks — is this point inside, how far is it from the edge,
 * does this box cross the outline — is a walk over every edge, and those walks are the
 * whole cost of the module. Over nested arrays each step is three pointer hops to reach
 * two numbers; over one Float64Array it is four indexed reads of contiguous memory. Same
 * geometry, same answers, several times less time — which is what keeps a phone from
 * being noticeably slower than a laptop at the moment the projection changes.
 *
 * Holes are in here alongside the outer ring and are not distinguished, which is exactly
 * right: a hole's edge bounds the shape just as the outside does.
 */
type Edges = Float64Array

function toEdges(polygon: Flat): Edges {
  let count = 0
  for (const ring of polygon) count += ring.length
  const edges = new Float64Array(count * 4)
  let at = 0
  for (const ring of polygon) {
    for (let i = 0, len = ring.length, j = len - 1; i < len; j = i++) {
      edges[at++] = ring[j][0]
      edges[at++] = ring[j][1]
      edges[at++] = ring[i][0]
      edges[at++] = ring[i][1]
    }
  }
  return edges.subarray(0, at)
}

/**
 * Whether a point is inside the polygon, holes counted.
 *
 * Holes are ordinary edges here, which is what makes an enclave behave: Lesotho is a hole
 * in South Africa, so a point inside Lesotho is crossed into twice and counts as outside,
 * and South Africa's name goes elsewhere — without anything having to know what an
 * enclave is.
 */
function insidePolygon(x: number, y: number, edges: Edges): boolean {
  let inside = false
  for (let i = 0; i < edges.length; i += 4) {
    const bx = edges[i]
    const by = edges[i + 1]
    const ax = edges[i + 2]
    const ay = edges[i + 3]
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside
  }
  return inside
}

/** Distance from a point to the polygon's edge, negative outside it. */
function signedDistance(x: number, y: number, edges: Edges): number {
  let best = Infinity
  for (let i = 0; i < edges.length; i += 4) {
    let px = edges[i]
    let py = edges[i + 1]
    let dx = edges[i + 2] - px
    let dy = edges[i + 3] - py
    if (dx !== 0 || dy !== 0) {
      const t = ((x - px) * dx + (y - py) * dy) / (dx * dx + dy * dy)
      if (t > 1) {
        px = edges[i + 2]
        py = edges[i + 3]
      } else if (t > 0) {
        px += dx * t
        py += dy * t
      }
    }
    dx = x - px
    dy = y - py
    const d = dx * dx + dy * dy
    if (d < best) best = d
  }
  if (best === Infinity) return 0
  return (insidePolygon(x, y, edges) ? 1 : -1) * Math.sqrt(best)
}

/** Whether a segment touches an axis-aligned rectangle. Liang–Barsky, clipped. */
function segmentHitsRect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): boolean {
  if (ax < x0 && bx < x0) return false
  if (ax > x1 && bx > x1) return false
  if (ay < y0 && by < y0) return false
  if (ay > y1 && by > y1) return false

  const dx = bx - ax
  const dy = by - ay
  let t0 = 0
  let t1 = 1
  /*
   * The four slabs, unrolled. Written out rather than looped over an array of pairs
   * because this is the innermost function in the module — it runs tens of thousands of
   * times per territory — and allocating four tuples per call to iterate them cost more
   * than the arithmetic they were tidying.
   */
  for (let side = 0; side < 4; side++) {
    const p = side === 0 ? -dx : side === 1 ? dx : side === 2 ? -dy : dy
    const q = side === 0 ? ax - x0 : side === 1 ? x1 - ax : side === 2 ? ay - y0 : y1 - ay
    if (p === 0) {
      if (q < 0) return false
      continue
    }
    const r = q / p
    if (p < 0) {
      if (r > t1) return false
      if (r > t0) t0 = r
    } else {
      if (r < t0) return false
      if (r < t1) t1 = r
    }
  }
  return true
}

/**
 * Whether a box spanning `x0..x1` at this height lies wholly inside the polygon.
 *
 * It is called with a box that contains a point already known to be inside, so the box is
 * inside exactly when no edge crosses it — a connected shape cannot leave the polygon
 * without crossing its boundary. **This is the guarantee that a name never spills into its
 * neighbours**: not an estimate from a radius or an area, but the actual outline being
 * consulted about the actual block of text.
 */
function spanInside(x0: number, x1: number, cy: number, hh: number, edges: Edges): boolean {
  const y0 = cy - hh
  const y1 = cy + hh
  for (let i = 0; i < edges.length; i += 4) {
    if (segmentHitsRect(edges[i], edges[i + 1], edges[i + 2], edges[i + 3], x0, y0, x1, y1)) {
      return false
    }
  }
  return true
}

/** How far a box of this height reaches from the point before it leaves the polygon. */
function reach(
  cx: number,
  cy: number,
  hh: number,
  edges: Edges,
  limit: number,
  sign: -1 | 1,
): number {
  let low = 0
  let high = limit
  for (let i = 0; i < REACH_STEPS; i++) {
    const mid = (low + high) / 2
    const x0 = sign < 0 ? cx - mid : cx
    const x1 = sign < 0 ? cx : cx + mid
    if (spanInside(x0, x1, cy, hh, edges)) low = mid
    else high = mid
  }
  return low
}

/**
 * The widest box of a given height that fits here, and where its centre falls.
 *
 * Measured left and right **separately**, because a box forced to stay centred on the
 * point cannot use room that is not symmetrical about it — and almost no country's room
 * is. Bulgaria is 48 units across, but the widest centred box at its pole is 21, because
 * the pole sits west of centre and the short side decides both halves; the name then
 * failed to fit and was captioned from outside a country it fits inside comfortably.
 *
 * Reaching each way independently and joining the two is exactly as safe: both halves are
 * inside and they share an edge, so their union is inside. What it buys is the true span,
 * and with it the offset that centres the name in the *room* rather than on the point.
 */
function widestSpan(
  cx: number,
  cy: number,
  hh: number,
  edges: Edges,
  limit: number,
): { hw: number; dx: number } {
  if (!spanInside(cx, cx, cy, hh, edges)) return { hw: 0, dx: 0 }
  const left = reach(cx, cy, hh, edges, limit, -1)
  const right = reach(cx, cy, hh, edges, limit, 1)
  return { hw: (left + right) / 2, dx: (right - left) / 2 }
}

interface Cell {
  x: number
  y: number
  h: number
  d: number
  max: number
}

function makeCell(x: number, y: number, h: number, edges: Edges): Cell {
  const d = signedDistance(x, y, edges)
  return { x, y, h, d, max: d + h * Math.SQRT2 }
}

/**
 * A max-heap of cells, ordered by the best answer each could still contain.
 *
 * The search below is best-first, so it needs the most promising cell on every step. Read
 * by scanning the array for its maximum, that step is linear in the queue — and the queue
 * grows by three every time one is taken, so a search that examines a few hundred cells
 * scans a few hundred thousand entries. Over the whole world that was most of the time
 * this module spent, and none of it was geometry.
 *
 * A heap makes the same step logarithmic. Nothing about the search or its answers
 * changes; the cells simply arrive in the same order for far less work.
 */
class CellHeap {
  private readonly items: Cell[] = []

  get size(): number {
    return this.items.length
  }

  push(cell: Cell): void {
    const items = this.items
    items.push(cell)
    let i = items.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (items[parent].max >= items[i].max) break
      const swap = items[parent]
      items[parent] = items[i]
      items[i] = swap
      i = parent
    }
  }

  pop(): Cell | undefined {
    const items = this.items
    const top = items[0]
    const last = items.pop()
    if (items.length > 0 && last !== undefined) {
      items[0] = last
      let i = 0
      for (;;) {
        const left = i * 2 + 1
        const right = left + 1
        let largest = i
        if (left < items.length && items[left].max > items[largest].max) largest = left
        if (right < items.length && items[right].max > items[largest].max) largest = right
        if (largest === i) break
        const swap = items[largest]
        items[largest] = items[i]
        items[i] = swap
        i = largest
      }
    }
    return top
  }
}

/**
 * The pole of inaccessibility: the point furthest from any edge.
 *
 * A best-first search over square cells — take the cell that could still hold a better
 * answer than the best found, and if it could, quarter it. It is the first candidate
 * position and the most central one, which is what makes it the tie-breaker when two
 * placements are equally good: a name belongs in the middle of its country unless
 * something is bought by moving it.
 */
function poleOfInaccessibility(
  edges: Edges,
  bbox: [number, number, number, number],
): { x: number; y: number; r: number } {
  const [minX, minY, maxX, maxY] = bbox
  const width = maxX - minX
  const height = maxY - minY
  const cellSize = Math.min(width, height)
  if (cellSize <= 0) return { x: minX, y: minY, r: 0 }

  const precision = Math.max(cellSize / 40, 0.02)
  let h = cellSize / 2
  const queue = new CellHeap()
  for (let x = minX; x < maxX; x += cellSize) {
    for (let y = minY; y < maxY; y += cellSize) {
      queue.push(makeCell(x + h, y + h, h, edges))
    }
  }
  let best = makeCell(minX + width / 2, minY + height / 2, 0, edges)

  let examined = 0
  while (queue.size > 0 && examined < MAX_CELLS) {
    const cell = queue.pop()
    if (!cell) break
    examined++

    if (cell.d > best.d) best = cell
    if (cell.max - best.d <= precision) continue

    h = cell.h / 2
    queue.push(makeCell(cell.x - h, cell.y - h, h, edges))
    queue.push(makeCell(cell.x + h, cell.y - h, h, edges))
    queue.push(makeCell(cell.x - h, cell.y + h, h, edges))
    queue.push(makeCell(cell.x + h, cell.y + h, h, edges))
  }
  return { x: best.x, y: best.y, r: Math.max(best.d, 0) }
}

/* ------------------------------------------------------------- projection */

/**
 * A geometry's pieces, reduced, biggest first — cached against the geometry object.
 *
 * Ordering them is what lets the projection see **one polygon instead of all of them**:
 * only the piece a name goes on is ever needed, and a scattered country is mostly rings
 * that will be discarded — Indonesia is over a thousand. Ordered by area in degrees,
 * which is a proxy and a safe one here: the question is only which piece is the mainland,
 * and latitude would have to flatter an outlying piece several-fold to overturn an answer
 * that is usually an order of magnitude apart.
 */
const piecesCache = new WeakMap<Polygon | MultiPolygon, Ring[][]>()

function geographicPieces(geometry: Polygon | MultiPolygon): Ring[][] {
  const cached = piecesCache.get(geometry)
  if (cached) return cached
  const groups: Ring[][] =
    geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  const pieces = groups
    .filter((rings) => rings.length > 0 && rings[0].length >= 4)
    .map((rings) => rings.map(sampleRing))
    .sort((a, b) => ringArea(b[0]) - ringArea(a[0]))
  piecesCache.set(geometry, pieces)
  return pieces
}

/** One reduced piece, in the plane, or null when the projection leaves nothing of it. */
function projectPiece(piece: Ring[], projection: GeoProjection): Flat | null {
  /*
   * Through `geoProject` rather than by calling the projection on each point, which is
   * what keeps the antimeridian, the clip and the rotation behaving as they do for the
   * drawn paths: a piece cut by the date line arrives as two polygons, exactly as it is
   * drawn, instead of as one shape stretched across the map with its name in the middle.
   */
  const projected = geoProject(
    { type: 'Polygon', coordinates: piece } as Polygon,
    projection,
  ) as Polygon | MultiPolygon | null
  if (!projected) return null

  const groups = projected.type === 'Polygon' ? [projected.coordinates] : projected.coordinates
  let best: Flat | null = null
  let bestArea = -1
  for (const rings of groups) {
    const usable = rings.filter((ring) => ring.length >= 4)
    if (usable.length === 0) continue
    if (!usable[0].every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))) continue
    // Sampled again: resampling puts points back along the long segments.
    const flat = usable.map(sampleRing)
    const area = ringArea(flat[0])
    if (area > bestArea) {
      bestArea = area
      best = flat
    }
  }
  return best
}

function boundsOf(ring: Ring): [number, number, number, number] {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const point of ring) {
    if (point[0] < minX) minX = point[0]
    if (point[0] > maxX) maxX = point[0]
    if (point[1] < minY) minY = point[1]
    if (point[1] > maxY) maxY = point[1]
  }
  return [minX, minY, maxX, maxY]
}

/* ------------------------------------------------------------- stage one */

/**
 * How much room one interior position has, measured at a range of block shapes.
 *
 * A single radius cannot answer the question a label asks. The largest circle inside
 * Chile is tiny, but Chile has room for a tall narrow stack of short lines; the largest
 * circle inside Egypt is generous, and Egypt has room for a single line far wider than
 * that circle. So the room is sampled as a *profile*: for each of several block heights,
 * the widest block of that height that fits here.
 *
 * Measured once, in stage one, and read back as arithmetic in stage two — which is why
 * changing the font size costs nothing.
 */
export interface LabelSpot {
  x: number
  y: number
  /** Distance to the nearest edge: how central this position is. */
  r: number
  /** Half-height sampled, the half-width that fits at it, and where that room sits. */
  profile: Array<{ hh: number; hw: number; dx: number }>
}

/** Everything geometry decides about one entity's label. */
export interface LabelShape {
  id: string
  clipId: string | null
  /** Projected area of the piece the name goes on — the placement order, and the size. */
  area: number
  /** The piece's extent, for anchoring a name that has to sit outside it. */
  minX: number
  minY: number
  maxX: number
  maxY: number
  /** Interior positions, most central first. */
  spots: LabelSpot[]
}

function profileAt(x: number, y: number, r: number, edges: Edges, limit: number): LabelSpot {
  const profile = PROFILE_LEVELS.map((level) => {
    const hh = r * level
    return { hh, ...widestSpan(x, y, hh, edges, limit) }
  })
  return { x, y, r, profile }
}

/**
 * Candidate positions inside one piece, most central first.
 *
 * The pole leads, because a name belongs in the middle of its country. The rest come from
 * a coarse scan of the interior, kept apart from one another so that they are genuinely
 * different offers rather than a cluster around the same place — they exist so that a
 * label with nowhere good to sit centrally, or one that would collide where it is, has
 * somewhere else *within its own territory* to go.
 */
function findSpots(polygon: Flat, bbox: [number, number, number, number]): LabelSpot[] {
  const [minX, minY, maxX, maxY] = bbox
  const width = maxX - minX
  const height = maxY - minY
  const limit = Math.max(width, height)
  const edges = toEdges(polygon)

  const pole = poleOfInaccessibility(edges, bbox)
  if (pole.r <= 0) return []

  const spots = [profileAt(pole.x, pole.y, pole.r, edges, limit)]

  /*
   * A compact territory gets the pole and nothing else. There is no room in it for two
   * meaningfully different positions, so scanning for them would be paying the most
   * expensive part of this module for an answer that is already known.
   */
  if (Math.min(width, height) < pole.r * 3) return spots

  const steps = 6
  const found: Array<{ x: number; y: number; r: number }> = []
  for (let i = 1; i < steps; i++) {
    for (let j = 1; j < steps; j++) {
      const x = minX + (width * i) / steps
      const y = minY + (height * j) / steps
      const d = signedDistance(x, y, edges)
      if (d > pole.r * 0.35) found.push({ x, y, r: d })
    }
  }
  found.sort((a, b) => b.r - a.r)

  const apart = pole.r * 1.5
  for (const point of found) {
    if (spots.length >= MAX_SPOTS) break
    if (spots.some((s) => Math.hypot(s.x - point.x, s.y - point.y) < apart)) continue
    spots.push(profileAt(point.x, point.y, point.r, edges, limit))
  }
  return spots
}

/**
 * The geometry stage: one entity's room to write in.
 *
 * Runs once per projection — which is to say once per camera projection, dataset, region
 * or merge change, and never on a pan, a zoom, a rename or a settings change.
 */
export function buildLabelShape(
  id: string,
  geometry: Polygon | MultiPolygon,
  projection: GeoProjection,
  clipId: string | null,
): LabelShape | null {
  /*
   * The biggest piece this projection actually draws. Usually the first one, so usually
   * one projection; the loop is for when the camera has clipped the mainland away and
   * the name belongs on whatever is still on the map.
   */
  let main: Flat | null = null
  for (const piece of geographicPieces(geometry)) {
    main = projectPiece(piece, projection)
    if (main) break
  }
  if (!main) return fallbackShape(id, geometry, projection, clipId)

  const bbox = boundsOf(main[0])
  const width = bbox[2] - bbox[0]
  const height = bbox[3] - bbox[1]
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null

  return {
    id,
    clipId,
    area: ringArea(main[0]),
    minX: bbox[0],
    minY: bbox[1],
    maxX: bbox[2],
    maxY: bbox[3],
    spots: findSpots(main, bbox),
  }
}

/**
 * A shape for geometry the search could not use.
 *
 * `geoPath` over the same projection — still a real position on the map rather than a
 * guess, simply without an interior to write in, so the name will be set outside it.
 * Reached only when the projected outline has no usable ring at all, which in practice
 * means geometry the projection clipped away.
 */
function fallbackShape(
  id: string,
  geometry: Polygon | MultiPolygon,
  projection: GeoProjection,
  clipId: string | null,
): LabelShape | null {
  const path = geoPath(projection)
  const box = path.bounds(geometry)
  if (!Number.isFinite(box[0][0]) || !Number.isFinite(box[1][0])) return null
  return {
    id,
    clipId,
    area: 0,
    minX: box[0][0],
    minY: box[0][1],
    maxX: box[1][0],
    maxY: box[1][1],
    spots: [],
  }
}


/* ------------------------------------------------------------- stage two */

export interface PlacedLabel {
  id: string
  /** Centre of the text block, in projected user space. */
  x: number
  y: number
  fontSize: number
  lines: string[]
  clipId: string | null
  /** True when the name is set beside its territory rather than inside it. */
  external: boolean
  /**
   * The smallest zoom at which this label is worth drawing.
   *
   * **The only thing about a label that the camera decides.** Everything else — where it
   * sits, how large it is set, where its lines break, whether it won its place against a
   * neighbour — is settled once, in the map's own coordinates, and is therefore identical
   * at every zoom. Zooming in can reveal a name; it can never move one, resize one, or
   * take one away.
   *
   * Derived from the two reasons a label is not worth drawing yet: type too small to read,
   * and — for a name set beside its territory — a territory too small to be looking at.
   */
  minZoom: number
}

/* ------------------------------------------------------- text measurement */

/**
 * How wide a string actually sets, in ems, in the face it will be drawn in.
 *
 * Measured rather than modelled. The previous version multiplied a character count by an
 * average advance, and an average is wrong for every particular name: "Illinois" and
 * "Wyoming" have eight letters each and differ by a fifth of their width, so a model
 * tuned to fit one leaves the other either overhanging its border or needlessly small.
 * Asking the text engine the same question the renderer will ask it removes that error
 * rather than reducing it.
 *
 * A canvas is used because it is the only synchronous text metric a browser offers, and
 * it measures the same font stack, weight and string that the SVG will set — so the two
 * agree. Measured once at 100px and divided down, because advance width is linear in
 * font size, which is what lets the fitting work in ems and apply a size afterwards.
 */
const widthCache = new Map<string, number>()
let measurer: CanvasRenderingContext2D | null | undefined

function context(): CanvasRenderingContext2D | null {
  if (measurer !== undefined) return measurer
  measurer =
    typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')
  return measurer
}

/** Advance width of a string in ems. Falls back to an average where no canvas exists. */
export function textWidthEm(text: string, font: string, weight: number): number {
  const key = `${weight}|${font}|${text}`
  const cached = widthCache.get(key)
  if (cached !== undefined) return cached

  const ctx = context()
  let width: number
  if (ctx) {
    ctx.font = `${weight} 100px ${font}`
    width = ctx.measureText(text).width / 100
  } else {
    // Server-side or a context-less browser: the old estimate, which is close enough
    // to keep a headless render from producing nonsense.
    width = text.length * 0.58
  }
  widthCache.set(key, width)
  return width
}

/* ----------------------------------------------------------- typography */

/**
 * A name broken into exactly `count` lines, balanced by measured width.
 *
 * Balanced rather than greedy, because a label is centred: greedy wrapping sets "Central
 * African Republic" as `Central African / Republic`, a long line over a short one, which
 * reads as lopsided at label sizes. Minimising the *widest* line is also exactly what
 * makes the block narrow, which is what the fit is bounded by.
 *
 * Balanced on width rather than on letter count, since that is what has to fit — "Wallis
 * and Futuna" splits differently by the two measures, and only one of them is the one
 * that will be drawn.
 *
 * Words are never broken. A break inside a word is unreadable on a map, and a name that
 * will not fit in whole words is a name that should be smaller or outside.
 */
function wrapInto(
  words: string[],
  count: number,
  width: (text: string) => number,
): string[] | null {
  if (count < 1 || words.length < count) return null
  if (count === 1) return [words.join(' ')]

  let best: string[] | null = null
  let bestWidest = Infinity
  const cuts: number[] = []

  // Every way to cut the sequence into `count` runs. Names are a handful of words, so
  // this is a few dozen possibilities at most.
  const walk = (start: number, remaining: number) => {
    if (remaining === 0) {
      const lines: string[] = []
      let from = 0
      for (const cut of cuts) {
        lines.push(words.slice(from, cut).join(' '))
        from = cut
      }
      lines.push(words.slice(from).join(' '))
      let widest = 0
      for (const line of lines) widest = Math.max(widest, width(line))
      if (widest < bestWidest) {
        bestWidest = widest
        best = lines
      }
      return
    }
    for (let cut = start; cut <= words.length - remaining; cut++) {
      cuts.push(cut)
      walk(cut + 1, remaining - 1)
      cuts.pop()
    }
  }
  walk(1, count - 1)
  return best
}

/**
 * The largest size this territory should be labelled at, whatever room it happens to have.
 *
 * Room alone is the wrong answer, and it was the previous one. A shape that is wide and
 * shallow has room for enormous type without being an important or a large place: Türkiye
 * came out at 25.4 against France's 18.7 on a fifth of the area, and the five biggest
 * countries all landed on the ceiling and became indistinguishable from one another. Size
 * stopped carrying any information at exactly the point where a reader would use it.
 *
 * So the size is also bounded by how large the territory *is* — its projected area, which
 * is the same quantity a reader is judging by eye. The exponent is what makes that usable:
 * projected areas here span six orders of magnitude, and a fifth power turns that into a
 * four-fold spread of type, which is about what a map can show. Russia stays the largest
 * name on the map and Slovenia the smallest, with everything ordered in between.
 */
function sizeCeilingForArea(area: number): number {
  if (!(area > 0)) return LABEL_MIN_SIZE
  return AREA_SIZE_FACTOR * Math.pow(area, AREA_SIZE_EXPONENT)
}

function widestLine(lines: string[], width: (text: string) => number): number {
  let widest = 0
  for (const line of lines) widest = Math.max(widest, width(line))
  return widest
}

/**
 * The largest font size at which this block of lines fits at this spot.
 *
 * Read straight off the profile. A block set at `size` is `blockEms(lines)` tall and
 * `widest` wide, both linear in the size — so each sampled height offers one candidate
 * size, bounded by that height and by the width measured there, and the best of them is
 * the answer. Arithmetic over five numbers, which is what makes the typography stage
 * cheap enough to run on every keystroke of a rename.
 */
function sizeAtSpot(
  spot: LabelSpot,
  lines: string[],
  blockWidth: number,
): { size: number; dx: number } {
  const blockHeight = blockEms(lines.length)
  if (blockWidth <= 0) return { size: 0, dx: 0 }
  let best = 0
  let dx = 0
  for (const level of spot.profile) {
    if (level.hw <= 0) continue
    const size = Math.min((2 * level.hh) / blockHeight, (2 * level.hw) / blockWidth)
    if (size > best) {
      best = size
      /*
       * Only as far as the block actually needs. The measured offset centres a box of
       * the *full* width available; a name narrower than that should stay as close to
       * the spot as it can, so it does not drift toward one border for no reason.
       */
      const used = (size * blockWidth) / 2
      const slack = Math.max(level.hw - used, 0)
      dx = level.dx > 0 ? Math.max(level.dx - slack, 0) : Math.min(level.dx + slack, 0)
    }
  }
  return { size: best, dx }
}

interface Option {
  x: number
  y: number
  fontSize: number
  lines: string[]
  /** Width of the widest line, in ems — measured, and carried so nothing re-measures. */
  blockWidth: number
  external: boolean
  /** How far from the territory's most central position, for tie-breaking. */
  offCentre: number
}

interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** How tall a block of this many lines is, in ems. */
function blockEms(lines: number): number {
  return (lines - 1) * LINE_HEIGHT + LINE_BOX
}

function blockRect(option: Option, fontSize: number): Rect {
  const hw = (option.blockWidth * fontSize) / 2
  const hh = (blockEms(option.lines.length) * fontSize) / 2
  return { x0: option.x - hw, y0: option.y - hh, x1: option.x + hw, y1: option.y + hh }
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1
}

/**
 * Everywhere this name could reasonably go inside its own territory, best first.
 *
 * The order is the policy, and it is the one the brief asks for: **the largest setting at
 * the most central position first, then smaller type and more lines at that same
 * position, and only then another position inside the same territory.** A label is never
 * moved to dodge a neighbour while it could have shrunk or wrapped instead, and it is
 * never moved outside its own borders at all — that is reserved for territories with no
 * interior to write in, which `externalOptions` handles separately.
 */
function interiorOptions(
  shape: LabelShape,
  name: string,
  width: (text: string) => number,
): Option[] {
  const words = name.split(/\s+/).filter(Boolean)
  if (words.length === 0 || shape.spots.length === 0) return []

  const ceiling = Math.min(sizeCeilingForArea(shape.area), LABEL_MAX_SIZE)
  const options: Option[] = []
  const centre = shape.spots[0]

  shape.spots.forEach((spot, spotIndex) => {
    for (let count = 1; count <= Math.min(MAX_LINES, words.length); count++) {
      const lines = wrapInto(words, count, width)
      if (!lines) continue
      const blockWidth = widestLine(lines, width)
      const raw = sizeAtSpot(spot, lines, blockWidth)
      if (raw.size <= 0) continue
      /*
       * The room the shape has, and the size the territory has earned, whichever is the
       * smaller. Room can only ever take size away here — a country is never given type
       * larger than it has somewhere to put.
       */
      const fontSize = Math.min(raw.size, ceiling)
      if (fontSize < LABEL_MIN_SIZE) continue
      options.push({
        x: spot.x + raw.dx,
        y: spot.y,
        fontSize,
        lines,
        blockWidth,
        external: false,
        offCentre: spotIndex === 0 ? 0 : Math.hypot(spot.x - centre.x, spot.y - centre.y),
      })
    }
  })

  /*
   * Best first: the biggest type wins, and between settings within a tenth of each other
   * the more central one does — so a label does not wander off centre to buy a two
   * percent gain in size.
   */
  options.sort((a, b) => {
    if (Math.abs(a.fontSize - b.fontSize) > Math.max(a.fontSize, b.fontSize) * 0.1) {
      return b.fontSize - a.fontSize
    }
    if (a.offCentre !== b.offCentre) return a.offCentre - b.offCentre
    return a.lines.length - b.lines.length
  })

  if (options.length === 0) return []

  /*
   * Then the same placement, smaller. Shrinking is preferred to moving, so these sit
   * ahead of the alternative positions when the resolver works down the list.
   */
  const best = options[0]
  const smaller: Option[] = []
  for (const factor of [0.78, 0.6]) {
    const fontSize = best.fontSize * factor
    if (fontSize >= LABEL_MIN_SIZE) smaller.push({ ...best, fontSize })
  }

  return [best, ...smaller, ...options.slice(1)].slice(0, 10)
}

/**
 * The name set beside its territory, for territories with no room inside them.
 *
 * Monaco cannot contain the word "Monaco" at any size a reader could use, and shrinking
 * the type until it fits is how a map ends up with captions that are technically present
 * and practically invisible. So the name is set at a small size just clear of the
 * territory, still centred on it, and it takes its chances in the same collision pass as
 * everything else.
 *
 * Reached only when nothing at all fits inside — which is a fact about the geometry, and
 * so is settled once and never revisited. A country that can hold its own name at a
 * legible size, however small, keeps it inside its borders: an outside caption is a last
 * resort, not a way of buying a larger name.
 *
 * Above first, because that is where a reader looks for a label; the other three sides are
 * there so that a crowded coastline still has somewhere to put one.
 */
function externalOptions(
  shape: LabelShape,
  name: string,
  width: (text: string) => number,
  size: number,
): Option[] {
  const words = name.split(/\s+/).filter(Boolean)
  /*
   * Wrapped like any other label, and for a sharper reason than tidiness. An outside
   * label is set beside land it does not own, so its width is measured in *other people's
   * countries*: a long name on one line reaches across its neighbours and reads as a
   * caption on whatever it happens to cross. Two lines halve that.
   */
  const wanted = width(name) > 6 ? Math.min(2, words.length) : 1
  const lines = wrapInto(words, wanted, width) ?? [name]
  const blockWidth = widestLine(lines, width)

  const cx = (shape.minX + shape.maxX) / 2
  const cy = (shape.minY + shape.maxY) / 2
  const halfHeight = (blockEms(lines.length) * size) / 2
  const halfWidth = (blockWidth * size) / 2
  const gap = size * 0.45

  return [
    { x: cx, y: shape.minY - halfHeight - gap },
    { x: cx, y: shape.maxY + halfHeight + gap },
    { x: shape.maxX + halfWidth + gap, y: cy },
    { x: shape.minX - halfWidth - gap, y: cy },
  ].map((at, index) => ({
    x: at.x,
    y: at.y,
    fontSize: size,
    lines,
    blockWidth,
    external: true,
    offCentre: index,
  }))
}

/** What the typography stage needs to know about the author's settings. */
export interface LabelStyleInput {
  /** The author's scale over the fitted size. */
  scale: number
  /** The chosen face, which decides how wide the glyphs run. */
  font: string
}

/**
 * The typography stage: names wrapped, sized, placed, and resolved against each other.
 *
 * **The camera is not an input here, and that is the point.** Every question this stage
 * answers is asked in the map's own coordinates, where the answers do not depend on how
 * far in the reader has zoomed: how much room a shape has, how large its name can be set,
 * whether two names overlap. Feeding the zoom in made all three of them move — the set of
 * names competing for space changed at every doubling, so an established label could be
 * pushed to another corner of its country, shrunk, or dropped because a neighbour had just
 * become eligible.
 *
 * Now the layout is computed once and the zoom only reveals it. What each label carries
 * away is a position, a size, a set of lines and a minZoom — and of those, only the last
 * is ever consulted again.
 *
 * Territories are settled largest first. That is the whole of the priority scheme and it
 * is the right one: a big country's name is the one a reader is looking for, it has the
 * least freedom to move, and it is the one whose absence would be noticed. A small
 * neighbour then takes the best of what is left — a smaller setting, an extra line,
 * another corner of its own territory — and if nothing is left it goes unnamed rather than
 * being drawn over someone else's name.
 *
 * Resolving *every* name at once, including the ones no zoom is currently showing, is what
 * makes that settlement final. Overlap in projected space is the same fact at every zoom —
 * the camera scales both blocks by the same factor — so a name that has to give way here
 * would have to give way at any magnification, and there is nothing for a later zoom to
 * reconsider.
 */
export function layoutLabels(
  shapes: LabelShape[],
  names: Map<string, string>,
  style: LabelStyleInput,
): PlacedLabel[] {
  const stack = (LABEL_FONTS.find((f) => f.id === style.font) ?? LABEL_FONTS[0]).stack
  const width = (text: string) => textWidthEm(text, stack, LABEL_WEIGHT)
  const scale = style.scale > 0 ? style.scale : 1

  const ordered = [...shapes].sort((a, b) => b.area - a.area || (a.id < b.id ? -1 : 1))
  const taken: Rect[] = []
  const placed: PlacedLabel[] = []

  for (const shape of ordered) {
    const name = names.get(shape.id)
    if (!name) continue

    const extent = Math.max(shape.maxX - shape.minX, shape.maxY - shape.minY)
    const options = interiorOptions(shape, name, width)

    /*
     * Outside only when inside genuinely will not do. `interiorOptions` has already
     * refused every setting below `LABEL_MIN_SIZE`, so an empty list *is* the finding
     * that this territory cannot hold its own name at a legible size — a fact about the
     * geometry, settled once, rather than something a zoom can change its mind about. A
     * country that can reasonably contain its name never reaches this branch.
     */
    if (options.length === 0) {
      /*
       * A caption is held under the same area law as every name set inside a border, and
       * that is what stops it outranking them. Without it the outside sizes answered to
       * nothing but their own range, so on a world map Greece was captioned at 7 while
       * France — twenty times its area — carried 6.1 on its own land. Size is supposed to
       * tell a reader which places are large; a rule that exempts the smallest territories
       * from it tells them the opposite.
       */
      const size = clampSize(
        Math.min(extent * EXTERNAL_OF_TERRITORY, sizeCeilingForArea(shape.area)),
        EXTERNAL_MIN_SIZE,
        EXTERNAL_MAX_SIZE,
      )
      options.push(...externalOptions(shape, name, width, size))
    }

    for (const option of options) {
      /*
       * The author's scale is applied here, to the fitted size and to the block measured
       * for collisions together — so turning the type up enlarges the names *and* keeps
       * them clear of each other at their new size, rather than only changing how many
       * are shown.
       */
      const fontSize = option.fontSize * scale
      const rect = blockRect(option, fontSize)
      let clear = true
      for (const other of taken) {
        if (overlaps(rect, other)) {
          clear = false
          break
        }
      }
      if (!clear) continue
      taken.push(rect)

      /*
       * Two reasons to wait, and a label waits for the later of them: until its type is
       * large enough on screen to read, and — for a name set beside its territory — until
       * that territory is large enough to be worth pointing at.
       */
      const legible = LABEL_MIN_RENDERED_PX / fontSize
      const visible = option.external && extent > 0 ? EXTERNAL_MIN_TERRITORY_PX / extent : 0

      placed.push({
        id: shape.id,
        x: option.x,
        y: option.y,
        fontSize,
        lines: option.lines,
        clipId: shape.clipId,
        external: option.external,
        minZoom: Math.max(legible, visible),
      })
      break
    }
  }

  return placed
}

/** Baseline-to-baseline distance for a rendered block, in projected units. */
export function lineAdvance(fontSize: number): number {
  return fontSize * LINE_HEIGHT
}
