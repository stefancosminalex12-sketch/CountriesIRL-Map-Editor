/**
 * A territory found by typing its name — the header's Search and the Overlay tool's search.
 *
 * It offers what the map draws: the open dataset's entities — countries, or subdivisions on an
 * administrative map — and each merged body under its own name, in place of its members. Names
 * that start with what was typed come first, then names that contain it, then codes. Arrow keys
 * move through the matches and Enter takes the highlighted one.
 */
import { useMemo, useState, type ReactNode } from 'react'
import { useMapStore } from '../state/mapStore'

/** How many matches are offered at once. Enough to choose from, short enough to scan. */
const MAX_MATCHES = 30

export function EntitySearch({
  onChoose,
  placeholder = 'Search a country or region…',
  autoFocus = false,
  label = 'Search',
  trailing,
  exclude,
}: {
  onChoose: (id: string) => void
  placeholder?: string
  autoFocus?: boolean
  label?: string
  /** A control at the field's right end, inside the same row — Merge's ✓. */
  trailing?: ReactNode
  /** Entities not to offer: ones already picked, or that cannot be. */
  exclude?: (id: string) => boolean
}) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const geo = useMapStore((s) => s.geo)
  const merges = useMapStore((s) => s.doc.merges)

  const entries = useMemo(() => {
    if (!geo) return []
    const merged = merges.filter((m) => m.merged)
    const inMerge = new Set(merged.flatMap((m) => m.members))
    const out = Object.entries(geo.meta)
      .filter(([id]) => !inMerge.has(id))
      // Not every entity is named — a dataset can carry one without — so the id stands in.
      .map(([id, meta]) => ({ id, name: meta?.name || id, code: meta?.iso2 ?? '' }))
    for (const m of merged) out.push({ id: m.id, name: m.name || m.id, code: '' })
    return out.sort((a, b) => a.name.localeCompare(b.name))
  }, [geo, merges])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const starts: typeof entries = []
    const contains: typeof entries = []
    const codes: typeof entries = []
    for (const entry of entries) {
      if (exclude?.(entry.id)) continue
      const name = entry.name.toLowerCase()
      if (name.startsWith(q)) starts.push(entry)
      else if (name.includes(q)) contains.push(entry)
      else if (entry.id.toLowerCase() === q || entry.code.toLowerCase() === q) codes.push(entry)
    }
    return [...starts, ...contains, ...codes].slice(0, MAX_MATCHES)
  }, [entries, query, exclude])

  const choose = (id: string) => {
    setQuery('')
    setActive(0)
    onChoose(id)
  }

  return (
    <div className="map-search">
      <div className="map-search__row">
      <input
        className="input"
        type="search"
        autoFocus={autoFocus}
        autoComplete="off"
        role="combobox"
        aria-expanded={matches.length > 0}
        aria-label={label}
        placeholder={placeholder}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setActive(0)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setActive((i) => Math.min(i + 1, matches.length - 1))
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            setActive((i) => Math.max(i - 1, 0))
          } else if (event.key === 'Enter' && matches[active]) {
            event.preventDefault()
            choose(matches[active].id)
          }
        }}
      />
      {trailing}
      </div>
      {query.trim() && (
        <ul className="map-search__list" role="listbox" aria-label="Matches">
          {matches.length === 0 && <li className="picker__empty">No matches.</li>}
          {matches.map((entry, index) => (
            <li key={entry.id}>
              <button
                type="button"
                role="option"
                aria-selected={index === active}
                className={`picker__option${index === active ? ' picker__option--on' : ''}`}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(entry.id)}
              >
                <span className="picker__name">{entry.name}</span>
                <span className="picker__code">{entry.code.toUpperCase() || entry.id}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
