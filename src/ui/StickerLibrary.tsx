/**
 * The Library: every sticker in one place — the author's own (uploads, emoji added from Emoji,
 * faces made in Create) and the gallery of ready-made faces, in the colour picked above them.
 *
 * Pick a sticker, then put it on the selected territories, take it off, add it to the tiers, or —
 * for a face — open it in the face maker. A gallery face is named by its preset and colour
 * (`face:<preset>:<colour>`, see `stickerLibrary.ts`), so picking or placing one stores nothing.
 *
 * **Changing the colour recolours the picked face where it is being worked on**: every selected
 * territory wearing that face, in any colour, gets it in the new one — one operation, one undo
 * step — and the rest of the map, the tiers and the other faces are left alone.
 *
 * The grid shows pictures, not live drawings: each thumbnail is drawn once, as it scrolls into
 * view (`LazyThumb`, `stickers/thumbnails.ts`), so a long grid scrolls smoothly.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useMapStore } from '../state/mapStore'
import { stickersOf } from '../state/stickers'
import { FACE_COLORS, faceDataUri } from '../stickers/faceMaker'
import { FACE_PRESETS, presetFace } from '../stickers/facePresets'
import {
  colourName,
  faceStickerId,
  parseFaceSticker,
  saveLadder,
  stickerFromFile,
  stickerIndex,
  useStickerLibrary,
} from '../stickers/stickerLibrary'
import type { Sticker } from '../stickers/types'
import type { CountryId } from '../types/map'
import { StickerColorRow } from './StickerColorRow'
import { LazyThumb } from './LazyThumb'
import { useSelectionStickers } from './useSelectionStickers'
import { useNoun } from '../maps/useNoun'

/** `value`, once it has stopped changing for `ms` — so dragging the colour picker redraws once. */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), ms)
    return () => window.clearTimeout(timer)
  }, [value, ms])
  return settled
}

/** Whether `stickerId` is the face `presetId`, in any colour — including the older stored copies. */
const isFace = (stickerId: string | null | undefined, presetId: string) =>
  !!stickerId && (parseFaceSticker(stickerId)?.preset.id === presetId || stickerId.startsWith(`user:face-${presetId}-`))

export function StickerLibrary() {
  const [color, setColor] = useState(FACE_COLORS[0].color)
  const [query, setQuery] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const { uploads, add, remove, pickedId, pick, setFace } = useStickerLibrary()
  const doc = useMapStore((s) => s.doc)
  const dispatch = useMapStore((s) => s.dispatch)
  const onSelection = useSelectionStickers()
  const noun = useNoun()
  const mode = stickersOf(doc)
  const gridColor = useSettled(color.toLowerCase(), 150)

  const index = useMemo(() => stickerIndex(uploads), [uploads])
  const picked = pickedId ? index.get(pickedId) : undefined
  const pickedFace = pickedId ? parseFaceSticker(pickedId) : null
  const isUpload = !!picked && uploads.some((s) => s.id === picked.id)

  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const matches = (name: string) => words.every((w) => name.toLowerCase().includes(w))
  // The author's own stickers. Faces the old gallery stored as copies are drawn from their ids now.
  const mine = uploads.filter((s) => !s.id.startsWith('user:face-') && matches(s.name))
  const faces = useMemo(() => FACE_PRESETS.filter((p) => matches(p.name)), [query]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- colour: the grid, and the picked face where it is being worked on ---- */
  const recolourTimer = useRef<number | null>(null)
  useEffect(() => () => {
    if (recolourTimer.current) window.clearTimeout(recolourTimer.current)
  }, [])

  const changeColour = (next: string) => {
    setColor(next)
    if (!pickedFace) return
    const id = faceStickerId(pickedFace.preset.id, next)
    pick(id)
    // Once the colour settles: the selected territories wearing this face take the new colour.
    if (recolourTimer.current) window.clearTimeout(recolourTimer.current)
    recolourTimer.current = window.setTimeout(() => {
      const { doc: now, selectedCountryIds } = useMapStore.getState()
      const overrides = stickersOf(now).overrides
      const wearing = selectedCountryIds.filter((cid: CountryId) => isFace(overrides[cid], pickedFace.preset.id) && overrides[cid] !== id)
      if (wearing.length === 0) return
      dispatch({ op: 'assign_sticker', countryIds: wearing, stickerId: id })
      setMessage(`Recoloured on ${wearing.length === 1 ? onSelection.label : `${wearing.length} ${noun.many}`}.`)
    }, 150)
  }

  /* ---- picking ---- */
  const choose = (id: string) => {
    pick(pickedId === id ? null : id)
    setMessage(null)
  }

  /* ---- actions ---- */
  const putOn = () => {
    if (!picked) return
    onSelection.putOn(picked.id)
    setMessage(`Put on ${onSelection.label}.`)
  }
  const takeOff = () => {
    onSelection.remove()
    setMessage(`Removed from ${onSelection.label}.`)
  }
  const addToTiers = () => {
    if (!picked) return
    const ladder = [...mode.ladder, picked.id]
    dispatch({ op: 'set_stickers', patch: { ladder, enabled: true } })
    saveLadder(ladder)
    setMessage(`Added to the tiers as tier ${ladder.length}.`)
  }
  const edit = () => {
    if (!pickedFace) return
    setFace(presetFace(pickedFace.preset, pickedFace.color))
    setMessage('Opened in Create → Face maker.')
  }
  const deletePicked = () => {
    if (!picked || !isUpload) return
    const ladder = mode.ladder.filter((id) => id !== picked.id)
    if (ladder.length !== mode.ladder.length) {
      dispatch({ op: 'set_stickers', patch: { ladder } })
      saveLadder(ladder)
    }
    remove(picked.id)
    pick(null)
  }

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setBusy(true)
    setMessage(null)
    const made: Sticker[] = []
    const failed: string[] = []
    for (const file of Array.from(files)) {
      try {
        made.push(await stickerFromFile(file))
      } catch {
        failed.push(file.name)
      }
    }
    if (made.length > 0) {
      const stored = add(made)
      pick(made[made.length - 1].id)
      setMessage(
        stored
          ? `Added ${made.length} sticker${made.length === 1 ? '' : 's'}.`
          : 'Added, but this browser is out of storage space, so they will be gone after a refresh. Delete some uploads to make room.',
      )
    }
    if (failed.length > 0) setMessage(`Could not read ${failed.join(', ')}.`)
    setBusy(false)
    if (fileInput.current) fileInput.current.value = ''
  }

  const handPlaced = onSelection.selected.filter((id) => id in mode.overrides)

  return (
    <div className="stack">
      <div className="stack sticker-parts">
        <span className="sidebar__group-label">Colour</span>
        <StickerColorRow value={color} onChange={(next) => next && changeColour(next)} />
      </div>
      <input
        className="input"
        type="search"
        placeholder={`Search ${FACE_PRESETS.length + mine.length} stickers: angry, love, cool…`}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        aria-label="Search stickers"
      />

      <div className="sticker-grid sticker-grid--gallery" role="listbox" aria-label="Library">
        {mine.length > 0 && <span className="sticker-grid__heading">Yours</span>}
        {mine.map((sticker) => (
          <button
            key={sticker.id}
            type="button"
            role="option"
            aria-selected={pickedId === sticker.id}
            className={`sticker-grid__item${pickedId === sticker.id ? ' sticker-grid__item--picked' : ''}`}
            title={sticker.name}
            onClick={() => choose(sticker.id)}
          >
            <LazyThumb thumbKey={`${sticker.id}|${sticker.src.length}`} make={() => sticker.src} alt={sticker.name} />
          </button>
        ))}
        {mine.length > 0 && faces.length > 0 && <span className="sticker-grid__heading">Faces</span>}
        {faces.map((preset) => {
          const on = pickedFace?.preset.id === preset.id
          return (
            <button
              key={preset.id}
              type="button"
              role="option"
              aria-selected={on}
              className={`sticker-grid__item${on ? ' sticker-grid__item--picked' : ''}`}
              title={preset.name}
              onClick={() => choose(faceStickerId(preset.id, color))}
            >
              <LazyThumb thumbKey={`${preset.id}|${gridColor}`} make={() => faceDataUri(presetFace(preset, gridColor))} alt={preset.name} />
            </button>
          )
        })}
      </div>
      {faces.length === 0 && mine.length === 0 && <p className="hint">Nothing is called that.</p>}

      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        multiple
        hidden
        onChange={(event) => void upload(event.target.files)}
      />
      <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => fileInput.current?.click()}>
        {busy ? 'Adding…' : 'Upload images…'}
      </button>

      <div className="stack sticker-gallery__actions">
        {picked ? (
          <p className="hint">
            <strong>{pickedFace ? pickedFace.preset.name : picked.name}</strong>
            {pickedFace ? ` in ${colourName(pickedFace.color).toLowerCase()}` : ''}
          </p>
        ) : (
          <p className="hint">Pick a sticker. Select {noun.many} on the map first to put it straight on them.</p>
        )}
        {onSelection.selected.length > 0 && (
          <>
            {picked && (
              <button type="button" className="btn btn--on" onClick={putOn}>
                Put on {onSelection.label}
              </button>
            )}
            <button
              type="button"
              className="btn"
              disabled={!onSelection.canRemove}
              title={`Take the sticker off ${onSelection.label}`}
              onClick={takeOff}
            >
              Remove
            </button>
          </>
        )}
        {picked && (
          <div className="mode-switch mode-switch--pair">
            <button type="button" className="btn" onClick={addToTiers}>
              Add to tiers
            </button>
            {pickedFace ? (
              <button type="button" className="btn" onClick={edit}>
                Edit in face maker
              </button>
            ) : isUpload ? (
              <button type="button" className="btn btn--ghost" onClick={deletePicked}>
                Delete
              </button>
            ) : null}
          </div>
        )}
        {handPlaced.length > 0 && (
          <button
            type="button"
            className="btn btn--ghost"
            title="Let the data choose again"
            onClick={() => dispatch({ op: 'clear_sticker', countryIds: handPlaced })}
          >
            Back to data
          </button>
        )}
        {message && <p className="hint">{message}</p>}
      </div>
      <p className="hint">
        Uploads are saved in this browser for every map, shrunk to 256 px, which is plenty for a sticker.
      </p>
    </div>
  )
}
