/**
 * Application store.
 *
 * Holds the map document (authored content), the loaded geographic dataset, and the
 * ephemeral view/selection state. Mutations to the document go exclusively through
 * `dispatch(ops)` so the UI and the future AI assistant share one code path.
 */
import { create } from 'zustand'
import { createMapDocument } from './defaults'
import { executeOperations } from './executor'
import {
  coalesceKey,
  UNDOABLE_OPERATIONS,
  type MapOperation,
  type OperationResult,
} from './operations'
import { loadGeoDataset, type GeoDataset, type LoadedDataset } from '../geo/datasets'
import { lakeLayerForDetail, loadLakes, type LoadedLakes } from '../geo/lakes'
import { riverLayerForDetail, loadRivers, type LoadedRivers } from '../geo/rivers'
import { loadMaritime, type LoadedMaritime } from '../geo/maritime'
import { countriesInRegions, resolveFraming } from '../geo/regions'
import { getAtlas } from '../maps/atlas'
import type { CountryId, MapDocument, RegionId } from '../types/map'

export type Transform = { k: number; x: number; y: number }

export const IDENTITY_TRANSFORM: Transform = { k: 1, x: 0, y: 0 }

/**
 * One step on the undo stack: the document and the selection as they stood before an edit.
 *
 * Snapshots rather than inverse operations. The executor already returns a new
 * document and never mutates the old one, so the previous state is simply the value
 * that was there a moment ago — and because every unchanged branch is shared by
 * reference, keeping it costs the few objects the edit actually replaced. Inverses
 * would mean writing and maintaining an undo for every operation in the vocabulary,
 * and getting one of them subtly wrong is how undo stacks start lying.
 */
interface HistoryEntry extends HistoryState {
  /**
   * Edits sharing a key and arriving close together extend this step. A key that belongs to
   * a pointer gesture (see {@link GESTURE_HISTORY_PREFIX}) extends it for the whole gesture.
   */
  key: string | null
  at: number
}

/**
 * The selection, and the merge groups it fills — the part of an undo step that is not the
 * document.
 *
 * Selecting is how most work on this editor starts, and on the administrative world a
 * selection built with the brush or the rectangle can be a hundred subdivisions: losing it
 * to a stray click, or wanting the last stroke back, is exactly what undo is for. So a
 * selection change is a step of its own, restored together with the document it was made
 * against. The Merge panel's groups are not in here: they are merges, in the document, and
 * which of them is being edited is which row is open, not something that was done.
 */
export interface SelectionState {
  selectedCountryIds: CountryId[]
}

/** One restorable moment: the document and the selection as they stood together. */
interface HistoryState {
  doc: MapDocument
  selection: SelectionState
}

/**
 * The Selection panel's tools, which every map offers.
 *
 * Session state, beside the selection it feeds: which tool is in hand is a fact about how the
 * author is working rather than about the map, so it is not undoable, not saved and not
 * exported. The rectangle starts on — it answers only to the middle button, which the map
 * otherwise has no use for — and the brush starts off, because while it is on a drag selects
 * instead of panning.
 */
export interface SelectionTools {
  rectangle: boolean
  brush: boolean
}

/**
 * One map's own state, set aside while another map is open.
 *
 * Switching atlases is not loading a different application and it is not starting over:
 * the world map's selections, values, groups, merges and flag assignments are still
 * that map's, and they are waiting where they were left. So the outgoing map's document
 * and its undo stack are parked here rather than discarded, and switching back restores
 * them exactly — including the ability to undo an edit made before the detour.
 *
 * Held in memory for the session. Persisting a whole workspace is a separate feature
 * with its own questions about storage and format; what this guarantees is the thing the
 * author actually notices, which is that a trip to another map does not cost them work.
 */
interface ParkedMap {
  doc: MapDocument
  past: HistoryEntry[]
  future: HistoryState[]
  selectedCountryIds: CountryId[]
}

/**
 * The parts of a document that belong to the *editor* rather than to the map.
 *
 * Theme colours, the display switches and the composition frame are preferences about
 * how the author likes to work, so carrying them across a map switch is what keeps the
 * editor feeling like one tool. Everything else in the document is about a specific
 * geography — which entities are selected, what they are worth, how they are grouped —
 * and belongs to the map that owns it.
 */
function carryOverGlobals(from: MapDocument, to: MapDocument): MapDocument {
  return { ...to, style: from.style, screen: from.screen }
}

/** How long a run of keystrokes stays one undo step. */
const COALESCE_MS = 700

/** Depth of the undo stack. Snapshots are cheap, but not free. */
const HISTORY_LIMIT = 100

/**
 * Marks a history key as one pointer gesture's: every change made under it is one undo step,
 * however long the gesture takes. A time window cannot say that — a slow brush stroke lasts
 * longer than any window, and two quick strokes would merge inside one.
 */
export const GESTURE_HISTORY_PREFIX = 'gesture:'

function selectionOf(state: SelectionState): SelectionState {
  return { selectedCountryIds: state.selectedCountryIds }
}

function sameSelection(a: SelectionState, b: SelectionState): boolean {
  const x = a.selectedCountryIds
  const y = b.selectedCountryIds
  return x === y || (x.length === y.length && x.every((id, i) => id === y[i]))
}

/**
 * Whether an edit changed anything. An operation can succeed and change nothing — a value
 * typed again, a toggle set to what it already was — and a step that restores the same
 * state is an undo press that visibly does nothing. Only the parts the edit replaced are
 * compared, and only by value when they differ by reference.
 */
function sameDocument(a: MapDocument, b: MapDocument): boolean {
  if (a === b) return true
  const keys = Object.keys(b) as (keyof MapDocument)[]
  if (keys.length !== Object.keys(a).length) return false
  return keys.every((key) => a[key] === b[key] || JSON.stringify(a[key]) === JSON.stringify(b[key]))
}

/**
 * The history after recording `before` as the state an edit started from. A run of edits
 * sharing a key extends the step already on top — its snapshot is still the state before the
 * first of them, which is what the author means by "undo that". Any fresh edit abandons the
 * branch redo would have replayed.
 */
function recorded(
  past: HistoryEntry[],
  before: HistoryState,
  key: string | null,
): { past: HistoryEntry[]; future: HistoryState[] } {
  const now = Date.now()
  const top = past[past.length - 1]
  const extend =
    key !== null &&
    top !== undefined &&
    top.key === key &&
    (key.startsWith(GESTURE_HISTORY_PREFIX) || now - top.at < COALESCE_MS)
  return {
    past: extend
      ? [...past.slice(0, -1), { ...top, at: now }]
      : [...past, { ...before, key, at: now }].slice(-HISTORY_LIMIT),
    future: [],
  }
}

/**
 * The step the most recent document edit made, while it is still the top of the stack —
 * what {@link MapStore.clearSelectionWithLastEdit} joins. Anything recorded after it replaces
 * the top, and the two stop being the same object.
 */
let lastEdit: HistoryEntry | null = null

/**
 * The document an undo or redo restores, with the parts that are never undone kept as they
 * are now: the scope — dataset, regions, projection — the style, and which layer is active.
 * Those change through operations that deliberately make no undo step (see
 * `UNDOABLE_OPERATIONS`), but a snapshot taken before them still carries their old values, so
 * restoring it whole quietly moved the camera, swapped the dataset or reverted a switch along
 * with the edit being undone.
 */
function withCurrentView(restored: MapDocument, current: MapDocument): MapDocument {
  const activeLayerId = restored.layers.some((layer) => layer.id === current.activeLayerId)
    ? current.activeLayerId
    : restored.activeLayerId
  if (
    restored.scope === current.scope &&
    restored.style === current.style &&
    restored.activeLayerId === activeLayerId
  ) {
    return restored
  }
  return { ...restored, scope: current.scope, style: current.style, activeLayerId }
}

/** The store fields a restored selection sets. */
function restoredSelection(selection: SelectionState): Pick<MapStore, 'selectedCountryIds'> {
  return { selectedCountryIds: selection.selectedCountryIds }
}

interface MapStore {
  doc: MapDocument
  /** The other maps' state, by atlas id. See {@link ParkedMap}. */
  parked: Record<string, ParkedMap>

  /* geography */
  geo: LoadedDataset | null
  geoStatus: 'idle' | 'loading' | 'ready' | 'error'
  geoError: string | null
  /** Inland water, loaded as its own layer once the countries are up. */
  lakes: LoadedLakes | null
  rivers: LoadedRivers | null
  /** Maritime territory, loaded the same way. Independent of the country dataset. */
  maritime: LoadedMaritime | null
  /**
   * Whether the layers that are off by default have ever been asked for.
   *
   * Rivers are 2.3MB and maritime territory 1.3MB, and the default document draws
   * neither — rivers are switched off, and island water is a flag-mode option that is
   * also off. Both were nonetheless fetched and JSON-parsed on every page load, which on
   * a phone is 3.6MB of download and parse spent before the map is usable, for geometry
   * nothing was going to draw.
   *
   * So they are fetched the first time something wants them, and the wanting is
   * remembered: switching atlas afterwards reloads them at the new dataset's resolution
   * exactly as before, because the layer that was on stays on.
   */
  riversWanted: boolean
  maritimeWanted: boolean

  /* view */
  transform: Transform
  /** Incremented whenever the framing changes, so the canvas knows to reset the camera. */
  framingEpoch: number

  /* interaction */
  hoveredCountryId: CountryId | null
  selectedCountryIds: CountryId[]
  /** See {@link SelectionTools}. */
  selectionTools: SelectionTools
  /**
   * Whether the magnifying glass is on: an enlarged copy of each selected speck of a
   * territory, drawn beside it so it can be seen at a zoom where it is a pixel wide.
   *
   * Off until the author turns it on, on every map and after every load. It used to have no
   * switch at all: selecting any small entity summoned a lens, so the feature was on for
   * whoever happened to click Monaco. Session state beside the selection tools, not
   * document content — it is an editor aid, never part of the map, never exported and
   * never undone — and one switch for every map, so it does not change under the author
   * when they open another.
   */
  magnifier: boolean

  /**
   * The group the Merge panel is editing — a merge in the document — or `null`.
   *
   * Which row is open, not something that was done: not undoable and not saved. Only an
   * explicit "New group" creates a group; choosing one, or clicking its body on the map
   * while the panel is open, makes it the one Add puts the selection into.
   */
  activeMergeId: string | null
  /**
   * Whether the Merge panel is the one open.
   *
   * Set by the panel itself as it mounts and unmounts, because that is the only place
   * that knows. It keeps the selection card the Data section normally shows out of the
   * way — in Merge the group *is* the read-out — and lets a click on a merged body choose
   * that group for editing.
   */
  mergeMode: boolean

  /* operation log — the audit trail the AI assistant will write into */
  log: OperationResult[]

  /* edit history — see {@link HistoryEntry} */
  past: HistoryEntry[]
  /** What redo re-applies, most recent undo first. */
  future: HistoryState[]

  loadDataset: (datasetId: string) => Promise<void>
  /** Opens another atlas, parking the current map's state and restoring the target's. */
  setAtlas: (atlasId: string) => void
  dispatch: (ops: MapOperation | MapOperation[]) => OperationResult[]

  undo: () => void
  redo: () => void

  setRegions: (regionIds: RegionId[]) => void
  toggleRegion: (regionId: RegionId) => void

  /** Creates an empty group — a merge with no members yet — chooses it, and returns its id. */
  createMergeGroup: () => string
  setMergeMode: (on: boolean) => void
  /** Chooses the group Add puts the selection into, selected as one entity; `null` for none. */
  setActiveMerge: (id: string | null) => void
  /** Adds the selected entities to the chosen group: what it added, and what another group holds. */
  addSelectionToMerge: () => { added: CountryId[]; elsewhere: CountryId[] }
  removeFromMerge: (mergeId: string, memberId: CountryId) => void
  deleteMerge: (mergeId: string) => void

  /**
   * Asks for a deferred layer, and remembers that it was asked for.
   *
   * Idempotent and safe to call on every render: the underlying loaders are cached per
   * layer, and the flag is only written when it changes.
   */
  ensureRivers: () => void
  ensureMaritime: () => void

  setHovered: (id: CountryId | null) => void
  selectCountry: (id: CountryId | null, additive?: boolean) => void
  clearSelection: () => void
  /**
   * Clears the selection as part of the document edit just made, so the two are one undo
   * step — the Palette letting go of a selection once its value has landed, Compare once
   * the selection has joined a group. With no such edit just made it is an ordinary clear.
   */
  clearSelectionWithLastEdit: () => void
  /**
   * Adds entities to the selection and takes none out — what a rectangle or a brush stroke
   * does. Anything already selected stays selected, and passing over it again changes
   * nothing.
   *
   * Calls sharing a `historyKey` that starts with {@link GESTURE_HISTORY_PREFIX} are one
   * undo step however long the gesture takes, so a brush stroke that adds to the selection
   * on every frame is still one thing to undo.
   */
  addToSelection: (ids: CountryId[], historyKey?: string | null) => void
  setSelectionTool: (tool: keyof SelectionTools, on: boolean) => void
  setMagnifier: (on: boolean) => void

  setTransform: (t: Transform) => void
  resetTransform: () => void
}

type SetState = (partial: Partial<MapStore>) => void
type GetState = () => MapStore

/** Fetches the river layer matching a dataset's resolution, if it is not already the one held. */
function loadRiversFor(
  dataset: GeoDataset,
  datasetId: string,
  set: SetState,
  get: GetState,
) {
  // A dataset with water of its own (the official USA map's USGS rivers) draws that.
  const layer = dataset.water?.rivers ?? riverLayerForDetail(dataset.detail)
  if (get().rivers?.layer.id === layer.id) return
  void loadRivers(layer)
    .then((rivers) => {
      if (get().doc.scope.datasetId === datasetId) set({ rivers })
    })
    .catch((error) => console.warn('[geo] rivers unavailable', error))
}

/** Fetches maritime territory once per session; it does not vary with the dataset. */
function loadMaritimeOnce(set: SetState, get: GetState) {
  if (get().maritime) return
  void loadMaritime()
    .then((maritime) => set({ maritime }))
    .catch((error) => console.warn('[geo] maritime territory unavailable', error))
}

export const useMapStore = create<MapStore>((set, get) => {
  /**
   * Applies a change to the selection or the merge groups as one undo step — or as part of
   * the step `historyKey` is extending. A change that leaves both as they were records
   * nothing, so a click that selects nothing new, or a stroke over subdivisions already
   * taken, costs no undo press.
   */
  const commitSelection = (patch: Partial<MapStore>, historyKey: string | null) => {
    const state = get()
    const before: HistoryState = { doc: state.doc, selection: selectionOf(state) }
    const after = selectionOf({ ...state, ...patch })
    if (sameSelection(before.selection, after)) return
    set({ ...patch, ...recorded(state.past, before, historyKey) })
  }

  /**
   * Applies a selection change as part of the document edit just made, when there was one:
   * the top step already holds the state from before that edit, so leaving it where it is
   * makes the edit and this change a single undo. Otherwise it is a step of its own.
   */
  const withLastEdit = (patch: Partial<MapStore>) => {
    const { past } = get()
    if (lastEdit !== null && past[past.length - 1] === lastEdit) set(patch)
    else commitSelection(patch, null)
  }

  return {
  doc: createMapDocument(),
  parked: {},

  geo: null,
  geoStatus: 'idle',
  geoError: null,
  lakes: null,
  rivers: null,
  maritime: null,
  riversWanted: false,
  maritimeWanted: false,

  transform: IDENTITY_TRANSFORM,
  framingEpoch: 0,

  hoveredCountryId: null,
  selectedCountryIds: [],
  selectionTools: { rectangle: true, brush: false },
  magnifier: false,

  activeMergeId: null,
  mergeMode: false,

  log: [],

  past: [],
  future: [],

  async loadDataset(datasetId) {
    set({ geoStatus: 'loading', geoError: null })
    try {
      const geo = await loadGeoDataset(datasetId)
      // Ignore a stale response if the scope moved on while we were loading — which
      // now includes the author switching to another map mid-load.
      if (get().doc.scope.datasetId !== datasetId) return
      /*
       * A selection names entities, and another level of the same map may not have them:
       * Upper Bavaria is not a unit on a map of Kreise. Those drop out of the selection so
       * the count and the inspector describe what is on screen. Their values stay in the
       * document and come back with the level that draws them.
       */
      const state = get()
      const present = (id: string) => geo.byId.has(id) || state.doc.merges.some((m) => m.id === id)
      const selected = state.selectedCountryIds.filter(present)
      set({
        geo,
        geoStatus: 'ready',
        ...(selected.length !== state.selectedCountryIds.length ? { selectedCountryIds: selected } : {}),
        ...(state.hoveredCountryId && !present(state.hoveredCountryId) ? { hoveredCountryId: null } : {}),
      })

      // Lakes follow, unawaited: the map paints as soon as the countries are ready
      // and the water arrives a moment later rather than delaying first paint.
      const layer = geo.dataset.water?.lakes ?? lakeLayerForDetail(geo.dataset.detail)
      if (get().lakes?.layer.id !== layer.id) {
        void loadLakes(layer)
          .then((lakes) => {
            if (get().doc.scope.datasetId === datasetId) set({ lakes })
          })
          .catch((error) => console.warn('[geo] lakes unavailable', error))
      }

      /*
       * Rivers alongside the lakes, on the same terms and for the same reason — but only
       * for a map that is showing them. The layer is off in the default document, so on
       * a first load there is nothing here to fetch; `ensureRivers` starts it the moment
       * the switch is turned on, and from then on this keeps it in step with the
       * dataset's resolution exactly as it always did.
       */
      if (get().riversWanted) loadRiversFor(geo.dataset, datasetId, set, get)

      // Maritime territory the same way, and only once: it is a single global file
      // that does not vary with the country dataset's resolution.
      if (get().maritimeWanted) loadMaritimeOnce(set, get)
    } catch (error) {
      set({
        geoStatus: 'error',
        geoError: error instanceof Error ? error.message : String(error),
      })
    }
  },

  setAtlas(atlasId) {
    const state = get()
    const current = state.doc.scope.atlasId
    if (current === atlasId) return

    const atlas = getAtlas(atlasId)
    const parked: Record<string, ParkedMap> = {
      ...state.parked,
      [current]: {
        doc: state.doc,
        past: state.past,
        future: state.future,
        selectedCountryIds: state.selectedCountryIds,
      },
    }

    const restored = parked[atlas.id]
    const next = restored
      ? { ...restored, doc: carryOverGlobals(state.doc, restored.doc) }
      : {
          doc: carryOverGlobals(state.doc, createMapDocument({}, atlas.id)),
          past: [] as HistoryEntry[],
          future: [] as HistoryState[],
          selectedCountryIds: [] as CountryId[],
        }

    set({
      doc: next.doc,
      past: next.past,
      future: next.future,
      selectedCountryIds: next.selectedCountryIds,
      activeMergeId: null,
      parked,
      /*
       * The other map's geometry is not this map's. Clearing it rather than leaving the
       * previous atlas's features on screen is what stops a frame of Europe appearing
       * over a map of Nevada while the states load.
       */
      geo: null,
      geoStatus: 'loading',
      geoError: null,
      hoveredCountryId: null,
      transform: IDENTITY_TRANSFORM,
      framingEpoch: state.framingEpoch + 1,
    })

    void get().loadDataset(next.doc.scope.datasetId)
  },

  dispatch(input) {
    const ops = Array.isArray(input) ? input : [input]
    const { doc, geo, log, past } = get()
    /*
     * The entities an operation may name: the dataset's countries, plus the document's
     * merged entities.
     *
     * A merge is a map entity with an id, and the existence check exists to catch a
     * *stale* id — one from an undone creation or a dataset that no longer has it — not
     * to insist an entity be in Natural Earth. Leaving merges out of this set is what
     * made them unable to hold a value: `set_country_value` was refused as an unknown
     * country, so a merged body could never be coloured by the data system it was
     * otherwise fully wired into.
     */
    const outcome = executeOperations(doc, ops, {
      knownCountryIds: geo
        ? new Set([...geo.byId.keys(), ...doc.merges.map((m) => m.id)])
        : undefined,
    })

    const framingChanged =
      outcome.doc.scope.regionIds !== doc.scope.regionIds ||
      outcome.doc.scope.projectionId !== doc.scope.projectionId

    /*
     * History records the document as it was *before* an edit, and only for edits
     * that actually landed — a rejected operation changes nothing and must not cost
     * an undo press. A run of keystrokes with the same coalesce key extends the step
     * already on the stack: the snapshot there is still the state before the first
     * keystroke, which is what the user means by "undo that".
     */
    const undoable =
      outcome.results.some((r) => r.ok && UNDOABLE_OPERATIONS.has(r.op.op as never)) &&
      !sameDocument(doc, outcome.doc)
    let nextPast = past
    let nextFuture = get().future
    if (undoable) {
      const history = recorded(past, { doc, selection: selectionOf(get()) }, coalesceKey(ops))
      nextPast = history.past
      nextFuture = history.future
      lastEdit = nextPast[nextPast.length - 1]
    }

    set({
      doc: outcome.doc,
      log: [...log, ...outcome.results].slice(-200),
      past: nextPast,
      future: nextFuture,
      ...(framingChanged
        ? { transform: IDENTITY_TRANSFORM, framingEpoch: get().framingEpoch + 1 }
        : {}),
    })

    if (outcome.doc.scope.datasetId !== doc.scope.datasetId) {
      void get().loadDataset(outcome.doc.scope.datasetId)
    }

    for (const result of outcome.results) {
      if (!result.ok) console.warn('[map] rejected operation:', result.op, '-', result.error)
    }

    return outcome.results
  },

  /**
   * Steps back one edit: the document and the selection, as they stood before it.
   *
   * The two are restored together because they were recorded together, so a value comes
   * back on the subdivisions it was given to and a stroke's subdivisions leave the selection
   * as one. Everything about the view is left alone — the scope, the style, the camera — see
   * `withCurrentView`: undo is about the map, and moving the camera as a side effect of it
   * would be a surprise.
   */
  undo() {
    const state = get()
    const previous = state.past[state.past.length - 1]
    if (!previous) return
    const current: HistoryState = { doc: state.doc, selection: selectionOf(state) }
    set({
      doc: withCurrentView(previous.doc, state.doc),
      ...restoredSelection(previous.selection),
      past: state.past.slice(0, -1),
      future: [current, ...state.future].slice(0, HISTORY_LIMIT),
    })
  },

  /** Re-applies the step the last undo took back — exactly the state it left. */
  redo() {
    const state = get()
    const next = state.future[0]
    if (!next) return
    const current: HistoryState = { doc: state.doc, selection: selectionOf(state) }
    set({
      doc: withCurrentView(next.doc, state.doc),
      ...restoredSelection(next.selection),
      past: [...state.past, { ...current, key: null, at: Date.now() }].slice(-HISTORY_LIMIT),
      future: state.future.slice(1),
    })
  },

  setRegions(regionIds) {
    get().dispatch({ op: 'set_scope_regions', regionIds: regionIds.length ? regionIds : ['world'] })
  },

  toggleRegion(regionId) {
    const current = get().doc.scope.regionIds

    if (regionId === 'world') {
      get().setRegions(['world'])
      return
    }

    const withoutWorld = current.filter((id) => id !== 'world')
    const next = withoutWorld.includes(regionId)
      ? withoutWorld.filter((id) => id !== regionId)
      : [...withoutWorld, regionId]

    get().setRegions(next.length ? next : ['world'])
  },

  /* ------------------------------------------------------------ merge groups */

  /**
   * A new, empty group, named for its place in the list and chosen for editing.
   *
   * The only way a group comes to exist: nothing else — a click on the map, a click on a
   * row, an Add — creates one. It is a merge from the start, through the ordinary operation,
   * so it is undoable, saved and exported like every merge, and editing it later edits it in
   * place instead of recreating it. Appended, so the first group made stays at the top.
   */
  createMergeGroup(): string {
    const { doc } = get()
    const names = new Set(doc.merges.map((m) => m.name))
    let n = doc.merges.length + 1
    while (names.has(`Group ${n}`)) n++
    const id = `merge-${Date.now().toString(36)}`
    get().dispatch({ op: 'create_merge', id, name: `Group ${n}`, members: [] })
    set({ activeMergeId: id })
    return id
  },

  /**
   * Chooses the group Add puts the selection into — or `null` for none.
   *
   * The group is selected with it, as one entity: its body is highlighted on the map, and
   * the entities already picked and waiting to go in stay picked. An empty group has no
   * body, so there is nothing of it to select.
   */
  setActiveMerge(id) {
    if (id === null) {
      set({ activeMergeId: null })
      return
    }
    const state = get()
    const merge = state.doc.merges.find((m) => m.id === id)
    if (!merge) return
    const mergeIds = new Set(state.doc.merges.map((m) => m.id))
    const waiting = state.selectedCountryIds.filter((c) => !mergeIds.has(c) && !merge.members.includes(c))
    set({ activeMergeId: id })
    commitSelection({ selectedCountryIds: merge.members.length > 0 ? [id, ...waiting] : waiting }, null)
  },

  /** Leaving the panel stops editing a group. The groups themselves are merges, and stay. */
  setMergeMode(on) {
    set(on ? { mergeMode: true } : { mergeMode: false, activeMergeId: null })
  },

  /**
   * Puts the selected entities into the group being edited, each once.
   *
   * Only entities of this map in no group: another merge is never a member, and an entity
   * another group holds is left where it is and reported, rather than moved out from under
   * it. The added entities then answer as the group — it stays selected and they leave the
   * selection, because they are inside it now. One undo step.
   */
  addSelectionToMerge() {
    const state = get()
    const merge = state.doc.merges.find((m) => m.id === state.activeMergeId)
    if (!merge) return { added: [], elsewhere: [] }
    const mergeIds = new Set(state.doc.merges.map((m) => m.id))
    const owner = new Map<CountryId, string>()
    for (const m of state.doc.merges) for (const member of m.members) owner.set(member, m.id)
    const added: CountryId[] = []
    const elsewhere: CountryId[] = []
    for (const id of state.selectedCountryIds) {
      if (mergeIds.has(id) || added.includes(id) || !state.geo?.byId.has(id)) continue
      const holder = owner.get(id)
      if (holder === merge.id) continue
      if (holder) elsewhere.push(id)
      else added.push(id)
    }
    if (added.length === 0) return { added, elsewhere }
    get().dispatch({ op: 'update_merge', id: merge.id, patch: { members: [...merge.members, ...added] } })
    withLastEdit({
      selectedCountryIds: [merge.id, ...state.selectedCountryIds.filter((c) => c !== merge.id && !added.includes(c))],
    })
    return { added, elsewhere }
  },

  /** Takes one entity out of a group; the merged body is redrawn without it at once. */
  removeFromMerge(mergeId, memberId) {
    const merge = get().doc.merges.find((m) => m.id === mergeId)
    if (!merge || !merge.members.includes(memberId)) return
    const members = merge.members.filter((m) => m !== memberId)
    get().dispatch({ op: 'update_merge', id: mergeId, patch: { members } })
    // A group left empty has no body left to be selected.
    if (members.length === 0) {
      withLastEdit({ selectedCountryIds: get().selectedCountryIds.filter((c) => c !== mergeId) })
    }
  },

  /** Deletes a group: its members are drawn as themselves again. */
  deleteMerge(mergeId) {
    get().dispatch({ op: 'delete_merge', id: mergeId })
    withLastEdit({ selectedCountryIds: get().selectedCountryIds.filter((c) => c !== mergeId) })
    if (get().activeMergeId === mergeId) set({ activeMergeId: null })
  },

  ensureRivers() {
    if (get().riversWanted) return
    set({ riversWanted: true })
    const geo = get().geo
    if (geo) loadRiversFor(geo.dataset, get().doc.scope.datasetId, set, get)
  },

  ensureMaritime() {
    if (get().maritimeWanted) return
    set({ maritimeWanted: true })
    loadMaritimeOnce(set, get)
  },

  setHovered(id) {
    if (get().hoveredCountryId !== id) set({ hoveredCountryId: id })
  },

  /**
   * Adds an entity to the selection, or takes it back out.
   *
   * **Toggling is the primary behaviour, on every device.** Tapping entities one after
   * another builds a selection; tapping one already in it removes that one. Nothing has
   * to be held down.
   *
   * That used to require Shift, and Shift is not a thing a phone has. The alternative —
   * a modifier on desktop and a different rule on touch — would have meant two selection
   * models to keep in step, and an editor that behaves differently depending on what you
   * happen to be holding. One rule is simpler to explain and simpler to keep correct.
   *
   * `additive: false` still replaces the selection outright. Nothing in the UI passes it
   * today; it stays because "select exactly this" is a meaningful thing to ask for
   * programmatically, and removing it would only mean re-inventing it later.
   */
  selectCountry(id, additive = true) {
    if (id === null) {
      commitSelection({ selectedCountryIds: [] }, null)
      return
    }
    const state = get()
    const current = state.selectedCountryIds
    const selectedCountryIds = additive
      ? current.includes(id)
        ? current.filter((c) => c !== id)
        : [...current, id]
      : current.length === 1 && current[0] === id
        ? []
        : [id]

    /*
     * In Merge, clicking a merged body chooses that group for editing, as clicking its row
     * does: the body is the group, selected as one entity. A click never creates a group.
     */
    if (state.mergeMode && !current.includes(id) && state.doc.merges.some((m) => m.id === id)) {
      set({ activeMergeId: id })
    }
    commitSelection({ selectedCountryIds }, null)
  },

  clearSelection() {
    commitSelection({ selectedCountryIds: [] }, null)
  },

  clearSelectionWithLastEdit() {
    withLastEdit({ selectedCountryIds: [] })
  },

  addToSelection(ids, historyKey = null) {
    const state = get()
    const current = state.selectedCountryIds
    const have = new Set(current)
    const fresh: CountryId[] = []
    for (const id of ids) {
      if (have.has(id)) continue
      have.add(id)
      fresh.push(id)
    }
    if (fresh.length === 0) return

    commitSelection({ selectedCountryIds: [...current, ...fresh] }, historyKey)
  },

  setSelectionTool(tool, on) {
    const current = get().selectionTools
    if (current[tool] === on) return
    set({ selectionTools: { ...current, [tool]: on } })
  },

  setMagnifier(on) {
    if (get().magnifier !== on) set({ magnifier: on })
  },

  setTransform(transform) {
    set({ transform })
  },

  resetTransform() {
    set({ transform: IDENTITY_TRANSFORM, framingEpoch: get().framingEpoch + 1 })
  },
  }
})

/* ------------------------------------------------------------------ selectors */

/**
 * Derived values that allocate a new object per call, so components memoise them
 * from primitive inputs rather than subscribing to them directly.
 */
export { resolveFraming, countriesInRegions }

export function selectActiveLayer(s: MapStore) {
  return s.doc.layers.find((l) => l.id === s.doc.activeLayerId) ?? s.doc.layers[0]
}
