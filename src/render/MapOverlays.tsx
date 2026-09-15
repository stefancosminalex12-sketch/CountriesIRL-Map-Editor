/**
 * Map overlays: movable copies of entities' shapes, drawn over the map. See `overlayGeometry.ts`.
 *
 * Inside the zoomed group and above everything else the map draws, so an overlay moves with the
 * camera exactly as the land does and is exported with the map. Overlays answer the pointer only
 * while the Overlays panel is open; the rest of the time they are pictures, and every click and
 * drag goes to the map beneath them as it always has.
 *
 * A drag moves an overlay by the pointer's own movement in the map's coordinates, so it follows
 * the finger at every zoom. It is shown from local state while it runs — the map is not
 * re-rendered for it — and committed to the document once, on release: one undo step.
 *
 * The chosen overlay's dashed outline and handle are editor furniture, marked `data-export="none"`
 * so no PNG, JPG or SVG contains them. The handle is what makes a speck — an overlay of Monaco —
 * something a pointer can take hold of.
 */
import { memo, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import type { GeoProjection } from 'd3-geo'
import type { MapOverlay } from '../types/map'
import { anchorAt, placeOverlay, type OverlayPlacement, type OverlaySource } from './overlayGeometry'

/** Marks overlay elements, so the map's own gestures and clicks leave them to this layer. */
export const OVERLAY_MARKER = 'data-overlay-id'

/** Screen pixels between texture lines or dots, and their weight. */
const TEXTURE_SPACING_PX = 7
const TEXTURE_WEIGHT_PX = 1.1
/** The tint under the texture, as a share of the overlay's own opacity. */
const TINT = 0.35
/** The outline, in screen pixels. */
const OUTLINE_PX = 1.6
/** The chosen overlay's handle, as a radius in screen pixels. */
const HANDLE_PX = 7

const textureId = (id: string) => `map-overlay-texture-${id}`

/** The placement as an SVG transform: a translation and a uniform scale. */
const transformOf = (place: OverlayPlacement) =>
  place.matrix ? `matrix(${place.matrix[0]},0,0,${place.matrix[0]},${place.matrix[1]},${place.matrix[2]})` : undefined

export interface MapOverlaysProps {
  overlays: MapOverlay[]
  sources: ReadonlyMap<string, OverlaySource>
  projection: GeoProjection
  zoomK: number
  /** Whether the Overlays panel is open: only then do overlays take the pointer. */
  interactive: boolean
  activeId: string | null
  /** The selection colour, for the chosen overlay's outline and handle. */
  accent: string
  zoomedRef: RefObject<SVGGElement>
  onSelect: (id: string) => void
  onMove: (id: string, anchor: [number, number]) => void
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
  interactive,
  activeId,
  accent,
  zoomedRef,
  onSelect,
  onMove,
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

  const placed = useMemo(() => {
    const out: Array<{ overlay: MapOverlay; place: OverlayPlacement }> = []
    for (const overlay of overlays) {
      let place = resting.get(overlay.id) ?? null
      // The one being dragged is placed where the pointer has it.
      if (preview?.id === overlay.id) {
        const source = sources.get(overlay.sourceId)
        place = source
          ? placeOverlay({ mode: overlay.mode, anchor: preview.anchor, scale: overlay.scale ?? 1 }, source, projection)
          : null
      }
      if (place) out.push({ overlay, place })
    }
    return out
  }, [overlays, sources, projection, resting, preview])

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

  const handlers = (overlay: MapOverlay, centre: [number, number]) =>
    interactive
      ? {
          onPointerDown: (event: ReactPointerEvent<SVGElement>) => begin(event, overlay, centre),
          onPointerMove: move,
          onPointerUp: end,
          onPointerCancel: end,
        }
      : {}

  const chosen = interactive ? placed.find(({ overlay }) => overlay.id === activeId) ?? null : null

  return (
    <g className="map-overlays">
      <defs>
        {placed.map(({ overlay, place }) => {
          if (overlay.texture === 'none') return null
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
      </defs>

      {placed.map(({ overlay, place }) => (
        <g
          key={overlay.id}
          {...{ [OVERLAY_MARKER]: overlay.id }}
          transform={transformOf(place)}
          opacity={overlay.opacity}
          pointerEvents={interactive ? 'visiblePainted' : 'none'}
          style={interactive ? { cursor: 'move', touchAction: 'none' } : undefined}
          {...handlers(overlay, place.centre)}
        >
          <path d={place.d} fill={overlay.color} fillOpacity={TINT} />
          {overlay.texture !== 'none' && <path d={place.d} fill={`url(#${textureId(overlay.id)})`} />}
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

      {chosen && (
        <g data-export="none" {...{ [OVERLAY_MARKER]: chosen.overlay.id }}>
          <path
            d={chosen.place.d}
            transform={transformOf(chosen.place)}
            fill="none"
            stroke={accent}
            strokeWidth={1.4}
            strokeDasharray="5 4"
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
          <circle
            cx={chosen.place.centre[0]}
            cy={chosen.place.centre[1]}
            r={HANDLE_PX / k}
            fill={accent}
            stroke="#ffffff"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
            style={{ cursor: 'move', touchAction: 'none' }}
            {...handlers(chosen.overlay, chosen.place.centre)}
          />
        </g>
      )}
    </g>
  )
})
