/**
 * The Selection panel's two gestures: a rectangle drawn with the middle mouse button, and a
 * brush that selects whatever the pointer passes over.
 *
 * Both select and deselect, the way a click does. A brush stroke that starts on something
 * already selected takes out whatever it passes over; one that starts anywhere else adds. A
 * rectangle over entities that are mostly selected takes the selected ones out; over anything
 * else it adds. Either way it goes through the store's `addToSelection` and
 * `removeFromSelection` — the same selection a click builds, so the inspector, the palette,
 * merging and everything else that reads it work on the result without knowing how it was
 * made. Neither changes the camera, the projection or any geometry.
 *
 * Native listeners on the `<svg>`, not React handlers, and for the same reason the zoom
 * behaviour uses them: a gesture runs at the pointer's rate, and nothing about the map has to
 * re-render while it does. The rectangle and the brush ring are two HTML elements over the map,
 * moved by style alone; they sit outside the `<svg>`, so no export can ever contain them. The
 * selection itself is handed to the store at most once per animation frame, and only when the
 * stroke has reached something new.
 *
 * Coordinates go through the zoomed group's own screen matrix, so a rectangle is anchored to
 * the map rather than to the screen: zoom with the wheel while the button is held and the
 * corner it started from stays on the place it started from.
 */
import { useEffect, useRef, type MutableRefObject, type RefObject } from 'react'
import { GESTURE_HISTORY_PREFIX } from '../state/mapStore'

export interface SelectionGestureHandlers {
  /** Whether each tool is live right now. */
  rectangle: boolean
  brush: boolean
  /** Entities whose drawn outline meets the rectangle, in the zoomed group's coordinates. */
  inRect: (x0: number, y0: number, x1: number, y1: number) => string[]
  /**
   * Entities whose drawn outline a stroke segment reaches, in the same coordinates, with the
   * brush's footprint as a radius in those coordinates.
   */
  alongSegment: (ax: number, ay: number, bx: number, by: number, radius: number) => string[]
  /**
   * What a click at this point would select. The brush asks it at the pointer as well as
   * testing outlines, so the catchments that make a speck of an island clickable make it
   * brushable too.
   */
  pickAt: (clientX: number, clientY: number, target: Element | null) => string | null
  /**
   * Hands entities to the selection. Every call a gesture makes carries that gesture's own
   * history key, so the whole rectangle or stroke is one undo step.
   */
  add: (ids: string[], historyKey: string) => void
  /** Takes entities back out of the selection, with the same history keys as `add`. */
  remove: (ids: string[], historyKey: string) => void
  /** Whether an entity is selected right now — what decides whether a gesture adds or takes out. */
  isSelected: (id: string) => boolean
  /** Held true while a gesture runs, so hover is not tracked underneath it. */
  selecting: MutableRefObject<boolean>
  /**
   * Set when a brush press has already dealt with the click the browser sends after it —
   * otherwise that click would toggle the subdivision the brush had just added straight back
   * out.
   */
  suppressClick: MutableRefObject<boolean>
  /** Presses that belong to something else on the map, such as the legend. */
  ignore: (target: Element | null) => boolean
}

interface Point {
  x: number
  y: number
}

type Gesture =
  | { kind: 'rect'; pointerId: number; historyKey: string; anchor: Point; pointer: Point }
  | {
      kind: 'brush'
      pointerId: number
      historyKey: string
      /** The brush's footprint, in screen px — see `BRUSH_RADIUS_PX`. */
      radius: number
      /** The last pointer position already stroked, in client coordinates. */
      last: Point | null
      /** Positions reported since the last frame, not yet stroked. */
      queue: Point[]
      /** Everything this stroke has reached, so each is taken once. */
      seen: Set<string>
      /**
       * Whether the stroke adds or takes out, decided by the first thing it reaches: a stroke
       * that starts on a selected entity erases, so the brush can undo its own work.
       */
      mode: 'add' | 'remove' | null
      /** How many entities the stroke has added or taken out. */
      changed: number
      /** How far the pointer has travelled, in client px. */
      travel: number
    }

/**
 * How far a brush press may move and still be a click, in px. A press that went further, or
 * that reached any entity, has said what it meant, and the click after it is not a second
 * statement.
 */
const CLICK_SLOP_PX = 4

/**
 * How wide the brush is, as a radius in screen px.
 *
 * A pixel for a mouse or a pen, whose hotspot is exact: enough that running the pointer
 * along the border line an outline is drawn with counts as passing over that subdivision,
 * which is what the author sees it doing. A fingertip's width for touch, where the reported
 * point is only the centre of a contact several millimetres across.
 */
const BRUSH_RADIUS_PX = { pointer: 1, touch: 8 }

/** The ring that follows a brush stroke, in px across: the fingertip's footprint for touch. */
const RING_PX = { pointer: 12, touch: 2 * BRUSH_RADIUS_PX.touch }

export function useSelectionGestures(
  svgRef: RefObject<SVGSVGElement>,
  zoomedRef: RefObject<SVGGElement>,
  overlayRef: RefObject<HTMLDivElement>,
  handlers: SelectionGestureHandlers,
): void {
  const latest = useRef(handlers)
  latest.current = handlers

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return

    let gesture: Gesture | null = null
    let frame = 0
    let clearSuppress = 0
    /* Numbers each gesture, so each has a history key of its own. */
    let gestureCount = 0
    const historyKey = (kind: 'rect' | 'brush') =>
      `${GESTURE_HISTORY_PREFIX}${kind}:${Date.now().toString(36)}:${++gestureCount}`

    /*
     * While a gesture runs, the page is a canvas, not a document.
     *
     * A drag across the map is also what selects text, and a long press is what opens a
     * context menu or a touch callout: left to the browser, a brush stroke painted a text
     * selection over the labels and legend under it and ended in the browser's selection
     * menu — Search, Copy, Translate. Refusing the press's own default (see `onPointerDown`
     * and `onMouseDown`) stops a selection starting; these catch what can still start from
     * elsewhere — a selection extended from outside the map, a context menu from a long
     * press, a drag of the map as an image — for exactly as long as the gesture lasts, and
     * no longer, so the page behaves normally the moment it ends. The class is the same
     * refusal in CSS, for the engines that decide on style before they ask script.
     */
    let guarding = false
    const refuse = (event: Event) => {
      if (gesture) event.preventDefault()
    }
    const guardPage = () => {
      if (guarding) return
      guarding = true
      window.getSelection()?.removeAllRanges()
      document.addEventListener('selectstart', refuse, true)
      document.addEventListener('contextmenu', refuse, true)
      document.addEventListener('dragstart', refuse, true)
      document.documentElement.classList.add('is-selecting-on-map')
    }
    const releasePage = () => {
      if (!guarding) return
      guarding = false
      document.removeEventListener('selectstart', refuse, true)
      document.removeEventListener('contextmenu', refuse, true)
      document.removeEventListener('dragstart', refuse, true)
      document.documentElement.classList.remove('is-selecting-on-map')
    }
    /*
     * Refusing the press's default also keeps focus where it was, so a text field that held
     * it before the stroke would still hold it after — and would answer the next Ctrl+Z
     * itself. A press on the map lets go of focus, as any other press on the map does.
     */
    const releaseFocus = () => {
      const active = document.activeElement
      if (active instanceof HTMLElement && active !== document.body && !svg.contains(active)) {
        active.blur()
      }
    }

    const toMap = (clientX: number, clientY: number): Point | null => {
      const matrix = zoomedRef.current?.getScreenCTM()
      if (!matrix) return null
      const p = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse())
      return { x: p.x, y: p.y }
    }
    const toClient = (point: Point): Point | null => {
      const matrix = zoomedRef.current?.getScreenCTM()
      if (!matrix) return null
      const p = new DOMPoint(point.x, point.y).matrixTransform(matrix)
      return { x: p.x, y: p.y }
    }
    const part = (selector: string) => overlayRef.current?.querySelector<HTMLElement>(selector) ?? null

    const capture = (pointerId: number) => {
      try {
        svg.setPointerCapture(pointerId)
      } catch {
        // A pointer that is already gone cannot be captured; the gesture still ends on its up.
      }
    }
    const release = (pointerId: number) => {
      try {
        if (svg.hasPointerCapture(pointerId)) svg.releasePointerCapture(pointerId)
      } catch {
        // Nothing to release.
      }
    }

    /* The rectangle, redrawn every frame the button is held so it follows the camera too. */
    const drawMarquee = () => {
      frame = 0
      if (!gesture || gesture.kind !== 'rect') return
      const marquee = part('.map-canvas__marquee')
      const box = overlayRef.current?.getBoundingClientRect()
      const corner = toClient(gesture.anchor)
      if (marquee && box && corner) {
        const left = Math.min(corner.x, gesture.pointer.x) - box.left
        const top = Math.min(corner.y, gesture.pointer.y) - box.top
        marquee.style.transform = `translate(${left}px, ${top}px)`
        marquee.style.width = `${Math.abs(gesture.pointer.x - corner.x)}px`
        marquee.style.height = `${Math.abs(gesture.pointer.y - corner.y)}px`
        marquee.hidden = false
      }
      frame = requestAnimationFrame(drawMarquee)
    }

    const moveRing = (at: Point | null) => {
      const ring = part('.map-canvas__brush')
      const box = overlayRef.current?.getBoundingClientRect()
      if (!ring || !box) return
      if (!at) {
        ring.hidden = true
        return
      }
      ring.style.transform = `translate(${at.x - box.left}px, ${at.y - box.top}px)`
      ring.hidden = false
    }

    /* The stroke so far, tested and handed to the store: at most once per frame. */
    const stroke = () => {
      frame = 0
      if (!gesture || gesture.kind !== 'brush') return
      const current = gesture
      const h = latest.current
      const fresh: string[] = []
      const take = (id: string | null) => {
        if (!id || current.seen.has(id)) return
        current.seen.add(id)
        fresh.push(id)
      }

      // The footprint in the map's own units, at the camera's current zoom.
      const scale = zoomedRef.current?.getScreenCTM()?.a || 1
      const radius = current.radius / scale
      for (const point of current.queue) {
        const from = current.last ?? point
        current.travel += Math.hypot(point.x - from.x, point.y - from.y)
        const a = toMap(from.x, from.y)
        const b = toMap(point.x, point.y)
        if (a && b) for (const id of h.alongSegment(a.x, a.y, b.x, b.y, radius)) take(id)
        current.last = point
      }
      current.queue = []

      const at = current.last
      let under: string | null = null
      if (at) {
        const target = document.elementFromPoint(at.x, at.y)
        if (target && svg.contains(target)) under = h.pickAt(at.x, at.y, target)
      }
      // The entity under the press decides, and failing that the first outline it crossed.
      if (current.mode === null) {
        const first = under ?? fresh[0] ?? null
        if (first) current.mode = h.isSelected(first) ? 'remove' : 'add'
      }
      take(under)

      if (fresh.length > 0 && current.mode === 'remove') {
        const gone = fresh.filter((id) => h.isSelected(id))
        if (gone.length > 0) {
          current.changed += gone.length
          h.remove(gone, current.historyKey)
        }
      } else if (fresh.length > 0) {
        current.changed += fresh.length
        h.add(fresh, current.historyKey)
      }
      moveRing(at)
    }

    const end = (commit: boolean) => {
      const done = gesture
      if (!done) return
      const h = latest.current
      cancelAnimationFrame(frame)
      frame = 0

      if (done.kind === 'rect') {
        const marquee = part('.map-canvas__marquee')
        if (marquee) marquee.hidden = true
        const corner = commit ? toMap(done.pointer.x, done.pointer.y) : null
        if (corner) {
          const ids = h.inRect(
            Math.min(done.anchor.x, corner.x),
            Math.min(done.anchor.y, corner.y),
            Math.max(done.anchor.x, corner.x),
            Math.max(done.anchor.y, corner.y),
          )
          /*
           * Mostly selected already: the rectangle is being drawn to take them out, and it takes
           * out the selected ones — a neighbour whose edge it clips is left as it was. Otherwise
           * it adds.
           */
          const selected = ids.filter((id) => h.isSelected(id))
          if (ids.length > 0 && selected.length * 2 >= ids.length) {
            h.remove(selected, done.historyKey)
          } else if (ids.length > 0) {
            h.add(ids, done.historyKey)
          }
        }
      } else {
        if (commit) stroke()
        h.suppressClick.current = done.seen.size > 0 || done.travel > CLICK_SLOP_PX
        window.clearTimeout(clearSuppress)
        clearSuppress = window.setTimeout(() => {
          h.suppressClick.current = false
        }, 500)
        moveRing(null)
      }

      gesture = null
      h.selecting.current = false
      release(done.pointerId)
      releasePage()
    }

    const onPointerDown = (event: PointerEvent) => {
      const h = latest.current
      if (gesture) {
        // A second finger means a pinch, not a wider stroke: the brush stops where it is.
        if (gesture.kind === 'brush' && event.pointerId !== gesture.pointerId) end(false)
        return
      }
      h.suppressClick.current = false
      const target = event.target as Element | null

      if (event.pointerType === 'mouse' && event.button === 1) {
        if (!h.rectangle || h.ignore(target)) return
        const anchor = toMap(event.clientX, event.clientY)
        if (!anchor) return
        event.preventDefault()
        capture(event.pointerId)
        gesture = {
          kind: 'rect',
          pointerId: event.pointerId,
          historyKey: historyKey('rect'),
          anchor,
          pointer: { x: event.clientX, y: event.clientY },
        }
        h.selecting.current = true
        guardPage()
        drawMarquee()
        return
      }

      if (!h.brush || !event.isPrimary || event.button !== 0 || event.ctrlKey) return
      if (h.ignore(target)) return
      /*
       * The press starts a stroke, not a text selection, a drag or a focus change — see
       * `guardPage`. Refused here, at the first event the press produces, because that is
       * the stage every later default is decided from: it also withholds the compatibility
       * `mousedown` that would begin a selection on its own.
       */
      event.preventDefault()
      releaseFocus()
      capture(event.pointerId)
      const touch = event.pointerType === 'touch'
      const ring = part('.map-canvas__brush')
      if (ring) {
        const size = touch ? RING_PX.touch : RING_PX.pointer
        ring.style.width = ring.style.height = `${size}px`
        ring.style.top = ring.style.left = `${-size / 2}px`
      }
      gesture = {
        kind: 'brush',
        pointerId: event.pointerId,
        historyKey: historyKey('brush'),
        radius: touch ? BRUSH_RADIUS_PX.touch : BRUSH_RADIUS_PX.pointer,
        last: null,
        queue: [{ x: event.clientX, y: event.clientY }],
        seen: new Set(),
        mode: null,
        changed: 0,
        travel: 0,
      }
      h.selecting.current = true
      guardPage()
      // The ring appears with the press, not a frame later.
      moveRing({ x: event.clientX, y: event.clientY })
      if (!frame) frame = requestAnimationFrame(stroke)
    }

    const onPointerMove = (event: PointerEvent) => {
      if (!gesture || event.pointerId !== gesture.pointerId) return
      if (gesture.kind === 'rect') {
        gesture.pointer = { x: event.clientX, y: event.clientY }
        return
      }
      // Every position the pointer reported, not just the last of the frame.
      const reported = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : []
      for (const e of reported.length > 0 ? reported : [event]) {
        gesture.queue.push({ x: e.clientX, y: e.clientY })
      }
      if (!frame) frame = requestAnimationFrame(stroke)
    }

    const onPointerUp = (event: PointerEvent) => {
      if (!gesture || event.pointerId !== gesture.pointerId) return
      // Releasing another button while the middle one is held does not end the rectangle.
      if (gesture.kind === 'rect' && event.button !== 1) return
      end(true)
    }

    const onPointerCancel = (event: PointerEvent) => {
      if (gesture && event.pointerId === gesture.pointerId) end(false)
    }

    /*
     * The middle button's own default is the browser's autoscroll, which would take the page
     * over for the whole drag. It starts from `mousedown`, so it is refused there — only while
     * the rectangle is on, so the button behaves as it always did otherwise.
     */
    const onMouseDown = (event: MouseEvent) => {
      if (event.button === 1 && latest.current.rectangle) event.preventDefault()
      // Should a browser still send the mouse's own press for a brush stroke, it starts no
      // text selection either.
      if (event.button === 0 && gesture?.kind === 'brush') event.preventDefault()
    }

    /*
     * Touch has its own defaults that pointer events do not withhold: a long press opens the
     * callout or a context menu and starts selecting text, and the browser synthesises mouse
     * events and a click after the finger lifts. With the brush on, a one-finger touch on the
     * map is a stroke, so its `touchstart` is refused — passive listeners cannot, hence
     * `passive: false` — and so is every `touchmove` of a stroke in progress. A two-finger
     * touch is left alone: it is a pinch, and the zoom behaviour takes it.
     */
    const onTouchStart = (event: TouchEvent) => {
      const h = latest.current
      if (!h.brush || event.touches.length !== 1 || h.ignore(event.target as Element | null)) return
      event.preventDefault()
    }
    const onTouchMove = (event: TouchEvent) => {
      if (gesture?.kind === 'brush' && event.touches.length === 1) event.preventDefault()
    }
    const onAuxClick = (event: MouseEvent) => {
      if (event.button === 1 && latest.current.rectangle) event.preventDefault()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && gesture?.kind === 'rect') end(false)
    }

    svg.addEventListener('pointerdown', onPointerDown)
    svg.addEventListener('pointermove', onPointerMove)
    svg.addEventListener('pointerup', onPointerUp)
    svg.addEventListener('pointercancel', onPointerCancel)
    svg.addEventListener('lostpointercapture', onPointerCancel)
    svg.addEventListener('mousedown', onMouseDown)
    svg.addEventListener('auxclick', onAuxClick)
    svg.addEventListener('touchstart', onTouchStart, { passive: false })
    svg.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('keydown', onKeyDown)
    return () => {
      end(false)
      releasePage()
      window.clearTimeout(clearSuppress)
      svg.removeEventListener('touchstart', onTouchStart)
      svg.removeEventListener('touchmove', onTouchMove)
      svg.removeEventListener('pointerdown', onPointerDown)
      svg.removeEventListener('pointermove', onPointerMove)
      svg.removeEventListener('pointerup', onPointerUp)
      svg.removeEventListener('pointercancel', onPointerCancel)
      svg.removeEventListener('lostpointercapture', onPointerCancel)
      svg.removeEventListener('mousedown', onMouseDown)
      svg.removeEventListener('auxclick', onAuxClick)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [svgRef, zoomedRef, overlayRef])
}
