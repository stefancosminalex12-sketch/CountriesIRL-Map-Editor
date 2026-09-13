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
import { defaultMergeName } from '../geo/merge'
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
 * against. The merge groups ride with it because while one is collecting, the group and the
 * selection are the same fact seen twice — undoing one without the other would leave a
 * subdivision highlighted but not in the group, or in the group but not highlighted.
 *
 * Which group is collecting is not in here: that is which panel is open, not what was done.
 */
export interface SelectionState {
  selectedCountryIds: CountryId[]
  mergeDrafts: MergeDraft[]
}

/** One restorable moment: the document and the selection as they stood together. */
interface HistoryState {
  doc: MapDocument
  selection: SelectionState
}

/**
 * A merge being assembled, before it becomes one.
 *
 * Merging is a two-part act — decide which entities, then decide what the result is
 * called and what it flies — and the old panel collapsed both into a single button that
 * consumed whatever happened to be selected. That made a merge something you committed
 * to before you could see it, and made building a second one while checking the first
 * impossible. A draft is that first part held still: a named, numbered basket the author
 * adds to, reviews, and merges when it is right.
 *
 * Deliberately *not* in the document. A draft is not map content — nothing on the map is
 * different because one exists — so it stays out of exports and out of anything a saved
 * map would carry. It lives beside the selection, which is the other piece of state of
 * exactly this kind: undo restores the two together (see {@link SelectionState}), and both
 * are parked with the map when the author switches atlases so a half-built merge survives
 * the trip.
 */
export interface MergeDraft {
  id: string
  members: CountryId[]
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
  mergeDrafts: MergeDraft[]
  activeMergeDraftId: string | null
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
  return { selectedCountryIds: state.selectedCountryIds, mergeDrafts: state.mergeDrafts }
}

function sameSelection(a: SelectionState, b: SelectionState): boolean {
  if (a.mergeDrafts !== b.mergeDrafts) return false
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

/** The store fields a restored selection sets, keeping the collecting group if it still exists. */
function restoredSelection(
  selection: SelectionState,
  activeMergeDraftId: string | null,
): Pick<MapStore, 'selectedCountryIds' | 'mergeDrafts' | 'activeMergeDraftId'> {
  return {
    selectedCountryIds: selection.selectedCountryIds,
    mergeDrafts: selection.mergeDrafts,
    activeMergeDraftId: selection.mergeDrafts.some((draft) => draft.id === activeMergeDraftId)
      ? activeMergeDraftId
      : null,
  }
}

/**
 * Which group a selection change fills, if any: the one collecting, or — in Merge, with none
 * collecting — a new one, because there the first tap makes the group (see `selectCountry`).
 */
function collectingGroup(state: MapStore): { drafts: MergeDraft[]; activeId: string | null } {
  if (state.activeMergeDraftId || !state.mergeMode) {
    return { drafts: state.mergeDrafts, activeId: state.activeMergeDraftId }
  }
  const id = `draft-${Date.now().toString(36)}`
  return { drafts: [...state.mergeDrafts, { id, members: [] }], activeId: id }
}

/** A group's removal, and what it takes out of the selection with it. */
function withoutDraft(state: MapStore, id: string): Partial<MapStore> {
  const gone = state.mergeDrafts.find((d) => d.id === id)
  const remaining = state.mergeDrafts.filter((d) => d.id !== id)
  // What a discarded group was holding stops being highlighted, because there is no longer
  // anything it is highlighted for — but only while it was the one collecting.
  const collecting = state.mergeMode && state.activeMergeDraftId === id
  return {
    mergeDrafts: remaining,
    ...(collecting && gone
      ? { selectedCountryIds: state.selectedCountryIds.filter((c) => !gone.members.includes(c)) }
      : null),
    activeMergeDraftId:
      state.activeMergeDraftId === id
        ? (remaining[remaining.length - 1]?.id ?? null)
        : state.activeMergeDraftId,
  }
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

  /* merges being assembled. See {@link MergeDraft}. */
  mergeDrafts: MergeDraft[]
  activeMergeDraftId: string | null
  /**
   * Whether the Merge panel is the one open.
   *
   * Set by the panel itself as it mounts and unmounts, because that is the only place
   * that knows. It exists so two things elsewhere can be true: tapping an entity starts
   * a group without anyone pressing a button first, and the selection card the Data
   * section normally shows stays out of the way — in Merge the group *is* the read-out,
   * and a second list of the same entities above it is duplication that moves.
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

  /** Creates a group, makes it the collecting one, and returns its id. */
  addMergeDraft: () => string
  setMergeMode: (on: boolean) => void
  /** Makes a group the one that map clicks land in, or `null` to stop collecting. */
  setActiveMergeDraft: (id: string | null) => void
  removeFromMergeDraft: (id: string, memberId: CountryId) => void
  deleteMergeDraft: (id: string) => void
  /** Turns a draft into a real merged entity through the ordinary operation. */
  commitMergeDraft: (id: string) => void

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
    if (sameSelection(before.selection, after)) {
      if (patch.activeMergeDraftId !== undefined) set({ activeMergeDraftId: patch.activeMergeDraftId })
      return
    }
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

  mergeDrafts: [],
  activeMergeDraftId: null,
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
        mergeDrafts: state.mergeDrafts,
        activeMergeDraftId: state.activeMergeDraftId,
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
          mergeDrafts: [] as MergeDraft[],
          activeMergeDraftId: null as string | null,
        }

    set({
      doc: next.doc,
      past: next.past,
      future: next.future,
      selectedCountryIds: next.selectedCountryIds,
      mergeDrafts: next.mergeDrafts,
      activeMergeDraftId: next.activeMergeDraftId,
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
      ...restoredSelection(previous.selection, state.activeMergeDraftId),
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
      ...restoredSelection(next.selection, state.activeMergeDraftId),
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

  /* ------------------------------------------------------------ merge drafts */

  addMergeDraft(): string {
    const { mergeDrafts } = get()
    const id = `draft-${Date.now().toString(36)}`
    // Numbered by position rather than by a running counter, so deleting Group 2 of
    // three leaves Group 1 and Group 2 rather than Group 1 and Group 3.
    const draft: MergeDraft = { id, members: [] }
    commitSelection({ mergeDrafts: [...mergeDrafts, draft], activeMergeDraftId: id }, null)
    return id
  },

  setActiveMergeDraft(id) {
    set({ activeMergeDraftId: id })
  },

  /**
   * Leaving the panel stops collecting, but keeps the groups.
   *
   * Otherwise taps made elsewhere in the editor would keep dropping into a group nobody
   * can see. The groups themselves survive, so coming back finds the work where it was.
   */
  setMergeMode(on) {
    set(on ? { mergeMode: true } : { mergeMode: false, activeMergeDraftId: null })
  },

  /**
   * Takes an entity out of a group, and off the map with it.
   *
   * The highlight and the group are the same fact seen twice while a group is
   * collecting — a tap puts an entity in both — so a removal has to leave both. Left
   * highlighted, the entity would read as being in the group it had just been taken out
   * of, and the next tap on it would invert: unhighlighting it while putting it back in.
   */
  removeFromMergeDraft(id, memberId) {
    const collecting = get().mergeMode && get().activeMergeDraftId === id
    commitSelection(
      {
        mergeDrafts: get().mergeDrafts.map((draft) =>
          draft.id === id
            ? { ...draft, members: draft.members.filter((m) => m !== memberId) }
            : draft,
        ),
        ...(collecting
          ? { selectedCountryIds: get().selectedCountryIds.filter((c) => c !== memberId) }
          : null),
      },
      null,
    )
  },

  deleteMergeDraft(id) {
    commitSelection(withoutDraft(get(), id), null)
  },

  /**
   * Turns a draft into a merged entity.
   *
   * Through `create_merge` like every merge before it — the geometry, the dissolve, the
   * undo entry and everything downstream are untouched. All that changed is that the
   * members, the name and the flag were decided before the button rather than by
   * whatever happened to be selected at the moment it was pressed.
   */
  commitMergeDraft(id) {
    const draft = get().mergeDrafts.find((d) => d.id === id)
    if (!draft || draft.members.length < 2) return
    const mergeId = `merge-${Date.now().toString(36)}`
    get().dispatch({
      op: 'create_merge',
      id: mergeId,
      name: defaultMergeName(get().geo, draft.members),
      members: [...draft.members],
    })
    // The group becoming a merge is one act: undo brings back the group and its selection.
    withLastEdit({ ...withoutDraft(get(), id), selectedCountryIds: [], activeMergeDraftId: null })
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
     * A group that is collecting takes what is clicked, as it is clicked.
     *
     * This is what removes the staging step: there is no selection to gather and then
     * hand over, because the map *is* the input. Tapping an entity puts it in the group
     * and tapping it again takes it out, so the gesture that builds a group is the same
     * one that builds a selection, and the two never disagree about what is in it.
     *
     * Only ever true while a group is open for collecting; with none, this is the plain
     * selection it always was and no group exists to notice.
     */
    /*
     * In Merge, the first tap makes the group. There is nothing to press first: an
     * author who taps an entity has already said what they want, and asking them to
     * declare a container beforehand is a step that only exists for the machine.
     */
    const { drafts, activeId } = collectingGroup(state)
    // One click is one undo step, whatever it did to the selection and the group together.
    commitSelection(
      activeId
        ? {
            selectedCountryIds,
            activeMergeDraftId: activeId,
            mergeDrafts: drafts.map((draft) =>
              draft.id === activeId
                ? {
                    ...draft,
                    members: draft.members.includes(id)
                      ? draft.members.filter((m) => m !== id)
                      : [...draft.members, id],
                  }
                : draft,
            ),
          }
        : { selectedCountryIds },
      null,
    )
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

    /*
     * A group that is collecting takes them too, exactly as it takes a click — see
     * `selectCountry` — except that nothing is ever taken back out: a stroke that passes
     * over a member again leaves it where it is.
     */
    const { drafts, activeId } = collectingGroup(state)
    commitSelection(
      activeId
        ? {
            selectedCountryIds: [...current, ...fresh],
            activeMergeDraftId: activeId,
            mergeDrafts: drafts.map((draft) =>
              draft.id === activeId
                ? { ...draft, members: [...draft.members, ...fresh.filter((id) => !draft.members.includes(id))] }
                : draft,
            ),
          }
        : { selectedCountryIds: [...current, ...fresh] },
      historyKey,
    )
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
