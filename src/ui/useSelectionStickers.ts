/**
 * Stickers and the selection: what a tap on a sticker in the panel does to the selected
 * territories, and what the panel's colour and size do to the stickers they wear.
 *
 * **A tap puts a sticker on, a second tap takes it off.** With territories selected on the map,
 * tapping a sticker puts it on all of them; tapping it again, once they all wear it, takes it off.
 * There is no Put on or Remove button. A face counts as the one worn in any colour, so a red Fire
 * Punch is taken off by tapping Fire Punch. Taking a sticker off hides one the data chose with a
 * "no sticker" override, so the data does not put it straight back, and clears one placed by hand.
 *
 * Every change is one edit, one undo step, on the selected territories and nothing else.
 */
import { useMapStore } from '../state/mapStore'
import { resolveStickers, stickersOf } from '../state/stickers'
import type { MapOperation } from '../state/operations'
import type { CountryId } from '../types/map'
import { faceOf } from '../stickers/stickerLibrary'

/** Whether a territory wearing `current` already wears `picked` — a face in any colour counts. */
function wears(current: string | undefined, picked: string): boolean {
  if (!current) return false
  if (current === picked) return true
  const a = faceOf(current)
  const b = faceOf(picked)
  return !!a && !!b && a.preset.id === b.preset.id
}

/** The operations that take the stickers off `ids`. */
export function removeOps(ids: CountryId[]): MapOperation[] {
  const { doc } = useMapStore.getState()
  const mode = stickersOf(doc)
  const fromData = resolveStickers({ ...doc, stickers: { ...mode, overrides: {} } })
  const hide = ids.filter((id) => fromData.has(id) && mode.overrides[id] !== null)
  const clear = ids.filter((id) => !fromData.has(id) && id in mode.overrides)
  const ops: MapOperation[] = []
  if (hide.length > 0) ops.push({ op: 'assign_sticker', countryIds: hide, stickerId: null })
  if (clear.length > 0) ops.push({ op: 'clear_sticker', countryIds: clear })
  return ops
}

/**
 * Taps `stickerId` onto the selected territories: on, or — when every one of them wears it
 * already — off. Says which, or `'none'` when nothing is selected.
 */
export function tapSticker(stickerId: string): 'on' | 'off' | 'none' {
  const { doc, selectedCountryIds: ids, dispatch } = useMapStore.getState()
  if (ids.length === 0) return 'none'
  const wearing = resolveStickers(doc)
  if (ids.every((id) => wears(wearing.get(id), stickerId))) {
    dispatch(removeOps(ids))
    return 'off'
  }
  const mode = stickersOf(doc)
  dispatch([
    { op: 'assign_sticker', countryIds: ids, stickerId },
    ...(mode.enabled ? [] : [{ op: 'set_stickers' as const, patch: { enabled: true } }]),
  ])
  /*
   * Put on, the territories are let go and the sticker is chosen instead — it is what is being
   * worked on now, and its colour and size are right there. Joined to the edit, so one undo takes
   * the sticker off and gives the selection back.
   */
  const store = useMapStore.getState()
  store.clearSelectionWithLastEdit()
  store.setActiveSticker(ids[ids.length - 1])
  return 'on'
}

/** Whether every selected territory wears `stickerId` (a face in any colour), for the grid's tick. */
export function selectionWears(stickerId: string, wearing: Map<CountryId, string>, ids: CountryId[]): boolean {
  return ids.length > 0 && ids.every((id) => wears(wearing.get(id), stickerId))
}
