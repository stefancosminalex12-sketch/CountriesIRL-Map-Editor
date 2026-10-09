/**
 * The loading screen: the CountriesIRL logo, as large as the window allows, on one solid colour —
 * the theme's off-white with the logo in navy, or on Dark the same two colours the other way
 * round. Shown while a map loads and its outlines are first drawn, and while flags mode first
 * fetches its flags; see `MapCanvas` for when it is `active`.
 *
 * The logo is one mask (`public/brand/logo-mask.png`, the brand mark with its paper taken out),
 * painted in the theme's colour, so there is one image for every theme.
 *
 * **It covers the map in the same frame the load starts.** Whether it is up is worked out while
 * rendering, from `active` itself, not set a moment later: a switch of map clears the old map and
 * resets the camera in the very render that starts the load, and the screen used to wait 180ms
 * before appearing — long enough to see the view jump to the whole world first. Now that frame is
 * already covered.
 *
 * Leaving is what is timed: once up it stays at least {@link MIN_VISIBLE_MS}, so a quick switch is
 * a short, deliberate beat rather than a flicker, and it fades out a moment after the map is drawn.
 *
 * The page's own splash (`#boot-splash` in `index.html`) covers the seconds before any of this
 * has loaded; it is removed as this takes over, and they look the same, so the hand-over does not
 * show.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLoadingHold } from './loadingHold'

/** Once up, it stays at least this long. */
const MIN_VISIBLE_MS = 450
/** The fade out; matches `.loading-screen` in the stylesheet. */
const FADE_MS = 320

type Phase = 'hidden' | 'shown' | 'leaving'

const LOGO = `${import.meta.env.BASE_URL}brand/logo-mask.png`

export function LoadingScreen({ active: loading }: { active: boolean }) {
  // Up while the map says it is loading, or while a control holds it (`holdLoadingScreen`).
  const held = useLoadingHold((s) => s.holds > 0)
  const active = loading || held
  const [phase, setPhase] = useState<Phase>(active ? 'shown' : 'hidden')
  const shownAt = useRef(active ? performance.now() : 0)

  useEffect(() => {
    document.getElementById('boot-splash')?.remove()
  }, [])

  /* Coming up: recorded before the browser paints, in the same commit as `active`. */
  useLayoutEffect(() => {
    if (!active || phase === 'shown') return
    if (phase === 'hidden') shownAt.current = performance.now()
    setPhase('shown')
  }, [active, phase])

  /* Going down: each phase schedules only its own next step, so a change of phase never cancels it. */
  useEffect(() => {
    if (active) return
    let timer: number | undefined
    if (phase === 'shown') {
      const wait = Math.max(0, MIN_VISIBLE_MS - (performance.now() - shownAt.current))
      // A moment after the map is drawn, then the fade: it uncovers a finished picture.
      timer = window.setTimeout(() => setPhase('leaving'), wait + 50)
    } else if (phase === 'leaving') {
      timer = window.setTimeout(() => setPhase('hidden'), FADE_MS)
    }
    return () => window.clearTimeout(timer)
  }, [active, phase])

  // Up whenever it is active — this very render — or still on its way out.
  const up = active || phase !== 'hidden'
  if (!up) return null
  const leaving = !active && phase === 'leaving'
  return createPortal(
    <div
      className={`loading-screen${leaving ? ' loading-screen--leaving' : ''}`}
      role="status"
      aria-live="polite"
      aria-label="Loading"
    >
      <span
        className="loading-screen__logo"
        aria-hidden="true"
        style={{ WebkitMaskImage: `url(${LOGO})`, maskImage: `url(${LOGO})` }}
      />
    </div>,
    document.body,
  )
}
