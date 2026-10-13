/**
 * The main country's items in a right-click menu — the territory's and its sticker's.
 */
import { FLAG_CONTRAST } from '../state/mainCountry'
import { useMapStore } from '../state/mapStore'

/**
 * The main country (`MapDocument.mainCountryId`), from the territory's own menu: make it the one
 * the map is about, or — on the main country — stop, and tone its flag down.
 */
export function MainCountryItems({ entityId, onClose }: { entityId: string; onClose: () => void }) {
  const isMain = useMapStore((s) => s.doc.mainCountryId === entityId)
  const contrast = useMapStore((s) => s.doc.mainFlagContrast ?? FLAG_CONTRAST.default)
  const dispatch = useMapStore((s) => s.dispatch)
  const percent = Math.round(contrast * 100)
  return (
    <>
      <button
        type="button"
        role="menuitem"
        className="top-menu__item map-menu__item"
        title={isMain ? undefined : 'It wears its flag, and every other country says Yes or No: is it better than this one?'}
        onClick={() => {
          dispatch({ op: 'set_main_country', countryId: isMain ? null : entityId })
          onClose()
        }}
      >
        <span className="top-menu__name">{isMain ? 'Remove main country' : 'Set as main country'}</span>
      </button>
      {isMain && (
        <label className="field map-menu__field">
          <span className="field__row">
            <span className="field__label">Flag contrast</span>
            <span className="field__value">{percent}%</span>
          </span>
          <input
            className="slider"
            type="range"
            min={FLAG_CONTRAST.min}
            max={FLAG_CONTRAST.max}
            step={FLAG_CONTRAST.step}
            value={contrast}
            aria-label="Flag contrast"
            aria-valuetext={`${percent} percent`}
            onChange={(event) => dispatch({ op: 'set_main_flag_contrast', contrast: Number(event.target.value) })}
          />
        </label>
      )}
    </>
  )
}
