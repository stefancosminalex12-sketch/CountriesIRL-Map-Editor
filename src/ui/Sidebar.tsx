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
import {
  GeographicFeatureToggles,
  HideTerritories,
  LabelsAndHelpers,
  LegendVisibilityToggle,
  MapColorSwatches,
  MapDetailSettings,
  OutsideRegionAppearance,
} from './MapSettings'
import { HistoryButtons } from './HistoryControls'
import { DataSources, SelectionHighlight, SoundSettings, ThemePicker } from './SettingsPanel'
import { DataPalette } from './DataPalette'
import { LegendControls, LegendSizeControls } from './LegendControls'
import { ScreenControls } from './ScreenControls'
import { MergeControls } from './MergeControls'
import { OverlayControls } from './OverlayControls'
import { SelectionControls } from './SelectionControls'
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
  maps: (
    <>
      <path d="M3 6.4 10 3.2l7 3.2-7 3.2z" />
      <path d="M3 10.4 10 13.6l7-3.2" />
      <path d="M3 14.1 10 17.3l7-3.2" />
    </>
  ),
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
  // A pencil over a line: changing the map's entities themselves.
  edit: (
    <>
      <path d="M12.6 3.6l3.8 3.8-8.6 8.6H4v-3.8z" />
      <path d="M10.8 5.4l3.8 3.8" />
    </>
  ),
  // An eye: what the map shows.
  display: (
    <>
      <path d="M2.4 10c2-3.6 4.6-5.4 7.6-5.4s5.6 1.8 7.6 5.4c-2 3.6-4.6 5.4-7.6 5.4S4.4 13.6 2.4 10z" />
      <circle cx="10" cy="10" r="2.4" />
    </>
  ),
  // A bar chart: the values the map is coloured by.
  data: (
    <>
      <path d="M3.2 16.4h13.6" />
      <path d="M6 16.4V9.2M10 16.4V4.6M14 16.4v-4.8" />
    </>
  ),
  // Two outlines, one lifted off the other: a shape copied and moved.
  overlays: (
    <>
      <path d="M3 8.2 7.6 4.4l5 1.6-.6 5.4-5.6 1.8z" opacity="0.55" />
      <path d="M7.6 10.6 12.4 7l4.6 2.4-1 5.4-5.4 1.4z" strokeDasharray="2.2 1.6" />
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
 * The sections, top to bottom, in the order the work goes: which map, what is selected, what is
 * done to it, how the map is drawn, what colours it, what is laid over it, how it is explained,
 * how it is framed — and then the editor's own preferences, and the assistant still to come.
 *
 * Every control below is the component it always was, with the same hooks and the same
 * operations, referenced exactly once (the one deliberate exception is Show Legend, which is one
 * switch shown in Display and in Legend — see `LegendVisibilityToggle`). Nothing was rewritten to
 * be moved: where a component held controls for two sections, it was split along that seam.
 *
 * Each section's parts sit behind a `Disclosure`: open/closed is local component state, nothing
 * reaches the document, and a closed subsection is *unmounted*, so folding one away stops it
 * reading the document on every render. The part a section is usually opened for is open when
 * the section is.
 */
const SECTIONS: SidebarSection[] = [
  {
    id: 'maps',
    name: 'Maps',
    body: (
      <div className="stack">
        {/*
          The map first: which geography this is a map of is the question asked before every
          other one, since the answer decides what the rest of them mean.
        */}
        <Disclosure title="Map" defaultOpen>
          <MapPicker />
        </Disclosure>
        <Disclosure title="Region">
          <RegionSelector />
        </Disclosure>
        <Disclosure title="Map Detail">
          <MapDetailSettings />
        </Disclosure>
        <Disclosure title="Outside Region Appearance">
          <OutsideRegionAppearance />
        </Disclosure>
      </div>
    ),
  },
  {
    id: 'select',
    name: 'Select',
    body: <SelectionControls />,
  },
  {
    /*
     * Doing things to the map's entities, as opposed to colouring or drawing them. Merge is the
     * first tool here; it used to be folded under Data, where it read as part of the colouring
     * modes. It stays folded: opening it is what makes a tap on the map build a group, so it is
     * opened on purpose rather than by opening the section to undo something.
     */
    id: 'edit',
    name: 'Edit',
    body: (
      <div className="stack">
        <Disclosure title="Merge Groups">
          <MergeControls />
        </Disclosure>
        <Disclosure title="History" defaultOpen>
          <HistoryButtons />
        </Disclosure>
      </div>
    ),
  },
  {
    id: 'display',
    name: 'Display',
    body: (
      <div className="stack">
        <Disclosure title="Appearance">
          <div className="stack">
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
        <Disclosure title="Geographic Features" defaultOpen>
          <GeographicFeatureToggles />
        </Disclosure>
        <Disclosure title="Labels & Helpers">
          <LabelsAndHelpers />
        </Disclosure>
        <Disclosure title="Territories">
          <HideTerritories />
        </Disclosure>
        <Disclosure title="Legend Visibility">
          <LegendVisibilityToggle />
        </Disclosure>
      </div>
    ),
  },
  {
    /* The colouring modes — Off, Data, Compare, Flags — and each mode's own workflow. */
    id: 'data',
    name: 'Styles & Data',
    short: 'Styles',
    body: <DataPalette />,
  },
  /*
   * Its own section because an overlay is not data: it is a picture of one place laid over
   * another.
   */
  { id: 'overlays', name: 'Overlays', body: <OverlayControls /> },
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
        <Disclosure title="Position & Size">
          <div className="stack">
            <LegendSizeControls />
            <p className="hint">
              Drag the legend on the map to move it — it snaps to the canvas's edges and centre —
              and drag its corner to resize it.
            </p>
          </div>
        </Disclosure>
      </div>
    ),
  },
  /*
   * Composition and framing only: the part of the canvas that is the picture. Nothing in it
   * moves the map, zooms it or changes what is drawn.
   */
  { id: 'canvas', name: 'Canvas', body: <ScreenControls /> },
  {
    /* The editor's own preferences — nothing here is about the map being made. */
    id: 'settings',
    name: 'Settings',
    body: (
      <div className="stack">
        <Disclosure title="Appearance" defaultOpen>
          <div className="sidebar__group">
            <span className="sidebar__group-label">Theme</span>
            <ThemePicker />
          </div>
        </Disclosure>
        {/*
          Open too, because what is in it is a slider: folded away, setting the volume took a
          click to open the section and then the drag, and the click is not part of what
          anyone came to do.
        */}
        <Disclosure title="Audio" defaultOpen>
          <SoundSettings />
        </Disclosure>
        <Disclosure title="Data Sources">
          <DataSources />
        </Disclosure>
      </div>
    ),
  },
  {
    id: 'assistant',
    name: 'AI',
    /* Space held for a feature that is architected but not built: one line, not a panel of nothing. */
    body: (
      <p className="hint">
        <span className="badge">Coming soon</span> Describe a map in words and the assistant will
        build it through the same operations the editor uses.
      </p>
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
