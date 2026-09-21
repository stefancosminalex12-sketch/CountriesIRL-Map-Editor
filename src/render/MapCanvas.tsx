/**
 * The map renderer.
 *
 * SVG output driven by d3-geo. SVG is deliberate: the same path data that renders on
 * screen can be serialised for SVG export or rasterised to a fixed-size PNG (the
 * eventual 1920x1080 target) without a second rendering path, and every country is a
 * real DOM node so per-country styling and interaction stay trivial.
 */
import { Fragment, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactElement, memo } from 'react'
import { geoGraticule10, geoPath } from 'd3-geo'
import { select } from 'd3-selection'
import { zoom, zoomIdentity, zoomTransform, type ZoomBehavior } from 'd3-zoom'
import { useElementSize, type Size } from './useElementSize'
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
  resolveBorderInk,
  deriveLandTints,
  reanchorTone,
  resolveCountryFill,
  type FillContext,
} from '../state/colors'
import { MapLegend, LEGEND_MARKER } from './MapLegend'
import type { GeometryCollection, MultiLineString, MultiPolygon, Position } from 'geojson'
import { buildMaritimeShapes, MapMaritime, selectIslandZones } from './MapMaritime'
import { MapWaters, WATER_MARKER, type WaterShape } from './MapWaters'
import { setLiveLand, setLiveProjection } from './liveProjection'
import { isWaterId, waterName } from '../geo/waters'
import { dissolveTouching } from '../geo/dissolve'
import {
  buildFlagTiles,
  FLAG_BORDER_COLOR,
  flagBorderWidth,
  FLAG_BOUNDARY_EDGE,
  FLAG_BOUNDARY_INK,
  boundaryEdgeWidth,
  boundaryInkWidth,
  MARITIME_OPACITY,
  maritimeBorderWidth,
  FlagPatterns,
  flagPatternId,
  FlagTerritories,
  WorldFlagPattern,
  WORLD_FLAG_PATTERN_ID,
  fitFlag,
  patternGeometry,
} from './MapFlags'
import { flagFootprints, flagTerritories, warmEntityClusters } from './flagPlacement'
import {
  buildLabelShape,
  LABEL_LINE_BREAK,
  layoutLabels,
  MAX_MAP_ZOOM,
  visibleLabels,
  type LabelShape,
} from './labelPlacement'
import { MapLabels } from './MapLabels'
import { CountryCoast, CountryPath, MAP_SCALE_VAR, screenStrokeWidth } from './CountryPath'
import { flagCodeFor, useFlagStore } from '../flags/flagStore'
import { entityFlagCode } from '../flags/flagChoices'
import { resolveScreen } from './screenFrame'
import { mergeCountries } from '../geo/merge'
import { borderArcsWithout, bordersWithout, coastByEntity } from '../geo/datasets'
import { MapScreen } from './MapScreen'
import { MapCaption } from './MapCaption'
import { getPreset } from '../state/presets'
import { formatDataValue } from '../state/legend'
import { useMapStore } from '../state/mapStore'
import { useSettingsStore } from '../state/settingsStore'
import { getTheme } from '../theme/themes'
import {
  EMPTY_ASSIST_INDEX,
  pickAssistedCountryAt,
} from './smallEntities'
import { anchorsOf, assistOf, useProjectedLand } from './projectedLand'
import { reportDrawnTolerance, toleranceForZoom, useFullDetail } from './landDetail'
import { setMapCamera } from './mapCamera'
import { useGatedMemo } from './useGatedMemo'
import { hiddenFootprint } from './hiddenMask'
import { useSelectionGestures } from './selectionGestures'
import { usePinchZoom } from './pinchZoom'
import { MapOverlays, OVERLAY_MARKER } from './MapOverlays'
import { overlaySource, type OverlaySource } from './overlayGeometry'
import type { MapDocument, MapOverlay } from '../types/map'
import {
  outlinesAlongSegment,
  outlinesInRect,
  outlinesOf,
  prepareOutlines,
  type OutlineClip,
  type OutlineFrame,
} from './selectionGeometry'
import type { ResolvedInset } from '../maps/insets'
import { MapLenses, type FitCorrection, type Lens, type MapLensesHandle } from './MapLenses'

export const MAP_SVG_ID = 'map-canvas-svg'

interface LineNetworks {
  borders: Array<{ d: string; clipId: string | null }>
  national: Array<{ d: string; clipId: string | null }>
}

/** Above this many units the flag geometry is not warmed ahead of the flag mode. See `warm`. */
const WARM_MAX_FEATURES = 10000

/** Outlines drawn at another size than their own, for the selection tools: none. */
const NO_FRAMES: ReadonlyMap<string, OutlineFrame> = new Map()
/** No water regions, as one stable array: the layer is off, or its geometry has not arrived. */
const NO_WATER: WaterShape[] = []
/**
 * How the selection tools see the seas: every one of them drawn, none framed, none clipped.
 * A sea cannot be hidden, cannot be outside the region scope, and is never put in an inset.
 */
const ALL_WATER_DRAWN = { frames: NO_FRAMES, clips: new Map<string, OutlineClip>(), drawn: () => true }
const NO_OVERLAYS: MapOverlay[] = []


/** What a country's element was built from — see `countryLayer`. */
interface CachedCountryElement {
  d: string
  coast: string | undefined
  outlineOn: boolean
  paint: CountryPaint
  element: ReactElement
}

interface CountryPaint {
  fill: string
  fillOpacity: number | undefined
  outline: { stroke: string; strokeWidth: number; paintOrder: string | undefined }
  clipPath: string | undefined
}

/** An entity as the country layer draws it: its outline, and what it was drawn from. */
interface ShapeRef {
  id: string
  name: string
  d: string
  clipId: string | null
}

interface PaintedShape {
  shape: ShapeRef
  paint: CountryPaint | null
}

/**
 * How many entities one chunk of the country layer holds. Large enough that the chunks
 * themselves are few — 126 on the 32,159-unit USA map — and small enough that re-rendering
 * one is cheap.
 */
const COUNTRY_CHUNK = 256

/** A run of the country layer. The same array is the same chunk, passed over whole. */
const CountryChunk = memo(function CountryChunk({ elements }: { elements: ReactElement[] }) {
  return <>{elements}</>
})

/** Whether two paints draw the same thing. */
function samePaint(a: CountryPaint, b: CountryPaint): boolean {
  return (
    a.fill === b.fill &&
    a.fillOpacity === b.fillOpacity &&
    a.clipPath === b.clipPath &&
    a.outline.stroke === b.outline.stroke &&
    a.outline.strokeWidth === b.outline.strokeWidth &&
    a.outline.paintOrder === b.outline.paintOrder
  )
}

/* What a layer is while it waits — see `layersReady`. Constants, so waiting changes nothing. */
const NO_INSETS: ResolvedInset[] = []
const NO_LINE_NETWORKS: LineNetworks = { borders: [], national: [] }
const NO_COAST_PATHS: Map<string, string> = new Map()
const NO_LABEL_SHAPES: LabelShape[] = []

const ZOOM_RANGE: [number, number] = [1, MAX_MAP_ZOOM]

/**
 * How much heavier a national border is drawn than an internal one, on a map whose
 * entities are subdivisions of countries.
 *
 * Twice the width: enough for the countries to read through four and a half thousand
 * provincial lines at world zoom, without the national line swallowing the small
 * subdivisions strung along it.
 */
const NATIONAL_BORDER_SCALE = 2

/**
 * How long the viewport must hold still before the map is refitted to it.
 *
 * Short enough that a deliberate resize feels committed rather than laggy, and long
 * enough to swallow a whole gesture: a window drag, a phone rotating, a URL bar
 * collapsing. See {@link useSettledSize}.
 */
const RESIZE_SETTLE_MS = 140

/**
 * Smallest an entity may be drawn, on a compact viewport, and still be given a flag.
 *
 * Six pixels is below the size at which a flag reads as anything but a coloured dot, so
 * the cutoff costs nothing that could have been seen while removing the SVG parse
 * behind it. See `visibleFlagTiles`.
 */
const COMPACT_FLAG_MIN_PX = 14

/**
 * The most flag patterns a compact viewport may hold at once.
 *
 * The size floor above bounds how *small* a flag can be, which is not the same as
 * bounding how *many* there are: zooming in raises the floor's effect until nearly every
 * country qualifies again, and each one that does is fetched, parsed and rasterised and
 * then held for the rest of the session. Serbia's flag alone is 180 KB of paths.
 *
 * On a phone that climbs until the renderer is killed — the tab freezes, reloads itself
 * and then fails outright. So there is a ceiling as well as a floor, and the flags kept
 * are the largest ones on screen, which are the ones actually readable as flags.
 */
const COMPACT_FLAG_MAX_COUNT = 40

/**
 * Whether a layer's geometry is worth keeping ready.
 *
 * A latch, not a mirror of the switch. Gating an expensive memo on the switch itself is
 * what makes a toggle cost the same in both directions: turning the layer off replaces
 * its inputs with nothing, so turning it back on presents React with changed
 * dependencies and the whole projection is paid for again. Latched, the first use is
 * the only one that costs anything and every toggle after it merely renders
 * differently — and an author who never turns the layer on never pays for it once.
 *
 * The same reasoning the labels and the flags below have always used, extracted so the
 * layers that are *off* by default can have it too. Rivers, the graticule and the
 * boundary mesh were projected on every projection change whether or not anything drew
 * them: on the world map at 10m that is 60ms of work and 3MB of path string built for
 * a layer the default document does not show.
 */
function useLayerLatch(needed: boolean): boolean {
  /*
   * A ref, not state. As state the latch was closed from an effect, so the render that
   * first needed a layer was followed by a second, identical one whose only news was that
   * the latch had closed: a full re-render of the map for nothing, on every load that turned
   * a layer on. What a render reads is the same either way.
   */
  const latched = useRef(false)
  if (needed) latched.current = true
  return latched.current
}

/**
 * The viewport size the projection is fitted to, which lags the live one while a resize
 * is in progress.
 *
 * Refitting is the most expensive thing this canvas does. It rebuilds the projection and
 * reprojects everything through it: 254 country outlines, the lakes, the boundary mesh,
 * the flag framings, the label geometry, the assist catchments — measured at ~440ms on a
 * desktop and several times that on a phone, for roughly ten megabytes of path data.
 *
 * A `ResizeObserver` offers that bill once per frame. Dragging a window edge, opening a
 * panel, rotating a phone, or merely scrolling a phone far enough to collapse the URL bar
 * therefore asked for a full reprojection per frame of the gesture, and the browser spent
 * the whole gesture behind on it.
 *
 * So the size the *geometry* is fitted to settles, while the size the *element* is drawn
 * at stays live. Nothing waits for anything: the `<svg>` takes the new box immediately and
 * the map inside it is scaled to match — see `fitTransform` — so the resize looks
 * continuous, and exactly one reprojection happens, once the size has stopped moving.
 *
 * The first measurement commits at once. There is no map on screen yet to keep steady,
 * and delaying it would only delay first paint.
 */
function useSettledSize(live: Size): Size {
  const [settled, setSettled] = useState(live)

  useEffect(() => {
    if (live.width === settled.width && live.height === settled.height) return
    if (settled.width < 2 || settled.height < 2) {
      setSettled(live)
      return
    }
    const handle = window.setTimeout(() => setSettled(live), RESIZE_SETTLE_MS)
    return () => window.clearTimeout(handle)
  }, [live, settled])

  return settled
}

/** The selection colour over one entity, in the selection layer. See `selectionPaths`. */
const SELECTION_LAYER_STYLE: CSSProperties = { willChange: 'opacity' }

/** How long the selection layer is kept after the last entity leaves it. See `layerHeld`. */
const SELECTION_LAYER_HOLD_MS = 1500

const SelectedShape = memo(function SelectedShape({
  entityId,
  d,
  fill,
  stroke,
  strokeWidth,
  paintOrder,
  clipPath,
  coast,
}: {
  entityId: string
  d: string
  fill: string
  stroke: string
  strokeWidth: number
  paintOrder: string | undefined
  clipPath: string | undefined
  coast: string | undefined
}) {
  return (
    <>
      <path
        d={d}
        fill={fill}
        stroke={stroke}
        /* The map's own way of holding a line at its screen width — see `screenStrokeWidth`. */
        style={{ strokeWidth: screenStrokeWidth(strokeWidth) }}
        paintOrder={paintOrder}
        strokeLinejoin="round"
        clipPath={clipPath}
      />
      {/* With Coastlines on and Borders off the coast is the entity's only line: the same
          component the land layer draws it with, in the ink selection gives it. */}
      {coast !== undefined && (
        <CountryCoast
          entityId={entityId}
          d={coast}
          stroke={stroke}
          strokeWidth={strokeWidth}
          transform={undefined}
          clipPath={clipPath}
        />
      )}
    </>
  )
})

export function MapCanvas() {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null)

  const live = useElementSize(containerRef)
  const { width, height } = live

  /**
   * The size the geometry is fitted to, and the correction that hides the gap.
   *
   * `fit` lags `live` only while a resize is in flight; the rest of the time they are the
   * same object's values and `fitTransform` is `undefined`, so a settled map renders
   * byte-for-byte what it always did — no wrapper transform, no extra attribute.
   *
   * While they differ, the map is drawn at the fit it already has, scaled uniformly to
   * cover the new box and re-centred. That is the same shape of answer `buildProjection`
   * will give when it runs — a single uniform scale and a placement, never a stretch — so
   * the correction is close to the real refit and the map settles into it rather than
   * jumping to it.
   */
  const fit = useSettledSize(live)

  const doc = useMapStore((s) => s.doc)
  const geo = useMapStore((s) => s.geo)
  const lakes = useMapStore((s) => s.lakes)
  const rivers = useMapStore((s) => s.rivers)
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
  const ensureRivers = useMapStore((s) => s.ensureRivers)
  const ensureMaritime = useMapStore((s) => s.ensureMaritime)
  /* The named oceans and seas: their geometry, what is selected of it, and what is hovered. */
  const waters = useMapStore((s) => s.waters)
  const ensureWaters = useMapStore((s) => s.ensureWaters)
  const selectedWaterIds = useMapStore((s) => s.selectedWaterIds)
  const hoveredWaterId = useMapStore((s) => s.hoveredWaterId)
  const setHoveredWater = useMapStore((s) => s.setHoveredWater)
  const selectionTools = useMapStore((s) => s.selectionTools)
  const magnifierOn = useMapStore((s) => s.magnifier)
  const addToSelection = useMapStore((s) => s.addToSelection)
  const removeFromSelection = useMapStore((s) => s.removeFromSelection)
  /**
   * The zoomed group, so a gesture can move the map without re-rendering it.
   *
   * See the zoom behaviour below: during a pan or a pinch the transform is written
   * straight onto this element, and React is only told once the gesture ends.
   */
  const zoomedRef = useRef<SVGGElement>(null)
  /** The scale a gesture started at: while it is unchanged the camera is only translating. */
  const panScale = useRef(1)
  /** Set while the camera is being moved, and released a moment after it stops. */
  const navigatingRef = useRef(false)
  const navigatingTimer = useRef<number | null>(null)
  /** Whether the compositor is currently carrying the map, and whether this gesture zooms. */
  const carryingRef = useRef(false)
  const zoomingRef = useRef(false)

  /**
   * What the map does differently while the camera is being moved.
   *
   * Two things, both set straight on the DOM like the camera itself, so a gesture never goes
   * through React:
   *
   * **It stops answering the pointer.** Every pointer event over the map is hit-tested against
   * the outlines under it, and on a dense map that is the most expensive thing in a gesture —
   * 5.8 s of a two-second pinch on Europe Administrative, more than the drawing. While the
   * camera moves that answer is never used: there is no hover to show and no click to resolve.
   *
   * **The compositor may carry it, but only while the scale is unchanged.** A pan moves the
   * picture without changing it, so letting the compositor carry the layer draws every frame
   * from the same raster the main thread would have made — the same pixels, the same crisp
   * borders, at a twelfth of the cost (Europe Administrative: a pan of 12.9 s at 208 ms a frame
   * became 1.4 s at 4 ms). The moment the scale changes it is taken back and the map is drawn
   * again at the new scale, because a *scaled* raster would be a picture of the map rather than
   * the map — which is the one thing navigation here must never do.
   *
   * A wheel notch is a gesture of its own, so this is turned on by each event and released
   * shortly after the last one rather than at the end of any single one.
   */
  const navigating = useCallback((on: boolean) => {
    const group = zoomedRef.current
    if (navigatingTimer.current !== null) {
      window.clearTimeout(navigatingTimer.current)
      navigatingTimer.current = null
    }
    if (on) {
      if (navigatingRef.current || !group) return
      navigatingRef.current = true
      group.style.pointerEvents = 'none'
      return
    }
    navigatingTimer.current = window.setTimeout(() => {
      navigatingTimer.current = null
      navigatingRef.current = false
      carryingRef.current = false
      const current = zoomedRef.current
      if (!current) return
      current.style.pointerEvents = ''
      current.style.willChange = ''
    }, 120)
  }, [])

  /**
   * Hands the layer to the compositor, or takes it back.
   *
   * Asked for only once a gesture has actually moved the camera without changing its scale,
   * and dropped for the rest of a gesture as soon as the scale does change: a pinch that
   * turned this on and off at every notch spent more on making and discarding layers than it
   * saved, so once a gesture is a zoom it stays drawn the ordinary way.
   */
  const carry = useCallback((on: boolean) => {
    const group = zoomedRef.current
    if (!group) return
    if (on) {
      if (!carryingRef.current) {
        carryingRef.current = true
        group.style.willChange = 'transform'
      }
      return
    }
    carryingRef.current = false
    zoomingRef.current = true
    if (group.style.willChange) group.style.willChange = ''
  }, [])
  /** Each country's element from the last build of the layer — see `countryLayer`. */
  const countryElementCache = useRef(new Map<string, CachedCountryElement>())
  /** The chunks of the layer's last build, and the paints it was made from. */
  const countryChunkCache = useRef<ReactElement[][]>([])
  const countryPaintCache = useRef<{
    inputs: readonly unknown[]
    /** What was selected when these were painted — read only where the land carries it. */
    selected: ReadonlySet<string>
    /** The entries the paints were made from, compared entity by entity on the next pass. */
    countries: MapDocument['countries']
    paints: PaintedShape[]
  } | null>(null)
  /**
   * The magnifiers, which live in screen space outside the zoomed group — so a gesture
   * that moves the group directly has to move them directly too. See `MapLenses`.
   */
  const lensesRef = useRef<MapLensesHandle>(null)
  /**
   * Whether a pan or a pinch is in flight.
   *
   * A drag is made of `mousemove`s, and every one of them was resolving which country is
   * under the pointer and, whenever the answer changed, publishing it — a React render
   * per frame of the gesture, to repaint a hover the user is not looking for and cannot
   * see under their own finger. Hovering is a statement about where the pointer is
   * resting; while the map is being dragged it is resting nowhere.
   *
   * A ref rather than state on purpose: setting it must not itself cause a render, which
   * is the entire point.
   */
  const gesturingRef = useRef(false)
  /**
   * Set while the sidebar's grip is driving the camera.
   *
   * The grip moves the map through this very zoom behaviour, so its changes arrive with no
   * source event — which is otherwise the signature of a programmatic move, and those are
   * committed to the document as they happen. A gesture is not that: it wants the camera
   * written to the DOM once a frame and the document told once, at the end. See `mapCamera.ts`.
   */
  const gripDragRef = useRef(false)
  /** The camera a gesture has reached, waiting for the next frame — see the zoom behaviour. */
  const liveCamera = useRef<{ k: number; x: number; y: number } | null>(null)
  const cameraFrame = useRef(0)
  /** The resize correction's scale, for the strokes' screen width — see `screenStrokeWidth`. */
  const fitScaleRef = useRef(1)
  /** Puts the waiting camera on the zoomed group, and on the magnifiers that follow it. */
  const placeCamera = useCallback(() => {
    cameraFrame.current = 0
    const t = liveCamera.current
    const group = zoomedRef.current
    if (!t || !group) return
    /*
     * While the compositor is carrying the layer, the camera moves in whole device pixels.
     *
     * A layer translated by a whole pixel is copied texel for texel: every frame of the pan
     * holds the very pixels the map was drawn with, which is the only form of carrying that
     * is allowed here. Translated by part of a pixel it would be *resampled* instead — the
     * same picture smeared across a new grid, with the borders softening as it moves, which
     * is precisely the thing this map must never do. Half a pixel of the drag is held back
     * until the gesture ends and the map is drawn again at the exact camera.
     */
    const carrying = carryingRef.current
    const unit = carrying ? window.devicePixelRatio || 1 : 0
    const x = carrying ? Math.round(t.x * unit) / unit : t.x
    const y = carrying ? Math.round(t.y * unit) / unit : t.y
    group.setAttribute('transform', `translate(${x},${y}) scale(${t.k})`)
    // The lines' screen width follows the camera in the same frame; a pan leaves it as it is.
    const scale = String(t.k * fitScaleRef.current)
    if (group.style.getPropertyValue(MAP_SCALE_VAR) !== scale) group.style.setProperty(MAP_SCALE_VAR, scale)
    lensesRef.current?.follow(t)
  }, [])
  /** Held true by a Selection-panel gesture, for the same reason — see `useSelectionGestures`. */
  const selectingRef = useRef(false)
  /** Set when a brush press has already dealt with the click that follows it. */
  const suppressClickRef = useRef(false)
  /** Whether the brush is live, read by the zoom filter without rebinding the behaviour. */
  const brushArmedRef = useRef(false)
  /** The rectangle and the brush ring: over the map, outside the exported `<svg>`. */
  const selectionOverlayRef = useRef<HTMLDivElement>(null)

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

  /** The projection this view asks for. What is drawn through is `projection`, below. */
  const targetProjection = useMemo(() => {
    if (fit.width < 2 || fit.height < 2) return null
    return buildProjection({
      framing,
      projectionId: scope.projectionId,
      width: fit.width,
      height: fit.height,
      padding: scope.padding,
    })
  }, [framing, scope.projectionId, scope.padding, fit.width, fit.height])

  /**
   * The atlas's insets, resolved against this viewport and this projection.
   *
   * Geography that is drawn somewhere other than where it is: Alaska and Hawaii on a map
   * of the United States. Empty for an atlas whose geography holds together, which is
   * every case but that one so far — so the world map computes nothing here and takes
   * exactly the path it always did.
   */
  const atlas = useMemo(() => getAtlas(scope.atlasId), [scope.atlasId])
  /* In the projection's own space, so it follows the fitted size rather than the live one. */
  const targetInsets = useMemo(
    () => buildInsets(atlas, targetProjection, fit.width, fit.height, geo?.meta),
    [atlas, targetProjection, fit.width, fit.height, geo],
  )

  /**
   * The land as drawn: every entity's projected outline, with the projection and insets it
   * was drawn through. See `projectedLand.ts`.
   *
   * Everything below takes `projection` and `insets` from here rather than from the target
   * above. On the world and states maps the two are the same view in the same render, as
   * they always were — only a view already drawn earlier in the session is now recalled
   * instead of projected again. On a progressive dataset the land for a new view is
   * prepared off the render path, and until it is ready the map keeps drawing the view it
   * has, so the borders, the lakes, the names and the click targets all stay on the
   * outlines actually on screen instead of running ahead of them.
   */
  const progressive = !!geo?.dataset.progressive
  /*
   * How finely to draw: a tolerance from the camera's zoom, in steps, or every point while an
   * export is holding full detail (`landDetail.ts`). It is part of the key, so the view at one
   * detail is never handed back for another, and crossing a step reprojects in the background
   * exactly as a new region does — what is on screen stays until the finer land is ready.
   */
  const fullDetail = useFullDetail()
  /*
   * The zoom the detail follows, which is the camera's own zoom once it has stopped moving.
   *
   * Crossing a step reprojects the dataset, and doing that in the middle of a pinch is the
   * worst possible moment for it: the frames that are already the most expensive ones get a
   * reprojection and a full rebuild of the layer on top of them (Europe Administrative: a
   * pinch of 26 s became 33 s). The geometry on screen during the gesture is the real
   * geometry either way — only at the detail the view before the gesture asked for — so
   * the step is taken a moment after the camera settles instead, in the background, exactly
   * as a new region is.
   */
  const [settledK, setSettledK] = useState(transform.k)
  useEffect(() => {
    if (transform.k === settledK) return
    let timer = 0
    const settle = () => {
      // A wheel zoom is a burst of separate gestures: wait for the last of them.
      if (navigatingRef.current) {
        timer = window.setTimeout(settle, 100)
        return
      }
      setSettledK(transform.k)
    }
    timer = window.setTimeout(settle, 150)
    return () => window.clearTimeout(timer)
  }, [transform.k, settledK])
  const landTolerance = fullDetail ? 0 : toleranceForZoom(settledK)
  const landKey = `${[...scope.regionIds].sort().join('+')}|${scope.projectionId}|${scope.padding}|${fit.width}x${fit.height}|t${landTolerance}`
  const land = useProjectedLand(
    geo,
    targetProjection,
    targetInsets,
    landKey,
    fit.width,
    fit.height,
    progressive,
    landTolerance,
  )
  const projection = land?.projection ?? null
  const insets = land?.insets ?? NO_INSETS

  useEffect(() => {
    /*
     * Published for the few things outside the canvas that need the live projection — Canvas →
     * Fit to region measures the region through it. In every build, unlike the window global
     * below, which is a development aid: reading *that* is why Fit to region did nothing in a
     * production build.
     */
    setLiveProjection(projection)
    // What detail the land on screen has, so an export can wait for all of it.
    reportDrawnTolerance(land ? (land.tolerance ?? 0) : null)
    // And the land it drew, for Maps -> SVG's blank map.
    setLiveLand(land && land.geo ? land : null)
    // Lets `__mapEditor.project(lon, lat)` report true screen positions in dev and bridge builds.
    if ((import.meta.env.DEV || import.meta.env.VITE_BRIDGE) && projection) {
      ;(window as unknown as Record<string, unknown>).__mapProjection = projection
    }
  }, [projection, land])

  /**
   * Whether the layers drawn over the land are drawn yet.
   *
   * Always, on an ordinary map. On a progressive one, new land is committed and painted on
   * its own first, and the layers over it — lakes, rivers, the border networks, the coasts,
   * the names — follow in the render after: `useDeferredValue` hands back the previous land
   * for the urgent render, and they wait until it has caught up. Together they cost as much
   * again as the land, and none of them is needed to see the map or to click it.
   */
  const layerLand = useDeferredValue(land)
  const layersReady = !progressive || layerLand === land

  /*
   * The size the drawn land was fitted to, and the correction that makes it cover the live
   * size — see `useSettledSize`. Usually the settled size; for a progressive map still
   * preparing a new size, the size of the land on screen, which is scaled to the new box in
   * the meantime exactly as any map is while a resize settles.
   */
  const drawnWidth = land?.width ?? fit.width
  const drawnHeight = land?.height ?? fit.height
  const fitCorrection = useMemo((): FitCorrection | null => {
    if (drawnWidth < 2 || drawnHeight < 2) return null
    if (width === drawnWidth && height === drawnHeight) return null
    const scale = Math.min(width / drawnWidth, height / drawnHeight)
    const dx = (width - drawnWidth * scale) / 2
    const dy = (height - drawnHeight * scale) / 2
    return { scale, dx, dy }
  }, [width, height, drawnWidth, drawnHeight])
  const fitTransform = fitCorrection
    ? `translate(${fitCorrection.dx},${fitCorrection.dy}) scale(${fitCorrection.scale})`
    : undefined
  fitScaleRef.current = fitCorrection?.scale ?? 1
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
  /*
   * Only the groups that have been merged. A group still being assembled is a list in the
   * Merge panel and nothing here: its members are drawn as themselves, with every border
   * between them, until the author presses Merge.
   */
  const mergedGroups = doc.merges.filter((m) => m.merged)
  const mergeGeometry = useKeyed(
    mergedGroups,
    mergedGroups.map((m) => `${m.id} ${m.members.join(',')}`).join('|'),
  )
  const mergePaint = useKeyed(
    mergedGroups,
    mergedGroups.map((m) => `${m.id} ${m.flag ?? ''} ${m.members.join(',')}`).join('|'),
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
    if (!land || !geo || land.geo !== geo) return []
    const out: Array<{ id: string; name: string; d: string; clipId: string | null }> = []
    for (const feature of geo.features) {
      const id = feature.properties.countryId
      // Left out after projecting, so a merge or an unmerge no longer reprojects the map.
      if (mergedMemberIds.has(id)) continue
      const path = land.paths.get(id)
      if (!path || path.d.length === 0) continue
      out.push({ id, name: feature.properties.name, d: path.d, clipId: path.clipId })
    }
    return out
  }, [land, geo, mergedMemberIds])

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

  /* ------------------------------------------------------------- map overlays */

  const overlays = doc.overlays ?? NO_OVERLAYS
  /** Which entities are copied — all the sources depend on, so moving or recolouring an overlay reprojects nothing. */
  const overlaySourceKey = [...new Set(overlays.map((o) => o.sourceId))].join('\n')

  /**
   * What each overlay is drawn from: the copied entity's land, and its outline exactly as the map
   * draws it — the country's own path, or the merged body's — so an overlay starts exactly over
   * the entity it copies, islands, holes and all.
   */
  const overlaySources = useMemo(() => {
    const out = new Map<string, OverlaySource>()
    if (!overlaySourceKey || !geo || !projection) return out
    for (const id of overlaySourceKey.split('\n')) {
      const merge = mergeGeometry.find((m) => m.id === id)
      if (merge) {
        const drawn = mergedShapes.find((shape) => shape.id === id)
        const inset = insetForGroup(insets, merge.members)
        const source = overlaySource(mergeCountries(geo, merge.members), drawn?.d, inset ? inset.projection : projection)
        if (source) out.set(id, source)
        continue
      }
      const feature = geo.byId.get(id)
      const path = land && land.geo === geo ? land.paths.get(id) : undefined
      const inset = insets.find((candidate) => candidate.members.has(id))
      const source = overlaySource(feature?.geometry, path?.d, inset ? inset.projection : projection)
      if (source) out.set(id, source)
    }
    return out
  }, [overlaySourceKey, geo, projection, land, insets, mergeGeometry, mergedShapes])

  const chooseOverlay = useCallback((id: string) => useMapStore.getState().setActiveOverlay(id), [])
  const moveOverlay = useCallback(
    (id: string, anchor: [number, number]) =>
      useMapStore.getState().dispatch({ op: 'update_overlay', id, patch: { anchor } }),
    [],
  )

  /* ----------------------------------------------------------------- labels */

  const labels = doc.labels
  const labelsOn = labels.enabled
  /*
   * Data Values: each entity's value, set by the same layout as the names. Either switch puts
   * text on the map; `textOn` is "is anything to be set", and `labelsOn` keeps meaning names.
   */
  const valuesOn = labels.values ?? false
  // Compare Group Values: each Compare group's value, on every member. Its own switch.
  const compareValuesOn = labels.compareValues ?? false
  const textOn = labelsOn || valuesOn || compareValuesOn

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
    if (textOn) setLabelsPrepared(true)
  }, [textOn])
  const prepareLabels = textOn || labelsPrepared

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
  /**
   * Territories the author has taken off the map.
   *
   * Hidden is a property of the document, not of the geometry: the entity is still
   * loaded, still selectable through the panels, still carries its value and its group,
   * and still takes part in merges. Only the drawing stops — which is what makes "the
   * world without France" one click away from the world with it.
   *
   * Everything that paints something for an entity has to consult this, not just the
   * country path. A hidden country that keeps its name, its share of the boundary mesh
   * or its magnifier lens has not been hidden; it has been made invisible in one layer
   * out of four, which reads as a bug rather than as a feature.
   */
  const rawHiddenIds = useMemo(() => {
    const ids = new Set<string>()
    for (const [id, entry] of Object.entries(doc.countries)) if (entry?.hidden) ids.add(id)
    return ids
  }, [doc.countries])
  /*
   * Held steady while the same territories stay hidden. `doc.countries` is replaced by every
   * edit — a value typed into the inspector included — and the label shapes, the border and
   * coast networks and the flag tiles all key on this set, so without this every edit
   * rebuilt them: unnoticed on the country map, seconds on the administrative world.
   */
  const hiddenIds = useKeyed(rawHiddenIds, Array.from(rawHiddenIds).sort().join('\u0001'))

  /**
   * The overlays still on the map: an overlay is a copy of a territory, so it goes with the
   * territory it copies. A merged group's overlay goes when every member is hidden. The overlay
   * itself is kept, listed and editable, and comes back when its territory is shown again.
   */
  const visibleOverlays = useMemo(() => {
    if (hiddenIds.size === 0) return overlays
    const membersOf = new Map(mergeGeometry.map((merge) => [merge.id, merge.members]))
    return overlays.filter((overlay) => {
      const members = membersOf.get(overlay.sourceId)
      return members ? !members.every((id) => hiddenIds.has(id)) : !hiddenIds.has(overlay.sourceId)
    })
  }, [overlays, hiddenIds, mergeGeometry])

  /*
   * Every territory's shape, hidden or not: measuring one is the costly part, so hiding a
   * territory filters the list below rather than measuring every other territory again.
   */
  const allLabelShapes = useGatedMemo<LabelShape[]>(layersReady, NO_LABEL_SHAPES, () => {
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
  const labelShapes = useMemo(
    () =>
      hiddenIds.size === 0 ? allLabelShapes : allLabelShapes.filter((shape) => !hiddenIds.has(shape.id)),
    [allLabelShapes, hiddenIds],
  )

  /**
   * What each entity is called, by the document's own naming rule.
   *
   * The author's override first, then the merged entity's name, then the dataset's —
   * the same order the inspector shows and the same order the hover label follows. A
   * label is not a new opinion about what a place is called; it is the existing one,
   * drawn on the map.
   */
  /*
   * And, with Data Values on, what each is worth — the active layer's value, printed with the
   * active scale's unit — as a line of its own under the name, or on its own with names off. An
   * entity with no value gets no line, and with names off no label at all.
   */
  const dataLayer = doc.layers.find((l) => l.id === doc.activeLayerId) ?? doc.layers[0]
  const valueUnit =
    dataLayer?.colorScale.mode === 'threshold'
      ? dataLayer.unit || (getPreset(doc.activePresetId)?.unit ?? '')
      : (dataLayer?.unit ?? '')
  /*
   * Each member's Compare group value: the first group in play that holds it and has a value —
   * the same first-group-wins rule that decides its colour — so a member never shows one
   * group's colour and another group's value.
   */
  const compareValueById = useMemo(() => {
    const byId = new Map<string, string>()
    if (!compareValuesOn) return byId
    for (const group of doc.comparison.groups.slice(0, doc.comparison.groupCount)) {
      const text = formatDataValue(group.value ?? null)
      for (const id of group.members) {
        if (byId.has(id)) continue
        // A member of an earlier group with no value is still that group's: it shows nothing.
        byId.set(id, text ?? '')
      }
    }
    return byId
  }, [compareValuesOn, doc.comparison])

  const rawLabelNames = useMemo(() => {
    const names = new Map<string, string>()
    if (!prepareLabels || !geo) return names
    for (const shape of labelShapes) {
      const override = doc.countries[shape.id]?.label
      const merged = doc.merges.find((m) => m.id === shape.id)?.name
      const name = labelsOn ? (override ?? merged ?? geo.meta[shape.id]?.name ?? null) : null
      const value =
        valuesOn && dataLayer
          ? formatDataValue(doc.countries[shape.id]?.properties[dataLayer.dataKey] ?? null, valueUnit)
          : null
      const groupValue = compareValueById.get(shape.id) || null
      // Name, then its data value, then its group's value — each a line of its own.
      const text = [name, value, groupValue].filter(Boolean).join(LABEL_LINE_BREAK)
      if (text) names.set(shape.id, text)
    }
    return names
  }, [prepareLabels, geo, labelShapes, doc.countries, doc.merges, labelsOn, valuesOn, dataLayer, valueUnit, compareValueById])
  /*
   * Held steady while the names themselves are unchanged. `doc.countries` is replaced by
   * every edit — a value typed into the inspector included — and the layout below keys on
   * this map, so without this every edit made with names on re-ran the whole layout: a few
   * milliseconds on the country map, seconds on the administrative world.
   */
  const labelNames = useKeyed(
    rawLabelNames,
    Array.from(rawLabelNames, ([id, name]) => `${id}\u0001${name}`).join('\u0002'),
  )

  /**
   * The names as they will actually be set: wrapped, sized, placed, de-conflicted.
   *
   * The cheap half of the feature, and deliberately separate from the geometry above.
   * Its inputs are the names, the author's two typographic settings and the stepped
   * zoom — so a rename, a font change or a drag of the size slider redoes arithmetic
   * over numbers that were measured once, and never touches a projection.
   *
   * The stepped zoom is here for one thing only: which names are large enough on screen to
   * be worth drawing. It never sets a size — a name's size is fixed in the map's units, and
   * the camera transform scales it with the land.
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
  /*
   * Remembered across a toggle, too: turning names off and on again with nothing else
   * changed reuses the last layout instead of repeating it. Nothing is laid out while names
   * are off.
   */
  const lastLayout = useRef<{
    shapes: LabelShape[]
    names: Map<string, string>
    style: typeof labelStyle
    placements: ReturnType<typeof layoutLabels>
  } | null>(null)
  const labelPlacements = useMemo(() => {
    if (!textOn) return []
    const last = lastLayout.current
    if (last && last.shapes === labelShapes && last.names === labelNames && last.style === labelStyle) {
      return last.placements
    }
    const placements = layoutLabels(labelShapes, labelNames, labelStyle)
    lastLayout.current = { shapes: labelShapes, names: labelNames, style: labelStyle, placements }
    return placements
  }, [textOn, labelShapes, labelNames, labelStyle])

  /**
   * The labels this zoom draws: every placed name large enough on screen to read, each at
   * the size the layout gave it.
   *
   * Separate from the layout above because the two change on completely different
   * occasions. The layout is a statement about the map and is recomputed only when the
   * geometry or the names do; this is recomputed when the camera crosses a step, and all
   * it does is one comparison per name. Nothing here can move or resize a label.
   */
  const labelsToDraw = useMemo(
    () => (textOn ? visibleLabels(labelPlacements, labelZoomStep) : []),
    [textOn, labelPlacements, labelZoomStep],
  )

  /**
   * Every lake as one path.
   *
   * They share a single style and are never individually addressable, so one element
   * is both cheaper to render and simpler than 300+ nodes. Memoised on the projection
   * and the layer, exactly like the country paths, so it is rebuilt when the camera's
   * projection changes and never on a theme change, a pan or a zoom.
   */
  const prepareLakes = useLayerLatch(style.showLakes)
  const lakePath = useGatedMemo(layersReady, '', () => {
    if (!prepareLakes || !projection || !lakes) return ''
    const path = geoPath(projection)
    return path({ type: 'FeatureCollection', features: lakes.features } as Parameters<typeof path>[0]) ?? ''
  }, [prepareLakes, projection, lakes])

  /**
   * Every river as one path.
   *
   * The same arrangement the lakes get, for the same reasons: one element rather than
   * five hundred, and memoised on the projection and the layer so it survives every pan,
   * zoom and theme change untouched. Panning and zooming move the group this sits in,
   * which is why interacting with the map never rebuilds this string.
   *
   * Relevance is the projection's job. `geoPath` clips to the projection's own extent,
   * so a river outside the current map — the Amazon on a map framed to Europe, or
   * anything on the far side of an orthographic globe — produces no path data at all.
   * That keeps the layer honest without a second opinion about what is on screen, and
   * without recomputing anything as the camera moves.
   */
  const prepareRivers = useLayerLatch(style.showRivers)
  /*
   * The layer is fetched the first time it is switched on rather than on every page
   * load. Latched, so it is asked for once and then stays loaded through every toggle,
   * projection and region change after it — the switch never waits on the network twice.
   */
  useEffect(() => {
    if (prepareRivers) ensureRivers()
  }, [prepareRivers, ensureRivers])

  const riverPath = useGatedMemo(layersReady, '', () => {
    if (!prepareRivers || !projection || !rivers) return ''
    const path = geoPath(projection)
    return path({ type: 'FeatureCollection', features: rivers.features } as Parameters<typeof path>[0]) ?? ''
  }, [prepareRivers, projection, rivers])

  /**
   * Hide Territories, for the lakes and the rivers.
   *
   * Both are one path for the whole map, so a hidden territory cannot be left out of them the
   * way it is left out of every per-entity layer. They are clipped instead: the clip is the
   * whole plane with the hidden territories' footprints cut out of it (even-odd), so a lake
   * or a river inside a hidden territory goes, down to the part of a shared lake on its side of
   * the border, and nothing outside it is touched. See `hiddenMask.ts` for what the footprint
   * includes. Built from the same projection as the two layers, so it lines up exactly, and only
   * while something is hidden and one of them is drawn.
   */
  const hiddenWaterClip = useMemo(() => {
    if (hiddenIds.size === 0 || !projection || !geo) return ''
    if (!(style.showLakes && lakePath) && !(style.showRivers && riverPath)) return ''
    const footprint = hiddenFootprint(geo, hiddenIds, lakes)
    if (!footprint) return ''
    const d = geoPath(projection)(footprint) ?? ''
    return d ? `M-1e6,-1e6H1e6V1e6H-1e6Z${d}` : ''
  }, [hiddenIds, projection, geo, lakes, style.showLakes, style.showRivers, lakePath, riverPath])

  /**
   * The named oceans and seas, one projected path each.
   *
   * One path per region rather than one for the layer, unlike the lakes and the rivers: these
   * are entities, so each has to be addressable — selected, painted, hit-tested. Sixteen paths
   * and about 58,000 vertices in all, which is a fraction of any country layer.
   *
   * Off by default and latched like every other optional layer, so a map that never switches
   * Water Regions on fetches nothing and projects nothing; switched on once, the toggle after
   * that costs a render and no geometry.
   *
   * Memoised on the projection alone, so panning, zooming, hovering, selecting and painting a
   * sea all reproject nothing — the camera moves the group these sit in, exactly as with the
   * land. Insets are deliberately not consulted: an inset frames the land of Alaska or Hawaii,
   * and the sea inside one stays the map's background water.
   */
  const waterOn = style.showWaterRegions
  const prepareWaters = useLayerLatch(waterOn)
  useEffect(() => {
    if (prepareWaters) ensureWaters()
  }, [prepareWaters, ensureWaters])

  const waterShapes = useGatedMemo(layersReady, NO_WATER, () => {
    if (!prepareWaters || !projection || !waters) return NO_WATER
    const path = geoPath(projection)
    const shapes: WaterShape[] = []
    for (const feature of waters.features) {
      const d = path(feature)
      if (d) shapes.push({ id: feature.properties.id, name: feature.properties.name, d })
    }
    return shapes
  }, [prepareWaters, projection, waters])

  /** The seas selected, as a set — what {@link MapWaters} paints in the selection colour. */
  const selectedWaters = useMemo(() => new Set(selectedWaterIds), [selectedWaterIds])

  /**
   * Which water region is under a point, from the element the pointer is actually on.
   *
   * By the element rather than by geometry, which is what keeps land's claim absolute: the
   * water is drawn before every country, so anything with land on it — a coast, an island, a
   * microstate's assist catchment — answers first and this is never asked.
   */
  const waterAt = useCallback(
    (target: EventTarget | null): string | null =>
      waterOn ? ((target as Element | null)?.closest?.(`[${WATER_MARKER}]`)?.getAttribute(WATER_MARKER) ?? null) : null,
    [waterOn],
  )

  /**
   * Whether anything on this map actually draws the boundary mesh.
   *
   * Two callers: the borders-without-coastlines layer, which a fresh document draws
   * (Coastlines are off by default), and the flag mode's international boundaries. With
   * Coastlines on, the mesh is carried by the country paths' own outlines, so building
   * it — and, when a territory is hidden, rebuilding it arc by arc — would be a
   * megabyte of path string nothing referenced.
   */
  const bordersNeeded =
    style.showBorders &&
    (!style.showCoastlines || (doc.flags.enabled && doc.flags.internationalBorders))
  const prepareBorders = useLayerLatch(bordersNeeded)

  /**
   * Whether the coast is drawn on its own: Coastlines on, Borders off.
   *
   * With both switches on, each country's outline draws its coast and its borders in one
   * stroke, as it always has. With Borders off, each country's coast is drawn by itself,
   * with that same stroke (see `paintCountry`); with Coastlines off, the border network is
   * drawn instead. That is what makes the two switches independent: neither layer is ever
   * a side effect of the other's stroke, and neither changes how the other looks.
   */
  const coastlinesNeeded = style.showCoastlines && !style.showBorders
  const prepareCoastlines = useLayerLatch(coastlinesNeeded)

  /**
   * Whether this map has a national-border layer of its own, and whether it is drawn.
   *
   * Only a map whose entities are parts of countries has one — the administrative world —
   * and there it is the Borders switch's to show, like every other political line. Latched
   * like the other networks, so turning Borders off and on again reprojects nothing.
   */
  const hasNational = !!geo?.nationalBorders
  const prepareNational = useLayerLatch(hasNational && style.showBorders)

  /**
   * The border network, projected — split by inset.
   *
   * One path per projection: the main map's, and one per inset through that inset's own
   * projection and clip, so Alaska's borders are drawn in Alaska's box and not at its real
   * position off the edge of the map. Without insets this is exactly one path, from the
   * network built at load. Rebuilt without the hidden territories, so taking a country off
   * the map takes its borders with it.
   */
  const lineNetworks = useGatedMemo(layersReady, NO_LINE_NETWORKS, () => {
    const layers: LineNetworks = { borders: [], national: [] }
    if (!projection || !geo) return layers

    const insetMembers = new Set<string>()
    for (const resolved of insets) for (const id of resolved.members) insetMembers.add(id)
    const onMain = insets.length > 0 ? (id: string) => !insetMembers.has(id) : undefined

    /*
     * The main network from the arcs the outlines were drawn from, when the dataset has a
     * topology to take them from: a border is an arc two entities share, so stitching it from
     * those very points costs no projecting at all and puts the line on the outline by
     * construction. An arc that had to be clipped has no projected form — `line` says so — and
     * that whole network falls back to the stitched one through `geoPath`, as before.
     */
    const fromArcs = (
      buildArcs: (include?: (id: string) => boolean) => number[][] | null,
      include?: (id: string) => boolean,
    ): string | null => {
      const arcs = land?.arcs
      if (!arcs || arcs.projection !== projection) return null
      const lines = buildArcs(include)
      if (!lines) return null
      let d = ''
      for (const indexes of lines) {
        const part = arcs.line(indexes)
        if (part === null) return null
        d += part
      }
      return d === '' ? null : d
    }

    const split = (
      build: (include?: (id: string) => boolean) => MultiLineString | null,
      buildArcs: (include?: (id: string) => boolean) => number[][] | null,
    ): Array<{ d: string; clipId: string | null }> => {
      const out: Array<{ d: string; clipId: string | null }> = []
      const quick = fromArcs(buildArcs, onMain)
      const main = quick === null ? build(onMain) : null
      const mainPath = quick ?? (main ? (geoPath(projection)(main) ?? '') : '')
      if (mainPath) out.push({ d: mainPath, clipId: null })
      for (const resolved of insets) {
        const own = build((id) => resolved.members.has(id))
        const d = own ? (geoPath(resolved.projection)(own) ?? '') : ''
        if (d) out.push({ d, clipId: resolved.inset.id })
      }
      return out
    }

    /*
     * The members of each merged entity, which the networks draw no line between: the merged
     * body is one entity, and a border inside it — between two countries, two regions, or
     * two regions of different countries — is not a border any more.
     */
    const groupOf = new Map<string, string>()
    for (const merge of mergeGeometry) for (const id of merge.members) groupOf.set(id, merge.id)

    if (prepareBorders) {
      layers.borders = split(
        (include) => bordersWithout(geo, hiddenIds, include, false, groupOf),
        (include) => borderArcsWithout(geo, hiddenIds, include, false, groupOf),
      )
    }
    if (prepareNational) {
      layers.national = split(
        (include) => bordersWithout(geo, hiddenIds, include, true, groupOf),
        (include) => borderArcsWithout(geo, hiddenIds, include, true, groupOf),
      )
    }
    return layers
  }, [projection, geo, hiddenIds, insets, prepareBorders, prepareNational, mergeGeometry, land])

  /**
   * Each entity's coast on its own, through the projection that draws the entity.
   *
   * Only for the coast-without-borders state, and latched with it. The lines are the
   * stretches of the entity's own outline that meet the sea (`coastByEntity`), projected
   * exactly as its path is — the main projection or its inset's — so they lie on that
   * outline, point for point. A merged body's coast is its members' coasts together: the
   * arcs between members are borders, so they are not in it, just as they are not in the
   * dissolved outline.
   */
  const coastPaths = useGatedMemo(layersReady, NO_COAST_PATHS, () => {
    const paths = new Map<string, string>()
    if (!prepareCoastlines || !projection || !geo) return paths
    const coasts = coastByEntity(geo)
    /* Open stretches as lines, whole islands as closed rings with no fill — see `EntityCoast`. */
    const shoreOf = (lines: Position[][], rings: Position[][]): GeometryCollection => ({
      type: 'GeometryCollection',
      geometries: [
        { type: 'MultiLineString', coordinates: lines },
        { type: 'MultiPolygon', coordinates: rings.map((ring) => [ring]) },
      ],
    })
    const mainPath = geoPath(projection)
    const insetPaths = insets.map((resolved) => ({ resolved, path: geoPath(resolved.projection) }))

    for (const shape of shapes) {
      const coast = coasts.get(shape.id)
      if (!coast) continue
      const inset = insetPaths.find((entry) => entry.resolved.members.has(shape.id))
      const d = (inset ? inset.path : mainPath)(shoreOf(coast.lines, coast.rings))
      if (d) paths.set(shape.id, d)
    }
    for (const merge of mergeGeometry) {
      const lines = merge.members.flatMap((id) => coasts.get(id)?.lines ?? [])
      const rings = merge.members.flatMap((id) => coasts.get(id)?.rings ?? [])
      if (lines.length === 0 && rings.length === 0) continue
      const inset = insetForGroup(insets, merge.members)
      const d = geoPath(inset ? inset.projection : projection)(shoreOf(lines, rings))
      if (d) paths.set(merge.id, d)
    }
    return paths
  }, [prepareCoastlines, projection, geo, insets, shapes, mergeGeometry])

  const prepareGraticule = useLayerLatch(style.showGraticule)
  const prepareSphere = useLayerLatch(style.showSphere)
  const backdrop = useMemo(() => {
    if (!projection) return { sphere: '', graticule: '' }
    const path = geoPath(projection)
    return {
      sphere: prepareSphere ? (path({ type: 'Sphere' }) ?? '') : '',
      graticule: prepareGraticule ? (path(geoGraticule10()) ?? '') : '',
    }
  }, [projection, prepareGraticule, prepareSphere])

  /**
   * Editor-only anchors for features too small to click. Recomputed only when the
   * projection or dataset changes — never while the pointer moves.
   */
  const smallAnchors = useMemo(() => (land ? anchorsOf(land) : []), [land])

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
  const assist = useMemo(() => (land ? assistOf(land) : EMPTY_ASSIST_INDEX), [land])

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
  const pickEntityAt = useCallback(
    (clientX: number, clientY: number, target: Element | null): string | null => {
      const svg = svgRef.current
      if (!svg) return null

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
        clientX - rect.left,
        clientY - rect.top,
        transform,
        targetId,
      )

      const resolved = claimed ?? targetId
      // Whatever route got here, a member answers as the entity that absorbed it.
      return resolved ? (mergeIdByMember.get(resolved) ?? resolved) : null
    },
    [assist, transform, mergeIds, mergeIdByMember],
  )
  const pickCountryAt = (event: ReactMouseEvent) =>
    pickEntityAt(event.clientX, event.clientY, event.target as Element | null)

  /*
   * No entity is drawn larger than it is. A country too small to see at this zoom is drawn at
   * its real size like everything around it — it grows as the camera zooms in and shrinks as
   * it zooms out, in proportion with its neighbours — and the pointer finds it through its
   * assist catchment (`assistOf`), which is sized in screen pixels and draws nothing. It used
   * to be scaled up to a three-pixel floor for the current zoom, which made Vatican City and
   * every other speck grow as the camera zoomed out and shrink as it zoomed in.
   */

  /* ----------------------------------------------------------- selection tools */

  /**
   * The Selection panel's tools, on every map.
   *
   * They test the outlines the map draws — see `selectionGeometry.ts` — so whatever a
   * dataset's entities are, countries, subdivisions or states, and whatever a future atlas
   * brings, the tools select exactly those, through one implementation. The only thing
   * they need is something drawn to test, so they wait for the geography to load.
   */
  const hasOutlines = shapes.length > 0 || mergedShapes.length > 0
  const rectangleOn = hasOutlines && selectionTools.rectangle
  const brushOn = hasOutlines && selectionTools.brush
  brushArmedRef.current = brushOn

  /**
   * What the tools may take: exactly the entities `paintCountry` draws — not a hidden
   * territory, and not land outside the scope while that is hidden — and every merged body.
   */
  const drawnIds = useMemo(() => {
    const ids = new Set<string>()
    for (const shape of shapes) {
      if (hiddenIds.has(shape.id)) continue
      if (style.outsideScope === 'hidden' && !scopeCountryIds.has(shape.id)) continue
      ids.add(shape.id)
    }
    for (const shape of mergedShapes) ids.add(shape.id)
    return ids
  }, [shapes, mergedShapes, hiddenIds, scopeCountryIds, style.outsideScope])

  /*
   * Where an inset-drawn entity can be seen. The one geometric difference between maps: an
   * entity drawn in an inset is clipped to the inset's frame — Hawaii's north-western atolls
   * are still in its outline, drawn outside the box and cut away — so the tools test only
   * the part inside the frame, the part the author can see. Empty on a map without insets.
   */
  const clipsById = useMemo(() => {
    const clips = new Map<string, OutlineClip>()
    if (insets.length === 0) return clips
    const frames = new Map(insets.map((resolved) => [resolved.inset.id, resolved.clip]))
    for (const shape of [...shapes, ...mergedShapes]) {
      const clip = shape.clipId ? frames.get(shape.clipId) : undefined
      if (clip) clips.set(shape.id, clip)
    }
    return clips
  }, [insets, shapes, mergedShapes])

  /* Read by the gestures when they run, so they always test the outlines on screen. */
  const selectable = useRef({ shapes, mergedShapes, drawnIds, frames: NO_FRAMES, clips: clipsById, waters: waterShapes })
  selectable.current = { shapes, mergedShapes, drawnIds, frames: NO_FRAMES, clips: clipsById, waters: waterShapes }

  /* A trackpad pinch zooms the map and never the page — see `usePinchZoom`. */
  usePinchZoom(svgRef)

  useSelectionGestures(svgRef, zoomedRef, selectionOverlayRef, {
    rectangle: rectangleOn,
    brush: brushOn,
    /*
     * The tools test the outlines the map draws, and with the layer on the seas are among
     * them — so a rectangle over the Baltic takes the Baltic, and a brush stroke across it
     * paints it in. They are tested through the same geometry as the land and handed back in
     * the same list; the store is what keeps the two selections apart (see `addToSelection`).
     *
     * `ALL_WATER_DRAWN` because every region is drawn whenever the layer is on: a sea is
     * never hidden, never outside the scope, and never framed by an inset.
     */
    inRect: (x0, y0, x1, y1) => {
      const view = selectable.current
      const drawn = { frames: view.frames, clips: view.clips, drawn: (id: string) => view.drawnIds.has(id) }
      return [
        ...outlinesInRect(outlinesOf(view.shapes), x0, y0, x1, y1, drawn),
        ...outlinesInRect(outlinesOf(view.mergedShapes), x0, y0, x1, y1, drawn),
        ...outlinesInRect(outlinesOf(view.waters), x0, y0, x1, y1, ALL_WATER_DRAWN),
      ]
    },
    alongSegment: (ax, ay, bx, by, radius) => {
      const view = selectable.current
      const drawn = { frames: view.frames, clips: view.clips, drawn: (id: string) => view.drawnIds.has(id) }
      return [
        ...outlinesAlongSegment(outlinesOf(view.shapes), ax, ay, bx, by, radius, drawn),
        ...outlinesAlongSegment(outlinesOf(view.mergedShapes), ax, ay, bx, by, radius, drawn),
        ...outlinesAlongSegment(outlinesOf(view.waters), ax, ay, bx, by, radius, ALL_WATER_DRAWN),
      ]
    },
    pickAt: pickEntityAt,
    add: addToSelection,
    remove: removeFromSelection,
    isSelected: (id) => {
      const state = useMapStore.getState()
      // A sea is selected by the water selection, land by the land one.
      if (isWaterId(id)) return state.selectedWaterIds.includes(id)
      return state.selectedCountryIds.includes(id)
    },
    selecting: selectingRef,
    suppressClick: suppressClickRef,
    ignore: (target) => Boolean(target?.closest?.(`[${LEGEND_MARKER}]`) || target?.closest?.(`[${OVERLAY_MARKER}]`)),
  })

  /*
   * The tools test the outlines as geometry, which means reading every path string back into
   * vertices — twenty megabytes on the administrative world. Done ahead, in slices, once the
   * map is drawn and a tool is on, so the first rectangle or stroke does not wait for it.
   */
  useEffect(() => {
    if (!rectangleOn && !brushOn) return
    let cancelled = false
    const handle = window.setTimeout(() => {
      void prepareOutlines(shapes, () => cancelled).then(() => {
        if (!cancelled) void prepareOutlines(mergedShapes, () => cancelled)
        // The seas too, when they are on the map: sixteen outlines, read with the rest.
        if (!cancelled) void prepareOutlines(waterShapes, () => cancelled)
      })
    }, 300)
    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [rectangleOn, brushOn, shapes, mergedShapes, waterShapes])

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
    // The rule — an assignment naming another entity or artwork, else the entity's own — is `entityFlagCode`, which the panels share.
    (id: string): string | undefined => (geo ? entityFlagCode(id, doc.flags.overrides, geo.meta) : undefined),
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
    /*
     * Not on a dataset of tens of thousands of units: there the warm-up is itself a
     * second-long block, paid on every load for a mode few open on such a map, and the mode
     * computes the same thing when it is switched on.
     */
    if (!geo || geo.features.length > WARM_MAX_FEATURES) return
    let cancelled = false
    let handle: number | null = null
    const idle = (window as unknown as { requestIdleCallback?: typeof setTimeout })
      .requestIdleCallback
    const cancelIdle = (window as unknown as { cancelIdleCallback?: (h: number) => void })
      .cancelIdleCallback
    const features = geo.features
    let at = 0
    /*
     * A few entities at a time, in whatever the browser says is left of an idle moment.
     *
     * Two things matter here and they pull in the same direction. Doing the whole dataset in
     * one callback held the main thread for 2.2 s on Europe Countries — idle work that long is
     * a freeze like any other, since nothing can interrupt it once it has started. And a
     * *deadline* is asked for rather than assumed: this used to take a fixed 8 ms slice and ask
     * for it with `{ timeout: 3000 }`, which is an instruction to run the slice within three
     * seconds *whether or not the browser is idle*. On Europe Administrative there are 2,659
     * entities to cluster, so those forced slices went on arriving for minutes, landing in the
     * middle of whatever the author was doing: a selection frame competing with a slice of
     * coastline clustering is one of the ways this editor felt heavier the longer it was open.
     *
     * With no timeout the browser runs this only when there is genuinely nothing else to do,
     * and `timeRemaining` says how much of the gap to use. The work is the same and the answer
     * is the same; it simply never takes time from the author. The clustering is memoised per
     * entity, so stopping between entities costs nothing, and the mode still finds everything
     * done when it opens — or does the rest itself, as it always did.
     */
    /*
     * The longest one entity has taken so far, kept so none is started in a gap too short to
     * hold it. Clustering cannot be interrupted once an entity is begun, and on a phone the
     * worst of them runs into tens of milliseconds: without this the browser's idle time was
     * spent, the callback overran the frame it was given, and the map stuttered while nobody
     * was doing anything. Decayed a little each time, so one unusual entity does not stop the
     * rest for ever.
     */
    let worst = 1
    const step = (deadline?: { timeRemaining: () => number }) => {
      handle = null
      if (cancelled) return
      const until = performance.now() + Math.min(8, deadline ? deadline.timeRemaining() : 4)
      while (at < features.length) {
        const started = performance.now()
        if (started + worst > until) break
        warmEntityClusters(geo, features[at].properties.countryId)
        worst = Math.max(worst * 0.9, performance.now() - started)
        at++
      }
      if (at < features.length) {
        schedule()
        return
      }
      flagFootprints(geo)
      flagTerritories(geo)
    }
    const schedule = () => {
      handle = (idle ? idle(step) : window.setTimeout(step, 50)) as unknown as number
    }
    schedule()
    return () => {
      cancelled = true
      if (handle === null) return
      if (idle && cancelIdle) cancelIdle(handle)
      else window.clearTimeout(handle)
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

  /**
   * Every entity the map draws a flag for, hidden ones removed.
   *
   * A hidden country flies no flag, anywhere. Filtered here rather than at each of the
   * places tiles are consumed, because they are several — the country's own fill, its
   * separately framed territories, the island floor and the maritime layer all read from
   * this one list. Hiding France left its overseas départements still wearing the
   * tricolour when only the country path was checked.
   *
   * This is the *membership* question — which entities have a flag on this map — and it
   * is deliberately separate from `visibleFlagTiles` below, which answers the quite
   * different question of how many flag documents a small screen can afford to hold.
   * Splitting them is what fixes island water on a phone: see `maritimeCodes`.
   */
  const drawnFlagTiles = useMemo(
    () => (hiddenIds.size === 0 ? flagTiles : flagTiles.filter((t) => !hiddenIds.has(t.id))),
    [flagTiles, hiddenIds],
  )

  const visibleFlagTiles = useMemo(() => {
    const shown = drawnFlagTiles
    if (!compactViewport) return shown
    const big = shown.filter(
      (tile) => Math.max(tile.width, tile.height) * flagZoomStep >= COMPACT_FLAG_MIN_PX,
    )
    if (big.length <= COMPACT_FLAG_MAX_COUNT) return big
    /*
     * Over the ceiling: keep the biggest. Sorted on a copy, because `flagTiles` is
     * memoised and shared — sorting it in place would reorder the array every other
     * consumer is holding.
     */
    return [...big]
      .sort((a, b) => Math.max(b.width, b.height) - Math.max(a.width, a.height))
      .slice(0, COMPACT_FLAG_MAX_COUNT)
  }, [compactViewport, drawnFlagTiles, flagZoomStep])

  /**
   * Which entities the maritime layer may paint, and with whose artwork.
   *
   * Read from `drawnFlagTiles` — every entity that has a flag — and *not* from
   * `visibleFlagTiles`, which is the compact-screen budget for how many flag documents
   * may be held at once. Those are different questions, and conflating them broke this
   * feature on exactly the devices the budget was added for.
   *
   * The budget keeps the largest tiles on screen, because a flag smaller than a smudge
   * is not worth 180kB of parsed SVG. But an island nation is small land by definition:
   * Tuvalu, Kiribati, the Maldives and French Polynesia are the first entities the
   * budget drops, and they are precisely the entities whose *water* is the point. On a
   * phone the layer collapsed from 68 territories to 9 — and the 9 that survived were
   * the continental countries that keep almost no sea at all.
   *
   * So water membership follows the geography, and the budget goes on governing only
   * what it was written to govern: how many flags the land layer paints.
   */
  const maritimeCodes = useMemo(
    () => new Map(drawnFlagTiles.map((tile) => [tile.id, tile.iso2])),
    [drawnFlagTiles],
  )

  /**
   * Which territories get water, decided in geographic space and independent of the
   * camera — so zooming and panning never revisit it.
   */
  /*
   * Island water is a flag-mode option, and it is off by default — so its dataset is not
   * fetched and its geometry is not selected or projected until somebody turns it on.
   * Latched like every other layer here, so the second toggle and all the ones after it
   * cost nothing.
   */
  const prepareIslandWater = useLayerLatch(prepareFlags && doc.flags.islandWater)
  useEffect(() => {
    if (prepareIslandWater) ensureMaritime()
  }, [prepareIslandWater, ensureMaritime])

  const islandZones = useMemo(() => {
    if (!prepareIslandWater || !maritime || !geo) return new Map<string, MultiPolygon>()
    return selectIslandZones(
      maritime.zones,
      (id) => geo.byId.get(id),
      // A merged member counts: its water is handed to its group below.
      (id) => maritimeCodes.has(id) || mergeIdByMember.has(id),
      // On the map, shown or hidden — a hidden territory's water is hidden with it.
      (id) => geo.byId.has(id),
    )
  }, [prepareIslandWater, maritime, geo, maritimeCodes, mergeIdByMember])

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
    const tiles = mergePaint
      .map((entity) => {
        if (!entity.flag) return null
        const geometry = mergeCountries(geo, entity.members)
        if (!geometry) return null
        const fit = fitFlag(geometry, path, projection)
        return fit ? { id: entity.id, iso2: entity.flag, fit } : null
      })
      .filter((t): t is NonNullable<typeof t> => t !== null)

    /*
     * Merged bodies obey the same size floor as countries on a compact viewport. They
     * were exempt, which was the wrong way round: a merge is made by zooming in and
     * tapping, so it is exactly the thing someone is doing when the flags are piling up.
     * A merge is normally large enough to clear the floor easily; a two-island merge at
     * world zoom is not, and it should not cost a 180 KB document to draw four pixels.
     */
    if (!compactViewport) return tiles
    return tiles.filter(
      (tile) => Math.max(tile.fit.width, tile.fit.height) * flagZoomStep >= COMPACT_FLAG_MIN_PX,
    )
  }, [flagsOn, projection, geo, mergePaint, compactViewport, flagZoomStep])

  /**
   * Island water by what the land shows: a merged group is one entity, so it is one sea.
   *
   * Zones are still chosen member by member — Guam is judged by Guam's land, not by the
   * group's — and are then given to the group and dissolved into one body carrying the
   * group's flag, as a country's zones are. A group with no flag has plain land and no
   * flag to fly over its water, so its members' water is not drawn at all: leaving it
   * showed Guam's and the Marianas' own flags round islands whose land no longer wore them.
   */
  const waterZones = useMemo(() => {
    if (mergeIdByMember.size === 0 || islandZones.size === 0) return islandZones
    const flagOf = new Map(mergePaint.map((merge) => [merge.id, merge.flag]))
    const zones = new Map<string, MultiPolygon>()
    const grouped = new Set<string>()
    for (const [id, geometry] of islandZones) {
      const mergeId = mergeIdByMember.get(id)
      if (mergeId === undefined) {
        zones.set(id, geometry)
        continue
      }
      if (!flagOf.get(mergeId)) continue
      const existing = zones.get(mergeId)?.coordinates ?? []
      zones.set(mergeId, { type: 'MultiPolygon', coordinates: [...existing, ...geometry.coordinates] })
      grouped.add(mergeId)
    }
    for (const id of grouped) zones.set(id, dissolveTouching(zones.get(id) as MultiPolygon))
    return zones
  }, [islandZones, mergeIdByMember, mergePaint])

  /** `maritimeCodes`, with each flagged group's own flag for its water. */
  const waterCodes = useMemo(() => {
    if (!mergePaint.some((merge) => merge.flag)) return maritimeCodes
    const codes = new Map(maritimeCodes)
    for (const merge of mergePaint) if (merge.flag) codes.set(merge.id, merge.flag)
    return codes
  }, [maritimeCodes, mergePaint])

  const maritimeShapes = useMemo(
    () => buildMaritimeShapes(waterZones, projection, (id) => waterCodes.get(id)),
    [waterZones, projection, waterCodes],
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

  /*
   * Artwork for overlays filled with a flag. They need it whether or not the map is in Flags mode,
   * so it is asked for here, for the code each overlay chose, from the same store every flag comes
   * from — and handed to the overlay layer only once it has arrived.
   */
  const overlayFlagCodes = useMemo(
    () => [...new Set(overlays.filter((o) => o.texture === 'flag' && o.flag).map((o) => o.flag as string))],
    [overlays],
  )
  useEffect(() => {
    if (overlayFlagCodes.length) requestFlags(overlayFlagCodes)
  }, [overlayFlagCodes, requestFlags])
  const overlayFlags = useMemo(() => {
    const out = new Map<string, string>()
    for (const o of overlays) if (o.texture === 'flag' && o.flag && loadedFlags[o.flag]) out.set(o.id, loadedFlags[o.flag])
    return out
  }, [overlays, loadedFlags])

  /**
   * Artwork for the water, which the land layer's budget does not cover.
   *
   * On a compact screen the request above asks only for the flags the land is painting,
   * and an island nation's flag is the first thing that budget drops — so its sea had a
   * pattern with no image in it and drew as nothing. The territories that actually hold
   * water are few (68 on the world map), they are only computed once the author turns
   * the layer on, and each one is a flag the map is genuinely about to paint. Under
   * domination there is nothing to fetch: the whole layer is painted with the one world
   * pattern, which the effect above has already asked for.
   */
  useEffect(() => {
    if (dominationCode || waterZones.size === 0) return
    const codes: string[] = []
    for (const id of waterZones.keys()) {
      const code = waterCodes.get(id)
      if (code) codes.push(code)
    }
    if (codes.length) requestFlags(codes)
  }, [dominationCode, waterZones, waterCodes, requestFlags])

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
       *
       * A wheel with Ctrl held is a trackpad pinch, and it zooms the map, as d3's own filter
       * lets it. Refusing it — as this did — left the pinch to the browser, which zoomed the
       * whole page instead. See `usePinchZoom`.
       */
      .filter((event) => {
        if (event.button || (event.ctrlKey && event.type !== 'wheel')) return false
        /*
         * With the brush on, a press on the map paints a selection instead of dragging the
         * map — see `useSelectionGestures`. The wheel, the zoom buttons and a two-finger
         * pinch still move the camera.
         */
        if (
          brushArmedRef.current &&
          (event.type === 'mousedown' ||
            (event.type === 'touchstart' && (event as TouchEvent).touches.length < 2))
        ) {
          return false
        }
        const target = event.target as Element | null
        if (target?.closest?.(`[${LEGEND_MARKER}]`)) return false
        // A press on an overlay drags the overlay, not the map; the wheel and a pinch still zoom.
        if (
          target?.closest?.(`[${OVERLAY_MARKER}]`) &&
          (event.type === 'mousedown' ||
            (event.type === 'touchstart' && (event as TouchEvent).touches.length < 2))
        ) {
          return false
        }
        return true
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
      /*
       * A gesture moves the map by hand; React is told when it is over.
       *
       * Every `zoom` event used to write the transform into the store, and the store is
       * what this component reads — so each frame of a pan or a pinch re-rendered the
       * whole canvas: two hundred and fifty country paths, and in flags mode a pattern
       * and an image beside each one, rebuilt and diffed to move a group two pixels.
       *
       * None of that work depends on where the map has been dragged to. The projected
       * geometry is memoised on the projection, and the camera is one `transform`
       * attribute on the group holding it — so during a gesture that attribute is set
       * directly and nothing else is touched. On `end` the same value goes into the
       * store, which re-renders once and puts React's idea of the transform back in
       * agreement with the DOM's.
       *
       * The one thing outside that group that has to stay on the land — the magnifier on
       * a selected speck — is handed the same camera in the same call, and places itself
       * directly too. It used to be placed from the store, so it stood still for the whole
       * gesture and caught up only at the commit. What else follows the camera — the zoom
       * readout, the flag and label size steps — updates on that final commit rather than
       * every frame. Those are all quantised or incidental; none of them is worth a full
       * render at 60Hz.
       *
       * And at most once a frame. A trackpad reports a pinch or a scroll at 120 Hz, and a
       * phone its fingers as fast as they move; every camera set on the group has the whole
       * map drawn again, and only the last one before a frame is ever seen. So the camera
       * waits for the next animation frame and is set there, once — each frame drawn exactly
       * as it was, at the latest camera, with the fewer redraws nobody could see left out.
       */
      .on('start', (event) => {
        // Only a real gesture. A programmatic transform has no source event and moves
        // the camera without anyone's pointer being involved.
        if (!event.sourceEvent) return
        gesturingRef.current = true
        panScale.current = event.transform.k
        zoomingRef.current = false
        navigating(true)
      })
      .on('zoom', (event) => {
        const t = event.transform
        if (zoomedRef.current && (event.sourceEvent || gripDragRef.current)) {
          /*
           * A wheel notch and a trackpad pinch are each their own little gesture, so this keeps
           * the map in the navigating state and pushes its release out past the last of them.
           */
          navigating(true)
          /*
           * The compositor may carry the map only while the scale is unchanged, and only for a
           * drag: a wheel or a pinch is a zoom, and each notch of one arrives as its own little
           * gesture, so asking for a layer at the start of each would spend more on making and
           * discarding layers than carrying ever saves. See `carry`.
           */
          const moving = event.sourceEvent?.type !== 'wheel'
          if (t.k !== panScale.current || !moving) carry(false)
          else if (!zoomingRef.current) carry(true)
          liveCamera.current = t
          if (!cameraFrame.current) cameraFrame.current = requestAnimationFrame(placeCamera)
          return
        }
        /* No source event means it was moved programmatically — commit it directly. */
        setTransform({ k: t.k, x: t.x, y: t.y })
      })
      .on('end', (event) => {
        /*
         * Each move the grip makes is its own little transform, so d3 ends a gesture after every
         * one of them. The gesture the author is making is the whole drag, and it ends when
         * their finger lifts — which is where the camera is committed, once, by the grip
         * itself. Committing here as well would put a render on every frame of the drag.
         */
        if (gripDragRef.current) return
        // A frame still waiting is drawn now, at the final camera: the commit below would skip a
        // camera equal to the one it last committed, and leave the frame's older one on screen.
        if (cameraFrame.current) {
          cancelAnimationFrame(cameraFrame.current)
          liveCamera.current = event.transform
          placeCamera()
        }
        gesturingRef.current = false
        navigating(false)
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
      if (cameraFrame.current) cancelAnimationFrame(cameraFrame.current)
      cameraFrame.current = 0
    }
  }, [width, height, setTransform, placeCamera])

  // A new framing means a new composition — start it at its fitted extent.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg || !zoomRef.current) return
    select(svg).call(zoomRef.current.transform, zoomIdentity)
  }, [framingEpoch])

  /**
   * The camera, lent to the sidebar's grip.
   *
   * Everything here is what a drag on the map itself does, in the same order and through the
   * same zoom behaviour: `translateBy` and `scaleBy` are the calls d3 makes internally for a
   * drag and a pinch, so the scale limits and the pan bounds are applied once, by the code
   * that owns them. `gripDragRef` is what tells the handler above that these are a gesture's
   * frames rather than a programmatic jump, so the camera goes to the DOM once a frame and the
   * document hears about it once, when the finger lifts.
   */
  useEffect(() => {
    setMapCamera(() => {
      const svg = svgRef.current
      const behavior = zoomRef.current
      if (!svg || !behavior) return null
      const selection = select(svg)
      gripDragRef.current = true
      gesturingRef.current = true
      panScale.current = zoomTransform(svg).k
      zoomingRef.current = false
      navigating(true)
      let live = true
      const finish = () => {
        if (!live) return
        live = false
        gripDragRef.current = false
        gesturingRef.current = false
        navigating(false)
        // The frame still waiting is drawn now, at the camera the gesture ended on.
        if (cameraFrame.current) {
          cancelAnimationFrame(cameraFrame.current)
          cameraFrame.current = 0
          placeCamera()
        }
        const t = zoomTransform(svg)
        setTransform({ k: t.k, x: t.x, y: t.y })
      }
      return {
        panBy(dx, dy) {
          if (!live) return
          navigating(true)
          // d3 translates in the camera's own units; a finger moves in screen pixels.
          const k = zoomTransform(svg).k
          selection.call(behavior.translateBy, dx / k, dy / k)
        },
        zoomBy(factor, clientX, clientY) {
          if (!live) return
          navigating(true)
          const box = svg.getBoundingClientRect()
          selection.call(behavior.scaleBy, factor, [clientX - box.x, clientY - box.y])
        },
        end: finish,
      }
    })
    return () => setMapCamera(null)
  }, [navigating, placeCamera, setTransform])

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

  /**
   * The magnifiers to draw: every selected small entity that is shown and has a shape.
   * Nothing here depends on the camera, so panning and zooming never rebuild a lens.
   */
  const lenses = useMemo(() => {
    const list: Lens[] = []
    // Only when the author has asked for it — see `MapStore.magnifier`.
    if (!magnifierOn) return list
    for (const anchor of smallAnchors) {
      if (!selected.has(anchor.id) || hiddenIds.has(anchor.id)) continue
      const d = shapeById.get(anchor.id)
      if (!d) continue
      list.push({ anchor, d, fill: flagFillById.get(anchor.id) ?? style.selected })
    }
    return list
  }, [magnifierOn, smallAnchors, selected, hiddenIds, shapeById, flagFillById, style.selected])
  /* A subdivision is named with its country — "Bavaria, Germany" — and a country by itself. */
  const hoveredName = hoveredCountryId
    ? [
        geo?.byId.get(hoveredCountryId)?.properties.name,
        geo?.meta[hoveredCountryId]?.parent?.name,
      ]
        .filter(Boolean)
        .join(', ') || null
    : // A sea under the pointer is named the same way a country is, in the same place.
      hoveredWaterId
      ? waterName(hoveredWaterId)
      : null

  /**
   * How a country is painted: its fill, and its outline.
   *
   * The outline is one decision — its colour, its width, and whether it sits under the
   * fill — made here once per country and used wherever that country's outline is drawn:
   * on the country's own path while Borders and Coastlines are both on, and as the
   * country's coast alone while Borders is off.
   *
   * It used to be made twice. With Borders off the coast came from a separate network
   * with a style of its own — the international-boundary width, which grows with the
   * zoom, painted over the land at full width, where the outline paints its stroke under a
   * flag and shows only the outer half — so turning Borders off made every coast thicker,
   * and in the data modes it lost the tone chosen against the country's fill. One decision
   * leaves nothing to disagree about.
   */
  /*
   * Whether the selection is drawn in its own layer.
   *
   * It is, except in the one state where the entities' only line is their own coast —
   * Coastlines on with Borders off. There the coast is drawn beside each entity's path and
   * takes the ink its fill gives it, so a selected coast drawn in the layer *and* an
   * unselected one drawn under it are two coincident strokes whose edges blend. Rather than
   * approximate, that state keeps the older behaviour exactly: selection is the entity's own
   * fill, and costs what it always did. Every other state — including the default — gets
   * the layer.
   */
  const selectionInLayer = !(style.showCoastlines && !style.showBorders)

  const paintCountry = (shape: (typeof shapes)[number], hovered = false, asSelected = false) => {
    const inScope = scopeCountryIds.has(shape.id)
    if (!inScope && style.outsideScope === 'hidden') return null
    const entry = doc.countries[shape.id]
    if (entry?.hidden) return null

    const ctx: FillContext = {
      ...fillContext,
      inScope,
      hovered,
      /*
       * The land is not painted selected while the layer is drawing the selection over it —
       * see `selectionPaths`. `asSelected` is how that layer asks for the very paint this
       * function would otherwise have produced.
       */
      selected: asSelected || (!selectionInLayer && selected.has(shape.id)),
      landTint: landTintById?.get(shape.id) ?? null,
    }

    /*
     * The border is chosen from the fill it is drawn over, so a country at the dark end
     * of a ramp gets the pale tone and one at the light end gets the ink. One stroke,
     * never two: a casing pass would mean a second copy of every country's path data,
     * doubling the scene and the exported SVG to buy contrast this already has.
     *
     * The author's chosen border wins outright; the two-tone fallback is scoped to
     * countries coloured by a data *scale*, which is the case it exists for. See
     * `resolveBorderInk`.
     */
    const fill = resolveCountryFill(entry, ctx, shape.id)
    const borderInk = resolveBorderInk(entry, ctx, shape.id)
    /*
     * In flags mode the country is painted with its own flag, as the fill of its very
     * path — so the artwork is clipped to the real geometry, covers every island, and
     * costs no extra element. Selection still paints over it, because a selected country
     * has to read as selected.
     */
    const flagFill = ctx.selected ? undefined : flagFillById.get(shape.id)

    return {
      fill: flagFill ?? fill,
      fillOpacity: flagFill && !inScope && style.outsideScope === 'muted' ? 0.4 : undefined,
      outline: {
        stroke: flagFill ? FLAG_BORDER_COLOR : borderInk,
        strokeWidth: flagFill
          ? flagBorderWidth(flagTileById.get(shape.id), style.borderWidth, zoomK)
          : style.borderWidth,
        paintOrder: flagFill ? 'stroke' : undefined,
      },
      clipPath: shape.clipId ? `url(#map-inset-${shape.clipId})` : undefined,
    }
  }

  /**
   * How a merged body is painted, through exactly the same functions a country is.
   *
   * That is the whole of the integration: the palette, the threshold bands, the hover and
   * the selection highlight are not re-implemented here, they simply apply — because what
   * they take is an entity id and a value, and a merge has both. Anything added to that
   * pipeline later reaches merges without knowing they exist.
   */
  const paintMerge = (shape: (typeof mergedShapes)[number], asSelected = false) => {
    const ctx: FillContext = {
      ...fillContext,
      inScope: true,
      hovered: hoveredCountryId === shape.id,
      selected: asSelected || (!selectionInLayer && selected.has(shape.id)),
      landTint: null,
    }
    const entry = doc.countries[shape.id]
    const fill = resolveCountryFill(entry, ctx, shape.id)
    const flagFill = ctx.selected ? undefined : mergedFlagFillById.get(shape.id)
    const borderInk = resolveBorderInk(entry, ctx, shape.id)
    return {
      fill: flagFill ?? fill,
      outline: {
        stroke: flagFill ? FLAG_BORDER_COLOR : borderInk,
        strokeWidth: style.borderWidth,
        paintOrder: flagFill ? 'stroke' : undefined,
      },
      clipPath: shape.clipId ? `url(#map-inset-${shape.clipId})` : undefined,
    }
  }

  const mergedPaints = mergedShapes.map((shape) => ({ shape, paint: paintMerge(shape) }))


  /** The outline — coast and borders in one stroke — only while both layers are on. */
  const outlineOn = style.showBorders && style.showCoastlines
  /** The coast by itself, with each entity's own outline stroke, while Borders is off. */
  const coastAlone = style.showCoastlines && !style.showBorders

  /**
   * An entity's coast drawn alone, placed exactly where its outline stroke is painted.
   *
   * The outline stroke is painted in the same sequence as the land: under its own fill
   * when it carries a flag (`paint-order: stroke`), over it otherwise, and in either case
   * before every country drawn after it — so where another country's land comes within a
   * stroke's width of this coast, that country covers it. The coast is therefore drawn
   * right beside its own path, before it or after it, which reproduces that sequence
   * exactly rather than approximately: the only thing Borders changes is whether the
   * border half of the outline is there at all.
   */
  const coastBeside = (
    id: string,
    outline: { stroke: string; strokeWidth: number; paintOrder: string | undefined },
    transform: string | undefined,
    clipPath: string | undefined,
    under: boolean,
  ) => {
    if (!coastAlone || (outline.paintOrder === 'stroke') !== under) return null
    const d = coastPaths.get(id)
    if (!d) return null
    return (
      <CountryCoast
        entityId={id}
        d={d}
        stroke={outline.stroke}
        strokeWidth={outline.strokeWidth}
        transform={transform}
        clipPath={clipPath}
      />
    )
  }

  /**
   * The country layer: one element per entity, rebuilt only for what changed.
   *
   * It used to be rebuilt whole on every render — a paint and three elements for every
   * entity, 16,000 on the Detailed World Map at its finest level and 96,000 on the USA map's
   * subdivisions — and the canvas renders on every change of hover, every selection toggle,
   * every brush frame and every document edit, the overlay sliders included. A hover crossing
   * a border cost 40 ms on the 5,257-unit map.
   *
   * Now the paints are kept until something they are made from changes — everything
   * `paintCountry` reads, and not the hover — and when only the selection changed, only the
   * entities whose selection did are repainted. Each entity keeps its element from the last
   * build while its paint, path and coast are the same, and the elements are drawn in chunks
   * of `COUNTRY_CHUNK`, each a memoised component: a chunk holding exactly the elements it
   * held last time is the same array, and React passes over the whole of it without looking
   * inside. A hover or a selection change therefore reaches one or two chunks, not the layer.
   * The hovered entity is the one element made afresh on a hover, painted as it always was,
   * in its own place, so what is drawn — and in what order — is exactly what it was.
   */
  /*
   * Everything `paintCountry` reads, bar the hover and the selection. The zoom only while flags
   * are drawn: it sets a flag's border width and nothing else, so without flags a zoom repaints
   * nothing.
   */
  const paintZoom = flagFillById.size > 0 ? zoomK : 0
  /*
   * Everything but the countries' own entries, which are compared one by one below.
   */
  const paintInputs = [shapes, scopeCountryIds, style, fillContext, landTintById, flagFillById, flagTileById, paintZoom, selectionInLayer] as const
  const countryPaints = useMemo((): PaintedShape[] => {
    const previous = countryPaintCache.current
    const sameInputs =
      previous && previous.inputs.length === paintInputs.length && previous.inputs.every((input, i) => input === paintInputs[i])
    if (previous && sameInputs) {
      const changed = new Set<string>()
      /*
       * In the one state that still paints selection into the land, a click repaints what it
       * touched, as it always did.
       */
      if (!selectionInLayer) {
        for (const id of selected) if (!previous.selected.has(id)) changed.add(id)
        for (const id of previous.selected) if (!selected.has(id)) changed.add(id)
      }
      /*
       * And whichever entities' own entries changed — a value typed, a label, a colour, a
       * country joining a comparison group. The scale those are read through is in
       * `fillContext`, which is above: when it is the same object, one entity's new value
       * cannot have changed what any other entity is painted, so the rest keep their paint.
       * Giving 50 countries a value used to repaint all 2,659 of Europe Administrative, which
       * is the whole map's paint for an edit to one fiftieth of it.
       */
      if (previous.countries !== doc.countries) {
        for (const id in doc.countries) {
          if (doc.countries[id] !== previous.countries[id]) changed.add(id)
        }
        for (const id in previous.countries) {
          if (doc.countries[id] !== previous.countries[id]) changed.add(id)
        }
      }
      const paints =
        changed.size === 0
          ? previous.paints
          : previous.paints.map((entry) => (changed.has(entry.shape.id) ? { shape: entry.shape, paint: paintCountry(entry.shape) } : entry))
      countryPaintCache.current = { inputs: paintInputs, selected, countries: doc.countries, paints }
      return paints
    }
    const paints = shapes.map((shape) => ({ shape, paint: paintCountry(shape) }))
    countryPaintCache.current = { inputs: paintInputs, selected, countries: doc.countries, paints }
    return paints
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...paintInputs, doc.countries, selectionInLayer ? null : selected])
  /**
   * What "selected" looks like, drawn in a layer of its own.
   *
   * Selection is a fill and nothing else (`resolveCountryFill`), and it used to be *the*
   * entity's fill: clicking repainted that path inside the map's one layer. The browser then
   * had to raster every path overlapping the damaged region again — on Europe
   * Administrative, one click cost 45 ms of rasterising whether the app rebuilt one element or
   * a thousand, and no amount of care in React could make it cheaper, because the work was not
   * React's. Measured with the DOM alone, outside the app: 45.7 ms to change one `fill`
   * attribute in that layer.
   *
   * Here the land keeps its own paint for ever and the selection is a copy of the entity's
   * path, filled the selection colour, in a group the compositor holds by itself. Changing it
   * touches that group's raster and nothing else: 4.4 ms for the same click, and it no longer
   * grows with the map's density. The copies are the same geometry, the same clip and the same
   * border ink the entity would have been painted with, so what is on screen is what was on
   * screen before — within the antialiasing of a hairline where a neighbour's stroke used to
   * cross a selected edge.
   *
   * It sits directly above the land and below everything drawn over the land — the flag
   * territories, the border networks, the lakes, the names — which is exactly where a
   * selected country's fill sat when it was the country's fill. It never takes the pointer:
   * hit-testing reads the land beneath it, as it always has.
   */
  /*
   * Whether the selection layer is still being held after emptying.
   *
   * The layer costs one promotion to create, and a click that empties the selection would
   * otherwise drop it and the next click build it again — 97 ms a click on Europe
   * Administrative for someone tapping one entity on and off. It is held for a moment
   * instead, so that pattern costs nothing; and once the moment passes with nothing selected
   * the layer goes, and the map is again the map it was before any of this, to the pixel.
   */
  const [layerHeld, setLayerHeld] = useState(false)

  const selectionPaths = useMemo(() => {
    if (!selectionInLayer || selected.size === 0) return []
    const out: Array<{ id: string; d: string; fill: string; stroke: string; strokeWidth: number; paintOrder: string | undefined; clipPath: string | undefined; coast: string | undefined }> = []
    for (const shape of shapes) {
      if (!selected.has(shape.id)) continue
      const paint = paintCountry(shape, hoveredCountryId === shape.id, true)
      if (!paint) continue
      out.push({
        id: shape.id,
        d: shape.d,
        fill: paint.fill,
        stroke: paint.outline.stroke,
        strokeWidth: paint.outline.strokeWidth,
        paintOrder: paint.outline.paintOrder,
        clipPath: paint.clipPath,
        coast: coastAlone ? coastPaths.get(shape.id) : undefined,
      })
    }
    for (const shape of mergedShapes) {
      if (!selected.has(shape.id)) continue
      const paint = paintMerge(shape, true)
      out.push({
        id: shape.id,
        d: shape.d,
        fill: paint.fill,
        stroke: paint.outline.stroke,
        strokeWidth: paint.outline.strokeWidth,
        paintOrder: paint.outline.paintOrder,
        clipPath: paint.clipPath,
        coast: coastAlone ? coastPaths.get(shape.id) : undefined,
      })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, selectionInLayer, shapes, mergedShapes, hoveredCountryId, coastAlone, coastPaths, ...paintInputs, doc.countries])

  const anySelected = selectionPaths.length > 0
  useEffect(() => {
    if (anySelected) {
      setLayerHeld(true)
      return
    }
    const timer = window.setTimeout(() => setLayerHeld(false), SELECTION_LAYER_HOLD_MS)
    return () => window.clearTimeout(timer)
  }, [anySelected])

  const countryElement = (shape: (typeof shapes)[number], paint: NonNullable<ReturnType<typeof paintCountry>>) => (
    /*
     * The outline is coast and borders in one stroke, so it is drawn only when both layers
     * are on. With Borders off the coast is drawn on its own, from the same paint; with
     * Coastlines off the border network is drawn below. Resolved in `paintCountry` and
     * handed over as finished attribute values, so the path itself can bail out of a render
     * it has nothing to do with — see `CountryPath`.
     */
    <Fragment key={shape.id}>
      {coastBeside(shape.id, paint.outline, undefined, paint.clipPath, true)}
      <CountryPath
        countryId={shape.id}
        d={shape.d}
        fill={paint.fill}
        fillOpacity={paint.fillOpacity}
        stroke={outlineOn ? paint.outline.stroke : 'none'}
        strokeWidth={outlineOn ? paint.outline.strokeWidth : 0}
        paintOrder={paint.outline.paintOrder}
        transform={undefined}
        clipPath={paint.clipPath}
      />
      {coastBeside(shape.id, paint.outline, undefined, paint.clipPath, false)}
    </Fragment>
  )
  const countryLayer = useMemo(() => {
    const previous = countryElementCache.current
    const next = new Map<string, CachedCountryElement>()
    const elements: ReactElement[] = []
    const layerShapes: ShapeRef[] = []
    const indexById = new Map<string, number>()
    for (const { shape, paint } of countryPaints) {
      if (!paint) continue
      const coast = coastAlone ? coastPaths.get(shape.id) : undefined
      const old = previous.get(shape.id)
      const element =
        old && old.d === shape.d && old.coast === coast && old.outlineOn === outlineOn && samePaint(old.paint, paint)
          ? old.element
          : countryElement(shape, paint)
      next.set(shape.id, { d: shape.d, coast, outlineOn, paint, element })
      indexById.set(shape.id, elements.length)
      elements.push(element)
      layerShapes.push(shape)
    }
    countryElementCache.current = next
    /* In chunks: a chunk with exactly the elements it had last time is the same array. */
    const previousChunks = countryChunkCache.current
    const chunks: ReactElement[][] = []
    for (let start = 0; start < elements.length; start += COUNTRY_CHUNK) {
      const slice = elements.slice(start, start + COUNTRY_CHUNK)
      const old = previousChunks[chunks.length]
      chunks.push(old && old.length === slice.length && old.every((element, i) => element === slice[i]) ? old : slice)
    }
    countryChunkCache.current = chunks
    return { chunks, shapes: layerShapes, indexById }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countryPaints, outlineOn, coastAlone, coastPaths])
  /* The hovered entity, painted hovered, in its own place in the layer: one chunk changes. */
  let countryChunks = countryLayer.chunks
  const hoveredAt = hoveredCountryId ? countryLayer.indexById.get(hoveredCountryId) : undefined
  if (hoveredAt !== undefined) {
    const shape = countryLayer.shapes[hoveredAt]
    const paint = paintCountry(shape, true)
    if (paint) {
      const at = Math.floor(hoveredAt / COUNTRY_CHUNK)
      const chunk = countryChunks[at].slice()
      chunk[hoveredAt % COUNTRY_CHUNK] = countryElement(shape, paint)
      countryChunks = countryChunks.slice()
      countryChunks[at] = chunk
    }
  }

  return (
    <div className="map-canvas" ref={containerRef}>
      <svg
        id={MAP_SVG_ID}
        ref={svgRef}
        className={`map-canvas__svg${brushOn ? ' map-canvas__svg--brush' : ''}`}
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
        onMouseLeave={() => {
          setHovered(null)
          setHoveredWater(null)
        }}
        /*
         * Not while the map is being dragged — see `gesturingRef`. The pointer is
         * carrying the map rather than pointing at anything on it, so resolving a
         * country for it is work whose result nobody asked for.
         */
        onMouseMove={(event) => {
          if (gesturingRef.current || selectingRef.current) return
          if ((event.target as Element | null)?.closest?.(`[${OVERLAY_MARKER}]`)) return
          const id = pickCountryAt(event)
          setHovered(id)
          // The sea only where no land claims the point, so land's precedence is absolute.
          if (waterOn || hoveredWaterId) setHoveredWater(id ? null : waterAt(event.target))
        }}
        onClick={(event) => {
          // Dragging the legend is not a statement about the selection, so a click
          // that starts and ends on it leaves the selection exactly as it was.
          if ((event.target as Element | null)?.closest?.(`[${LEGEND_MARKER}]`)) return
          // An overlay tapped or dragged is chosen by the overlay layer, not selected here.
          if ((event.target as Element | null)?.closest?.(`[${OVERLAY_MARKER}]`)) return
          // A brush press has already selected what it touched — see `useSelectionGestures`.
          if (suppressClickRef.current) {
            suppressClickRef.current = false
            return
          }
          /*
           * Every click toggles. No modifier is consulted, because a phone has none —
           * see `selectCountry`. Shift-clicking still works; it simply is not required,
           * and does the same thing a plain click does.
           *
           * A click that hits no entity does nothing. It used to clear the selection, and
           * water is most of the map: a tap that missed a coastline by a pixel, or landed
           * between two islands, threw away a selection that could be a hundred
           * subdivisions built stroke by stroke. Starting over is the Clear button's job,
           * and it says so.
           */
          const id = pickCountryAt(event)
          if (!id) {
            /*
             * No land here. With Water Regions on, the sea is an entity too, so the click goes
             * to whichever region is under the pointer.
             */
            const water = waterAt(event.target)
            if (!water) return
            selectCountry(water)
            return
          }
          /*
           * A tap selects, whichever panel is open. It used to build merge groups while the
           * Merge panel was open, so the map answered differently depending on what was open
           * beside it and a selection could never be looked at before it went into a group.
           * Merge works from the selection now, like every other tool here.
           */
          selectCountry(id)
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
        {/*
          The resize correction, and nothing else.

          A plain group with no transform at all while the viewport is settled, which is
          every moment except the few frames of an actual resize — so the steady-state
          scene is exactly the scene it has always been. During a resize it carries the
          uniform scale that makes the not-yet-refitted map fill the new box; see
          `useSettledSize`.

          Outside the zoomed group rather than inside it because the two are different
          questions: this is "what size is the paper", the one below is "where is the
          camera". Keeping them separate is also what lets a gesture keep writing
          straight to the zoomed group without ever having to know a resize happened.
        */}
        <g transform={fitTransform}>
        <g
          ref={zoomedRef}
          transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}
          // The camera's scale on screen, for the lines drawn in it — see `screenStrokeWidth`.
          style={{ [MAP_SCALE_VAR]: transform.k * (fitCorrection?.scale ?? 1) } as CSSProperties}
        >
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
          {/*
            The named oceans and seas, beneath everything — including the graticule, so the grid
            still reads over a coloured sea. Rendered only while the layer is on: switched off
            there is no element, no hit target and no change to the scene at all.
          */}
          {waterOn && waterShapes.length > 0 && (
            <MapWaters
              shapes={waterShapes}
              paint={doc.waters ?? {}}
              selected={selectedWaters}
              hoveredId={hoveredWaterId}
              selectedColor={style.selected}
              hoverColor={style.hover}
            />
          )}
          {style.showSphere && backdrop.sphere && (
            <path
              d={backdrop.sphere}
              fill="none"
              stroke={style.graticule}
              style={{ strokeWidth: screenStrokeWidth(1.6) }}
              strokeOpacity={0.95}
            />
          )}
          {style.showGraticule && backdrop.graticule && (
            <path
              d={backdrop.graticule}
              fill="none"
              stroke={style.graticule}
              style={{ strokeWidth: screenStrokeWidth(0.5) }}
              strokeOpacity={0.65}
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

          {/*
            The land in a group of its own, keyed by the dataset of the land drawn — not of
            the dataset loaded, which arrives before its outlines on a progressive map. When a
            level's outlines arrive, a new group mounts with every path already in it — one
            insertion — instead of 32,000 paths placed one at a time among the layers around
            them, which held the page after the outlines were ready. Within a dataset the
            group stays and its paths update.
          */}
          <g key={land?.geo?.dataset.id ?? 'none'}>
          {countryChunks.map((elements, index) => (
            <CountryChunk key={index} elements={elements} />
          ))}
          </g>

          {/*
            Merged bodies.

            One path for the whole dissolved entity, drawn where its members would have
            been — so the borders between them are not hidden, they do not exist in this
            geometry. Everything else about it is an ordinary country path: same border
            treatment, same paint order, same clickability.
          */}
          {mergedPaints.map(({ shape, paint }) => (
            <Fragment key={shape.id}>
              {coastBeside(shape.id, paint.outline, undefined, paint.clipPath, true)}
              <CountryPath
                countryId={shape.id}
                mergeId={shape.id}
                d={shape.d}
                fill={paint.fill}
                fillOpacity={undefined}
                stroke={outlineOn ? paint.outline.stroke : 'none'}
                strokeWidth={outlineOn ? paint.outline.strokeWidth : 0}
                paintOrder={paint.outline.paintOrder}
                transform={undefined}
                clipPath={paint.clipPath}
              />
              {coastBeside(shape.id, paint.outline, undefined, paint.clipPath, false)}
            </Fragment>
          ))}

          {/*
            The selection, over the land and under everything drawn on the land.

            Its own compositor layer (`will-change`), which is the whole point: a click
            re-rasters this group alone instead of every path overlapping the one it touched.
            See `selectionPaths`. `pointer-events: none` keeps hit-testing on the land itself.
          */}
          <g
            className="map-selection"
            /*
             * Asked for only while something is selected. A layer held over the map for ever
             * changes, very slightly, how the map under it is rasterised — 410 pixels of a
             * 900,000-pixel frame, along edges — and a map with nothing selected should be the
             * map it always was, to the pixel. With nothing selected there is nothing here to
             * carry, so there is nothing to promote either.
             */
            style={anySelected || layerHeld ? SELECTION_LAYER_STYLE : undefined}
            pointerEvents="none"
          >
            {/*
              Bounds that do not move while a selection lives.

              The layer's size follows its contents, and a layer that changes size is built
              again: selecting one entity after another, each of a different size, rebuilt it
              every time — 99 ms a click on Europe Administrative. This rectangle paints
              nothing and covers the map, so the layer is made once, at one size, and every
              change after that is a repaint of it alone: 4.6 ms.
            */}
            {(anySelected || layerHeld) && (
              <rect
                x={-width}
                y={-height}
                width={width * 3}
                height={height * 3}
                fill="#000"
                fillOpacity={0}
              />
            )}
            {selectionPaths.map((entry) => (
              <SelectedShape
                key={entry.id}
                entityId={entry.id}
                d={entry.d}
                fill={entry.fill}
                stroke={outlineOn ? entry.stroke : 'none'}
                strokeWidth={outlineOn ? entry.strokeWidth : 0}
                paintOrder={entry.paintOrder}
                clipPath={entry.clipPath}
                coast={entry.coast}
              />
            ))}
          </g>

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
              showOutline={style.showBorders && style.showCoastlines}
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
          {style.showBorders &&
            !style.showCoastlines &&
            lineNetworks.borders.map((layer) => (
              <path
                key={`borders-${layer.clipId ?? 'main'}`}
                d={layer.d}
                fill="none"
                stroke={flagsOn ? FLAG_BORDER_COLOR : style.border}
                style={{ strokeWidth: screenStrokeWidth(flagsOn ? boundaryInkWidth(style.borderWidth, zoomK) : style.borderWidth) }}
                strokeLinejoin="round"
                strokeLinecap="butt"
                pointerEvents="none"
                clipPath={layer.clipId ? `url(#map-inset-${layer.clipId})` : undefined}
              />
            ))}

          {/*
            National borders, over the internal ones, on a map of subdivisions.

            Every line between two subdivisions is a border, and the outlines above draw them
            all at one weight. This is the subset between two different countries, drawn
            heavier on top, so a map of provinces still reads as a map of countries. It
            answers to the Borders switch like every other political line and never to
            Coastlines — no coast is in it. Under the flags' international treatment it is
            left to that treatment, which is drawn on this same network just below.
          */}
          {style.showBorders &&
            hasNational &&
            !(flagsOn && doc.flags.internationalBorders) &&
            lineNetworks.national.map((layer) => (
              <path
                key={`national-${layer.clipId ?? 'main'}`}
                d={layer.d}
                fill="none"
                stroke={flagsOn ? FLAG_BORDER_COLOR : style.border}
                style={{ strokeWidth: screenStrokeWidth(style.borderWidth * NATIONAL_BORDER_SCALE) }}
                strokeLinejoin="round"
                strokeLinecap="butt"
                pointerEvents="none"
                clipPath={layer.clipId ? `url(#map-inset-${layer.clipId})` : undefined}
              />
            ))}

          {/*
            The international treatment runs along the borders between countries — on a map
            of subdivisions that is the national network, not every provincial line.
          */}
          {flagsOn &&
            doc.flags.internationalBorders &&
            style.showBorders &&
            (hasNational ? lineNetworks.national : lineNetworks.borders).map((layer) => (
              <g
                key={`boundary-${layer.clipId ?? 'main'}`}
                clipPath={layer.clipId ? `url(#map-inset-${layer.clipId})` : undefined}
              >
                <path
                  d={layer.d}
                  fill="none"
                  stroke={FLAG_BOUNDARY_EDGE}
                  style={{ strokeWidth: screenStrokeWidth(boundaryEdgeWidth(style.borderWidth, zoomK)) }}
                  strokeLinejoin="round"
                  strokeLinecap="butt"
                  pointerEvents="none"
                />
                <path
                  d={layer.d}
                  fill="none"
                  stroke={FLAG_BOUNDARY_INK}
                  style={{ strokeWidth: screenStrokeWidth(boundaryInkWidth(style.borderWidth, zoomK)) }}
                  strokeLinejoin="round"
                  strokeLinecap="butt"
                  pointerEvents="none"
                />
              </g>
            ))}

          {/*
            Inland water, over the land it sits in.

            Pointer events stay enabled so a lake behaves like water rather than like
            the country underneath: hovering or clicking one does not pick a country.
            It carries no `data-country-id`, so `pickCountryAt` finds nothing on it and
            falls through — which still lets a microstate's assist zone win over a lake.
          */}
          {hiddenWaterClip && (
            <clipPath id="map-hidden-territories" clipPathUnits="userSpaceOnUse">
              <path d={hiddenWaterClip} clipRule="evenodd" fillRule="evenodd" />
            </clipPath>
          )}
          {style.showLakes && lakePath && (
            <path
              d={lakePath}
              fill={style.lake}
              stroke={style.lakeOutline}
              style={{ strokeWidth: screenStrokeWidth(0.5) }}
              clipPath={hiddenWaterClip ? 'url(#map-hidden-territories)' : undefined}
            />
          )}

          {/*
            Rivers, over the land and the lakes they run through.

            After the lakes deliberately: Natural Earth's centrelines carry the course a
            river takes *through* a lake, and drawing them under the water would cut each
            one in half at every lake on its way to the sea.

            Stroked and never filled — a river is a line — with a non-scaling stroke so
            it stays a hairline at every zoom instead of swelling into a ribbon. Pointer
            events are off so a river never intercepts a click meant for the country it
            crosses.
          */}
          {style.showRivers && riverPath && (
            <path
              d={riverPath}
              fill="none"
              stroke={style.river}
              style={{ strokeWidth: screenStrokeWidth(style.riverWidth) }}
              strokeLinecap="round"
              strokeLinejoin="round"
              pointerEvents="none"
              clipPath={hiddenWaterClip ? 'url(#map-hidden-territories)' : undefined}
            />
          )}

          {/*
            Selection is a fill, and only a fill.

            There used to be a two-layer outline here — a contrasting casing with the
            theme's selection colour over it — drawn round every selected country. It has
            been removed: a selected country now reads by its colour alone, which
            `resolveCountryFill` gives it ahead of any data colour. The outline was a
            second signal for one state, it sat on top of the country's real borders and
            thickened them, and it survived into every export.

            Nothing replaces it. The small-entity lens below is a different thing — a
            callout for territories too small to see, not a border round one.
          */}

          {/*
            The names, over everything the map draws.

            Last inside the transformed group, so a name is never covered by a flag, a
            border, a lake or a selection outline — and still inside it, so the camera
            moves the names with the land they belong to.
          */}
          {textOn && <MapLabels placements={labelsToDraw} labels={labels} />}

          {/*
            Map overlays, over everything the map draws and inside the camera, so they move with
            the land and are exported with it — see `MapOverlays`.
          */}
          {projection && visibleOverlays.length > 0 && (
            <MapOverlays
              overlays={visibleOverlays}
              sources={overlaySources}
              projection={projection}
              zoomK={zoomK}
              zoomedRef={zoomedRef}
              onSelect={chooseOverlay}
              onMove={moveOverlay}
              flags={overlayFlags}
            />
          )}
        </g>
        </g>

        {/*
          Magnifiers for selected small entities, in screen space. Placed from the
          committed camera here, and from the live one by the zoom behaviour while a
          gesture is moving the map — see `MapLenses`.
        */}
        <MapLenses
          ref={lensesRef}
          lenses={lenses}
          transform={transform}
          fit={fitCorrection}
          width={width}
          height={height}
          outline={style.selectedOutline}
          background={style.background}
        />
        {/*
          The legend, in screen space and drawn last so nothing covers it. Inside the
          `<svg>` deliberately: the exporter copies this element, so a legend rendered
          as an HTML overlay would be absent from every PNG, JPG and SVG.
        */}
        <MapLegend doc={doc} width={width} height={height} />

        {/*
          The caption, last of all and in screen space. Drawn after the legend so nothing
          can cover it, and positioned against the resolved composition frame — which is
          the whole canvas until an author sets a Screen, so one rule covers both.
        */}
        <MapCaption caption={doc.caption} frame={screen} />
      </svg>

      {/*
        The Selection panel's rectangle and brush ring — see `useSelectionGestures`. HTML
        beside the map, like the composition frame below, so no export can contain them.
      */}
      <div ref={selectionOverlayRef} className="map-canvas__selection" aria-hidden="true">
        <div className="map-canvas__marquee" hidden />
        <div className="map-canvas__brush" hidden />
      </div>

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
          {/*
            A subdivision's ISO 3166-2 code where it has one — DE-BY rather than DEU-1591.
            A water region has no code of that kind, so it is named and nothing more.
          */}
          {hoveredCountryId && (
            <span className="map-canvas__hover-code">
              {geo?.meta[hoveredCountryId]?.source?.iso31662 || hoveredCountryId}
            </span>
          )}
          {hoveredName}
        </div>
      )}

      {/* Also while a progressive map's first outlines are still being projected. */}
      {(geoStatus !== 'ready' || (geo !== null && land?.geo !== geo)) && (
        <div className="map-canvas__status">
          {geoStatus === 'error' ? `Failed to load geography: ${geoError}` : 'Loading geography…'}
        </div>
      )}
    </div>
  )
}
