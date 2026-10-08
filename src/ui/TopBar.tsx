/**
 * The top bar: a File menu, and which part of the map is open.
 *
 * - **File** — the map's own settings, one row each, every row opening its choices in a menu at
 *   its side, the way a desktop app's menus cascade:
 *   - **Map** — every map, grouped World / Europe / USA;
 *   - **Resolution** — the open map's levels of detail (only when it has more than one);
 *   - **Projection**;
 *   - **Outside region** — how the land outside the chosen region is drawn.
 *   On a narrow screen there is no room at the side, so a row opens its choices in place of the
 *   rows, with a way back.
 * - **Regions** — the open map's regions as split buttons. The name selects and deselects
 *   (regions combine: Europe + Asia frames Eurasia); the arrow box attached to its right opens
 *   the region's subregions, which combine the same way.
 *
 * Menus are drawn in a portal at the top of the page rather than inside the bar, so the bar can
 * scroll sideways on a narrow screen without clipping them; scrolling it closes an open menu.
 * Every change is the same operation or store action the old panels used.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useMapStore } from '../state/mapStore'
import { ATLAS_FAMILIES, ATLASES, getAtlas, type Atlas } from '../maps/atlas'
import { regionsForAtlas, subregionsOf, type RegionPreset } from '../geo/regions'
import { datasetsForAtlas } from '../geo/datasets'
import { noteDetailChosen } from '../maps/startingDetail'
import { AUTO_PROJECTION_ID, PROJECTIONS } from '../geo/projections'
import type { MapStyle, ProjectionId, RegionId } from '../types/map'

/* ------------------------------------------------------------------ popover */

/**
 * A menu floating under `anchor`. Closes on a press outside it or its anchor, on Escape, and
 * when the window is resized. Kept inside the viewport horizontally.
 */
function Popover({
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
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (panel.current?.contains(target) || anchor.current?.contains(target)) return
      onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    // Scrolling the bar moves the anchor out from under the menu, so the menu closes.
    const onScroll = (event: Event) => {
      if (panel.current?.contains(event.target as Node)) return
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
      className="top-menu"
      role="dialog"
      aria-label={label}
      style={{ top: position?.top ?? -9999, left: position?.left ?? -9999 }}
    >
      {children}
    </div>,
    document.body,
  )
}

const Chevron = () => (
  <svg className="top-button__chevron" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true" focusable="false">
    <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/** One choice in a menu: a name, an optional note under it, and a tick when it is the current one. */
function MenuItem({
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

/* ---------------------------------------------------------------------- map */

function noteFor(atlas: Atlas): string {
  if (atlas.note) return atlas.note
  const noun = atlas.noun.many.replace(/^./, (c) => c.toUpperCase())
  return atlas.insets.length > 0 ? `${noun} · ${atlas.insets.map((i) => i.name).join(' and ')} inset` : noun
}

/** Every map, grouped by family. `done` is called once one is chosen. */
function MapChoices({ done }: { done: () => void }) {
  const atlasId = useMapStore((s) => s.doc.scope.atlasId)
  const setAtlas = useMapStore((s) => s.setAtlas)
  return (
    <div className="top-menu__families">
      {ATLAS_FAMILIES.map((family) => (
        <div key={family.id} className="top-menu__group">
          <span className="top-menu__heading">{family.name}</span>
          {ATLASES.filter((a) => a.family === family.id).map((a) => (
            <MenuItem
              key={a.id}
              name={a.menuName ?? a.name}
              note={noteFor(a)}
              active={a.id === atlasId}
              onChoose={() => {
                if (a.id !== atlasId) setAtlas(a.id)
                done()
              }}
            />
          ))}
        </div>
      ))}
      <p className="top-menu__hint">Each map keeps its own work. Switching away and back returns it as it was.</p>
    </div>
  )
}

/* ------------------------------------------------------------------ regions */

function Tick() {
  return (
    <svg className="chip__check" viewBox="0 0 12 12" height="9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M2.2 6.3 4.7 8.8 9.8 3.4" />
    </svg>
  )
}

/**
 * A region as a split button: the name, and — for a region with subregions — an arrow box
 * attached to its right. The name selects and deselects; the arrow opens the subregions.
 */
function RegionChip({
  region,
  active,
  activeChildren,
  isActive,
  toggle,
}: {
  region: RegionPreset
  active: boolean
  activeChildren: number
  isActive: (id: RegionId) => boolean
  toggle: (id: RegionId) => void
}) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLDivElement>(null)
  const setRegions = useMapStore((s) => s.setRegions)
  const regionIds = useMapStore((s) => s.doc.scope.regionIds)
  const deselect = (ids: RegionId[]) => {
    const next = regionIds.filter((id) => !ids.includes(id))
    setRegions(next.length > 0 ? next : ['world'])
  }
  const children = subregionsOf(region.id)
  const hasChildren = children.length > 0
  const lit = active || activeChildren > 0

  /*
   * The name toggles the region. Lit — itself on, or any of its subregions — a click takes the
   * region and every one of its subregions off in one go; off, it puts the region on.
   */
  const clickName = () => {
    if (lit) deselect([region.id, ...children.map((c) => c.id)])
    else toggle(region.id)
  }

  return (
    <>
      <div
        ref={anchor}
        className={`top-split${lit ? ' top-split--on' : ''}${open ? ' top-split--open' : ''}${hasChildren ? '' : ' top-split--single'}`}
      >
        <button
          type="button"
          className={`chip top-split__name${lit ? ' chip--active' : ''}`}
          aria-pressed={lit}
          title={region.definition}
          onClick={clickName}
        >
          {lit && <Tick />}
          {region.name}
          {activeChildren > 0 && <span className="top-region__count">{activeChildren}</span>}
        </button>
        {hasChildren && (
          <button
            type="button"
            className={`chip top-split__more${lit ? ' chip--active' : ''}`}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-label={`${region.name} subregions`}
            title={`${region.name} subregions`}
            onClick={() => setOpen(!open)}
          >
            <Chevron />
          </button>
        )}
      </div>
      {hasChildren && (
        <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} label={`${region.name} subregions`}>
          <div className="top-menu__group">
            <span className="top-menu__heading">{region.name} subregions</span>
            <div className="top-menu__chips">
              {children.map((child) => (
                <button
                  key={child.id}
                  type="button"
                  className={`chip${isActive(child.id) ? ' chip--active' : ''}`}
                  aria-pressed={isActive(child.id)}
                  title={child.definition}
                  onClick={() => toggle(child.id)}
                >
                  {isActive(child.id) && <Tick />}
                  {child.name}
                </button>
              ))}
            </div>
            <p className="top-menu__hint">Click a subregion to add or remove it. Subregions combine with each other and with other regions.</p>
          </div>
        </Popover>
      )}
    </>
  )
}

function RegionBar() {
  const regionIds = useMapStore((s) => s.doc.scope.regionIds)
  const atlasId = useMapStore((s) => s.doc.scope.atlasId)
  const toggleRegion = useMapStore((s) => s.toggleRegion)
  const regions = regionsForAtlas(atlasId)
  const isWorld = regionIds.includes('world')
  const isActive = (id: RegionId) => (id === 'world' ? isWorld : !isWorld && regionIds.includes(id))
  if (regions.length <= 1 && regions.every((r) => subregionsOf(r.id).length === 0)) return null

  return (
    <div className="top-regions" role="group" aria-label="Regions">
      {regions.map((region) => (
        <RegionChip
          key={region.id}
          region={region}
          active={isActive(region.id)}
          activeChildren={subregionsOf(region.id).filter((c) => isActive(c.id)).length}
          isActive={isActive}
          toggle={toggleRegion}
        />
      ))}
    </div>
  )
}

/* ---------------------------------------------------------- how it is drawn */

const shortDataset = (d: ReturnType<typeof datasetsForAtlas>[number]) => d.label ?? d.detail ?? d.name

function ResolutionChoices({ done }: { done: () => void }) {
  const scope = useMapStore((s) => s.doc.scope)
  const dispatch = useMapStore((s) => s.dispatch)
  const atlas = getAtlas(scope.atlasId)
  return (
    <div className="top-menu__group">
      <span className="top-menu__heading">Resolution</span>
      {datasetsForAtlas(scope.atlasId).map((d) => (
        <MenuItem
          key={d.id}
          name={shortDataset(d)}
          note={d.description}
          active={d.id === scope.datasetId}
          onChoose={() => {
            if (d.id !== scope.datasetId) {
              dispatch({ op: 'set_scope_dataset', datasetId: d.id })
              // From now on this session the detail is the author's choice. See `startingDetail`.
              noteDetailChosen(atlas, d.id)
            }
            done()
          }}
        />
      ))}
    </div>
  )
}

const autoProjectionName = PROJECTIONS.find((p) => p.id === AUTO_PROJECTION_ID)?.name ?? 'Albers'
const projectionName = (id: ProjectionId | 'auto') =>
  id === 'auto' ? `Auto (${autoProjectionName})` : (PROJECTIONS.find((p) => p.id === id)?.name ?? id)

function ProjectionChoices({ done }: { done: () => void }) {
  const projectionId = useMapStore((s) => s.doc.scope.projectionId)
  const dispatch = useMapStore((s) => s.dispatch)
  return (
    <div className="top-menu__group">
      <span className="top-menu__heading">Projection</span>
      {(['auto', ...PROJECTIONS.map((p) => p.id)] as Array<ProjectionId | 'auto'>).map((id) => (
        <MenuItem
          key={id}
          name={projectionName(id)}
          active={id === projectionId}
          onChoose={() => {
            dispatch({ op: 'set_scope_projection', projectionId: id })
            done()
          }}
        />
      ))}
    </div>
  )
}

const OUTSIDE: Array<{ id: MapStyle['outsideScope']; name: string; note: string }> = [
  { id: 'muted', name: 'Muted', note: 'Drawn in a quieter tone, so the region reads first.' },
  { id: 'hidden', name: 'Hidden', note: 'Not drawn at all.' },
  { id: 'normal', name: 'Normal', note: 'Drawn exactly like the land inside the region.' },
]

function OutsideChoices({ done }: { done: () => void }) {
  const outside = useMapStore((s) => s.doc.style.outsideScope)
  const dispatch = useMapStore((s) => s.dispatch)
  return (
    <div className="top-menu__group">
      <span className="top-menu__heading">Land outside the region</span>
      {OUTSIDE.map((o) => (
        <MenuItem
          key={o.id}
          name={o.name}
          note={o.note}
          active={o.id === outside}
          onChoose={() => {
            dispatch({ op: 'set_style', patch: { outsideScope: o.id } })
            done()
          }}
        />
      ))}
    </div>
  )
}

/* --------------------------------------------------------------------- file */

type FileSection = 'map' | 'resolution' | 'projection' | 'outside'

const CHOICES: Record<FileSection, (props: { done: () => void }) => JSX.Element> = {
  map: MapChoices,
  resolution: ResolutionChoices,
  projection: ProjectionChoices,
  outside: OutsideChoices,
}

const ChevronRight = () => (
  <svg className="top-file__arrow" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true" focusable="false">
    <path d="M4.5 3 7.5 6 4.5 9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/** Whether a side menu would have no room: the same width at which the bar starts to scroll. */
function useNarrow(): boolean {
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
 * The menu at a row's side. It lives inside the File menu's panel, so a press in it counts as a
 * press in the menu, but is fixed to the viewport, so the panel's scrolling does not clip it.
 * To the row's right where there is room, else to the panel's left.
 */
function Flyout({ row, children }: { row: HTMLElement; children: ReactNode }) {
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
  return (
    <div ref={panel} className="top-menu top-flyout" style={{ top: position?.top ?? -9999, left: position?.left ?? -9999 }}>
      {children}
    </div>
  )
}

function FileMenu() {
  const [open, setOpen] = useState(false)
  const [section, setSection] = useState<FileSection | null>(null)
  const [row, setRow] = useState<HTMLElement | null>(null)
  const anchor = useRef<HTMLButtonElement>(null)
  const narrow = useNarrow()
  const scope = useMapStore((s) => s.doc.scope)
  const outside = useMapStore((s) => s.doc.style.outsideScope)
  const atlas = getAtlas(scope.atlasId)
  const datasets = datasetsForAtlas(scope.atlasId)
  const dataset = datasets.find((d) => d.id === scope.datasetId)

  const close = () => {
    setOpen(false)
    setSection(null)
  }
  const show = (next: FileSection, element: HTMLElement) => {
    setSection(next)
    setRow(element)
  }

  const rows: Array<{ id: FileSection; name: string; value: string }> = [
    { id: 'map', name: 'Map', value: atlas.menuName ?? atlas.name },
    ...(datasets.length > 1 ? [{ id: 'resolution' as const, name: 'Resolution', value: dataset ? shortDataset(dataset) : '—' }] : []),
    { id: 'projection', name: 'Projection', value: projectionName(scope.projectionId) },
    { id: 'outside', name: 'Outside region', value: OUTSIDE.find((o) => o.id === outside)?.name ?? outside },
  ]
  const Choices = section ? CHOICES[section] : null

  return (
    <>
      <button
        ref={anchor}
        type="button"
        className={`top-button top-button--file${open ? ' top-button--open' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`File · ${atlas.menuName ?? atlas.name}`}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span className="top-button__value">File</span>
        <Chevron />
      </button>
      <Popover anchor={anchor} open={open} onClose={close} label="File">
        {narrow && Choices ? (
          <div className="top-file">
            <button type="button" className="top-menu__item top-file__back" onClick={() => setSection(null)}>
              <span className="top-file__back-arrow" aria-hidden="true">‹</span>
              <span className="top-menu__name">File</span>
            </button>
            <Choices done={close} />
          </div>
        ) : (
          <div className="top-file" role="menu">
            {rows.map((r) => (
              <button
                key={r.id}
                type="button"
                role="menuitem"
                aria-haspopup="true"
                aria-expanded={section === r.id}
                className={`top-menu__item top-file__row${section === r.id ? ' top-file__row--open' : ''}`}
                onPointerEnter={(event) => {
                  if (event.pointerType === 'mouse' && !narrow) show(r.id, event.currentTarget)
                }}
                onClick={(event) => show(r.id, event.currentTarget)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowRight') show(r.id, event.currentTarget)
                  if (event.key === 'ArrowLeft') setSection(null)
                }}
              >
                <span className="top-file__name">{r.name}</span>
                <span className="top-file__value">{r.value}</span>
                <ChevronRight />
              </button>
            ))}
            {!narrow && Choices && row && (
              <Flyout row={row}>
                <Choices done={close} />
              </Flyout>
            )}
          </div>
        )}
      </Popover>
    </>
  )
}

/** The left of the bar: the File menu and the open map's regions. */
export function TopBarScope() {
  return (
    <div className="top-scope">
      <FileMenu />
      <RegionBar />
    </div>
  )
}
