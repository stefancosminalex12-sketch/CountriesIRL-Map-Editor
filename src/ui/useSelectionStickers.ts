/**
 * Putting a sticker on the selected territories, and taking it off again — the two buttons the
 * gallery and the library both show under a picked sticker.
 *
 * **Remove** takes off whatever sticker each selected territory is wearing. Where the data put
 * it there, that needs a "no sticker" override, or the data would put it straight back; where it
 * was only placed by hand, the override is simply cleared, so the territory is left as if it had
 * never had one. Either way it is one operation batch, so one undo step.
 */
import { useMemo } from 'react'
import { useMapStore } from '../state/mapStore'
import { resolveStickers, stickersOf } from '../state/stickers'
import type { MapOperation } from '../state/operations'
import type { CountryId } from '../types/map'
import { useNoun } from '../maps/useNoun'

/**
 * With a sticker clicked on the map (`activeStickerId`), picking another sticker swaps it: the
 * territory wears the new one. True when it did, so a picker knows the pick went to the map.
 */
export function swapChosenSticker(stickerId: string): boolean {
  const { activeStickerId, dispatch } = useMapStore.getState()
  if (!activeStickerId) return false
  dispatch({ op: 'assign_sticker', countryIds: [activeStickerId], stickerId })
  return true
}

export function useSelectionStickers() {
  const doc = useMapStore((s) => s.doc)
  const selected = useMapStore((s) => s.selectedCountryIds)
  const geo = useMapStore((s) => s.geo)
  const dispatch = useMapStore((s) => s.dispatch)
  const noun = useNoun()
  const mode = stickersOf(doc)

  const nameOf = (id: CountryId) => doc.merges.find((m) => m.id === id)?.name ?? geo?.meta[id]?.name ?? id
  const label = selected.length === 1 ? nameOf(selected[0]) : `${selected.length} ${noun.many}`

  /** What the data alone would put where, with every hand-placed sticker set aside. */
  const fromData = useMemo(() => resolveStickers({ ...doc, stickers: { ...mode, overrides: {} } }), [doc, mode])
  const wearing = useMemo(() => resolveStickers(doc), [doc])

  const putOn = (stickerId: string) => {
    if (selected.length === 0) return
    dispatch([
      { op: 'assign_sticker', countryIds: selected, stickerId },
      ...(mode.enabled ? [] : [{ op: 'set_stickers' as const, patch: { enabled: true } }]),
    ])
  }

  const canRemove = selected.some((id) => wearing.has(id))
  const remove = () => {
    const hide = selected.filter((id) => fromData.has(id) && mode.overrides[id] !== null)
    const clear = selected.filter((id) => !fromData.has(id) && id in mode.overrides)
    const ops: MapOperation[] = []
    if (hide.length > 0) ops.push({ op: 'assign_sticker', countryIds: hide, stickerId: null })
    if (clear.length > 0) ops.push({ op: 'clear_sticker', countryIds: clear })
    if (ops.length > 0) dispatch(ops)
  }

  return { selected, label, putOn, remove, canRemove }
}
