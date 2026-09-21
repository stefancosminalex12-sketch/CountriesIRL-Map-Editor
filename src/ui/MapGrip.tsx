/**
 * The map, reachable through the panel.
 *
 * On a phone an open panel is most of the screen, and what is left of the map is a strip too
 * narrow to drag. Rather than make the author close the panel, move the map, and open it
 * again, every panel carries a small rectangle at its foot: transparent, so the map shows
 * through it, and live, so a finger dragged across it moves the map underneath.
 *
 * It is a pad inside the panel, not the end of the panel. The panel still reaches the bottom
 * of the screen with its controls and its glass; this is one rectangle near the foot of it,
 * about a thumb tall.
 *
 * It is not a second map. A gesture here is handed to the camera the map already has
 * (`mapCamera.ts`), which is the same d3 zoom behaviour a drag on the exposed map drives:
 * the same limits, the same frame-by-frame placement, one commit at the end. Panning and
 * pinching both work, and a finger that lands here never reaches the map's own hit-testing,
 * so nothing is selected by accident.
 *
 * `touch-action: none` is what keeps the browser out of it: without it a vertical drag
 * scrolls the panel, a horizontal one swipes back a page, and a two-finger gesture zooms the
 * document. Everywhere else in the panel scrolling is untouched.
 */
import { useEffect, useRef } from 'react'
import { beginMapDrag, type MapDrag } from '../render/mapCamera'

/** Below this a touch is a tap, not a drag: it is let go rather than moving the map a hair. */
const DRAG_SLOP_PX = 2

export function MapGrip() {
  const surfaceRef = useRef<HTMLDivElement>(null)
  /** The fingers on the grip, by pointer id, at their latest position. */
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const drag = useRef<MapDrag | null>(null)
  /** The distance between two fingers on the last frame, for the pinch. */
  const spread = useRef(0)

  useEffect(() => {
    const surface = surfaceRef.current
    if (!surface) return

    const release = () => {
      drag.current?.end()
      drag.current = null
      spread.current = 0
    }

    const onDown = (event: PointerEvent) => {
      // A gesture here belongs to the map, not to the panel behind it.
      event.preventDefault()
      surface.setPointerCapture(event.pointerId)
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (!drag.current) drag.current = beginMapDrag()
      if (pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()]
        spread.current = Math.hypot(a.x - b.x, a.y - b.y)
      }
    }

    const onMove = (event: PointerEvent) => {
      const last = pointers.current.get(event.pointerId)
      if (!last) return
      event.preventDefault()
      const x = event.clientX
      const y = event.clientY
      const dx = x - last.x
      const dy = y - last.y
      pointers.current.set(event.pointerId, { x, y })
      const session = drag.current
      if (!session) return

      if (pointers.current.size >= 2) {
        /*
         * Two fingers: the map follows their middle and scales with the distance between
         * them, which is what a pinch on the map itself does. The pan is halved because both
         * fingers report the same movement, and taking each in full would move the map twice
         * as far as the hand did.
         */
        const [a, b] = [...pointers.current.values()]
        const distance = Math.hypot(a.x - b.x, a.y - b.y)
        session.panBy(dx / 2, dy / 2)
        if (spread.current > 0 && distance > 0) {
          const factor = distance / spread.current
          if (Number.isFinite(factor) && factor > 0) {
            session.zoomBy(factor, (a.x + b.x) / 2, (a.y + b.y) / 2)
          }
        }
        spread.current = distance
        return
      }

      if (Math.abs(dx) < DRAG_SLOP_PX && Math.abs(dy) < DRAG_SLOP_PX) return
      session.panBy(dx, dy)
    }

    const onUp = (event: PointerEvent) => {
      pointers.current.delete(event.pointerId)
      if (surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId)
      if (pointers.current.size === 0) release()
      else if (pointers.current.size === 1) spread.current = 0
    }

    surface.addEventListener('pointerdown', onDown)
    surface.addEventListener('pointermove', onMove)
    surface.addEventListener('pointerup', onUp)
    surface.addEventListener('pointercancel', onUp)
    return () => {
      surface.removeEventListener('pointerdown', onDown)
      surface.removeEventListener('pointermove', onMove)
      surface.removeEventListener('pointerup', onUp)
      surface.removeEventListener('pointercancel', onUp)
      pointers.current.clear()
      release()
    }
  }, [])

  return (
    /*
     * The pad is part of the panel and carries its glass, so the panel still reaches the
     * bottom of the screen. The rectangle inside it is the only thing here with no surface:
     * that is the window on the map.
     */
    <div className="sidebar__pad">
      {/* The panel's glass, with the window below cut out of it. See `.sidebar__pad-glass`. */}
      <span className="sidebar__pad-glass" aria-hidden="true" />
      <div
        ref={surfaceRef}
        className="sidebar__grip"
        // Named for what it does, since there is nothing here to see.
        role="application"
        aria-label="Map area: drag to move the map, pinch to zoom"
      >
        <span className="sidebar__grip-hint" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 2.5v11M2.5 8h11" />
            <path d="M8 2.5 6.3 4.2M8 2.5l1.7 1.7M8 13.5l-1.7-1.7M8 13.5l1.7-1.7M2.5 8l1.7-1.7M2.5 8l1.7 1.7M13.5 8l-1.7-1.7M13.5 8l-1.7 1.7" />
          </svg>
          Drag to move the map
        </span>
      </div>
    </div>
  )
}
