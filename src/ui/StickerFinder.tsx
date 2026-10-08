/**
 * Find Stickers: search the catalogue of 3D emoji that ships with the editor, in any colour.
 *
 * The catalogue is written at build time by `scripts/prepare-stickers.mjs` — one image per emoji
 * and an index of names and categories — and fetched only when this panel is opened. Thumbnails
 * are lazily loaded images, so a search costs the handful of files it shows.
 *
 * **Colour** works the way a recolourable emoji site does: pick blue and every face in the grid
 * turns blue, shading kept (see `stickers/recolor.ts`); tap one and it is picked in
 * that colour. Only the thumbnails on screen are recoloured, each once per colour.
 */
import { memo, useEffect, useMemo, useState } from 'react'
import { useStickerLibrary } from '../stickers/stickerLibrary'
import { recolorSticker } from '../stickers/recolor'
import { FACE_COLORS } from '../stickers/faceMaker'
import { StickerColorRow } from './StickerColorRow'
import { PickedStickerActions } from './StickerLibrary'
import { swapChosenSticker } from './useSelectionStickers'

interface CatalogueSet {
  prefix: string
  label: string
  ext?: string
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

const urlOf = (set: CatalogueSet, name: string) => `${BASE}${set.prefix}/${name}.${set.ext ?? 'svg'}`

/** Recoloured thumbnails, by `url|colour`, kept for the session. */
const recoloured = new Map<string, Promise<string>>()
function recolouredUrl(url: string, color: string): Promise<string> {
  const key = `${url}|${color}`
  let task = recoloured.get(key)
  if (!task) {
    task = recolorSticker(url, color)
    recoloured.set(key, task)
    task.catch(() => recoloured.delete(key))
  }
  return task
}

const PAGE = 60

/** `face-with-tears-of-joy` → `Face with tears of joy`. */
function prettyName(name: string): string {
  const words = name.replace(/-/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

const FinderThumb = memo(function FinderThumb({ url, color, alt }: { url: string; color: string | null; alt: string }) {
  const [src, setSrc] = useState<string | null>(color ? null : url)
  useEffect(() => {
    if (!color) {
      setSrc(url)
      return
    }
    let live = true
    setSrc(null)
    recolouredUrl(url, color).then(
      (uri) => live && setSrc(uri),
      () => live && setSrc(url),
    )
    return () => {
      live = false
    }
  }, [url, color])
  if (!src) return <span className="sticker-thumb sticker-thumb--loading" style={{ width: 34, height: 34 }} />
  return <img className="sticker-thumb" src={src} alt={alt} width={34} height={34} loading="lazy" draggable={false} />
})

export function StickerFinder() {
  const [data, setData] = useState<Catalogue | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('0:Smileys & Emotion')
  const [color, setColor] = useState<string | null>(null)
  const [shown, setShown] = useState(PAGE)
  const [adding, setAdding] = useState<string | null>(null)
  const { uploads, add, pick } = useStickerLibrary()

  useEffect(() => {
    loadCatalogue().then(setData, (e: Error) => setError(e.message))
  }, [])

  const results = useMemo(() => {
    if (!data) return []
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    const [setFilter, categoryName] =
      category === 'all' ? [null, null] : [Number(category.split(':')[0]), category.slice(category.indexOf(':') + 1)]
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

  const colourName = color ? (FACE_COLORS.find((c) => c.color === color)?.name ?? color) : null

  const choose = async (set: CatalogueSet, name: string) => {
    const id = `user:icon-${set.prefix}-${name}${color ? `-${color.slice(1)}` : ''}`
    if (uploads.some((s) => s.id === id)) {
      pick(id)
      swapChosenSticker(id)
      return
    }
    setAdding(id)
    try {
      const url = urlOf(set, name)
      const src = color
        ? await recolouredUrl(url, color)
        : await fetch(url).then((r) => {
            if (!r.ok) throw new Error(String(r.status))
            return r.blob().then(readAsDataUrl)
          })
      // Picked for this session; kept only if it joins the tiers (see `keep`).
      add([{ id, name: colourName ? `${prettyName(name)} (${colourName})` : prettyName(name), src }], false)
      pick(id)
      // A sticker chosen on the map takes this one instead.
      swapChosenSticker(id)
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
                {name}
              </option>
            )),
          )}
        </select>
      )}

      <div className="stack sticker-parts">
        <span className="sidebar__group-label">Colour</span>
        <StickerColorRow value={color} onChange={setColor} allowOriginal />
      </div>

      <p className="hint">
        {results.length} found. Tap one to pick it{colourName ? ` in ${colourName.toLowerCase()}` : ''}, then put it on the selection below.
      </p>

      <div className="sticker-grid sticker-grid--finder">
        {results.slice(0, shown).map(([set, name]) => {
          const source = data.sets[set]
          const id = `${source.prefix}-${name}`
          return (
            <button
              key={id}
              type="button"
              className={`sticker-grid__item${adding?.startsWith(`user:icon-${id}`) ? ' sticker-grid__item--picked' : ''}`}
              title={prettyName(name)}
              onClick={() => void choose(source, name)}
            >
              <FinderThumb url={urlOf(source, name)} color={color} alt={prettyName(name)} />
            </button>
          )
        })}
      </div>
      {results.length > shown && (
        <button type="button" className="btn btn--ghost" onClick={() => setShown(shown + PAGE)}>
          Show more
        </button>
      )}
      <PickedStickerActions />
      <p className="hint">
        {data.sets.map((set) => `${set.name} by ${set.author} (${set.license})`).join(' · ')}. Free to use, including in
        videos.
      </p>
    </div>
  )
}
