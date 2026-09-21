import { useId, useState, type ReactNode } from 'react'

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

  return (
    <div className={`disclosure${open ? ' disclosure--open' : ''}`}>
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
