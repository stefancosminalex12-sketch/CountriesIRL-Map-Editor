/**
 * Long work, done without holding the page.
 *
 * Opening the administrative world means decoding, repairing and measuring 4,595
 * subdivisions and projecting 20 MB of outline. Done in one go that is seconds in which the
 * page cannot paint a frame or answer a click — the panels freeze, the loading message never
 * appears, and on a phone the browser offers to kill the tab. None of it has to happen in
 * one go: every step is a loop over independent entities.
 *
 * A slicer lets such a loop run for a short budget, then hand the thread back for a moment
 * before carrying on. The loop does exactly the same work in exactly the same order, so its
 * result is identical; only the page's ability to breathe in between changes.
 */

export interface Slicer {
  /** Whether this slice has used up its budget and the loop should pause. */
  due(): boolean
  /** Hands the thread back to the browser, and starts a fresh slice once it returns. */
  pause(): Promise<void>
}

/**
 * Yields to the event loop: a message posted to ourselves is delivered after the browser has
 * had its turn, without the 4 ms clamp a nested `setTimeout` accrues and without being
 * throttled in a background tab the way timers are.
 */
export function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    channel.port1.onmessage = () => {
      channel.port1.close()
      resolve()
    }
    channel.port2.postMessage(null)
  })
}

/**
 * A slicer with a budget of `budgetMs` per slice.
 *
 * Twelve milliseconds by default: most of a 60 Hz frame, leaving the rest for the browser to
 * lay out, paint and dispatch input.
 */
export function createSlicer(budgetMs = 12): Slicer {
  let sliceStart = performance.now()
  return {
    due: () => performance.now() - sliceStart >= budgetMs,
    pause: async () => {
      await yieldToMain()
      sliceStart = performance.now()
    },
  }
}
