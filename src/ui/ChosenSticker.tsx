/**
 * The top of the Stickers panel: the one colour row, and the size of the stickers on the selected
 * territories.
 *
 * **The colour row changes only the stickers on the selected territories** — the ones on the map —
 * and the colour new stickers are put on in. It never recolours the Library: the grid keeps its
 * own colours. A face is recoloured by naming it in the new colour, or in the country's flag; any
 * other picture by shifting its hue (`recolorSticker`), kept for the session like an emoji, and
 * left as it is for the flag.
 *
 * Every change is one edit, one undo step: a new colour is a sticker put on each of those
 * territories by hand (`assign_sticker`), a size their own multiplier (`size_sticker`).
 */
import { useMemo, useState } from 'react'
import { useMapStore } from '../state/mapStore'
import { resolveStickers, stickersOf } from '../state/stickers'
import type { MapOperation } from '../state/operations'
import { colourName, faceOf, faceStickerId, newId, stickerIndex, useStickerLibrary } from '../stickers/stickerLibrary'
import { recolorSticker } from '../stickers/recolor'
import { STICKER_SIZE, type CountryId } from '../types/map'
import { StickerColorRow } from './StickerColorRow'
import { useNoun } from '../maps/useNoun'

export function ChosenSticker() {
  const selected = useMapStore((s) => s.selectedCountryIds)
  const doc = useMapStore((s) => s.doc)
  const geo = useMapStore((s) => s.geo)
  const dispatch = useMapStore((s) => s.dispatch)
  const { uploads, add, colour, setColour } = useStickerLibrary()
  const noun = useNoun()
  const [busy, setBusy] = useState(false)
  const index = useMemo(() => stickerIndex(uploads), [uploads])
  const wearing = useMemo(() => resolveStickers(doc), [doc])

  // The selected territories that wear a sticker: what the colour and the size change.
  const ids = selected.filter((id) => wearing.has(id))
  const items = ids.map((id) => {
    const stickerId = wearing.get(id)!
    return { id, sticker: index.get(stickerId), face: faceOf(stickerId) }
  })
  const mode = stickersOf(doc)
  const sizes = ids.map((id) => mode.sizes?.[id] ?? 1)
  const own = sizes[0] ?? 1
  const percent = Math.round(own * 100)
  const nameOf = (id: CountryId) => doc.merges.find((m) => m.id === id)?.name ?? geo?.meta[id]?.name ?? id
  const label = ids.length === 1 ? nameOf(ids[0]) : `${ids.length} ${noun.many}`

  const recolour = async (next: string) => {
    setColour(next)
    if (busy || items.length === 0) return
    setBusy(true)
    try {
      const byId = new Map<string, CountryId[]>()
      const put = (id: CountryId, stickerId: string) => byId.set(stickerId, [...(byId.get(stickerId) ?? []), id])
      for (const item of items) {
        if (item.face) put(item.id, faceStickerId(item.face.preset.id, next))
        else if (next !== 'flag' && item.sticker) {
          try {
            const src = await recolorSticker(item.sticker.src, next)
            const made = { id: newId(), name: `${item.sticker.name} (${colourName(next)})`, src }
            add([made], false)
            put(item.id, made.id)
          } catch {
            // A picture that cannot be read keeps its colour.
          }
        }
      }
      if (byId.size > 0) dispatch([...byId].map(([stickerId, countryIds]): MapOperation => ({ op: 'assign_sticker', countryIds, stickerId })))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack chosen-sticker">
      <div className="stack sticker-parts">
        <span className="sidebar__group-label">Colour</span>
        <StickerColorRow value={colour} onChange={(next) => next && void recolour(next)} allowFlag />
      </div>
      <p className="hint">
        {ids.length > 0
          ? `Changes the sticker${ids.length === 1 ? '' : 's'} on ${label} only — and the colour new stickers go on in.`
          : selected.length > 0
            ? 'Tap a sticker below to put it on the selection; tap it again to take it off.'
            : `Select ${noun.many} on the map, then tap a sticker below to put it on them; tap it again to take it off.`}
      </p>

      {ids.length > 0 && (
        <>
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
          <button
            type="button"
            className="btn btn--ghost"
            disabled={sizes.every((s) => s === 1)}
            onClick={() => dispatch({ op: 'size_sticker', countryIds: ids, size: null })}
          >
            Usual size
          </button>
        </>
      )}
    </div>
  )
}
