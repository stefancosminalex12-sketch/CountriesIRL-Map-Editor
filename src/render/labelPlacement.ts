/**
 * Fitting a name into a territory.
 *
 * The question this module answers is not "where is the middle of this country" but
 * **"what is the largest readable setting of this name that fits inside this shape, and
 * where"** — position, size and line breaks decided together, because they are one
 * decision. A name that fits on one line in Kazakhstan needs two in Bosnia and
 * Herzegovina, and the place it fits is not the place a single line would have gone.
 *
 * The unit a name belongs to is the entity's **main landmass group** — the same grouping
 * the flags are framed to: the largest landmass and everything within 500 km of it. Not
 * the single largest polygon. Measured polygon by polygon, Cape Verde was sized from one
 * island holding a quarter of its land, the Solomon Islands from a fifth, and Fiji from a
 * one-per-cent sliver at the date line; each name was set as if the rest of the country
 * were not there. The whole group decides how large a name is, and whether it sits on
 * the main island or across the islands together.
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
import { mainLandCluster } from './flagPlacement'

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
 * What separates a name from the lines set beneath it.
 *
 * A label is a name, and optionally lines under it — the entity's data value (Display → Data
 * Values) and its Compare group's value (Display → Compare Group Values). The name is wrapped
 * exactly as it always was, and each line under it is its own line, never broken and never run
 * into the name: "Bosnia and / Herzegovina / 3.2K", not "Bosnia and / Herzegovina 3.2K".
 * Everything else — the position, the de-confliction against neighbours, the zoom at which it is
 * worth drawing — is decided for the whole block, so a value is placed by exactly the system
 * that places names.
 */
export const LABEL_LINE_BREAK = '\n'

/** A label's name and the lines under it, if it has any. */
function splitLabel(text: string): { name: string; tail: string[] } {
  const [name, ...rest] = text.split(LABEL_LINE_BREAK)
  return { name, tail: rest.map((line) => line.trim()).filter(Boolean) }
}

/**
 * The narrowest a line may be, as a share of the widest in its block.
 *
 * Balanced wrapping minimises the widest line, and on its own it will happily strand a
 * short word: "Trinidad / and / Tobago", "São Tomé / and / Príncipe", "El / Salvador". A
 * line holding only "and" is not part of a name, it is a gap in one. Under half the width
 * of its longest neighbour a line reads as an orphan, so that arrangement is not offered;
 * the name is set on fewer lines instead.
 */
const ORPHAN_SHARE = 0.5

/**
 * How much larger a wrapped setting must be, per extra line, to be preferred to a single line
 * when both sit inside the territory.
 *
 * "As large as the shape allows" on its own always wraps — a narrower block fits any shape
 * better — which stacked New Zealand, South Africa and South Korea with room beside them. So
 * a single line is kept unless breaking it buys a quarter again as much size.
 */
const WRAP_GAIN = 1.25

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
 * The projection scale the size law above was calibrated at: the world in Equal Earth on a
 * 1044x634 canvas, where one map unit is one pixel.
 *
 * Every size in this module is stated at that scale and multiplied by the current
 * projection's scale over it — see `mapUnit`. Without that, the law was applied to raw
 * projected area, and since area grows with the square of the map's scale while the size
 * grew with its fifth root, a name grew only as the scale to the power 0.4: a larger window
 * or a closer region framing drew every country larger and every name *smaller* relative to
 * it. Normalised, a name is the same fraction of its country at every window size, every
 * framing and every inset.
 */
const REFERENCE_SCALE = 181

/**
 * The weight the names are set in.
 *
 * Shared with the renderer rather than written twice, because it is an input to the text
 * measurement: a semibold string is wider than a regular one, and a fit computed at one
 * weight and drawn at another is a fit computed for the wrong text.
 */
export const LABEL_WEIGHT = 600

/** Size for a territory with no measurable area, in map units at `REFERENCE_SCALE`. */
export const LABEL_MIN_SIZE = 2.6

/**
 * How far a name may outgrow its territory before it is set beside it instead.
 *
 * Measured as the width of the block, at the smallest size worth setting, against the
 * territory's longest dimension. Under the limit the name is centred on its country and
 * allowed to overhang — which is what an atlas does and what a reader expects, since a
 * word lying across a small country is unmistakably that country’s name. Over it, the
 * word would be a smear across three neighbours and a caption beside the territory is
 * the clearer answer.
 *
 * The rule exists because the previous one had no middle. Anything that could not fit
 * *within* its borders was captioned from outside, and on a world map that is most of
 * the world: fifty-one countries — Uzbekistan, Cuba, Malaysia, the United Kingdom — had
 * their names floating off them at 1x, which reads as the labels being attached to the
 * wrong thing.
 */
const OVERFLOW_LIMIT = 5

/**
 * How much of the size a territory has earned it keeps when its name will not fit inside.
 *
 * The fix for the worst thing this module did. A size taken only from what fits *within*
 * the borders is a fact about the polygon, and for a small island the polygon is almost
 * nothing: Barbados could hold its name at 0.11 units, Saint Kitts at 0.06. Multiplied by
 * the camera those stay under the readability floor until roughly fifty times zoom, so
 * the label sat at exactly six pixels at 1x, at 8x and at 32x — dead flat — while France
 * went from 6 px to 195 and Brazil to 325. Zooming in made every Caribbean name smaller
 * relative to the map, which is precisely backwards.
 *
 * So the inside fit is a floor to beat, not a ceiling to obey. A territory also gets the
 * size its *projected* size warrants — the same area law that limits everyone, which is a
 * measure of how large the thing is on the map and therefore grows with the zoom exactly
 * as the land does. A shade under the full allowance, because this size is spent on type
 * that will overhang its borders, and overhang should be modest.
 *
 * A country that can hold its own name is untouched: its inside fit already beats this.
 */
const SPACE_FLOOR_SHARE = 0.75

/**
 * How wide a block may run, against the territory it labels, before wrapping is worth it.
 *
 * The test for "does this name reasonably fit on one line". Under the limit a single line
 * is used even where breaking it would technically allow larger type; over it, the name is
 * wrapped and the block pulled back towards the shape of the country.
 *
 * A rule of this kind is needed because the obvious one — take whichever arrangement sets
 * the largest type — is systematically wrong. Wrapping narrows a block, and a narrower
 * block always fits a shape better, so the largest type is very nearly always the most
 * wrapped: New Zealand, South Africa, South Korea, North Korea, Sri Lanka and Papua New
 * Guinea were all stacked vertically on two lines with room to spare beside them. Size is
 * the wrong thing to optimise here; how the block sits on the country is the right one.
 */
const WRAP_WIDTH_LIMIT = 1.8

/** Largest a name may be set, in map units at `REFERENCE_SCALE`. */
export const LABEL_MAX_SIZE = 26

/**
 * How large a name must be on screen before it is drawn, in pixels.
 *
 * A visibility threshold and nothing else: it never changes a name's size. Below about five
 * pixels a word is a grey smear, so a name that small is not drawn yet — and since a name's
 * size is fixed in the map's units, zooming in enlarges it with its country until it passes
 * the threshold and appears. It never goes the other way while zooming in.
 *
 * This used to be a *floor* on the drawn size, with a matching 36-pixel ceiling, and that
 * pair was the whole reason names changed size relative to their countries: a small name
 * was blown up to the floor at low zoom and shrank back toward its true size as the reader
 * zoomed in, and a large name was capped and shrank relative to its country the further in
 * the reader went. Both are gone.
 */
export const LABEL_MIN_RENDERED_PX = 5.5

/**
 * The largest an outside label is set, in map units at `REFERENCE_SCALE`.
 *
 * A fixed size in the map's own space, like every other label — **not** a fixed size on
 * screen. Screen-constant was the earlier answer and it was the single largest source of
 * instability in this feature: holding a caption at 6.5 px means halving its projected
 * size at every doubling of the zoom, so it shrank by a factor of two at every step and
 * drifted by up to 1.4x between them. Sixty to seventy labels did that on every zoom.
 *
 * The size follows the territory, so a caption stays in proportion to the thing it names
 * and grows with the camera exactly as the land does.
 */
const EXTERNAL_MAX_SIZE = 7

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

/**
 * The share of a group's land its largest piece must hold for the group to be a mainland.
 *
 * Above it the entity is one landmass with islets — France with Corsica, Norway with its
 * fjord islands, Chile with Chiloé — and its name belongs on the mainland, full stop. Below
 * it the land is genuinely scattered and the island group is measured as a whole as well:
 * Japan (61%), New Zealand (56%), Fiji (60%), Cape Verde (25%), the Maldives (32%).
 */
const MAINLAND_SHARE = 0.9

/**
 * How large a name may be, against the island it would sit on, before it is centred on the
 * island group instead.
 *
 * Measured as the area of the name's block, at the size the territory has earned, against
 * the area of its largest island. Below it the island is the country's home and is big
 * enough to carry the name: Great Britain carries "United Kingdom" at two-thirds of its own
 * area, Honshu carries "Japan" at under a third, Kalimantan carries "Indonesia" at under a
 * half. Above it the name is as large as the island it would cover, so centring it there
 * reads as that island's name rather than the country's — Viti Levu under "Fiji", Grande
 * Comore under "Comoros", Mahé under "Seychelles" — and the name is centred on the group.
 *
 * Calibrated on every scattered entity in the dataset, where the values fall either side
 * with room to spare: the largest home case is Great Britain at 0.66, the smallest group
 * case New Zealand at 0.87. A property of the geometry and the typography together, never
 * a list of which countries count as archipelagos.
 */
const GROUP_DWARF = 0.75

/**
 * How far a name may slide off its position to clear a neighbour's, as a share of its own
 * half-width or half-height.
 *
 * At most this far the territory's anchor stays in the middle of the name, so the name
 * still reads as belonging to it. Bosnia and Herzegovina is the case it exists for: its one
 * interior position is hemmed in by Serbia's name on the east, and sliding a little into the
 * Croatian hinterland lets it keep the size its shape gives it.
 */
const SLIDE_LIMIT = 0.5

/**
 * The deepest zoom the canvas allows — shared with its zoom behaviour, so a rule here that
 * asks "could this ever be legible?" asks it of the zoom range that actually exists.
 */
export const MAX_MAP_ZOOM = 40

/**
 * The deepest zoom a caption may wait for.
 *
 * `EXTERNAL_MIN_TERRITORY_PX` holds a caption back until its territory is a visible thing on
 * screen. For the Vatican, a few hundred metres across, that point lies past the canvas's
 * deepest zoom, so its name could never appear at all; the same was true of Gibraltar,
 * Monaco and every reef in the dataset. The canvas draws each of them at a visible minimum
 * size regardless (see `smallEntities`), so by this zoom there is always something on
 * screen for the caption to point at.
 */
const CAPTION_WAIT_LIMIT = 16

/**
 * How far apart, as a share of the projected globe's width, two parts of one group may lie
 * before they are on opposite sides of the map's seam.
 *
 * The geographic grouping is done on the sphere, where Fiji is one place. On the map it is
 * two: the date line runs through it and the projection draws half at each edge. A name
 * can only be in one of them, so the parts are regrouped in the plane and the name goes
 * with whichever side holds the most land. No real archipelago comes near this gap — the
 * geographic grouping has already capped the gaps inside a group at 500 km.
 */
const SEAM_GAP_SHARE = 0.25

/** Rings of positions a caption is offered around its territory. See `externalOptions`. */
const CAPTION_RINGS = 2

/**
 * How many of a neighbour's own settings the repair tries when asking it to move. A budget,
 * not a preference: the settings are best-first, so the first few are the ones worth moving
 * to, and the repair may try two neighbours together.
 */
const REPAIR_MOVES = 10

/**
 * How many of the names in its way a name that could not be placed may ask to move, and
 * among how many of them it tries pairs.
 *
 * The repair asks each neighbour in turn, then every pair of them, and for every pair tries
 * ten settings of each against every setting of its own — so the work grows with the square
 * of the neighbours. On the country map a name rarely has more than a handful in its way.
 * On the administrative world a name inside Slovenia's 193 municipalities or England's
 * districts can have dozens, and the pairs alone ran to over a thousand per name: turning
 * names on froze the page. The neighbours are taken largest territory first, which is the
 * order they were placed in and the order the repair already tried them in, so the ones
 * cut off are the small names at the end of that list — the least likely to open a place.
 */
const REPAIR_NEIGHBOURS = 6
const REPAIR_PAIRS = 4

/**
 * The most arrangements the repair tries across the whole map.
 *
 * A ceiling rather than a setting: the country map's whole layout takes 25 ms, a few
 * thousand arrangements at most, so it finishes far inside this and nothing there changes.
 * It exists so that no map, however dense, can hold the page: each arrangement costs about
 * 12 µs, so this is about half a second of repair at most. Past it, a name that could not
 * be placed keeps the setting on its own land that overlaps least — what the repair falls
 * back to whenever it finds nothing.
 */
const REPAIR_BUDGET = 50_000

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
 * A geometry's pieces, reduced — cached against the geometry object.
 *
 * Every piece, in the order the degree-area proxy gives. Only the fallback now: used when
 * none of the entity's main group survives the projection. The group itself is ranked by
 * *projected* area, because area in degrees is not a safe proxy for the case that matters
 * most — a ring crossing the antimeridian is unwrapped across 360 degrees of longitude and
 * its area in degrees is then enormous. Fiji's largest piece by that measure held one per
 * cent of the country, and its name was sized and placed on it.
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

/**
 * The pieces of an entity's main landmass group, reduced — cached against the geometry.
 *
 * The group is `mainLandCluster`'s: the largest landmass and everything whose coast comes
 * within 500 km of it, which is the unit a name belongs to. Reduced before projection for
 * the reason `MAX_RING_POINTS` gives, so a group of hundreds of islets is still cheap: an
 * islet is only a handful of vertices to begin with.
 */
const groupCache = new WeakMap<Polygon | MultiPolygon, Ring[][]>()

function groupPieces(geometry: Polygon | MultiPolygon): Ring[][] {
  const cached = groupCache.get(geometry)
  if (cached) return cached
  const pieces = mainLandCluster(geometry)
    .coordinates.filter((rings) => rings.length > 0 && rings[0].length >= 4)
    .map((rings) => rings.map(sampleRing))
  groupCache.set(geometry, pieces)
  return pieces
}

/**
 * Every part a reduced piece becomes in the plane — two, where the seam cuts it.
 *
 * Through `geoProject` rather than by calling the projection on each point, which is what
 * keeps the antimeridian, the clip and the rotation behaving as they do for the drawn
 * paths: a piece cut by the date line arrives as two polygons, exactly as it is drawn,
 * instead of as one shape stretched across the map with its name in the middle.
 */
function projectParts(piece: Ring[], projection: GeoProjection): Flat[] {
  const projected = geoProject(
    { type: 'Polygon', coordinates: piece } as Polygon,
    projection,
  ) as Polygon | MultiPolygon | null
  if (!projected) return []

  const groups = projected.type === 'Polygon' ? [projected.coordinates] : projected.coordinates
  const parts: Flat[] = []
  for (const rings of groups) {
    const usable = rings.filter((ring) => ring.length >= 4)
    if (usable.length === 0) continue
    if (!usable[0].every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))) continue
    // Sampled again: resampling puts points back along the long segments.
    parts.push(usable.map(sampleRing))
  }
  return parts
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

/** Area of a projected polygon with its holes taken out — Lesotho is not South Africa. */
function polygonArea(polygon: Flat): number {
  let area = ringArea(polygon[0])
  for (let i = 1; i < polygon.length; i++) area -= ringArea(polygon[i])
  return Math.max(area, 0)
}

/**
 * The convex hull of a set of points: Andrew's monotone chain, not closed.
 *
 * The footprint of an island group — the smallest convex shape holding every island. It is
 * the space a reader sees the group occupying, and so the space its name is laid out in
 * when no single island can carry it.
 */
function convexHull(points: Position[]): Ring {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (sorted.length < 3) return sorted
  const cross = (o: Position, a: Position, b: Position) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: Ring = []
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop()
    }
    lower.push(p)
  }
  const upper: Ring = []
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop()
    }
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

/**
 * The projected globe's extent, cached per projection.
 *
 * The one boundary every name is held inside. A label is placed in the map's own space, and
 * near the edge of the world that space runs out: Kiribati and Fiji sit against the seam,
 * and a name centred on them could otherwise hang off the side of the globe.
 */
const frameCache = new WeakMap<GeoProjection, [number, number, number, number] | null>()

function sphereFrame(projection: GeoProjection): [number, number, number, number] | null {
  if (frameCache.has(projection)) return frameCache.get(projection) ?? null
  const box = geoPath(projection).bounds({ type: 'Sphere' })
  const frame: [number, number, number, number] = [box[0][0], box[0][1], box[1][0], box[1][1]]
  const usable = frame.every(Number.isFinite) && frame[2] > frame[0] && frame[3] > frame[1]
  frameCache.set(projection, usable ? frame : null)
  return usable ? frame : null
}

/**
 * How many map units one unit of the size law is worth at this projection's scale.
 *
 * Proportional to the projection's own scale, which is what grows and shrinks with the
 * window, the region framing and each inset — so a name sized with it keeps its proportion
 * to its country through all of them. See `REFERENCE_SCALE`.
 */
function mapUnit(projection: GeoProjection): number {
  const unit = projection.scale() / REFERENCE_SCALE
  return Number.isFinite(unit) && unit > 0 ? unit : 1
}

/**
 * How much of the map an entity occupies, as far as the size of its name is concerned.
 *
 * Land alone is right for a solid country and wrong for an archipelago. The Maldives are
 * 300 km² of land strung along 800 km of ocean: by land they are smaller than Andorra, while
 * a reader sees a chain the height of Portugal. Footprint alone is wrong the other way — the
 * hull round French Polynesia is the size of Western Europe, and a name set to match it
 * would be absurd.
 *
 * So the size is taken between the two, and *how far* between is decided by how scattered
 * the land is: the share not held by the largest piece. One landmass, or a mainland with
 * islets, scores almost nothing and is sized by its land exactly as before — France moves
 * by a fraction of a per cent. An archipelago with no dominant island moves toward the
 * geometric mean of its land and its footprint, which grows with the spread but only as
 * its square root, so a scattered nation earns a readable name without being inflated
 * into a continent.
 */
function effectiveArea(land: number, footprint: number, largestShare: number): number {
  if (!(land > 0)) return 0
  const spread = Math.max(footprint, land) / land
  const scatter = Math.min(Math.max(1 - largestShare, 0), 1)
  return land * Math.pow(spread, scatter / 2)
}

interface Part {
  polygon: Flat
  area: number
  box: [number, number, number, number]
}

/** Projects pieces into parts, largest first, dropping any the projection leaves empty. */
function collectParts(pieces: Ring[][], projection: GeoProjection): Part[] {
  const parts: Part[] = []
  for (const piece of pieces) {
    for (const polygon of projectParts(piece, projection)) {
      const area = polygonArea(polygon)
      if (area > 0) parts.push({ polygon, area, box: boundsOf(polygon[0]) })
    }
  }
  return parts.sort((a, b) => b.area - a.area)
}

/**
 * The parts on the same side of the map's seam as the largest one.
 *
 * Grown outward from the largest part, joining anything within `SEAM_GAP_SHARE` of the
 * globe's width of a part already in. Only the seam can open a gap that wide inside a
 * group, so this keeps every island of an ordinary archipelago and drops only the half of a
 * date-line country that the projection has drawn at the other edge.
 */
function contiguous(parts: Part[], frame: [number, number, number, number] | null): Part[] {
  const limit = frame ? SEAM_GAP_SHARE * (frame[2] - frame[0]) : Infinity
  const group = [parts[0]]
  const rest = parts.slice(1)
  for (let i = 0; i < group.length; i++) {
    const a = group[i].box
    for (let j = rest.length - 1; j >= 0; j--) {
      const b = rest[j].box
      const gapX = Math.max(0, a[0] - b[2], b[0] - a[2])
      const gapY = Math.max(0, a[1] - b[3], b[1] - a[3])
      if (gapX < limit && gapY < limit) {
        group.push(rest[j])
        rest.splice(j, 1)
      }
    }
  }
  return group
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
  /**
   * How large the entity is on the map: what its name is sized by and the order names are
   * settled in. The land of the whole main group, widened toward the group's footprint as
   * far as its land is scattered — see `effectiveArea`.
   */
  area: number
  /** The group's extent, for anchoring a name that has to sit outside it. */
  minX: number
  minY: number
  maxX: number
  maxY: number
  /** Interior positions on the group's largest piece, most central first. */
  spots: LabelSpot[]
  /**
   * Positions over the island group as a whole — laid out in its convex hull — for an
   * entity whose land is scattered. Empty for one landmass and for a mainland with islets.
   */
  groupSpots: LabelSpot[]
  /** The projected globe's extent, which no name is pushed beyond. */
  frame: [number, number, number, number] | null
  /** Map units per unit of the size law at this projection's scale. See `REFERENCE_SCALE`. */
  unit: number
  /** Projected area of the group's largest piece — what `GROUP_DWARF` weighs a name against. */
  mainArea: number
  /**
   * The largest piece's outline, kept for one question the layout asks of *other* entities:
   * whether a position proposed over some island group is actually on this country's land.
   */
  mainland: { edges: Edges; box: [number, number, number, number] } | null
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
  const frame = sphereFrame(projection)

  let parts = collectParts(groupPieces(geometry), projection)
  /*
   * Every piece, if the group itself left nothing on the map — for when the camera has
   * clipped the main landmass away and the name belongs on whatever is still drawn.
   */
  if (parts.length === 0) parts = collectParts(geographicPieces(geometry), projection)
  if (parts.length === 0) return fallbackShape(id, geometry, projection, clipId, frame)

  const group = contiguous(parts, frame)
  const main = group[0]
  const mainBox = main.box
  if (!Number.isFinite(mainBox[2] - mainBox[0]) || !Number.isFinite(mainBox[3] - mainBox[1])) {
    return null
  }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let land = 0
  for (const part of group) {
    land += part.area
    if (part.box[0] < minX) minX = part.box[0]
    if (part.box[1] < minY) minY = part.box[1]
    if (part.box[2] > maxX) maxX = part.box[2]
    if (part.box[3] > maxY) maxY = part.box[3]
  }

  const largestShare = land > 0 ? main.area / land : 1
  const scattered = group.length > 1 && largestShare < MAINLAND_SHARE
  const hull = group.length > 1 ? convexHull(group.flatMap((part) => part.polygon[0])) : null
  const footprint = hull && hull.length >= 3 ? ringArea(hull) : land

  return {
    id,
    clipId,
    unit: mapUnit(projection),
    area: effectiveArea(land, footprint, largestShare),
    mainArea: main.area,
    mainland: { edges: toEdges(main.polygon), box: mainBox },
    minX,
    minY,
    maxX,
    maxY,
    spots: findSpots(main.polygon, mainBox),
    /*
     * The hull is measured with the same machinery as any territory: its pole is the visual
     * centre of the island group, and its profile says how wide a block fits across the
     * group. Only for a scattered group — a mainland keeps its name on the mainland.
     */
    groupSpots:
      scattered && hull && hull.length >= 3 ? findSpots([sampleRing(hull)], boundsOf(hull)) : [],
    frame,
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
  frame: [number, number, number, number] | null,
): LabelShape | null {
  const path = geoPath(projection)
  const box = path.bounds(geometry)
  if (!Number.isFinite(box[0][0]) || !Number.isFinite(box[1][0])) return null
  return {
    id,
    clipId,
    unit: mapUnit(projection),
    area: 0,
    mainArea: 0,
    mainland: null,
    minX: box[0][0],
    minY: box[0][1],
    maxX: box[1][0],
    maxY: box[1][1],
    spots: [],
    groupSpots: [],
    frame,
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
  /** Width of the widest line, in ems, so the zoom pass can size the block. */
  blockWidth: number
  /** Projected extent of the territory, for the one gate an outside caption needs. */
  extent: number
  /**
   * How large the territory is on the map — the order names are settled in, the same in
   * the layout and at every zoom. Two passes that disagreed about priority could each be
   * right by their own measure and still hand a place to one name in the layout and to its
   * neighbour on screen.
   */
  priority: number
  /**
   * The smallest zoom at which this label is worth drawing.
   *
   * **The only thing about a label that the camera decides.** Everything else — where it
   * sits, how large it is set, where its lines break, whether it won its place against a
   * neighbour — is settled once, in the map's own coordinates, and is therefore identical
   * at every zoom. Zooming in can reveal a name; it can never move one, resize one, or
   * take one away.
   *
   * A caption set *beside* a territory is the only label that has one, and it has it for
   * a reason no amount of type can fix: a caption pointing at something smaller than a few
   * pixels is pointing at nothing the reader can see. A name written *inside* its own
   * borders has no such threshold; it is drawn as soon as it is legible — see `visibleLabels`.
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
      let narrowest = Infinity
      for (const line of lines) {
        const measured = width(line)
        widest = Math.max(widest, measured)
        narrowest = Math.min(narrowest, measured)
      }
      // See `ORPHAN_SHARE`: a stranded short word is not an arrangement worth offering.
      if (narrowest < ORPHAN_SHARE * widest) return
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
function sizeCeilingForArea(area: number, unit: number): number {
  if (!(area > 0)) return LABEL_MIN_SIZE * unit
  // Measured in units of the reference scale and converted back, so it scales with the map.
  return unit * AREA_SIZE_FACTOR * Math.pow(area / (unit * unit), AREA_SIZE_EXPONENT)
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
  /** The size this arrangement is set at — decided by the shape, and never changed after. */
  fontSize: number
  /** Whether the block, at that size, sits wholly inside the shape it was measured in. */
  inside: boolean
  lines: string[]
  /** Width of the widest line, in ems — measured, and carried so nothing re-measures. */
  blockWidth: number
  /** On the entity's own land, centred over its island group, or captioned beside it. */
  mode: 'land' | 'group' | 'external'
  /** How far from the territory's most central position, for tie-breaking. */
  offCentre: number
  /** Whether the block runs wider than its territory. See `WRAP_WIDTH_LIMIT`. */
  overWide: boolean
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

/** The sizes a territory's shape decides: what it has earned, and what it may not pass. */
interface Sizing {
  /** The size the territory is entitled to from how large it is drawn. See `SPACE_FLOOR_SHARE`. */
  spaceFloor: number
  ceiling: number
  /** The size a caption beside the territory is set at. */
  caption: number
}

function sizingFor(area: number, unit: number): Sizing {
  const earned = sizeCeilingForArea(area, unit)
  const ceiling = Math.min(earned, LABEL_MAX_SIZE * unit)
  const spaceFloor = Math.min(earned * SPACE_FLOOR_SHARE, ceiling)
  return { ceiling, spaceFloor, caption: Math.min(spaceFloor, EXTERNAL_MAX_SIZE * unit) }
}

/**
 * Every arrangement of this name at every candidate position, best first.
 *
 * One list per kind of position: the spots on the entity's largest piece, or the spots
 * over its island group. The order is the wrapping policy. Each setting's size is decided
 * here, by the shape alone, and nothing later changes it.
 */
function interiorOptions(
  spots: LabelSpot[],
  words: string[],
  width: (text: string) => number,
  sizing: Sizing,
  span: { width: number; height: number },
  mode: 'land' | 'group',
  tail: string[] = [],
): Option[] {
  if (words.length === 0 || spots.length === 0) return []
  const options: Option[] = []
  const centre = spots[0]

  spots.forEach((spot, spotIndex) => {
    for (let count = 1; count <= Math.min(MAX_LINES, words.length); count++) {
      const wrapped = wrapInto(words, count, width)
      if (!wrapped) continue
      const nameWidth = widestLine(wrapped, width)
      if (nameWidth <= 0) continue
      /*
       * The lines under the name, when there are any, ride on every wrapping of it — and decide
       * nothing about the name. The size, whether it fits inside and whether it is wrapped are
       * all measured on the name alone, exactly as they were before values existed, so turning
       * a value on never shrinks a name, re-wraps it or holds it back to a deeper zoom. The
       * values only widen and deepen the block, which is what neighbours keep clear of.
       */
      const lines = tail.length > 0 ? [...wrapped, ...tail] : wrapped
      const blockWidth = tail.reduce((widest, line) => Math.max(widest, width(line)), nameWidth)
      /*
       * An arrangement that does not fit inside the shape at all is still an arrangement.
       * Since a name may overhang, not fitting is not disqualifying — it means the space
       * floor decides the size and the width test decides whether to wrap.
       *
       * The size is decided here and nowhere else: the largest the shape holds, raised to
       * what the territory has earned when the name will not fit inside, and capped by the
       * area law. Nothing downstream — not the zoom, not the viewport, not a neighbour's
       * name — changes it.
       */
      const raw = sizeAtSpot(spot, wrapped, nameWidth)
      const fontSize = Math.min(Math.max(raw.size, sizing.spaceFloor), sizing.ceiling)
      if (!(fontSize > 0)) continue
      options.push({
        x: spot.x + raw.dx,
        y: spot.y,
        fontSize,
        inside: raw.size >= fontSize * 0.999,
        lines,
        blockWidth,
        mode,
        offCentre: spotIndex === 0 ? 0 : Math.hypot(spot.x - centre.x, spot.y - centre.y),
        /*
         * Whether this arrangement runs wider across the map than the territory it names —
         * the single thing that decides whether a name is wrapped. Judged at the
         * territory's baseline size rather than each arrangement's own, so arrangements
         * are compared on equal terms: measured at their own sizes, the test punished the
         * settings that found more room, and "United Arab Emirates" was broken one word to
         * a line.
         *
         * Width against the territory's width and height against its height. Width alone
         * made a tall stack look like a fit on any small island: "Trinidad / and / Tobago"
         * was set one word to a line over two islands that are wider than they are tall,
         * because the stack was narrow — and it overhung far more above and below than a
         * single line ever would have to either side.
         */
        overWide:
          nameWidth * sizing.spaceFloor > span.width * WRAP_WIDTH_LIMIT ||
          blockEms(wrapped.length) * sizing.spaceFloor > span.height * WRAP_WIDTH_LIMIT,
      })
    }
  })

  /*
   * Best first, and the order of these clauses is the whole wrapping policy. Within the
   * territory's own width before spilling across it; then fewest lines, because a name read
   * straight across is what a reader expects; only then size, and last how central.
   */
  options.sort((a, b) => {
    /*
     * A setting that sits inside the shape comes before one that spills over its border.
     * The name is meant to be as large as the territory can hold *inside itself*: the
     * Central African Republic's name on one line spilled into Cameroon while the same name
     * on two lines fitted within its own borders, and the spilling one was preferred.
     */
    if (a.inside !== b.inside) return a.inside ? -1 : 1
    if (a.inside) {
      // As large as the shape allows, with each extra line having to earn `WRAP_GAIN`.
      const ea = a.fontSize / Math.pow(WRAP_GAIN, a.lines.length - 1)
      const eb = b.fontSize / Math.pow(WRAP_GAIN, b.lines.length - 1)
      if (Math.abs(ea - eb) > Math.max(ea, eb) * 0.1) return eb - ea
      if (a.lines.length !== b.lines.length) return a.lines.length - b.lines.length
      return a.offCentre - b.offCentre
    }
    // Neither fits inside: all are set at the size the territory has earned, so the policy
    // is about how the overhang sits — within the territory's width first, fewest lines.
    if (a.overWide !== b.overWide) return a.overWide ? 1 : -1
    if (a.lines.length !== b.lines.length) return a.lines.length - b.lines.length
    if (Math.abs(a.fontSize - b.fontSize) > Math.max(a.fontSize, b.fontSize) * 0.1) {
      return b.fontSize - a.fontSize
    }
    return a.offCentre - b.offCentre
  })
  return options
}

/** How far to move an interval to bring it inside another, or centre it if it cannot fit. */
function shiftInto(lo: number, hi: number, min: number, max: number): number {
  if (hi - lo >= max - min) return (min + max - lo - hi) / 2
  if (lo < min) return min - lo
  if (hi > max) return max - hi
  return 0
}

/**
 * An option moved just far enough to keep its block on the globe, and the block it takes.
 *
 * Almost always a no-op. It matters for the entities that sit against the projection's
 * edge — the seam through the Pacific, the poles — where a name centred on its land would
 * otherwise hang off the world into the background.
 */
function settle(
  option: Option,
  size: number,
  frame: LabelShape['frame'],
): { option: Option; rect: Rect } {
  const rect = blockRect(option, size)
  if (!frame) return { option, rect }
  const dx = shiftInto(rect.x0, rect.x1, frame[0], frame[2])
  const dy = shiftInto(rect.y0, rect.y1, frame[1], frame[3])
  if (dx === 0 && dy === 0) return { option, rect }
  return {
    option: { ...option, x: option.x + dx, y: option.y + dy },
    rect: { x0: rect.x0 + dx, y0: rect.y0 + dy, x1: rect.x1 + dx, y1: rect.y1 + dy },
  }
}

/** Area of a block at the size it carries, in projected units. */
function blockArea(option: Option): number {
  return option.blockWidth * option.fontSize * blockEms(option.lines.length) * option.fontSize
}

/**
 * The blocks already placed, as a collision test sees them.
 *
 * `near` answers with every block that could overlap the one asked about — a superset of
 * the ones that do, in the order they were placed — so a test over it gives exactly the
 * answer a test over every placed block gives, and in the same order where order decides a
 * tie.
 */
interface Blocking {
  /**
   * The placed blocks near `rect`, in no particular order: the one caller sorts what it
   * makes of them, by a rule of its own that does not depend on which block proposed what.
   */
  near(rect: Rect): Rect[]
  /**
   * Each placed block near `rect`, in no particular order and without building a list — for
   * the scoring, which only sums what it is given. Sorting a fresh array for every candidate
   * position was the most expensive thing in the layout after the sliding itself.
   */
  each(rect: Rect, visit: (other: Rect) => void): void
  /**
   * Whether `rect` is clear of every placed block. The same answer as testing `near`, but
   * asked of the grid directly: a yes or no needs no list built and no order kept, and it
   * is by far the most frequent question the layout asks.
   */
  clear(rect: Rect): boolean
}

interface GridEntry {
  rect: Rect
  /** Placement order, so a query answers in the order the blocks were placed. */
  order: number
  owner: unknown
  /** The last query that returned this entry, so one covering many cells returns it once. */
  seen: number
}

/**
 * A uniform grid over the map's own coordinates, holding each block in the cells it covers.
 *
 * Every collision test used to walk every name placed so far, and the repair rebuilt that
 * list for every pair of neighbours it tried. For the world's 254 countries that was
 * affordable; for the administrative world's 4,595 subdivisions it was billions of tests,
 * and turning names on froze the page. A block only ever meets the blocks around it, and
 * the grid hands a test those and no others.
 */
class RectGrid {
  private readonly cells = new Map<number, GridEntry[]>()
  private stamp = 0

  constructor(
    private readonly originX: number,
    private readonly originY: number,
    private readonly cell: number,
  ) {}

  private range(rect: Rect): [number, number, number, number] {
    const index = (value: number) => Math.max(-30000, Math.min(30000, Math.floor(value / this.cell)))
    return [
      index(rect.x0 - this.originX),
      index(rect.y0 - this.originY),
      index(rect.x1 - this.originX),
      index(rect.y1 - this.originY),
    ]
  }

  private static key(ix: number, iy: number): number {
    return (ix + 32768) * 65536 + (iy + 32768)
  }

  add(entry: GridEntry): void {
    const [x0, y0, x1, y1] = this.range(entry.rect)
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        const key = RectGrid.key(ix, iy)
        const list = this.cells.get(key)
        if (list) list.push(entry)
        else this.cells.set(key, [entry])
      }
    }
  }

  remove(entry: GridEntry): void {
    const [x0, y0, x1, y1] = this.range(entry.rect)
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        const list = this.cells.get(RectGrid.key(ix, iy))
        const at = list ? list.indexOf(entry) : -1
        if (list && at >= 0) list.splice(at, 1)
      }
    }
  }

  /** Calls `visit` with each entry near `rect`, once, until it returns true. */
  some(rect: Rect, visit: (entry: GridEntry) => boolean): boolean {
    const stamp = ++this.stamp
    const [x0, y0, x1, y1] = this.range(rect)
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        const list = this.cells.get(RectGrid.key(ix, iy))
        if (!list) continue
        for (const entry of list) {
          if (entry.seen === stamp) continue
          entry.seen = stamp
          if (visit(entry)) return true
        }
      }
    }
    return false
  }

  /** Calls `visit` with each entry near `rect`, once. */
  each(rect: Rect, visit: (entry: GridEntry) => void): void {
    const stamp = ++this.stamp
    const [x0, y0, x1, y1] = this.range(rect)
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        const list = this.cells.get(RectGrid.key(ix, iy))
        if (!list) continue
        for (const entry of list) {
          if (entry.seen === stamp) continue
          entry.seen = stamp
          visit(entry)
        }
      }
    }
  }

  query(rect: Rect): GridEntry[] {
    const stamp = ++this.stamp
    const found: GridEntry[] = []
    const [x0, y0, x1, y1] = this.range(rect)
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        const list = this.cells.get(RectGrid.key(ix, iy))
        if (!list) continue
        for (const entry of list) {
          if (entry.seen === stamp) continue
          entry.seen = stamp
          found.push(entry)
        }
      }
    }
    return found
  }
}

/** Placed blocks from a grid, leaving out `except`, with `extra` blocks after them. */
function gridBlocking(grid: RectGrid, except?: ReadonlySet<unknown>, extra?: Rect[]): Blocking {
  return {
    near(rect) {
      // One pass, one array: this is asked millions of times over an administrative map.
      const found: Rect[] = []
      grid.each(rect, (entry) => {
        if (!except || !except.has(entry.owner)) found.push(entry.rect)
      })
      if (extra) for (const other of extra) found.push(other)
      return found
    },
    each(rect, visit) {
      grid.each(rect, (entry) => {
        if (!except || !except.has(entry.owner)) visit(entry.rect)
      })
      if (extra) for (const other of extra) visit(other)
    },
    clear(rect) {
      if (extra) for (const other of extra) if (overlaps(rect, other)) return false
      return !grid.some(
        rect,
        (entry) => !(except && except.has(entry.owner)) && overlaps(rect, entry.rect),
      )
    },
  }
}

function clearOf(rect: Rect, blocking: Blocking): boolean {
  return blocking.clear(rect)
}

/** Total area a block shares with the blocks already placed. */
function overlapArea(rect: Rect, blocking: Blocking): number {
  let total = 0
  blocking.each(rect, (other) => {
    const w = Math.min(rect.x1, other.x1) - Math.max(rect.x0, other.x0)
    const h = Math.min(rect.y1, other.y1) - Math.max(rect.y0, other.y0)
    if (w > 0 && h > 0) total += w * h
  })
  return total
}

/**
 * Whether a point lies on another entity's land.
 *
 * Asked of positions proposed over an island group, whose hull is drawn round water and
 * therefore round whatever else is in that water: Denmark's reaches across the Øresund into
 * Skåne. Tested against each entity's largest piece, which is where a neighbour a hull could
 * swallow actually is.
 */
function onForeignLand(x: number, y: number, own: string, lands: RectGrid): boolean {
  for (const entry of lands.query({ x0: x, y0: y, x1: x, y1: y })) {
    const other = entry.owner as LabelShape
    if (other.id === own || !other.mainland) continue
    const [x0, y0, x1, y1] = other.mainland.box
    if (x < x0 || x > x1 || y < y0 || y > y1) continue
    if (insidePolygon(x, y, other.mainland.edges)) return true
  }
  return false
}

/**
 * The same block moved the least distance that clears everything in its way, or null.
 *
 * Tried along each axis, past the edge of each block it overlaps, nearest first, and never
 * further than `SLIDE_LIMIT` of its own half-size — so the position it was offered stays in
 * the middle of the name. The globe's edge still applies, and a slide the frame would undo
 * is not a slide.
 */
function slide(
  at: { option: Option; rect: Rect },
  size: number,
  blocking: Blocking,
  frame: LabelShape['frame'],
): { option: Option; rect: Rect } | null {
  const { option, rect } = at
  const hw = (rect.x1 - rect.x0) / 2
  const hh = (rect.y1 - rect.y0) / 2
  if (!(hw > 0) || !(hh > 0)) return null

  /*
   * Everything a slide could run into, asked once: no slide leaves the block's own
   * `SLIDE_LIMIT` margin, so the blocks near that margin are all a moved block can meet.
   */
  const nearby = blocking.near({
    x0: rect.x0 - SLIDE_LIMIT * hw,
    y0: rect.y0 - SLIDE_LIMIT * hh,
    x1: rect.x1 + SLIDE_LIMIT * hw,
    y1: rect.y1 + SLIDE_LIMIT * hh,
  })
  const local: Blocking = {
    near: () => nearby,
    each: (_rect, visit) => {
      for (const other of nearby) visit(other)
    },
    clear: (moved) => !nearby.some((other) => overlaps(moved, other)),
  }

  /*
   * The moves worth trying: past the edge of each block in the way, along each axis, with
   * the ones beyond the limit dropped before the sort rather than after it, and each
   * distinct move tried once. Neighbours in a crowd propose the same move over and over —
   * on Europe Administrative four in five of these candidates were repeats or out of
   * range, and each one cost a settle and a sweep of everything nearby.
   */
  const shifts: Array<[number, number]> = []
  const limitX = SLIDE_LIMIT * hw
  const limitY = SLIDE_LIMIT * hh
  const offer = (dx: number, dy: number) => {
    if (Math.abs(dx) > limitX || Math.abs(dy) > limitY) return
    shifts.push([dx, dy])
  }
  for (const other of nearby) {
    if (!overlaps(rect, other)) continue
    offer(other.x1 - rect.x0, 0)
    offer(other.x0 - rect.x1, 0)
    offer(0, other.y1 - rect.y0)
    offer(0, other.y0 - rect.y1)
  }
  /*
   * Nearest move first, and between two moves of the same distance the same one every time:
   * the tie is broken on the move itself rather than on the order its neighbour happened to
   * be placed in, which is what lets the blocks be gathered without sorting them.
   */
  shifts.sort((a, b) => {
    const da = Math.abs(a[0]) / hw + Math.abs(a[1]) / hh
    const db = Math.abs(b[0]) / hw + Math.abs(b[1]) / hh
    return da !== db ? da - db : a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1]
  })

  /* Nearest first, so the first of a set of equal moves is the one that would have won. */
  const tried = new Set<string>()
  for (const [dx, dy] of shifts) {
    const key = `${Math.round(dx * 64)},${Math.round(dy * 64)}`
    if (tried.has(key)) continue
    tried.add(key)
    const moved = settle({ ...option, x: option.x + dx, y: option.y + dy }, size, frame)
    if (Math.abs(moved.option.x - option.x) > SLIDE_LIMIT * hw) continue
    if (Math.abs(moved.option.y - option.y) > SLIDE_LIMIT * hh) continue
    if (clearOf(moved.rect, local)) return moved
  }
  return null
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
  tail: string[] = [],
): Option[] {
  const words = name.split(/\s+/).filter(Boolean)
  /*
   * Wrapped like any other label, and for a sharper reason than tidiness. An outside
   * label is set beside land it does not own, so its width is measured in *other people's
   * countries*: a long name on one line reaches across its neighbours and reads as a
   * caption on whatever it happens to cross. Two lines halve that.
   */
  const wanted = width(name) > 6 ? Math.min(2, words.length) : 1
  const wrapped = wrapInto(words, wanted, width) ?? [name]
  const lines = tail.length > 0 ? [...wrapped, ...tail] : wrapped
  const blockWidth = widestLine(lines, width)

  const cx = (shape.minX + shape.maxX) / 2
  const cy = (shape.minY + shape.maxY) / 2
  const halfHeight = (blockEms(lines.length) * size) / 2
  const halfWidth = (blockWidth * size) / 2
  const gap = size * 0.45

  /*
   * Above, below, right, left — then the four corners. Two captioned territories on one
   * small island, as Saint Martin and Sint Maarten are, can take all four sides between
   * them and each other's reservations; the corners are what leave the second one a place.
   */
  /*
   * A second ring, one block further out, for the crowded places — the Leeward Islands put
   * half a dozen captioned territories within a few pixels of each other at any zoom, and
   * the first ring runs out before they do.
   */
  const positions: Array<{ x: number; y: number }> = []
  for (let ring = 0; ring < CAPTION_RINGS; ring++) {
    const dy = halfHeight + gap + ring * (2 * halfHeight + gap)
    const dx = halfWidth + gap + ring * (2 * halfWidth + gap)
    const above = shape.minY - dy
    const below = shape.maxY + dy
    const right = shape.maxX + dx
    const left = shape.minX - dx
    positions.push(
      { x: cx, y: above },
      { x: cx, y: below },
      { x: right, y: cy },
      { x: left, y: cy },
      { x: right, y: above },
      { x: left, y: above },
      { x: right, y: below },
      { x: left, y: below },
    )
  }
  return positions.map((at, index) => ({
    x: at.x,
    y: at.y,
    fontSize: size,
    inside: false,
    lines,
    blockWidth,
    mode: 'external' as const,
    offCentre: index,
    // A caption is beside its territory by definition; width against it means nothing.
    overWide: false,
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
 * The typography stage: names sized by their territories, wrapped, and placed.
 *
 * **Size is decided by the shape, once, and by nothing else.** Each arrangement of a name is
 * set at the largest size the complete territory holds — raised to the size the territory
 * has earned where the name cannot fit inside, never below it — and that size is final.
 * Neither the camera nor a neighbour enters into it. The zoom only transforms the map, and
 * the names with it, so a name keeps its size relative to its country at every zoom.
 *
 * This replaces a resolver that made room by shrinking: it stepped names down a ladder of
 * sizes and reserved each territory only its smallest inside fit, so a name's size depended
 * on who its neighbours were rather than on the country it names.
 *
 * Territories are placed largest first, and a name that would collide is moved, never
 * shrunk: another position inside its territory, another arrangement of its lines, a short
 * slide off its position (`SLIDE_LIMIT`), or — for a territory smaller than its own name — a
 * caption beside it. If none of those is clear, the neighbour in its way is asked to move to
 * another of *its* settings, at its own size; and if that fails too, the name keeps its size
 * on its own land where it overlaps least. Every territory with a name gets one.
 *
 * All of it happens in the map's own coordinates, once per projection; the camera never
 * reaches this function.
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

  interface Placement {
    shape: LabelShape
    extent: number
    /**
     * Every setting this name may take on its own territory, best first, each at the size
     * its shape gave it. The only settings a neighbour's repair may move it between.
     */
    candidates: Option[]
    /** Captions beside the territory, held back until its own land has been tried. */
    captions: Option[]
    chosen: { option: Option; rect: Rect }
    /** Whether the chosen setting is clear of every other name. */
    clear: boolean
    /** Its place in the order names were placed, which every query answers in. */
    order: number
  }
  const placements: Placement[] = []

  /*
   * The placed names, and each shape's main island, on grids over the map — see `RectGrid`.
   * A cell is a 256th of the map's longer side: small enough that a subdivision's name
   * meets only its neighbours, large enough that a continent's name covers a few hundred.
   */
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const shape of shapes) {
    if (shape.minX < minX) minX = shape.minX
    if (shape.minY < minY) minY = shape.minY
    if (shape.maxX > maxX) maxX = shape.maxX
    if (shape.maxY > maxY) maxY = shape.maxY
  }
  const known = Number.isFinite(minX) && Number.isFinite(minY)
  const cell = known ? Math.max(maxX - minX, maxY - minY, 1) / 256 : 1
  const grid = new RectGrid(known ? minX : 0, known ? minY : 0, cell)
  const lands = new RectGrid(known ? minX : 0, known ? minY : 0, cell)
  shapes.forEach((shape, order) => {
    if (!shape.mainland) return
    const [x0, y0, x1, y1] = shape.mainland.box
    lands.add({ rect: { x0, y0, x1, y1 }, order, owner: shape, seen: 0 })
  })
  const entries = new Map<Placement, GridEntry>()
  /** Moves a placed name, keeping the grid in step with it. */
  const move = (placement: Placement, chosen: { option: Option; rect: Rect }) => {
    const entry = entries.get(placement)
    if (entry) grid.remove(entry)
    placement.chosen = chosen
    if (entry) {
      entry.rect = chosen.rect
      grid.add(entry)
    }
  }

  /** The first setting clear of `blocking`, as offered or after a short slide. */
  const firstClear = (
    candidates: Option[],
    blocking: Blocking,
    frame: LabelShape['frame'],
  ): { option: Option; rect: Rect } | null => {
    for (const candidate of candidates) {
      const size = candidate.fontSize * scale
      const at = settle(candidate, size, frame)
      if (clearOf(at.rect, blocking)) return at
      const moved = slide(at, size, blocking, frame)
      if (moved) return moved
    }
    return null
  }

  for (const shape of ordered) {
    const text = names.get(shape.id)
    if (!text) continue
    const { name, tail } = splitLabel(text)
    const words = name.split(/\s+/).filter(Boolean)
    if (words.length === 0) continue

    const extent = Math.max(shape.maxX - shape.minX, shape.maxY - shape.minY)
    const span = { width: shape.maxX - shape.minX, height: shape.maxY - shape.minY }
    const sizing = sizingFor(shape.area, shape.unit)
    const land = interiorOptions(shape.spots, words, width, sizing, span, 'land', tail)

    /*
     * On the island, or across the islands — see `GROUP_DWARF`. A position over the group
     * that falls on another country's land is not a position over the group at all, so it
     * is discarded; if nothing is left, the name stays on the main island.
     */
    const bestLand = land.length > 0 ? land[0] : null
    const dwarfed =
      bestLand !== null && shape.mainArea > 0 && blockArea(bestLand) > GROUP_DWARF * shape.mainArea
    const group =
      shape.groupSpots.length > 0 && (bestLand === null || dwarfed)
        ? interiorOptions(shape.groupSpots, words, width, sizing, span, 'group', tail).filter(
            (option) => !onForeignLand(option.x, option.y, shape.id, lands),
          )
        : []
    const useGroup = group.length > 0
    const primary = useGroup ? group : land

    /*
     * Centred and overhanging, or captioned beside. Measured at the size the name is set
     * at: under `OVERFLOW_LIMIT` times the territory's width the name is centred there and
     * may overhang, which keeps it unmistakably attached. Past that, centring stops reading
     * as a label *on* the territory and a caption alongside is clearer.
     */
    const best = primary.length > 0 ? primary[0] : null
    const swamped =
      best !== null &&
      best.blockWidth * Math.max(best.fontSize, sizing.spaceFloor) > extent * OVERFLOW_LIMIT
    const captionFirst = best === null || swamped
    /* A caption is a remedy for a territory smaller than its own name, and for nothing else. */
    const outgrows = best !== null && best.blockWidth * best.fontSize > extent
    const captions = externalOptions(shape, name, width, sizing.caption, tail)

    const candidates: Option[] = []
    if (captionFirst) candidates.push(...captions)
    candidates.push(...primary)
    if (useGroup) candidates.push(...land)
    if (!captionFirst && outgrows) candidates.push(...captions)
    if (candidates.length === 0) continue

    /*
     * Its own land first. A caption is set aside until the repair below has had its chance:
     * Bosnia and Herzegovina found a clear caption before anyone asked Serbia's name to make
     * room, and was labelled from beside a country it can be labelled on. For a territory
     * that is captioned by nature — swamped by its own name, or with nowhere inside — the
     * captions are its own land.
     */
    const home = captionFirst ? candidates : candidates.filter((c) => c.mode !== 'external')
    const spare = captionFirst ? [] : candidates.filter((c) => c.mode === 'external')
    const taken = gridBlocking(grid)
    let chosen = firstClear(home, taken, shape.frame)
    const clear = chosen !== null
    if (!chosen) {
      /*
       * Nowhere clear for now: the name keeps its size and takes, on its own land, the
       * setting that overlaps least — the repair below may still find it a clear one.
       * Shrinking it until it squeezed between its neighbours is what this stage no longer
       * does.
       */
      let least = Infinity
      for (const candidate of home) {
        const at = settle(candidate, candidate.fontSize * scale, shape.frame)
        const overlap = overlapArea(at.rect, taken)
        if (overlap < least) {
          least = overlap
          chosen = at
        }
      }
    }
    if (!chosen) continue
    const placement: Placement = {
      shape,
      extent,
      candidates: home,
      captions: spare,
      chosen,
      clear,
      order: placements.length,
    }
    placements.push(placement)
    const entry: GridEntry = { rect: chosen.rect, order: placement.order, owner: placement, seen: 0 }
    entries.set(placement, entry)
    grid.add(entry)
  }

  /** Where a placement could move to, clear of `fixed`: its own settings, or a short slide. */
  const movesOf = (target: Placement, fixed: Blocking): Array<{ option: Option; rect: Rect }> => {
    const moves: Array<{ option: Option; rect: Rect }> = []
    for (const candidate of target.candidates.slice(0, REPAIR_MOVES)) {
      const size = candidate.fontSize * scale
      let at: { option: Option; rect: Rect } | null = settle(candidate, size, target.shape.frame)
      if (!clearOf(at.rect, fixed)) at = slide(at, size, fixed, target.shape.frame)
      if (at) moves.push(at)
    }
    return moves
  }

  /*
   * Repair: a name that could not be placed clear asks the neighbours in its way to move —
   * each to another of its *own* settings, at its own size — and takes the first arrangement
   * that leaves everyone clear. One neighbour at a time first, then two together.
   *
   * "In its way" means in any space this name could use, a short slide included, and not
   * only where its fallback happens to sit: Switzerland's name was blocked by France's, and
   * the setting that moving France would have opened was a slide away from Liechtenstein's
   * caption — so both had to be asked. Nobody is resized: every setting any of these names
   * can take carries the size its own shape gave it.
   */
  let budget = REPAIR_BUDGET
  for (const placement of placements) {
    if (placement.clear) continue
    if (budget <= 0) break
    const reach = placement.candidates.map((candidate) => {
      const rect = settle(candidate, candidate.fontSize * scale, placement.shape.frame).rect
      const padX = ((rect.x1 - rect.x0) * SLIDE_LIMIT) / 2
      const padY = ((rect.y1 - rect.y0) * SLIDE_LIMIT) / 2
      return { x0: rect.x0 - padX, y0: rect.y0 - padY, x1: rect.x1 + padX, y1: rect.y1 + padY }
    })
    const found = new Set<Placement>()
    for (const rect of reach) {
      for (const entry of grid.query(rect)) {
        const other = entry.owner as Placement
        if (other !== placement && overlaps(rect, other.chosen.rect)) found.add(other)
      }
    }
    const blockers = [...found].sort((a, b) => a.order - b.order).slice(0, REPAIR_NEIGHBOURS)
    const movers: Placement[][] = blockers.map((blocker) => [blocker])
    const paired = Math.min(blockers.length, REPAIR_PAIRS)
    for (let i = 0; i < paired; i++) {
      for (let j = i + 1; j < paired; j++) movers.push([blockers[i], blockers[j]])
    }

    repair: for (const [first, second] of movers) {
      const except = new Set<unknown>([placement, first, second])
      const fixed = gridBlocking(grid, except)
      for (const a of movesOf(first, fixed)) {
        const seconds = second ? movesOf(second, gridBlocking(grid, except, [a.rect])) : [null]
        for (const b of seconds) {
          if (--budget < 0) break repair
          const pool = gridBlocking(grid, except, b ? [a.rect, b.rect] : [a.rect])
          const mine = firstClear(placement.candidates, pool, placement.shape.frame)
          if (!mine) continue
          move(first, a)
          if (second && b) move(second, b)
          move(placement, mine)
          placement.clear = true
          break repair
        }
      }
    }
  }

  /*
   * Only now, for a name that neither its own land nor its neighbours' repair could clear, a
   * caption beside the territory — and only a clear one. Otherwise it stays on its own land,
   * at its own size, where it overlaps least.
   */
  for (const placement of placements) {
    if (placement.clear || placement.captions.length === 0) continue
    const others = gridBlocking(grid, new Set<unknown>([placement]))
    const caption = firstClear(placement.captions, others, placement.shape.frame)
    if (caption) {
      move(placement, caption)
      placement.clear = true
    }
  }

  return placements.map(({ shape, extent, chosen }) => {
    const option = chosen.option
    return {
      id: shape.id,
      x: option.x,
      y: option.y,
      /*
       * The author's size setting is applied here, to the size and to the block measured for
       * collisions together. It is a setting, not the camera: it scales every name alike.
       */
      fontSize: option.fontSize * scale,
      lines: option.lines,
      blockWidth: option.blockWidth,
      extent,
      priority: shape.area,
      clipId: shape.clipId,
      external: option.mode === 'external',
      /*
       * Only a caption set *beside* a territory waits, until the territory is large enough
       * on screen to be worth pointing at, and never past `CAPTION_WAIT_LIMIT`. Waiting
       * decides when it is drawn, never how large.
       */
      minZoom:
        option.mode !== 'external'
          ? 0
          : Math.min(
              extent > 0 ? EXTERNAL_MIN_TERRITORY_PX / extent : Infinity,
              CAPTION_WAIT_LIMIT,
            ),
    }
  })
}


/**
 * What to draw at this zoom — and nothing about how large.
 *
 * A name is drawn at the size the layout gave it, in the map's own units, at every zoom. The
 * camera transform carries it with the land, so zooming in makes a name larger on screen by
 * exactly as much as it makes its country larger, and never changes its size relative to
 * that country.
 *
 * This used to clamp every name between a floor and a ceiling in screen pixels and re-run the
 * collision thinning at those clamped sizes. The floor blew a small name up at low zoom and
 * shrank it back toward its true size as the reader zoomed in — Cape Verde, fitted at 1.9
 * units, was drawn at 5.5 at 1x and 2.75 at 2x — and the ceiling capped a large name so it
 * shrank relative to its country the further in the reader went. Both are gone.
 *
 * What is left is visibility. A name smaller on screen than `LABEL_MIN_RENDERED_PX` is not
 * drawn yet; zooming in brings it out at its own size. A name's screen size only grows as the
 * reader zooms in, so a name once shown stays shown, and a caption still waits for its
 * territory to be worth pointing at.
 */
export type VisibleLabel = PlacedLabel

export function visibleLabels(placed: PlacedLabel[], zoom: number): VisibleLabel[] {
  const at = zoom > 0 ? zoom : 1
  return placed.filter(
    (label) => label.fontSize * at >= LABEL_MIN_RENDERED_PX && at >= label.minZoom,
  )
}

/** Baseline-to-baseline distance for a rendered block, in projected units. */
export function lineAdvance(fontSize: number): number {
  return fontSize * LINE_HEIGHT
}
