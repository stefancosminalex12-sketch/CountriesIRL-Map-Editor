import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

/**
 * The disclosures open right now, oldest first, each with a way to fold it.
 *
 * Only for the phone's Back button (`Sidebar`), which backs out of the view opened last: the
 * tool inside a section before the section itself. Each disclosure adds itself when it opens and
 * takes itself out when it folds or unmounts, so this never holds anything that is not on screen,
 * and its open state stays its own — Back folds it exactly as a tap on its title does.
 */
const openDisclosures: { element: HTMLElement | null; close: () => void }[] = []

/**
 * Folds the disclosure opened most recently inside `within`, and says whether there was one.
 */
export function closeLatestDisclosure(within: Element | null): boolean {
  for (let i = openDisclosures.length - 1; i >= 0; i--) {
    const entry = openDisclosures[i]
    if (within && entry.element && within.contains(entry.element)) {
      entry.close()
      return true
    }
  }
  return false
}

/**
 * A titled row that opens to reveal its contents.
 *
 * For a group of controls that belongs where it is but does not need to be visible all
 * the time — the legend's settings sit under the mode that produces the legend, and
 * there are fifteen of them, which is more panel than most edits need.
 *
 * Open/closed is local component state and deliberately nothing more. It is a fact
 * about this session's panel, not about the map: putting it in the document would make
 * "I collapsed a section" an undoable edit, would travel with a saved map, and would
 * mean two people opening the same file disagree about the map's contents because one
 * of them folded a panel shut.
 *
 * Styled from the section header's own type so it reads as part of the panel rather
 * than as a control that wandered in, and the chevron is the one the selects use.
 */
export function Disclosure({
  title,
  children,
  defaultOpen = false,
}: {
  title: string
  children: ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const bodyId = useId()
  const root = useRef<HTMLDivElement>(null)

  /* Known to the phone's Back button while open — see `openDisclosures`. */
  useEffect(() => {
    if (!open) return
    const entry = { element: root.current, close: () => setOpen(false) }
    openDisclosures.push(entry)
    return () => {
      const at = openDisclosures.indexOf(entry)
      if (at >= 0) openDisclosures.splice(at, 1)
    }
  }, [open])

  return (
    <div ref={root} className={`disclosure${open ? ' disclosure--open' : ''}`}>
      <button
        type="button"
        className="disclosure__toggle"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => {
          setOpen(!open)
        }}
      >
        <span className="disclosure__title">{title}</span>
      </button>
      {/*
        Unmounted rather than hidden while closed. The controls inside read the document
        on every render, and a folded panel should not be paying for that — nor should a
        collapsed section keep a slider mounted that the author cannot see.
      */}
      {open && (
        <div className="disclosure__body" id={bodyId}>
          {children}
        </div>
      )}
    </div>
  )
}
