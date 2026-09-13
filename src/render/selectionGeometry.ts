/**
 * The map's outlines as geometry, for the Selection panel's tools.
 *
 * A rectangle or a brush stroke selects what it actually meets on the map, so the test has
 * to be made against the outlines as they are drawn — not against a country's bounding box,
 * which would take Italy for a stroke across the Adriatic, and not against its
 * representative point, which would miss a subdivision the stroke clipped at one corner.
 * The drawn outlines are the path strings every entity is rendered from, in the zoomed
 * group's own coordinates, so they are read back into vertex arrays here and tested
 * exactly: an edge crossing, or one shape lying wholly inside the other.
 *
 * Reading 20 MB of path data takes a noticeable moment, so it is done once per set of
 * outlines, cached against the array that holds them, and can be read ahead in slices (see
 * {@link prepareOutlines}) before a tool is first used.
 */
import { createSlicer } from '../geo/slices'

export interface ShapeOutline {
  id: string
  d: string
}

export interface Outline {
  id: string
  minX: number
  minY: number
  maxX: number
  maxY: number
  /** Every vertex, as `x0, y0, x1, y1, …`. */
  coords: Float64Array
  /** Where each ring starts, as a vertex index, followed by the total vertex count. */
  rings: Uint32Array
}

/**
 * How an entity drawn at another size than its own is scaled about its centre, so the tools
 * test it where it is drawn. The map draws every entity at its true size — there is no size
 * floor — so the canvas passes no frames; a speck is found through its assist catchment.
 */
export interface OutlineFrame {
  cx: number
  cy: number
  scale: number
}

/**
 * The frame an entity is clipped to, when an inset draws it — in the same coordinates as its
 * outline. An inset's outline runs on past its frame (Hawaii's atolls, Alaska's Aleutians) and
 * the part beyond is cut away; the tools test only what is inside, which is what can be seen.
 */
export interface OutlineClip {
  x: number
  y: number
  width: number
  height: number
}

/** How the outlines are drawn: how each is framed, what is clipped, and what is drawn at all. */
export interface OutlineView {
  frames: ReadonlyMap<string, OutlineFrame>
  clips: ReadonlyMap<string, OutlineClip>
  drawn: (id: string) => boolean
}

/**
 * Reads one path string back into vertices.
 *
 * `geoPath` writes polygons with three commands only — `M x,y`, `L x,y` and `Z` — so that
 * is what is read, with the numbers parsed in place rather than sliced out as strings first.
 */
export function parseOutline(id: string, d: string): Outline {
  const n = d.length
  let coords = new Float64Array(Math.max(64, Math.ceil(n / 6)))
  let size = 0
  const rings: number[] = []
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let i = 0

  const number = (): number => {
    let c = d.charCodeAt(i)
    while (c === 44 || c === 32 || c === 10 || c === 13 || c === 9) c = d.charCodeAt(++i)
    let sign = 1
    if (c === 45) {
      sign = -1
      c = d.charCodeAt(++i)
    } else if (c === 43) {
      c = d.charCodeAt(++i)
    }
    let value = 0
    while (c >= 48 && c <= 57) {
      value = value * 10 + (c - 48)
      c = d.charCodeAt(++i)
    }
    if (c === 46) {
      let scale = 1
      c = d.charCodeAt(++i)
      while (c >= 48 && c <= 57) {
        value = value * 10 + (c - 48)
        scale *= 10
        c = d.charCodeAt(++i)
      }
      value /= scale
    }
    if (c === 101 || c === 69) {
      let exponentSign = 1
      c = d.charCodeAt(++i)
      if (c === 45) {
        exponentSign = -1
        c = d.charCodeAt(++i)
      } else if (c === 43) {
        c = d.charCodeAt(++i)
      }
      let exponent = 0
      while (c >= 48 && c <= 57) {
        exponent = exponent * 10 + (c - 48)
        c = d.charCodeAt(++i)
      }
      value *= Math.pow(10, exponentSign * exponent)
    }
    return sign * value
  }

  const push = (x: number, y: number) => {
    if (size + 2 > coords.length) {
      const grown = new Float64Array(coords.length * 2)
      grown.set(coords)
      coords = grown
    }
    coords[size++] = x
    coords[size++] = y
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }

  while (i < n) {
    const c = d.charCodeAt(i)
    if (c === 77) {
      i++
      rings.push(size >> 1)
      const x = number()
      push(x, number())
    } else if (c === 76) {
      i++
      const x = number()
      push(x, number())
    } else if ((c >= 48 && c <= 57) || c === 45 || c === 46) {
      // Coordinates straight after another pair continue the line, as SVG reads them.
      const x = number()
      push(x, number())
    } else {
      i++
    }
  }
  rings.push(size >> 1)

  return { id, minX, minY, maxX, maxY, coords: coords.subarray(0, size), rings: Uint32Array.from(rings) }
}

interface OutlineIndex {
  outlines: Outline[]
  /** How many of the shapes have been read so far. */
  next: number
}

const indexes = new WeakMap<readonly ShapeOutline[], OutlineIndex>()

function indexFor(shapes: readonly ShapeOutline[]): OutlineIndex {
  let index = indexes.get(shapes)
  if (!index) {
    index = { outlines: [], next: 0 }
    indexes.set(shapes, index)
  }
  return index
}

/** Every shape's outline, reading whatever has not been read yet. */
export function outlinesOf(shapes: readonly ShapeOutline[]): Outline[] {
  const index = indexFor(shapes)
  for (; index.next < shapes.length; index.next++) {
    const shape = shapes[index.next]
    index.outlines.push(parseOutline(shape.id, shape.d))
  }
  return index.outlines
}

/** Reads the outlines ahead of time, a slice at a time. Stops early if `cancelled`. */
export async function prepareOutlines(
  shapes: readonly ShapeOutline[],
  cancelled: () => boolean,
): Promise<void> {
  const index = indexFor(shapes)
  const slicer = createSlicer(8)
  while (index.next < shapes.length) {
    if (slicer.due()) {
      await slicer.pause()
      if (cancelled()) return
    }
    const shape = shapes[index.next]
    index.outlines.push(parseOutline(shape.id, shape.d))
    index.next++
  }
}

/* ------------------------------------------------------------------ tests */

const orient = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) =>
  (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)

/** Whether `p` lies within the bounding box of the segment `a–b` — used once collinear. */
const within = (ax: number, ay: number, bx: number, by: number, px: number, py: number) =>
  px >= Math.min(ax, bx) && px <= Math.max(ax, bx) && py >= Math.min(ay, by) && py <= Math.max(ay, by)

/** Whether segments `a–b` and `c–d` share any point, touching included. */
function segmentsMeet(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): boolean {
  if (
    Math.max(ax, bx) < Math.min(cx, dx) ||
    Math.max(cx, dx) < Math.min(ax, bx) ||
    Math.max(ay, by) < Math.min(cy, dy) ||
    Math.max(cy, dy) < Math.min(ay, by)
  ) {
    return false
  }
  const d1 = orient(cx, cy, dx, dy, ax, ay)
  const d2 = orient(cx, cy, dx, dy, bx, by)
  const d3 = orient(ax, ay, bx, by, cx, cy)
  const d4 = orient(ax, ay, bx, by, dx, dy)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true
  }
  return (
    (d1 === 0 && within(cx, cy, dx, dy, ax, ay)) ||
    (d2 === 0 && within(cx, cy, dx, dy, bx, by)) ||
    (d3 === 0 && within(ax, ay, bx, by, cx, cy)) ||
    (d4 === 0 && within(ax, ay, bx, by, dx, dy))
  )
}

/** Whether the segment `a–b` has any point inside the rectangle. */
function segmentMeetsRect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): boolean {
  if (Math.max(ax, bx) < x0 || Math.min(ax, bx) > x1 || Math.max(ay, by) < y0 || Math.min(ay, by) > y1) {
    return false
  }
  if (ax >= x0 && ax <= x1 && ay >= y0 && ay <= y1) return true
  if (bx >= x0 && bx <= x1 && by >= y0 && by <= y1) return true
  // Neither end is inside, so the segment meets the rectangle only by crossing a side.
  return (
    segmentsMeet(ax, ay, bx, by, x0, y0, x1, y0) ||
    segmentsMeet(ax, ay, bx, by, x1, y0, x1, y1) ||
    segmentsMeet(ax, ay, bx, by, x1, y1, x0, y1) ||
    segmentsMeet(ax, ay, bx, by, x0, y1, x0, y0)
  )
}

/**
 * Whether a point is inside the outline, by the even-odd rule over all its rings — which is
 * the drawn fill for these shapes: holes are wound against their outer ring, and no two
 * rings of an entity cross.
 */
function contains(outline: Outline, x: number, y: number): boolean {
  if (x < outline.minX || x > outline.maxX || y < outline.minY || y > outline.maxY) return false
  const { coords, rings } = outline
  let inside = false
  for (let r = 0; r + 1 < rings.length; r++) {
    const start = rings[r]
    const end = rings[r + 1]
    if (end - start < 3) continue
    let px = coords[(end - 1) * 2]
    let py = coords[(end - 1) * 2 + 1]
    for (let k = start; k < end; k++) {
      const qx = coords[k * 2]
      const qy = coords[k * 2 + 1]
      if (qy > y !== py > y && x < ((px - qx) * (y - qy)) / (py - qy) + qx) inside = !inside
      px = qx
      py = qy
    }
  }
  return inside
}

/** Calls `edge` with every edge of the outline, closing edges included, until it returns true. */
function someEdge(
  outline: Outline,
  edge: (px: number, py: number, qx: number, qy: number) => boolean,
): boolean {
  const { coords, rings } = outline
  for (let r = 0; r + 1 < rings.length; r++) {
    const start = rings[r]
    const end = rings[r + 1]
    if (end - start < 2) continue
    let px = coords[(end - 1) * 2]
    let py = coords[(end - 1) * 2 + 1]
    for (let k = start; k < end; k++) {
      const qx = coords[k * 2]
      const qy = coords[k * 2 + 1]
      if (edge(px, py, qx, qy)) return true
      px = qx
      py = qy
    }
  }
  return false
}

/**
 * The part of segment `a–b` inside the clip rectangle, or `null` when none of it is
 * (Liang–Barsky).
 */
function clipSegment(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  clip: OutlineClip,
): [number, number, number, number] | null {
  let t0 = 0
  let t1 = 1
  const dx = bx - ax
  const dy = by - ay
  const edges: [number, number][] = [
    [-dx, ax - clip.x],
    [dx, clip.x + clip.width - ax],
    [-dy, ay - clip.y],
    [dy, clip.y + clip.height - ay],
  ]
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null
      continue
    }
    const t = q / p
    if (p < 0) {
      if (t > t1) return null
      if (t > t0) t0 = t
    } else {
      if (t < t0) return null
      if (t < t1) t1 = t
    }
  }
  return [ax + t0 * dx, ay + t0 * dy, ax + t1 * dx, ay + t1 * dy]
}

/** A point in the zoomed group's space, into the space an entity's outline is drawn in. */
function intoFrame(frame: OutlineFrame | undefined, x: number, y: number): [number, number] {
  if (!frame) return [x, y]
  return [(x - frame.cx) / frame.scale + frame.cx, (y - frame.cy) / frame.scale + frame.cy]
}

/**
 * The entities whose drawn outline meets the rectangle — any part of it: an edge inside or
 * crossing it, or the outline wholly around it.
 */
export function outlinesInRect(
  outlines: readonly Outline[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  view: OutlineView,
): string[] {
  const hits: string[] = []
  for (const outline of outlines) {
    if (!view.drawn(outline.id)) continue
    const frame = view.frames.get(outline.id)
    let [rx0, ry0] = intoFrame(frame, x0, y0)
    let [rx1, ry1] = intoFrame(frame, x1, y1)
    // Only the part of the rectangle inside the entity's clip, if it has one, can meet it.
    const clip = view.clips.get(outline.id)
    if (clip) {
      rx0 = Math.max(rx0, clip.x)
      ry0 = Math.max(ry0, clip.y)
      rx1 = Math.min(rx1, clip.x + clip.width)
      ry1 = Math.min(ry1, clip.y + clip.height)
      if (rx0 > rx1 || ry0 > ry1) continue
    }
    if (outline.maxX < rx0 || outline.minX > rx1 || outline.maxY < ry0 || outline.minY > ry1) continue
    const enclosed =
      outline.minX >= rx0 && outline.maxX <= rx1 && outline.minY >= ry0 && outline.maxY <= ry1
    if (
      enclosed ||
      someEdge(outline, (px, py, qx, qy) => segmentMeetsRect(px, py, qx, qy, rx0, ry0, rx1, ry1)) ||
      contains(outline, rx0, ry0)
    ) {
      hits.push(outline.id)
    }
  }
  return hits
}

/** Squared distance from point `p` to the segment `a–b`. */
function distanceToSegment2(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax
  const dy = by - ay
  const length2 = dx * dx + dy * dy
  const t = length2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length2)) : 0
  const x = ax + t * dx - px
  const y = ay + t * dy - py
  return x * x + y * y
}

/** Whether segments `a–b` and `c–d` come within `radius` of each other. */
function segmentsNear(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
  radius: number,
): boolean {
  if (
    Math.max(ax, bx) + radius < Math.min(cx, dx) ||
    Math.max(cx, dx) + radius < Math.min(ax, bx) ||
    Math.max(ay, by) + radius < Math.min(cy, dy) ||
    Math.max(cy, dy) + radius < Math.min(ay, by)
  ) {
    return false
  }
  if (segmentsMeet(ax, ay, bx, by, cx, cy, dx, dy)) return true
  if (radius <= 0) return false
  const r2 = radius * radius
  return (
    distanceToSegment2(ax, ay, cx, cy, dx, dy) <= r2 ||
    distanceToSegment2(bx, by, cx, cy, dx, dy) <= r2 ||
    distanceToSegment2(cx, cy, ax, ay, bx, by) <= r2 ||
    distanceToSegment2(dx, dy, ax, ay, bx, by) <= r2
  )
}

/**
 * The entities whose drawn outline a stroke from `a` to `b` reaches: the stroke lies inside
 * it, or comes within `radius` of one of its edges.
 *
 * Tested segment by segment rather than point by point, so a fast stroke cannot step over a
 * subdivision narrower than the distance between two pointer events. The radius is the
 * brush's footprint — a pixel for a mouse, so passing over the border line an outline is
 * drawn with counts as passing over it, and a fingertip's width for touch.
 */
export function outlinesAlongSegment(
  outlines: readonly Outline[],
  ax: number,
  ay: number,
  bx: number,
  by: number,
  radius: number,
  view: OutlineView,
): string[] {
  const hits: string[] = []
  for (const outline of outlines) {
    if (!view.drawn(outline.id)) continue
    const frame = view.frames.get(outline.id)
    let [sx, sy] = intoFrame(frame, ax, ay)
    let [ex, ey] = intoFrame(frame, bx, by)
    // Only the part of the stroke inside the entity's clip, if it has one, can reach it.
    const clip = view.clips.get(outline.id)
    if (clip) {
      const inside = clipSegment(sx, sy, ex, ey, clip)
      if (!inside) continue
      ;[sx, sy, ex, ey] = inside
    }
    // An enlarged speck is enlarged about its centre, so the footprint shrinks with it.
    const reach = frame ? radius / frame.scale : radius
    if (
      Math.max(sx, ex) + reach < outline.minX ||
      Math.min(sx, ex) - reach > outline.maxX ||
      Math.max(sy, ey) + reach < outline.minY ||
      Math.min(sy, ey) - reach > outline.maxY
    ) {
      continue
    }
    if (
      contains(outline, sx, sy) ||
      someEdge(outline, (px, py, qx, qy) => segmentsNear(sx, sy, ex, ey, px, py, qx, qy, reach))
    ) {
      hits.push(outline.id)
    }
  }
  return hits
}
