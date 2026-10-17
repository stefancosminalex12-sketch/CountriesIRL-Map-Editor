/**
 * Autosave: the map is kept in this browser as it is edited, and comes back when the page does.
 *
 * Without it a refresh, a closed tab or a phone reloading the page in the background lost
 * everything made since it opened. Each map the author has open is saved — the one on screen
 * and the ones parked behind it on other maps (Europe, USA) — as plain documents: no history,
 * no selection, nothing about the visitor. They stay in this browser's localStorage and are
 * never sent anywhere, which is what the privacy notice says.
 *
 * Written a moment after each change (one write for a burst of edits), and at once when the
 * page is hidden or closed — the last chance a phone gives. If a write fails (storage full or
 * switched off), the page asks before it is left, since only then is something about to be lost.
 *
 * A saved map from another version of the document (`schemaVersion`) is not restored: the editor
 * opens fresh rather than on a map it may misread.
 */
import { create } from 'zustand'
import { fitBoxOf, useMapStore } from './mapStore'
import { createMapDocument } from './defaults'
import { ALL_DATASETS } from '../maps/atlas'
import type { MapDocument } from '../types/map'

const KEY = 'map-editor.document.v1'
const WRITE_DELAY_MS = 600

interface Saved {
  version: 1
  savedAt: string
  doc: MapDocument
  /** The maps parked behind it, by atlas id. */
  parked: Record<string, MapDocument>
}

/** Whether the last write failed — the one time leaving the page loses work. */
export const useAutosave = create<{ failed: boolean }>(() => ({ failed: false }))

const SCHEMA = createMapDocument().schemaVersion
const DATASETS = new Set(ALL_DATASETS.map((d) => d.id))

/** A saved document this editor can open as it is. */
function usable(doc: unknown): doc is MapDocument {
  const d = doc as MapDocument | null
  return Boolean(d && d.schemaVersion === SCHEMA && d.scope && DATASETS.has(d.scope.datasetId))
}

/** Puts the saved maps back. Called once, before the editor first renders. */
export function restoreSavedMap(): void {
  let saved: Saved | null = null
  try {
    const raw = localStorage.getItem(KEY)
    saved = raw ? (JSON.parse(raw) as Saved) : null
  } catch {
    return
  }
  if (!saved || saved.version !== 1 || !usable(saved.doc)) return
  const parked = Object.fromEntries(
    Object.entries(saved.parked ?? {})
      .filter(([, doc]) => usable(doc))
      .map(([atlasId, doc]) => [atlasId, { doc, past: [], future: [], selectedCountryIds: [], selectedWaterIds: [] }]),
  )
  /*
   * A map saved with a frame on, from before a map kept the frame it was composed in, was composed
   * against the whole canvas: it keeps that, rather than refitting into its frame on the next load.
   */
  let doc = saved.doc
  if (doc.scope.fitRect === undefined && doc.screen.enabled) doc = { ...doc, scope: { ...doc.scope, fitRect: null } }
  useMapStore.setState({ doc, parked, fitBox: fitBoxOf(doc) })
}

function write(): void {
  const { doc, parked } = useMapStore.getState()
  const saved: Saved = {
    version: 1,
    savedAt: new Date().toISOString(),
    doc,
    parked: Object.fromEntries(Object.entries(parked).map(([atlasId, map]) => [atlasId, map.doc])),
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(saved))
    if (useAutosave.getState().failed) useAutosave.setState({ failed: false })
  } catch (error) {
    console.warn('[autosave] the map could not be saved in this browser', error)
    useAutosave.setState({ failed: true })
  }
}

/** Starts saving. Returns the function that stops it. */
export function startAutosave(): () => void {
  let timer: number | undefined
  let pending = false
  const flush = () => {
    window.clearTimeout(timer)
    if (!pending) return
    pending = false
    write()
  }
  const unsubscribe = useMapStore.subscribe((state, previous) => {
    if (state.doc === previous.doc && state.parked === previous.parked) return
    pending = true
    window.clearTimeout(timer)
    timer = window.setTimeout(flush, WRITE_DELAY_MS)
  })
  const onHidden = () => {
    if (document.visibilityState === 'hidden') flush()
  }
  // Only when saving has failed is leaving the page a loss worth a question.
  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    flush()
    if (!useAutosave.getState().failed) return
    event.preventDefault()
    event.returnValue = ''
  }
  document.addEventListener('visibilitychange', onHidden)
  window.addEventListener('pagehide', flush)
  window.addEventListener('beforeunload', onBeforeUnload)
  return () => {
    flush()
    unsubscribe()
    document.removeEventListener('visibilitychange', onHidden)
    window.removeEventListener('pagehide', flush)
    window.removeEventListener('beforeunload', onBeforeUnload)
  }
}
