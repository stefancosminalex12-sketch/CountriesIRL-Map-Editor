/**
 * Hold a value steady until something about it that actually matters changes.
 *
 * `useMemo` keys on identity, and the document is immutable — every edit produces a new
 * array, whether or not the edit touched anything the consumer cares about. Renaming a
 * merged entity replaces `doc.merges`, and a memo that depends on it recomputes even
 * though the name is not one of its inputs.
 *
 * This closes that gap. Give it the value and a key describing only the parts a
 * downstream memo reads, and it returns the *same object reference* for as long as the
 * key holds. The memos below it then behave as if the irrelevant edit never happened.
 *
 * Deliberately a ref rather than state: returning the previous value is not a render
 * decision that needs to propagate, and setting state here would schedule the very
 * re-render the hook exists to make cheap.
 */
import { useRef } from 'react'

export function useKeyed<T>(value: T, key: string): T {
  const held = useRef<{ key: string; value: T }>({ key, value })
  if (held.current.key !== key) held.current = { key, value }
  return held.current.value
}
