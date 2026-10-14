/**
 * The Templates section: the built-in presets, as a list. Click one and it is applied.
 *
 * The presets themselves are in `state/templates.ts`; this only lists them and applies one through
 * the store's own `dispatch`, as one edit. A template that asks a question first — Predefined Data
 * asks which dataset — shows its options under it when clicked, and applies on the choice. Nothing
 * here stores anything: the map keeps the settings the template wrote, every one of them can be
 * changed by hand afterwards, and the template is unchanged and can be applied again.
 */
import { useState } from 'react'
import { useMapStore } from '../state/mapStore'
import { TEMPLATES, templateOps, type MapTemplate } from '../state/templates'
import { openSidebarSection } from './sidebarEvents'
import { MAP_SVG_ID } from '../render/MapCanvas'
import { getLiveProjection } from '../render/liveProjection'
import { squareScreen } from '../render/screenFrame'
import { geoArea, geoPath, type GeoProjection } from 'd3-geo'
import type { Geometry, Polygon } from 'geojson'

/** Two frames, or a moment in a tab that gets none: the map has redrawn for the new region. */
const redrawn = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    setTimeout(resolve, 400)
  })

/**
 * A template's square frame (`TemplateFrame`), placed round its landmarks on the map as it is now
 * drawn — after the template's region and projection are in. One more edit, after the first.
 */
async function placeFrame(template: MapTemplate, before: ReturnType<typeof getLiveProjection>): Promise<void> {
  const frame = template.frame
  if (!frame) return
  // The map has a new projection once the region and projection are in; at most a few seconds.
  for (let waited = 0; getLiveProjection() === before && waited < 3000; waited += 50) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  await redrawn()
  const projection = getLiveProjection()
  const canvas = document.getElementById(MAP_SVG_ID)
  if (!projection || !canvas) return
  const box = canvas.getBoundingClientRect()
  const project = (points: readonly [number, number][]) =>
    points.map((p) => projection([p[0], p[1]])).filter((p): p is [number, number] => !!p)
  const { transform, dispatch } = useMapStore.getState()
  const sized = squareScreen(project(frame.west), project(frame.top), project(frame.bottom), transform, box.width, box.height)
  if (!sized) return
  let rect = sized
  /*
   * Placed by outlines: the top just above one territory's main landmass, the left edge just west
   * of another's, at the size measured above — so the whole of each is in, however its coast runs.
   */
  const geo = useMapStore.getState().geo
  if (frame.place && geo) {
    const top = mainlandBounds(geo.byId.get(frame.place.topOf)?.geometry, projection)
    const west = mainlandBounds(geo.byId.get(frame.place.westOf)?.geometry, projection)
    if (top && west) {
      const pad = sized.width * 0.008
      const x = west[0][0] * transform.k + transform.x - pad
      const y = top[0][1] * transform.k + transform.y - pad
      // The same size — grown only as far as the bottom landmarks need, so moving up cuts none off.
      const lowest = Math.max(...project(frame.bottom).map(([, by]) => by * transform.k + transform.y))
      const side = Math.min(Math.max(sized.width, lowest + pad - y), box.width, box.height)
      rect = {
        x: Math.min(Math.max(0, x), Math.max(0, box.width - side)),
        y: Math.min(Math.max(0, y), Math.max(0, box.height - side)),
        width: side,
        height: side,
      }
    }
  }
  dispatch({ op: 'set_screen', patch: { enabled: true, rect, aspect: '1:1' } })
}

/** The projected bounds of a territory's largest piece — Iceland without its islets, mainland Portugal. */
function mainlandBounds(geometry: Geometry | undefined, projection: GeoProjection): [[number, number], [number, number]] | null {
  if (!geometry) return null
  let polygon: Polygon | null = null
  if (geometry.type === 'Polygon') polygon = geometry
  else if (geometry.type === 'MultiPolygon') {
    let best = -1
    for (const coordinates of geometry.coordinates) {
      const piece: Polygon = { type: 'Polygon', coordinates }
      const area = geoArea(piece)
      if (area > best) {
        best = area
        polygon = piece
      }
    }
  }
  if (!polygon) return null
  const bounds = geoPath(projection).bounds(polygon)
  return Number.isFinite(bounds[0][0]) && Number.isFinite(bounds[0][1]) ? bounds : null
}

/** `onApplied` is called once a template has been applied — the File menu closes on it. */
export function TemplatePicker({ onApplied }: { onApplied?: () => void } = {}) {
  const geo = useMapStore((s) => s.geo)
  const [asking, setAsking] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)

  const finish = (template: MapTemplate, text: string) => {
    setStatus({ ok: true, text: `${text} ${template.next}` })
    if (template.openSection) openSidebarSection(template.openSection)
    onApplied?.()
  }

  const apply = (template: MapTemplate) => {
    if (template.choices) {
      // Asks first: the options open under it, and a second click folds them away again.
      setAsking(asking === template.id ? null : template.id)
      setStatus(null)
      return
    }
    const { doc, dispatch } = useMapStore.getState()
    const before = getLiveProjection()
    dispatch(templateOps(template, doc))
    void placeFrame(template, before)
    finish(template, `Applied ${template.name}.`)
  }

  const choose = async (template: MapTemplate, optionId: string) => {
    if (!template.choices || busy) return
    setBusy(true)
    try {
      const { doc, geo: loaded, dispatch } = useMapStore.getState()
      const built = await template.choices.build(optionId, doc, loaded)
      if ('error' in built) {
        setStatus({ ok: false, text: built.error })
        return
      }
      // The template's fixed settings, if it has any, then the chosen option's — one edit.
      dispatch([...templateOps(template, useMapStore.getState().doc), ...built.ops])
      setAsking(null)
      finish(template, built.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack">
      <ul className="template-list">
        {TEMPLATES.map((template) => (
          <li key={template.id}>
            <button
              type="button"
              className={`template-item${asking === template.id ? ' template-item--asking' : ''}`}
              aria-expanded={template.choices ? asking === template.id : undefined}
              onClick={() => apply(template)}
            >
              <span className="template-item__name">{template.name}</span>
              <span className="template-item__text">{template.description}</span>
            </button>
            {template.choices && asking === template.id && (
              <div className="template-choices" role="group" aria-label={template.choices.prompt}>
                <span className="field__label">{template.choices.prompt}</span>
                {template.choices.options.map((option) => {
                  const reason = template.choices!.unavailable(option.id, geo)
                  return (
                    <button
                      key={option.id}
                      type="button"
                      className="template-choice"
                      disabled={busy || reason !== null}
                      title={reason ?? undefined}
                      onClick={() => void choose(template, option.id)}
                    >
                      <span className="template-choice__name">{option.name}</span>
                      <span className="template-choice__text">{reason ?? option.detail}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </li>
        ))}
      </ul>
      {status && (
        <p className={`hint${status.ok ? '' : ' hint--warn'}`} role="status">
          {status.text}
        </p>
      )}
    </div>
  )
}
