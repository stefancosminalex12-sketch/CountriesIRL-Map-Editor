/**
 * Holding the loading screen up from anywhere, before heavy work starts.
 *
 * The screen comes up by itself while a map loads (`MapCanvas`), because that state is in the
 * store the moment a switch begins. Some switches are not like that: turning on flags mode builds
 * every flag's framing in the render it causes, and the page cannot paint anything — the screen
 * included — until that render is done, so a press seemed to do nothing for a moment and then
 * the screen appeared. A control that knows it is about to start such work takes a hold first,
 * waits for the screen to be painted (`afterPaint`), then does the work, and lets go once it is
 * under way; the canvas's own condition keeps the screen up from there for as long as it needs.
 */
import { create } from 'zustand'

interface LoadingHold {
  /** How many holds are out. The screen is up while there is any. */
  holds: number
}

export const useLoadingHold = create<LoadingHold>(() => ({ holds: 0 }))

/** Takes a hold on the loading screen. Returns the release; releasing twice does nothing. */
export function holdLoadingScreen(): () => void {
  useLoadingHold.setState((s) => ({ holds: s.holds + 1 }))
  let released = false
  return () => {
    if (released) return
    released = true
    useLoadingHold.setState((s) => ({ holds: Math.max(0, s.holds - 1) }))
  }
}

/**
 * Runs `run` once what is on screen now has been painted: after the next animation frame, then a
 * task, so the paint is done before the work begins. A timer stands in where frames do not come
 * (a hidden tab), so it always runs.
 */
export function afterPaint(run: () => void): void {
  let done = false
  const go = () => {
    if (done) return
    done = true
    run()
  }
  const fallback = window.setTimeout(go, 120)
  requestAnimationFrame(() => {
    window.clearTimeout(fallback)
    window.setTimeout(go, 0)
  })
}
