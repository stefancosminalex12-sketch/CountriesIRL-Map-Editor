/**
 * Find Stickers: search the catalogue of open emoji and icons that ships with the editor.
 *
 * The catalogue is written at build time by `scripts/prepare-stickers.mjs` — one SVG per icon
 * and an index of names and categories — and fetched only when this panel is opened. Thumbnails
 * are plain lazily loaded images, so a search costs the handful of files it shows. Choosing one
 * reads its SVG into a data URI and adds it to the library, picked, ready to go into the tiers or
 * onto the selection.
 */
import { useEffect, useMemo, useState } from 'react'
import { useStickerLibrary } from '../stickers/stickerLibrary'

interface CatalogueSet {
  prefix: string
  label: string
  name: string
  author: string
  license: string
  categories: string[]
}

interface Catalogue {
  sets: CatalogueSet[]
  /** [set index, icon name, category index within the set] */
  icons: Array<[number, string, number]>
}

const BASE = `${import.meta.env.BASE_URL}stickers/`
let catalogue: Promise<Catalogue> | null = null

function loadCatalogue(): Promise<Catalogue> {
  catalogue ??= fetch(`${BASE}index.json`).then((response) => {
    if (!response.ok) throw new Error(`Catalogue unavailable (${response.status})`)
    return response.json() as Promise<Catalogue>
  })
  catalogue.catch(() => {
    catalogue = null
  })
  return catalogue
}

const PAGE = 60

/** `face-with-tears-of-joy` → `Face with tears of joy`. */
function prettyName(name: string): string {
  const words = name.replace(/-/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function StickerFinder() {
  const [data, setData] = useState<Catalogue | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('0:Smileys & Emotion')
  const [shown, setShown] = useState(PAGE)
  const [adding, setAdding] = useState<string | null>(null)
  const { uploads, add, pick } = useStickerLibrary()

  useEffect(() => {
    loadCatalogue().then(setData, (e: Error) => setError(e.message))
  }, [])

  const results = useMemo(() => {
    if (!data) return []
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    const [setFilter, categoryName] = category === 'all' ? [null, null] : [Number(category.split(':')[0]), category.slice(category.indexOf(':') + 1)]
    return data.icons.filter(([set, name, cat]) => {
      // A search looks everywhere; the category narrows only an empty search.
      if (words.length > 0) {
        const text = name.replace(/-/g, ' ')
        return words.every((word) => text.includes(word))
      }
      if (setFilter === null) return true
      return set === setFilter && data.sets[set].categories[cat] === categoryName
    })
  }, [data, query, category])

  useEffect(() => setShown(PAGE), [query, category])

  if (error) return <p className="hint hint--warn">The sticker catalogue could not be loaded: {error}</p>
  if (!data) return <p className="hint">Loading stickers…</p>

  const choose = async (set: CatalogueSet, name: string) => {
    const id = `user:icon-${set.prefix}-${name}`
    if (uploads.some((s) => s.id === id)) {
      pick(id)
      return
    }
    setAdding(id)
    try {
      const svg = await fetch(`${BASE}${set.prefix}/${name}.svg`).then((r) => {
        if (!r.ok) throw new Error(String(r.status))
        return r.text()
      })
      add([{ id, name: prettyName(name), src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` }])
      pick(id)
    } finally {
      setAdding(null)
    }
  }

  return (
    <div className="stack">
      <input
        className="input"
        type="search"
        placeholder="Search: crown, clock, money, fire…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        aria-label="Search stickers"
      />
      {query.trim() === '' && (
        <select className="input" value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Category">
          <option value="all">Everything</option>
          {data.sets.map((set, s) =>
            set.categories.map((name) => (
              <option key={`${s}:${name}`} value={`${s}:${name}`}>
                {set.label}: {name}
              </option>
            )),
          )}
        </select>
      )}

      <p className="hint">
        {results.length} found. Tap one to add it to your library.
      </p>

      <div className="sticker-grid sticker-grid--finder">
        {results.slice(0, shown).map(([set, name]) => {
          const source = data.sets[set]
          const id = `user:icon-${source.prefix}-${name}`
          return (
            <button
              key={id}
              type="button"
              className={`sticker-grid__item${adding === id ? ' sticker-grid__item--picked' : ''}`}
              title={prettyName(name)}
              onClick={() => void choose(source, name)}
            >
              <img className="sticker-thumb" src={`${BASE}${source.prefix}/${name}.svg`} alt={prettyName(name)} width={30} height={30} loading="lazy" draggable={false} />
            </button>
          )
        })}
      </div>
      {results.length > shown && (
        <button type="button" className="btn btn--ghost" onClick={() => setShown(shown + PAGE)}>
          Show more
        </button>
      )}
      <p className="hint">
        {data.sets.map((set) => `${set.name} by ${set.author} (${set.license})`).join(' · ')}. Free to use, including in
        videos.
      </p>
    </div>
  )
}
