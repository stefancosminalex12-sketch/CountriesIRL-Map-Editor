/**
 * A row of colour dots — the presets, then any colour — shared by Find Stickers, the face maker
 * and Recolour. With `allowOriginal`, a first dot means "as drawn" and reports `null`. With
 * `allowFlag`, a last dot means "in the country's flag" and reports `'flag'`: a face filled with the
 * flag of whichever territory wears it.
 */
import { FACE_COLORS } from '../stickers/faceMaker'

export function StickerColorRow({
  value,
  onChange,
  allowOriginal = false,
  allowFlag = false,
}: {
  value: string | null
  onChange: (color: string | null) => void
  allowOriginal?: boolean
  allowFlag?: boolean
}) {
  const current = value?.toLowerCase() ?? null
  return (
    <div className="sticker-colors" role="group" aria-label="Colour">
      {allowOriginal && (
        <button
          type="button"
          className={`sticker-colors__dot sticker-colors__dot--original${current === null ? ' sticker-colors__dot--on' : ''}`}
          title="Original colours"
          aria-label="Original colours"
          aria-pressed={current === null}
          onClick={() => onChange(null)}
        />
      )}
      {FACE_COLORS.map(({ name, color }) => (
        <button
          key={color}
          type="button"
          className={`sticker-colors__dot${current === color ? ' sticker-colors__dot--on' : ''}`}
          style={{ background: color }}
          title={name}
          aria-label={name}
          aria-pressed={current === color}
          onClick={() => onChange(color)}
        />
      ))}
      {allowFlag && (
        <button
          type="button"
          className={`sticker-colors__dot sticker-colors__dot--flag${current === 'flag' ? ' sticker-colors__dot--on' : ''}`}
          title="Country flag: each sticker in the flag of the country it is on"
          aria-label="Country flag"
          aria-pressed={current === 'flag'}
          onClick={() => onChange('flag')}
        />
      )}
      <label className="sticker-colors__custom" title="Any colour">
        <input
          type="color"
          value={value && value.startsWith('#') ? value : '#1f6fe0'}
          onChange={(event) => onChange(event.target.value)}
          aria-label="Any colour"
        />
      </label>
    </div>
  )
}
