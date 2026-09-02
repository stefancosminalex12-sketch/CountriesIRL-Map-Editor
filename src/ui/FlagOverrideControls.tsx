/**
 * Changing the flag one country flies.
 *
 * The same control World Domination uses, pointed at the selection instead of at the
 * world: a country is picked by name and its flag is borrowed. Storing *which country*
 * rather than which file is what makes the two behave alike — both resolve through
 * `flagCodeFor`, so borrowing from a territory that flies another state's flag, or from
 * one of the entities with artwork but no ISO code, lands on the same file its owner
 * would.
 *
 * Nothing here touches the dataset. A country with no override flies its own flag
 * exactly as before, and resetting removes the entry rather than writing a default back.
 */
import { useMapStore } from '../state/mapStore'
import { playSfx } from '../audio/sfx'
import { CountryPicker } from './CountryPicker'
import { hasFlag } from '../flags/flagStore'
import type { CountryId } from '../types/map'
import { useNoun } from '../maps/useNoun'

export function FlagOverrideControls() {
  const overrides = useMapStore((s) => s.doc.flags.overrides)
  const domination = useMapStore((s) => s.doc.flags.worldDomination)
  const selected = useMapStore((s) => s.selectedCountryIds)
  const geo = useMapStore((s) => s.geo)
  const dispatch = useMapStore((s) => s.dispatch)
  const noun = useNoun()

  if (selected.length === 0) return null

  const nameOf = (id: CountryId) => geo?.meta[id]?.name ?? id

  /*
   * Applied to the whole selection, so changing the flag of six countries at once is one
   * gesture — the same way every other edit in this editor treats a multi-selection.
   */
  const assign = (source: CountryId) => {
    const next = { ...overrides }
    for (const id of selected) next[id] = source
    dispatch({ op: 'set_flags', patch: { overrides: next } })
    playSfx('confirm')
  }

  const reset = () => {
    const next = { ...overrides }
    for (const id of selected) delete next[id]
    dispatch({ op: 'set_flags', patch: { overrides: next } })
    playSfx('click')
  }

  const assigned = selected.map((id) => overrides[id]).filter(Boolean)
  const shared = assigned.length === selected.length && new Set(assigned).size === 1
  const current = shared ? assigned[0] : null

  return (
    <div className="stack">
      <CountryPicker
        label="Change Flag"
        value={current}
        onChange={assign}
        // Only countries whose artwork exists can be borrowed from; the rest would
        // silently leave the country with no flag at all.
        filter={(id) => hasFlag(geo?.meta[id]?.iso2) || !!geo?.meta[id]?.iso2}
        placeholder={`Type a ${noun.one} name…`}
      />

      <p className="hint">
        {current
          ? `Flying ${nameOf(current)}'s flag. The base data is unchanged.`
          : selected.length > 1
            ? `${selected.length} ${noun.many} selected — pick a flag for all of them.`
            : `Borrow another ${noun.one}’s flag. Its own flag is untouched.`}
      </p>

      {/*
        World domination paints one flag over everything, so a per-country choice is
        real but not visible while it is on. Saying so is better than leaving the author
        to wonder why the map did not change.
      */}
      {domination && (
        <p className="hint">World Domination is on, so it is covering every flag.</p>
      )}

      {assigned.length > 0 && (
        <button type="button" className="btn btn--ghost" onClick={reset}>
          Use default flag
        </button>
      )}
    </div>
  )
}
