/**
 * One map-wide path, cut into pieces that each cover a compact part of the map.
 *
 * The lakes, the rivers and the border networks are each drawn as a single path for the whole
 * map, and on a dense map that single path is the most expensive thing in a zoom. The browser
 * rasterises the map in tiles, and it can leave out of a tile only what lies wholly outside it:
 * a path whose bounds are the whole map is in every tile, so every tile of every zoom frame
 * takes the *whole* path — every lake in Europe, 350,000 points of them, sent to the GPU
 * process and drawn once per tile. Measured on Europe Administrative (Detailed), a zoom frame
 * cost about 500 ms of GPU time, most of it that repetition.
 *
 * Cut into pieces that each cover a compact area, a tile takes only the pieces that reach it,
 * and a piece far outside the view costs nothing at all. What is drawn does not change: every
 * piece is a run of the original's own subpaths, character for character, with the same
 * attributes, so the same points are stroked and filled with the same joins and caps.
 *
 * **What a piece may be cut from.** A stroke treats every subpath on its own, so a stroked
 * layer can be cut between any two subpaths (`subpathPieces`). A fill does not — a lake with an
 * island is two subpaths whose windings cancel, and parting them would fill the island — so a
 * filled layer is cut only between features, each feature's subpaths kept together
 * (`waterPaths` in `waterDetail.ts`). Nothing here ever cuts inside a subpath.
 *
 * **How the pieces are chosen.** Recursively in half, along the longer side of the area the
 * pieces' centres span, until a piece holds no more than `maxChars` of path — a k-d split,
 * which keeps each piece compact and all pieces about the same size. Within a piece the
 * subpaths keep the order they had, and the pieces are in a fixed order, so the same input
 * always gives the same output.
 */

/** A run of path data and the box it covers, in the path's own coordinates. */
export interface PathPiece {
  d: string
  x0: number
  y0: number
  x1: number
  y1: number
}

/**
 * About 60,000 characters of path: some 4,000 points, a fraction of a tile's work.
 *
 * Small enough that a piece is a region rather than a continent at every zoom the map is
 * usually seen at, large enough that even the densest layer is a hundred or so elements.
 */
export const CHUNK_MAX_CHARS = 60_000

/**
 * The box covered by a run of path data written as `M`/`L`/`Z` with absolute coordinates —
 * what `geoPath` and `arcPaths` write. `null` for anything else, which the caller then leaves
 * whole rather than guess at.
 */
export function pathBounds(d: string): [number, number, number, number] | null {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  let i = 0
  const n = d.length
  let odd = false
  while (i < n) {
    const c = d.charCodeAt(i)
    // M, L, Z and the separator between a point's two numbers.
    if (c === 77 || c === 76 || c === 90 || c === 44) {
      i++
      continue
    }
    // A number: sign, digits, point, exponent.
    if (c === 45 || c === 46 || (c >= 48 && c <= 57)) {
      let j = i + 1
      while (j < n) {
        const e = d.charCodeAt(j)
        if ((e >= 48 && e <= 57) || e === 46 || e === 101 || e === 69) j++
        else if ((e === 45 || e === 43) && (d.charCodeAt(j - 1) === 101 || d.charCodeAt(j - 1) === 69)) j++
        else break
      }
      const v = +d.slice(i, j)
      if (!Number.isFinite(v)) return null
      if (odd) {
        if (v < y0) y0 = v
        if (v > y1) y1 = v
      } else {
        if (v < x0) x0 = v
        if (v > x1) x1 = v
      }
      odd = !odd
      i = j
      continue
    }
    // Any other command (a relative move, an arc) is not what this was written for.
    return null
  }
  if (odd || x0 > x1) return null
  return [x0, y0, x1, y1]
}

/**
 * A stroked layer's subpaths, one piece each. `null` when the path is not in the form
 * `pathBounds` reads, and the caller draws it whole.
 */
export function subpathPieces(d: string): PathPiece[] | null {
  const pieces: PathPiece[] = []
  let start = d.indexOf('M')
  if (start !== 0) return null
  while (start < d.length) {
    let end = d.indexOf('M', start + 1)
    if (end < 0) end = d.length
    const part = d.slice(start, end)
    const box = pathBounds(part)
    if (!box) return null
    pieces.push({ d: part, x0: box[0], y0: box[1], x1: box[2], y1: box[3] })
    start = end
  }
  return pieces
}

/**
 * Groups pieces into compact runs of at most `maxChars` each, as described above.
 *
 * A single piece longer than the limit stays whole: it is never cut.
 */
export function chunkPieces(pieces: PathPiece[], maxChars = CHUNK_MAX_CHARS): string[] {
  if (pieces.length === 0) return []
  const order = pieces.map((_, index) => index)
  const cx = pieces.map((p) => (p.x0 + p.x1) / 2)
  const cy = pieces.map((p) => (p.y0 + p.y1) / 2)
  const out: string[] = []

  const emit = (indexes: number[]) => {
    indexes.sort((a, b) => a - b)
    let d = ''
    for (const index of indexes) d += pieces[index].d
    if (d) out.push(d)
  }

  const split = (indexes: number[]) => {
    let size = 0
    for (const index of indexes) size += pieces[index].d.length
    if (size <= maxChars || indexes.length < 2) {
      emit(indexes)
      return
    }
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const index of indexes) {
      if (cx[index] < minX) minX = cx[index]
      if (cx[index] > maxX) maxX = cx[index]
      if (cy[index] < minY) minY = cy[index]
      if (cy[index] > maxY) maxY = cy[index]
    }
    const key = maxX - minX >= maxY - minY ? cx : cy
    // Ties broken by the original order, so the split is the same on every run.
    indexes.sort((a, b) => key[a] - key[b] || a - b)
    // Split where half the path lies on each side, not half the pieces.
    let half = 0
    let cut = 0
    while (cut < indexes.length - 1 && half + pieces[indexes[cut]].d.length <= size / 2) {
      half += pieces[indexes[cut]].d.length
      cut++
    }
    if (cut === 0) cut = 1
    split(indexes.slice(0, cut))
    split(indexes.slice(cut))
  }

  split(order)
  return out
}

/** A stroked layer, cut between subpaths; the path whole when it cannot be read. */
export function chunkStrokedPath(d: string, maxChars = CHUNK_MAX_CHARS): string[] {
  if (!d) return []
  if (d.length <= maxChars) return [d]
  const pieces = subpathPieces(d)
  return pieces ? chunkPieces(pieces, maxChars) : [d]
}
