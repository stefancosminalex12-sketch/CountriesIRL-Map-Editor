/**
 * Map overlays: movable copies of entities' shapes, drawn over the map. See `overlayGeometry.ts`.
 *
 * Inside the zoomed group and above everything else the map draws, so an overlay moves with the
 * camera exactly as the land does and is exported with the map.
 *
 * Overlays take the pointer in every mode and whichever panel is open — Flags mode is worked from the
 * Data panel, and an overlay that answered only while the Overlays panel was open could not be
 * moved there: a drag on it panned the map and a tap on it selected the country beneath. A press on
 * an overlay is the overlay's: it is chosen and dragged, and the map's own gestures and clicks leave
 * it alone (see `OVERLAY_MARKER`).
 *
 * A drag moves an overlay by the pointer's own movement in the map's coordinates, so it follows
 * the finger at every zoom. It is shown from local state while it runs — the map is not
 * re-rendered for it — and committed to the document once, on release: one undo step.
 *
 * An overlay filled with a flag shows it framed exactly as the map frames the entity's own flag —
 * over its dominant landmass, with each detached territory that earns one framed on its own — in the
 * coordinates its outline is drawn in, and painted only inside that outline: every island and
 * exclave of it, and nowhere else. The flag is the overlay's own (`MapOverlay.flag`).
 *
 * Nothing marks the chosen overlay on the map: it looks exactly as it does when it is not chosen, and
 * which one is being edited is shown in the Overlays panel alone. A dashed outline and a round handle
 * used to be drawn on it; both read as a selection marker over the map rather than as part of it.
 */
import { memo, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { geoPath, type GeoProjection } from 'd3-geo'
import type { MultiPolygon } from 'geojson'
import type { MapOverlay } from '../types/map'
import { anchorAt, carry, placeOverlay, type OverlayPlacement, type OverlaySource } from './overlayGeometry'
import { fitFlag, patternGeometry, type FlagFit } from './MapFlags'
import { flagFraming } from './flagPlacement'

/** Marks overlay elements, so the map's own gestures and clicks leave them to this layer. */
export const OVERLAY_MARKER = 'data-overlay-id'

/** Screen pixels between texture lines or dots, and their weight. */
const TEXTURE_SPACING_PX = 7
const TEXTURE_WEIGHT_PX = 1.1
/** The tint under the texture, as a share of the overlay's own opacity. */
const TINT = 0.35
/** The outline, in screen pixels. */
const OUTLINE_PX = 1.6

const textureId = (id: string) => `map-overlay-texture-${id}`
const flagFillId = (id: string) => `map-overlay-flag-${id}`

/** A flag filling an overlay: its main framing, and one for each detached territory that earns its own. */
interface OverlayFlag {
  fit: FlagFit
  territories: Array<{ key: string; fit: FlagFit; d: string }>
}

/**
 * How a flag filling an overlay is framed: exactly as the map frames the entity's own flag.
 *
 * By `fitFlag` over the dominant landmass cluster, with each detached territory that earns a flag of
 * its own — French Guiana, Alaska — framed separately and drawn on its own outline, by the map's own
 * rule (`flagFraming`). Framed over all its land at once, France showed one stripe of the tricolour.
 * In the coordinates the overlay's outline is drawn in: the entity's own place for a Shape overlay
 * or one not yet moved, so the flag moves and scales with it, or the land carried to where a
 * Projection-aware overlay has been put — a rotation of the globe, which keeps every distance, so the
 * clusters are still the clusters.
 */
function overlayFlag(
  overlay: Pick<MapOverlay, 'mode' | 'anchor'>,
  source: OverlaySource,
  projection: GeoProjection,
): OverlayFlag | null {
  const { main, territories } = flagFraming(source.geometry)
  const to = overlay.anchor && overlay.mode === 'projection' ? overlay.anchor : null
  const drawnWith = to ? projection : source.homeProjection
  const place = (land: MultiPolygon): MultiPolygon => (to ? (carry(land, source.geoCentre, to) as MultiPolygon) : land)
  const path = geoPath(drawnWith)
  const fit = fitFlag(place(main), path, drawnWith)
  if (!fit) return null
  const framed = territories.flatMap((land, index) => {
    const placed = place(land)
    const territoryFit = fitFlag(placed, path, drawnWith)
    const d = path(placed)
    return territoryFit && d ? [{ key: `t${index}`, fit: territoryFit, d }] : []
  })
  return { fit, territories: framed }
}

/** The placement as an SVG transform: a translation and a uniform scale. */
const transformOf = (place: OverlayPlacement) =>
  place.matrix ? `matrix(${place.matrix[0]},0,0,${place.matrix[0]},${place.matrix[1]},${place.matrix[2]})` : undefined

export interface MapOverlaysProps {
  overlays: MapOverlay[]
  sources: ReadonlyMap<string, OverlaySource>
  projection: GeoProjection
  zoomK: number
  zoomedRef: RefObject<SVGGElement>
  onSelect: (id: string) => void
  onMove: (id: string, anchor: [number, number]) => void
  /** The artwork of each overlay filled with a flag, by overlay id, once it has arrived. */
  flags: ReadonlyMap<string, string>
}

interface Drag {
  id: string
  pointerId: number
  /** Where the press began, in the zoomed group's coordinates. */
  start: [number, number]
  /** Where the overlay's centre was drawn when it did. */
  centre: [number, number]
  anchor: [number, number] | null
}

export const MapOverlays = memo(function MapOverlays({
  overlays,
  sources,
  projection,
  zoomK,
  zoomedRef,
  onSelect,
  onMove,
  flags,
}: MapOverlaysProps) {
  const drag = useRef<Drag | null>(null)
  const [preview, setPreview] = useState<{ id: string; anchor: [number, number] } | null>(null)

  /*
   * Where each overlay rests, worked out once per change to the overlays — not on every frame
   * of a drag, when all but one of them stay where they are. A projection-aware overlay is
   * reprojected to be placed, so with several on the map this is most of a frame's work.
   */
  const resting = useMemo(() => {
    const out = new Map<string, OverlayPlacement | null>()
    for (const overlay of overlays) {
      const source = sources.get(overlay.sourceId)
      out.set(
        overlay.id,
        source ? placeOverlay({ mode: overlay.mode, anchor: overlay.anchor, scale: overlay.scale ?? 1 }, source, projection) : null,
      )
    }
    return out
  }, [overlays, sources, projection])

  /* Where each flag-filled overlay's flag is framed, at rest: worked out with the placements, never per frame. */
  const restingFits = useMemo(() => {
    const out = new Map<string, OverlayFlag | null>()
    for (const overlay of overlays) {
      if (overlay.texture !== 'flag') continue
      const source = sources.get(overlay.sourceId)
      out.set(overlay.id, source ? overlayFlag(overlay, source, projection) : null)
    }
    return out
  }, [overlays, sources, projection])

  const placed = useMemo(() => {
    const out: Array<{ overlay: MapOverlay; place: OverlayPlacement; flag: OverlayFlag | null }> = []
    for (const overlay of overlays) {
      let place = resting.get(overlay.id) ?? null
      let flag = restingFits.get(overlay.id) ?? null
      // The one being dragged is placed where the pointer has it.
      if (preview?.id === overlay.id) {
        const source = sources.get(overlay.sourceId)
        place = source
          ? placeOverlay({ mode: overlay.mode, anchor: preview.anchor, scale: overlay.scale ?? 1 }, source, projection)
          : null
        // A Projection-aware overlay is new land wherever it goes, so its flag is framed again; a Shape overlay's moves with it.
        if (source && overlay.texture === 'flag' && overlay.mode === 'projection') {
          flag = overlayFlag({ mode: overlay.mode, anchor: preview.anchor }, source, projection)
        }
      }
      if (place) out.push({ overlay, place, flag })
    }
    return out
  }, [overlays, sources, projection, resting, restingFits, preview])

  if (placed.length === 0) return null

  const k = zoomK > 0 ? zoomK : 1

  const toMap = (clientX: number, clientY: number): [number, number] | null => {
    const matrix = zoomedRef.current?.getScreenCTM()
    if (!matrix) return null
    const p = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse())
    return [p.x, p.y]
  }

  const begin = (event: ReactPointerEvent<SVGElement>, overlay: MapOverlay, centre: [number, number]) => {
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return
    const start = toMap(event.clientX, event.clientY)
    if (!start) return
    // The press is the overlay's: not a pan, not a brush stroke, not a text selection.
    event.preventDefault()
    event.stopPropagation()
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // A pointer already gone cannot be captured; its release still ends the drag.
    }
    drag.current = { id: overlay.id, pointerId: event.pointerId, start, centre, anchor: null }
    onSelect(overlay.id)
  }

  const move = (event: ReactPointerEvent<SVGElement>) => {
    const current = drag.current
    if (!current || event.pointerId !== current.pointerId) return
    const at = toMap(event.clientX, event.clientY)
    if (!at) return
    const anchor = anchorAt(
      [current.centre[0] + at[0] - current.start[0], current.centre[1] + at[1] - current.start[1]],
      projection,
    )
    // Off the edge of the globe the overlay waits where it last was.
    if (!anchor) return
    current.anchor = anchor
    setPreview({ id: current.id, anchor })
  }

  const end = (event: ReactPointerEvent<SVGElement>) => {
    const current = drag.current
    if (!current || event.pointerId !== current.pointerId) return
    drag.current = null
    if (current.anchor) onMove(current.id, current.anchor)
    setPreview(null)
  }

  const handlers = (overlay: MapOverlay, centre: [number, number]) => ({
    onPointerDown: (event: ReactPointerEvent<SVGElement>) => begin(event, overlay, centre),
    onPointerMove: move,
    onPointerUp: end,
    onPointerCancel: end,
  })

  return (
    <g className="map-overlays">
      <defs>
        {placed.map(({ overlay, place }) => {
          if (overlay.texture !== 'hatch' && overlay.texture !== 'dots') return null
          /*
           * The texture lies in the overlay's own coordinates, which the camera and the overlay's
           * scale both enlarge: spaced against both, it stays the same few pixels on screen at
           * every zoom and every size.
           */
          const s = k * (place.matrix ? place.matrix[0] : 1)
          const spacing = TEXTURE_SPACING_PX / s
          const weight = TEXTURE_WEIGHT_PX / s
          return (
            <pattern
              key={overlay.id}
              id={textureId(overlay.id)}
              patternUnits="userSpaceOnUse"
              width={spacing}
              height={spacing}
              patternTransform={overlay.texture === 'hatch' ? 'rotate(45)' : undefined}
            >
              {overlay.texture === 'hatch' ? (
                <line x1={spacing / 2} y1={0} x2={spacing / 2} y2={spacing} stroke={overlay.color} strokeWidth={weight} />
              ) : (
                <circle cx={spacing / 2} cy={spacing / 2} r={weight} fill={overlay.color} />
              )}
            </pattern>
          )
        })}
        {/*
          Flags, framed by the same `patternGeometry` a country's flag is, in the overlay's own
          coordinates — so the flag moves and scales with the overlay, and is painted only where its
          outline is.
        */}
        {placed.flatMap(({ overlay, flag }) => {
          const href = overlay.texture === 'flag' ? flags.get(overlay.id) : undefined
          if (!href || !flag) return []
          const framings = [
            { id: flagFillId(overlay.id), fit: flag.fit },
            ...flag.territories.map((territory) => ({ id: `${flagFillId(overlay.id)}-${territory.key}`, fit: territory.fit })),
          ]
          return framings.flatMap(({ id, fit }) => {
            const geometry = patternGeometry(fit)
            if (!geometry) return []
            return [
              <pattern
                key={id}
                id={id}
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
          })
        })}
      </defs>

      {placed.map(({ overlay, place, flag }) => (
        <g
          key={overlay.id}
          {...{ [OVERLAY_MARKER]: overlay.id }}
          transform={transformOf(place)}
          opacity={overlay.opacity}
          pointerEvents="visiblePainted"
          style={{ cursor: 'move', touchAction: 'none' }}
          {...handlers(overlay, place.centre)}
        >
          {overlay.texture === 'flag' && flag && flags.has(overlay.id) ? (
            // A flag replaces the tint: the overlay is the flag, clipped to its outline, and each
            // detached territory carries its own framing on its own land — as the map draws them.
            <>
              <path d={place.d} fill={`url(#${flagFillId(overlay.id)})`} />
              {flag.territories.map((territory) => (
                <path key={territory.key} d={territory.d} fill={`url(#${flagFillId(overlay.id)}-${territory.key})`} />
              ))}
            </>
          ) : (
            <path d={place.d} fill={overlay.color} fillOpacity={TINT} />
          )}
          {(overlay.texture === 'hatch' || overlay.texture === 'dots') && (
            <path d={place.d} fill={`url(#${textureId(overlay.id)})`} />
          )}
          <path
            d={place.d}
            fill="none"
            stroke={overlay.color}
            strokeWidth={OUTLINE_PX}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </g>
      ))}
    </g>
  )
})
