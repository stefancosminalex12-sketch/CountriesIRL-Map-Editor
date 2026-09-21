/**
 * Changing the flag an entity flies.
 *
 * Any flag, for any selected entity — a country, a territory, a region of the administrative map
 * or a merged group — chosen from the one list of flags the Merge panel and the overlays offer
 * too. Nothing here touches the dataset:
 *
 * - A country, a territory or a region gets an entry in the document's flag assignments
 *   (`flags.overrides`) naming the artwork. It is resolved by `entityFlagCode`, the rule the map
 *   draws with, so what is chosen here is what the map shows.
 * - A merged group's flag is its own `flag` field — the one its row in Merge sets — so the two
 *   panels change the same thing and can never disagree.
 *
 * An entity with no assignment flies its default flag exactly as before, and "Use default flag"
 * removes the assignment rather than writing a default back. The whole selection changes in one
 * step, so one undo takes it back.
 */
import { useMemo } from 'react'
import { useMapStore } from '../state/mapStore'
import { FlagPicker } from './FlagPicker'
import { defaultFlagCode, entityFlagCode, flagName, flagOptions } from '../flags/flagChoices'
import type { MapOperation } from '../state/operations'
import type { CountryId } from '../types/map'
import { useNoun } from '../maps/useNoun'

export function FlagOverrideControls() {
  const overrides = useMapStore((s) => s.doc.flags.overrides)
  const merges = useMapStore((s) => s.doc.merges)
  const domination = useMapStore((s) => s.doc.flags.worldDomination)
  const selected = useMapStore((s) => s.selectedCountryIds)
  const geo = useMapStore((s) => s.geo)
  const dispatch = useMapStore((s) => s.dispatch)
  const noun = useNoun()
  const options = useMemo(() => flagOptions(geo?.meta ?? {}), [geo])

  if (selected.length === 0 || !geo) return null

  const mergeById = new Map(merges.map((m) => [m.id, m]))
  const nameOf = (id: CountryId) => mergeById.get(id)?.name ?? geo.meta[id]?.name ?? id

  /* What each selected entity flies, whether that is a choice made for it, and what it would fly without one. */
  const flown = selected.map((id) => {
    const merge = mergeById.get(id)
    if (merge) return { id, merge: true, code: merge.flag ?? null, custom: merge.flag !== null, own: null as string | null }
    return {
      id,
      merge: false,
      code: entityFlagCode(id, overrides, geo.meta) ?? null,
      custom: id in overrides,
      own: defaultFlagCode(id, geo.meta) ?? null,
    }
  })
  const codes = new Set(flown.map((f) => f.code))
  const shared = codes.size === 1 ? [...codes][0] : null
  const customCount = flown.filter((f) => f.custom).length

  const apply = (next: (id: CountryId, overrides: Record<CountryId, CountryId>) => string | null | undefined) => {
    const nextOverrides = { ...overrides }
    const ops: MapOperation[] = []
    let assignmentsChanged = false
    for (const id of selected) {
      const code = next(id, nextOverrides)
      const merge = mergeById.get(id)
      if (merge) {
        if (code !== undefined && merge.flag !== code) ops.push({ op: 'update_merge', id, patch: { flag: code } })
      } else if (code === null) {
        if (id in nextOverrides) {
          delete nextOverrides[id]
          assignmentsChanged = true
        }
      } else if (code !== undefined && nextOverrides[id] !== code) {
        nextOverrides[id] = code
        assignmentsChanged = true
      }
    }
    if (assignmentsChanged) ops.unshift({ op: 'set_flags', patch: { overrides: nextOverrides } })
    if (ops.length > 0) dispatch(ops)
  }

  /* Any flag, for the whole selection at once — one step, the way every other edit treats a multi-selection. */
  const assign = (code: string) => {
    apply(() => code)
  }

  /* Back to the default: the assignment removed, and a merged group's own flag cleared. */
  const reset = () => {
    apply(() => null)
  }

  const status = (() => {
    if (flown.length > 1) {
      return customCount > 0
        ? `${flown.length} ${noun.many} selected, ${customCount} with a custom flag. Pick a flag for all of them.`
        : `${flown.length} ${noun.many} selected, all on their default flags. Pick a flag for all of them.`
    }
    const [one] = flown
    const name = (code: string | null) => (code ? flagName(code, options) : null)
    if (one.merge) {
      return one.code ? `Group flag: ${name(one.code)}.` : `This group has no flag yet. Choose any flag.`
    }
    if (one.custom) {
      return `Custom flag: ${name(one.code) ?? 'none'}. Its default is ${one.own ? name(one.own) : 'no flag'}.`
    }
    return one.code
      ? `Default flag: ${name(one.code)}. Choose any flag to fly instead.`
      : `${nameOf(one.id)} has no flag of its own. Choose any flag to give it one.`
  })()

  return (
    <div className="stack">
      <FlagPicker
        label="Change Flag"
        value={shared}
        options={options}
        onChange={assign}
        placeholder="Type a flag’s name…"
      />

      <p className="hint">{status}</p>

      {/*
        World domination paints one flag over everything, so a per-entity choice is real but not
        visible while it is on. Saying so is better than leaving the author to wonder why the map
        did not change.
      */}
      {domination && <p className="hint">World Domination is on, so it is covering every flag.</p>}

      {customCount > 0 && (
        <button type="button" className="btn btn--ghost" onClick={reset}>
          Use default flag
        </button>
      )}
    </div>
  )
}
