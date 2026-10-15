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
import { createPortal } from 'react-dom'
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

  const holes = usePanelHoles(active, containerRef)

  /** Edit mode: the frame moves and resizes only while it is on. See the effect below. */
  const [editing, setEditing] = useState(false)
  const editingRef = useRef(false)
  editingRef.current = editing
  /** The frame's menu, open at the pointer, or null. */
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  /**
   * Editing the frame, and keeping the map outside it still.
   *
   * **The frame is changed only in Edit mode.** A right-click on an edge or a corner — where the
   * double-arrow cursor shows — or anywhere outside the frame opens a menu with **Edit canvas**.
   * While editing, a left drag inside the frame moves it and a drag on an edge or a corner resizes
   * it; **Done**, or Escape, ends it. Outside Edit mode every press inside the frame is the map's —
   * panning, selecting, dragging a sticker — and no drag ever moves the frame by accident.
   *
   * **Outside the frame the map is out of reach**: it is workspace, not the picture. A press, a
   * click, a hover or a drag there that lands on the map is stopped before the map hears it, so a
   * country beyond the edge — Russia's east, Kazakhstan — cannot be selected, highlighted or
   * dragged; a right-click there opens the frame's menu instead. The wheel still zooms. Only
   * events on the map itself are taken: the zoom buttons and every panel stay as they are.
   *
   * All of it on the map element, in the capture phase, ahead of the `<svg>` that d3-zoom, the
   * selection gestures and the country picking listen on.
   */
  useEffect(() => {
    const container = containerRef.current
    if (!container || !active) return

    const base = screen
    const point = (event: { clientX: number; clientY: number }) => {
      const box = container.getBoundingClientRect()
      return { x: event.clientX - box.left, y: event.clientY - box.top }
    }
    const inside = (event: { clientX: number; clientY: number }) => {
      const { x, y } = point(event)
      return x >= base.x && x <= base.x + base.width && y >= base.y && y <= base.y + base.height
    }
    /** Whether an event landed on the map's own drawing — not a panel, a button or a handle. */
    const onMap = (event: Event) => {
      const target = event.target as Element | null
      return !!target?.closest?.('svg') && !target.closest('.map-screen__handle, [data-legend]')
    }
    const at = (event: Event): { clientX: number; clientY: number } => {
      const touch = (event as TouchEvent).changedTouches?.[0]
      return touch ?? (event as MouseEvent)
    }
    const pinch = (event: Event) => {
      const touches = (event as TouchEvent).touches
      return !!touches && touches.length > 1
    }

    /*
     * Outside the frame — and everywhere while the frame is being edited — nothing reaches the map,
     * and the hover it last had is let go: in Edit mode the map is locked, and no country can be
     * selected, deselected or changed until Done.
     */
    let hoverCleared = false
    const keepOut = (event: Event) => {
      if (!onMap(event) || (!editingRef.current && inside(at(event)))) {
        hoverCleared = false
        return
      }
      // Two fingers are a pinch: the map keeps those wherever they are.
      if (pinch(event)) return
      event.stopPropagation()
      if (!hoverCleared && (event.type === 'pointermove' || event.type === 'mousemove')) {
        hoverCleared = true
        useMapStore.getState().setHovered(null)
      }
    }
    // Outside the frame, or anywhere on the map while editing: the frame's menu, never a country's.
    const menuOutside = (event: MouseEvent) => {
      if (!onMap(event) || (inside(event) && !editingRef.current)) return
      event.preventDefault()
      event.stopPropagation()
      setMenu({ x: event.clientX, y: event.clientY })
    }

    /* Edit mode: a press inside the frame moves it; the map under it does nothing. */
    const holdInside = (event: Event) => {
      if (!editingRef.current || !onMap(event) || !inside(at(event)) || pinch(event)) return
      event.stopPropagation()
    }
    const onDown = (event: PointerEvent) => {
      if (!editingRef.current || !event.isPrimary || event.button !== 0) return
      if (!onMap(event) || !inside(event)) return
      event.stopPropagation()

      const startX = event.clientX
      const startY = event.clientY
      let live = false
      const place = (next: PointerEvent) => ({
        x: Math.min(Math.max(0, base.x + next.clientX - startX), Math.max(0, width - base.width)),
        y: Math.min(Math.max(0, base.y + next.clientY - startY), Math.max(0, height - base.height)),
        width: base.width,
        height: base.height,
      })
      const move = (next: PointerEvent) => {
        if (!live && Math.hypot(next.clientX - startX, next.clientY - startY) < MOVE_THRESHOLD) return
        live = true
        setMoved(place(next))
      }
      const up = (next: PointerEvent) => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', up)
        if (!live) return
        setMoved(null)
        // One operation for the gesture, and `aspect` is re-stated rather than changed.
        dispatch({ op: 'set_screen', patch: { rect: place(next), aspect } })
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', up)
    }

    const outsideTypes = [
      'pointerdown', 'pointermove', 'pointerup', 'mousedown', 'mousemove', 'mouseup', 'mouseover',
      'click', 'dblclick', 'auxclick', 'touchstart', 'touchmove',
    ]
    const editTypes = ['mousedown', 'touchstart', 'click', 'dblclick']
    for (const type of outsideTypes) container.addEventListener(type, keepOut, true)
    for (const type of editTypes) container.addEventListener(type, holdInside, true)
    container.addEventListener('pointerdown', onDown, true)
    container.addEventListener('contextmenu', menuOutside, true)
    return () => {
      for (const type of outsideTypes) container.removeEventListener(type, keepOut, true)
      for (const type of editTypes) container.removeEventListener(type, holdInside, true)
      container.removeEventListener('pointerdown', onDown, true)
      container.removeEventListener('contextmenu', menuOutside, true)
    }
  }, [containerRef, active, screen, width, height, aspect, dispatch])

  /* Escape ends Edit mode; a frame turned off is not being edited. */
  useEffect(() => {
    if (!editing) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setEditing(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing])
  useEffect(() => {
    if (!active) setEditing(false)
  }, [active])

  /* A move cursor over the map inside the frame while it is being edited. */
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    container.classList.toggle('is-editing-frame', editing)
    return () => container.classList.remove('is-editing-frame')
  }, [containerRef, editing])

  if (!active && !drag) return null

  /* An edge or a corner resizes the frame in Edit mode, and only then. */
  const onDown = (grip: Grip) => (event: React.PointerEvent<HTMLDivElement>) => {
    if (!editing || event.button !== 0) return
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
      }${editing ? ' map-screen--editing' : ''}`}
      style={holes.length > 0 ? { clipPath: holesClip(holes, width, height) } : undefined}
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
          // The frame's menu: Edit canvas, or Done while editing.
          onContextMenu={(event) => {
            event.preventDefault()
            event.stopPropagation()
            setMenu({ x: event.clientX, y: event.clientY })
          }}
        />
      ))}

      {/* While editing: say so, and the way out. */}
      {editing && (
        <button
          type="button"
          className="btn map-screen__done"
          style={{ left: rect.x + rect.width / 2, top: rect.y + 10 }}
          onClick={() => setEditing(false)}
        >
          Done editing
        </button>
      )}

      {menu && (
        <FrameMenu
          at={menu}
          editing={editing}
          onChoose={() => setEditing(!editing)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}

/**
 * The frame's menu, at the pointer: Edit canvas, or Done editing while it is being edited. Closes
 * on a choice, a press anywhere else, Escape or the wheel, like the other menus on the map.
 */
function FrameMenu({
  at,
  editing,
  onChoose,
  onClose,
}: {
  at: { x: number; y: number }
  editing: boolean
  onChoose: () => void
  onClose: () => void
}) {
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node)) onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', onPointer, true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('wheel', onClose, { passive: true })
    return () => {
      window.removeEventListener('pointerdown', onPointer, true)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('wheel', onClose)
    }
  }, [onClose])
  return createPortal(
    <div
      ref={panel}
      className="top-menu map-menu"
      role="menu"
      aria-label="Canvas"
      style={{ left: Math.min(at.x, window.innerWidth - 220), top: Math.min(at.y, window.innerHeight - 90) }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <span className="top-menu__heading">Canvas</span>
      <button
        type="button"
        role="menuitem"
        className="top-menu__item map-menu__item"
        onClick={() => {
          onChoose()
          onClose()
        }}
      >
        <span className="top-menu__name">{editing ? 'Done editing' : 'Edit canvas'}</span>
      </button>
    </div>,
    document.body,
  )
}

/** A panel's box over the map, in the map's coordinates. */
interface Hole {
  x: number
  y: number
  w: number
  h: number
}

/** What floats over the map: the open tool card, its attached box, the File menu and the menus. */
const OVER_MAP = '.sidebar--open .sidebar__panel, .attached-card, .top-flyout, .top-menu'

/**
 * Where panels sit over the map, so the workspace's dimming and blur can leave them out: the
 * panels are glass, and the darkened workspace showed through them, so a card looked dull and
 * smoky over the edge of the frame and clean beside it. Measured whenever the page changes
 * (a panel opening, a menu, a resize), at most once a frame.
 */
function usePanelHoles(active: boolean, containerRef: React.RefObject<HTMLElement | null>): Hole[] {
  const [holes, setHoles] = useState<Hole[]>([])
  useEffect(() => {
    const container = containerRef.current
    if (!active || !container) {
      setHoles([])
      return
    }
    let frame = 0
    const measure = () => {
      frame = 0
      const box = container.getBoundingClientRect()
      const next = [...document.querySelectorAll(OVER_MAP)]
        // A card hidden for the moment (under the File menu) is not over the map.
        .filter((el) => getComputedStyle(el).visibility !== 'hidden')
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.width > 0 && r.height > 0)
        .map((r) => ({ x: r.left - box.left, y: r.top - box.top, w: r.width, h: r.height }))
      setHoles((previous) =>
        previous.length === next.length &&
        previous.every((h, i) => Math.abs(h.x - next[i].x) < 0.5 && Math.abs(h.y - next[i].y) < 0.5 && Math.abs(h.w - next[i].w) < 0.5 && Math.abs(h.h - next[i].h) < 0.5)
          ? previous
          : next,
      )
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    /*
     * Watched where panels come and go — the sidebar, the top bar, and the page's own children for
     * the menus put there — and not the map, whose camera changes styles every frame of a pan.
     */
    const observer = new MutationObserver(schedule)
    observer.observe(document.body, { childList: true })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    for (const root of document.querySelectorAll('.sidebar, .app__header')) {
      observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden', 'style'] })
    }
    window.addEventListener('resize', schedule)
    document.addEventListener('transitionend', schedule, true)
    measure()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', schedule)
      document.removeEventListener('transitionend', schedule, true)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [active, containerRef])
  return holes
}

/** The workspace with the panels cut out of it, as a clip path (even-odd). */
function holesClip(holes: Hole[], width: number, height: number): string {
  let d = `M0 0H${width}V${height}H0Z`
  for (const h of holes) d += `M${h.x} ${h.y}h${h.w}v${h.h}h${-h.w}Z`
  return `path(evenodd, '${d}')`
}
