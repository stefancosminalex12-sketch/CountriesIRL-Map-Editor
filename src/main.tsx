import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { useMapStore } from './state/mapStore'
import { computeFraming } from './geo/framing'
import { countriesInRegions } from './geo/regions'
import { initialiseSettings } from './state/settingsStore'
import './styles/global.css'

// Theme and volume are applied before the first render so nothing flashes.
initialiseSettings()

/**
 * Development bridge for the operation pipeline.
 *
 * This is the exact surface the future AI assistant will use: it produces
 * `MapOperation[]`, the app validates and applies them. Try it in the console:
 *
 *   __mapEditor.dispatch([
 *     { op: 'set_country_value', countryId: 'ROU', value: 10 },
 *     { op: 'set_country_value', countryId: 'BGR', value: 18 },
 *   ])
 */
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__mapEditor = {
    dispatch: (...args: Parameters<ReturnType<typeof useMapStore.getState>['dispatch']>) =>
      useMapStore.getState().dispatch(...args),
    getState: () => useMapStore.getState(),
    /** Opens another atlas, exactly as the Maps picker does. */
    setAtlas: (atlasId: string) => useMapStore.getState().setAtlas(atlasId),
    /** Resolved camera for the active scope — what the region framing settled on. */
    framing: () => {
      const { doc, geo } = useMapStore.getState()
      return computeFraming(doc.scope.regionIds, geo)
    },
    /** Country ids belonging to the active region scope. */
    scope: () => {
      const { doc, geo } = useMapStore.getState()
      return geo ? countriesInRegions(doc.scope.regionIds, geo.meta) : new Set<string>()
    },
    /** Screen position of a geographic coordinate under the live projection. */
    project: (lon: number, lat: number) => {
      const p = (window as unknown as { __mapProjection?: (c: [number, number]) => [number, number] | null })
        .__mapProjection
      return p ? p([lon, lat]) : null
    },
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
