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
import { playSfx } from '../audio/sfx'

export function TemplatePicker() {
  const geo = useMapStore((s) => s.geo)
  const [asking, setAsking] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)

  const finish = (template: MapTemplate, text: string) => {
    setStatus({ ok: true, text: `${text} ${template.next}` })
    playSfx('confirm')
    if (template.openSection) openSidebarSection(template.openSection)
  }

  const apply = (template: MapTemplate) => {
    if (template.choices) {
      // Asks first: the options open under it, and a second click folds them away again.
      setAsking(asking === template.id ? null : template.id)
      setStatus(null)
      playSfx(asking === template.id ? 'toggleOff' : 'toggleOn')
      return
    }
    const { doc, dispatch } = useMapStore.getState()
    dispatch(templateOps(template, doc))
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
        playSfx('click')
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
      <p className="hint">Built-in presets. Click one to set the editor up for that kind of map.</p>
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
