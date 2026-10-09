/**
 * The pieces every dropdown in the editor is built from — the File menu, the region dropdowns,
 * the Select tool picker — so they all open, close, look and behave the same.
 *
 * - `Popover`: a panel floating under its anchor, in a portal, closing on a press outside,
 *   Escape, a resize or a scroll of what is under it.
 * - `MenuButton`: a compact button naming its current value that opens a `Popover`.
 * - `MenuItem`: one choice, ticked when it is the current one.
 * - `Flyout`: a menu at a row's side, for menus that cascade.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

/** Every menu panel, the side menus included — how a press is known to be inside the menu. */
const MENU_CLASS = 'top-menu'

/**
 * A menu floating under `anchor`. Closes on a press outside it or its anchor, on Escape, and
 * when the window is resized. Kept inside the viewport horizontally.
 */
export function Popover({
  anchor,
  open,
  onClose,
  children,
  label,
  align = 'start',
}: {
  anchor: RefObject<HTMLElement>
  open: boolean
  onClose: () => void
  children: ReactNode
  label: string
  align?: 'start' | 'end'
}) {
  const panel = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    if (!open || !anchor.current) {
      setPosition(null)
      return
    }
    const place = () => {
      const rect = anchor.current!.getBoundingClientRect()
      const width = panel.current?.offsetWidth ?? 240
      const desired = align === 'end' ? rect.right - width : rect.left
      const left = Math.max(8, Math.min(desired, window.innerWidth - width - 8))
      setPosition({ top: rect.bottom + 6, left })
    }
    place()
    // Once more after the panel has its real width.
    const frame = requestAnimationFrame(place)
    return () => cancelAnimationFrame(frame)
  }, [open, anchor, align])

  useEffect(() => {
    if (!open) return
    // A press in this menu or in one of its side menus (`Flyout`, drawn at page level) is the menu's.
    const inMenu = (target: Node) =>
      panel.current?.contains(target) || Boolean((target as Element).closest?.(`.${MENU_CLASS}`))
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (inMenu(target) || anchor.current?.contains(target)) return
      onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    // Scrolling the bar moves the anchor out from under the menu, so the menu closes.
    const onScroll = (event: Event) => {
      if (inMenu(event.target as Node)) return
      onClose()
    }
    window.addEventListener('pointerdown', onPointer, true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onClose)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('pointerdown', onPointer, true)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open, onClose, anchor])

  if (!open) return null
  return createPortal(
    <div
      ref={panel}
      className={MENU_CLASS}
      role="dialog"
      aria-label={label}
      style={{ top: position?.top ?? -9999, left: position?.left ?? -9999 }}
    >
      {children}
    </div>,
    document.body,
  )
}

export const Chevron = () => (
  <svg className="top-button__chevron" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true" focusable="false">
    <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/** A compact button naming its current value, which opens a menu of choices under it. */
export function MenuButton({
  label,
  value,
  title,
  children,
  align,
  className = '',
}: {
  label?: string
  value: ReactNode
  title: string
  children: (close: () => void) => ReactNode
  align?: 'start' | 'end'
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const close = () => setOpen(false)
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className={`top-button${open ? ' top-button--open' : ''} ${className}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={title}
        onClick={() => setOpen(!open)}
      >
        {label && <span className="top-button__label">{label}</span>}
        <span className="top-button__value">{value}</span>
        <Chevron />
      </button>
      <Popover anchor={anchor} open={open} onClose={close} label={title} align={align}>
        {children(close)}
      </Popover>
    </>
  )
}

/** One choice in a menu: a name, an optional note under it, and a tick when it is the current one. */
export function MenuItem({
  name,
  note,
  active,
  onChoose,
}: {
  name: ReactNode
  note?: ReactNode
  active: boolean
  onChoose: () => void
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={active}
      className={`top-menu__item${active ? ' top-menu__item--on' : ''}`}
      onClick={onChoose}
    >
      <span className="top-menu__tick" aria-hidden="true">
        {active ? '✓' : ''}
      </span>
      <span className="top-menu__text">
        <span className="top-menu__name">{name}</span>
        {note && <span className="top-menu__note">{note}</span>}
      </span>
    </button>
  )
}

export const ChevronRight = () => (
  <svg className="top-file__arrow" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true" focusable="false">
    <path d="M4.5 3 7.5 6 4.5 9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/** Whether a side menu would have no room: the same width at which the bar starts to scroll. */
export function useNarrow(): boolean {
  const query = '(max-width: 620px)'
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const list = window.matchMedia(query)
    const update = () => setNarrow(list.matches)
    list.addEventListener('change', update)
    return () => list.removeEventListener('change', update)
  }, [])
  return narrow
}

/**
 * The menu at a row's side, fixed to the viewport so the panel's scrolling does not clip it. To
 * the row's right where there is room, else to the panel's left.
 *
 * Drawn at page level, not inside the panel. The panel is glass — a `backdrop-filter` — and an
 * element with one becomes the containing block of every fixed element inside it: a side menu
 * drawn inside the panel was placed and clipped *within* the panel, which grew scrollbars and
 * swallowed it. A press in it still counts as a press in the menu: `Popover` treats every menu
 * panel as its own.
 */
export function Flyout({ row, children }: { row: HTMLElement; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  useLayoutEffect(() => {
    const host = row.closest('.top-menu')?.getBoundingClientRect() ?? row.getBoundingClientRect()
    const rect = row.getBoundingClientRect()
    const width = panel.current?.offsetWidth ?? 260
    const height = panel.current?.offsetHeight ?? 200
    let left = host.right + 4
    if (left + width > window.innerWidth - 8) left = Math.max(8, host.left - width - 4)
    const top = Math.max(8, Math.min(rect.top - 7, window.innerHeight - height - 8))
    setPosition({ top, left })
  }, [row, children])
  return createPortal(
    <div ref={panel} className={`${MENU_CLASS} top-flyout`} style={{ top: position?.top ?? -9999, left: position?.left ?? -9999 }}>
      {children}
    </div>,
    document.body,
  )
}
