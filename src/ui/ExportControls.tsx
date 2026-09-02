/**
 * The export control.
 *
 * One button with three formats behind it rather than three buttons, because the
 * choice is a detail of the same action — the header has room for "export", not for
 * an inventory of encoders.
 *
 * Everything about *what* gets exported lives in `render/exportMap.ts` and reads the
 * live `<svg>`. All this component contributes is the filename, which is the one
 * thing the DOM cannot supply: it needs the region and projection *names*, and those
 * are document state. Note it only reads them — nothing here dispatches an operation,
 * so exporting cannot disturb the camera, the selection or the map.
 */
import { useEffect, useRef, useState } from 'react'
import { MAP_SVG_ID } from '../render/MapCanvas'
import {
  buildFilename,
  downloadBlob,
  findMapSvg,
  renderMapExport,
  type ExportFormat,
} from '../render/exportMap'
import { getDataset } from '../geo/datasets'
import { getProjectionDef, resolveProjectionId } from '../geo/projections'
import { getRegion } from '../geo/regions'
import { useMapStore } from '../state/mapStore'
import { playSfx } from '../audio/sfx'

const FORMATS: { id: ExportFormat; label: string; hint: string }[] = [
  { id: 'png', label: 'PNG', hint: 'Lossless, 2× resolution' },
  { id: 'jpg', label: 'JPG', hint: 'Smaller, no transparency' },
  { id: 'svg', label: 'SVG', hint: 'Vector, scales freely' },
]

export function ExportControls() {
  const scope = useMapStore((s) => s.doc.scope)
  const background = useMapStore((s) => s.doc.style.background)

  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<ExportFormat | null>(null)
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Dismiss on an outside click or Escape, like every other transient surface.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const run = async (format: ExportFormat) => {
    const svg = findMapSvg(MAP_SVG_ID)
    if (!svg) {
      setError('The map is still loading')
      return
    }

    setBusy(format)
    setError(null)
    try {
      /*
       * The filename describes the composition, so it has to name the projection the
       * map is actually drawn with — `auto` is a policy, not a projection, and
       * resolving it here is the same step the renderer takes.
       */
      const projectionId = resolveProjectionId(scope.projectionId)
      const filename = buildFilename(
        {
          regions: scope.regionIds.map((id) => getRegion(id).name),
          projection: getProjectionDef(projectionId).name,
          detail: getDataset(scope.datasetId).detail,
        },
        format,
      )

      const result = await renderMapExport(svg, { format, filename, background })
      downloadBlob(result.blob, result.filename)
      playSfx('confirm')
      setOpen(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Export failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="export" ref={containerRef}>
      <button
        type="button"
        className="btn"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v)
          setError(null)
          playSfx('press')
        }}
      >
        Export
        <span className="export__caret" aria-hidden="true" />
      </button>

      {open && (
        <div className="export__menu" role="menu" aria-label="Export format">
          {FORMATS.map((format) => (
            <button
              key={format.id}
              type="button"
              role="menuitem"
              className="export__item"
              disabled={busy !== null}
              onClick={() => void run(format.id)}
            >
              <span className="export__label">
                {busy === format.id ? 'Exporting…' : format.label}
              </span>
              <span className="export__hint">{format.hint}</span>
            </button>
          ))}
          {error && <p className="export__error">{error}</p>}
        </div>
      )}
    </div>
  )
}
