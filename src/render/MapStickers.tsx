/**
 * Stickers, drawn on the territories.
 *
 * Each sticker's artwork is defined once, as a `<symbol>`, and every entity wearing it is a
 * `<use>` of that symbol. Two hundred countries wearing six faces is therefore six images the
 * browser decodes and two hundred cheap references, rather than two hundred copies of a data URI
 * in the DOM.
 *
 * Like the names, they live in projected user space inside the camera's group, so panning and
 * zooming carry them with the land and they keep their size relative to their country. Inside
 * the map's `<svg>`, so every export contains them.
 *
 * **A click on a sticker is a click on its country** (`STICKER_MARKER`): it selects or deselects
 * the country wearing it, even where the sticker is larger than a small country. The stickers of
 * the selected countries are ringed on screen — they are the ones the Stickers panel's colour and
 * size change — never in an export (`data-export="none"`).
 *
 * **A ringed sticker can be dragged, and only around its own territory.** Only the selected
 * countries' stickers take a press (`STICKER_DRAG_MARKER`), so a map with a face on every country
 * still pans when it is dragged; selecting a country — a click on its sticker does it — is what
 * lets its sticker move. The sticker's centre never leaves the territory's land as the map draws
 * it: where the pointer goes off it, the sticker slides along the edge or waits at it. It is shown
 * from local state while it moves and committed once, on release (`move_sticker`): one undo step.
 * A press that does not move is still a click, and selects or deselects as before. Not while the
 * brush is on, when a press is a selection stroke.
 */
import { Fragment, memo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import type { Sticker } from '../stickers/types'
import { onStickerInk, primeStickerInk } from './stickerHit'

/** Marks a sticker on the map, with the entity wearing it: a click there is the sticker's. */
export const STICKER_MARKER = 'data-sticker-of'
/** Marks a sticker a press would drag: the map's own pan and selection gestures leave it alone. */
export const STICKER_DRAG_MARKER = 'data-sticker-drag'

/** How far, in screen pixels, a press travels before it is a drag rather than a click. */
const DRAG_SLOP_PX = 4
/** Halvings toward the edge when the pointer has left the territory. */
const EDGE_STEPS = 12

export interface PlacedSticker {
  id: string
  stickerId: string
  /** Centre, in map units. */
  x: number
  y: number
  /** Edge of the square the artwork is fitted into, in map units. */
  size: number
}

interface Props {
  placements: PlacedSticker[]
  stickers: Map<string, Sticker>
  /** The selected entities: their stickers are ringed on screen, and can be dragged. */
  activeIds: readonly string[]
  /** The chosen sticker, by its wearer: it glows white and can be dragged. */
  chosenId: string | null
  /** Whether the ringed stickers take a press at all. */
  draggable: boolean
  /** The camera's group, whose coordinates the stickers are placed in. */
  zoomedRef: RefObject<SVGGElement | null>
  /** Whether a point, in map units, is on the entity's own land. */
  onLand: (id: string, x: number, y: number) => boolean
  /** A drag let go: the sticker's new centre, in map units. */
  onMove: (id: string, x: number, y: number) => void
}

interface Drag {
  id: string
  pointerId: number
  /** Where the press began, on screen and in map units. */
  client: [number, number]
  start: [number, number]
  /** The sticker's centre when it did, and the last centre found on its land. */
  centre: [number, number]
  at: [number, number]
  moving: boolean
}

export const MapStickers = memo(function MapStickers({
  placements: resting,
  stickers,
  activeIds,
  chosenId,
  draggable,
  zoomedRef,
  onLand,
  onMove,
}: Props) {
  const drag = useRef<Drag | null>(null)
  /** Set by a drag's release, so the click that follows it selects nothing. */
  const dragged = useRef(false)
  const [preview, setPreview] = useState<{ id: string; x: number; y: number } | null>(null)
  // The one being dragged is drawn where the pointer has it; the rest stay as they are.
  const placements = preview
    ? resting.map((p) => (p.id === preview.id ? { ...p, x: preview.x, y: preview.y } : p))
    : resting

  const used = [...new Set(placements.map((p) => p.stickerId))].filter((id) => stickers.has(id))
  const symbolOf = new Map(used.map((id, index) => [id, `map-sticker-${index}`]))

  const toMap = (clientX: number, clientY: number): [number, number] | null => {
    const matrix = zoomedRef.current?.getScreenCTM()
    if (!matrix) return null
    const p = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse())
    return [p.x, p.y]
  }

  /**
   * Where the sticker goes for a pointer that wants it at `want`: there, when that is on its land;
   * otherwise the point on its land nearest to `want` among a few reached in straight lines from
   * where it is — straight toward the pointer up to the edge, and from there, or from where it is,
   * along each axis — so it runs up to a coast and then slides along it after the pointer.
   */
  const settle = (id: string, from: [number, number], want: [number, number]): [number, number] => {
    if (onLand(id, want[0], want[1])) return want
    // The furthest point along `a` → `b` still on the land, `a` being on it.
    const toward = (a: [number, number], b: [number, number]): [number, number] => {
      let inside = 0
      let outside = 1
      for (let i = 0; i < EDGE_STEPS; i++) {
        const t = (inside + outside) / 2
        if (onLand(id, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)) inside = t
        else outside = t
      }
      return [a[0] + (b[0] - a[0]) * inside, a[1] + (b[1] - a[1]) * inside]
    }
    const edge = toward(from, want)
    const candidates = [
      edge,
      toward(edge, [want[0], edge[1]]),
      toward(edge, [edge[0], want[1]]),
      toward(from, [want[0], from[1]]),
      toward(from, [from[0], want[1]]),
    ]
    const distance = (p: [number, number]) => Math.hypot(p[0] - want[0], p[1] - want[1])
    return candidates.reduce((best, p) => (distance(p) < distance(best) ? p : best))
  }

  const begin = (event: ReactPointerEvent<SVGElement>, p: PlacedSticker) => {
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return
    // On a clear corner of the sticker's box the press is the map's, to pan with. See `stickerHit.ts`.
    if (!onStickerInk(event.currentTarget, event.clientX, event.clientY)) return
    const start = toMap(event.clientX, event.clientY)
    if (!start) return
    // The press is the sticker's: not a pan, not a text selection. A click still follows it.
    event.preventDefault()
    event.stopPropagation()
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // A pointer already gone cannot be captured; its release still ends the drag.
    }
    dragged.current = false
    drag.current = {
      id: p.id,
      pointerId: event.pointerId,
      client: [event.clientX, event.clientY],
      start,
      centre: [p.x, p.y],
      at: [p.x, p.y],
      moving: false,
    }
  }

  const move = (event: ReactPointerEvent<SVGElement>) => {
    const current = drag.current
    if (!current || event.pointerId !== current.pointerId) return
    if (!current.moving) {
      if (Math.hypot(event.clientX - current.client[0], event.clientY - current.client[1]) < DRAG_SLOP_PX) return
      current.moving = true
    }
    const point = toMap(event.clientX, event.clientY)
    if (!point) return
    const want: [number, number] = [
      current.centre[0] + point[0] - current.start[0],
      current.centre[1] + point[1] - current.start[1],
    ]
    current.at = settle(current.id, current.at, want)
    setPreview({ id: current.id, x: current.at[0], y: current.at[1] })
  }

  const end = (event: ReactPointerEvent<SVGElement>) => {
    const current = drag.current
    if (!current || event.pointerId !== current.pointerId) return
    drag.current = null
    if (current.moving) {
      dragged.current = true
      onMove(current.id, current.at[0], current.at[1])
    }
    setPreview(null)
  }

  // A drag is not a click on the country: the map's click handler never hears of it.
  const swallowDragClick = (event: ReactMouseEvent<SVGElement>) => {
    if (!dragged.current) return
    dragged.current = false
    event.stopPropagation()
  }

  return (
    <g aria-hidden="true" className="map-stickers">
      <defs>
        {used.map((id) => (
          <symbol key={id} id={symbolOf.get(id)} viewBox="0 0 100 100">
            <image href={stickers.get(id)!.src} width="100" height="100" preserveAspectRatio="xMidYMid meet" />
          </symbol>
        ))}
        {/*
          The chosen sticker's highlight: a white wash over its own shape — the sticker lit up, the
          way a chosen item is, rather than a ring drawn round it. Exactly its silhouette, so
          nothing reaches past its edges, and see-through enough that the face stays itself.
        */}
        <filter id="map-sticker-highlight" x="0" y="0" width="100%" height="100%">
          <feFlood floodColor="#ffffff" floodOpacity="0.38" />
          <feComposite in2="SourceAlpha" operator="in" />
        </filter>
      </defs>
      {placements.map((p) => {
        const symbol = symbolOf.get(p.stickerId)
        if (!symbol) return null
        const chosen = p.id === chosenId
        const movable = draggable && (chosen || activeIds.includes(p.id))
        return (
          <Fragment key={p.id}>
          <use
            href={`#${symbol}`}
            x={p.x - p.size / 2}
            y={p.y - p.size / 2}
            width={p.size}
            height={p.size}
            {...{ [STICKER_MARKER]: p.id }}
            {...(movable
              ? {
                  [STICKER_DRAG_MARKER]: '',
                  onPointerDown: (event: ReactPointerEvent<SVGElement>) => begin(event, p),
                  onPointerMove: move,
                  onPointerUp: end,
                  onPointerCancel: end,
                  onClick: swallowDragClick,
                }
              : {})}
            pointerEvents="visiblePainted"
            // Read the picture's transparency as soon as the pointer comes near, ahead of a click.
            onPointerEnter={(event: ReactPointerEvent<SVGElement>) => primeStickerInk(event.currentTarget)}
            style={movable ? { cursor: 'move', touchAction: 'none' } : { cursor: 'pointer' }}
          />
          {/* Over the sticker, on screen only: the wash that says it is chosen. */}
          {chosen && (
            <use
              href={`#${symbol}`}
              x={p.x - p.size / 2}
              y={p.y - p.size / 2}
              width={p.size}
              height={p.size}
              filter="url(#map-sticker-highlight)"
              pointerEvents="none"
              data-export="none"
            />
          )}
          </Fragment>
        )
      })}
      {placements
        .filter((p) => activeIds.includes(p.id))
        .map((p) => (
          <circle
            key={`active-${p.id}`}
            cx={p.x}
            cy={p.y}
            r={p.size * 0.56}
            fill="none"
            stroke="var(--accent, #2f6fe0)"
            strokeWidth={2}
            strokeDasharray="5 4"
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
            data-export="none"
          />
        ))}
    </g>
  )
})
