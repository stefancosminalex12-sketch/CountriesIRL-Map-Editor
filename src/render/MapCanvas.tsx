/**
 * The map renderer.
 *
 * SVG output driven by d3-geo. SVG is deliberate: the same path data that renders on
 * screen can be serialised for SVG export or rasterised to a fixed-size PNG (the
 * eventual 1920x1080 target) without a second rendering path, and every country is a
 * real DOM node so per-country styling and interaction stay trivial.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { geoPath, geoGraticule10 } from 'd3-geo'
import { select } from 'd3-selection'
import { zoom, zoomIdentity, type ZoomBehavior } from 'd3-zoom'
import { useElementSize } from './useElementSize'
import { useKeyed } from './useKeyed'
import { getAtlas } from '../maps/atlas'
import { buildInsets, insetForGroup } from '../maps/insets'
import { buildProjection } from '../geo/fit'
import { countriesInRegions } from '../geo/regions'
import { computeFraming } from '../geo/framing'
import {
  buildComparisonContext,
  computeCategories,
  computeDomain,
  contrastInk,
  resolveBorderInk,
  deriveLandTints,
  reanchorTone,
  resolveCountryFill,
  resolveDataFill,
  type FillContext,
} from '../state/colors'
import { MapLegend, LEGEND_MARKER } from './MapLegend'
import type { MultiPolygon } from 'geojson'
import { buildMaritimeShapes, MapMaritime, selectIslandZones } from './MapMaritime'
import {
  buildFlagIslands,
  buildFlagTiles,
  FLAG_BORDER_COLOR,
  flagBorderWidth,
  FLAG_BOUNDARY_EDGE,
  FLAG_BOUNDARY_INK,
  boundaryEdgeWidth,
  boundaryInkWidth,
  MARITIME_OPACITY,
  maritimeBorderWidth,
  FlagIslands,
  FlagPatterns,
  flagPatternId,
  FlagTerritories,
  WorldFlagPattern,
  WORLD_FLAG_PATTERN_ID,
  fitFlag,
  patternGeometry,
} from './MapFlags'
import { flagFootprints, flagTerritories } from './flagPlacement'
import { buildLabelShape, layoutLabels, type LabelShape } from './labelPlacement'
import { MapLabels } from './MapLabels'
import { flagCodeFor, hasFlag, useFlagStore } from '../flags/flagStore'
import { resolveScreen } from './screenFrame'
import { mergeCountries } from '../geo/merge'
import { MapScreen } from './MapScreen'
import { getPreset } from '../state/presets'
import { useMapStore } from '../state/mapStore'
import { useSettingsStore } from '../state/settingsStore'
import { getTheme } from '../theme/themes'
import { playSfx } from '../audio/sfx'
import {
  anchorScreenPosition,
  buildAssistIndex,
  computeSmallEntityAnchors,
  MIN_RENDERED_SIZE_PX,
  minimumSizeTransform,
  pickAssistedCountryAt,
  SMALL_ENTITY_LENS_OFFSET_PX,
  SMALL_ENTITY_LENS_RADIUS_PX,
} from './smallEntities'

export const MAP_SVG_ID = 'map-canvas-svg'

const ZOOM_RANGE: [number, number] = [1, 40]

/**
 * Smallest an entity may be drawn, on a compact viewport, and still be given a flag.
 *
 * Six pixels is below the size at which a flag reads as anything but a coloured dot, so
 * the cutoff costs nothing that could have been seen while removing the SVG parse
 * behind it. See `visibleFlagTiles`.
 */
const COMPACT_FLAG_MIN_PX = 6

export function MapCanvas() {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null)

  const { width, height } = useElementSize(containerRef)

  const doc = useMapStore((s) => s.doc)
  const geo = useMapStore((s) => s.geo)
  const lakes = useMapStore((s) => s.lakes)
  const maritime = useMapStore((s) => s.maritime)
  const geoStatus = useMapStore((s) => s.geoStatus)
  const geoError = useMapStore((s) => s.geoError)
  const transform = useMapStore((s) => s.transform)
  const framingEpoch = useMapStore((s) => s.framingEpoch)
  const hoveredCountryId = useMapStore((s) => s.hoveredCountryId)
  const selectedCountryIds = useMapStore((s) => s.selectedCountryIds)
  const setHovered = useMapStore((s) => s.setHovered)
  const selectCountry = useMapStore((s) => s.selectCountry)
  const setTransform = useMapStore((s) => s.setTransform)

  const { scope } = doc

  /**
   * The style the map is actually drawn with.
   *
   * The document's, with the selection colour swapped for the author's preference when
   * they have set one. Done here, once, rather than at each place a selection is drawn:
   * the fill, the outline, the casing and the anchor handles all read `style.selected`
   * and `style.selectedOutline`, and substituting at the source is what makes it
   * impossible to miss one of them.
   *
   * It is a *preference*, not map content — it lives in `settingsStore` beside the theme
   * and the volume, so it survives a reload, stays out of exports and off the undo
   * stack, and never travels with a saved map. Which is why it is applied over the
   * document here instead of being written into it.
   *
   * The outline moves with the fill rather than keeping the theme's, or a red selection
   * would be ringed in the old theme's green.
   */
  const selectionHighlight = useSettingsStore((s) => s.selectionHighlight)
  const style = useMemo(() => {
    const base = doc.style
    if (!selectionHighlight) return base
    return {
      ...base,
      selected: selectionHighlight,
      selectedOutline: reanchorTone(selectionHighlight, base.selectedOutline, base.selected),
    }
  }, [doc.style, selectionHighlight])
  const layer = useMemo(
    () => doc.layers.find((l) => l.id === doc.activeLayerId) ?? doc.layers[0],
    [doc.layers, doc.activeLayerId],
  )

  // Framing is derived from the loaded geometry, so it re-resolves when the dataset
  // changes as well as when the region does.
  const framing = useMemo(() => computeFraming(scope.regionIds, geo), [scope.regionIds, geo])

  /**
   * The composition frame this viewport currently has.
   *
   * Resolved rather than read, so a frame stored at another window size is clamped to
   * one that fits — see `resolveScreen`. An uncomposed map resolves to the whole
   * canvas, which is what makes the frame invisible to everything downstream until an
   * author actually sets one.
   */
  const screenOn = doc.screen.enabled
  const screen = useMemo(
    () => resolveScreen(screenOn ? doc.screen.rect : null, width, height),
    [screenOn, doc.screen.rect, width, height],
  )

  const projection = useMemo(() => {
    if (width < 2 || height < 2) return null
    const next = buildProjection({
      framing,
      projectionId: scope.projectionId,
      width,
      height,
      padding: scope.padding,
    })
    // Lets `__mapEditor.project(lon, lat)` report true screen positions in dev.
    if (import.meta.env.DEV) {
      ;(window as unknown as Record<string, unknown>).__mapProjection = next
    }
    return next
  }, [framing, scope.projectionId, scope.padding, width, height])

  /**
   * The atlas's insets, resolved against this viewport and this projection.
   *
   * Geography that is drawn somewhere other than where it is: Alaska and Hawaii on a map
   * of the United States. Empty for an atlas whose geography holds together, which is
   * every case but that one so far — so the world map computes nothing here and takes
   * exactly the path it always did.
   */
  const atlas = useMemo(() => getAtlas(scope.atlasId), [scope.atlasId])
  const insets = useMemo(
    () => buildInsets(atlas, projection, width, height),
    [atlas, projection, width, height],
  )
  /** Which countries belong to the active scope — drives the outside-scope treatment. */
  const scopeCountryIds = useMemo(() => {
    if (!geo) return new Set<string>()
    return countriesInRegions(scope.regionIds, geo.meta)
  }, [geo, scope.regionIds])

  /** Geometry -> path strings. Recomputed only when the dataset or projection changes. */
  /**
   * The merges, as everything that draws them sees them.
   *
   * A merged entity has two quite different kinds of field. Its members decide its
   * geometry — dissolving them, projecting the result, laying every other country out
   * around it — and its flag decides its paint. Its *name* decides neither: nothing on
   * this canvas draws it, it is read by the inspector and the Merge panel.
   *
   * The document is immutable, so typing a character into that name replaces
   * `doc.merges` and every memo keyed on it recomputes: the dissolve, a `geoPath` over
   * the result, `fitFlag`, and — because the member set feeds the country filter — a
   * reprojection of all 250 country paths. Per keystroke. Keying these two views on
   * what they actually read means a rename changes neither reference and none of that
   * work happens; the name still updates, because the components that show it read it
   * from the document directly.
   */
  const mergeGeometry = useKeyed(
    doc.merges,
    doc.merges.map((m) => `${m.id} ${m.members.join(',')}`).join('|'),
  )
  const mergePaint = useKeyed(
    doc.merges,
    doc.merges.map((m) => `${m.id} ${m.flag ?? ''} ${m.members.join(',')}`).join('|'),
  )

  /**
   * Countries that a merge has absorbed, and so are not drawn on their own.
   *
   * The merged body is drawn in their place; leaving the members drawn as well would
   * put their shared borders straight back on top of the dissolve.
   */
  const mergedMemberIds = useMemo(() => {
    const ids = new Set<string>()
    for (const merge of mergeGeometry) for (const id of merge.members) ids.add(id)
    return ids
  }, [mergeGeometry])

  /**
   * Every entity's outline, each through whichever projection draws it.
   *
   * One list, not two. An inset entity differs from a main-map one in exactly two ways —
   * which projection produced its path, and that it carries a clip — and both are
   * settled here. Everything after this point sees a flat list of shapes and treats
   * Alaska exactly as it treats Kansas, which is what keeps selection, values,
   * palettes, comparison, flags and export working on the insets without any of them
   * knowing insets exist.
   */
  const shapes = useMemo(() => {
    if (!projection || !geo) return []
    const mainPath = geoPath(projection)
    const insetPaths = insets.map((resolved) => ({
      resolved,
      path: geoPath(resolved.projection),
    }))

    return geo.features
      .filter((feature) => !mergedMemberIds.has(feature.properties.countryId))
      .map((feature) => {
        const id = feature.properties.countryId
        const inset = insetPaths.find((entry) => entry.resolved.members.has(id))
        return {
          id,
          name: feature.properties.name,
          d: (inset ? inset.path : mainPath)(feature) ?? '',
          clipId: inset ? inset.resolved.inset.id : null,
        }
      })
      .filter((s) => s.d.length > 0)
  }, [projection, geo, mergedMemberIds, insets])

  /**
   * The merged bodies, projected through the same pipeline as everything else.
   *
   * Which is the point: the dissolve happens once in geographic space and the result is
   * an ordinary MultiPolygon, so every projection, zoom level and dataset resolution
   * handles it exactly as it handles a country — no special case anywhere downstream,
   * and the export gets it for free.
   */
  const mergedShapes = useMemo(() => {
    if (!projection || !geo) return []
    const path = geoPath(projection)
    // Id and outline only. The name is not drawn here, and carrying it would tie this
    // memo — the dissolve and a `geoPath` over it — to every keystroke of a rename.
    return mergeGeometry
      .map((entity) => {
        const geometry = mergeCountries(geo, entity.members)
        if (!geometry) return null
        // A merge wholly inside one inset is drawn there; anything else is drawn in the
        // main projection. See `insetForGroup` for why that is the only honest answer.
        const inset = insetForGroup(insets, entity.members)
        const draw = inset ? geoPath(inset.projection) : path
        return { id: entity.id, d: draw(geometry) ?? '', clipId: inset ? inset.inset.id : null }
      })
      .filter((s): s is NonNullable<typeof s> => s !== null && s.d.length > 0)
  }, [projection, geo, mergeGeometry, insets])

  /* ----------------------------------------------------------------- labels */

  const labels = doc.labels
  const labelsOn = labels.enabled

  /**
   * Whether the label geometry should be kept ready.
   *
   * The same latch the flags use, for the same reason: gating the memo on the switch
   * itself would make turning the feature off replace its inputs with nothing, so
   * turning it back on would present changed dependencies and pay the whole cost again.
   * Latched, the second toggle and every one after it does no geometric work at all —
   * and an author who never turns labels on never pays for them once.
   */
  const [labelsPrepared, setLabelsPrepared] = useState(false)
  useEffect(() => {
    if (labelsOn) setLabelsPrepared(true)
  }, [labelsOn])
  const prepareLabels = labelsOn || labelsPrepared

  /**
   * Where every name goes, and how much room it has.
   *
   * One list covering countries and merged bodies together, built from exactly the
   * geometry each of them is *drawn* from: a country from its own feature through the
   * projection that draws it — the main one, or an inset's — and a merged body from the
   * same dissolve `mergedShapes` paints. So a merge's name follows its real outline,
   * including when that outline is in several disconnected pieces, and deleting the
   * merge brings its members' own names back because they are simply in this list
   * again. There is no labelling path that knows what a merge is.
   *
   * What this memo does *not* depend on is worth as much as what it does. Not the
   * names, not the colours, not the font, not the size — so renaming a merged entity,
   * or dragging any of the appearance controls, recomputes none of it. And not the
   * camera either: these are user-space coordinates, so pan and zoom carry them.
   */
  const labelShapes = useMemo<LabelShape[]>(() => {
    if (!prepareLabels || !projection || !geo) return []
    const out: LabelShape[] = []

    for (const feature of geo.features) {
      const id = feature.properties.countryId
      if (mergedMemberIds.has(id)) continue
      const inset = insets.find((resolved) => resolved.members.has(id))
      const shape = buildLabelShape(
        id,
        feature.geometry,
        inset ? inset.projection : projection,
        inset ? inset.inset.id : null,
      )
      if (shape) out.push(shape)
    }

    for (const entity of mergeGeometry) {
      const geometry = mergeCountries(geo, entity.members)
      if (!geometry) continue
      const inset = insetForGroup(insets, entity.members)
      const shape = buildLabelShape(
        entity.id,
        geometry,
        inset ? inset.projection : projection,
        inset ? inset.inset.id : null,
      )
      if (shape) out.push(shape)
    }

    return out
  }, [prepareLabels, projection, geo, mergedMemberIds, mergeGeometry, insets])

  /**
   * What each entity is called, by the document's own naming rule.
   *
   * The author's override first, then the merged entity's name, then the dataset's —
   * the same order the inspector shows and the same order the hover label follows. A
   * label is not a new opinion about what a place is called; it is the existing one,
   * drawn on the map.
   */
  const labelNames = useMemo(() => {
    const names = new Map<string, string>()
    if (!prepareLabels || !geo) return names
    for (const shape of labelShapes) {
      const override = doc.countries[shape.id]?.label
      const merged = doc.merges.find((m) => m.id === shape.id)?.name
      const name = override ?? merged ?? geo.meta[shape.id]?.name ?? null
      if (name) names.set(shape.id, name)
    }
    return names
  }, [prepareLabels, geo, labelShapes, doc.countries, doc.merges])

  /**
   * The names as they will actually be set: wrapped, sized, placed, de-conflicted.
   *
   * The cheap half of the feature, and deliberately separate from the geometry above.
   * Its inputs are the names, the author's two typographic settings and the stepped
   * zoom — so a rename, a font change or a drag of the size slider redoes arithmetic
   * over numbers that were measured once, and never touches a projection.
   *
   * The stepped zoom is here because two things depend on the camera: which names clear
   * the legibility floor, and therefore which of them are competing for the same space.
   * Stepping it means that set is reconsidered at doublings rather than on every frame
   * of a pinch.
   */
  /*
   * The zoom, quantised — the one thing the labels ask the camera, and only so they can
   * decide which of them are large enough to be worth drawing.
   *
   * Stepped rather than live because it reaches a memoised component: a continuous value
   * would re-render every name on every frame of a pinch to change nothing but which ones
   * are shown. But *quarter*-octaves rather than doublings, because the step size is what
   * a reader experiences as the feature's smoothness. At doublings, thirty-five names
   * arrived at the same instant — nothing had moved, yet the map lurched, and a lurch is
   * indistinguishable from instability to the person watching it. Quartering the step
   * brings them in a handful at a time, at four times as many render points, each of
   * which is a cheap reconciliation because no geometry is recomputed.
   */
  const labelZoomStep = useMemo(
    () => (transform.k > 0 ? Math.pow(2, Math.round(Math.log2(transform.k) * 4) / 4) : 1),
    [transform.k],
  )
  const labelStyle = useMemo(
    () => ({ scale: labels.size, font: labels.font }),
    [labels.size, labels.font],
  )
  /*
   * Note what is *not* in this dependency list: the zoom. The layout is a statement about
   * the map in its own coordinates, so the camera has nothing to say about it — which is
   * what makes a label stay exactly where it was put when the reader zooms. The stepped
   * zoom below is passed to the renderer instead, where it decides only which of these
   * are large enough to be worth drawing.
   */
  const labelPlacements = useMemo(
    () => (labelsOn ? layoutLabels(labelShapes, labelNames, labelStyle) : []),
    [labelsOn, labelShapes, labelNames, labelStyle],
  )

  /**
   * Every lake as one path.
   *
   * They share a single style and are never individually addressable, so one element
   * is both cheaper to render and simpler than 300+ nodes. Memoised on the projection
   * and the layer, exactly like the country paths, so it is rebuilt when the camera's
   * projection changes and never on a theme change, a pan or a zoom.
   */
  const lakePath = useMemo(() => {
    if (!projection || !lakes) return ''
    const path = geoPath(projection)
    return path({ type: 'FeatureCollection', features: lakes.features } as Parameters<typeof path>[0]) ?? ''
  }, [projection, lakes])

  const backdrop = useMemo(() => {
    if (!projection) return { sphere: '', graticule: '', borders: '' }
    const path = geoPath(projection)
    return {
      sphere: path({ type: 'Sphere' }) ?? '',
      graticule: path(geoGraticule10()) ?? '',
      /*
       * The international boundary network, projected with everything else.
       *
       * One path for the whole world rather than one per country, because that is what
       * the topology gives: each shared border is a single arc belonging to both
       * neighbours, so drawing it once draws it correctly and no seam can appear where
       * two countries' outlines would otherwise have been laid over each other.
       */
      borders: geo?.borders ? (path(geo.borders) ?? '') : '',
    }
  }, [projection, geo])

  /**
   * Editor-only anchors for features too small to click. Recomputed only when the
   * projection or dataset changes — never while the pointer moves.
   */
  const smallAnchors = useMemo(
    () => computeSmallEntityAnchors(geo, projection),
    [geo, projection],
  )

  const shapeById = useMemo(() => {
    const map = new Map<string, string>()
    for (const shape of shapes) map.set(shape.id, shape.d)
    return map
  }, [shapes])

  /**
   * Catchments for every island of every country whose geometry is hard to hit.
   *
   * Independent of the anchors above: those drive the magnifier and the rendering
   * floor and stay keyed to whole small countries, while this follows individual
   * islands and reaches countries no one would call small — the Bahamas' land is
   * scattered over forty-one islands and none of them is easy to click.
   */
  const assist = useMemo(() => buildAssistIndex(geo, projection), [geo, projection])

  /** Merge ids, so the picker can recognise one as an entity in its own right. */
  const mergeIds = useMemo(() => new Set(mergeGeometry.map((m) => m.id)), [mergeGeometry])

  /**
   * Which merge absorbed each member country.
   *
   * A member is no longer a thing on the map — its geometry is inside the merged body
   * and its own path is not drawn — so any route that still resolves to it, the small
   * country catchments in particular, has to arrive at the entity instead. Without this
   * a click near Andorra would select Spain out from under an Iberia that had swallowed
   * it.
   */
  const mergeIdByMember = useMemo(() => {
    const map = new Map<string, string>()
    for (const merge of mergeGeometry) for (const id of merge.members) map.set(id, merge.id)
    return map
  }, [mergeGeometry])

  const zoomK = transform.k

  /**
   * Resolves which country a pointer position refers to.
   *
   * Order matters. Visible land belonging to a country that needs assistance wins
   * outright, so clicking an island is never overridden by a neighbour's catchment.
   * Otherwise the catchments get a say — they overlap the countries around them on
   * purpose, which is what lets a click "on France" select Monaco, and a click on
   * the water inside a Maldivian atoll select the Maldives. Only if nothing claims
   * the point does the polygon under the cursor win.
   */
  const pickCountryAt = useCallback(
    (event: ReactMouseEvent): string | null => {
      const svg = svgRef.current
      if (!svg) return null

      const target = event.target as Element | null
      /*
       * The legend sits over the map, and the assist catchments below would happily
       * claim a pointer that is on it — clicking the legend would select whichever
       * microstate it happens to cover. It is a caption, so it picks nothing.
       */
      if (target?.closest?.(`[${LEGEND_MARKER}]`)) return null
      const targetId = target?.getAttribute?.('data-country-id') ?? null
      /*
       * A merged body is visible land belonging to a real entity, so a direct hit on it
       * wins outright — the same rule the assisted countries get on the next line, and
       * for the same reason: a neighbour's catchment must not reach across it.
       */
      if (targetId && mergeIds.has(targetId)) return targetId
      if (targetId && assist.ids.has(targetId)) return targetId

      const rect = svg.getBoundingClientRect()
      const claimed = pickAssistedCountryAt(
        assist,
        event.clientX - rect.left,
        event.clientY - rect.top,
        transform,
        targetId,
      )

      const resolved = claimed ?? targetId
      // Whatever route got here, a member answers as the entity that absorbed it.
      return resolved ? (mergeIdByMember.get(resolved) ?? resolved) : null
    },
    [assist, transform, mergeIds, mergeIdByMember],
  )

  /**
   * Rendering floor for features too small to draw at the current zoom.
   *
   * Recomputed only when the anchors or the zoom factor change, and only over the
   * handful of features that qualify — never per frame, never over the whole dataset.
   */
  const minimumSizeById = useMemo(() => {
    const transforms = new Map<string, string>()
    for (const anchor of smallAnchors) {
      const transform = minimumSizeTransform(anchor, zoomK)
      if (transform) transforms.set(anchor.id, transform)
    }
    return transforms
  }, [smallAnchors, zoomK])

  const landTints = useSettingsStore((s) => getTheme(s.themeId).landTints)
  /** The theme's *own* land tone, which the tints above are spaced around. */
  const themeLand = useSettingsStore((s) => getTheme(s.themeId).map.land)

  /**
   * The tint family, re-anchored on whatever land colour the author has chosen.
   *
   * The theme's tints are literal khakis and were used as such, which made the Land
   * control silently do nothing on the Geographic theme — the tint outranks
   * `style.land` when the fill is resolved, so the swatch moved and the map did not.
   * Re-anchoring keeps the theme's spread and lets the author set where it sits; see
   * `deriveLandTints`.
   */
  const tintPalette = useMemo(
    () => (landTints ? deriveLandTints(style.land, landTints, themeLand) : null),
    [landTints, style.land, themeLand],
  )

  /**
   * Per-country land tone, for themes that separate neighbours by tint.
   *
   * The group index is decided once per dataset by graph-colouring real adjacency
   * (see `geo/metrics.ts`); all this does is look up the colour for it. So changing
   * theme or land colour re-reads a palette and never touches geometry, and panning or
   * zooming never recomputes anything.
   */
  const landTintById = useMemo(() => {
    if (!tintPalette || !geo) return null
    const tints = new Map<string, string>()
    for (const [id, metrics] of geo.metrics) {
      tints.set(id, tintPalette[metrics.tintGroup % tintPalette.length])
    }
    return tints
  }, [tintPalette, geo])

  /*
   * Everything the fill pipeline needs that is the same for every country, resolved
   * once per document change. The domain is computed from `doc.countries` — the whole
   * document — and the preset is a lookup by id, so no threshold ever gets written
   * down here: `state/presets.ts` owns the numbers and this only carries them across.
   */
  /* ------------------------------------------------------------------ flags */

  const flagsOn = doc.flags.enabled

  /*
   * World domination: one country's flag over everything, instead of each country's own.
   *
   * Held as a code plus a box, and nothing else. The mode's geometry — the footprints,
   * the tiles, the territories, the island floor — is built exactly as it always is and
   * is not consulted about this, so the override changes only which paint server the
   * shapes point at. That is what makes turning it off instant and lossless: there is
   * nothing to rebuild, because nothing was torn down.
   */
  /**
   * The flag each country actually flies.
   *
   * One place, consulted by every part of the mode that needs a code — the tiles, the
   * island floor, and the maritime layer that reads from the tiles. An override says
   * "this country flies that country's flag", and it is resolved through the same
   * `flagCodeFor` as the country's own, so a borrowed flag that comes from an alias or
   * the territory policy is found exactly as it would be for its owner.
   *
   * World domination is not handled here and does not need to be: it replaces the
   * *paint* further down rather than the code, so an override survives underneath it
   * untouched and comes back the moment domination is switched off.
   */
  const flagCodeOf = useCallback(
    (id: string): string | undefined => {
      if (!geo) return undefined
      const borrowed = doc.flags.overrides[id]
      const source = borrowed ?? id
      const viaEntity = flagCodeFor(source, geo.meta[source]?.iso2)
      if (viaEntity) return viaEntity
      /*
       * An assignment naming artwork directly, rather than another entity.
       *
       * On the world map an override is always a country id and resolves above, exactly
       * as it always did. But a state has no flag of its own and no other state has one
       * to lend it, so on an atlas like that the assignment names the artwork itself —
       * `de`, `x-rome` — and this is where that is honoured. Checked against the flag
       * library rather than assumed, so an id that means nothing stays meaning nothing.
       */
      const code = source.toLowerCase()
      return hasFlag(code) ? code : undefined
    },
    [geo, doc.flags.overrides],
  )

  const dominationId = doc.flags.worldDomination ? doc.flags.dominationCountryId : null
  const dominationCode = useMemo(() => {
    if (!dominationId || !geo) return null
    return flagCodeFor(dominationId, geo.meta[dominationId]?.iso2) ?? null
  }, [dominationId, geo])

  /** Framing geometry, cached per dataset — no camera input, so no recompute. */
  /**
   * Whether the flag geometry should be kept ready.
   *
   * Latched on the first time the mode is used, and never cleared. Gating the geometry
   * on `flagsOn` itself was what made the toggle expensive in both directions: turning
   * the mode off replaced every input with null, so turning it back on presented React
   * with changed dependencies and every memo below rebuilt from scratch — the full cost
   * paid again on each toggle rather than once. Latching lets the memos see unchanged
   * inputs, so a toggle after the first does no geometric work at all and only changes
   * what is rendered. A user who never opens the mode still pays nothing.
   */
  const [flagsPrepared, setFlagsPrepared] = useState(false)
  useEffect(() => {
    if (flagsOn) setFlagsPrepared(true)
  }, [flagsOn])
  const prepareFlags = flagsOn || flagsPrepared

  /**
   * Warms the parts of the flag geometry that do not depend on the camera.
   *
   * Clustering every country's coastlines is the single most expensive step here and it
   * is decided entirely by the dataset — the same answer for every projection, zoom and
   * region — so it has no business running when a user flips a switch. Doing it while the
   * browser is idle moves roughly a second off the toggle without doing any more work
   * overall, and a user who never opens the mode is never blocked by it, because idle
   * work yields to anything real.
   */
  useEffect(() => {
    if (!geo) return
    let cancelled = false
    const warm = () => {
      if (cancelled) return
      flagFootprints(geo)
      flagTerritories(geo)
    }
    const idle = (window as unknown as { requestIdleCallback?: typeof setTimeout })
      .requestIdleCallback
    const handle = idle ? idle(warm, { timeout: 3000 } as never) : window.setTimeout(warm, 400)
    return () => {
      cancelled = true
      const cancelIdle = (window as unknown as { cancelIdleCallback?: (h: number) => void })
        .cancelIdleCallback
      if (idle && cancelIdle) cancelIdle(handle as unknown as number)
      else window.clearTimeout(handle as unknown as number)
    }
  }, [geo])

  const footprints = useMemo(
    () => (prepareFlags && geo ? flagFootprints(geo) : null),
    [prepareFlags, geo],
  )

  /** Detached territories that carry a flag of their own — Alaska, French Guiana. */
  const territories = useMemo(
    () => (prepareFlags && geo ? flagTerritories(geo) : undefined),
    [prepareFlags, geo],
  )

  /**
   * Projected framing rectangles for the flag patterns.
   *
   * Memoised on the footprints, the projection and the scope alone. Hover, selection,
   * theme and pointer movement do not appear, so none of them recomputes anything —
   * and neither does zoom or pan, because the tiles live in the same user space as the
   * country paths and the camera transform carries both.
   */
  const flagTiles = useMemo(() => {
    if (!footprints || !geo || !projection) return []
    const featureById = (id: string) => geo.byId.get(id)
    if (insets.length === 0) {
      return buildFlagTiles(footprints, projection, flagCodeOf, featureById, territories)
    }

    /*
     * A tile per projection, because a flag pattern is placed in the space its country
     * is drawn in. Splitting the footprints and running the same builder over each group
     * is what lets an inset state fly a flag correctly rather than having artwork framed
     * over where the state would have been on the main map.
     */
    const mainPrints = new Map<string, MultiPolygon>()
    const grouped = insets.map((resolved) => ({
      resolved,
      prints: new Map<string, MultiPolygon>(),
    }))
    for (const [id, geometry] of footprints) {
      const hit = grouped.find((entry) => entry.resolved.members.has(id))
      ;(hit ? hit.prints : mainPrints).set(id, geometry)
    }

    return [
      ...buildFlagTiles(mainPrints, projection, flagCodeOf, featureById, territories),
      ...grouped.flatMap((entry) =>
        buildFlagTiles(entry.prints, entry.resolved.projection, flagCodeOf, featureById),
      ),
    ]
  }, [footprints, geo, projection, territories, flagCodeOf, insets])

  /**
   * Maritime territory, projected once per projection.
   *
   * Only in flags mode: it is painted with flag patterns, so without them there is
   * nothing to paint it with.
   */
  /**
   * The flags actually worth painting, on a screen that cannot afford all of them.
   *
   * Every flag is an SVG *document*, and the browser parses it in full whatever size it
   * ends up drawn at: Serbia's coat of arms is 181 KB of paths whether it covers a
   * quarter of the screen or four pixels. On a desktop that is fine. On a phone at world
   * zoom the median country is **5 pixels across** and three quarters of them are under
   * twelve, so the tab was asked to hold 265 parsed SVG documents in order to paint a
   * field of dots — and the renderer's memory is not the JS heap, which is why this
   * showed up as the tab being killed and restored rather than as an error.
   *
   * So on a compact viewport a flag is skipped while the entity it belongs to is too
   * small to show one. Nothing is lost that could have been seen: below this size a flag
   * is a smudge of average colour, and the entity keeps its ordinary land fill until it
   * is big enough to wear one.
   *
   * **Desktop is not filtered at all** — same array, same identity, same work as before.
   *
   * The threshold is checked against a *stepped* zoom rather than the live one, so the
   * set changes at doublings instead of on every frame of a pinch. Zooming in brings the
   * smaller flags in a few at a time, which is the behaviour anyone would expect and
   * costs one cheap filter per step rather than a rebuild.
   */
  const compactViewport = Math.min(width, height) < 480
  const flagZoomStep = useMemo(
    () => (zoomK > 0 ? Math.pow(2, Math.round(Math.log2(zoomK))) : 1),
    [zoomK],
  )

  const visibleFlagTiles = useMemo(() => {
    if (!compactViewport) return flagTiles
    return flagTiles.filter(
      (tile) => Math.max(tile.width, tile.height) * flagZoomStep >= COMPACT_FLAG_MIN_PX,
    )
  }, [compactViewport, flagTiles, flagZoomStep])

  /** Ids that still have a pattern, so nothing can reference one that was skipped. */
  const flaggedIds = useMemo(() => new Set(visibleFlagTiles.map((t) => t.id)), [visibleFlagTiles])

  const maritimeCodes = useMemo(
    // A tile exists exactly when the map draws the entity and has a pattern for it.
    () => new Map(visibleFlagTiles.map((tile) => [tile.id, tile.iso2])),
    [visibleFlagTiles],
  )

  /**
   * Which territories get water, decided in geographic space and independent of the
   * camera — so zooming and panning never revisit it.
   */
  const islandZones = useMemo(() => {
    if (!prepareFlags || !maritime || !geo) return new Map<string, MultiPolygon>()
    return selectIslandZones(
      maritime.zones,
      (id) => geo.byId.get(id),
      (id) => maritimeCodes.has(id),
    )
  }, [prepareFlags, maritime, geo, maritimeCodes])

  /**
   * A flag placement per merged body, fitted by the same rules a country's flag is.
   *
   * `fitFlag` frames artwork over a cluster of land, and a merged body is a cluster of
   * land — so a merge gets the mode's real fitting, cover policy and all, rather than a
   * second flag system that would drift from the first.
   */
  const mergedFlagTiles = useMemo(() => {
    if (!flagsOn || !projection || !geo) return []
    const path = geoPath(projection)
    return mergePaint
      .map((entity) => {
        if (!entity.flag) return null
        const geometry = mergeCountries(geo, entity.members)
        if (!geometry) return null
        const fit = fitFlag(geometry, path, projection)
        return fit ? { id: entity.id, iso2: entity.flag, fit } : null
      })
      .filter((t): t is NonNullable<typeof t> => t !== null)
  }, [flagsOn, projection, geo, mergePaint])

  const maritimeShapes = useMemo(
    () => buildMaritimeShapes(islandZones, projection, (id) => maritimeCodes.get(id)),
    [islandZones, projection, maritimeCodes],
  )

  /**
   * Islands of scattered countries, for the rendering floor. Memoised on the same
   * inputs as the tiles, so zooming re-reads them and recomputes nothing.
   */
  const flagIslands = useMemo(() => {
    if (!footprints || !geo || !projection) return []
    return buildFlagIslands(
      footprints,
      projection,
      flagCodeOf,
      (id) => geo.byId.get(id),
    )
  }, [footprints, geo, projection, flagCodeOf])

  /**
   * Islands, restricted to entities that still have a pattern.
   *
   * The island layer paints from its country's own pattern — `url(#map-flag-XX)` — so an
   * island whose country was skipped above would reference a paint server that does not
   * exist, and SVG renders that as nothing at all. Filtering by the same set keeps the
   * two in step: an island appears exactly when its country's flag does.
   *
   * Untouched off a compact viewport, where nothing is skipped and the set is everything.
   */
  const visibleFlagIslands = useMemo(
    () => (compactViewport ? flagIslands.filter((i) => flaggedIds.has(i.countryId)) : flagIslands),
    [compactViewport, flagIslands, flaggedIds],
  )

  /**
   * The projected extent of everything the mode draws, which is what one world flag has
   * to cover.
   *
   * Taken from the tiles rather than from the sphere, so it follows the region actually
   * on the map: a map of Europe gets a flag framed to Europe rather than a crop of one
   * framed to a globe that is mostly off screen. In projected user space like the tiles
   * themselves, so the camera carries it and zoom and pan recompute nothing.
   */
  const worldFlagBounds = useMemo(() => {
    if (!dominationCode || visibleFlagTiles.length === 0) return null
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const tile of visibleFlagTiles) {
      const boxes = [tile, ...tile.territories]
      for (const box of boxes) {
        if (!Number.isFinite(box.x) || !Number.isFinite(box.y)) continue
        x0 = Math.min(x0, box.x)
        y0 = Math.min(y0, box.y)
        x1 = Math.max(x1, box.x + box.width)
        y1 = Math.max(y1, box.y + box.height)
      }
    }
    return Number.isFinite(x0) && x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : null
  }, [dominationCode, visibleFlagTiles])

  /** Tiles by country, so a country's border can be sized against its own land. */
  const flagTileById = useMemo(() => {
    const map = new Map<string, (typeof visibleFlagTiles)[number]>()
    for (const tile of visibleFlagTiles) map.set(tile.id, tile)
    return map
  }, [visibleFlagTiles])

  /**
   * Which countries have a pattern to point their fill at.
   *
   * Empty unless the mode is on. The tiles above deliberately outlive the mode so a
   * toggle costs no geometry, but a *fill* must not: leaving these in place kept every
   * country pointing at `url(#map-flag-XX)` after the patterns had unmounted, along with
   * the flags-mode border, so the map carried dangling paint references and the wrong
   * outline whenever flags were off. Checking the mode here is free — it rebuilds a map
   * of strings, never any geometry.
   */
  const loadedFlags = useFlagStore((s) => s.flags)

  /**
   * The one fill every shape uses while the world is dominated, or null.
   *
   * Null until the artwork has actually arrived, so the map keeps its land colour for a
   * moment rather than flashing an empty fill — the same rule the per-country patterns
   * follow.
   */
  const worldFlagFill =
    dominationCode && worldFlagBounds && loadedFlags[dominationCode]
      ? `url(#${WORLD_FLAG_PATTERN_ID})`
      : null

  const flagFillById = useMemo(() => {
    const map = new Map<string, string>()
    if (!flagsOn) return map
    for (const tile of visibleFlagTiles) {
      /*
       * Under domination every country points at the single world pattern, so the flag
       * runs continuously across the borders instead of repeating whole inside each one.
       */
      if (worldFlagFill) map.set(tile.id, worldFlagFill)
      else if (loadedFlags[tile.iso2]) map.set(tile.id, `url(#${flagPatternId(tile.id)})`)
    }
    return map
  }, [flagsOn, visibleFlagTiles, loadedFlags, worldFlagFill])

  /**
   * Fetches artwork for whatever is on screen, once per code, ever.
   *
   * One file while the world is dominated instead of two hundred and fifty: the tiles
   * are still built for every country, but only one of them is being painted.
   */
  const requestFlags = useFlagStore((s) => s.request)
  useEffect(() => {
    if (dominationCode) requestFlags([dominationCode])
    else if (visibleFlagTiles.length) requestFlags(visibleFlagTiles.map((tile) => tile.iso2))
  }, [dominationCode, visibleFlagTiles, requestFlags])

  /** Which merged bodies have artwork ready, and the pattern each one points at. */
  const mergedFlagFillById = useMemo(() => {
    const map = new Map<string, string>()
    if (!flagsOn) return map
    for (const tile of mergedFlagTiles) {
      if (loadedFlags[tile.iso2]) map.set(tile.id, `url(#map-flag-merge-${tile.id})`)
    }
    return map
  }, [flagsOn, mergedFlagTiles, loadedFlags])

  /* A merged body's chosen flag, which no country asks for. */
  const mergeFlagCodes = useMemo(
    () => mergePaint.map((m) => m.flag).filter((c): c is string => !!c),
    [mergePaint],
  )
  useEffect(() => {
    if (mergeFlagCodes.length) requestFlags(mergeFlagCodes)
  }, [mergeFlagCodes, requestFlags])

  const fillContext = useMemo(() => {
    const palette = doc.palettes.find((p) => p.id === doc.activePaletteId)
    return {
      layer,
      palette,
      preset: getPreset(doc.activePresetId),
      domain: layer ? computeDomain(doc.countries, layer.dataKey) : null,
      categories: layer ? computeCategories(doc.countries, layer.dataKey) : [],
      comparison: buildComparisonContext(doc.comparison),
      flags: flagsOn,
      style,
    }
  }, [
    flagsOn,
    doc.palettes,
    doc.activePaletteId,
    doc.activePresetId,
    doc.countries,
    doc.comparison,
    layer,
    style,
  ])

  /* ------------------------------------------------------------------ zoom */

  useEffect(() => {
    const svg = svgRef.current
    if (!svg || width < 2 || height < 2) return

    const behavior = zoom<SVGSVGElement, unknown>()
      /*
       * d3's own filter, plus one clause: a gesture that starts on the legend belongs
       * to the legend. Done here rather than by stopping propagation in the legend's
       * handler because d3 listens natively on the `<svg>` while React's handlers are
       * delegated from the root — the pan would already have started by the time a
       * React `stopPropagation` ran.
       */
      .filter((event) => {
        if (event.ctrlKey || event.button) return false
        const target = event.target as Element | null
        return !target?.closest?.(`[${LEGEND_MARKER}]`)
      })
      .scaleExtent(ZOOM_RANGE)
      .extent([
        [0, 0],
        [width, height],
      ])
      .translateExtent([
        [0, 0],
        [width, height],
      ])
      .on('zoom', (event) => {
        const t = event.transform
        setTransform({ k: t.k, x: t.x, y: t.y })
      })

    zoomRef.current = behavior
    const selection = select(svg)
    selection.call(behavior)
    selection.on('dblclick.zoom', null)

    return () => {
      selection.on('.zoom', null)
      zoomRef.current = null
    }
  }, [width, height, setTransform])

  // A new framing means a new composition — start it at its fitted extent.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg || !zoomRef.current) return
    select(svg).call(zoomRef.current.transform, zoomIdentity)
  }, [framingEpoch])

  const zoomBy = (factor: number) => {
    const svg = svgRef.current
    if (!svg || !zoomRef.current) return
    select(svg).call(zoomRef.current.scaleBy, factor)
  }

  const resetZoom = () => {
    const svg = svgRef.current
    if (!svg || !zoomRef.current) return
    select(svg).call(zoomRef.current.transform, zoomIdentity)
  }

  /* ---------------------------------------------------------------- render */

  const selected = useMemo(() => new Set(selectedCountryIds), [selectedCountryIds])
  const hoveredName = hoveredCountryId ? geo?.byId.get(hoveredCountryId)?.properties.name : null

  return (
    <div className="map-canvas" ref={containerRef}>
      <svg
        id={MAP_SVG_ID}
        ref={svgRef}
        className="map-canvas__svg"
        width={width || 1}
        height={height || 1}
        viewBox={`0 0 ${width || 1} ${height || 1}`}
        /*
         * The composition frame, published for the exporter. On the element it already
         * receives, so no export path has to learn a new argument to be cropped.
         */
        data-screen-x={screen.x}
        data-screen-y={screen.y}
        data-screen-width={screen.width}
        data-screen-height={screen.height}
        onMouseLeave={() => setHovered(null)}
        onMouseMove={(event) => setHovered(pickCountryAt(event))}
        onClick={(event) => {
          // Dragging the legend is not a statement about the selection, so a click
          // that starts and ends on it leaves the selection exactly as it was.
          if ((event.target as Element | null)?.closest?.(`[${LEGEND_MARKER}]`)) return
          /*
           * Every click toggles. No modifier is consulted, because a phone has none —
           * see `selectCountry`. Shift-clicking still works; it simply is not required,
           * and does the same thing a plain click does.
           *
           * A click that hits no entity clears the selection, which is the same gesture
           * on both devices and the only one that needs to exist for "start over".
           */
          const id = pickCountryAt(event)
          selectCountry(id)
          if (id) playSfx('tick')
        }}
      >
        {/*
          Flag paint servers. Definitions only — nothing here is rendered on its own;
          each one is referenced by the `fill` of the country it belongs to.
        */}
        {/*
          Paint servers for merged bodies, built exactly like a country's: the same
          `patternGeometry`, so the artwork is declared at its natural size and placed by
          transform — see the note in `MapFlags` for why that matters at small sizes.
        */}
        {flagsOn && mergedFlagTiles.length > 0 && (
          <defs>
            {mergedFlagTiles.flatMap((tile) => {
              const href = loadedFlags[tile.iso2]
              if (!href) return []
              const geometry = patternGeometry(tile.fit)
              if (!geometry) return []
              return [
                <pattern
                  key={tile.id}
                  id={`map-flag-merge-${tile.id}`}
                  patternUnits="userSpaceOnUse"
                  x={0}
                  y={0}
                  width={geometry.width}
                  height={geometry.height}
                  patternTransform={geometry.transform}
                >
                  <image
                    href={href}
                    x={geometry.imageX}
                    y={geometry.imageY}
                    width={geometry.imageWidth}
                    height={geometry.imageHeight}
                    preserveAspectRatio="none"
                  />
                </pattern>,
              ]
            })}
          </defs>
        )}

        {flagsOn &&
          (dominationCode ? (
            <WorldFlagPattern iso2={dominationCode} bounds={worldFlagBounds} />
          ) : (
            <FlagPatterns tiles={visibleFlagTiles} />
          ))}

        {/*
          One clip per inset: the frame it is drawn inside.

          In base viewport coordinates and referenced from inside the zoomed group, so
          the frame pans and scales with the map rather than staying pinned to the
          window. Geography reaching past it — the Aleutians, the northwestern Hawaiian
          chain — is still drawn from its real coordinates and simply falls outside,
          exactly as it does on a printed atlas.
        */}
        {insets.length > 0 && (
          <defs>
            {insets.map(({ inset, clip }) => (
              <clipPath key={inset.id} id={`map-inset-${inset.id}`}>
                <rect x={clip.x} y={clip.y} width={clip.width} height={clip.height} />
              </clipPath>
            ))}
          </defs>
        )}
        <rect
          x={0}
          y={0}
          width={width || 1}
          height={height || 1}
          fill={style.background}
        />
        <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
          {/*
            Outline hierarchy, heaviest first.

            The globe's edge is the strongest line on the map because it is the only
            one that is not a political claim — it bounds the world itself — so it
            carries more weight than any border. The graticule is the lightest: it is
            a reference grid, and a grid that competes with coastlines is a grid that
            has to be read around. Country boundaries sit between the two.

            Coastline is deliberately *not* a fourth level. Telling a coast from an
            inland border needs shared-edge topology, and these are independent closed
            polygons — the only way to fake the distinction would be to invent it.
          */}
          {style.showSphere && backdrop.sphere && (
            <path
              d={backdrop.sphere}
              fill="none"
              stroke={style.graticule}
              strokeWidth={1.6}
              strokeOpacity={0.95}
              vectorEffect="non-scaling-stroke"
            />
          )}
          {style.showGraticule && backdrop.graticule && (
            <path
              d={backdrop.graticule}
              fill="none"
              stroke={style.graticule}
              strokeWidth={0.5}
              strokeOpacity={0.65}
              vectorEffect="non-scaling-stroke"
            />
          )}
          {/*
            Maritime territory, under every country, and only when asked for.

            Being drawn before the land is the whole containment guarantee: a coastline
            is painted over the water afterwards, so no zone can cover anyone's land and
            the few kilometres of coastal detail lost to simplification never show.

            The switch reaches only this element. Its geometry is prepared and cached
            above regardless, on the same inputs as everything else, so turning the layer
            on and off renders differently and recomputes nothing.
          */}
          {flagsOn && doc.flags.islandWater && (
            <MapMaritime
              shapes={maritimeShapes}
              zoomK={zoomK}
              borderColor={FLAG_BORDER_COLOR}
              borderWidth={(size, k) => maritimeBorderWidth(size, style.borderWidth, k)}
              showBorders={style.showBorders}
              opacity={MARITIME_OPACITY}
              patternOverride={worldFlagFill ?? undefined}
            />
          )}

          {/*
            Archipelago halos, under every country. Being first is the whole guarantee
            that land wins: any country's coastline is painted over them simply by
            being drawn later.
          */}

          {shapes.map((shape) => {
            const inScope = scopeCountryIds.has(shape.id)
            if (!inScope && style.outsideScope === 'hidden') return null
            const entry = doc.countries[shape.id]
            if (entry?.hidden) return null

            const ctx: FillContext = {
              ...fillContext,
              inScope,
              hovered: hoveredCountryId === shape.id,
              selected: selected.has(shape.id),
              landTint: landTintById?.get(shape.id) ?? null,
            }

            /*
             * The border is chosen from the fill it is drawn over, so a country at
             * the dark end of a ramp gets the pale tone and one at the light end gets
             * the ink. One stroke, never two: a casing pass would mean a second copy
             * of every country's path data, doubling the scene and the exported SVG
             * to buy contrast this already has.
             *
             * The author's chosen border wins outright; the two-tone fallback is scoped
             * to countries coloured by a data *scale*, which is the case it exists for.
             * See `resolveBorderInk`.
             */
            const fill = resolveCountryFill(entry, ctx, shape.id)
            const borderInk = resolveBorderInk(entry, ctx, shape.id)
            /*
             * In flags mode the country is painted with its own flag, as the fill of
             * this very path — so the artwork is clipped to the real geometry, covers
             * every island, and costs no extra element. Selection still paints over
             * it, because a selected country has to read as selected.
             */
            const flagFill = ctx.selected ? undefined : flagFillById.get(shape.id)
            const paint = flagFill ?? fill

            return (
              <path
                key={shape.id}
                d={shape.d}
                fill={paint}
                /*
                 * Out-of-scope land is drawn muted, and that distinction has to
                 * survive here — but by dimming the flag rather than withholding it.
                 * Withholding was the old behaviour and it meant a map of Europe drew
                 * Algeria's geography with no flag at all, which reads as the mode
                 * being broken rather than as the country being outside the subject.
                 */
                fillOpacity={
                  flagFill && !inScope && style.outsideScope === 'muted' ? 0.4 : undefined
                }
                /*
                 * The border tone is chosen against the land, not against `paint`: a
                 * pattern reference is not a colour, and a flag is many colours at
                 * once, so there is nothing to measure. The land is what the boundary
                 * has to separate the country from at its coast.
                 */
                /*
                 * This one stroke is the coastline *and* the shared borders — where two
                 * countries meet, each path draws its half of the same line. So hiding
                 * coastlines means not stroking the paths at all, and the boundaries
                 * that were riding along with them are drawn from their own network
                 * further down instead.
                 */
                stroke={
                  !style.showBorders || !style.showCoastlines
                    ? 'none'
                    : flagFill
                      ? FLAG_BORDER_COLOR
                      : borderInk
                }
                /*
                 * In flags mode the stroke is painted *under* the fill.
                 *
                 * A border is centred on the outline, so half of it lies inside the
                 * country — and for anything close to the border's own width that is
                 * the whole country. Hong Kong is 1.3 px across at world zoom against a
                 * 0.8 px border: every pixel of it came out border-coloured, and the
                 * flag underneath was invisible. That reads as "this country has no
                 * flag", and it is why so many island states appeared to be missing
                 * one. Painting the stroke first lets the fill cover its inner half, so
                 * the flag always survives and the boundary keeps its outer edge.
                 */
                paintOrder={flagFill ? 'stroke' : undefined}
                strokeWidth={
                  !style.showBorders || !style.showCoastlines
                    ? 0
                    : flagFill
                      ? flagBorderWidth(flagTileById.get(shape.id), style.borderWidth, zoomK)
                      : style.borderWidth
                }
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                className="map-canvas__country"
                data-country-id={shape.id}
                transform={minimumSizeById.get(shape.id)}
                /*
                 * Set only for an entity an inset draws. `undefined` renders no
                 * attribute at all, so every path on a map without insets — which is
                 * every world map — is byte-for-byte what it always was.
                 */
                clipPath={shape.clipId ? `url(#map-inset-${shape.clipId})` : undefined}
              />
            )
          })}

          {/*
            Merged bodies.

            One path for the whole dissolved entity, drawn where its members would have
            been — so the borders between them are not hidden, they do not exist in this
            geometry. Everything else about it is an ordinary country path: same border
            treatment, same paint order, same clickability.
          */}
          {mergedShapes.map((shape) => {
            /*
             * A merged body resolves its paint through exactly the same functions a
             * country does, with its own id and its own entry in `doc.countries`.
             *
             * That is the whole of the integration: the palette, the threshold bands,
             * the hover and the selection highlight are not re-implemented here, they
             * simply apply — because what they take is an entity id and a value, and a
             * merge has both. Anything added to that pipeline later reaches merges
             * without knowing they exist.
             */
            const ctx: FillContext = {
              ...fillContext,
              inScope: true,
              hovered: hoveredCountryId === shape.id,
              selected: selected.has(shape.id),
              landTint: null,
            }
            const entry = doc.countries[shape.id]
            const fill = resolveCountryFill(entry, ctx, shape.id)
            const flagFill = ctx.selected ? undefined : mergedFlagFillById.get(shape.id)
            const borderInk = resolveBorderInk(entry, ctx, shape.id)
            return (
              <path
                key={shape.id}
                d={shape.d}
                fill={flagFill ?? fill}
                stroke={
                  !style.showBorders || !style.showCoastlines
                    ? 'none'
                    : flagFill
                      ? FLAG_BORDER_COLOR
                      : borderInk
                }
                strokeWidth={!style.showBorders || !style.showCoastlines ? 0 : style.borderWidth}
                paintOrder={flagFill ? 'stroke' : undefined}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                className="map-canvas__country"
                /*
                 * The same attribute a country carries, because the picker resolves an
                 * entity id from the DOM and a merge is an entity. `data-merge-id` stays
                 * alongside it for anything that needs to tell the two apart.
                 */
                data-country-id={shape.id}
                data-merge-id={shape.id}
                clipPath={shape.clipId ? `url(#map-inset-${shape.clipId})` : undefined}
              />
            )
          })}

          {/*
            Islands of scattered countries, held at a minimum drawn size.

            Before the territories and the lakes, and after the country paths, so a
            floored island is drawn over the country's own rendering of it.
          */}
          {flagsOn && (
            <FlagIslands
              islands={visibleFlagIslands}
              zoomK={zoomK}
              floorPx={MIN_RENDERED_SIZE_PX}
              borderColor={FLAG_BORDER_COLOR}
              borderWidth={Math.min(style.borderWidth, 0.6)}
              showBorders={style.showBorders}
              patternOverride={worldFlagFill ?? undefined}
            />
          )}

          {/*
            Second flags, over the territories that earned one.

            After the country paths, so a territory's own framing replaces the repeat of
            the mainland's that would otherwise land there, and before the lakes and the
            selection outline, so neither is covered.
          */}
          {/*
            Not drawn while the world is dominated. This layer exists to give a detached
            territory its *own* framing of its country's flag; with one flag already
            spanning the world, Alaska is covered by the same continuous design as the
            rest of it, and a second copy framed to Alaska alone is exactly the repeated
            per-country rendering the single pattern is there to avoid.
          */}
          {flagsOn && !worldFlagFill && (
            <FlagTerritories
              tiles={visibleFlagTiles}
              shapeById={shapeById}
              borderColor={FLAG_BORDER_COLOR}
              borderWidth={(tile) => flagBorderWidth(tile, style.borderWidth, zoomK)}
              showBorders={style.showBorders}
            />
          )}

          {/*
            International boundaries, over the flags they separate — when asked for.

            Off by default, and switched off the layer is not rendered at all rather than
            hidden or made transparent: nothing is added to the scene, so the mode looks
            exactly as it did before the treatment existed. The network is still derived
            and projected either way, so the switch costs a render and nothing more.

            Only where two different countries actually touch. The network comes from the
            dataset's topology, where a shared border is one arc referenced by both
            neighbours, so a coastline — which has the same country on both sides — is not
            in it at all. Nothing here outlines a country's exterior, an island, or a
            coast; a country that meets only water keeps exactly the border it had.

            Two strokes on one path, pale beneath and black over it, which leaves the pale
            showing as an edge either side of the black: flag | white | black | white |
            flag. Drawn after the fills so both edges survive, and before the lakes and
            the selection so neither is covered.

            Butt caps, not round. The network has 376 free arc ends — most of them where a
            border runs out at the coast — and a round cap puts a half-disc of the pale
            stroke *past* each one, which is a white blob sitting on the coastline and on
            every junction, plus four two-point arcs rendering as nothing but their own
            caps. Ending the line exactly where the border ends removes all of it.
          */}
          {/*
            Borders without coastlines.

            Only drawn when the coastline switch is off, because with it on the country
            paths have already drawn these lines as part of their own outline and a
            second copy would double their weight. The network is the shared arcs alone
            — `mesh` kept only those whose two sides resolve to different countries — so
            what appears here is exactly what the coast took away and nothing more.

            One line for a border rather than the two halves the paths drew, which is
            also why it needs no per-country colour: a shared boundary belongs to both
            of its countries equally.
          */}
          {style.showBorders && !style.showCoastlines && backdrop.borders && (
            <path
              d={backdrop.borders}
              fill="none"
              stroke={flagsOn ? FLAG_BORDER_COLOR : style.border}
              strokeWidth={flagsOn ? boundaryInkWidth(style.borderWidth, zoomK) : style.borderWidth}
              strokeLinejoin="round"
              strokeLinecap="butt"
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          )}

          {flagsOn && doc.flags.internationalBorders && style.showBorders && backdrop.borders && (
            <>
              <path
                d={backdrop.borders}
                fill="none"
                stroke={FLAG_BOUNDARY_EDGE}
                strokeWidth={boundaryEdgeWidth(style.borderWidth, zoomK)}
                strokeLinejoin="round"
                strokeLinecap="butt"
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
              <path
                d={backdrop.borders}
                fill="none"
                stroke={FLAG_BOUNDARY_INK}
                strokeWidth={boundaryInkWidth(style.borderWidth, zoomK)}
                strokeLinejoin="round"
                strokeLinecap="butt"
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
            </>
          )}

          {/*
            Inland water, over the land it sits in.

            Pointer events stay enabled so a lake behaves like water rather than like
            the country underneath: hovering or clicking one does not pick a country.
            It carries no `data-country-id`, so `pickCountryAt` finds nothing on it and
            falls through — which still lets a microstate's assist zone win over a lake.
          */}
          {style.showLakes && lakePath && (
            <path
              d={lakePath}
              fill={style.lake}
              stroke={style.lakeOutline}
              strokeWidth={0.5}
              vectorEffect="non-scaling-stroke"
            />
          )}

          {/*
            Selection, drawn as an outline rather than as a fill.

            The fill belongs to the data — a selected country keeps whatever colour its
            value earned it, so assigning to one batch never blanks the batch before it.
            That leaves the outline to carry the whole signal, and one colour cannot do
            it: a palette runs from near-black to near-white, and a line chosen to read
            against one end disappears against the other. So the casing is picked from
            the fill it lands on and the theme's own outline colour rides on top of it.
          */}
          {selectedCountryIds.map((id) => {
            const d = shapeById.get(id)
            if (!d) return null
            const entry = doc.countries[id]
            if (entry?.hidden) return null

            const under =
              resolveDataFill(
                entry,
                {
                  ...fillContext,
                  inScope: scopeCountryIds.has(id),
                  hovered: false,
                  selected: true,
                  landTint: landTintById?.get(id) ?? null,
                },
                id,
              ) ??
              landTintById?.get(id) ??
              style.land

            return (
              <g key={`outline-${id}`} pointerEvents="none">
                <path
                  d={d}
                  fill="none"
                  stroke={contrastInk(under)}
                  strokeWidth={3.4}
                  strokeOpacity={0.85}
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                  transform={minimumSizeById.get(id)}
                />
                <path
                  d={d}
                  fill="none"
                  stroke={style.selectedOutline}
                  strokeWidth={1.4}
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                  transform={minimumSizeById.get(id)}
                />
              </g>
            )
          })}

          {/*
            The names, over everything the map draws.

            Last inside the transformed group, so a name is never covered by a flag, a
            border, a lake or a selection outline — and still inside it, so the camera
            moves the names with the land they belong to.
          */}
          {labelsOn && (
            <MapLabels
              placements={labelPlacements}
              labels={labels}
              zoomStep={labelZoomStep}
            />
          )}
        </g>

        {/*
          Magnifiers for selected small entities.
          
          Drawn outside the zoomed group, in screen space, but anchored to the
          feature's projected representative point — so it tracks pan, zoom,
          projection and region changes while keeping a constant, legible size.
          The lens shows the feature's OWN projected outline scaled up: the same
          path data the map draws, never a stand-in symbol, and never a change to
          the geometry itself.
        */}
        {smallAnchors.map((anchor) => {
          if (!selected.has(anchor.id)) return null
          const d = shapeById.get(anchor.id)
          if (!d) return null

          const [sx, sy] = anchorScreenPosition(anchor, transform)
          const radius = SMALL_ENTITY_LENS_RADIUS_PX
          const lensX = Math.min(
            Math.max(sx + SMALL_ENTITY_LENS_OFFSET_PX.x, radius + 2),
            Math.max(radius + 2, (width || 1) - radius - 2),
          )
          const lensY = Math.min(
            Math.max(sy + SMALL_ENTITY_LENS_OFFSET_PX.y, radius + 2),
            Math.max(radius + 2, (height || 1) - radius - 2),
          )
          const clipId = `map-lens-${anchor.id}`

          return (
            <g key={`lens-${anchor.id}`} pointerEvents="none">
              <defs>
                <clipPath id={clipId}>
                  <circle cx={lensX} cy={lensY} r={radius - 2} />
                </clipPath>
              </defs>
              {/* tether back to where the country actually is */}
              <line
                x1={sx}
                y1={sy}
                x2={lensX}
                y2={lensY}
                stroke={style.selectedOutline}
                strokeWidth={1.2}
                opacity={0.8}
              />
              <circle cx={sx} cy={sy} r={2.5} fill={style.selectedOutline} />
              <circle
                cx={lensX}
                cy={lensY}
                r={radius}
                fill={style.background}
                stroke={style.selectedOutline}
                strokeWidth={2}
              />
              <g clipPath={`url(#${clipId})`}>
                <g
                  transform={`translate(${lensX},${lensY}) scale(${anchor.magnification}) translate(${-anchor.lensCenterX},${-anchor.lensCenterY})`}
                >
                  {/*
                    The lens paints the same path with the same fill, so in flags mode
                    it shows the country's flag clipped to its outline, magnified —
                    no second placement pass and no special case, because the pattern
                    is defined in the projected space this group is magnifying.
                  */}
                  <path
                    d={d}
                    fill={flagFillById.get(anchor.id) ?? style.selected}
                    stroke={style.selectedOutline}
                    strokeWidth={1.2}
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              </g>
            </g>
          )
        })}
        {/*
          The legend, in screen space and drawn last so nothing covers it. Inside the
          `<svg>` deliberately: the exporter copies this element, so a legend rendered
          as an HTML overlay would be absent from every PNG, JPG and SVG.
        */}
        <MapLegend doc={doc} width={width} height={height} />
      </svg>

      {/*
        The composition frame. HTML rather than SVG, and a sibling of the map rather
        than a child of it, so it cannot reach the export — see `MapScreen`.
      */}
      <MapScreen
        screen={screen}
        width={width}
        height={height}
        active={screenOn && doc.screen.rect !== null}
        aspect={doc.screen.aspect}
        containerRef={containerRef}
      />

      <div className="map-canvas__controls">
        <button type="button" onClick={() => zoomBy(1.5)} title="Zoom in">+</button>
        <button type="button" onClick={() => zoomBy(1 / 1.5)} title="Zoom out">−</button>
        <button type="button" onClick={resetZoom} title="Fit to region">⌖</button>
      </div>

      {hoveredName && (
        <div className="map-canvas__hover-label">
          <span className="map-canvas__hover-code">{hoveredCountryId}</span>
          {hoveredName}
        </div>
      )}

      {geoStatus !== 'ready' && (
        <div className="map-canvas__status">
          {geoStatus === 'error' ? `Failed to load geography: ${geoError}` : 'Loading geography…'}
        </div>
      )}
    </div>
  )
}
