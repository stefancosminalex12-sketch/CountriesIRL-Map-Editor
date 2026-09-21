/**
 * A country picked by typing its name.
 *
 * A `<select>` would have been less code, but a native one only matches on the first
 * letters of an option and there are 250 of them: finding "Netherlands" means holding
 * N and watching the list cycle. Typing "neth" is the whole point of the control, so it
 * is an input over a filtered list.
 *
 * Deliberately small. It filters, it matches on name or code, and it commits on click
 * or Enter — no grouping, no recents, no remote search. The list is short enough that
 * anything more would be scaffolding around a control that already answers in two
 * keystrokes.
 */
import { useMemo, useRef, useState } from 'react'
import { useMapStore } from '../state/mapStore'
import type { CountryId } from '../types/map'

/** How many matches are offered at once. Enough to choose from, short enough to scan. */
const MAX_MATCHES = 40

export interface CountryPickerProps {
  label: string
  /** The current choice, or null when nothing has been picked yet. */
  value: CountryId | null
  onChange: (id: CountryId) => void
  /** Only countries this returns true for are offered. */
  filter?: (id: CountryId) => boolean
  placeholder?: string
}

export function CountryPicker({
  label,
  value,
  onChange,
  filter,
  placeholder = 'Type a country name…',
}: CountryPickerProps) {
  const geo = useMapStore((s) => s.geo)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const blurTimer = useRef<number | null>(null)

  /*
   * Derived from the loaded dataset rather than a list of its own, so the picker offers
   * exactly the countries the map can draw — a coarser dataset offers fewer, and neither
   * list can drift from the other because there is only one.
   */
  const countries = useMemo(() => {
    if (!geo) return []
    return Object.entries(geo.meta)
      .filter(([id]) => !filter || filter(id))
      .map(([id, meta]) => ({ id, name: meta.name, iso2: meta.iso2 }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [geo, filter])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return countries.slice(0, MAX_MATCHES)
    /*
     * Names that *start* with the query first, then names that merely contain it.
     * Typing "ind" should offer India before the British Indian Ocean Territory, and a
     * plain substring match sorts alphabetically and buries it.
     */
    const starts: typeof countries = []
    const contains: typeof countries = []
    for (const c of countries) {
      const name = c.name.toLowerCase()
      if (name.startsWith(q) || c.id.toLowerCase() === q) starts.push(c)
      else if (name.includes(q) || (c.iso2 ?? '').toLowerCase() === q) contains.push(c)
    }
    return [...starts, ...contains].slice(0, MAX_MATCHES)
  }, [countries, query])

  const selected = value && geo ? geo.meta[value] : null

  const commit = (id: CountryId) => {
    onChange(id)
    setQuery('')
    setOpen(false)
  }

  return (
    <div className="field picker">
      <span className="field__label">{label}</span>
      <input
        className="input"
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-label={label}
        autoComplete="off"
        // The current choice shows as the placeholder rather than as the value, so the
        // field is always ready to be typed into without clearing it first.
        placeholder={selected ? selected.name : placeholder}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // Deferred, or the list unmounts before a click on it can land.
          blurTimer.current = window.setTimeout(() => setOpen(false), 120)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && matches.length > 0) {
            event.preventDefault()
            commit(matches[0].id)
          } else if (event.key === 'Escape') {
            setQuery('')
            setOpen(false)
          }
        }}
      />

      {open && (
        <ul className="picker__list" role="listbox" aria-label={label}>
          {matches.length === 0 && <li className="picker__empty">No country matches that.</li>}
          {matches.map((country) => (
            <li key={country.id}>
              <button
                type="button"
                role="option"
                aria-selected={country.id === value}
                className={`picker__option${country.id === value ? ' picker__option--on' : ''}`}
                onMouseDown={() => {
                  // Mouse-down rather than click: the blur above would otherwise close
                  // the list out from under the press.
                  if (blurTimer.current) window.clearTimeout(blurTimer.current)
                  commit(country.id)
                }}
              >
                <span className="picker__name">{country.name}</span>
                <span className="picker__code">{country.id}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
