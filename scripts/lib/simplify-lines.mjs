/**
 * The topology-safe line simplifier the World map's 25m detail is made with, shared by every
 * build that makes a coarser detail from a finer one: `build-25m.mjs` (the World) and
 * `build-levels.mjs` (Europe Countries and USA States at 110m, 50m, 25m and 10m).
 *
 * See `build-25m.mjs` for what it guarantees: borders stay shared arcs, no chord sweeps over
 * another point, no drawn segment crosses another, small rings are kept whole, every ring keeps
 * its winding and at least four positions.
 */

/** A ring with this many points or fewer is kept whole: islets, microstates, enclaves. */
const SMALL_RING_POINTS = 16
/** A ring whose box is smaller than this many tolerances across is kept whole. */
const SMALL_RING_SPAN = 12
/** How many times to go finer on arcs still involved in a crossing before keeping them whole. */
const MAX_REFINES = 4

const KM_PER_DEG_LAT = 110.574
const KM_PER_DEG_LON = 111.32

/**
 * Simplifies a set of lines together, so that none crosses another or itself and none sweeps
 * over another's point.
 *
 * `lines` are integer x, y pairs. `rings` lists, for each closed ring, the lines it is made
 * of: a small ring keeps its lines whole, and every ring keeps at least four positions.
 * Coordinates are on a topology's grid, read by `lonOf` and `latOf`, unless `grid` gives degrees
 * per unit, in which case x is longitude + 180 and y latitude + 90. `toleranceKm` is how far a
 * dropped point may lie from the line that replaces it. `smallRingSpan` overrides how many
 * tolerances across a ring may be and still be kept whole: Natural Earth's islets are a few
 * points each, EuroGlobalMap's a few hundred, and kept whole they would outweigh the rest.
 * `pinBaseline`: see below, where the lines conflicting at full detail are found.
 */
export function simplifyLines(lines, ringLines, options = {}) {
  const TOLERANCE_KM = options.toleranceKm
  const degX = options.grid ? (x) => x * options.grid - 180 : options.lonOf
  const degY = options.grid ? (y) => y * options.grid - 90 : options.latOf
  const closedRings = options.closedRings ?? false

  /*
   * The distance test, on the sphere.
   *
   * d3 draws the line between two consecutive points as a great circle, not as a straight line
   * in longitude and latitude. So a run of points is replaced by a chord only when every one
   * of them lies within the tolerance of the great circle the chord will be drawn as. Measured
   * in the plane instead, a border along a parallel — the 49th between the United States and
   * Canada — reads as straight, loses its points, and is then drawn bowing towards the pole:
   * 124,000 km² moved from Canada to the United States.
   */
  const RADIANS = Math.PI / 180
  const EARTH_KM = 6371.0088
  const unit = (xy, i) => {
    const lon = degX(xy[i * 2]) * RADIANS
    const lat = degY(xy[i * 2 + 1]) * RADIANS
    const c = Math.cos(lat)
    return [c * Math.cos(lon), c * Math.sin(lon), Math.sin(lat)]
  }
  const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2]
  const chordKm = (u, v) => 2 * EARTH_KM * Math.asin(Math.min(1, Math.hypot(u[0] - v[0], u[1] - v[1], u[2] - v[2]) / 2))
  const kmDistance2 = (xy, a, b, p) => {
    const A = unit(xy, a)
    const B = unit(xy, b)
    const P = unit(xy, p)
    const n = cross(A, B)
    const nl = Math.hypot(n[0], n[1], n[2])
    let d
    if (nl < 1e-12) d = chordKm(P, A)
    else {
      const N = [n[0] / nl, n[1] / nl, n[2] / nl]
      // Between the two ends along the great circle: the cross-track distance. Otherwise the nearer end.
      if (dot(cross(A, P), N) >= 0 && dot(cross(P, B), N) >= 0) d = Math.abs(Math.asin(Math.max(-1, Math.min(1, dot(P, N))))) * EARTH_KM
      else d = Math.min(chordKm(P, A), chordKm(P, B))
    }
    return d * d
  }
  const spanKm = (xy) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (let i = 0; i < xy.length; i += 2) {
      const x = degX(xy[i]), y = degY(xy[i + 1])
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
    const cos = Math.cos(((y0 + y1) / 2) * (Math.PI / 180))
    return Math.hypot((x1 - x0) * KM_PER_DEG_LON * cos, (y1 - y0) * KM_PER_DEG_LAT)
  }

  /* Lines kept whole: those of small rings. */
  const whole = new Uint8Array(lines.length)
  for (const line of options.whole ?? []) whole[line] = 1
  const lineOf = (index) => (index >= 0 ? index : ~index)
  const ringMembers = ringLines.map((ring) => ring.map(lineOf))
  for (const members of ringMembers) {
    let points = 0
    for (const i of members) points += lines[i].length / 2
    let span = 0
    for (const i of members) span = Math.max(span, spanKm(lines[i]))
    if (points <= SMALL_RING_POINTS || span < (options.smallRingSpan ?? SMALL_RING_SPAN) * TOLERANCE_KM) for (const i of members) whole[i] = 1
  }

  /* A grid of every point of every line, for the sweep test. */
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const xy of lines) for (let i = 0; i < xy.length; i += 2) {
    if (xy[i] < minX) minX = xy[i]
    if (xy[i] > maxX) maxX = xy[i]
    if (xy[i + 1] < minY) minY = xy[i + 1]
    if (xy[i + 1] > maxY) maxY = xy[i + 1]
  }
  // Cells about as many as points, so a small feature's grid is not a million empty cells.
  let totalPoints = 0
  for (const xy of lines) totalPoints += xy.length / 2
  const CELLS = Math.max(1, Math.min(1024, Math.ceil(Math.sqrt(totalPoints / 2))))
  const cellW = Math.max(1, Math.ceil((maxX - minX + 1) / CELLS))
  const cellH = Math.max(1, Math.ceil((maxY - minY + 1) / CELLS))
  const cellOf = (x, y) => Math.floor((x - minX) / cellW) + Math.floor((y - minY) / cellH) * CELLS
  const grid = new Map()
  lines.forEach((xy, line) => {
    for (let i = 0; i < xy.length / 2; i++) {
      const c = cellOf(xy[i * 2], xy[i * 2 + 1])
      let list = grid.get(c)
      if (!list) grid.set(c, (list = []))
      list.push(line, i)
    }
  })

  const pointChordKm2 = (ax, ay, bx, by, px, py) => {
    const lax = degX(ax), lay = degY(ay)
    const cos = Math.cos(((lay + degY(by)) / 2) * (Math.PI / 180))
    const kx = KM_PER_DEG_LON * cos
    const qx = (degX(px) - lax) * kx, qy = (degY(py) - lay) * KM_PER_DEG_LAT
    const vx = (degX(bx) - lax) * kx, vy = (degY(by) - lay) * KM_PER_DEG_LAT
    const l2 = vx * vx + vy * vy
    let t = l2 === 0 ? 0 : (qx * vx + qy * vy) / l2
    t = t < 0 ? 0 : t > 1 ? 1 : t
    return (qx - t * vx) ** 2 + (qy - t * vy) ** 2
  }

  /** Whether any point other than the run's own lies in the area between chord a–b and the run. */
  const swept = (line, a, b) => {
    const xy = lines[line]
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (let i = a; i <= b; i++) {
      const x = xy[i * 2], y = xy[i * 2 + 1]
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
    const ax = xy[a * 2], ay = xy[a * 2 + 1], bx = xy[b * 2], by = xy[b * 2 + 1]
    let reach2 = 0
    for (let i = a + 1; i < b; i++) reach2 = Math.max(reach2, pointChordKm2(ax, ay, bx, by, xy[i * 2], xy[i * 2 + 1]))
    reach2 = reach2 * 1.0001 + 1e-9
    const c0x = Math.floor((x0 - minX) / cellW), c1x = Math.floor((x1 - minX) / cellW)
    const c0y = Math.floor((y0 - minY) / cellH), c1y = Math.floor((y1 - minY) / cellH)
    for (let cy = c0y; cy <= c1y; cy++) for (let cx = c0x; cx <= c1x; cx++) {
      const list = grid.get(cx + cy * CELLS)
      if (!list) continue
      for (let k = 0; k < list.length; k += 2) {
        const other = list[k], j = list[k + 1]
        if (other === line && j >= a && j <= b) continue
        const oxy = lines[other]
        const px = oxy[j * 2], py = oxy[j * 2 + 1]
        if (px < x0 || px > x1 || py < y0 || py > y1) continue
        if ((px === ax && py === ay) || (px === bx && py === by)) continue
        if (onSegment(ax, ay, bx, by, px, py)) return true
        // The area between the chord and the run lies within the run's own distance from the
        // chord: a point further than that is outside it.
        if (pointChordKm2(ax, ay, bx, by, px, py) > reach2) continue
        // Even-odd over the polygon a, a+1, …, b, closed by the chord.
        let inside = false
        for (let i = a, prev = b; i <= b; prev = i, i++) {
          const xi = xy[i * 2], yi = xy[i * 2 + 1], xj = xy[prev * 2], yj = xy[prev * 2 + 1]
          if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
        }
        if (inside) return true
      }
    }
    return false
  }

  /** Douglas–Peucker with the sweep test, at `tolerance` km; returns which points are kept. */
  const keepFor = (line, tolerance) => {
    const xy = lines[line]
    const n = xy.length / 2
    const keep = new Uint8Array(n)
    keep[0] = 1
    keep[n - 1] = 1
    if (whole[line] || tolerance <= 0) return keep.fill(1)
    const tol2 = tolerance * tolerance
    // Pinned points are kept, and each stretch between two of them is simplified on its own.
    const pinned = pins.get(line)
    const stops = pinned ? [...new Set([0, ...pinned, n - 1])].sort((p, q) => p - q) : [0, n - 1]
    for (const i of stops) keep[i] = 1
    const stack = []
    for (let i = 1; i < stops.length; i++) stack.push(stops[i - 1], stops[i])
    while (stack.length) {
      const b = stack.pop()
      const a = stack.pop()
      if (b - a < 2) continue
      let worst = -1
      let at = -1
      for (let i = a + 1; i < b; i++) {
        const d = kmDistance2(xy, a, b, i)
        if (d > worst) {
          worst = d
          at = i
        }
      }
      if (worst > tol2 || swept(line, a, b)) {
        keep[at] = 1
        stack.push(a, at, at, b)
      }
    }
    return keep
  }

  /*
   * Lines that already cross or touch something at full detail are left exactly as they are —
   * or, with `pinBaseline`, only the segments doing it are: their ends are pinned, so those very
   * segments stay drawn, the conflicts they had are not counted again, and the rest of the line is
   * simplified like any other. A source whose long coastlines touch themselves somewhere
   * (EuroGlobalMap's Britain, 40,000 points in one arc) would otherwise keep every point of them.
   */
  const pinBaseline = options.pinBaseline ?? false
  const pins = new Map()
  const basePairs = []
  const baseline = crossings(lines, lines.map((xy) => new Uint8Array(xy.length / 2).fill(1)), closedRings, pinBaseline ? basePairs : null)
  if (pinBaseline) {
    for (const key of basePairs) for (const side of key.split('|')) {
      const [line, a, b] = side.split(':').map(Number)
      let set = pins.get(line)
      if (!set) pins.set(line, (set = new Set()))
      set.add(a).add(b)
    }
  } else for (const line of baseline) whole[line] = 1
  const baseSet = new Set(basePairs)

  const tolerances = new Float64Array(lines.length).fill(TOLERANCE_KM)
  let kept = lines.map((_, line) => keepFor(line, tolerances[line]))

  /*
   * `gentleRepair`: a ring that comes out too small or turned the wrong way gets back only the
   * points it needs, not every point of every arc it uses. At a coarse tolerance a country whose
   * ring is two border arcs (Slovenia's) shrinks to a line between its two junctions, and the
   * whole-arc repair then put 1:1M detail back into a 110m map. Off for the World's 25m, which
   * stays exactly as it was built.
   */
  const gentle = options.gentleRepair ?? false

  /* Every ring keeps at least four positions (three distinct points and the closure). */
  const ensureRings = () => {
    for (const members of ringMembers) {
      const count = () => {
        let c = 0
        for (const i of members) {
          const k = kept[i]
          for (let j = 0; j < k.length; j++) if (k[j]) c++
          c -= 1 // each line's last point is the next line's first
        }
        return closedRings ? c + 1 : c
      }
      if (gentle) {
        // The middle of the longest stretch with nothing kept, on whichever line has it, until three.
        while (count() < 3) {
          let best = null
          for (const i of members) {
            const k = kept[i]
            let last = 0
            for (let j = 1; j < k.length; j++) {
              if (!k[j]) continue
              if (j - last > 1 && (!best || j - last > best.gap)) best = { line: i, at: (last + j) >> 1, gap: j - last }
              last = j
            }
          }
          if (!best) break
          kept[best.line][best.at] = 1
        }
        continue
      }
      for (const i of members) {
        if (count() >= (closedRings ? 3 : 3)) break
        kept[i].fill(1)
      }
    }
  }
  ensureRings()

  /* Crossings: every drawn segment against every other, and refine the lines involved. */
  let refined = 0
  // At a coarse tolerance a line may need many halvings before it stops crossing a neighbour.
  const maxRefines = options.maxRefines ?? MAX_REFINES
  const refineCrossings = () => {
    for (let pass = 0; pass <= maxRefines; pass++) {
      let bad
      if (pinBaseline) {
        const pairs = []
        crossings(lines, kept, closedRings, pairs)
        bad = new Set()
        for (const key of pairs) if (!baseSet.has(key)) for (const side of key.split('|')) bad.add(Number(side.split(':')[0]))
      } else {
        bad = crossings(lines, kept, closedRings)
        for (const line of baseline) bad.delete(line)
      }
      if (bad.size === 0) break
      for (const line of bad) {
        refined++
        tolerances[line] = pass === maxRefines - 1 ? 0 : tolerances[line] / 2
        kept[line] = keepFor(line, tolerances[line])
      }
      ensureRings()
      if (pass === maxRefines) throw new Error(`crossings remain on ${bad.size} lines`)
    }
  }
  refineCrossings()

  /* Winding: a ring must turn the same way it did. */
  const area = (members, keepAll) => {
    let s = 0
    let first = null
    let prev = null
    // One origin for the whole ring in the gentle repair; the World build keeps its own per line.
    const o = lines[lineOf(members[0])]
    for (const index of members) {
      const i = lineOf(index)
      const xy = lines[i]
      const k = kept[i]
      const n = xy.length / 2
      const ox = gentle ? o[0] : xy[0]
      const oy = gentle ? o[1] : xy[1]
      for (let step = 0; step < n; step++) {
        const j = index >= 0 ? step : n - 1 - step
        if (!keepAll && !k[j]) continue
        // Shift to a local origin so the products stay exact.
        const p = [xy[j * 2] - ox, xy[j * 2 + 1] - oy]
        if (prev) s += prev[0] * p[1] - p[0] * prev[1]
        else first = p
        prev = p
      }
    }
    if (prev && first) s += prev[0] * first[1] - first[0] * prev[1]
    return s
  }
  const turnsRight = (members) => Math.sign(area(members, false)) === Math.sign(area(members, true))
  let flipped = 0
  if (gentle) {
    // Finer and finer on the ring's own lines until it turns the right way; then the crossings again.
    let repaired = false
    for (const members of ringLines) {
      for (let round = 0; round < 10 && !turnsRight(members); round++) {
        for (const index of members) {
          const i = lineOf(index)
          tolerances[i] = round === 9 ? 0 : tolerances[i] / 2
          kept[i] = keepFor(i, tolerances[i])
        }
        repaired = true
      }
    }
    if (repaired) {
      ensureRings()
      refineCrossings()
    }
  }
  for (const members of ringLines) {
    if (!turnsRight(members)) {
      for (const index of members) kept[lineOf(index)].fill(1)
      flipped++
    }
  }

  let before = 0
  let after = 0
  const outLines = lines.map((xy, line) => {
    const k = kept[line]
    const n = xy.length / 2
    before += n
    const kept2 = []
    for (let i = 0; i < n; i++) if (k[i]) kept2.push(xy[i * 2], xy[i * 2 + 1])
    after += kept2.length / 2
    return Int32Array.from(kept2)
  })
  let wholeCount = 0
  for (const w of whole) wholeCount += w
  return { lines: outLines, before, after, refined, whole: wholeCount, flipped, baseline: baseline.size }
}

/** Whether p lies on the closed segment a–b (exact, integer coordinates). */
function onSegment(ax, ay, bx, by, px, py) {
  if ((bx - ax) * (py - ay) - (by - ay) * (px - ax) !== 0) return false
  return px >= Math.min(ax, bx) && px <= Math.max(ax, bx) && py >= Math.min(ay, by) && py <= Math.max(ay, by)
}

/**
 * The lines with a drawn segment that crosses or overlaps another drawn segment, not counting
 * segments that only meet at a shared end (consecutive segments, and lines meeting at a junction).
 */
function crossings(lines, kept, closedRings, pairs = null) {
  const segs = []
  lines.forEach((xy, line) => {
    const k = kept[line]
    let prev = -1
    for (let i = 0; i < xy.length / 2; i++) {
      if (!k[i]) continue
      if (prev >= 0) segs.push(line, prev, i)
      prev = i
    }
    // A closed lake ring's closing segment.
    if (closedRings && prev > 0) segs.push(line, prev, 0)
  })
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const xy of lines) for (let i = 0; i < xy.length; i += 2) {
    minX = Math.min(minX, xy[i]); maxX = Math.max(maxX, xy[i]); minY = Math.min(minY, xy[i + 1]); maxY = Math.max(maxY, xy[i + 1])
  }
  const CELLS = Math.max(1, Math.min(2048, Math.ceil(Math.sqrt(segs.length / 3))))
  const cw = Math.max(1, Math.ceil((maxX - minX + 1) / CELLS))
  const ch = Math.max(1, Math.ceil((maxY - minY + 1) / CELLS))
  const buckets = new Map()
  const bad = new Set()
  for (let s = 0; s < segs.length; s += 3) {
    const xy = lines[segs[s]]
    const ax = xy[segs[s + 1] * 2], ay = xy[segs[s + 1] * 2 + 1], bx = xy[segs[s + 2] * 2], by = xy[segs[s + 2] * 2 + 1]
    const c0x = Math.floor((Math.min(ax, bx) - minX) / cw), c1x = Math.floor((Math.max(ax, bx) - minX) / cw)
    const c0y = Math.floor((Math.min(ay, by) - minY) / ch), c1y = Math.floor((Math.max(ay, by) - minY) / ch)
    const seen = new Set()
    for (let cy = c0y; cy <= c1y; cy++) for (let cx = c0x; cx <= c1x; cx++) {
      const key = cx + cy * CELLS
      const list = buckets.get(key)
      if (list) {
        for (const t of list) {
          if (seen.has(t)) continue
          seen.add(t)
          const oxy = lines[segs[t]]
          const cx0 = oxy[segs[t + 1] * 2], cy0 = oxy[segs[t + 1] * 2 + 1], dx = oxy[segs[t + 2] * 2], dy = oxy[segs[t + 2] * 2 + 1]
          if (segmentsConflict(ax, ay, bx, by, cx0, cy0, dx, dy)) {
            bad.add(segs[s])
            bad.add(segs[t])
            if (pairs) {
              const one = `${segs[s]}:${segs[s + 1]}:${segs[s + 2]}`
              const two = `${segs[t]}:${segs[t + 1]}:${segs[t + 2]}`
              pairs.push(one < two ? `${one}|${two}` : `${two}|${one}`)
            }
          }
        }
        list.push(s)
      } else buckets.set(key, [s])
    }
  }
  return bad
}

/**
 * Whether two segments cross or overlap other than by sharing an end point. Two segments that
 * share an end touch there by construction; they conflict only if they also run along each
 * other (collinear overlap).
 */
function segmentsConflict(ax, ay, bx, by, cx, cy, dx, dy) {
  if (Math.max(ax, bx) < Math.min(cx, dx) || Math.max(cx, dx) < Math.min(ax, bx)) return false
  if (Math.max(ay, by) < Math.min(cy, dy) || Math.max(cy, dy) < Math.min(ay, by)) return false
  const o1 = orient(ax, ay, bx, by, cx, cy)
  const o2 = orient(ax, ay, bx, by, dx, dy)
  const o3 = orient(cx, cy, dx, dy, ax, ay)
  const o4 = orient(cx, cy, dx, dy, bx, by)
  const sharedEnd = (ax === cx && ay === cy) || (ax === dx && ay === dy) || (bx === cx && by === cy) || (bx === dx && by === dy)
  if (o1 === 0 && o2 === 0) {
    // Collinear: conflict when they overlap in more than a shared end point.
    const len = (px, py, qx, qy) => (qx - px) * (bx - ax) + (qy - py) * (by - ay)
    const t0 = len(ax, ay, cx, cy), t1 = len(ax, ay, dx, dy), tb = len(ax, ay, bx, by)
    const lo = Math.max(0, Math.min(t0, t1)), hi = Math.min(tb, Math.max(t0, t1))
    return hi > lo
  }
  if (sharedEnd) return false
  if (o1 * o2 < 0 && o3 * o4 < 0) return true
  // One end on the other segment: a T-touch is a conflict (lines must meet only at shared points).
  return (o1 === 0 && onSegment(ax, ay, bx, by, cx, cy)) || (o2 === 0 && onSegment(ax, ay, bx, by, dx, dy)) || (o3 === 0 && onSegment(cx, cy, dx, dy, ax, ay)) || (o4 === 0 && onSegment(cx, cy, dx, dy, bx, by))
}

function orient(ax, ay, bx, by, cx, cy) {
  const v = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
  return v > 0 ? 1 : v < 0 ? -1 : 0
}
