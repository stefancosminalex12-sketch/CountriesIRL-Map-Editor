import type { GeometryCollection, GeometryObject, Topology } from 'topojson-specification'
import type { EntityMeta } from './countryMeta'

/**
 * Natural Earth's Bir Tawil/Sudan southern boundary contains two almost coincident
 * arcs with identical endpoints. The sliver between them is classified as coast,
 * leaving a missing political border. Use Bir Tawil's existing arc on both sides.
 * Work on geometry references only: cached source topology and coordinates stay intact.
 */
export function repairBirTawilBoundary(
  topology: Topology,
  objectName: string,
  meta: Record<string, EntityMeta>,
): Topology {
  const object = topology.objects[objectName] as GeometryCollection | undefined
  if (!object?.geometries) return topology
  const country = (g: GeometryObject) => meta[String(g.id)]?.parent?.id ?? String(g.id)
  const targets = object.geometries.filter(g => country(g) === 'XBT')
  if (!targets.length) return topology
  const neighbours = object.geometries.filter(g => country(g) === 'SDN')
  const index = (i: number) => i < 0 ? ~i : i
  const refs = (g: GeometryObject): number[] =>
    'arcs' in g ? (g.arcs as unknown as number[][][]).flat(Infinity) as number[] : []
  const points = (i: number): number[][] => {
    let x = 0, y = 0
    return topology.arcs[index(i)].map(p => {
      if (!topology.transform) return [p[0], p[1]]
      x += p[0]; y += p[1]
      const { scale, translate } = topology.transform
      return [x * scale[0] + translate[0], y * scale[1] + translate[1]]
    })
  }
  const equal = (a: number[], b: number[]) => a[0] === b[0] && a[1] === b[1]
  // Guard against a future source using the same endpoints for genuinely different lines.
  const close = (a: number[][], b: number[][]) => a.every(p => b.some((q, i) => {
    if (!i) return false
    const start = b[i - 1], dx = q[0] - start[0], dy = q[1] - start[1]
    const length = dx * dx + dy * dy
    const t = length ? Math.max(0, Math.min(1, ((p[0] - start[0]) * dx + (p[1] - start[1]) * dy) / length)) : 0
    return Math.hypot(p[0] - start[0] - t * dx, p[1] - start[1] - t * dy) < 0.01
  }))
  const targetArcs = [...new Set(targets.flatMap(refs).map(index))].map(i => ({ i, xy: points(i) }))
  const replacements = new Map<number, number>()
  for (const i of new Set(neighbours.flatMap(refs).map(index))) {
    if (targetArcs.some(a => a.i === i)) continue
    const xy = points(i)
    if (xy.length < 2) continue
    const candidates = targetArcs.filter(a => a.xy.length >= 2 && (
      (equal(xy[0], a.xy[0]) && equal(xy.at(-1)!, a.xy.at(-1)!)) ||
      (equal(xy[0], a.xy.at(-1)!) && equal(xy.at(-1)!, a.xy[0]))
    ))
    if (candidates.length !== 1) continue
    const a = candidates[0]
    if (!close(xy, a.xy) || !close(a.xy, xy)) continue
    replacements.set(i, equal(xy[0], a.xy[0]) ? a.i : ~a.i)
  }
  if (!replacements.size) return topology
  const replace = (arcs: unknown): unknown => {
    if (typeof arcs !== 'number') return (arcs as unknown[]).map(replace)
    const next = replacements.get(index(arcs))
    return next === undefined ? arcs : arcs < 0 ? ~next : next
  }
  const neighbourSet = new Set(neighbours)
  return {
    ...topology,
    objects: {
      ...topology.objects,
      [objectName]: {
        ...object,
        geometries: object.geometries.map(g => neighbourSet.has(g) && 'arcs' in g
          ? { ...g, arcs: replace(g.arcs) } as GeometryObject : g),
      },
    },
  }
}
