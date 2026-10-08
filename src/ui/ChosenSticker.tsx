/**
 * The sticker clicked on the map, at the top of the Stickers panel: that one sticker's colour and
 * size, and — by picking any sticker in the Library or Emoji below — its picture.
 *
 * Every change is to that territory alone, as an operation: a new colour or picture is a sticker
 * put on it by hand (`assign_sticker`), its size its own multiplier (`size_sticker`). A face —
 * from the Library, a built-in tier, or an older stored copy — is recoloured by naming it in the
 * new colour; any other picture is recoloured by shifting its hue (`recolorSticker`), kept for the
 * session like an emoji.
 */
import { useEffect, useMemo, useState } from 'react'
import { useMapStore } from '../state/mapStore'
import { resolveStickers, stickersOf } from '../state/stickers'
import { colourName, faceOf, faceStickerId, newId, stickerIndex, useStickerLibrary } from '../stickers/stickerLibrary'
import { recolorSticker } from '../stickers/recolor'
import { STICKER_SIZE } from '../types/map'
import { StickerColorRow } from './StickerColorRow'

export function ChosenSticker() {
  const id = useMapStore((s) => s.activeStickerId)
  const doc = useMapStore((s) => s.doc)
  const geo = useMapStore((s) => s.geo)
  const dispatch = useMapStore((s) => s.dispatch)
  const setActive = useMapStore((s) => s.setActiveSticker)
  const { uploads, add } = useStickerLibrary()
  const [busy, setBusy] = useState(false)
  const index = useMemo(() => stickerIndex(uploads), [uploads])
  const wearing = useMemo(() => resolveStickers(doc), [doc])
  const stickerId = id ? wearing.get(id) : undefined

  // The sticker went — removed, undone, its territory hidden: nothing is chosen any more.
  useEffect(() => {
    if (id && !stickerId) setActive(null)
  }, [id, stickerId, setActive])

  if (!id || !stickerId) return null
  const sticker = index.get(stickerId)
  const face = faceOf(stickerId)
  const mode = stickersOf(doc)
  const own = mode.sizes?.[id] ?? 1
  const percent = Math.round(own * 100)
  const place = doc.merges.find((m) => m.id === id)?.name ?? geo?.meta[id]?.name ?? id
  const put = (next: string) => dispatch({ op: 'assign_sticker', countryIds: [id], stickerId: next })

  const recolour = async (color: string) => {
    if (face) {
      put(faceStickerId(face.preset.id, color))
      return
    }
    if (!sticker || busy) return
    setBusy(true)
    try {
      const src = await recolorSticker(sticker.src, color)
      const made = { id: newId(), name: `${sticker.name} (${colourName(color)})`, src }
      add([made], false)
      put(made.id)
    } catch {
      // A picture that cannot be read keeps its colour.
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack chosen-sticker">
      <div className="chosen-sticker__head">
        {sticker && <img className="sticker-thumb" src={sticker.src} alt="" width={40} height={40} draggable={false} />}
        <span className="chosen-sticker__text">
          <strong>{face ? face.preset.name : (sticker?.name ?? 'Sticker')}</strong>
          <span className="hint">on {place}</span>
        </span>
        <button type="button" className="btn btn--ghost" onClick={() => setActive(null)}>
          Done
        </button>
      </div>

      <div className="stack sticker-parts">
        <span className="sidebar__group-label">Colour</span>
        <StickerColorRow value={face?.color ?? null} onChange={(color) => color && void recolour(color)} />
      </div>

      <label className="field">
        <span className="field__row">
          <span className="field__label">Size</span>
          <span className="field__value">{percent}%</span>
        </span>
        <input
          className="slider"
          type="range"
          min={STICKER_SIZE.min}
          max={STICKER_SIZE.max}
          step={STICKER_SIZE.step}
          value={own}
          aria-label={`Size of the sticker on ${place}`}
          aria-valuetext={`${percent} percent`}
          onChange={(event) => dispatch({ op: 'size_sticker', countryIds: [id], size: Number(event.target.value) })}
        />
      </label>

      <div className="mode-switch mode-switch--pair">
        <button type="button" className="btn" disabled={own === 1} onClick={() => dispatch({ op: 'size_sticker', countryIds: [id], size: null })}>
          Usual size
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => {
            // Taken off: a data sticker is hidden, a hand-placed one cleared — as Remove does.
            const fromData = resolveStickers({ ...doc, stickers: { ...mode, overrides: {} } }).has(id)
            dispatch(fromData ? { op: 'assign_sticker', countryIds: [id], stickerId: null } : { op: 'clear_sticker', countryIds: [id] })
            setActive(null)
          }}
        >
          Remove
        </button>
      </div>
      <p className="hint">Pick any sticker below to swap this one for it.</p>
    </div>
  )
}
