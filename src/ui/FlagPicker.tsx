/**
 * A flag picked by typing its name.
 *
 * The same control as `CountryPicker` — an input over a filtered list, matching on name or code,
 * committing on click or Enter — over flags rather than over the entities of the map on screen.
 * That is the difference that matters: a region of the administrative map, or a state, carries no
 * flag of its own, so a list of the map's entities would offer nothing to choose. The choices come
 * from `flagOptions`, the one list the Flags panel, the Merge panel and the overlays all share.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { FlagOption } from '../flags/flagChoices'

/** How many matches are offered at once. Enough to choose from, short enough to scan. */
const MAX_MATCHES = 40

export interface FlagPickerProps {
  label: string
  /** The artwork code chosen, or null when there is none yet. */
  value: string | null
  options: readonly FlagOption[]
  onChange: (code: string) => void
  placeholder?: string
  /** Opens the list at once, with the field focused — for when a flag has to be chosen now. */
  autoOpen?: boolean
}

export function FlagPicker({ label, value, options, onChange, placeholder = 'Type a flag’s name…', autoOpen = false }: FlagPickerProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const blurTimer = useRef<number | null>(null)

  useEffect(() => {
    if (!autoOpen) return
    input.current?.focus()
    setOpen(true)
  }, [autoOpen])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options.slice(0, MAX_MATCHES)
    // Names that start with the query first, then names that merely contain it — as `CountryPicker` does.
    const starts: FlagOption[] = []
    const contains: FlagOption[] = []
    for (const option of options) {
      const name = option.name.toLowerCase()
      if (name.startsWith(q) || option.code === q) starts.push(option)
      else if (name.includes(q)) contains.push(option)
    }
    return [...starts, ...contains].slice(0, MAX_MATCHES)
  }, [options, query])

  const current = value ? options.find((option) => option.code === value) : null

  const commit = (code: string) => {
    onChange(code)
    setQuery('')
    setOpen(false)
  }

  return (
    <div className="field picker">
      <span className="field__label">{label}</span>
      <input
        ref={input}
        className="input"
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-label={label}
        autoComplete="off"
        // The current choice shows as the placeholder, so the field is always ready to be typed into.
        placeholder={current ? current.name : value ? value.toUpperCase() : placeholder}
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
            commit(matches[0].code)
          } else if (event.key === 'Escape') {
            setQuery('')
            setOpen(false)
          }
        }}
      />

      {open && (
        <ul className="picker__list" role="listbox" aria-label={label}>
          {matches.length === 0 && <li className="picker__empty">No flag matches that.</li>}
          {matches.map((option) => (
            <li key={option.code}>
              <button
                type="button"
                role="option"
                aria-selected={option.code === value}
                className={`picker__option${option.code === value ? ' picker__option--on' : ''}`}
                onMouseDown={() => {
                  // Mouse-down rather than click: the blur above would otherwise close the list under the press.
                  if (blurTimer.current) window.clearTimeout(blurTimer.current)
                  commit(option.code)
                }}
              >
                <span className="picker__name">{option.name}</span>
                <span className="picker__code">{option.code.toUpperCase()}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
