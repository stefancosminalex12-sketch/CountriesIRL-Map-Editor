/**
 * The left sidebar: a rail of sections that opens one at a time.
 *
 * The rail is always visible and always the same width, so the map's left edge only
 * moves when the author asks it to. Choosing a section slides a panel out beside it;
 * choosing the same one again closes it. One open section rather than a scrolling
 * column of all of them, because the previous layout put region chips, two selects,
 * five switches and three colour wells on screen at once and left the reader to work
 * out which belonged together.
 *
 * The sections are a plain array. Adding one is an entry with an icon and a body — no
 * new markup, no new styling, and it inherits the animation, the active state and the
 * keyboard behaviour along with everything else.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { RegionSelector } from './RegionSelector'
import { MapPicker } from './MapPicker'
import { MapColorSwatches, MapDisplayToggles, MapScopeSettings } from './MapSettings'
import { DataSources, SelectionHighlight, SoundSettings, ThemePicker } from './SettingsPanel'
import { DataPalette } from './DataPalette'
import { LegendControls, LegendSizeControls } from './LegendControls'
import { ScreenControls } from './ScreenControls'
import { MergeControls } from './MergeControls'
import { Disclosure } from './Panels'
import { playSfx } from '../audio/sfx'

/**
 * Line icons on a 20-unit grid, stroked in `currentColor`.
 *
 * One idea each, legible at 18px: they are what the rail shows when it is closed, so a
 * glyph that needs a caption to be understood is a glyph that has failed here.
 */
const ICONS: Record<string, ReactNode> = {
  // Sliders: the preferences, rather than anything about the map itself.
  settings: (
    <>
      <path d="M3.4 6.2h13.2M3.4 13.8h13.2" />
      <circle cx="8" cy="6.2" r="1.9" />
      <circle cx="12.6" cy="13.8" r="1.9" />
    </>
  ),
  // Stacked sheets: the data behind the drawing, and how it is projected.
  map: (
    <>
      <path d="M3 6.4 10 3.2l7 3.2-7 3.2z" />
      <path d="M3 10.4 10 13.6l7-3.2" />
      <path d="M3 14.1 10 17.3l7-3.2" />
    </>
  ),
  // A crop frame: the part of the canvas that is the picture.
  screen: (
    <>
      <rect x="3.2" y="5.4" width="13.6" height="9.2" rx="1.2" />
      <path d="M6.4 2.6v14.8M13.6 2.6v14.8" opacity="0.55" />
    </>
  ),
  // A bar chart: the values the map is coloured by.
  data: (
    <>
      <path d="M3.2 16.4h13.6" />
      <path d="M6 16.4V9.2M10 16.4V4.6M14 16.4v-4.8" />
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
  // A spark: the assistant that will translate language into operations.
  assistant: (
    <>
      <path d="M10 3.2 11.6 8 16.4 9.6 11.6 11.2 10 16 8.4 11.2 3.6 9.6 8.4 8z" />
      <path d="M15.4 3.4 15.9 5 17.5 5.5 15.9 6 15.4 7.6 14.9 6 13.3 5.5 14.9 5z" />
    </>
  ),
}

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
 * Order is an authoring decision rather than a derived one, so it is simply the order
 * of this array: look, then subject, then content, then the preferences.
 *
 * Everything that used to live in a second panel on the right is here. A single
 * sidebar means one place to look for a control instead of two, and it gives the map
 * back the 276px that panel was holding permanently.
 *
 * The rail is two levels deep rather than one. Ten flat sections asked the reader to
 * hold ten unrelated names in mind to find one control; grouping them puts the question
 * first — is this about the map, about the data, or about the editor? — and each group's
 * parts behind a `Disclosure`. That component was already here for the legend's panel
 * size, and it is the right primitive for this: open/closed is local component state,
 * nothing reaches the document, and a closed subsection is *unmounted*, so folding one
 * away stops it reading the document on every render. Nothing below this array changed —
 * every control is the same component with the same props, moved.
 */
const SECTIONS: SidebarSection[] = [
  {
    id: 'settings',
    name: 'Settings',
    body: (
      <div className="stack">
        {/* Open by default, so the section still shows something when it is chosen. */}
        <Disclosure title="Style" defaultOpen>
          <div className="stack">
            <ThemePicker />
            <div className="sidebar__group">
              <span className="sidebar__group-label">Map colours</span>
              <MapColorSwatches />
            </div>
            <div className="sidebar__group">
              <span className="sidebar__group-label">Selection highlight</span>
              <SelectionHighlight />
            </div>
          </div>
        </Disclosure>
        <Disclosure title="Sound">
          <SoundSettings />
        </Disclosure>
        <Disclosure title="Data sources">
          <DataSources />
        </Disclosure>
      </div>
    ),
  },
  {
    id: 'map',
    name: 'Map',
    body: (
      <div className="stack">
        {/*
          Maps first: which geography this is a map of is the question asked before every
          other one in the section, since the answer decides what the rest of them mean.
        */}
        <Disclosure title="Maps">
          <MapPicker />
        </Disclosure>
        {/*
          Then Region: what area of that map to frame. Collapsed like the two below it,
          so choosing Map presents four closed subsections rather than one that has
          already decided which question the author came to answer.
        */}
        <Disclosure title="Region">
          <RegionSelector />
        </Disclosure>
        <Disclosure title="World">
          <MapScopeSettings />
        </Disclosure>
        <Disclosure title="Display">
          <MapDisplayToggles />
        </Disclosure>
      </div>
    ),
  },
  { id: 'screen', name: 'Screen', body: <ScreenControls /> },
  {
    id: 'data',
    name: 'Data',
    short: 'Data',
    body: (
      <div className="stack">
        {/*
          The mode switch and its workflows stay in the open — they are what the section
          is for. Merge is a separate act on the same selection, so it folds away beneath
          them rather than competing with the mode the author is actually in.
        */}
        <DataPalette />
        <Disclosure title="Merge">
          <MergeControls />
        </Disclosure>
      </div>
    ),
  },
  {
    id: 'legend',
    name: 'Legend',
    body: (
      <div className="stack">
        <LegendControls />
        {/*
          Folded away, because the legend's own corner already resizes it by hand — this
          is the numeric alternative, and the part of the section most often left alone.
          Folding it is what keeps the section inside the sidebar without scrolling.
        */}
        <Disclosure title="Panel size">
          <LegendSizeControls />
        </Disclosure>
      </div>
    ),
  },
  {
    id: 'assistant',
    name: 'AI assistant',
    short: 'AI',
    /* Space held for a feature that is architected but not built; see `ReservedSection`. */
    body: (
      <div className="stack">
        <span className="badge">Later</span>
        <p className="hint">
          Natural language will be translated into validated map operations and applied
          through the same pipeline the inspector uses.
        </p>
      </div>
    ),
  },
]

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

  const open = SECTIONS.find((section) => section.id === openId) ?? null
  const rendered = SECTIONS.find((section) => section.id === renderedId) ?? null

  const choose = (id: string) => {
    const next = id === openId ? null : id
    setOpenId(next)
    playSfx(next ? 'toggleOn' : 'toggleOff')
  }

  return (
    <div className={`sidebar${open ? ' sidebar--open' : ''}`}>
      <nav className="sidebar__rail" aria-label="Map controls">
        {SECTIONS.map((section) => {
          const active = section.id === openId
          return (
            <button
              key={section.id}
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
                width="18"
                height="18"
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
      <div className="sidebar__panel" aria-hidden={!open}>
        {rendered && (
          <div className="sidebar__panel-inner">
            <header className="sidebar__head">
              <h2>{rendered.name}</h2>
              <button
                type="button"
                className="sidebar__collapse"
                aria-label="Collapse panel"
                title="Collapse"
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
                  <path d="M9.5 4 5.5 8l4 4" />
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
          </div>
        )}
      </div>
    </div>
  )
}
