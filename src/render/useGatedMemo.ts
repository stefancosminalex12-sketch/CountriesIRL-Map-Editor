/**
 * A memo that only computes while `ready`, and returns `empty` otherwise.
 *
 * For the layers drawn over a progressive map's land — lakes, rivers, the border networks,
 * the coasts, the names — which are not needed for the map to be seen and used, and which
 * together cost as much again as the land. When new land arrives they are held back for one
 * render (see `layersReady` in `MapCanvas`), so the land is committed and painted first and
 * these follow in the next render rather than making the first one longer.
 *
 * Unlike a `useMemo` that is handed "nothing" while it waits, this keeps its last answer
 * while it is gated: a render that is not ready does not overwrite it, so a hover or a
 * selection that happens to land in the gap does not make the next ready render recompute a
 * layer it already had. It recomputes only when its dependencies really change.
 *
 * When `ready` is always true this is an ordinary memo.
 */
import { useRef } from 'react'

function sameDeps(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false
  return true
}

export function useGatedMemo<T>(
  ready: boolean,
  empty: T,
  compute: () => T,
  deps: readonly unknown[],
): T {
  const held = useRef<{ deps: readonly unknown[]; value: T } | null>(null)
  if (!ready) return empty
  if (held.current && sameDeps(held.current.deps, deps)) return held.current.value
  const value = compute()
  held.current = { deps, value }
  return value
}
