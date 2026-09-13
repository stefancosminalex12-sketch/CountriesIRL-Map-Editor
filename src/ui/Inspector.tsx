/**
 * Selected-country inspector.
 *
 * This is the human-facing equivalent of what the AI assistant will do later: it
 * emits operations and never writes to the document directly. Every control here has
 * a one-line operation behind it, and that operation is the whole interface — the
 * assistant will reach the same edits by emitting the same objects, so there is one
 * editing system rather than a manual one and an automated one.
 *
 * The value field is deliberately generic: the layer decides what the key means, so
 * the same control serves population, GDP, a category, or anything else.
 *
 * There is no colour control here. What a country looks like is decided by the active
 * colouring mode in Data & palette, from the value edited here or from the groups it
 * belongs to — so this panel edits the data and that panel decides how the data reads.
 */
import { useEffect, useRef, useState } from 'react'
import { useMapStore } from '../state/mapStore'
import { playSfx } from '../audio/sfx'
import type { CountryId, MapValue } from '../types/map'
import { useNoun } from '../maps/useNoun'
import { GroupActions } from './GroupActions'
import { EntitySource } from './EntitySource'

/**
 * What counts as a number in the value field.
 *
 * Deliberately its own pattern rather than a bare `Number()`: that accepts `0x1f`,
 * `Infinity` and an empty string, none of which anyone typed on purpose. This admits
 * a sign, a decimal point on either side of the digits, and an exponent — so `-12`,
 * `.5`, `3.2e9` and `1e-7` all reach the scale, which is what "negative, decimal, very
 * large and very small values are allowed" has to mean. Anything else is kept as the
 * string it is; the numeric scale ignores it and the country keeps the land colour
 * rather than being coloured off a number nobody wrote.
 */
const NUMERIC = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/

function parseValue(raw: string): MapValue {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  if (!NUMERIC.test(trimmed)) return trimmed
  const numeric = Number(trimmed)
  return Number.isFinite(numeric) ? numeric : trimmed
}

/** Marks the inspector's root, so the value field can tell its own panel from the map. */
const INSPECTOR_MARKER = 'data-inspector'

/**
 * The value field.
 *
 * Holds a draft while it is being typed and commits on Enter or on losing focus,
 * rather than writing on every keystroke. Two reasons. Typing "1.5" passes through
 * "1." — not a number — and a field that writes as you type stores that; and one
 * committed edit is one undo step, so taking back a number does not mean pressing
 * Ctrl+Z once per character.
 *
 * The draft resyncs whenever the committed value or the selection changes, so the
 * field always shows what the document actually holds — this is a view of the map's
 * state, not a place values live.
 *
 * `onApplied` is told when a typed edit has landed — see `Inspector` for what the
 * Palette workflow does with that. Only a commit that wrote something counts: typing
 * never does, a blur that changed nothing never does, and an edit the document refused
 * never does.
 */
function ValueField({
  ids,
  committed,
  onApplied,
}: {
  ids: CountryId[]
  committed: string
  onApplied?: () => void
}) {
  const dispatch = useMapStore((s) => s.dispatch)
  const [draft, setDraft] = useState(committed)

  /*
   * Set when the edit is over before the blur that follows it: by Escape, so that blur
   * does not save what Escape just discarded, and by an applied Enter, so the field
   * going away with the selection does not commit a second time. A ref rather than
   * state because the blur handler has to read it in the same tick.
   */
  const settled = useRef(false)

  /*
   * What the last pointer press landed on. A blur says where focus went in
   * `relatedTarget`, but a button that does not take focus — Safari's, and every
   * button on iOS — leaves that empty, so the press is the only record of it.
   */
  const pressed = useRef<EventTarget | null>(null)
  useEffect(() => {
    const onPress = (event: PointerEvent) => {
      pressed.current = event.target
    }
    document.addEventListener('pointerdown', onPress, true)
    return () => document.removeEventListener('pointerdown', onPress, true)
  }, [])

  const target = ids.join(',')
  useEffect(() => {
    setDraft(committed)
  }, [committed, target])

  /*
   * One batch, one edit, one undo step — and one operation per country, so the value
   * lands on exactly the countries that were selected when it was typed and on
   * nothing else. Emptying the field *removes* the key rather than storing a null:
   * a country with no value has to be indistinguishable from one that never had one,
   * or it stays out of the scale's domain but keeps answering "I have a value" to
   * every other question the editor asks.
   *
   * Returns whether the edit landed on every selected country.
   */
  const commit = (): boolean => {
    if (draft === committed) return false
    const value = parseValue(draft)
    const results = dispatch(
      value === null
        ? ids.map((countryId) => ({ op: 'clear_country_value' as const, countryId }))
        : ids.map((countryId) => ({ op: 'set_country_value' as const, countryId, value })),
    )
    return results.length > 0 && results.every((result) => result.ok)
  }

  return (
    <input
      className="input"
      type="text"
      inputMode="decimal"
      placeholder={ids.length === 1 ? 'value' : `value for ${ids.length} — Enter`}
      value={draft}
      aria-label={ids.length === 1 ? 'Value' : `Value for ${ids.length} countries`}
      onFocus={() => {
        settled.current = false
        pressed.current = null
      }}
      onChange={(e) => {
        settled.current = false
        setDraft(e.target.value)
      }}
      onBlur={(e) => {
        if (settled.current) {
          settled.current = false
          return
        }
        const field = e.currentTarget
        if (!commit() || !onApplied) return
        /*
         * Where focus went decides whether the edit is finished. Onto another control of
         * this same panel — the name field, Clear, Reset — the author is still working on
         * this selection, and letting it go would take that control away from under the
         * pointer. Anywhere else — the map, another panel, the keyboard's Done — the
         * value was the last thing asked of it.
         */
        const panel = field.closest(`[${INSPECTOR_MARKER}]`)
        const staysInPanel = (next: EventTarget | null) => {
          const control =
            next instanceof Element ? next.closest('button, input, select, textarea') : null
          return control !== null && control !== field && panel !== null && panel.contains(control)
        }
        if (staysInPanel(e.relatedTarget) || staysInPanel(pressed.current)) return
        onApplied()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          const applied = commit()
          playSfx('tick')
          if (applied && onApplied) {
            settled.current = true
            onApplied()
          }
        } else if (e.key === 'Escape') {
          settled.current = true
          setDraft(committed)
          e.currentTarget.blur()
        }
      }}
    />
  )
}

export function Inspector() {
  const geo = useMapStore((s) => s.geo)
  const doc = useMapStore((s) => s.doc)
  const selectedCountryIds = useMapStore((s) => s.selectedCountryIds)
  const dispatch = useMapStore((s) => s.dispatch)
  const clearSelection = useMapStore((s) => s.clearSelection)
  const clearSelectionWithLastEdit = useMapStore((s) => s.clearSelectionWithLastEdit)
  const noun = useNoun()

  const layer = doc.layers.find((l) => l.id === doc.activeLayerId) ?? doc.layers[0]
  const key = layer?.dataKey ?? 'value'

  if (selectedCountryIds.length === 0) {
    return (
      <p className="hint">
        Tap a {noun.one} on the map to select it. Tap more to add them; tap a selected
        one to remove it.
      </p>
    )
  }

  const single = selectedCountryIds.length === 1 ? selectedCountryIds[0] : null
  /** Comparison colours by membership, not by value, so the value editors do not apply. */
  const comparing = doc.comparison.enabled

  /*
   * In the Palette workflow a value finishes the job. The author selects countries,
   * gives them their number, and the selection has done what it was for — so once the
   * number has landed it is let go, as Compare lets go of countries once they have
   * joined a group. Kept, it went on being highlighted over the colour just given to
   * it, and the next tap added a country to a set that was already finished.
   *
   * The value itself is untouched: it is in the document before the selection goes,
   * and letting go of a selection writes nothing. Only the Palette scale does this —
   * Predefined, Flags and Compare keep their selection exactly as before.
   */
  const palette = !doc.flags.enabled && !comparing && layer?.colorScale.mode === 'numeric'
  // Letting go is part of the edit, so one undo brings back the value and the selection both.
  const onApplied = palette ? clearSelectionWithLastEdit : undefined

  /*
   * What the shared field shows: the value if every selected country already agrees,
   * and blank if they do not. Showing one country's number as if it were all of their
   * numbers would be a lie the field then commits on blur.
   */
  const values = selectedCountryIds.map((id) => doc.countries[id]?.properties[key] ?? null)
  const sharedValue =
    values.length > 0 && values.every((v) => v !== null && v === values[0])
      ? String(values[0])
      : ''

  return (
    <div className="stack" {...{ [INSPECTOR_MARKER]: '' }}>
      <div className="inspector__head">
        <span className="hint">
          {selectedCountryIds.length} selected{comparing ? '' : ` · key “${key}”`}
        </span>
        <button type="button" className="btn btn--ghost" onClick={clearSelection}>
          Clear
        </button>
      </div>

      {/*
        In Compare mode this panel stops at the line above.

        Everything below edits values, and comparison reads no values at all — it colours
        by group membership. So a card per selected country would be a column of controls
        that do nothing for the mode in use, and, being one card per country, it grew with
        the selection and pushed the Compare panel off the top of the sidebar exactly when
        the author was using it. Where the selected countries are going is a question
        Compare answers, in the group they are about to join.
      */}
      {comparing ? null : (
        <>
      {!single && (
        <div className="inspector__row">
          <div className="inspector__title">
            <strong>{selectedCountryIds.length} countries</strong>
          </div>
          <ValueField ids={selectedCountryIds} committed={sharedValue} onApplied={onApplied} />
          <div className="inspector__actions">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() =>
                dispatch(
                  selectedCountryIds.map((countryId) => ({
                    op: 'clear_country_value' as const,
                    countryId,
                  })),
                )
              }
            >
              Clear values
            </button>
          </div>
        </div>
      )}

      {selectedCountryIds.map((id) => {
        const meta = geo?.meta[id]
        const entry = doc.countries[id]
        const value = entry?.properties[key] ?? null
        /*
         * A merged entity has no row in the country table and should not pretend to:
         * it is not a real-world country and inventing a region for it would be stating
         * something false. Its own name and the countries it was made from are the true
         * facts about it, so those are what it shows.
         */
        const merge = doc.merges.find((m) => m.id === id)
        const sourceName = merge?.name ?? meta?.name ?? id

        return (
          <div className="inspector__row" key={id}>
            <div className="inspector__title">
              <strong>{entry?.label ?? sourceName}</strong>
              <code>{merge ? 'MERGED' : id}</code>
            </div>
            <div className="hint">
              {merge
                ? `Made from: ${merge.members.join(', ')}`
                : meta?.parent
                  ? `${meta.kind ?? 'Subdivision'} in ${meta.parent.name}${
                      meta.parent.iso2 || meta.parent.code ? ` (${meta.parent.iso2 ?? meta.parent.code})` : ''
                    }`
                  : meta
                    ? `${meta.subregion} · ${meta.region}`
                    : 'Not in the country table'}
            </div>
            {/*
              A subdivision's own codes and where it comes from — the ISO 3166-2 code where it
              has one, and the dataset its lines are drawn from.
            */}
            {!merge && meta && <EntitySource meta={meta} detailsUrl={geo?.dataset.detailsUrl} />}
            {!merge && meta?.members && meta.members.length > 1 && (
              <div className="hint">
                Made from {meta.members.length}: {meta.members.slice(0, 12).join(', ')}
                {meta.members.length > 12 ? `, and ${meta.members.length - 12} more` : ''}
              </div>
            )}
            {!merge && meta && single === id && <GroupActions meta={meta} />}

            {/* Only the single-selection view offers per-country editing; with many
                selected the shared row above does the work and these stay read-outs. */}
            {single === id && (
              <>
                <input
                  className="input"
                  type="text"
                  value={entry?.label ?? ''}
                  placeholder={sourceName}
                  aria-label="Name"
                  onChange={(e) =>
                    dispatch({
                      op: 'set_country_label',
                      countryId: id,
                      label: e.target.value.trim() === '' ? null : e.target.value,
                    })
                  }
                />
                <ValueField
                  ids={[id]}
                  committed={value === null ? '' : String(value)}
                  onApplied={onApplied}
                />
                <div className="inspector__actions">
                  <button
                    type="button"
                    className="btn btn--ghost"
                    disabled={value === null}
                    onClick={() => dispatch({ op: 'clear_country_value', countryId: id })}
                  >
                    Clear value
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    title="Remove all data for this country"
                    onClick={() => {
                      dispatch({ op: 'clear_country', countryId: id })
                      playSfx('click')
                    }}
                  >
                    Reset
                  </button>
                </div>
              </>
            )}
          </div>
        )
      })}
        </>
      )}
    </div>
  )
}
