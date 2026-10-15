/**
 * The name of what is under the pointer — a country, a region, a sea — beside the pointer, on its
 * right, following it. It used to sit in the map's bottom-left corner, away from where the eye
 * is; next to the pointer it is read without looking away.
 *
 * Placed directly on every pointer move, never through React: following the pointer must not
 * re-render anything. Flips to the pointer's left near the map's right edge, and hides while a
 * button is held — a pan, a drag, a brush stroke — when it would only be in the way. Never in an
 * export: it is outside the map's `<svg>`.
 */
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

/** How far right of the pointer the label starts. */
const OFFSET = 16

/** The pointer as last seen anywhere on the page, so a label that appears is placed at once. */
let last = { x: -1e4, y: -1e4, buttons: 0 }
if (typeof window !== 'undefined') {
  window.addEventListener(
    'pointermove',
    (event) => {
      last = { x: event.clientX, y: event.clientY, buttons: event.buttons }
    },
    { capture: true, passive: true },
  )
}

export function HoverLabel({ name, containerRef }: { name: string; containerRef: RefObject<HTMLElement | null> }) {
  const label = useRef<HTMLDivElement>(null)

  const place = () => {
    const el = label.current
    const container = containerRef.current
    if (!el || !container) return
    const box = container.getBoundingClientRect()
    const x = last.x - box.left
    const y = last.y - box.top
    const width = el.offsetWidth
    const left = x + OFFSET + width > box.width - 6 ? x - OFFSET - width : x + OFFSET
    el.style.transform = `translate(${Math.round(left)}px, ${Math.round(y - el.offsetHeight / 2)}px)`
    el.style.visibility = last.buttons ? 'hidden' : 'visible'
  }

  // Placed before it is painted, so it never shows a frame in the wrong place.
  useLayoutEffect(place, [name])

  useEffect(() => {
    let frame = 0
    const onMove = () => {
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0
        place()
      })
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      if (frame) cancelAnimationFrame(frame)
    }
    // `place` reads only refs and the module's pointer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div ref={label} className="map-canvas__hover-label" aria-hidden="true">
      {name}
    </div>
  )
}
