import { useEffect } from 'react'
import { MapCanvas } from './render/MapCanvas'
import { Sidebar } from './ui/Sidebar'
import { HistoryControls } from './ui/HistoryControls'
import { ExportControls } from './ui/ExportControls'
import { StatusBar } from './ui/StatusBar'
import { useMapStore } from './state/mapStore'

export function App() {
  const datasetId = useMapStore((s) => s.doc.scope.datasetId)
  const loadDataset = useMapStore((s) => s.loadDataset)
  const mapName = useMapStore((s) => s.doc.name)
  const dispatch = useMapStore((s) => s.dispatch)

  useEffect(() => {
    void loadDataset(datasetId)
  }, [datasetId, loadDataset])

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__brand">Map Editor</h1>
        <input
          className="app__title"
          value={mapName}
          onChange={(e) => dispatch({ op: 'set_map_name', name: e.target.value })}
          aria-label="Map name"
        />
        <span className="app__spacer" />
        <HistoryControls />
        <ExportControls />
      </header>

      <div className="app__body">
        <Sidebar />

        <main className="app__map">
          <MapCanvas />
        </main>

      </div>

      <StatusBar />
    </div>
  )
}
