/**
 * NOT IN USE for now: the years are chosen in File → Maps ("World 1990"…). Kept for when the top
 * bar gets it back.
 *
 * The Year control: between File and the regions, "Year" with the open map's year under it, and
 * behind it a pocket watch.
 *
 * The watch's dial has one window. The years are printed round a disc under the dial, and the
 * disc turns to bring one into the window — by the arrows beside the window, the wheel, the arrow
 * keys, or by taking hold of the dial and turning it, when it settles on the nearest year. The
 * year in the window is the one opened, a moment after the disc stops, so turning past three
 * years loads only the fourth.
 *
 * The years are the World map's (`Atlas.years`) and today's, {@link MODERN_YEAR}. Choosing one
 * is `setYear`: the same map in another year, the region, frame, colours and stickers kept.
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Popover } from './Menu'
import { useMapStore } from '../state/mapStore'
import { getAtlas, DEFAULT_ATLAS_ID, MODERN_YEAR, yearOfDataset } from '../maps/atlas'

/** Oldest first, today last. */
const YEARS = [...(getAtlas(DEFAULT_ATLAS_ID).years ?? []).map((d) => d.year as number), MODERN_YEAR]

/** What each year's map shows, engraved under the window: the dataset's own line. */
const CAPTIONS: Record<number, string> = {
  ...Object.fromEntries((getAtlas(DEFAULT_ATLAS_ID).years ?? []).map((d) => [d.year, d.description ?? ''])),
  [MODERN_YEAR]: 'Today',
}

/**
 * Degrees of the disc between one year and the next. Close enough that a turning year is seen to
 * roll out of the window as the next rolls in; at rest only the year in the window is shown.
 */
const STEP = 40
/** The radius the years are printed at, and the window over them. */
const RING = 58
/** How long the disc must rest before its year is opened. */
const SETTLE_MS = 380

const rotationOf = (index: number) => -index * STEP
const clampIndex = (index: number) => Math.max(0, Math.min(YEARS.length - 1, index))

function Watch({ onDone }: { onDone: () => void }) {
  const datasetId = useMapStore((s) => s.doc.scope.datasetId)
  const setYear = useMapStore((s) => s.setYear)
  const current = Math.max(0, YEARS.indexOf(yearOfDataset(datasetId)))
  const [index, setIndex] = useState(current)
  /** While the dial is held: the disc's angle, following the hand. */
  const [held, setHeld] = useState<number | null>(null)
  const dial = useRef<SVGSVGElement>(null)
  const grip = useRef<{ start: number; from: number; moved: boolean } | null>(null)
  const lastWheel = useRef(0)

  // Another way to the year — undo, a template — turns the disc to it.
  useEffect(() => {
    if (held === null) setIndex(current)
    // Only when the map's year changes, not when the hand lets go.
  }, [current]) // eslint-disable-line react-hooks/exhaustive-deps

  // The year in the window is opened once the disc has rested there.
  useEffect(() => {
    if (held !== null || index === current) return
    const timer = window.setTimeout(() => setYear(YEARS[index]), SETTLE_MS)
    return () => window.clearTimeout(timer)
  }, [index, held, current, setYear])

  useEffect(() => {
    dial.current?.focus({ preventScroll: true })
  }, [])

  const step = (by: number) => setIndex((i) => clampIndex(i + by))

  /** The pointer's angle round the dial's centre, clockwise from twelve. */
  const angleAt = (event: { clientX: number; clientY: number }) => {
    const box = dial.current!.getBoundingClientRect()
    const scale = box.width / VIEW_W
    const cx = box.left + -VIEW_X * scale
    const cy = box.top + -VIEW_Y * scale
    return (Math.atan2(event.clientX - cx, cy - event.clientY) * 180) / Math.PI
  }

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if ((event.target as Element).closest('[data-step]')) return
    event.currentTarget.setPointerCapture(event.pointerId)
    grip.current = { start: angleAt(event), from: rotationOf(index), moved: false }
  }
  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const g = grip.current
    if (!g) return
    let turned = angleAt(event) - g.start
    if (turned > 180) turned -= 360
    if (turned < -180) turned += 360
    if (!g.moved && Math.abs(turned) < 3) return
    g.moved = true
    // The disc follows the hand, a little past the first and last year at most.
    setHeld(Math.max(rotationOf(YEARS.length - 1) - 18, Math.min(18, g.from + turned)))
  }
  const onPointerUp = () => {
    const g = grip.current
    grip.current = null
    if (g?.moved && held !== null) setIndex(clampIndex(Math.round(-held / STEP)))
    setHeld(null)
  }

  const rotation = held ?? rotationOf(index)
  // The year in the window — while the dial is held, the one nearest it.
  const year = YEARS[held === null ? index : clampIndex(Math.round(-held / STEP))]

  return (
    <div className="year-watch">
      <svg
        ref={dial}
        className={`year-watch__face${held !== null ? ' year-watch__face--held' : ''}`}
        viewBox={`${VIEW_X} ${VIEW_Y} ${VIEW_W} ${VIEW_H}`}
        width={VIEW_W}
        height={VIEW_H}
        role="slider"
        tabIndex={0}
        aria-label="Year"
        aria-valuemin={YEARS[0]}
        aria-valuemax={YEARS[YEARS.length - 1]}
        aria-valuenow={year}
        aria-valuetext={`${year} — ${CAPTIONS[year] ?? ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={(event) => {
          // One year a notch; a trackpad's stream of small deltas is one year per 140 ms.
          const now = performance.now()
          if (Math.abs(event.deltaY) < 2 || now - lastWheel.current < 140) return
          lastWheel.current = now
          step(event.deltaY > 0 ? 1 : -1)
        }}
        onKeyDown={(event) => {
          const by = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[event.key]
          if (by) {
            event.preventDefault()
            step(by)
          } else if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault()
            setIndex(event.key === 'Home' ? 0 : YEARS.length - 1)
          } else if (event.key === 'Enter') {
            if (index !== current) setYear(YEARS[index])
            onDone()
          }
        }}
      >
        <defs>
          <radialGradient id="year-watch-case" cx="35%" cy="30%" r="80%">
            <stop offset="0" stopColor="var(--watch-metal-hi)" />
            <stop offset="0.55" stopColor="var(--watch-metal)" />
            <stop offset="1" stopColor="var(--watch-metal-lo)" />
          </radialGradient>
          <linearGradient id="year-watch-bezel" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--watch-metal-lo)" />
            <stop offset="1" stopColor="var(--watch-metal-hi)" />
          </linearGradient>
          <radialGradient id="year-watch-dial" cx="50%" cy="40%" r="70%">
            <stop offset="0" stopColor="var(--watch-dial-hi)" />
            <stop offset="1" stopColor="var(--watch-dial)" />
          </radialGradient>
          <clipPath id="year-watch-window">
            <rect x={-WINDOW_W / 2} y={-RING - WINDOW_H / 2} width={WINDOW_W} height={WINDOW_H} rx="9" />
          </clipPath>
        </defs>

        {/* The bow and the crown. */}
        <circle cx="0" cy="-134" r="13" fill="none" stroke="url(#year-watch-bezel)" strokeWidth="5" />
        <rect x="-5" y="-123" width="10" height="10" rx="2" fill="url(#year-watch-case)" />
        <rect x="-11" y="-117" width="22" height="12" rx="3" fill="url(#year-watch-case)" stroke="var(--watch-metal-lo)" strokeWidth="0.8" />
        {[-7, -3.5, 0, 3.5, 7].map((x) => (
          <line key={x} x1={x} y1="-115.5" x2={x} y2="-106.5" stroke="var(--watch-metal-lo)" strokeWidth="0.7" opacity="0.7" />
        ))}

        {/* The case, the bezel, the dial. */}
        <circle r="104" fill="url(#year-watch-case)" stroke="var(--watch-metal-lo)" strokeWidth="1" />
        <circle r="97" fill="url(#year-watch-bezel)" />
        <circle r="92" fill="url(#year-watch-dial)" />

        {/* Minute marks, and the hours heavier. */}
        {Array.from({ length: 60 }, (_, i) => {
          const hour = i % 5 === 0
          return (
            <line
              key={i}
              x1="0"
              y1={-87}
              x2="0"
              y2={hour ? -79 : -83}
              stroke="var(--watch-ink)"
              strokeWidth={hour ? 1.6 : 0.6}
              opacity={hour ? 0.8 : 0.45}
              transform={`rotate(${i * 6})`}
            />
          )
        })}

        {/* The window, and the disc of years under it. */}
        <rect
          x={-WINDOW_W / 2}
          y={-RING - WINDOW_H / 2}
          width={WINDOW_W}
          height={WINDOW_H}
          rx="9"
          fill="var(--watch-window)"
        />
        <g clipPath="url(#year-watch-window)">
          <g className="year-watch__disc" style={{ transform: `rotate(${rotation}deg)` }}>
            {YEARS.map((y, i) => (
              <text
                key={y}
                className="year-watch__year"
                // Seen only near the window: the one in it, and one passing through.
                opacity={Math.max(0, 1 - Math.abs(i * STEP + rotation) / (STEP * 0.8))}
                x="0"
                y={-RING}
                transform={`rotate(${i * STEP})`}
                textAnchor="middle"
                dominantBaseline="central"
              >
                {y}
              </text>
            ))}
          </g>
        </g>
        <rect
          x={-WINDOW_W / 2}
          y={-RING - WINDOW_H / 2}
          width={WINDOW_W}
          height={WINDOW_H}
          rx="9"
          fill="none"
          stroke="url(#year-watch-bezel)"
          strokeWidth="2.5"
        />

        {/* Earlier and later, either side of the window. */}
        {[
          { by: -1, x: -WINDOW_W / 2 - 15, d: 'M3 -6 -3 0 3 6', label: 'Earlier year' },
          { by: 1, x: WINDOW_W / 2 + 15, d: 'M-3 -6 3 0 -3 6', label: 'Later year' },
        ].map((s) => {
          const off = s.by < 0 ? index === 0 : index === YEARS.length - 1
          return (
            <g
              key={s.by}
              data-step
              className={`year-watch__step${off ? ' year-watch__step--off' : ''}`}
              transform={`translate(${s.x} ${-RING})`}
              role="button"
              aria-label={s.label}
              onClick={() => step(s.by)}
            >
              <circle r="11" />
              <path d={s.d} fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </g>
          )
        })}

        {/* What the year's map shows. */}
        <text className="year-watch__caption" x="0" y="26" textAnchor="middle">
          {CAPTIONS[year] ?? ''}
        </text>

        {/* The hand, pointing at the window, and its cap. */}
        <path d="M0 -33 L3.2 -6 L0 6 L-3.2 -6 Z" fill="var(--watch-ink)" />
        <circle r="5" fill="url(#year-watch-case)" stroke="var(--watch-ink)" strokeWidth="0.8" />
        <circle r="1.6" fill="var(--watch-ink)" />
      </svg>
    </div>
  )
}

const VIEW_X = -112
const VIEW_Y = -152
const VIEW_W = 224
const VIEW_H = 264
const WINDOW_W = 86
const WINDOW_H = 40

/** The top bar's Year button, and the watch it opens. */
export function YearControl() {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const datasetId = useMapStore((s) => s.doc.scope.datasetId)
  const year = yearOfDataset(datasetId)
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className={`top-button top-year${open ? ' top-button--open' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`Year · ${year}`}
        onClick={() => setOpen(!open)}
      >
        <span className="top-year__label">Year</span>
        <span className="top-year__value">{year}</span>
      </button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} label="Year" className="year-popover">
        <Watch onDone={() => setOpen(false)} />
      </Popover>
    </>
  )
}
