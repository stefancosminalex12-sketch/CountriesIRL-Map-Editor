/**
 * The SVG section: the selected map out as a blank SVG, and an edited one back in.
 *
 * Two controls and no choices. **Download SVG** saves the map that is open — its geography, one
 * identified path per entity, nothing else. **The drop box** takes that file back after it has
 * been edited anywhere — ChatGPT, a drawing program, a script — and applies whatever was added to
 * it: colours, values, a legend, a title, names. The reading is `io/svgExchange.ts`; this is only
 * the file handling and a line saying what happened.
 */
import { useRef, useState, type DragEvent } from 'react'
import { useMapStore } from '../state/mapStore'
import { buildBlankSvg, importMapSvg, type SvgImportResult } from '../io/svgExchange'
import { withFullDetail } from '../render/landDetail'
import { useNoun } from '../maps/useNoun'

/** Files larger than this are not an edited blank map — refused before they are read. */
const MAX_BYTES = 60 * 1024 * 1024

export function SvgExchange() {
  const noun = useNoun()
  const geoReady = useMapStore((s) => s.geoStatus === 'ready' && s.geo !== null)
  const [result, setResult] = useState<SvgImportResult | null>(null)
  const [downloaded, setDownloaded] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  // At full detail, like every other export: the file is meant to be edited and zoomed into.
  const download = async () => {
    const blank = await withFullDetail(() => {
      const { doc, geo } = useMapStore.getState()
      return buildBlankSvg(doc, geo)
    })
    if (!blank) {
      setDownloaded('The map is still loading. Try again in a moment.')
      return
    }
    const url = URL.createObjectURL(new Blob([blank.markup], { type: 'image/svg+xml' }))
    const link = document.createElement('a')
    link.href = url
    link.download = blank.filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
    setDownloaded(`${blank.filename} — ${blank.entities.toLocaleString()} ${blank.entities === 1 ? noun.one : noun.many}, ${(blank.markup.length / 1024 / 1024).toFixed(1)} MB.`)
  }

  const read = async (file: File | undefined | null) => {
    if (!file) return
    if (!/\.svg$/i.test(file.name) && file.type !== 'image/svg+xml') {
      setResult({ ok: false, message: 'That is not an SVG file.', matched: 0, values: 0, colours: 0, legendItems: 0, title: null, labels: false })
      return
    }
    if (file.size > MAX_BYTES) {
      setResult({ ok: false, message: 'That file is too large to be an edited map.', matched: 0, values: 0, colours: 0, legendItems: 0, title: null, labels: false })
      return
    }
    setBusy(true)
    try {
      const text = await file.text()
      const { doc, geo, dispatch } = useMapStore.getState()
      const outcome = importMapSvg(text, doc, geo, dispatch)
      setResult(outcome)
    } finally {
      setBusy(false)
    }
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setOver(false)
    void read(event.dataTransfer.files?.[0])
  }

  return (
    <div className="stack">
      <p className="hint">
        Download the selected map as a blank SVG, add data to it anywhere — ChatGPT can colour it,
        number it and give it a legend — then drop it back here to apply the additions to this map.
      </p>

      <button type="button" className="btn btn--on" disabled={!geoReady} onClick={download}>
        Download SVG
      </button>
      {downloaded && <p className="hint">{downloaded}</p>}

      <div
        className={`svg-drop${over ? ' svg-drop--over' : ''}${busy ? ' svg-drop--busy' : ''}`}
        role="button"
        tabIndex={0}
        aria-label="Upload an edited SVG"
        onClick={() => input.current?.click()}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            input.current?.click()
          }
        }}
        onDragEnter={(event) => {
          event.preventDefault()
          setOver(true)
        }}
        onDragOver={(event) => {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <svg viewBox="0 0 20 20" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M10 13V3.6M6.4 7.2 10 3.6l3.6 3.6" />
          <path d="M3.6 12.4v2.8c0 .7.5 1.2 1.2 1.2h10.4c.7 0 1.2-.5 1.2-1.2v-2.8" />
        </svg>
        <span className="svg-drop__text">
          {busy ? 'Reading…' : over ? 'Drop to apply' : 'Drop the edited SVG here, or click to choose it'}
        </span>
        <input
          ref={input}
          type="file"
          accept=".svg,image/svg+xml"
          hidden
          onChange={(event) => {
            void read(event.target.files?.[0])
            event.target.value = ''
          }}
        />
      </div>

      {result && (
        <p className={`hint${result.ok ? '' : ' hint--warn'}`} role="status">
          {result.message}
          {result.ok ? ' Undo takes it all back in one step.' : ''}
        </p>
      )}
    </div>
  )
}
