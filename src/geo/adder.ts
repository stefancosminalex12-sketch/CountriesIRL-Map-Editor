/**
 * Exact floating-point summation — the accumulator `d3-geo` itself adds areas with.
 *
 * `geoArea` sums a MultiPolygon's polygons in one of these, so a country's total area is
 * not the plain `+` of its polygons' areas: rounding differs in the last bits. Metrics
 * compute each polygon's area once and derive the total from those, and they have to
 * arrive at the very number `geoArea(feature)` would have returned — the paint order,
 * the small-entity threshold and everything sorted by area read it. Summing the same
 * values, in the same order, through the same algorithm is what makes that exact rather
 * than close.
 *
 * A transcription of `Adder` from d3-array 3 (ISC licence, © Mike Bostock), which
 * follows Python's `math.fsum`. `d3-array` is only a transitive dependency here, so the
 * class is copied rather than imported from a package this project does not declare.
 */
export class Adder {
  private partials = new Float64Array(32)
  private n = 0

  add(value: number): this {
    const p = this.partials
    let x = value
    let i = 0
    for (let j = 0; j < this.n && j < 32; j++) {
      const y = p[j]
      const hi = x + y
      const lo = Math.abs(x) < Math.abs(y) ? x - (hi - y) : y - (hi - x)
      if (lo) p[i++] = lo
      x = hi
    }
    p[i] = x
    this.n = i + 1
    return this
  }

  valueOf(): number {
    const p = this.partials
    let n = this.n
    let x: number
    let y: number
    let lo = 0
    let hi = 0
    if (n > 0) {
      hi = p[--n]
      while (n > 0) {
        x = hi
        y = p[--n]
        hi = x + y
        lo = y - (hi - x)
        if (lo) break
      }
      if (n > 0 && ((lo < 0 && p[n - 1] < 0) || (lo > 0 && p[n - 1] > 0))) {
        y = lo * 2
        x = hi + y
        if (y == x - hi) hi = x
      }
    }
    return hi
  }
}
