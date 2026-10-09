/**
 * The left sidebar: a rail of sections that opens one at a time.
 *
 * The rail is always visible and always the same width, so the map's left edge only
 * moves when the author asks it to. Choosing a section drops its panel down beside its
 * button, as the File menu drops down under File — a card as tall as its contents, top
 * level with the button and pushed up only as far as it must be to stay on screen;
 * choosing the same one again closes it. Unlike File it stays open while the map is
 * clicked, because most sections are worked together with the map: select, then act. One open section rather than a scrolling
 * column of all of them, because the previous layout put region chips, two selects,
 * five switches and three colour wells on screen at once and left the reader to work
 * out which belonged together.
 *
 * The sections are a plain array. Adding one is an entry with an icon and a body — no
 * new markup, no new styling, and it inherits the animation, the active state and the
 * keyboard behaviour along with everything else.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { HideTerritories } from './MapSettings'
import { SvgExchange } from './SvgExchange'
import { onOpenMapMenu, onOpenSidebarSection, type MapMenuRequest } from './sidebarEvents'
import { useMapStore } from '../state/mapStore'
import { closeLatestDisclosure } from './Panels'
import { DataPalette } from './DataPalette'
import { LegendControls, LegendSizeControls } from './LegendControls'
import { ScreenControls } from './ScreenControls'
import { MergeControls } from './MergeControls'
import { MapGrip } from './MapGrip'
import { OverlayControls } from './OverlayControls'
import { SelectionControls } from './SelectionControls'
import { StickerControls } from './StickerControls'
import { Section } from './Panels'

/**
 * Line icons on a 20-unit grid, stroked in `currentColor`.
 *
 * One idea each, legible at 18px: they are what the rail shows when it is closed, so a
 * glyph that needs a caption to be understood is a glyph that has failed here.
 */
const ICONS: Record<string, ReactNode> = {
  // A dashed marquee and the pointer drawing it: taking many things at once.
  select: (
    <>
      <rect x="2.8" y="3.4" width="11" height="9" rx="1" strokeDasharray="2.2 1.8" />
      <path d="M11.2 10.4l5 1.9-2.2.8-.8 2.2z" />
    </>
  ),
  // A crop frame: the part of the canvas that is the picture.
  canvas: (
    <>
      <rect x="3.2" y="5.4" width="13.6" height="9.2" rx="1.2" />
      <path d="M6.4 2.6v14.8M13.6 2.6v14.8" opacity="0.55" />
    </>
  ),
  // Two shapes joined into one outline: merging territories into a group.
  merge: (
    <>
      <path d="M3 6.2h6.4v3.4h4.2V6.2H17v8.6H3z" />
      <path d="M9.4 9.6v5.2M13.6 9.6v5.2" opacity="0.4" strokeDasharray="1.4 1.4" />
    </>
  ),
  // An eye struck through: taking territories off the map.
  hide: (
    <>
      <path d="M2.4 10c2-3.6 4.6-5.4 7.6-5.4s5.6 1.8 7.6 5.4c-2 3.6-4.6 5.4-7.6 5.4S4.4 13.6 2.4 10z" />
      <circle cx="10" cy="10" r="2.4" />
      <path d="M3.6 16.4 16.4 3.6" />
    </>
  ),
  // A shape and its copy laid over another place.
  overlay: (
    <>
      <path d="M3 4.4h7.4v7.4H3z" opacity="0.55" strokeDasharray="1.8 1.6" />
      <path d="M9.6 8.2H17v7.4H9.6z" />
      <path d="M7.6 12.8 9.2 14.4" />
    </>
  ),
  // A bar chart: the values the map is coloured by.
  data: (
    <>
      <path d="M3.2 16.4h13.6" />
      <path d="M6 16.4V9.2M10 16.4V4.6M14 16.4v-4.8" />
    </>
  ),
  // A smiling face: pictures put on the territories.
  stickers: (
    <>
      <circle cx="10" cy="10" r="7" />
      <circle cx="7.6" cy="8.4" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="12.4" cy="8.4" r="0.9" fill="currentColor" stroke="none" />
      <path d="M6.8 11.8c1.7 2 4.7 2 6.4 0" />
    </>
  ),
  // A key: swatches against their labels.
  legend: (
    <>
      <rect x="2.8" y="3.6" width="14.4" height="12.8" rx="1.6" />
      <rect x="5.4" y="7" width="2.4" height="2.4" rx="0.5" />
      <rect x="5.4" y="11.2" width="2.4" height="2.4" rx="0.5" />
      <path d="M10 8.2h4.2M10 12.4h4.2" />
    </>
  ),
  // A page with a folded corner and an arrow through it: the map as a file, out and back in.
  svg: (
    <>
      <path d="M5 2.8h6.4l3.6 3.6v10.8H5z" />
      <path d="M11.4 2.8v3.6H15" />
      <path d="M10 8.6v5.4M7.8 11.8 10 14l2.2-2.2" />
    </>
  ),
}

/** The space kept between the dropdown and the sidebar's top and bottom edges, in pixels. */
const DROP_GAP = 6

interface SidebarSection {
  id: string
  name: string
  /**
   * What the rail calls it, when the full name is too long for 56 pixels.
   *
   * The rail caption and the panel heading answer different questions — "which button
   * is this" against "what am I looking at" — so a section is allowed two names rather
   * than one truncated one.
   */
  short?: string
  body: ReactNode
}

/*
 * The sections, top to bottom: Select, then what colours the map and what is put on it (Data,
 * Stickers), how it is framed (Canvas), the tools that act on what is selected (Overlay, Merge,
 * Hide), how it is explained (Legend) and the SVG round trip. Which map, its templates, how it is
 * displayed and the editor's own settings are in the top bar's File menu (`TopBar.tsx`).
 *
 * Every control below is the component it always was, with the same hooks and the same
 * operations, referenced exactly once. Nothing was rewritten to be moved: where a component held
 * controls for two places, it was split along that seam.
 *
 * A section shows everything at once, one scroll down, its parts under plain headings
 * (`Section`) rather than folds — as the Overlay and Hide panels always have.
 */
const SECTIONS: SidebarSection[] = [
  {
    id: 'select',
    name: 'Select',
    body: <SelectionControls />,
  },
  {
    /* The colouring modes — Data, Groups, Flags; none on is off — and each mode's own workflow. */
    id: 'data',
    name: 'Data',
    body: <DataPalette />,
  },
  {
    /*
     * Pictures on the territories — faces, icons — chosen by the data or put there by hand. Next to
     * Data because the tiers follow its active scale. See `state/stickers.ts`.
     */
    id: 'stickers',
    name: 'Stickers',
    body: <StickerControls />,
  },
  /*
   * Composition and framing only: the part of the canvas that is the picture. Nothing in it
   * moves the map, zooms it or changes what is drawn.
   */
  { id: 'canvas', name: 'Canvas', body: <ScreenControls /> },
  /*
   * Doing things to the map's entities, as opposed to colouring or drawing them — three tools,
   * each its own section; opening one is choosing that tool.
   *
   * The Overlay panel's being mounted is what the store reads as the overlay tool being open
   * (`setOverlayMode`), since a closed section unmounts its body.
   */
  /* Copies of an entity's shape laid over another place. */
  { id: 'overlay', name: 'Overlay', body: <OverlayControls /> },
  { id: 'merge', name: 'Merge', body: <MergeControls /> },
  /* Taking the selected entities off the map, and bringing them back. */
  { id: 'hide', name: 'Hide', body: <HideTerritories /> },
  {
    id: 'legend',
    name: 'Legend',
    body: (
      <div className="stack">
        <LegendControls />
        {/*
          The panel's size, and where it sits: the legend is dragged into place on the map and
          resized by its corner, and these are the numeric form of the same size.
        */}
        <Section title="Position & Size">
          <div className="stack">
            <LegendSizeControls />
          </div>
        </Section>
      </div>
    ),
  },
  {
    /* At the bottom: the map out as a blank SVG to edit anywhere, and the edited file back in. */
    id: 'svg',
    name: 'SVG',
    body: <SvgExchange />,
  },
]

/**
 * The menu a right-click on a territory opens, at the pointer: the territory's name, then every
 * section of the rail in the rail's order, each with its icon. Choosing one opens that section —
 * the territory is already in the selection (`MapCanvas`), so the section works on it.
 *
 * Closes on a choice, a press anywhere else, Escape, a resize or the wheel, like every menu here.
 */
function MapSectionMenu({
  request,
  onChoose,
  onClose,
}: {
  request: MapMenuRequest
  onChoose: (sectionId: string) => void
  onClose: () => void
}) {
  const name = useMapStore((s) => {
    const merge = s.doc.merges.find((m) => m.id === request.entityId)
    return merge?.name || s.geo?.meta[request.entityId]?.name || request.entityId
  })
  const panel = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const width = panel.current?.offsetWidth ?? 200
    const height = panel.current?.offsetHeight ?? 320
    setPosition({
      left: Math.max(8, Math.min(request.x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(request.y, window.innerHeight - height - 8)),
    })
  }, [request])

  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node)) onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', onPointer, true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onClose)
    window.addEventListener('wheel', onClose, { passive: true })
    return () => {
      window.removeEventListener('pointerdown', onPointer, true)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('wheel', onClose)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={panel}
      className="top-menu map-menu"
      role="menu"
      aria-label={name}
      style={{ left: position?.left ?? -9999, top: position?.top ?? -9999 }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <span className="top-menu__heading">{name}</span>
      {SECTIONS.map((section) => (
        <button
          key={section.id}
          type="button"
          role="menuitem"
          className="top-menu__item map-menu__item"
          onClick={() => {
            onChoose(section.id)
            onClose()
          }}
        >
          <svg
            className="map-menu__icon"
            viewBox="0 0 20 20"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            {ICONS[section.id]}
          </svg>
          <span className="top-menu__name">{section.name}</span>
        </button>
      ))}
    </div>,
    document.body,
  )
}

export function Sidebar() {
  /*
   * Which section is open, or null for none. Local because it is a fact about this
   * window rather than about the map or the person — nothing here belongs in the
   * document, and it is not worth a preference either.
   *
   * Closed on load. The editor opens on the map itself rather than on a panel of
   * controls: nothing has been asked for yet, so nothing is in the way of it.
   */
  const [openId, setOpenId] = useState<string | null>(null)

  /*
   * What the panel is currently rendering, which lags `openId` on the way closed.
   *
   * The panel slides out on a transform, and a panel with nothing in it slides out
   * empty. So the contents stay mounted until the animation has finished and are then
   * dropped — closed, the section's controls are not mounted at all, and a folded panel
   * is not re-rendering its inputs every time the document changes.
   */
  const [renderedId, setRenderedId] = useState<string | null>(null)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current)
    if (openId) {
      setRenderedId(openId)
      return
    }
    // Comfortably past the 130ms slide; a little late costs nothing, early is visible.
    timer.current = window.setTimeout(() => setRenderedId(null), 260)
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [openId])

  /* Anything may ask for a section to open — a template opens the one its work continues in. */
  useEffect(
    () =>
      onOpenSidebarSection((id) => {
        if (SECTIONS.some((section) => section.id === id)) setOpenId(id)
      }),
    [],
  )

  /* A right-click on the map: the sections, in a menu at the pointer. See `MapSectionMenu`. */
  const [mapMenu, setMapMenu] = useState<MapMenuRequest | null>(null)
  useEffect(() => onOpenMapMenu(setMapMenu), [])
  const closeMapMenu = useCallback(() => setMapMenu(null), [])

  const open = SECTIONS.find((section) => section.id === openId) ?? null
  const rendered = SECTIONS.find((section) => section.id === renderedId) ?? null
  const panelRef = useRef<HTMLDivElement>(null)
  /*
   * Where the Back button is drawn: the editor's body — the row between the header and the
   * status bar, across the whole width — so it can sit at that row's bottom-right corner. The
   * sidebar itself is only the rail's width.
   */
  const rootRef = useRef<HTMLDivElement>(null)
  const [backHost, setBackHost] = useState<HTMLElement | null>(null)
  useEffect(() => setBackHost(rootRef.current?.parentElement ?? null), [])

  /*
   * Where the dropdown's top is, in the sidebar's own coordinates: level with the open section's
   * button, moved up only as far as it must be to keep the whole card inside the sidebar.
   *
   * Every card is the same height (`.sidebar__panel`), whatever is in it — a short section is not
   * a small card and a long one is not a tall card; a long one scrolls. So a choice made inside a
   * card never resizes or moves it, and switching sections never changes the card's size. It is
   * placed again only when the window is resized or the rail scrolled.
   */
  const itemRefs = useRef(new Map<string, HTMLButtonElement>())
  const railRef = useRef<HTMLElement>(null)
  const [dropTop, setDropTop] = useState(0)
  useLayoutEffect(() => {
    if (!renderedId) return
    const place = () => {
      const root = rootRef.current
      const item = itemRefs.current.get(renderedId)
      const panel = panelRef.current
      if (!root || !item || !panel) return
      const box = root.getBoundingClientRect()
      const at = item.getBoundingClientRect().top - box.top
      setDropTop(Math.max(DROP_GAP, Math.min(at, box.height - panel.offsetHeight - DROP_GAP)))
    }
    place()
    const observer = new ResizeObserver(place)
    if (rootRef.current) observer.observe(rootRef.current)
    const rail = railRef.current
    rail?.addEventListener('scroll', place, { passive: true })
    return () => {
      observer.disconnect()
      rail?.removeEventListener('scroll', place)
    }
  }, [renderedId])

  /*
   * The pill behind the open section's button. Switching from one open section to another, it
   * slides from the old button to the new one; opening a section when none was open, it simply
   * appears on that button — there is nothing to slide from, and sliding in from wherever the
   * last section was read as a selection moving that nobody made. Closing removes it. Placed
   * from the button's own box, so it follows a rail whose buttons are shorter on a short window.
   */
  const [pill, setPill] = useState<{ top: number; height: number; slide: boolean } | null>(null)
  useLayoutEffect(() => {
    const item = openId ? itemRefs.current.get(openId) : undefined
    if (!item) {
      setPill(null)
      return
    }
    setPill((current) => ({ top: item.offsetTop, height: item.offsetHeight, slide: current !== null }))
    // A resize only moves it to where its button now is; it never slides for that.
    const follow = () => setPill({ top: item.offsetTop, height: item.offsetHeight, slide: false })
    window.addEventListener('resize', follow)
    return () => window.removeEventListener('resize', follow)
  }, [openId])

  /*
   * The phone's Back button: backs out of whatever was opened last. A tool open inside the
   * section is folded first, most recent first; with none left, the section closes, exactly as
   * its own close button closes it. It only closes panels.
   */
  const back = () => {
    if (!closeLatestDisclosure(panelRef.current)) setOpenId(null)
  }

  const choose = (id: string) => {
    const next = id === openId ? null : id
    setOpenId(next)
  }

  return (
    <div className={`sidebar${open ? ' sidebar--open' : ''}`} ref={rootRef}>
      <nav className="sidebar__rail" aria-label="Map controls" ref={railRef}>
        {pill && (
          <span
            className={`rail-pill${pill.slide ? ' rail-pill--slide' : ''}`}
            aria-hidden="true"
            style={{ transform: `translateY(${pill.top}px)`, height: pill.height }}
          />
        )}
        {SECTIONS.map((section) => {
          const active = section.id === openId
          return (
            <button
              key={section.id}
              ref={(element) => {
                if (element) itemRefs.current.set(section.id, element)
                else itemRefs.current.delete(section.id)
              }}
              type="button"
              className={`rail-item${active ? ' rail-item--active' : ''}`}
              aria-expanded={active}
              aria-label={section.name}
              title={section.name}
              onClick={() => choose(section.id)}
            >
              <span className="rail-item__mark" aria-hidden="true" />
              <svg
                className="rail-item__icon"
                viewBox="0 0 20 20"
                width="20"
                height="20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                focusable="false"
              >
                {ICONS[section.id]}
              </svg>
              <span className="rail-item__caption">{section.short ?? section.name}</span>
            </button>
          )
        })}
      </nav>

      {/*
        An overlay over the map, not a column beside it. The map's container never
        changes size when this opens, so nothing about the map is recomputed — see the
        note on the grid in `global.css`.
      */}
      <div className="sidebar__panel" aria-hidden={!open} ref={panelRef} style={{ top: dropTop }}>
        {rendered && (
          <div className="sidebar__panel-inner">
            <header className="sidebar__head">
              <h2>{rendered.name}</h2>
              <button
                type="button"
                className="sidebar__collapse"
                aria-label="Close panel"
                title="Close"
                onClick={() => choose(rendered.id)}
              >
                <svg
                  viewBox="0 0 16 16"
                  width="14"
                  height="14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
                </svg>
              </button>
            </header>
            {/*
              Keyed by section, so switching sections replaces the body rather than
              reconciling into it. Without this React pairs the two trees by position:
              Settings' second `Disclosure` and Map's second `Disclosure` are the same
              element type in the same slot, so React keeps the instance and its open
              state travels between sections — leaving Sound open opened World. A key
              says these are different things, which is the truth.
            */}
            <div className="sidebar__body" key={rendered.id}>
              {rendered.body}
            </div>
            {/*
              The map, through the bottom of the panel — on a phone, where an open panel
              leaves too little of it to drag. Part of the panel itself rather than of any
              one section, so every section has it. See `MapGrip`.
            */}
            <MapGrip />
          </div>
        )}
      </div>

      {/*
        Back, on a phone only (`.mobile-back` in the stylesheet) and only while there is
        something open to back out of. Floating at the bottom-right, where a thumb holding
        the phone reaches, rather than in the panel's header at the top.
      */}
      {mapMenu && <MapSectionMenu request={mapMenu} onChoose={setOpenId} onClose={closeMapMenu} />}

      {open && backHost && createPortal(
        <button type="button" className="mobile-back" aria-label="Back" title="Back" onClick={back}>
          <svg
            viewBox="0 0 20 20"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M16 10H4.5M9.5 5 4.5 10l5 5" />
          </svg>
        </button>,
        backHost,
      )}
    </div>
  )
}
