/**
 * Which end of the data is the good one: **Higher is better** (GDP per capita) or **Lower is
 * better** (unemployment). The active layer's `colorScale.lowerIsBetter`, so the Moods ramp and the
 * mood faces turn round together. Shown in Data under the Moods colours and in Stickers → Moods —
 * one setting in two places, never two that could disagree.
 */
import { useMapStore } from '../state/mapStore'

export function BetterSwitch() {
  const doc = useMapStore((s) => s.doc)
  const dispatch = useMapStore((s) => s.dispatch)
  const layer = doc.layers.find((l) => l.id === doc.activeLayerId) ?? doc.layers[0]
  if (!layer) return null
  const lower = !!layer.colorScale.lowerIsBetter
  return (
    <div className="mode-switch mode-switch--pair" role="group" aria-label="Which values are better">
      {[false, true].map((value) => (
        <button
          key={String(value)}
          type="button"
          className={`chip${lower === value ? ' chip--active' : ''}`}
          aria-pressed={lower === value}
          onClick={() =>
            dispatch({ op: 'set_layer', layerId: layer.id, patch: { colorScale: { ...layer.colorScale, lowerIsBetter: value } } })
          }
        >
          {value ? 'Lower is better' : 'Higher is better'}
        </button>
      ))}
    </div>
  )
}
