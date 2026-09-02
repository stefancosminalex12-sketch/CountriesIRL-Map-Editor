/**
 * Flag artwork, fetched on demand and held as data URIs.
 *
 * The data URI is the whole trick. A flag could be referenced as
 * `<image href="/flags/de.svg">`, which is smaller in the DOM — and completely blank
 * in every export, because an SVG rendered inside an `<img>` (which is how the
 * exporter rasterises) is sandboxed and may not fetch anything. Inlining the artwork
 * as a `data:` URI keeps it *inside* the document, so the same markup that draws on
 * screen also draws in the PNG, the JPG and the standalone SVG.
 *
 * It stays vector all the way through: the URI holds the library's real SVG, so the
 * SVG export is genuine vector artwork and the raster exports rasterise it at their
 * own resolution rather than upscaling a bitmap.
 *
 * One `<image>` element per country is the other half. Inlining 250 flags as live SVG
 * nodes would mean tens of thousands of paths — Serbia's coat of arms alone is 180 KB
 * — for artwork drawn 20 pixels wide. The browser rasterises each data URI once and
 * reuses it.
 *
 * Loading is lazy and cached forever: flags never change, so a code fetched once is
 * held for the session, and asking for it again returns the same promise rather than
 * a second request.
 */
import { create } from 'zustand'
import { FLAG_ALIASES, FLAG_CODES } from './manifest'

/** Whether artwork exists for a code, checked before anything is requested. */
export function hasFlag(iso2: string | null | undefined): boolean {
  return !!iso2 && FLAG_CODES.has(iso2.toLowerCase())
}

/**
 * The artwork code for an entity: the flag it actually flies.
 *
 * Almost always its own iso2. The exceptions are the non-sovereign entities named in
 * `scripts/territory-flags.mjs` — Somaliland and Northern Cyprus, which have their own
 * flag and no ISO code to find it by, and the administered territories that fly the
 * flag of the state administering them. Nothing is inferred here: an entity that is
 * not on that list and has no iso2 of its own resolves to nothing and keeps plain
 * land, which is the right answer for a contested bank or a buffer zone.
 */
export function flagCodeFor(id: string, iso2: string | null | undefined): string | undefined {
  return FLAG_ALIASES.get(id) ?? iso2?.toLowerCase()
}

/** In-flight and settled requests, so a code is only ever fetched once. */
const pending = new Map<string, Promise<void>>()

interface FlagStore {
  /** iso2 (lower case) -> `data:` URI. */
  flags: Record<string, string>
  /** Codes that failed to load; never retried, never rendered. */
  failed: Record<string, true>
  /** Requests any of these codes that are not already loaded or in flight. */
  request: (codes: Iterable<string>) => void
}

export const useFlagStore = create<FlagStore>((set, get) => ({
  flags: {},
  failed: {},

  request(codes) {
    for (const raw of codes) {
      const code = raw.toLowerCase()
      if (!FLAG_CODES.has(code)) continue
      if (get().flags[code] || get().failed[code] || pending.has(code)) continue

      const task = fetch(`${import.meta.env.BASE_URL}flags/${code}.svg`)
        .then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          return response.text()
        })
        .then((markup) => {
          /*
           * Percent-encoded rather than base64: it keeps the artwork readable in an
           * exported file, and avoids a base64 round trip on every flag.
           */
          const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`
          set((state) => ({ flags: { ...state.flags, [code]: uri } }))
        })
        .catch((error) => {
          // Loud in development, silent and harmless in production: the country simply
          // keeps its land colour.
          if (import.meta.env.DEV) console.warn(`[flags] ${code} failed to load`, error)
          set((state) => ({ failed: { ...state.failed, [code]: true } }))
        })
        .finally(() => {
          pending.delete(code)
        })

      pending.set(code, task)
    }
  },
}))
