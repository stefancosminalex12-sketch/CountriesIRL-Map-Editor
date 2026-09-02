import { describeRegions } from '../geo/regions'
import { useMapStore } from '../state/mapStore'
import { useNoun } from '../maps/useNoun'

export function StatusBar() {
  const regionIds = useMapStore((s) => s.doc.scope.regionIds)
  const geo = useMapStore((s) => s.geo)
  const transform = useMapStore((s) => s.transform)
  const hoveredCountryId = useMapStore((s) => s.hoveredCountryId)
  const selectedCountryIds = useMapStore((s) => s.selectedCountryIds)
  const countryCount = useMapStore((s) => Object.keys(s.doc.countries).length)

  const noun = useNoun()
  const hovered = hoveredCountryId ? geo?.meta[hoveredCountryId] : null

  return (
    <footer className="statusbar">
      <span>{describeRegions(regionIds)}</span>
      <span className="statusbar__sep" />
      <span>{geo ? `${geo.features.length} polygons` : 'loading…'}</span>
      <span className="statusbar__sep" />
      <span>{countryCount} with data</span>
      <span className="statusbar__sep" />
      <span>{selectedCountryIds.length} selected</span>
      <span className="statusbar__spacer" />
      <span className="statusbar__hover">
        {hovered ? `${hovered.name} (${hovered.code || hovered.id})` : `Hover a ${noun.one}`}
      </span>
      <span className="statusbar__sep" />
      <span>{transform.k.toFixed(1)}×</span>
    </footer>
  )
}
