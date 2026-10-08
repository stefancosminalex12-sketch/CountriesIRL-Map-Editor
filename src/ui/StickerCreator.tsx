/**
 * Create: making new stickers inside the editor.
 *
 * Two tools, one row of colours:
 *
 * - **Face maker** — a glossy face built from parts (eyes, brows, mouth, extras) in any colour.
 *   See `stickers/faceMaker.ts`.
 * - **Recolour** — the sticker picked in the Library with its main colour changed, shading kept.
 *   Works on built-in faces, catalogue icons and uploads alike. See `stickers/recolor.ts`.
 *
 * Either way the result is saved to the library like an upload, picked, and ready for the tiers.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  BROWS,
  DEFAULT_FACE,
  EXTRAS,
  EYES,
  FACE_COLORS,
  MOUTHS,
  faceDataUri,
  randomFace,
  type ExtraId,
  type FaceOptions,
} from '../stickers/faceMaker'
import { recolorSticker } from '../stickers/recolor'
import { newId, stickerIndex, useStickerLibrary } from '../stickers/stickerLibrary'

function ColorRow({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  return (
    <div className="sticker-colors" role="group" aria-label="Colour">
      {FACE_COLORS.map(({ name, color }) => (
        <button
          key={color}
          type="button"
          className={`sticker-colors__dot${value.toLowerCase() === color ? ' sticker-colors__dot--on' : ''}`}
          style={{ background: color }}
          title={name}
          aria-label={name}
          aria-pressed={value.toLowerCase() === color}
          onClick={() => onChange(color)}
        />
      ))}
      <label className="sticker-colors__custom" title="Any colour">
        <input type="color" value={value} onChange={(event) => onChange(event.target.value)} aria-label="Any colour" />
      </label>
    </div>
  )
}

function PartChoice<T extends string>({
  label,
  parts,
  value,
  onChange,
}: {
  label: string
  parts: Record<T, { name: string }>
  value: T
  onChange: (id: T) => void
}) {
  return (
    <div className="stack sticker-parts">
      <span className="sidebar__group-label">{label}</span>
      <div className="sticker-parts__chips">
        {(Object.keys(parts) as T[]).map((id) => (
          <button
            key={id}
            type="button"
            className={`chip${value === id ? ' chip--active' : ''}`}
            aria-pressed={value === id}
            onClick={() => onChange(id)}
          >
            {parts[id].name}
          </button>
        ))}
      </div>
    </div>
  )
}

function FaceMaker() {
  const [face, setFace] = useState<FaceOptions>(DEFAULT_FACE)
  const [name, setName] = useState('')
  const [saved, setSaved] = useState<string | null>(null)
  const { add, pick } = useStickerLibrary()
  const preview = useMemo(() => faceDataUri(face), [face])
  const update = (patch: Partial<FaceOptions>) => {
    setFace({ ...face, ...patch })
    setSaved(null)
  }
  const toggleExtra = (id: ExtraId) =>
    update({ extras: face.extras.includes(id) ? face.extras.filter((e) => e !== id) : [...face.extras, id] })

  const save = () => {
    const sticker = { id: newId(), name: name.trim() || `${MOUTHS[face.mouth].name} face`, src: preview }
    const stored = add([sticker])
    pick(sticker.id)
    setSaved(stored ? `Saved “${sticker.name}” to your library.` : 'Saved, but this browser is out of storage space.')
  }

  return (
    <div className="stack">
      <div className="sticker-preview">
        <img src={preview} alt="Face preview" width={132} height={132} />
      </div>
      <ColorRow value={face.color} onChange={(color) => update({ color })} />
      <PartChoice label="Eyes" parts={EYES} value={face.eyes} onChange={(eyes) => update({ eyes })} />
      <PartChoice label="Brows" parts={BROWS} value={face.brows} onChange={(brows) => update({ brows })} />
      <PartChoice label="Mouth" parts={MOUTHS} value={face.mouth} onChange={(mouth) => update({ mouth })} />
      <div className="stack sticker-parts">
        <span className="sidebar__group-label">Extras</span>
        <div className="sticker-parts__chips">
          {(Object.keys(EXTRAS) as ExtraId[]).map((id) => (
            <button
              key={id}
              type="button"
              className={`chip${face.extras.includes(id) ? ' chip--active' : ''}`}
              aria-pressed={face.extras.includes(id)}
              onClick={() => toggleExtra(id)}
            >
              {EXTRAS[id].name}
            </button>
          ))}
          <button
            type="button"
            className={`chip${face.outline ? ' chip--active' : ''}`}
            aria-pressed={face.outline}
            onClick={() => update({ outline: !face.outline })}
          >
            Outline
          </button>
        </div>
      </div>
      <input className="input" placeholder="Name (optional)" value={name} onChange={(event) => setName(event.target.value)} aria-label="Sticker name" />
      <div className="mode-switch mode-switch--pair">
        <button type="button" className="btn" onClick={() => update(randomFace())}>
          Random
        </button>
        <button type="button" className="btn btn--on" onClick={save}>
          Save sticker
        </button>
      </div>
      {saved && <p className="hint">{saved}</p>}
    </div>
  )
}

function Recolour() {
  const { uploads, pickedId, add, pick } = useStickerLibrary()
  const source = pickedId ? stickerIndex(uploads).get(pickedId) : undefined
  const [color, setColor] = useState(FACE_COLORS[1].color)
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!source) {
      setPreview(null)
      return
    }
    let live = true
    setError(null)
    recolorSticker(source.src, color).then(
      (uri) => live && setPreview(uri),
      (e: Error) => live && setError(e.message),
    )
    return () => {
      live = false
    }
  }, [source, color])

  if (!source) {
    return <p className="hint">Pick a sticker in the Library first, then choose its new colour here.</p>
  }

  const colourName = FACE_COLORS.find((c) => c.color === color)?.name ?? color
  const save = () => {
    if (!preview) return
    const sticker = { id: newId(), name: `${source.name} (${colourName})`, src: preview }
    add([sticker])
    pick(sticker.id)
  }

  return (
    <div className="stack">
      <div className="sticker-preview sticker-preview--pair">
        <img src={source.src} alt={source.name} width={84} height={84} />
        <span aria-hidden="true">→</span>
        {preview ? <img src={preview} alt="Recoloured" width={84} height={84} /> : <span className="sticker-preview__empty" />}
      </div>
      <ColorRow value={color} onChange={setColor} />
      {error && <p className="hint hint--warn">{error}</p>}
      <button type="button" className="btn btn--on" disabled={!preview} onClick={save}>
        Save as new sticker
      </button>
      <p className="hint">
        Changes the sticker’s main colour and keeps its shading. Other colours in it, like white gloves or a red rose,
        stay as they are.
      </p>
    </div>
  )
}

export function StickerCreator() {
  const [tool, setTool] = useState<'face' | 'recolour'>('face')
  return (
    <div className="stack">
      <div className="mode-switch mode-switch--pair" role="group" aria-label="Tool">
        {(
          [
            ['face', 'Face maker'],
            ['recolour', 'Recolour'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`chip${tool === id ? ' chip--active' : ''}`}
            aria-pressed={tool === id}
            onClick={() => setTool(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {tool === 'face' ? <FaceMaker /> : <Recolour />}
    </div>
  )
}
