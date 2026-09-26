/**
 * Brush Mode for as long as Ctrl is held, on a desktop.
 *
 * Not a toggle and not a second brush: while Ctrl is down the map's ordinary brush is armed —
 * the same stroke, the same add-or-erase rule, the same undo step — and its button in the
 * Select panel shows it. Letting go of Ctrl hands the map back to whatever was in hand before;
 * if Brush Mode was already switched on it stays on, because this only ever adds to it (see
 * `brushHeld` in the store).
 *
 * What it keeps out of the way of:
 *
 * - **Shortcuts.** Ctrl with anything else — Ctrl+Z, Ctrl+Y, Ctrl+C, AltGr (which Windows sends
 *   as Ctrl and Alt) — is a shortcut, not a hold, so any other key ends it at once.
 * - **Typing.** Nothing happens while an input, a text area, a select or an editable element
 *   has the keyboard.
 * - **Key repeat.** Holding Ctrl sends a stream of key-downs; only the first counts.
 * - **A lost key-up.** Leaving the window with Ctrl down, switching tabs, or a pointer moving
 *   without Ctrl all end it, so it cannot stay stuck on.
 * - **Touch.** Only with a fine pointer; a phone or a tablet is left exactly as it was.
 *
 * The trackpad pinch is a Ctrl-wheel the browser makes up without any key event, so it never
 * reaches this and still zooms.
 */
import { useEffect } from 'react'
import { useMapStore } from '../state/mapStore'

/** Whether the keyboard belongs to something being typed into. */
function typingInto(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)
}

export function useHeldBrush(): void {
  useEffect(() => {
    const fine = window.matchMedia('(any-pointer: fine)')
    let held = false
    const set = (on: boolean) => {
      if (held === on) return
      held = on
      useMapStore.getState().setBrushHeld(on)
    }
    const release = () => set(false)

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Control') {
        // A shortcut, not a hold.
        release()
        return
      }
      if (event.repeat || held) return
      if (!fine.matches || event.altKey || event.shiftKey || event.metaKey) return
      if (typingInto(event.target) || typingInto(document.activeElement)) return
      set(true)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Control' || !event.ctrlKey) release()
    }
    // A pointer that moves without Ctrl says the key-up was missed.
    const onPointer = (event: PointerEvent) => {
      if (held && !event.ctrlKey) release()
    }
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') release()
    }

    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('pointermove', onPointer, { capture: true, passive: true })
    window.addEventListener('pointerdown', onPointer, { capture: true, passive: true })
    window.addEventListener('blur', release)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('pointermove', onPointer, true)
      window.removeEventListener('pointerdown', onPointer, true)
      window.removeEventListener('blur', release)
      document.removeEventListener('visibilitychange', onVisibility)
      release()
    }
  }, [])
}
