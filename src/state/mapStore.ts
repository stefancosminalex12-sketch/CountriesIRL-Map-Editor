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
import { loadGeoDataset, type LoadedDataset } from '../geo/datasets'
import { lakeLayerForDetail, loadLakes, type LoadedLakes } from '../geo/lakes'
import { loadMaritime, type LoadedMaritime } from '../geo/maritime'
import { countriesInRegions, resolveFraming } from '../geo/regions'
import { getAtlas } from '../maps/atlas'
import { defaultMergeName } from '../geo/merge'
import type { CountryId, MapDocument, RegionId } from '../types/map'

export type Transform = { k: number; x: number; y: number }

export const IDENTITY_TRANSFORM: Transform = { k: 1, x: 0, y: 0 }

/**
 * One step on the undo stack: the document as it stood before an edit.
 *
 * Snapshots rather than inverse operations. The executor already returns a new
 * document and never mutates the old one, so the previous state is simply the value
 * that was there a moment ago — and because every unchanged branch is shared by
 * reference, keeping it costs the few objects the edit actually replaced. Inverses
 * would mean writing and maintaining an undo for every operation in the vocabulary,
 * and getting one of them subtly wrong is how undo stacks start lying.
 */
interface HistoryEntry {
  doc: MapDocument
  /** Edits sharing a key and arriving close together extend this step. */
  key: string | null
  at: number
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
 * different because one exists — so it stays out of the undo stack, out of exports and
 * out of anything a saved map would carry. It lives beside the selection, which is the
 * other piece of state of exactly this kind, and is parked with the map when the author
 * switches atlases so a half-built merge survives the trip.
 */
export interface MergeDraft {
  id: string
  name: string
  flag: string | null
  members: CountryId[]
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
  future: MapDocument[]
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
  /** Maritime territory, loaded the same way. Independent of the country dataset. */
  maritime: LoadedMaritime | null

  /* view */
  transform: Transform
  /** Incremented whenever the framing changes, so the canvas knows to reset the camera. */
  framingEpoch: number

  /* interaction */
  hoveredCountryId: CountryId | null
  selectedCountryIds: CountryId[]

  /* merges being assembled. See {@link MergeDraft}. */
  mergeDrafts: MergeDraft[]
  activeMergeDraftId: string | null

  /* operation log — the audit trail the AI assistant will write into */
  log: OperationResult[]

  /* edit history */
  past: HistoryEntry[]
  future: MapDocument[]

  loadDataset: (datasetId: string) => Promise<void>
  /** Opens another atlas, parking the current map's state and restoring the target's. */
  setAtlas: (atlasId: string) => void
  dispatch: (ops: MapOperation | MapOperation[]) => OperationResult[]

  undo: () => void
  redo: () => void

  setRegions: (regionIds: RegionId[]) => void
  toggleRegion: (regionId: RegionId) => void

  addMergeDraft: () => void
  setActiveMergeDraft: (id: string) => void
  updateMergeDraft: (id: string, patch: Partial<Omit<MergeDraft, 'id'>>) => void
  addSelectionToMergeDraft: (id: string) => void
  removeFromMergeDraft: (id: string, memberId: CountryId) => void
  deleteMergeDraft: (id: string) => void
  /** Turns a draft into a real merged entity through the ordinary operation. */
  commitMergeDraft: (id: string) => void

  setHovered: (id: CountryId | null) => void
  selectCountry: (id: CountryId | null, additive?: boolean) => void
  clearSelection: () => void

  setTransform: (t: Transform) => void
  resetTransform: () => void
}

export const useMapStore = create<MapStore>((set, get) => ({
  doc: createMapDocument(),
  parked: {},

  geo: null,
  geoStatus: 'idle',
  geoError: null,
  lakes: null,
  maritime: null,

  transform: IDENTITY_TRANSFORM,
  framingEpoch: 0,

  hoveredCountryId: null,
  selectedCountryIds: [],

  mergeDrafts: [],
  activeMergeDraftId: null,

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
      set({ geo, geoStatus: 'ready' })

      // Lakes follow, unawaited: the map paints as soon as the countries are ready
      // and the water arrives a moment later rather than delaying first paint.
      const layer = lakeLayerForDetail(geo.dataset.detail)
      if (get().lakes?.layer.id !== layer.id) {
        void loadLakes(layer)
          .then((lakes) => {
            if (get().doc.scope.datasetId === datasetId) set({ lakes })
          })
          .catch((error) => console.warn('[geo] lakes unavailable', error))
      }

      // Maritime territory the same way, and only once: it is a single global file
      // that does not vary with the country dataset's resolution.
      if (!get().maritime) {
        void loadMaritime()
          .then((maritime) => set({ maritime }))
          .catch((error) => console.warn('[geo] maritime territory unavailable', error))
      }
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
          future: [] as MapDocument[],
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
    const undoable = outcome.results.some((r) => r.ok && UNDOABLE_OPERATIONS.has(r.op.op as never))
    let nextPast = past
    let nextFuture = get().future
    if (undoable) {
      const now = Date.now()
      const key = coalesceKey(ops)
      const top = past[past.length - 1]
      const extend = key !== null && top && top.key === key && now - top.at < COALESCE_MS
      nextPast = extend
        ? [...past.slice(0, -1), { ...top, at: now }]
        : [...past, { doc, key, at: now }].slice(-HISTORY_LIMIT)
      // Any fresh edit abandons the branch that redo would have replayed.
      nextFuture = []
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
   * Steps the document back one edit.
   *
   * Selection is trimmed to what still exists, because undoing a country's data does
   * not remove the country but undoing a group can leave the panel pointing at one
   * that is gone. Everything else about the view is left alone: undo is about the
   * document, and moving the camera as a side effect of it would be a surprise.
   */
  undo() {
    const { past, future, doc } = get()
    const previous = past[past.length - 1]
    if (!previous) return
    set({ doc: previous.doc, past: past.slice(0, -1), future: [doc, ...future] })
  },

  redo() {
    const { past, future, doc } = get()
    const next = future[0]
    if (!next) return
    set({
      doc: next,
      past: [...past, { doc, key: null, at: Date.now() }].slice(-HISTORY_LIMIT),
      future: future.slice(1),
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

  addMergeDraft() {
    const { mergeDrafts } = get()
    const id = `draft-${Date.now().toString(36)}`
    // Numbered by position rather than by a running counter, so deleting Group 2 of
    // three leaves Group 1 and Group 2 rather than Group 1 and Group 3.
    const draft: MergeDraft = { id, name: '', flag: null, members: [] }
    set({ mergeDrafts: [...mergeDrafts, draft], activeMergeDraftId: id })
  },

  setActiveMergeDraft(id) {
    set({ activeMergeDraftId: id })
  },

  updateMergeDraft(id, patch) {
    set({
      mergeDrafts: get().mergeDrafts.map((d) => (d.id === id ? { ...d, ...patch } : d)),
    })
  },

  /**
   * Puts the current map selection into one draft.
   *
   * The selection is the *existing* selection — the same taps,
   * the same store — and this only copies it. Deliberately additive and duplicate-free,
   * so an author can select three countries, add them, select four more and add those
   * without the second gesture discarding the first.
   */
  addSelectionToMergeDraft(id) {
    const { mergeDrafts, selectedCountryIds } = get()
    if (selectedCountryIds.length === 0) return
    set({
      mergeDrafts: mergeDrafts.map((draft) =>
        draft.id === id
          ? {
              ...draft,
              members: [
                ...draft.members,
                ...selectedCountryIds.filter((c) => !draft.members.includes(c)),
              ],
            }
          : draft,
      ),
    })
  },

  removeFromMergeDraft(id, memberId) {
    set({
      mergeDrafts: get().mergeDrafts.map((draft) =>
        draft.id === id
          ? { ...draft, members: draft.members.filter((m) => m !== memberId) }
          : draft,
      ),
    })
  },

  deleteMergeDraft(id) {
    const remaining = get().mergeDrafts.filter((d) => d.id !== id)
    set({
      mergeDrafts: remaining,
      activeMergeDraftId:
        get().activeMergeDraftId === id ? (remaining[remaining.length - 1]?.id ?? null) : get().activeMergeDraftId,
    })
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
      name: draft.name.trim() || defaultMergeName(get().geo, draft.members),
      members: [...draft.members],
    })
    if (draft.flag) get().dispatch({ op: 'update_merge', id: mergeId, patch: { flag: draft.flag } })
    get().deleteMergeDraft(id)
    set({ selectedCountryIds: [] })
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
      set({ selectedCountryIds: [] })
      return
    }
    const current = get().selectedCountryIds
    if (additive) {
      set({
        selectedCountryIds: current.includes(id)
          ? current.filter((c) => c !== id)
          : [...current, id],
      })
    } else {
      set({ selectedCountryIds: current.length === 1 && current[0] === id ? [] : [id] })
    }
  },

  clearSelection() {
    set({ selectedCountryIds: [] })
  },

  setTransform(transform) {
    set({ transform })
  },

  resetTransform() {
    set({ transform: IDENTITY_TRANSFORM, framingEpoch: get().framingEpoch + 1 })
  },
}))

/* ------------------------------------------------------------------ selectors */

/**
 * Derived values that allocate a new object per call, so components memoise them
 * from primitive inputs rather than subscribing to them directly.
 */
export { resolveFraming, countriesInRegions }

export function selectActiveLayer(s: MapStore) {
  return s.doc.layers.find((l) => l.id === s.doc.activeLayerId) ?? s.doc.layers[0]
}
