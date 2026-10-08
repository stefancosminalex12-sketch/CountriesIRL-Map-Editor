/**
 * The stickers clicked on the map, at the top of the Stickers panel: their colour, their size and —
 * by picking any sticker in the Library or Emoji below — their picture, for all of them at once.
 *
 * Only the chosen stickers change. Every change is one edit, one undo step: a new colour or picture
 * is a sticker put on each of those territories by hand (`assign_sticker`), a size their own
 * multiplier (`size_sticker`). A face — from the Library, a built-in tier, or an older stored copy —
 * is recoloured by naming it in the new colour, or in the country's flag; any other picture by
 * shifting its hue (`recolorSticker`), kept for the session like an emoji, and left as it is for
 * the flag.
 */
import { useEffect, useMemo, useState } from 'react'
import { useMapStore } from '../state/mapStore'
import { resolveStickers, stickersOf } from '../state/stickers'
import type { MapOperation } from '../state/operations'
import { colourName, faceOf, faceStickerId, newId, stickerIndex, useStickerLibrary } from '../stickers/stickerLibrary'
import { recolorSticker } from '../stickers/recolor'
import { STICKER_SIZE, type CountryId } from '../types/map'
import { StickerColorRow } from './StickerColorRow'
import { useNoun } from '../maps/useNoun'

export function ChosenSticker() {
  const chosen = useMapStore((s) => s.activeStickerIds)
  const doc = useMapStore((s) => s.doc)
  const geo = useMapStore((s) => s.geo)
  const dispatch = useMapStore((s) => s.dispatch)
  const setChosen = useMapStore((s) => s.setActiveStickers)
  const { uploads, add } = useStickerLibrary()
  const noun = useNoun()
  const [busy, setBusy] = useState(false)
  const index = useMemo(() => stickerIndex(uploads), [uploads])
  const wearing = useMemo(() => resolveStickers(doc), [doc])
  // Those still wearing a sticker: one removed, undone or hidden drops out of the choice.
  const ids = chosen.filter((id) => wearing.has(id))

  useEffect(() => {
    if (ids.length !== chosen.length) setChosen(ids)
  }, [ids, chosen, setChosen])

  if (ids.length === 0) return null
  const mode = stickersOf(doc)
  const items = ids.map((id) => {
    const stickerId = wearing.get(id)!
    return { id, stickerId, sticker: index.get(stickerId), face: faceOf(stickerId) }
  })
  const colours = new Set(items.map((item) => item.face?.color ?? null))
  const shownColour = colours.size === 1 ? [...colours][0] : null
  const anyFace = items.some((item) => item.face)
  const sizes = ids.map((id) => mode.sizes?.[id] ?? 1)
  const own = sizes[0]
  const percent = Math.round(own * 100)
  const nameOf = (id: CountryId) => doc.merges.find((m) => m.id === id)?.name ?? geo?.meta[id]?.name ?? id
  const label = ids.length === 1 ? nameOf(ids[0]) : `${ids.length} ${noun.many}`

  /** One `assign_sticker` per new sticker, every territory that takes it in it: one edit. */
  const assign = (next: Array<[CountryId, string]>) => {
    const byId = new Map<string, CountryId[]>()
    for (const [id, stickerId] of next) byId.set(stickerId, [...(byId.get(stickerId) ?? []), id])
    if (byId.size > 0) dispatch([...byId].map(([stickerId, countryIds]): MapOperation => ({ op: 'assign_sticker', countryIds, stickerId })))
  }

  const recolour = async (color: string) => {
    if (busy) return
    setBusy(true)
    try {
      const next: Array<[CountryId, string]> = []
      for (const item of items) {
        if (item.face) next.push([item.id, faceStickerId(item.face.preset.id, color)])
        else if (color !== 'flag' && item.sticker) {
          try {
            const src = await recolorSticker(item.sticker.src, color)
            const made = { id: newId(), name: `${item.sticker.name} (${colourName(color)})`, src }
            add([made], false)
            next.push([item.id, made.id])
          } catch {
            // A picture that cannot be read keeps its colour.
          }
        }
      }
      assign(next)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack chosen-sticker">
      <div className="chosen-sticker__head">
        <span className="chosen-sticker__thumbs">
          {items.slice(0, 5).map((item) =>
            item.sticker ? (
              <img key={item.id} className="sticker-thumb" src={item.sticker.src} alt="" width={32} height={32} draggable={false} />
            ) : null,
          )}
        </span>
        <span className="chosen-sticker__text">
          <strong>{ids.length === 1 ? (items[0].face?.preset.name ?? items[0].sticker?.name ?? 'Sticker') : `${ids.length} stickers`}</strong>
          <span className="hint">on {label}</span>
        </span>
        <button type="button" className="btn btn--ghost" onClick={() => setChosen([])}>
          Done
        </button>
      </div>

      <div className="stack sticker-parts">
        <span className="sidebar__group-label">Colour</span>
        <StickerColorRow value={shownColour} onChange={(color) => color && void recolour(color)} allowFlag={anyFace} />
      </div>

      <label className="field">
        <span className="field__row">
          <span className="field__label">Size</span>
          <span className="field__value">{sizes.every((s) => s === own) ? `${percent}%` : 'mixed'}</span>
        </span>
        <input
          className="slider"
          type="range"
          min={STICKER_SIZE.min}
          max={STICKER_SIZE.max}
          step={STICKER_SIZE.step}
          value={own}
          aria-label={`Size of the stickers on ${label}`}
          aria-valuetext={`${percent} percent`}
          onChange={(event) => dispatch({ op: 'size_sticker', countryIds: ids, size: Number(event.target.value) })}
        />
      </label>

      <div className="mode-switch mode-switch--pair">
        <button
          type="button"
          className="btn"
          disabled={sizes.every((s) => s === 1)}
          onClick={() => dispatch({ op: 'size_sticker', countryIds: ids, size: null })}
        >
          Usual size
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => {
            // Taken off: a data sticker is hidden, a hand-placed one cleared — as Remove does.
            const fromData = resolveStickers({ ...doc, stickers: { ...mode, overrides: {} } })
            const hide = ids.filter((id) => fromData.has(id))
            const clear = ids.filter((id) => !fromData.has(id))
            const ops: MapOperation[] = []
            if (hide.length > 0) ops.push({ op: 'assign_sticker', countryIds: hide, stickerId: null })
            if (clear.length > 0) ops.push({ op: 'clear_sticker', countryIds: clear })
            dispatch(ops)
            setChosen([])
          }}
        >
          Remove
        </button>
      </div>
      <p className="hint">
        Changes apply to the chosen sticker{ids.length === 1 ? '' : 's'} only. Click more stickers on the map to add them, or
        click one again to drop it. Pick any sticker below to change their type.
      </p>
    </div>
  )
}
