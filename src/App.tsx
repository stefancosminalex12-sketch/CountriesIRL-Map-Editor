import { useEffect } from 'react'
import { MapCanvas } from './render/MapCanvas'
import { Sidebar } from './ui/Sidebar'
import { TopBarScope } from './ui/TopBar'
import { HistoryControls } from './ui/HistoryControls'
import { ExportControls } from './ui/ExportControls'
import { StatusBar } from './ui/StatusBar'
import { useMapStore } from './state/mapStore'

export function App() {
  const datasetId = useMapStore((s) => s.doc.scope.datasetId)
  const loadDataset = useMapStore((s) => s.loadDataset)

  useEffect(() => {
    void loadDataset(datasetId)
  }, [datasetId, loadDataset])

  return (
    <div className="app">
      {/*
        The File menu (map, resolution, projection, outside region) and the regions, along the
        top — see `TopBar`. The editor's name lives in the page title, so the bar is all controls.
      */}
      <header className="app__header">
        <h1 className="visually-hidden">Map Editor</h1>
        <TopBarScope />
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
