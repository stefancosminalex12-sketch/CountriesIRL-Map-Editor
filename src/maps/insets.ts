/**
 * Insets, resolved against a live viewport.
 *
 * An inset is its own projection placed somewhere on the same canvas. That is the whole
 * mechanism, and it is deliberately *not* an SVG transform applied to geometry the main
 * projection produced: Alaska crosses the antimeridian, so a projection centred on
 * Kansas tears it in half before any transform could rescue it. Giving the inset a
 * conic of its own means the shape drawn is the shape a cartographer would draw.
 *
 * The output lands in the **same user space as the rest of the map**, which is what
 * keeps the insets ordinary. No wrapper transform, no second coordinate system: an
 * inset state's path sits beside the main map's paths, so the existing fill, border,
 * flag-pattern, hover, selection and hit-testing code reaches it without knowing it is
 * in an inset, the camera pans and zooms it with everything else, and the exporter
 * copies it like any other path.
 */
import { geoConicEqualArea, type GeoProjection } from 'd3-geo'
import type { Atlas, MapInset } from './atlas'

export interface ResolvedInset {
  inset: MapInset
  projection: GeoProjection
  /** Members as a set, for the "is this entity drawn here?" test. */
  members: Set<string>
  /** The inset's frame in viewport pixels — geography outside it is clipped. */
  clip: { x: number; y: number; width: number; height: number }
}

/**
 * Builds every inset for an atlas against the main projection.
 *
 * Scale is taken from the main projection rather than fitted, so the reduction stays
 * truthful: Alaska is drawn at 35% of the size it would be if the map were of Alaska,
 * and Hawaii at full size — the conventional treatment, and the one that stops Alaska
 * reading as larger than the contiguous states. Because it is a multiple, the
 * relationship survives every viewport size and every zoom level.
 */
export function buildInsets(
  atlas: Atlas,
  main: GeoProjection | null,
  width: number,
  height: number,
  entities?: Record<string, { id: string; parent?: { id: string } }>,
): ResolvedInset[] {
  if (!main || atlas.insets.length === 0 || width < 2 || height < 2) return []
  const scale = main.scale()
  if (!Number.isFinite(scale) || scale <= 0) return []

  /*
   * An inset named by state takes whatever of that state the loaded level draws — the state
   * itself, its counties, or its county subdivisions — so one inset serves every level of an
   * atlas. The entities are the dataset's own table; without them only named members count.
   */
  const byParent = new Map<string, string[]>()
  if (entities && atlas.insets.some((inset) => inset.parents?.length)) {
    for (const entity of Object.values(entities)) {
      for (const key of [entity.id, entity.parent?.id]) {
        if (!key) continue
        const list = byParent.get(key)
        if (list) list.push(entity.id)
        else byParent.set(key, [entity.id])
      }
    }
  }

  return atlas.insets.map((inset) => {
    const anchorX = inset.anchor.x * width
    const anchorY = inset.anchor.y * height

    const projection = geoConicEqualArea()
      .rotate([inset.rotate[0], inset.rotate[1]])
      .center(inset.center)
      .parallels(inset.parallels)
      .scale(scale * inset.scaleFactor)
      // A projection's centre lands on its translate, so anchoring is one assignment
      // rather than a bounds measurement — and it cannot drift as geometry changes.
      .translate([anchorX, anchorY])

    const frameW = inset.frame.width * width
    const frameH = inset.frame.height * height

    return {
      inset,
      projection,
      members: new Set([...inset.members, ...(inset.parents ?? []).flatMap((id) => byParent.get(id) ?? [])]),
      /*
       * The frame is a viewport, not a deletion. Alaska's Aleutian chain and Hawaii's
       * northwestern islands are still drawn from their real coordinates; they simply
       * fall outside the box, exactly as they do on a printed atlas. Clipping is what
       * stops them painting across Texas.
       */
      clip: {
        x: anchorX - frameW / 2,
        y: anchorY - frameH / 2,
        width: frameW,
        height: frameH,
      },
    }
  })
}

/** Which inset an entity is drawn in, or `null` for the main projection. */
export function insetForEntity(insets: ResolvedInset[], id: string): ResolvedInset | null {
  for (const resolved of insets) {
    if (resolved.members.has(id)) return resolved
  }
  return null
}

/**
 * The inset a *set* of entities belongs to, or `null` for the main projection.
 *
 * All-or-nothing on purpose. A merged body spanning Alaska and California has no
 * position in a composite map — the two are drawn at different scales in different
 * projections, so there is no single outline that is true in both — and every printed
 * atlas has the same limitation. A merge wholly inside one inset is drawn there; any
 * other merge is drawn in the main projection, from the members' real coordinates.
 */
export function insetForGroup(insets: ResolvedInset[], ids: string[]): ResolvedInset | null {
  if (ids.length === 0) return null
  for (const resolved of insets) {
    if (ids.every((id) => resolved.members.has(id))) return resolved
  }
  return null
}
