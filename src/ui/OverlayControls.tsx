/**
 * Map Overlays: movable copies of an entity's shape, for comparing one place with another.
 *
 * Select a country or a region on the map and make an overlay of it, then drag the overlay
 * anywhere. Each overlay is its own thing — chosen from the list or by tapping it on the map,
 * with its own mode, size, colour, opacity and texture — and none of them changes the map
 * beneath: an overlay copies a shape and never takes it. Overlays answer the pointer only while
 * this panel is open, so everywhere else the map selects exactly as it always has.
 */
import { useEffect } from 'react'
import { useMapStore } from '../state/mapStore'
import { playSfx } from '../audio/sfx'
import { SelectField } from './Select'
import { useNoun } from '../maps/useNoun'
import { mergeCountries } from '../geo/merge'
import { landCentre } from '../render/overlayGeometry'
import { OVERLAY_SCALE_RANGE, type MapOverlay, type OverlayMode, type OverlayTexture } from '../types/map'

const NO_OVERLAYS: MapOverlay[] = []

const MODES: Array<[OverlayMode, string, string]> = [
  ['shape', 'Shape', 'Its shape exactly as the map draws it, carried anywhere unchanged.'],
  [
    'projection',
    'Projection-aware',
    'Moved across the globe: it grows and shrinks with the projection, as land there would.',
  ],
]

const TEXTURES: Array<[OverlayTexture, string]> = [
  ['hatch', 'Hatching'],
  ['dots', 'Dots'],
  ['none', 'None'],
]

/*
 * The size slider runs on a logarithmic scale: halving and doubling are the same distance, so
 * 10%–100% gets as much of the track as 100%–500% would need twice over, and the entity's own
 * size sits near the middle rather than squeezed against one end.
 */
const SIZE_MIN = Math.log2(OVERLAY_SCALE_RANGE.min)
const SIZE_MAX = Math.log2(OVERLAY_SCALE_RANGE.max)

/**
 * A slider position as a scale: whole percent, and the entity's own size within 3% of it.
 *
 * The ends are the ends of the range exactly. The track is not a whole number of steps long, so
 * the browser's last position falls just short of the maximum — 499% rather than 500%.
 */
function scaleAt(position: number): number {
  if (position >= SIZE_MAX - 0.01) return OVERLAY_SCALE_RANGE.max
  if (position <= SIZE_MIN + 0.01) return OVERLAY_SCALE_RANGE.min
  const scale = Math.round(2 ** position * 100) / 100
  if (Math.abs(scale - 1) <= 0.03) return 1
  return Math.min(OVERLAY_SCALE_RANGE.max, Math.max(OVERLAY_SCALE_RANGE.min, scale))
}

const formatLonLat = ([lon, lat]: [number, number]) =>
  `${Math.abs(lat).toFixed(1)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(1)}° ${lon >= 0 ? 'E' : 'W'}`

export function OverlayControls() {
  const overlays = useMapStore((s) => s.doc.overlays) ?? NO_OVERLAYS
  const merges = useMapStore((s) => s.doc.merges)
  const geo = useMapStore((s) => s.geo)
  const selected = useMapStore((s) => s.selectedCountryIds)
  const activeId = useMapStore((s) => s.activeOverlayId)
  const dispatch = useMapStore((s) => s.dispatch)
  const setOverlayMode = useMapStore((s) => s.setOverlayMode)
  const setActive = useMapStore((s) => s.setActiveOverlay)
  const createFromSelection = useMapStore((s) => s.createOverlaysFromSelection)
  const deleteOverlay = useMapStore((s) => s.deleteOverlay)
  const noun = useNoun()

  /*
   * The panel being open is what lets overlays take the pointer — mounted when the section
   * opens and unmounted when it closes, so there is nothing to keep in step.
   */
  useEffect(() => {
    setOverlayMode(true)
    return () => setOverlayMode(false)
  }, [setOverlayMode])

  const mergeById = new Map(merges.map((m) => [m.id, m]))
  const nameOf = (id: string) =>
    mergeById.get(id)?.name ?? geo?.meta[id]?.name ?? geo?.byId.get(id)?.properties.name ?? id
  /* What can be copied: selected entities of this map, merged groups included. */
  const copyable = selected.filter((id) => mergeById.has(id) || !!geo?.byId.has(id))
  const active = overlays.find((o) => o.id === activeId) ?? null
  const scale = active?.scale ?? 1
  /* "Move over": the entity selected last. */
  const target = copyable.length > 0 ? copyable[copyable.length - 1] : null

  const update = (patch: Partial<Omit<MapOverlay, 'id' | 'sourceId'>>) => {
    if (active) dispatch({ op: 'update_overlay', id: active.id, patch })
  }

  const moveOver = (id: string) => {
    if (!geo) return
    const merge = mergeById.get(id)
    const geometry = merge ? mergeCountries(geo, merge.members) : geo.byId.get(id)?.geometry
    const centre = landCentre(geometry)
    if (centre) update({ anchor: centre })
  }

  return (
    <div className="stack">
      <button
        type="button"
        className="btn btn--on"
        disabled={copyable.length === 0}
        onClick={() => {
          createFromSelection()
          playSfx('confirm')
        }}
      >
        {copyable.length === 1
          ? `Create overlay of ${nameOf(copyable[0])}`
          : copyable.length > 1
            ? `Create ${copyable.length} overlays`
            : 'Create overlay'}
      </button>
      <p className="hint">
        {overlays.length === 0
          ? `Select a ${noun.one} on the map, then make an overlay of it and drag it anywhere.`
          : 'Drag an overlay on the map to move it; tap one to choose it.'}
      </p>

      {overlays.length > 0 && (
        <ul className="overlay-list" aria-label="Overlays">
          {overlays.map((overlay) => {
            const on = overlay.id === activeId
            return (
              <li key={overlay.id} className={`overlay-row${on ? ' overlay-row--on' : ''}`}>
                <button
                  type="button"
                  className="overlay-row__pick"
                  aria-pressed={on}
                  onClick={() => {
                    setActive(on ? null : overlay.id)
                    playSfx('click')
                  }}
                >
                  <span className="overlay-row__swatch" style={{ background: overlay.color }} aria-hidden="true" />
                  <span className="overlay-row__name">{overlay.name}</span>
                  <span className="overlay-row__mode">{overlay.mode === 'shape' ? 'Shape' : 'Projection'}</span>
                </button>
                <button
                  type="button"
                  className="overlay-row__drop"
                  aria-label={`Delete the overlay of ${overlay.name}`}
                  title="Delete overlay"
                  onClick={() => {
                    deleteOverlay(overlay.id)
                    playSfx('click')
                  }}
                >
                  ×
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {active && (
        <div className="stack">
          <div className="mode-switch mode-switch--pair" role="group" aria-label="Overlay mode">
            {MODES.map(([id, label, help]) => (
              <button
                key={id}
                type="button"
                className={`chip${active.mode === id ? ' chip--active' : ''}`}
                aria-pressed={active.mode === id}
                title={help}
                onClick={() => {
                  update({ mode: id })
                  playSfx('click')
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="hint">{MODES.find(([id]) => id === active.mode)?.[2]}</p>

          {/*
            Its size, against the entity's own: scaled about its centre, so it grows and shrinks
            where it is, and independent of everything else here.
          */}
          <label className="field">
            <span className="field__row">
              <span className="field__label">Size</span>
              <span className="field__value">{Math.round(scale * 100)}%</span>
            </span>
            <input
              className="slider"
              type="range"
              min={SIZE_MIN}
              max={SIZE_MAX}
              step={0.01}
              value={Math.log2(scale)}
              aria-label="Size"
              aria-valuetext={`${Math.round(scale * 100)} percent of its real size`}
              onChange={(event) => update({ scale: scaleAt(Number(event.target.value)) })}
            />
          </label>

          <div className="swatches">
            <label className="swatch">
              <input type="color" value={active.color} onChange={(event) => update({ color: event.target.value })} />
              <span>Colour</span>
            </label>
          </div>

          <label className="field">
            <span className="field__row">
              <span className="field__label">Opacity</span>
              <span className="field__value">{Math.round(active.opacity * 100)}%</span>
            </span>
            <input
              className="slider"
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={active.opacity}
              aria-label="Opacity"
              aria-valuetext={`${Math.round(active.opacity * 100)} percent`}
              onChange={(event) => update({ opacity: Number(event.target.value) })}
            />
          </label>

          <SelectField label="Texture" value={active.texture} onChange={(value) => update({ texture: value as OverlayTexture })}>
            {TEXTURES.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </SelectField>

          <p className="hint">
            {active.anchor ? `Centred on ${formatLonLat(active.anchor)}.` : `Over ${nameOf(active.sourceId)}, where it started.`}
          </p>
          <div className="overlay-actions">
            <button
              type="button"
              className="btn"
              disabled={!active.anchor}
              onClick={() => {
                update({ anchor: null })
                playSfx('click')
              }}
            >
              Reset position
            </button>
            <button
              type="button"
              className="btn"
              disabled={scale === 1}
              onClick={() => {
                update({ scale: 1 })
                playSfx('click')
              }}
            >
              Reset size
            </button>
          </div>
          <button
            type="button"
            className="btn"
            disabled={!target}
            title={target ? `Centre the overlay on ${nameOf(target)}` : `Select a ${noun.one} to move the overlay over it`}
            onClick={() => {
              if (target) moveOver(target)
              playSfx('click')
            }}
          >
            {target ? `Move over ${nameOf(target)}` : 'Move over selection'}
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              deleteOverlay(active.id)
              playSfx('click')
            }}
          >
            Delete overlay
          </button>
        </div>
      )}
    </div>
  )
}
