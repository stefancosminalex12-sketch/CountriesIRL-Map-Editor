/**
 * A binary map-display control.
 *
 * The whole surface is the toggle. It is a real `<button role="switch">`, so it
 * carries its state in `aria-checked`, takes focus in the normal tab order and
 * responds to Enter and Space without any of that being reimplemented here.
 *
 * State is shown three ways at once, which is what keeps it legible in all three
 * themes and without relying on colour alone: the surface lifts to the accent tint,
 * a rail appears along the leading edge, and the icon and label brighten. Everything
 * is drawn from the theme's own tokens — no colour is written here.
 *
 * The icons are line drawings on a 16-unit grid, stroked in `currentColor` so they
 * inherit whatever the state and theme have decided. They exist to make the four
 * controls scannable, not to decorate them.
 */
import { playSfx } from '../audio/sfx'

export type MapToggleIcon =
  | 'borders'
  | 'coastline'
  | 'lakes'
  | 'rivers'
  | 'graticule'
  | 'globe'
  | 'legend'
  | 'names'
  | 'caption'
  | 'rectangle'
  | 'brush'
  | 'magnifier'

/**
 * One glyph per control, each a closed idea at 14 px:
 *
 *   borders   — a territory divided by an emphasised edge
 *   lakes     — water, as two ripples
 *   rivers    — one winding course with a tributary joining it
 *   graticule — a ruled grid, deliberately square so it cannot be confused with…
 *   globe     — …the sphere's outline, deliberately round for the same reason
 *   coastline — a shore: land above the line, water below it
 *   legend    — a panel with two keyed rows, which is what the thing itself looks like
 *   names     — a letter on a rule: type sitting on the land, which is the feature
 *   caption   — a line of type above a frame: a headline over the picture
 *
 * Water started as a lake outline, which at 14 px is a blob and reads as neither a
 * lake nor anything else; ripples survive the size, which is the only test that
 * matters for a glyph this small.
 */
const ICON_PATHS: Record<MapToggleIcon, JSX.Element> = {
  borders: (
    <>
      <path d="M2.6 5.3 6.1 3.2l4 1.4 3.3-1.1v7.3l-3.6 1.2-3.9-1.3-3.3 1.4z" />
      <path d="M6.1 3.2 7.4 6.2 5.7 8.6 6.7 11.7" />
    </>
  ),
  coastline: (
    <>
      {/*
        A shoreline, with one ripple under it. Deliberately not the borders glyph with a
        wave added: the two switches do different things and have to be told apart at
        14px, so this one is a single edge where that one is a divided territory.
      */}
      <path d="M2.6 8.4c1.6 0 2.2-1.5 3.9-1.5s2.3 1.5 3.9 1.5 2.2-1.5 3.9-1.5c.8 0 1.3.35 1.7.7" />
      <path d="M2.6 12.2c1.6 0 2.2-1.2 3.9-1.2s2.3 1.2 3.9 1.2 2.2-1.2 3.9-1.2c.8 0 1.3.28 1.7.56" />
    </>
  ),
  lakes: (
    <>
      <path d="M2.6 6.1c1.1-1 2.2-1 3.3 0s2.2 1 3.3 0 2.2-1 3.3 0" />
      <path d="M2.6 9.9c1.1-1 2.2-1 3.3 0s2.2 1 3.3 0 2.2-1 3.3 0" />
    </>
  ),
  rivers: (
    <>
      {/*
        A single meandering line with one tributary running into it. Deliberately not the
        lakes glyph: ripples are two parallel strokes and read as a body of water, where a
        river has to read as one continuous course that goes somewhere.
      */}
      <path d="M3.2 2.8c0 2.4 2.2 3 2.2 5.2s-2.2 2.8-2.2 5.2" />
      <path d="M5.4 8c1.9 0 2.6-1.4 4.2-1.4 1.4 0 2 .9 3.2.9" />
    </>
  ),
  graticule: (
    <>
      <rect x="2.4" y="2.4" width="11.2" height="11.2" rx="1.4" />
      <path d="M6.1 2.4v11.2M9.9 2.4v11.2M2.4 6.1h11.2M2.4 9.9h11.2" />
    </>
  ),
  globe: (
    <>
      <circle cx="8" cy="8" r="5.6" />
      <path d="M8 2.4c1.7 1.6 2.6 3.5 2.6 5.6S9.7 12.4 8 13.6C6.3 12.4 5.4 10.1 5.4 8s.9-4 2.6-5.6z" />
    </>
  ),
  caption: (
    <>
      {/* A line of type, and the frame it heads. */}
      <path d="M3.4 4.2h9.2" />
      <path d="M5.6 6.6h4.8" />
      <rect x="2.6" y="9.2" width="10.8" height="4.4" rx="1" />
    </>
  ),
  names: (
    <>
      {/* A capital A standing on the ground it is drawn on. */}
      <path d="M4.1 10.8 8 3.6l3.9 7.2" />
      <path d="M5.7 8.4h4.6" />
      <path d="M2.6 13.4h10.8" />
    </>
  ),
  rectangle: (
    <>
      {/* A dashed box over the ground it takes, and the pointer that drew it. */}
      <rect x="2.4" y="2.8" width="9.6" height="8" rx="0.8" strokeDasharray="1.8 1.6" />
      <path d="M9.4 8.6l4.4 1.6-1.9.7-.7 1.9z" />
    </>
  ),
  magnifier: (
    <>
      {/* A lens and its handle. */}
      <circle cx="6.8" cy="6.8" r="4.2" />
      <path d="M9.9 9.9l3.7 3.7" />
    </>
  ),
  brush: (
    <>
      {/* A brush head, and the trail it leaves across the land. */}
      <path d="M9.6 2.6l3.8 3.8-3.4 3.4-3.8-3.8z" />
      <path d="M2.6 13c1.3-1.8 2.7-1.8 4 0s2.7 1.8 4 0" />
    </>
  ),
  legend: (
    <>
      <rect x="2.4" y="3.2" width="11.2" height="9.6" rx="1.4" />
      {/* Two swatches and their labels: the panel in miniature. */}
      <rect x="4.6" y="5.9" width="1.9" height="1.9" rx="0.4" />
      <rect x="4.6" y="9.1" width="1.9" height="1.9" rx="0.4" />
      <path d="M8.4 6.85h2.9M8.4 10.05h2.9" />
    </>
  ),
}

export interface MapToggleProps {
  icon: MapToggleIcon
  label: string
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
}

export function MapToggle({ icon, label, checked, onChange, disabled }: MapToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={`map-toggle${checked ? ' map-toggle--on' : ''}`}
      onClick={() => {
        onChange(!checked)
        // Turning something on and turning it off are the same gesture with opposite
        // meaning, so they get the same sound at two weights rather than two sounds.
        playSfx(checked ? 'toggleOff' : 'toggleOn')
      }}
    >
      <span className="map-toggle__rail" aria-hidden="true" />
      <svg
        className="map-toggle__icon"
        viewBox="0 0 16 16"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        {ICON_PATHS[icon]}
      </svg>
      <span className="map-toggle__label">{label}</span>
    </button>
  )
}
