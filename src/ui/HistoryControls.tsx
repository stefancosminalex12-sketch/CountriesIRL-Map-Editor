/**
 * Undo and redo.
 *
 * Both act on the document history in the store — the stack of `MapDocument`s the
 * dispatcher records before each edit — not on anything the UI is holding. A control
 * that undid its own React state would drift from the document the moment an edit
 * arrived from anywhere else, which the assistant is going to do shortly.
 *
 * The shortcuts are bound on the window rather than on these buttons, and they are
 * bound unconditionally: in a map editor Ctrl+Z means "take back that edit", and
 * having it mean something else while a text field happens to hold focus is the kind
 * of exception that costs people work. Every text field here writes through an
 * operation anyway, so undo reverses what was typed too.
 */
import { useEffect } from 'react'
import { useMapStore } from '../state/mapStore'
import { playSfx } from '../audio/sfx'

export function HistoryControls() {
  const undo = useMapStore((s) => s.undo)
  const redo = useMapStore((s) => s.redo)
  const canUndo = useMapStore((s) => s.past.length > 0)
  const canRedo = useMapStore((s) => s.future.length > 0)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      const key = event.key.toLowerCase()
      const isRedo = key === 'y' || (key === 'z' && event.shiftKey)
      const isUndo = key === 'z' && !event.shiftKey
      if (!isRedo && !isUndo) return

      event.preventDefault()
      const store = useMapStore.getState()
      if (isRedo) {
        if (store.future.length === 0) return
        store.redo()
      } else {
        if (store.past.length === 0) return
        store.undo()
      }
      playSfx('tick')
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
        title="Undo (Ctrl+Z)"
        aria-label="Undo"
        onClick={() => {
          undo()
          playSfx('tick')
        }}
      >
        <HistoryArrow direction="undo" />
      </button>
      <button
        type="button"
        className="btn btn--icon"
        disabled={!canRedo}
        title="Redo (Ctrl+Shift+Z or Ctrl+Y)"
        aria-label="Redo"
        onClick={() => {
          redo()
          playSfx('tick')
        }}
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
