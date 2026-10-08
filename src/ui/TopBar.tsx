/**
 * The top bar: which map, which part of it, and how it is drawn.
 *
 * What used to be the sidebar's Maps section, laid out along the header so it is always one
 * click away:
 *
 * - **Map** — an icon that opens a menu of every map, grouped World / Europe / USA.
 * - **Regions** — the open map's regions as chips. A click on a region that is not on adds it
 *   (regions combine: Europe + Asia frames Eurasia). A click on one that is already on opens its
 *   subregions underneath, where it can also be taken off again. A region with no subregions
 *   simply toggles.
 * - On the right: **Resolution**, **Projection** and **Outside region**, each a button naming its
 *   current value that opens the choices.
 *
 * Menus are drawn in a portal at the top of the page rather than inside the bar, so the bar can
 * scroll sideways on a narrow screen without clipping them; scrolling it closes an open menu. Every change is the same operation
 * or store action the old panels used.
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

/** A header button that opens a menu of choices. */
function MenuButton({
  label,
  value,
  title,
  icon,
  children,
  align,
  className = '',
}: {
  label?: string
  value: ReactNode
  title: string
  icon?: ReactNode
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
        {icon}
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

const MAP_ICON = (
  <svg className="top-button__icon" viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M3 6.4 10 3.2l7 3.2-7 3.2z" />
    <path d="M3 10.4 10 13.6l7-3.2" />
    <path d="M3 14.1 10 17.3l7-3.2" />
  </svg>
)

function noteFor(atlas: Atlas): string {
  if (atlas.note) return atlas.note
  const noun = atlas.noun.many.replace(/^./, (c) => c.toUpperCase())
  return atlas.insets.length > 0 ? `${noun} · ${atlas.insets.map((i) => i.name).join(' and ')} inset` : noun
}

function MapMenu() {
  const atlasId = useMapStore((s) => s.doc.scope.atlasId)
  const setAtlas = useMapStore((s) => s.setAtlas)
  const atlas = getAtlas(atlasId)
  return (
    <MenuButton title="Change map" icon={MAP_ICON} value={atlas.menuName ?? atlas.name} className="top-button--map">
      {(close) => (
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
                    close()
                  }}
                />
              ))}
            </div>
          ))}
          <p className="top-menu__hint">Each map keeps its own work. Switching away and back returns it as it was.</p>
        </div>
      )}
    </MenuButton>
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
  const anchor = useRef<HTMLButtonElement>(null)
  const children = subregionsOf(region.id)
  const hasChildren = children.length > 0
  const lit = active || activeChildren > 0

  const click = () => {
    // First click puts the region on; a click on one already on opens its subregions.
    if (lit && hasChildren) setOpen(!open)
    else toggle(region.id)
  }

  return (
    <>
      <button
        ref={anchor}
        type="button"
        className={`chip top-region${lit ? ' chip--active' : ''}${open ? ' top-region--open' : ''}`}
        aria-pressed={lit}
        aria-haspopup={hasChildren ? 'dialog' : undefined}
        aria-expanded={hasChildren ? open : undefined}
        title={hasChildren && lit ? `${region.name}: click again for subregions` : region.definition}
        onClick={click}
      >
        <Tick />
        {region.name}
        {activeChildren > 0 && <span className="top-region__count">{activeChildren}</span>}
        {hasChildren && lit && <Chevron />}
      </button>
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
                  <Tick />
                  {child.name}
                </button>
              ))}
            </div>
            <p className="top-menu__hint">Subregions combine with each other and with other regions.</p>
            {active && (
              <button
                type="button"
                className="btn btn--ghost top-menu__remove"
                onClick={() => {
                  toggle(region.id)
                  setOpen(false)
                }}
              >
                Remove {region.name}
              </button>
            )}
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

function ResolutionMenu() {
  const scope = useMapStore((s) => s.doc.scope)
  const dispatch = useMapStore((s) => s.dispatch)
  const atlas = getAtlas(scope.atlasId)
  const datasets = datasetsForAtlas(scope.atlasId)
  if (datasets.length <= 1) return null
  const current = datasets.find((d) => d.id === scope.datasetId)
  const label = 'Resolution'
  const short = (d: (typeof datasets)[number]) => d.label ?? d.detail ?? d.name
  return (
    <MenuButton label={label} value={current ? short(current) : '—'} title={label} align="end">
      {(close) => (
        <div className="top-menu__group">
          <span className="top-menu__heading">{label}</span>
          {datasets.map((d) => (
            <MenuItem
              key={d.id}
              name={short(d)}
              note={d.description}
              active={d.id === scope.datasetId}
              onChoose={() => {
                if (d.id !== scope.datasetId) {
                  dispatch({ op: 'set_scope_dataset', datasetId: d.id })
                  // From now on this session the detail is the author's choice. See `startingDetail`.
                  noteDetailChosen(atlas, d.id)
                }
                close()
              }}
            />
          ))}
        </div>
      )}
    </MenuButton>
  )
}

function ProjectionMenu() {
  const projectionId = useMapStore((s) => s.doc.scope.projectionId)
  const dispatch = useMapStore((s) => s.dispatch)
  const autoName = PROJECTIONS.find((p) => p.id === AUTO_PROJECTION_ID)?.name ?? 'Albers'
  const nameOf = (id: ProjectionId | 'auto') =>
    id === 'auto' ? `Auto (${autoName})` : (PROJECTIONS.find((p) => p.id === id)?.name ?? id)
  const choose = (id: ProjectionId | 'auto') => dispatch({ op: 'set_scope_projection', projectionId: id })
  return (
    <MenuButton label="Projection" value={nameOf(projectionId)} title="Projection" align="end">
      {(close) => (
        <div className="top-menu__group">
          <span className="top-menu__heading">Projection</span>
          {(['auto', ...PROJECTIONS.map((p) => p.id)] as Array<ProjectionId | 'auto'>).map((id) => (
            <MenuItem
              key={id}
              name={nameOf(id)}
              active={id === projectionId}
              onChoose={() => {
                choose(id)
                close()
              }}
            />
          ))}
        </div>
      )}
    </MenuButton>
  )
}

const OUTSIDE: Array<{ id: MapStyle['outsideScope']; name: string; note: string }> = [
  { id: 'muted', name: 'Muted', note: 'Drawn in a quieter tone, so the region reads first.' },
  { id: 'hidden', name: 'Hidden', note: 'Not drawn at all.' },
  { id: 'normal', name: 'Normal', note: 'Drawn exactly like the land inside the region.' },
]

function OutsideMenu() {
  const outside = useMapStore((s) => s.doc.style.outsideScope)
  const dispatch = useMapStore((s) => s.dispatch)
  const current = OUTSIDE.find((o) => o.id === outside)
  return (
    <MenuButton label="Outside region" value={current?.name ?? outside} title="Outside region appearance" align="end">
      {(close) => (
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
                close()
              }}
            />
          ))}
        </div>
      )}
    </MenuButton>
  )
}

/** The left of the bar: the map menu and the open map's regions. */
export function TopBarScope() {
  return (
    <div className="top-scope">
      <MapMenu />
      <RegionBar />
    </div>
  )
}

/** The right of the bar: resolution, projection and outside-region appearance. */
export function TopBarDrawing() {
  return (
    <div className="top-drawing">
      <ResolutionMenu />
      <ProjectionMenu />
      <OutsideMenu />
    </div>
  )
}
