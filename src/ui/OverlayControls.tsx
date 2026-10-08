/**
 * Map Overlays: movable copies of an entity's shape, for comparing one place with another.
 *
 * Select a country or a region on the map and make an overlay of it, then drag the overlay
 * anywhere. Each overlay is its own thing — chosen from the list or by tapping it on the map,
 * with its own mode, size, colour, opacity and texture — and none of them changes the map
 * beneath: an overlay copies a shape and never takes it.
 *
 * One panel: the list, and under it everything about the chosen overlay — how it looks, its
 * size, its display mode — shown as soon as one is chosen, with nothing to unfold. A right-click
 * on an overlay on the map offers the quick ones there (see `OverlayMenu`).
 */
import { useEffect, useMemo, useState } from 'react'
import { useMapStore } from '../state/mapStore'
import { SelectField } from './Select'
import { useNoun } from '../maps/useNoun'
import { mergeCountries } from '../geo/merge'
import { landCentre } from '../render/overlayGeometry'
import { overlayBeside } from '../render/MapOverlays'
import { clampOverlayScale, overlayScaleAt, OVERLAY_SIZE_MIN, OVERLAY_SIZE_MAX } from '../render/overlayScale'
import { OVERLAY_SCALE_RANGE, type MapOverlay, type OverlayTexture } from '../types/map'
import { OVERLAY_MODES, OVERLAY_TEXTURES, texturePatch } from './overlayChoices'
import { FlagPicker } from './FlagPicker'
import { flagName, flagOptions } from '../flags/flagChoices'

const NO_OVERLAYS: MapOverlay[] = []

const MODES = OVERLAY_MODES
const TEXTURES = OVERLAY_TEXTURES

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
  const flags = useMemo(() => flagOptions(geo?.meta ?? {}), [geo])
  /* A flag has to be chosen now: the texture became Flag for an entity that flies none. */
  const [askFlag, setAskFlag] = useState(false)
  useEffect(() => setAskFlag(false), [activeId])

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
  const scale = clampOverlayScale(active?.scale ?? 1)
  const [scaleInput, setScaleInput] = useState(String(scale))
  useEffect(() => setScaleInput(String(scale)), [activeId, scale])
  const percent = (scale * 100).toLocaleString(undefined, { maximumFractionDigits: 3 })
  /* "Move over": the entity selected last. */
  const target = copyable.length > 0 ? copyable[copyable.length - 1] : null

  const update = (patch: Partial<Omit<MapOverlay, 'id' | 'sourceId' | 'members'>>) => {
    if (active) dispatch({ op: 'update_overlay', id: active.id, patch })
  }

  const moveOver = (id: string) => {
    if (!geo) return
    const merge = mergeById.get(id)
    const geometry = merge ? mergeCountries(geo, merge.members) : geo.byId.get(id)?.geometry
    const centre = landCentre(geometry)
    if (centre) update({ anchor: centre })
  }

  /*
   * Four subsections, in the order the work goes: make and choose an overlay, then how it looks,
   * then where it is and how big, then how it is projected. The controls are the ones that were
   * here, with the same handlers — only grouped. The three about the chosen overlay appear once
   * one is chosen, as they always did.
   */
  return (
    <div className="stack">
      <div className="stack">
        {copyable.length > 1 ? (
          <>
            {/*
              Several selected: one object that moves and sizes as a whole, with the borders
              between them kept — or a copy of each, moved on its own.
            */}
            <button type="button" className="btn btn--on" onClick={() => createFromSelection(true)}>
              Copy {copyable.length} {noun.many} as one group
            </button>
            <button type="button" className="btn" onClick={() => createFromSelection(false)}>
              Copy each separately ({copyable.length} overlays)
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn--on"
            disabled={copyable.length === 0}
            onClick={() => {
              createFromSelection()
            }}
          >
            {copyable.length === 1 ? `Create overlay of ${nameOf(copyable[0])}` : 'Create overlay'}
          </button>
        )}
        <p className="hint">
          {overlays.length === 0
            ? `Select ${noun.many} on the map, then copy them and drag the copy anywhere — into the sea, too. A copy's edge is coastline, and a group keeps the borders between its ${noun.many}; both follow the map's Coastlines and Borders switches.`
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
                    }}
                  >
                    ×
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {active && (
        <div className="stack overlay-editor">
          <div className="overlay-editor__head">
            <span className="sidebar__group-label">{active.name}</span>
            <span className="overlay-editor__actions">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => useMapStore.getState().duplicateOverlay(active.id, overlayBeside(active.id))}
                title="A copy of this overlay, put down beside it"
              >
                Duplicate
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => deleteOverlay(active.id)}>
                Delete
              </button>
            </span>
          </div>
          <div className="stack">
            <span className="sidebar__group-label">Appearance</span>
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

            <SelectField
              label="Texture"
              value={active.texture}
              onChange={(value) => {
                // Flag takes the flag the entity flies now, once; without one, the picker below opens to choose.
                const { patch, needsFlag } = texturePatch(active, value as OverlayTexture)
                update(patch)
                setAskFlag(needsFlag)
              }}
            >
              {TEXTURES.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </SelectField>
            {active.texture === 'flag' && (
              <>
                <FlagPicker
                  label="Overlay flag"
                  value={active.flag ?? null}
                  options={flags}
                  autoOpen={askFlag && !active.flag}
                  onChange={(flag) => {
                    update({ flag })
                    setAskFlag(false)
                  }}
                />
                <p className="hint">
                  {active.flag
                    ? `Filled with the flag of ${flagName(active.flag, flags)}. It keeps this flag whatever ${nameOf(active.sourceId)} flies later.`
                    : `${nameOf(active.sourceId)} flies no flag yet — choose one to fill the overlay.`}
                </p>
              </>
            )}
          </div>

          <div className="stack">
            <span className="sidebar__group-label">Size and place</span>
            {/*
              Its size, against the entity's own: scaled about its centre, so it grows and shrinks
              where it is, and independent of everything else here.
            */}
            <label className="field">
              <span className="field__row">
                <span className="field__label">Size</span>
                <span className="field__value">{percent}%</span>
              </span>
              <input
                className="slider"
                type="range"
                min={OVERLAY_SIZE_MIN}
                max={OVERLAY_SIZE_MAX}
                step={0.01}
                value={Math.log2(scale)}
                aria-label="Size"
                aria-valuetext={`${percent} percent of its real size`}
                onChange={(event) => update({ scale: overlayScaleAt(Number(event.target.value)) })}
              />
            </label>

            <label className="field">
              <span className="field__label">Scale multiplier</span>
              <input
                type="number"
                aria-label="Scale multiplier"
                min={OVERLAY_SCALE_RANGE.min}
                max={OVERLAY_SCALE_RANGE.max}
                step="any"
                value={scaleInput}
                onChange={(event) => setScaleInput(event.target.value)}
                onBlur={() => {
                  const value = Number(scaleInput)
                  const next = scaleInput.trim() && Number.isFinite(value) && value > 0
                    ? clampOverlayScale(value) : scale
                  setScaleInput(String(next))
                  if (next !== scale) update({ scale: next })
                }}
                onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
              />
              <span className="hint">0.001×–1000× the original size.</span>
            </label>

            <div className="overlay-actions">
              <button
                type="button"
                className="btn"
                disabled={scale === 1}
                onClick={() => {
                  update({ scale: 1 })
                }}
              >
                Reset scale
              </button>
            </div>
            <button
              type="button"
              className="btn"
              disabled={!target}
              title={target ? `Centre the overlay on ${nameOf(target)}` : `Select a ${noun.one} to move the overlay over it`}
              onClick={() => {
                if (target) moveOver(target)
              }}
            >
              {target ? `Move over ${nameOf(target)}` : 'Move over selection'}
            </button>
          </div>

          <div className="stack">
            <span className="sidebar__group-label">Display mode</span>
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
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="hint">{MODES.find(([id]) => id === active.mode)?.[2]}</p>
          </div>
          <p className="hint">Right-click an overlay on the map to delete, duplicate or change it there.</p>
        </div>
      )}
    </div>
  )
}
