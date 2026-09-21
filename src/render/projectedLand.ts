/**
 * Every entity's outline, projected — and remembered.
 *
 * Projecting the land is the most expensive thing the canvas does: every vertex of every
 * entity through the projection, its clip and its resampling, into path strings. On the
 * world map that is ten megabytes and a few hundred milliseconds; on the administrative
 * world it is twenty megabytes and over a second. It used to be a `useMemo` inside the
 * canvas's render, which meant three things:
 *
 *   - it ran as one uninterrupted block, holding the page for the whole of it;
 *   - it ran again for a view it had already drawn — back to a region, back to a projection,
 *     back to a map after a trip to another one — because a memo only remembers its last
 *     answer;
 *   - it ran again whenever the merged set changed, because merged members were filtered out
 *     *before* projecting rather than after.
 *
 * A {@link ProjectedLand} is the answer for one view: the projection, the insets drawn
 * through it, and every entity's path. It is keyed by what decides the projection — the
 * regions, the projection, the padding and the size it was fitted to — so returning to a
 * view finds it here. The paths are exactly what the memo produced, by the same calls.
 *
 * A dataset marked `progressive` (see `GeoDataset`) has its land projected in slices off the
 * render path: the map keeps showing what it had until the new outlines are complete, then
 * swaps to them in one commit. The magnifier anchors and click catchments, which are also a
 * pass over every entity, are computed in the same job, so the commit that swaps them in has
 * nothing left to measure.
 */
import { startTransition, useEffect, useMemo, useState } from 'react'
import { geoPath, type GeoProjection } from 'd3-geo'
import type { EntityFeature, LoadedDataset } from '../geo/datasets'
import type { ResolvedInset } from '../maps/insets'
import { createSlicer } from '../geo/slices'
import {
  buildAssistIndex,
  computeSmallEntityAnchors,
  computeSmallEntityAnchorsInSlices,
  type AssistIndex,
  type SmallEntityAnchor,
} from './smallEntities'
import type { EntityId } from '../types/map'
import { projectTopologyArcs, simplifyArcs, type ArcPaths, type ProjectedArcs } from './arcPaths'

export interface LandPath {
  d: string
  /** The inset that draws this entity, or `null` for the main map. */
  clipId: string | null
}

export interface ProjectedLand {
  /** The dataset these outlines are of; `null` before any geography has loaded. */
  geo: LoadedDataset | null
  /** What decided the projection. See {@link useProjectedLand}. */
  key: string
  projection: GeoProjection
  insets: ResolvedInset[]
  /** The canvas size the projection was fitted to. */
  width: number
  height: number
  paths: Map<EntityId, LandPath>
  /** Filled on first use, or by the progressive job. See {@link anchorsOf}. */
  anchors?: SmallEntityAnchor[]
  /** Filled on first use, or by the progressive job. See {@link assistOf}. */
  assist?: AssistIndex
  /** Screen pixels the outlines were simplified to; 0 for the source's every point. */
  tolerance?: number
  /**
   * The projected arcs these paths were assembled from, for anything else drawn from the same
   * geometry — the border networks. Null for a dataset without topology.
   */
  arcs?: ArcPaths | null
  /** How the outlines were made: assembled from arcs, or drawn by `geoPath`. For the checks. */
  how?: { viaArcs: number; viaPath: number; arcs: { points: number; kept: number; unusableArcs: number } | null }
}

const NO_PATHS: Map<EntityId, LandPath> = new Map()

/**
 * How an entity's outline is drawn under a projection and its insets.
 *
 * The main map's entities are assembled from the topology's projected arcs (`arcPaths.ts`),
 * which is several times quicker and keeps every shared border identical on both sides. Three
 * things still go through `geoPath`, exactly as they always did:
 *
 *   - an entity drawn in an inset, which has its own projection;
 *   - an entity with no topology behind it — one supplied from `supplemental.ts`;
 *   - an entity the arcs cannot draw without clipping, which `arcPaths` refuses rather than
 *     approximates: anything crossing the antimeridian or a projection's horizon.
 */
/**
 * The arcs of the last dataset projected, kept for the next detail step.
 *
 * Zooming does not change the projection, only how finely the land is drawn, so crossing a
 * detail step would otherwise project the same million points again for the same answer. One
 * entry, replaced whenever anything else is asked for: the arcs of a dataset are about a fifth
 * of the size of its coordinates, and two datasets' worth is not worth holding.
 *
 * A d3 projection is mutable, so identity alone would not prove the cached arcs still match it:
 * `fit.ts` builds a projection by moving one. The probes below are projected again on every
 * hit — three calls — and a projection that has moved since misses.
 */
const PROBES: [number, number][] = [
  [0, 0],
  [30, 45],
  [-120, -30],
]
let arcCache: { topology: unknown; projection: GeoProjection; probes: string; arcs: ProjectedArcs } | null = null

const probeOf = (projection: GeoProjection) =>
  PROBES.map((p) => {
    const at = projection(p)
    return at ? `${at[0].toFixed(4)},${at[1].toFixed(4)}` : 'none'
  }).join('|')

function arcsFor(topology: NonNullable<LoadedDataset['topology']>, projection: GeoProjection): ProjectedArcs {
  const probes = probeOf(projection)
  if (arcCache && arcCache.topology === topology && arcCache.projection === projection && arcCache.probes === probes) {
    return arcCache.arcs
  }
  // Dropped before the new one is built, so the two are never held at once.
  arcCache = null
  const arcs = projectTopologyArcs(topology, projection)
  arcCache = { topology, projection, probes, arcs }
  return arcs
}

/** Frees the projected arcs — for a caller that knows nothing more will be drawn from them. */
export function forgetProjectedArcs(): void {
  arcCache = null
}

function landPainter(
  geo: LoadedDataset,
  projection: GeoProjection,
  insets: ResolvedInset[],
  tolerance: number,
) {
  const mainPath = geoPath(projection)
  const insetPaths = insets.map((resolved) => ({ resolved, path: geoPath(resolved.projection) }))
  const fast: ArcPaths | null = geo.topology
    ? simplifyArcs(arcsFor(geo.topology, projection), tolerance)
    : null
  /*
   * An entity supplied from `supplemental.ts` keeps its topology geometry — the shard the
   * dataset does have — and that is not what the map draws. Vatican City is the case: the
   * supplement is the whole state, the topology's ring is a fragment of it. These are drawn
   * from the feature, like everything else the arcs cannot speak for.
   */
  const supplied = new Set(geo.supplemented)
  let viaArcs = 0
  let viaPath = 0
  const paint = (feature: EntityFeature): LandPath => {
    const id = feature.properties.countryId
    const inset = insetPaths.find((entry) => entry.resolved.members.has(id))
    if (!inset && fast && !supplied.has(id)) {
      const geometries = geo.topoById.get(id)
      if (geometries && geometries.length > 0) {
        let d = ''
        let whole = true
        for (const geometry of geometries) {
          const part = fast.path(geometry)
          if (part === null) {
            whole = false
            break
          }
          d += part
        }
        if (whole && d !== '') {
          viaArcs++
          return { d, clipId: null }
        }
      }
    }
    viaPath++
    return {
      d: (inset ? inset.path : mainPath)(feature) ?? '',
      clipId: inset ? inset.resolved.inset.id : null,
    }
  }
  return { paint, fast, report: () => ({ viaArcs, viaPath, arcs: fast?.stats ?? null }) }
}

export function projectLand(
  geo: LoadedDataset,
  key: string,
  projection: GeoProjection,
  insets: ResolvedInset[],
  width: number,
  height: number,
  tolerance = 0,
): ProjectedLand {
  const { paint, fast, report } = landPainter(geo, projection, insets, tolerance)
  const paths = new Map<EntityId, LandPath>()
  for (const feature of geo.features) paths.set(feature.properties.countryId, paint(feature))
  return { geo, key, projection, insets, width, height, paths, tolerance, arcs: fast, how: report() }
}

/**
 * The same land, projected a slice at a time. Resolves to `null` if `cancelled` turns true
 * before it finishes — the view it was for has already been left.
 */
export async function projectLandInSlices(
  geo: LoadedDataset,
  key: string,
  projection: GeoProjection,
  insets: ResolvedInset[],
  width: number,
  height: number,
  cancelled: () => boolean,
  tolerance = 0,
): Promise<ProjectedLand | null> {
  const slicer = createSlicer()
  /*
   * The arcs are projected first, in one pass: it is the bulk of the work, and it is what the
   * entity paths are then assembled from. A slice boundary before it keeps the pass that
   * follows short.
   */
  const { paint, fast, report } = landPainter(geo, projection, insets, tolerance)
  await slicer.pause()
  if (cancelled()) return null
  const paths = new Map<EntityId, LandPath>()
  for (const feature of geo.features) {
    if (slicer.due()) {
      await slicer.pause()
      if (cancelled()) return null
    }
    paths.set(feature.properties.countryId, paint(feature))
  }

  const anchors = await computeSmallEntityAnchorsInSlices(geo, projection, insets, slicer, cancelled)
  if (!anchors) return null
  if (slicer.due()) {
    await slicer.pause()
    if (cancelled()) return null
  }
  const assist = buildAssistIndex(geo, projection, insets)
  return { geo, key, projection, insets, width, height, paths, anchors, assist, tolerance, arcs: fast, how: report() }
}

/** The small-entity anchors for this view, measured once per land. */
export function anchorsOf(land: ProjectedLand): SmallEntityAnchor[] {
  if (!land.anchors) land.anchors = computeSmallEntityAnchors(land.geo, land.projection, land.insets)
  return land.anchors
}

/** The assisted-selection catchments for this view, measured once per land. */
export function assistOf(land: ProjectedLand): AssistIndex {
  if (!land.assist) land.assist = buildAssistIndex(land.geo, land.projection, land.insets)
  return land.assist
}

/**
 * The last few views, most recent first.
 *
 * Three rather than one: the view on screen, and the two most likely to be returned to — the
 * region or projection just left, or the other map in a trip between two. Held globally rather
 * than per dataset, so a session that visits every map still holds three sets of outlines and
 * not three per map — on a phone that is the difference that matters.
 */
const REMEMBERED_VIEWS = 3
let remembered: ProjectedLand[] = []

function recallLand(geo: LoadedDataset, key: string): ProjectedLand | null {
  const hit = remembered.find((land) => land.geo === geo && land.key === key) ?? null
  if (hit) remembered = [hit, ...remembered.filter((land) => land !== hit)]
  return hit
}

function rememberLand(land: ProjectedLand): ProjectedLand {
  if (!land.geo) return land
  remembered = [
    land,
    ...remembered.filter((other) => !(other.geo === land.geo && other.key === land.key)),
  ].slice(0, REMEMBERED_VIEWS)
  return land
}

/**
 * The land the canvas draws.
 *
 * For an ordinary dataset this is synchronous, exactly as the memo it replaces: projected in
 * the render that asks for it, unless the view was drawn before and is still remembered.
 *
 * For a progressive one, a view that is not remembered is projected in slices after the
 * render. Until it is ready this returns the land already on screen if it is of the same
 * dataset — the previous region, projection or size, which the canvas keeps drawing, fitted
 * as it was — or `null` when there is nothing of this dataset to show yet.
 *
 * Everything that draws over the land takes its projection from the land returned here, not
 * from the one being prepared, so nothing is ever drawn through a projection the outlines
 * under it were not.
 */
export function useProjectedLand(
  geo: LoadedDataset | null,
  projection: GeoProjection | null,
  insets: ResolvedInset[],
  key: string,
  width: number,
  height: number,
  progressive: boolean,
  /**
   * Screen pixels the outlines may be simplified by — see `arcPaths.ts`. The caller decides it
   * from how far the map is zoomed in, and must put it in `key`, so a view held at one detail
   * is never handed back for another.
   */
  tolerance = 0,
): ProjectedLand | null {
  const immediate = useMemo((): ProjectedLand | null => {
    if (!projection) return null
    if (!geo) return { geo: null, key, projection, insets, width, height, paths: NO_PATHS }
    const known = recallLand(geo, key)
    if (known) return known
    if (progressive) return null
    return rememberLand(projectLand(geo, key, projection, insets, width, height, tolerance))
  }, [geo, projection, insets, key, width, height, progressive, tolerance])

  const [prepared, setPrepared] = useState<ProjectedLand | null>(null)

  useEffect(() => {
    if (immediate || !geo || !projection) return
    let cancelled = false
    void projectLandInSlices(geo, key, projection, insets, width, height, () => cancelled, tolerance).then(
      (land) => {
        /*
         * As a transition: the canvas renders one path per entity — 32,000 of them on the
         * official USA map's subdivision level — and React then builds them in slices while
         * the view already drawn stays on screen, leaving only the commit as one block.
         */
        if (land && !cancelled) startTransition(() => setPrepared(rememberLand(land)))
      },
    )
    return () => {
      cancelled = true
    }
  }, [immediate, geo, projection, insets, key, width, height, tolerance])

  if (immediate) return immediate
  return prepared && prepared.geo === geo ? prepared : null
}
