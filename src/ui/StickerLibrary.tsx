/**
 * The Library: every sticker in one place — the author's own (uploads and faces made in Create)
 * and the gallery of ready-made faces.
 *
 * **Tap a sticker to put it on the selected territories; tap it again to take it off**
 * (`tapSticker`). No Put on or Remove button. A face goes on in the panel's colour (the one colour
 * row, at the top of the panel) — the grid itself never changes colour. A gallery face is named by
 * its preset and colour (`face:<preset>:<colour>`, see `stickerLibrary.ts`), so placing one stores
 * nothing. A tile is ticked while every selected territory wears it.
 *
 * The grid shows pictures, not live drawings: each thumbnail is drawn once, as it scrolls into
 * view (`LazyThumb`, `stickers/thumbnails.ts`), so a long grid scrolls smoothly.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useMapStore } from '../state/mapStore'
import { resolveStickers, stickersOf } from '../state/stickers'
import { FACE_COLORS, faceDataUri } from '../stickers/faceMaker'
import { FACE_PRESETS, presetFace } from '../stickers/facePresets'
import { faceStickerId, isOwnSticker, parseFaceSticker, saveLadder, stickerFromFile, stickerIndex, useStickerLibrary } from '../stickers/stickerLibrary'
import type { Sticker } from '../stickers/types'
import { LazyThumb } from './LazyThumb'
import { selectionWears, tapSticker } from './useSelectionStickers'
import { useNoun } from '../maps/useNoun'

/** The colour the gallery is shown in, always: the Library never recolours. */
const GRID_COLOUR = FACE_COLORS[1].color

/** What a tap did, for the line under the grid. */
export function useTapMessage() {
  const [message, setMessage] = useState<string | null>(null)
  const noun = useNoun()
  const geo = useMapStore((s) => s.geo)
  const tap = (stickerId: string) => {
    const { selectedCountryIds: ids, doc } = useMapStore.getState()
    const nameOf = (id: string) => doc.merges.find((m) => m.id === id)?.name ?? geo?.meta[id]?.name ?? id
    const label = ids.length === 1 ? nameOf(ids[0]) : `${ids.length} ${noun.many}`
    const done = tapSticker(stickerId)
    setMessage(done === 'on' ? `Put on ${label}.` : done === 'off' ? `Taken off ${label}.` : `Select ${noun.many} on the map first.`)
  }
  return { message, setMessage, tap }
}

export function StickerLibrary() {
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const { uploads, add, pick, colour } = useStickerLibrary()
  const doc = useMapStore((s) => s.doc)
  const selected = useMapStore((s) => s.selectedCountryIds)
  const { message, setMessage, tap } = useTapMessage()
  const wearing = useMemo(() => resolveStickers(doc), [doc])

  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const matches = (name: string) => words.every((w) => name.toLowerCase().includes(w))
  // The author's own: uploads and faces saved from Create — not emoji picked this session.
  const mine = uploads.filter((s) => isOwnSticker(s) && matches(s.name))
  const faces = useMemo(() => FACE_PRESETS.filter((p) => matches(p.name)), [query]) // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (id: string) => {
    pick(id)
    tap(id)
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

  return (
    <div className="stack">
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
            aria-selected={selectionWears(sticker.id, wearing, selected)}
            className={`sticker-grid__item${selectionWears(sticker.id, wearing, selected) ? ' sticker-grid__item--picked' : ''}`}
            title={sticker.name}
            onClick={() => choose(sticker.id)}
          >
            <LazyThumb thumbKey={`${sticker.id}|${sticker.src.length}`} make={() => sticker.src} alt={sticker.name} />
          </button>
        ))}
        {mine.length > 0 && faces.length > 0 && <span className="sticker-grid__heading">Faces</span>}
        {faces.map((preset) => {
          const id = faceStickerId(preset.id, colour)
          const on = selectionWears(id, wearing, selected)
          return (
            <button
              key={preset.id}
              type="button"
              role="option"
              aria-selected={on}
              className={`sticker-grid__item${on ? ' sticker-grid__item--picked' : ''}`}
              title={preset.name}
              onClick={() => choose(id)}
            >
              <LazyThumb thumbKey={`${preset.id}|${GRID_COLOUR}`} make={() => faceDataUri(presetFace(preset, GRID_COLOUR))} alt={preset.name} />
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

      {message && <p className="hint">{message}</p>}
      <PickedStickerActions />
      <p className="hint">
        Uploads are saved in this browser for every map, shrunk to 256 px, which is plenty for a sticker.
      </p>
    </div>
  )
}

/**
 * The rest of what can be done with the sticker tapped last: add it to the tiers, open a face in
 * the face maker, or delete an upload. Putting it on and taking it off is the tap itself.
 */
export function PickedStickerActions() {
  const [message, setMessage] = useState<string | null>(null)
  const { uploads, remove, pickedId, pick, setFace, keep } = useStickerLibrary()
  const doc = useMapStore((s) => s.doc)
  const dispatch = useMapStore((s) => s.dispatch)
  const mode = stickersOf(doc)
  const index = useMemo(() => stickerIndex(uploads), [uploads])
  const picked = pickedId ? index.get(pickedId) : undefined
  const pickedFace = pickedId ? parseFaceSticker(pickedId) : null
  const isUpload = !!picked && uploads.some((s) => s.id === picked.id && isOwnSticker(s))
  useEffect(() => setMessage(null), [pickedId])
  if (!picked) return null

  const addToTiers = () => {
    const ladder = [...mode.ladder, picked.id]
    keep(picked.id)
    dispatch({ op: 'set_stickers', patch: { ladder, enabled: true } })
    saveLadder(ladder)
    setMessage(`Added to the tiers as tier ${ladder.length}.`)
  }
  const edit = () => {
    if (!pickedFace) return
    setFace(presetFace(pickedFace.preset, pickedFace.color === 'flag' ? GRID_COLOUR : pickedFace.color))
    setMessage('Opened in Create → Face maker.')
  }
  const deletePicked = () => {
    const ladder = mode.ladder.filter((id) => id !== picked.id)
    if (ladder.length !== mode.ladder.length) {
      dispatch({ op: 'set_stickers', patch: { ladder } })
      saveLadder(ladder)
    }
    remove(picked.id)
    pick(null)
  }

  return (
    <div className="stack sticker-gallery__actions">
      <div className="mode-switch mode-switch--pair">
        <button type="button" className="btn btn--ghost" onClick={addToTiers}>
          Add to tiers
        </button>
        {pickedFace ? (
          <button type="button" className="btn btn--ghost" onClick={edit}>
            Edit in face maker
          </button>
        ) : isUpload ? (
          <button type="button" className="btn btn--ghost" onClick={deletePicked}>
            Delete upload
          </button>
        ) : null}
      </div>
      {message && <p className="hint">{message}</p>}
    </div>
  )
}
