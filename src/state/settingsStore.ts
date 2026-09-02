/**
 * Editor preferences.
 *
 * Deliberately separate from `mapStore`: these are properties of the person using
 * the editor, not of the map being made. Nothing here belongs in a `MapDocument` or
 * in an export — the one exception is the theme's map palette, which is pushed into
 * the document through the normal operation pipeline because map colours *are* map
 * content.
 *
 * Persisted to localStorage, so preferences survive a refresh without a backend.
 */
import { create } from 'zustand'
import { applyUiTokens, DEFAULT_THEME_ID, getTheme, type ThemeId } from '../theme/themes'
import { setSfxVolume } from '../audio/sfx'
import { useMapStore } from './mapStore'

const STORAGE_KEY = 'map-editor.settings.v1'

export const DEFAULT_SFX_VOLUME = 0.6

/** The selection highlight a fresh install starts with — the Theme Color preset. */
export const DEFAULT_SELECTION_HIGHLIGHT = '#4a7fbf'

interface PersistedSettings {
  themeId: ThemeId
  sfxVolume: number
  /**
   * The colour a selected country is filled with, or `null` to follow the theme.
   *
   * Defaults to the Theme Color preset. `null` is still reachable — "Use theme colour"
   * hands the choice back to whichever selection tone the active theme picks for itself
   * — and it is stored distinctly from "never chosen", so that choice survives a reload
   * rather than being read back as the default.
   */
  selectionHighlight: string | null
}

/** A colour the picker could have produced. Anything else in storage is ignored. */
function readColor(value: unknown): string | null {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : null
}

function read(): PersistedSettings {
  const fallback: PersistedSettings = {
    themeId: DEFAULT_THEME_ID,
    sfxVolume: DEFAULT_SFX_VOLUME,
    selectionHighlight: DEFAULT_SELECTION_HIGHLIGHT,
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<PersistedSettings>
    return {
      themeId: getTheme(parsed.themeId as ThemeId).id,
      sfxVolume:
        typeof parsed.sfxVolume === 'number' && Number.isFinite(parsed.sfxVolume)
          ? Math.max(0, Math.min(1, parsed.sfxVolume))
          : fallback.sfxVolume,
      /*
       * A stored `null` is a real choice — "follow the theme" — and has to be told apart
       * from a preferences file written before this setting existed. Testing for the key
       * keeps that distinction; coalescing on the value alone would quietly overwrite the
       * choice with the default on the next reload.
       */
      selectionHighlight:
        'selectionHighlight' in parsed
          ? readColor(parsed.selectionHighlight)
          : fallback.selectionHighlight,
    }
  } catch {
    return fallback
  }
}

/**
 * Writes preferences, at most once per idle moment.
 *
 * `localStorage.setItem` is synchronous, and two of these settings are dragged rather
 * than clicked: the volume slider and the selection-highlight well both fire on every
 * input event, so a single drag was serialising and writing the whole preferences
 * object sixty times a second on the main thread. That is the jank in the Sound section.
 *
 * The store still updates immediately — what is deferred is only the trip to disk, and
 * the last write of a drag is the one that matters. Flushed on `pagehide` as well, so a
 * tab closed mid-gesture still keeps the setting.
 */
let pending: PersistedSettings | null = null
let writeHandle: number | null = null

function flush(): void {
  if (!pending) return
  const settings = pending
  pending = null
  writeHandle = null
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Private browsing or a full quota: preferences simply do not persist.
  }
}

function write(settings: PersistedSettings): void {
  pending = settings
  if (writeHandle !== null) return
  writeHandle = window.setTimeout(flush, 200)
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flush)
}

interface SettingsStore {
  themeId: ThemeId
  sfxVolume: number
  /** See {@link PersistedSettings.selectionHighlight}. */
  selectionHighlight: string | null
  setTheme: (id: ThemeId) => void
  setSfxVolume: (volume: number) => void
  /** `null` hands the colour back to the theme. */
  setSelectionHighlight: (color: string | null) => void
}

const initial = read()

/**
 * Pushes the theme's map palette into the document.
 *
 * Routed through `set_style` rather than written directly, so a theme change is an
 * ordinary map operation — validated, logged, and undoable alongside everything else.
 */
function applyMapPalette(id: ThemeId): void {
  const theme = getTheme(id)
  useMapStore.getState().dispatch({
    op: 'set_style',
    patch: { ...theme.map, showGraticule: theme.graticuleByDefault ?? false },
  })
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  themeId: initial.themeId,
  sfxVolume: initial.sfxVolume,
  selectionHighlight: initial.selectionHighlight,

  /*
   * Every setter persists the whole of the current state rather than naming the fields
   * it happens to know about. Listing them meant each new preference had to be added to
   * every existing setter, and the one that got missed would quietly wipe it on the next
   * unrelated change.
   */
  setTheme(id) {
    if (get().themeId === id) return
    applyUiTokens(getTheme(id))
    applyMapPalette(id)
    set({ themeId: id })
    persist(get())
  },

  setSfxVolume(volume) {
    const next = Math.max(0, Math.min(1, volume))
    setSfxVolume(next)
    set({ sfxVolume: next })
    persist(get())
  },

  setSelectionHighlight(color) {
    set({ selectionHighlight: color ? (readColor(color) ?? null) : null })
    persist(get())
  },
}))

/** Snapshots whatever the store currently holds. */
function persist(state: SettingsStore): void {
  write({
    themeId: state.themeId,
    sfxVolume: state.sfxVolume,
    selectionHighlight: state.selectionHighlight,
  })
}

/** Applies stored preferences at start-up, before the first paint where possible. */
export function initialiseSettings(): void {
  const { themeId, sfxVolume } = useSettingsStore.getState()
  applyUiTokens(getTheme(themeId))
  applyMapPalette(themeId)
  setSfxVolume(sfxVolume)
}
