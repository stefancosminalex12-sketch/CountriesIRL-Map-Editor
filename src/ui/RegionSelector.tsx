/**
 * Region scope control.
 *
 * Regions are additive by design: picking Europe and Asia composes one Eurasia
 * framing rather than selecting a preset named "Eurasia".
 */
import { regionsForAtlas } from '../geo/regions'
import { useMapStore } from '../state/mapStore'
import { playSfx } from '../audio/sfx'

export function RegionSelector() {
  const regionIds = useMapStore((s) => s.doc.scope.regionIds)
  const atlasId = useMapStore((s) => s.doc.scope.atlasId)
  const toggleRegion = useMapStore((s) => s.toggleRegion)

  // Only the regions the open map actually has. Offering Oceania on a map of the United
  // States would be offering a framing with no geometry behind it.
  const regions = regionsForAtlas(atlasId)
  const isWorld = regionIds.includes('world')

  return (
    <div className="region-selector">
      {regions.map((region) => {
        const active = region.id === 'world' ? isWorld : !isWorld && regionIds.includes(region.id)
        return (
          <button
            key={region.id}
            type="button"
            className={`chip${active ? ' chip--active' : ''}`}
            aria-pressed={active}
            onClick={() => {
              toggleRegion(region.id)
              // Recomposing the map is the one action that gets the heavier sound.
              playSfx('transition')
            }}
          >
            {/*
              Selection is marked by a shape as well as by the accent fill. Regions
              are additive, so what the eye has to read off the row is how many are
              on — and ticks count more easily than fills do.
            */}
            <svg
              className="chip__check"
              viewBox="0 0 12 12"
              height="9"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M2.2 6.3 4.7 8.8 9.8 3.4" />
            </svg>
            {region.name}
          </button>
        )
      })}
      {regions.length > 1 && (
        <p className="hint">Click to combine regions — e.g. Europe + Asia frames Eurasia.</p>
      )}
    </div>
  )
}
