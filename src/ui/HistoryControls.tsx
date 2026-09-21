/**
 * Undo and redo.
 *
 * Both act on the history in the store — the document and the selection as they stood before
 * each edit — not on anything the UI is holding. A control that undid its own React state
 * would drift from the document the moment an edit arrived from anywhere else, which the
 * assistant is going to do shortly.
 *
 * The header's two arrows and the shortcuts call the same two functions, {@link undoMapEdit} and
 * {@link redoMapEdit}, so there is one behaviour to reason about. The shortcuts are the
 * standard ones — Ctrl+Z undoes, Ctrl+Y redoes, and Ctrl+Shift+Z redoes too — and they are the
 * map's only while nothing is being typed: inside a text field Ctrl+Z belongs to the field,
 * which undoes the typing the author is looking at, and taking it for the map there would
 * undo something they are not.
 */
import { useEffect } from 'react'
import { useMapStore } from '../state/mapStore'

/** Takes back the last edit. Returns whether there was one to take back. */
export function undoMapEdit(): boolean {
  const store = useMapStore.getState()
  if (store.past.length === 0) return false
  store.undo()
  return true
}

/** Re-applies the last edit undone. Returns whether there was one. */
export function redoMapEdit(): boolean {
  const store = useMapStore.getState()
  if (store.future.length === 0) return false
  store.redo()
  return true
}

/** Input types that hold text a person types — where Ctrl+Z means the field's own undo. */
const TEXT_INPUT_TYPES = new Set([
  'text',
  'search',
  'email',
  'url',
  'tel',
  'password',
  'number',
  'date',
  'datetime-local',
  'month',
  'time',
  'week',
])

/** Whether a keystroke is going to something that edits text, which keeps its own shortcuts. */
function isTextEditing(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (target instanceof HTMLTextAreaElement) return true
  if (target instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(target.type)
  if (target instanceof HTMLElement && target.isContentEditable) return true
  return target.closest('[contenteditable=""], [contenteditable="true"], [role="textbox"]') !== null
}

/**
 * The letter a shortcut names, whatever the keyboard layout. `key` is the character the key
 * types, which is right on every Latin layout — Ctrl+Z is wherever Z is — and says nothing on
 * a Cyrillic or Greek one, where the physical key's `code` is what the shortcut means.
 */
function shortcutLetter(event: KeyboardEvent): string {
  if (/^[a-z]$/i.test(event.key)) return event.key.toLowerCase()
  if (event.code === 'KeyZ') return 'z'
  if (event.code === 'KeyY') return 'y'
  return ''
}

/**
 * The shortcuts as the keyboard in front of the author names them: ⌘ on Apple's, Ctrl on
 * everyone else's. Both are handled on every platform (see `onKeyDown`); this is only what the
 * tooltip says.
 */
const IS_APPLE =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent)
const UNDO_HINT = IS_APPLE ? 'Undo (⌘Z)' : 'Undo (Ctrl+Z)'
const REDO_HINT = IS_APPLE ? 'Redo (⇧⌘Z)' : 'Redo (Ctrl+Y or Ctrl+Shift+Z)'

export function HistoryControls() {
  const canUndo = useMapStore((s) => s.past.length > 0)
  const canRedo = useMapStore((s) => s.future.length > 0)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.isComposing) return
      const letter = shortcutLetter(event)
      const isUndo = letter === 'z' && !event.shiftKey
      const isRedo = letter === 'y' || (letter === 'z' && event.shiftKey)
      if (!isUndo && !isRedo) return
      if (isTextEditing(event.target)) return

      // Ours from here on, whether or not there is anything to undo: nothing else on the page
      // should act on it instead.
      event.preventDefault()
      if (isUndo) undoMapEdit()
      else redoMapEdit()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="history-controls">
      <button
        type="button"
        className="btn btn--icon"
        disabled={!canUndo}
        title={UNDO_HINT}
        aria-label="Undo"
        onClick={undoMapEdit}
      >
        <HistoryArrow direction="undo" />
      </button>
      <button
        type="button"
        className="btn btn--icon"
        disabled={!canRedo}
        title={REDO_HINT}
        aria-label="Redo"
        onClick={redoMapEdit}
      >
        <HistoryArrow direction="redo" />
      </button>
    </div>
  )
}

/** The same arrow both ways round, so the pair reads as one control. */
function HistoryArrow({ direction }: { direction: 'undo' | 'redo' }) {
  return (
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
      focusable="false"
      style={direction === 'redo' ? { transform: 'scaleX(-1)' } : undefined}
    >
      <path d="M3.2 6.6h6.2a3.4 3.4 0 0 1 0 6.8H6.1" />
      <path d="M5.9 3.6 2.9 6.6l3 3" />
    </svg>
  )
}
