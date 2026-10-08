/**
 * The sticker gallery: every ready-made face (`stickers/facePresets.ts`), all in the colour picked
 * above them.
 *
 * Tapping a face adds it to the library in that colour and picks it; the bar under the grid then
 * puts it on the selected territories, adds it to the tiers, or opens it in the face maker to
 * change. The thumbnails are drawn once per colour and kept, so switching back to a colour is
 * instant.
 */
import { useMemo, useState } from 'react'
import { useMapStore } from '../state/mapStore'
import { stickersOf } from '../state/stickers'
import { FACE_COLORS, faceDataUri } from '../stickers/faceMaker'
import { FACE_PRESETS, presetFace, type FacePreset } from '../stickers/facePresets'
import { saveLadder, useStickerLibrary } from '../stickers/stickerLibrary'
import { StickerColorRow } from './StickerColorRow'
import { useNoun } from '../maps/useNoun'
import { useSelectionStickers } from './useSelectionStickers'

/** Every preset's artwork, per colour, for the session. */
const drawn = new Map<string, Map<string, string>>()
function artworkFor(color: string): Map<string, string> {
  let byId = drawn.get(color)
  if (!byId) {
    byId = new Map(FACE_PRESETS.map((p) => [p.id, faceDataUri(presetFace(p, color))]))
    drawn.set(color, byId)
  }
  return byId
}

export function StickerGallery() {
  const [color, setColor] = useState(FACE_COLORS[0].color)
  const [query, setQuery] = useState('')
  const [chosen, setChosen] = useState<FacePreset | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const { uploads, add, pick, setFace } = useStickerLibrary()
  const onSelection = useSelectionStickers()
  const selected = onSelection.selected
  const doc = useMapStore((s) => s.doc)
  const dispatch = useMapStore((s) => s.dispatch)
  const noun = useNoun()
  const art = useMemo(() => artworkFor(color.toLowerCase()), [color])
  const colourName = FACE_COLORS.find((c) => c.color === color.toLowerCase())?.name ?? color

  const presets = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    return words.length === 0 ? FACE_PRESETS : FACE_PRESETS.filter((p) => words.every((w) => p.name.toLowerCase().includes(w)))
  }, [query])

  /** The chosen face as a library sticker in the current colour, added once. */
  const ensure = (preset: FacePreset) => {
    const id = `user:face-${preset.id}-${color.toLowerCase().slice(1)}`
    if (!uploads.some((s) => s.id === id)) add([{ id, name: `${preset.name} (${colourName})`, src: art.get(preset.id)! }])
    pick(id)
    return id
  }

  const choose = (preset: FacePreset) => {
    setChosen(preset)
    setMessage(null)
    ensure(preset)
  }

  const putOnSelection = () => {
    if (!chosen) return
    onSelection.putOn(ensure(chosen))
    setMessage(`Put on ${onSelection.label}.`)
  }

  const removeFromSelection = () => {
    onSelection.remove()
    setMessage(`Removed from ${onSelection.label}.`)
  }

  const addToTiers = () => {
    if (!chosen) return
    const id = ensure(chosen)
    const ladder = [...stickersOf(doc).ladder, id]
    dispatch({ op: 'set_stickers', patch: { ladder, enabled: true } })
    saveLadder(ladder)
    setMessage(`Added to the tiers as tier ${ladder.length}.`)
  }

  const edit = () => {
    if (!chosen) return
    setFace(presetFace(chosen, color))
    setMessage('Opened in Create → Face maker.')
  }

  return (
    <div className="stack">
      <div className="stack sticker-parts">
        <span className="sidebar__group-label">Colour</span>
        <StickerColorRow value={color} onChange={(next) => next && setColor(next)} />
      </div>
      <input
        className="input"
        type="search"
        placeholder={`Search ${FACE_PRESETS.length} faces: angry, love, cool…`}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        aria-label="Search faces"
      />

      <div className="sticker-grid sticker-grid--gallery" role="listbox" aria-label="Sticker gallery">
        {presets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            role="option"
            aria-selected={chosen?.id === preset.id}
            className={`sticker-grid__item${chosen?.id === preset.id ? ' sticker-grid__item--picked' : ''}`}
            title={preset.name}
            onClick={() => choose(preset)}
          >
            <img className="sticker-thumb" src={art.get(preset.id)} alt={preset.name} width={40} height={40} draggable={false} />
          </button>
        ))}
      </div>
      {presets.length === 0 && <p className="hint">No face is called that.</p>}

      {chosen ? (
        <div className="stack sticker-gallery__actions">
          <p className="hint">
            <strong>{chosen.name}</strong> in {colourName.toLowerCase()}, added to your library.
          </p>
          {selected.length > 0 && (
            <>
              <button type="button" className="btn btn--on" onClick={putOnSelection}>
                Put on {onSelection.label}
              </button>
              <button
                type="button"
                className="btn"
                disabled={!onSelection.canRemove}
                title={`Take the sticker off ${onSelection.label}`}
                onClick={removeFromSelection}
              >
                Remove
              </button>
            </>
          )}
          <div className="mode-switch mode-switch--pair">
            <button type="button" className="btn" onClick={addToTiers}>
              Add to tiers
            </button>
            <button type="button" className="btn" onClick={edit}>
              Edit in face maker
            </button>
          </div>
          {message && <p className="hint">{message}</p>}
        </div>
      ) : (
        <div className="stack">
          <p className="hint">Pick a colour, then tap a face. Select {noun.many} on the map first to put it straight on them.</p>
          {selected.length > 0 && (
            <button type="button" className="btn" disabled={!onSelection.canRemove} title={`Take the sticker off ${onSelection.label}`} onClick={removeFromSelection}>
              Remove
            </button>
          )}
          {!chosen && message && <p className="hint">{message}</p>}
        </div>
      )}
    </div>
  )
}
