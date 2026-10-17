/**
 * The top bar: a File menu, and which part of the map is open.
 *
 * - **File** — the map's own settings, one row each, every row opening its choices in a menu at
 *   its side, the way a desktop app's menus cascade:
 *   - **New map**, first — not a menu but the action: this map started again (`newMap`), undoable;
 *   - **Templates**, first — the built-in presets, which set up the rows below;
 *   - **Maps** — World, Europe and USA as buttons, and the chosen one's maps under them; under
 *     World, the World map in its past years too ("World 1990", "World 1945"…);
 *   - **Resolution** — the open map's levels of detail (only when it has more than one);
 *   - **Projection**;
 *   - **Outside region** — how the land outside the chosen region is drawn;
 *   - **Display** — cascading once more, to Appearance, Geographic Features and Labels &
 *     Helpers, each a panel of the switches the rail's Display section held;
 *   - **Settings**, last — the editor's own preferences: Theme and Data
 *     Sources, as the rail's Settings section held them.
 *   On a narrow screen there is no room at the side, so a row opens its choices in place of the
 *   rows, with a way back up a level.
 * - **Regions** — the open map's regions as split buttons. The name selects and deselects
 *   (regions combine: Europe + Asia frames Eurasia); the arrow box attached to its right opens
 *   the region's subregions, which combine the same way.
 *
 * Menus are drawn in a portal at the top of the page rather than inside the bar, so the bar can
 * scroll sideways on a narrow screen without clipping them; scrolling it closes an open menu.
 * Every change is the same operation or store action the old panels used.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Chevron, ChevronRight, Flyout, MenuItem, Popover, useNarrow } from './Menu'
import { GeographicFeatureToggles, LabelsAndHelpers, LineWidthSwatches, MapColorSwatches } from './MapSettings'
import { DataSources, SelectionHighlight, ThemePicker, TransparencySwitch } from './SettingsPanel'
import { TemplatePicker } from './TemplatePicker'
import { useMapStore } from '../state/mapStore'
import { ATLAS_FAMILIES, ATLASES, getAtlas, MODERN_YEAR, yearOfDataset, type Atlas } from '../maps/atlas'
import { barChildren, regionsForAtlas, type RegionPreset } from '../geo/regions'
import { datasetsForAtlas, getDataset } from '../geo/datasets'
import { noteDetailChosen } from '../maps/startingDetail'
import { AUTO_PROJECTION_ID, PROJECTIONS } from '../geo/projections'
import type { MapStyle, ProjectionId, RegionId } from '../types/map'

/* ---------------------------------------------------------------------- map */

function noteFor(atlas: Atlas): string {
  if (atlas.note) return atlas.note
  const noun = atlas.noun.many.replace(/^./, (c) => c.toUpperCase())
  return atlas.insets.length > 0 ? `${noun} · ${atlas.insets.map((i) => i.name).join(' and ')} inset` : noun
}

/** Every map, grouped by family. `done` is called once one is chosen. */
/**
 * File → Maps: the map families as a row of buttons on the region bar's track — World, Europe,
 * USA — and the chosen family's maps under it. Opens on the family of the map that is open; a
 * click on another family shows its maps instead, and a click on a map opens it.
 *
 * A map with past years (`Atlas.years`) lists them under itself, newest first: "World 1990",
 * "World 1945". One is the same map in that year — `setYear`, which keeps the region, frame and
 * colours — so the map itself reads as today's while a year is open.
 */
function MapChoices({ done }: { done: () => void }) {
  const atlasId = useMapStore((s) => s.doc.scope.atlasId)
  const year = useMapStore((s) => yearOfDataset(s.doc.scope.datasetId))
  const setAtlas = useMapStore((s) => s.setAtlas)
  const setYear = useMapStore((s) => s.setYear)
  const [family, setFamily] = useState<string>(() => ATLASES.find((a) => a.id === atlasId)?.family ?? ATLAS_FAMILIES[0].id)
  return (
    <div className="top-maps">
      <div className="top-regions top-maps__families" role="tablist" aria-label="Map families">
        {ATLAS_FAMILIES.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={f.id === family}
            className={`chip${f.id === family ? ' chip--active' : ''}`}
            onClick={() => setFamily(f.id)}
          >
            <Tick />
            {f.name}
          </button>
        ))}
      </div>
      <div className="top-menu__group" role="tabpanel">
        {ATLASES.filter((a) => a.family === family).map((a) => [
          <MenuItem
            key={a.id}
            name={a.menuName ?? a.name}
            note={noteFor(a)}
            active={a.id === atlasId && year === MODERN_YEAR}
            onChoose={() => {
              if (a.id !== atlasId) setAtlas(a.id)
              else if (year !== MODERN_YEAR) setYear(MODERN_YEAR)
              done()
            }}
          />,
          ...[...(a.years ?? [])].reverse().map((d) => (
            <MenuItem
              key={d.id}
              name={d.name}
              note={d.description}
              active={a.id === atlasId && year === d.year}
              onChoose={() => {
                setYear(d.year as number)
                done()
              }}
            />
          )),
        ])}
      </div>
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
  past,
}: {
  region: RegionPreset
  active: boolean
  activeChildren: number
  isActive: (id: RegionId) => boolean
  toggle: (id: RegionId) => void
  /** A past year's map, whose countries today's subregions are not made of: no subregions. */
  past: boolean
}) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLDivElement>(null)
  const setRegions = useMapStore((s) => s.setRegions)
  const regionIds = useMapStore((s) => s.doc.scope.regionIds)
  const atlasId = useMapStore((s) => s.doc.scope.atlasId)
  // With nothing left on, the map is its own whole region again: the World, Europe, the United States.
  const deselect = (ids: RegionId[]) => {
    const next = regionIds.filter((id) => !ids.includes(id))
    setRegions(next.length > 0 ? next : getAtlas(atlasId).defaultRegionIds)
  }
  const children = past ? [] : barChildren(atlasId, region.id)
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
  const past = useMapStore((s) => yearOfDataset(s.doc.scope.datasetId) !== MODERN_YEAR)
  const regions = regionsForAtlas(atlasId)
  /* The map's own whole region — the World, Europe, the United States — is on alone or not at all. */
  const home = getAtlas(atlasId).defaultRegionIds
  const isHome = regionIds.every((id) => home.includes(id))
  const isActive = (id: RegionId) => (home.includes(id) ? isHome : !isHome && regionIds.includes(id))
  if (regions.length <= 1 && regions.every((r) => barChildren(atlasId, r.id).length === 0)) return null

  return (
    <div className="top-regions" role="group" aria-label="Regions">
      {regions.map((region) => (
        <RegionChip
          key={region.id}
          region={region}
          active={isActive(region.id)}
          activeChildren={barChildren(atlasId, region.id).filter((c) => isActive(c.id)).length}
          isActive={isActive}
          toggle={toggleRegion}
          past={past}
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

/**
 * One row of the File menu: a name, optionally its current value, and either more rows (it
 * cascades again) or what it opens. `render` is given `done`, which closes the whole menu — a
 * list of choices calls it once one is picked; a panel of switches does not, so several can be
 * changed in one visit.
 */
interface FileNode {
  id: string
  name: string
  value?: string
  children?: FileNode[]
  render?: (done: () => void) => ReactNode
  /** A row that does something rather than open a menu: run, then the File menu closes. */
  action?: () => void
}

/** The map's look: the same three panels the rail's Display section held. */
const DISPLAY: FileNode[] = [
  {
    id: 'appearance',
    name: 'Appearance',
    render: () => (
      <div className="stack top-flyout__body">
        <div className="sidebar__group">
          <span className="sidebar__group-label">Map colours</span>
          <MapColorSwatches />
        </div>
        <div className="sidebar__group">
          <span className="sidebar__group-label">Selection highlight</span>
          {/* The two line widths in the Selection box's row, three boxes a row like the colours. */}
          <SelectionHighlight besides={<LineWidthSwatches />} />
        </div>
      </div>
    ),
  },
  {
    id: 'features',
    name: 'Geographic Features',
    render: () => (
      <div className="top-flyout__body">
        <GeographicFeatureToggles />
      </div>
    ),
  },
  {
    id: 'labels',
    name: 'Labels & Helpers',
    render: () => (
      <div className="top-flyout__body">
        <LabelsAndHelpers />
      </div>
    ),
  },
]

/** The editor's own preferences — nothing here is about the map being made. */
const SETTINGS: FileNode[] = [
  {
    id: 'theme',
    name: 'Theme',
    render: () => (
      <div className="stack top-flyout__body">
        <span className="sidebar__group-label">Theme</span>
        <ThemePicker />
        <TransparencySwitch />
      </div>
    ),
  },
  {
    id: 'sources',
    name: 'Data Sources',
    render: () => (
      <div className="top-flyout__body">
        <DataSources />
      </div>
    ),
  },
]

/** The rows under `path`, or what the last node in it opens. */
function nodeAt(root: FileNode[], path: string[]): FileNode | null {
  let rows = root
  let node: FileNode | null = null
  for (const id of path) {
    node = rows.find((n) => n.id === id) ?? null
    if (!node) return null
    rows = node.children ?? []
  }
  return node
}

/** A list of rows in the File menu, at `depth` in the cascade. */
function FileRows({
  rows,
  depth,
  path,
  show,
  hide,
  close,
}: {
  rows: FileNode[]
  depth: number
  path: string[]
  show: (depth: number, id: string, element: HTMLElement) => void
  hide: (depth: number) => void
  close: () => void
}) {
  return (
    <div className="top-file" role="menu">
      {rows.map((r) =>
        r.action ? (
          <button
            key={r.id}
            type="button"
            role="menuitem"
            className="top-menu__item top-file__row top-file__row--action"
            onClick={() => {
              r.action!()
              close()
            }}
          >
            <span className="top-file__name">{r.name}</span>
            {r.value && <span className="top-file__value">{r.value}</span>}
          </button>
        ) : (
        <button
          key={r.id}
          type="button"
          role="menuitem"
          aria-haspopup="true"
          aria-expanded={path[depth] === r.id}
          className={`top-menu__item top-file__row${path[depth] === r.id ? ' top-file__row--open' : ''}`}
          // Opened by a click, never by hovering: hovering only highlights. A second click closes it.
          onClick={(event) => (path[depth] === r.id ? hide(depth) : show(depth, r.id, event.currentTarget))}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight') show(depth, r.id, event.currentTarget)
          }}
        >
          <span className="top-file__name">{r.name}</span>
          {r.value && <span className="top-file__value">{r.value}</span>}
          <ChevronRight />
        </button>
        ),
      )}
    </div>
  )
}

function FileMenu() {
  const [open, setOpen] = useState(false)
  /** The open rows, one per level of the cascade. */
  const [path, setPath] = useState<string[]>([])
  const [anchors, setAnchors] = useState<HTMLElement[]>([])
  const anchor = useRef<HTMLButtonElement>(null)
  const narrow = useNarrow()
  const scope = useMapStore((s) => s.doc.scope)
  const outside = useMapStore((s) => s.doc.style.outsideScope)
  const atlas = getAtlas(scope.atlasId)
  const datasets = datasetsForAtlas(scope.atlasId)
  const dataset = datasets.find((d) => d.id === scope.datasetId)

  const close = () => {
    setOpen(false)
    setPath([])
  }
  const show = (depth: number, id: string, element: HTMLElement) => {
    setPath((current) => [...current.slice(0, depth), id])
    setAnchors((current) => [...current.slice(0, depth), element])
  }
  const back = () => setPath((current) => current.slice(0, -1))
  /** Closes the row open at `depth`, and everything it opened. */
  const hide = (depth: number) => setPath((current) => current.slice(0, depth))

  /*
   * While File is open, the open tool card — and its attached box — steps out of the way, and
   * comes back as it was when File closes: the two would overlap at the top-left. See the
   * `file-menu-open` rule in the stylesheet.
   */
  useEffect(() => {
    document.documentElement.classList.toggle('file-menu-open', open)
    return () => document.documentElement.classList.remove('file-menu-open')
  }, [open])

  const newMap = useMapStore((s) => s.newMap)
  const root: FileNode[] = [
    // First: start again. The map is kept as it is edited, so a refresh no longer does this.
    { id: 'new', name: 'New map', value: 'Undo brings it back', action: newMap },
    // Then a template, which sets up the map below it — the region, the projection, the colours.
    {
      id: 'templates',
      name: 'Templates',
      render: (done) => (
        <div className="top-flyout__body">
          <TemplatePicker onApplied={done} />
        </div>
      ),
    },
    {
      id: 'map',
      name: 'Maps',
      // A past year is named as the Maps list names it: "World 1945".
      value: getDataset(scope.datasetId).era === 'historical' ? getDataset(scope.datasetId).name : (atlas.menuName ?? atlas.name),
      render: (done) => <MapChoices done={done} />,
    },
    // A past year is one map, at one detail.
    ...(datasets.length > 1 && dataset
      ? [{ id: 'resolution', name: 'Resolution', value: dataset ? shortDataset(dataset) : '—', render: (done: () => void) => <ResolutionChoices done={done} /> }]
      : []),
    { id: 'projection', name: 'Projection', value: projectionName(scope.projectionId), render: (done) => <ProjectionChoices done={done} /> },
    {
      id: 'outside',
      name: 'Outside region',
      value: OUTSIDE.find((o) => o.id === outside)?.name ?? outside,
      render: (done) => <OutsideChoices done={done} />,
    },
    { id: 'display', name: 'Display', children: DISPLAY },
    { id: 'settings', name: 'Settings', children: SETTINGS },
  ]

  /** What each open row opens: rows to cascade into, or its content. */
  const levels = path.map((_, depth) => nodeAt(root, path.slice(0, depth + 1)))
  const deepest = levels[levels.length - 1] ?? null
  const parentName = path.length > 1 ? (levels[levels.length - 2]?.name ?? 'File') : 'File'

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
        {narrow && deepest ? (
          // A phone: no room at the side, so the open row's contents replace the rows.
          <div className="top-file">
            <button type="button" className="top-menu__item top-file__back" onClick={back}>
              <span className="top-file__back-arrow" aria-hidden="true">‹</span>
              <span className="top-menu__name">{parentName}</span>
            </button>
            {deepest.children ? (
              <FileRows rows={deepest.children} depth={path.length} path={path} show={show} hide={hide} close={close} />
            ) : (
              deepest.render?.(close)
            )}
          </div>
        ) : (
          <>
            <FileRows rows={root} depth={0} path={path} show={show} hide={hide} close={close} />
            {!narrow &&
              levels.map((node, depth) =>
                node && anchors[depth] ? (
                  <Flyout key={`${depth}:${node.id}`} row={anchors[depth]}>
                    {node.children ? (
                      <FileRows rows={node.children} depth={depth + 1} path={path} show={show} hide={hide} close={close} />
                    ) : (
                      node.render?.(close)
                    )}
                  </Flyout>
                ) : null,
              )}
          </>
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
