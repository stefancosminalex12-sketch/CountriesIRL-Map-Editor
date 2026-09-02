/**
 * The composition frame drawn over the map.
 *
 * Deliberately **HTML, not SVG**. Everything else the map draws lives inside the
 * `<svg>` so the exporter picks it up for free; this is the one overlay that must
 * never be exported, and the surest way to guarantee that is for it not to be in the
 * thing the exporter copies. No marker attribute to remember, no stripping pass to
 * keep in step — the frame simply is not there.
 *
 * The dimmed workspace is four plain rectangles around the frame rather than one
 * element with a hole cut in it. A `clip-path` or an SVG mask would re-rasterise the
 * whole overlay on every pointermove of an edge drag; four rects change only their
 * own geometry, and `backdrop-filter` composites what is already painted underneath
 * rather than asking the map to draw again.
 */
import { useEffect, useRef, useState } from 'react'
import { useMapStore } from '../state/mapStore'
import { MIN_SCREEN, type ScreenRect } from './screenFrame'
import type { ScreenAspectId } from '../types/map'

type Edge = 'left' | 'right' | 'top' | 'bottom'
type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

/**
 * Anything that resizes the frame by being dragged.
 *
 * A corner is not a fifth kind of gesture, it is two edges at once — which is why the
 * name carries both parts. The move below reads the horizontal and vertical halves out
 * of it and applies exactly the edge maths already there, once per axis, so an edge and
 * a corner cannot drift apart in behaviour: an edge simply has one half and no other.
 */
type Grip = Edge | Corner

const CORNERS: Corner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right']

export interface MapScreenProps {
  screen: ScreenRect
  width: number
  height: number
  /** Hidden entirely while the frame is off: there is no composition to show. */
  active: boolean
  /** The ratio a drag holds, or `'freeform'` / `null` to let every edge move freely. */
  aspect: ScreenAspectId | null
  /** The map's own element, where a drag that starts inside the frame is intercepted. */
  containerRef: React.RefObject<HTMLElement | null>
}

/** How far a pointer must travel inside the frame before it counts as a move. */
const MOVE_THRESHOLD = 3

/** The ratio a preset holds while its edges are dragged. */
const RATIOS: Record<string, number> = {
  '1:1': 1,
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '4:3': 4 / 3,
  '3:4': 3 / 4,
  '2:1': 2,
  '1:2': 0.5,
}

export function MapScreen({
  screen,
  width,
  height,
  active,
  aspect,
  containerRef,
}: MapScreenProps) {
  const dispatch = useMapStore((s) => s.dispatch)

  /** The frame while it is being moved as a whole, in the same spirit as `drag` below. */
  const [moved, setMoved] = useState<ScreenRect | null>(null)

  /**
   * The frame while an edge is being dragged.
   *
   * Local, for the same reason the legend's drag is: the gesture updates on every
   * pointermove and the document should receive one edit, not a hundred. It also keeps
   * the drag off the projection — see the note on committing, below.
   */
  const [drag, setDrag] = useState<{ grip: Grip; rect: ScreenRect; pointerId: number } | null>(
    null,
  )
  const startRef = useRef<{ x: number; y: number; rect: ScreenRect } | null>(null)

  const rect = drag?.rect ?? moved ?? screen

  /**
   * Moving the whole frame.
   *
   * Intercepted on the map element rather than handled by an overlay covering the
   * frame, and that is the load-bearing choice. An overlay large enough to catch a drag
   * anywhere inside the picture would also swallow every hover and every click in it —
   * the country readout would go quiet and half the map would stop being selectable the
   * moment a frame was drawn. Nothing is covered here: `pointerdown` is taken in the
   * capture phase, and `mousemove`, `mouseover` and `click` are left entirely alone, so
   * picking and hovering inside the frame behave exactly as they do outside it.
   *
   * The map must not pan under the gesture, so the corresponding `mousedown` and
   * single-finger `touchstart` are stopped before they reach the `<svg>` d3-zoom
   * listens on — the same problem the legend solves with a clause in d3's own filter,
   * solved the same way round: the gesture belongs to whoever it started on. A second
   * finger is left alone, so pinch-zoom inside the frame still reaches the map.
   *
   * Only the frame's *position* changes. Its size, its ratio, the projection, the zoom
   * and the translation are not read and not written.
   */
  useEffect(() => {
    const container = containerRef.current
    if (!container || !active) return

    // Read from a ref so the listeners are installed once per frame geometry rather
    // than re-bound on every pointermove of a move in progress.
    const base = screen
    const inside = (event: { clientX: number; clientY: number }) => {
      const box = container.getBoundingClientRect()
      const x = event.clientX - box.left
      const y = event.clientY - box.top
      return x >= base.x && x <= base.x + base.width && y >= base.y && y <= base.y + base.height
    }
    /*
     * A gesture belongs to whatever it started on.
     *
     * An edge handle is a resize and the legend is a legend drag — both sit inside the
     * picture, and neither should also move the frame. The same rule d3's own filter
     * applies to the legend, applied here for the same reason.
     */
    const claimed = (event: Event) =>
      !!(event.target as Element | null)?.closest?.('.map-screen__handle, [data-legend]')

    /* Keep the map still: an edge handle already stops its own gesture. */
    const claim = (event: Event) => {
      if (claimed(event)) return
      const touches = (event as TouchEvent).touches
      if (touches) {
        // One finger is a move; two are a pinch, and the map keeps those.
        if (touches.length !== 1 || !inside(touches[0])) return
      } else {
        const mouse = event as MouseEvent
        if (mouse.button !== 0 || !inside(mouse)) return
      }
      event.stopPropagation()
    }

    const onDown = (event: PointerEvent) => {
      if (event.button !== 0 || !event.isPrimary) return
      if (claimed(event)) return
      if (!inside(event)) return

      const startX = event.clientX
      const startY = event.clientY
      let live = false

      const move = (next: PointerEvent) => {
        const dx = next.clientX - startX
        const dy = next.clientY - startY
        if (!live && Math.hypot(dx, dy) < MOVE_THRESHOLD) return
        live = true
        /*
         * Position only, and clamped so the frame stays describable: a crop cannot
         * name geography that is off the canvas. Width and height are carried through
         * untouched, so a preset's ratio survives a move exactly.
         */
        setMoved({
          x: Math.min(Math.max(0, base.x + dx), Math.max(0, width - base.width)),
          y: Math.min(Math.max(0, base.y + dy), Math.max(0, height - base.height)),
          width: base.width,
          height: base.height,
        })
      }

      const up = (next: PointerEvent) => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', up)
        if (!live) return

        /*
         * A drag ends over a country, and the browser would follow the pointerup with a
         * click that selects it. Swallowed once, in the capture phase — the same guard
         * d3-drag uses so a pan does not double as a selection.
         */
        const swallow = (click: Event) => {
          click.stopPropagation()
          click.preventDefault()
        }
        window.addEventListener('click', swallow, { capture: true, once: true })
        window.setTimeout(() => window.removeEventListener('click', swallow, true), 0)

        const dx = next.clientX - startX
        const dy = next.clientY - startY
        const rectNext = {
          x: Math.min(Math.max(0, base.x + dx), Math.max(0, width - base.width)),
          y: Math.min(Math.max(0, base.y + dy), Math.max(0, height - base.height)),
          width: base.width,
          height: base.height,
        }
        setMoved(null)
        // One operation for the gesture, and `aspect` is re-stated rather than changed.
        dispatch({ op: 'set_screen', patch: { rect: rectNext, aspect } })
      }

      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', up)
    }

    container.addEventListener('pointerdown', onDown, true)
    container.addEventListener('mousedown', claim, true)
    container.addEventListener('touchstart', claim, true)
    return () => {
      container.removeEventListener('pointerdown', onDown, true)
      container.removeEventListener('mousedown', claim, true)
      container.removeEventListener('touchstart', claim, true)
    }
  }, [containerRef, active, screen, width, height, aspect, dispatch])

  if (!active && !drag) return null

  const onDown = (grip: Grip) => (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.stopPropagation()
    event.preventDefault()
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Capture is an enhancement; the drag works without it.
    }
    startRef.current = { x: event.clientX, y: event.clientY, rect }
    setDrag({ grip, rect, pointerId: event.pointerId })
  }

  const onMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = startRef.current
    if (!drag || !start || event.pointerId !== drag.pointerId) return
    event.stopPropagation()

    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    const r = start.rect
    let next: ScreenRect = { ...r }

    /*
     * The grip's two halves.
     *
     * An edge has one half and moves that axis alone; a corner has both. Either way the
     * side that was not grabbed stays exactly where it is, so the opposite edge — and
     * for a corner, the opposite corner — is the anchor. That is what makes a drag feel
     * like adjusting a crop rather than resizing a box.
     */
    const horizontal = drag.grip.includes('left')
      ? 'left'
      : drag.grip.includes('right')
        ? 'right'
        : null
    const vertical = drag.grip.includes('top')
      ? 'top'
      : drag.grip.includes('bottom')
        ? 'bottom'
        : null

    const presetRatio = aspect ? RATIOS[aspect] : undefined

    /**
     * The ratio a corner drag holds.
     *
     * **Edges change the shape; corners scale the shape you have.** That is the whole
     * division of labour, and it is what makes Freeform feel like a design tool rather
     * than four independent sliders: you draw the crop you want with the edges, and then
     * a corner makes that crop bigger or smaller without disturbing it.
     *
     * So in Freeform the ratio is read off the frame *itself*, at the moment the gesture
     * began — a 1.4:1 frame scales as 1.4:1, a 2:1 frame as 2:1, with nothing snapped
     * back to a preset. Taken from `start.rect` rather than the live one, so the shape
     * cannot drift over the course of a drag by re-measuring its own output. A preset
     * names its ratio instead, which is the only difference between the two cases.
     *
     * An edge has no corner ratio at all, so it goes on moving one axis alone.
     */
    const cornerRatio =
      horizontal && vertical
        ? (presetRatio ?? (r.height > 0 ? r.width / r.height : undefined))
        : undefined

    if (cornerRatio) {
      /*
       * A uniform scale about the opposite corner, driven by the drag's component along
       * the frame's own diagonal.
       *
       * Projecting onto the diagonal rather than following one axis is what lets the
       * gesture answer to movement in *any* direction — pulling a corner straight down
       * grows the frame just as pulling it out along the diagonal does, and pushing back
       * towards the anchor shrinks it. Steering by width alone would leave vertical
       * movement doing nothing at all, which reads as a broken handle.
       */
      const outX = (horizontal === 'left' ? -dx : dx) * r.width
      const outY = (vertical === 'top' ? -dy : dy) * r.height
      const diagonal = r.width * r.width + r.height * r.height
      const scale = diagonal > 0 ? 1 + (outX + outY) / diagonal : 1

      let w = r.width * scale
      let h = w / cornerRatio
      // Clamped on whichever bound binds first, always in ratio-preserving pairs.
      if (w < MIN_SCREEN) {
        w = MIN_SCREEN
        h = w / cornerRatio
      }
      if (h < MIN_SCREEN) {
        h = MIN_SCREEN
        w = h * cornerRatio
      }
      if (w > width) {
        w = width
        h = w / cornerRatio
      }
      if (h > height) {
        h = height
        w = h * cornerRatio
      }

      /*
       * The opposite corner is put back exactly where it started. Without this, holding a
       * ratio slides the anchor and the gesture feels like it is dragging the whole frame
       * around rather than resizing it.
       */
      const anchorRight = r.x + r.width
      const anchorBottom = r.y + r.height
      next = {
        x: horizontal === 'left' ? anchorRight - w : r.x,
        y: vertical === 'top' ? anchorBottom - h : r.y,
        width: w,
        height: h,
      }
      next = {
        ...next,
        x: Math.min(Math.max(0, next.x), Math.max(0, width - next.width)),
        y: Math.min(Math.max(0, next.y), Math.max(0, height - next.height)),
      }
    } else {
      if (horizontal === 'left') {
        const x = Math.min(Math.max(0, r.x + dx), r.x + r.width - MIN_SCREEN)
        next = { ...next, x, width: r.width + (r.x - x) }
      } else if (horizontal === 'right') {
        const right = Math.max(r.x + MIN_SCREEN, Math.min(width, r.x + r.width + dx))
        next = { ...next, width: right - r.x }
      }

      if (vertical === 'top') {
        const y = Math.min(Math.max(0, r.y + dy), r.y + r.height - MIN_SCREEN)
        next = { ...next, y, height: r.height + (r.y - y) }
      } else if (vertical === 'bottom') {
        const bottom = Math.max(r.y + MIN_SCREEN, Math.min(height, r.y + r.height + dy))
        next = { ...next, height: bottom - r.y }
      }

      /*
       * A preset keeps its ratio while an edge moves; Freeform does not.
       *
       * The dragged edge is the one the author is steering, so it is taken at its word and
       * the *other* axis follows — grabbing the right edge of a 16:9 frame changes its
       * width and lets the height answer, which is what makes the gesture predictable.
       * The frame is then nudged back inside the canvas rather than clipped, so a ratio is
       * never silently broken by the edge of the window.
       */
      if (presetRatio) {
        if (horizontal) {
          const h = Math.min(height, Math.max(MIN_SCREEN, next.width / presetRatio))
          next = { ...next, height: h, width: h * presetRatio }
        } else {
          const w = Math.min(width, Math.max(MIN_SCREEN, next.height * presetRatio))
          next = { ...next, width: w, height: w / presetRatio }
        }
        next = {
          ...next,
          x: Math.min(Math.max(0, next.x), Math.max(0, width - next.width)),
          y: Math.min(Math.max(0, next.y), Math.max(0, height - next.height)),
        }
      }
    }

    setDrag({ ...drag, rect: next })
  }

  const end = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag || event.pointerId !== drag.pointerId) return
    event.stopPropagation()
    try {
      event.currentTarget.releasePointerCapture?.(drag.pointerId)
    } catch {
      // Already released, or never captured.
    }
    const next = drag.rect
    setDrag(null)
    startRef.current = null
    /*
     * One operation, at the end of the gesture.
     *
     * The map is untouched by any of this — the frame is an overlay and the projection
     * does not read it — so a drag moves four divs and nothing else. Committing per
     * pointermove would still put a hundred entries on the undo stack for one gesture,
     * and would re-render the tree that owns the map for each of them.
     */
    dispatch({ op: 'set_screen', patch: { rect: next, aspect } })
  }

  const outside = [
    { key: 'top', style: { left: 0, top: 0, width, height: Math.max(0, rect.y) } },
    {
      key: 'bottom',
      style: {
        left: 0,
        top: rect.y + rect.height,
        width,
        height: Math.max(0, height - rect.y - rect.height),
      },
    },
    { key: 'left', style: { left: 0, top: rect.y, width: Math.max(0, rect.x), height: rect.height } },
    {
      key: 'right',
      style: {
        left: rect.x + rect.width,
        top: rect.y,
        width: Math.max(0, width - rect.x - rect.width),
        height: rect.height,
      },
    },
  ]

  const handles: { grip: Edge; label: string; style: React.CSSProperties }[] = [
    { grip: 'left', label: 'left edge', style: { left: rect.x, top: rect.y, height: rect.height } },
    {
      grip: 'right',
      label: 'right edge',
      style: { left: rect.x + rect.width, top: rect.y, height: rect.height },
    },
    { grip: 'top', label: 'top edge', style: { left: rect.x, top: rect.y, width: rect.width } },
    {
      grip: 'bottom',
      label: 'bottom edge',
      style: { left: rect.x, top: rect.y + rect.height, width: rect.width },
    },
  ]

  /*
   * The corners sit on top of the edges they share a point with, so the few pixels where
   * both could be grabbed resolve to the corner — grabbing a corner and getting an edge
   * is the failure this ordering exists to prevent.
   */
  const corners = CORNERS.map((grip) => ({
    grip,
    label: `${grip.replace('-', ' ')} corner`,
    style: {
      left: grip.includes('left') ? rect.x : rect.x + rect.width,
      top: grip.includes('top') ? rect.y : rect.y + rect.height,
    },
  }))

  return (
    <div
      className={`map-screen${drag ? ' map-screen--dragging' : ''}${
        moved ? ' map-screen--moving' : ''
      }`}
    >
      {/*
        The workspace outside the picture: a light blur and a little dimming, enough to
        read the surrounding geography while making plain it is not in the shot. Never
        hit-tested, so panning and country picking work out here exactly as they do
        inside.
      */}
      {outside.map((part) => (
        <div key={part.key} className="map-screen__scrim" style={part.style} />
      ))}

      <div
        className="map-screen__frame"
        style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
      />

      {[...handles, ...corners].map((handle) => (
        <div
          key={handle.grip}
          className={`map-screen__handle map-screen__handle--${handle.grip}`}
          style={handle.style}
          role="separator"
          aria-label={`Drag ${handle.label}`}
          onPointerDown={onDown(handle.grip)}
          onPointerMove={onMove}
          onPointerUp={end}
          onPointerCancel={end}
        />
      ))}
    </div>
  )
}
