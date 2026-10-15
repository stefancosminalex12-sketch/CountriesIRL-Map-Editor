/**
 * A box attached under the open tool's card, for what a selection adds — the selected countries'
 * value editor in Data. The card above keeps its size and its contents stay where they are; the
 * selection's controls appear in their own box right beneath it, which scrolls on its own.
 *
 * The sidebar provides where the box goes (`AttachedSlot`, beside the card). Where there is no
 * room for a second box — a phone, where the card is the width of the screen — the contents are
 * drawn in the card as before.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** The element the sidebar keeps under its card for attached boxes, or null for none. */
export const AttachedSlot = createContext<HTMLElement | null>(null)

const NARROW = '(max-width: 620px)'

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => typeof matchMedia === 'function' && matchMedia(NARROW).matches)
  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const query = matchMedia(NARROW)
    const update = () => setNarrow(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return narrow
}

/** `show`: whether there is anything to attach — the box is not drawn empty. */
export function AttachedBox({ show, label, children }: { show: boolean; label: string; children: ReactNode }) {
  const slot = useContext(AttachedSlot)
  const narrow = useNarrow()
  if (!show) return null
  if (!slot || narrow) return <div className="selection-scroll">{children}</div>
  return createPortal(
    <section className="attached-card" aria-label={label}>
      {children}
    </section>,
    slot,
  )
}
