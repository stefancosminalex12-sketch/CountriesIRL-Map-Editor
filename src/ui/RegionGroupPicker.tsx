/**
 * Selecting a whole region by typing its name: "Catalonia", "Transylvania", "Upper Bavaria".
 *
 * The regions are the ones the loaded dataset's units name (`selectableGroups`) — autonomous
 * communities, regions, coarser levels of the same country, the historical regions a table
 * records — and every country. Choosing one adds its units to the selection, exactly as a
 * rectangle or a brush stroke would, so everything that works on a selection works on it and
 * one undo takes it back.
 *
 * Only on a map whose units belong to countries; on the World map a region search would be
 * the Region selector, which already exists.
 */
import { useMemo, useRef, useState } from 'react'
import { useMapStore } from '../state/mapStore'
import { selectableGroups } from '../geo/groups'

const MAX_MATCHES = 30

export function RegionGroupPicker() {
  const geo = useMapStore((s) => s.geo)
  const addToSelection = useMapStore((s) => s.addToSelection)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const blurTimer = useRef<number | null>(null)

  const groups = useMemo(
    () => (geo ? selectableGroups(geo.meta).sort((a, b) => a.name.localeCompare(b.name)) : []),
    [geo],
  )

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const starts = []
    const contains = []
    for (const g of groups) {
      const name = g.name.toLowerCase()
      if (name.startsWith(q)) starts.push(g)
      else if (name.includes(q) || g.country.toLowerCase().startsWith(q)) contains.push(g)
    }
    return [...starts, ...contains].slice(0, MAX_MATCHES)
  }, [groups, query])

  if (groups.length === 0) return null

  const commit = (members: string[]) => {
    addToSelection(members)
    setQuery('')
    setOpen(false)
  }

  return (
    <div className="field picker">
      <span className="field__label">Select a region</span>
      <input
        className="input"
        type="text"
        role="combobox"
        aria-expanded={open && matches.length > 0}
        aria-label="Select a region"
        autoComplete="off"
        placeholder="Catalonia, Transylvania, Upper Bavaria…"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          blurTimer.current = window.setTimeout(() => setOpen(false), 120)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && matches.length > 0) {
            event.preventDefault()
            commit(matches[0].members)
          } else if (event.key === 'Escape') {
            setQuery('')
            setOpen(false)
          }
        }}
      />
      {open && query.trim() !== '' && (
        <ul className="picker__list" role="listbox" aria-label="Regions">
          {matches.length === 0 && <li className="picker__empty">No region matches that.</li>}
          {matches.map((group) => (
            <li key={group.id}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                className="picker__option"
                onMouseDown={() => {
                  if (blurTimer.current) window.clearTimeout(blurTimer.current)
                  commit(group.members)
                }}
              >
                <span className="picker__name">
                  {group.name}
                  {group.approximate ? ' ≈' : ''}
                  <span className="picker__detail">
                    {group.scheme === 'Country' ? 'Country' : `${group.scheme}, ${group.country}`}
                  </span>
                </span>
                <span className="picker__code">{group.members.length}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
