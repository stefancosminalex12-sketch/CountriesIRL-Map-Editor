/**
 * Region scope control.
 *
 * Regions are additive by design: picking Europe and Asia composes one Eurasia
 * framing rather than selecting a preset named "Eurasia".
 *
 * Hierarchical: World and the continents come first, as they always did, and each continent
 * with subregions (`geo/subregions.ts`) has a disclosure beside it that opens them underneath.
 * Only one continent is open at a time, so the list never becomes a wall of chips. A closed
 * continent still says how many of its subregions are on, so nothing selected is hidden
 * without a trace. Subregions compose like everything else: Balkans + Baltic States frames both.
 */
import { useState } from 'react'
import { regionsForAtlas, subregionsOf, type RegionPreset } from '../geo/regions'
import { useMapStore } from '../state/mapStore'
import type { RegionId } from '../types/map'
import { playSfx } from '../audio/sfx'

function RegionChip({ region, active, onToggle }: { region: RegionPreset; active: boolean; onToggle: (id: RegionId) => void }) {
  return (
    <button
      type="button"
      className={`chip${active ? ' chip--active' : ''}`}
      aria-pressed={active}
      title={region.definition}
      onClick={() => onToggle(region.id)}
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
}

export function RegionSelector() {
  const regionIds = useMapStore((s) => s.doc.scope.regionIds)
  const atlasId = useMapStore((s) => s.doc.scope.atlasId)
  const toggleRegion = useMapStore((s) => s.toggleRegion)
  const [expanded, setExpanded] = useState<RegionId | null>(null)

  // Only the regions the open map actually has. Offering Oceania on a map of the United
  // States would be offering a framing with no geometry behind it.
  const regions = regionsForAtlas(atlasId)
  const isWorld = regionIds.includes('world')
  const isActive = (id: RegionId) => (id === 'world' ? isWorld : !isWorld && regionIds.includes(id))

  const toggle = (id: RegionId) => {
    toggleRegion(id)
    // Recomposing the map is the one action that gets the heavier sound.
    playSfx('transition')
  }

  const hasTree = regions.some((r) => subregionsOf(r.id).length > 0)
  if (!hasTree) {
    return (
      <div className="region-selector">
        {regions.map((region) => (
          <RegionChip key={region.id} region={region} active={isActive(region.id)} onToggle={toggle} />
        ))}
        {regions.length > 1 && (
          <p className="hint">Click to combine regions — e.g. Europe + Asia frames Eurasia.</p>
        )}
      </div>
    )
  }

  return (
    <div className="region-tree">
      {regions.map((region) => {
        const children = subregionsOf(region.id)
        const open = expanded === region.id
        const onCount = children.filter((c) => isActive(c.id)).length
        return (
          <div key={region.id} className={`region-tree__row${open ? ' region-tree__row--open' : ''}`}>
            <div className="region-tree__head">
              <RegionChip region={region} active={isActive(region.id)} onToggle={toggle} />
              {children.length > 0 && (
                <button
                  type="button"
                  className="region-tree__expand"
                  aria-expanded={open}
                  aria-controls={`subregions-${region.id}`}
                  aria-label={`${open ? 'Hide' : 'Show'} ${region.name} subregions`}
                  onClick={() => {
                    setExpanded(open ? null : region.id)
                    playSfx(open ? 'toggleOff' : 'toggleOn')
                  }}
                >
                  {onCount > 0 && <span className="region-tree__count">{onCount} on</span>}
                  <span className="region-tree__label">Subregions</span>
                  <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true" focusable="false">
                    <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              )}
            </div>
            {open && (
              <div
                id={`subregions-${region.id}`}
                className="region-tree__children"
                role="group"
                aria-label={`${region.name} subregions`}
              >
                {children.map((child) => (
                  <RegionChip key={child.id} region={child} active={isActive(child.id)} onToggle={toggle} />
                ))}
              </div>
            )}
          </div>
        )
      })}
      <p className="hint">
        Click to combine regions — e.g. Europe + Asia frames Eurasia. Open a continent for its
        subregions.
      </p>
    </div>
  )
}
