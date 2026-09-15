/**
 * A trackpad pinch zooms the map, never the page.
 *
 * A pinch on a trackpad reaches the page in one of two forms, and a browser that is not told
 * otherwise answers both by zooming the whole document: the toolbar, the sidebar and the
 * legend scaled away like an image and came back on the way out.
 *
 * - **Chromium and Firefox** — and every browser on Windows — send it as `wheel` events with
 *   `ctrlKey` set. d3-zoom reads those as a zoom and cancels them itself, but not all of them:
 *   at either end of the zoom range a step would change nothing and d3 leaves the event alone,
 *   and over the sidebar or the toolbar d3 never sees it. A listener on the window cancels
 *   every one, so none can zoom the page, and the map still receives the ones over it.
 * - **Safari** sends `gesturestart`, `gesturechange` and `gestureend` instead, with the
 *   pinch's running scale. Those are cancelled the same way, and over the map each step is
 *   handed to d3-zoom as the ctrl-wheel the other browsers would have sent — so the map zooms
 *   through the one pipeline, with the same limits, the same point held under the pointer and
 *   one commit to the store when the pinch goes quiet.
 *
 * Fingers on a touch screen are left alone. Their pinch arrives as touches, which d3-zoom
 * handles on the map, and anywhere else the browser zooms the page as it always has; iOS
 * reports it as gesture events as well, so those are passed over while a finger is down. The
 * keyboard's zoom shortcuts are left alone too — they are how anyone who needs a larger page
 * asks for one.
 */
import { useEffect, type RefObject } from 'react'

/**
 * How d3-zoom reads a ctrl-wheel step: the scale is multiplied by 2^(-deltaY × 0.002 × 10) —
 * see its default `wheelDelta`. A pinch step of ratio r is therefore a deltaY of −log2(r)/0.02.
 */
const CTRL_WHEEL_LOG2_PER_DELTA = 0.002 * 10

/** Safari's `GestureEvent`, which the DOM typings do not carry. */
interface GestureEvent extends UIEvent {
  scale: number
  clientX: number
  clientY: number
}

export function usePinchZoom(svgRef: RefObject<SVGSVGElement>): void {
  useEffect(() => {
    /** Fingers on a touch screen: a pinch made of touches is not a trackpad's. */
    let touches = 0
    /** A Safari pinch in progress over the map, and the scale its last step reached. */
    let pinch: { target: Element; scale: number } | null = null

    const countTouches = (event: TouchEvent) => {
      touches = event.touches.length
    }

    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return
      event.preventDefault()
      /*
       * Should Safari ever send the ctrl-wheel of a pinch alongside its gesture events, the
       * map would take the pinch twice: while a gesture is being translated, the browser's
       * own steps are kept from the map. The translated ones are not trusted events.
       */
      if (pinch && event.isTrusted) event.stopPropagation()
    }

    const onGestureStart = (event: Event) => {
      if (touches > 0) return
      event.preventDefault()
      const svg = svgRef.current
      const target = event.target instanceof Element ? event.target : null
      pinch = svg && target && svg.contains(target) ? { target, scale: 1 } : null
    }

    const onGestureChange = (event: Event) => {
      if (touches > 0) return
      event.preventDefault()
      if (!pinch) return
      const gesture = event as GestureEvent
      const ratio = gesture.scale / pinch.scale
      if (!(gesture.scale > 0) || !Number.isFinite(ratio) || ratio === 1) return
      pinch.scale = gesture.scale
      const svg = svgRef.current
      const box = svg?.getBoundingClientRect()
      const x = Number.isFinite(gesture.clientX) ? gesture.clientX : box ? box.left + box.width / 2 : 0
      const y = Number.isFinite(gesture.clientY) ? gesture.clientY : box ? box.top + box.height / 2 : 0
      // Dispatched where the pinch is, so d3-zoom's filter still sees what is under it (the legend).
      pinch.target.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: -Math.log2(ratio) / CTRL_WHEEL_LOG2_PER_DELTA,
          deltaMode: 0,
          ctrlKey: true,
          clientX: x,
          clientY: y,
          bubbles: true,
          cancelable: true,
        }),
      )
    }

    const onGestureEnd = (event: Event) => {
      if (touches > 0) return
      event.preventDefault()
      pinch = null
    }

    const touchOptions: AddEventListenerOptions = { capture: true, passive: true }
    // Not passive, or the browser would not let the cancel stop the page zooming.
    const cancelable: AddEventListenerOptions = { capture: true, passive: false }
    window.addEventListener('wheel', onWheel, cancelable)
    document.addEventListener('touchstart', countTouches, touchOptions)
    document.addEventListener('touchend', countTouches, touchOptions)
    document.addEventListener('touchcancel', countTouches, touchOptions)
    document.addEventListener('gesturestart', onGestureStart, cancelable)
    document.addEventListener('gesturechange', onGestureChange, cancelable)
    document.addEventListener('gestureend', onGestureEnd, cancelable)
    return () => {
      window.removeEventListener('wheel', onWheel, cancelable)
      document.removeEventListener('touchstart', countTouches, touchOptions)
      document.removeEventListener('touchend', countTouches, touchOptions)
      document.removeEventListener('touchcancel', countTouches, touchOptions)
      document.removeEventListener('gesturestart', onGestureStart, cancelable)
      document.removeEventListener('gesturechange', onGestureChange, cancelable)
      document.removeEventListener('gestureend', onGestureEnd, cancelable)
    }
  }, [svgRef])
}
