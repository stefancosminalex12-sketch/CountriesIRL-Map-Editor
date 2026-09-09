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

/**
 * Artwork that has arrived but has not been published to the store yet.
 *
 * Two hundred and sixty-five flags arrive as two hundred and sixty-five separate
 * responses, and each one used to be its own `set`. Every subscriber re-rendered on
 * each: the canvas rebuilding all 254 country paths, `FlagPatterns` rebuilding all 265
 * `<pattern>` elements — a quarter of a million element creations to publish a quarter
 * of a megabyte of URIs, and a fresh clone of a growing record each time, which is
 * quadratic in the number of flags.
 *
 * On a desktop that was ~700 ms of the main thread locked up on first entering the
 * mode. On a phone it is the freeze-reload-crash the mode was reported for.
 *
 * So arrivals are collected here and published together. Nothing about *what* is
 * published changes — the same codes reach the same record, in the order they loaded —
 * only how many renders it takes to get there, which goes from one per flag to one per
 * frame.
 */
const arrived = new Map<string, string>()
const missing = new Set<string>()
let flushHandle: number | null = null

/**
 * Publishes whatever has arrived since the last flush.
 *
 * Scheduled on the next frame, with a timer as the fallback: `requestAnimationFrame`
 * does not run in a backgrounded tab, and a flag that loaded while the tab was hidden
 * must still be on the map when it comes back rather than waiting for a repaint that
 * has already been skipped.
 */
function scheduleFlush(set: (fn: (state: FlagStore) => Partial<FlagStore>) => void) {
  if (flushHandle !== null) return

  const flush = () => {
    flushHandle = null
    if (arrived.size === 0 && missing.size === 0) return

    const loaded = [...arrived]
    const failures = [...missing]
    arrived.clear()
    missing.clear()

    set((state) => {
      const next: Partial<FlagStore> = {}
      if (loaded.length > 0) {
        const flags = { ...state.flags }
        for (const [code, uri] of loaded) flags[code] = uri
        next.flags = flags
      }
      if (failures.length > 0) {
        const failed = { ...state.failed }
        for (const code of failures) failed[code] = true
        next.failed = failed
      }
      return next
    })
  }

  const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null
  /*
   * Both are armed, and whichever runs first clears the handle so the other finds
   * nothing to publish. The timer is not a delay anyone waits on — a frame normally
   * beats it — it is the guarantee that a hidden tab still settles.
   */
  const timer = setTimeout(flush, 100)
  if (raf) raf(() => { clearTimeout(timer); flush() })
  flushHandle = timer as unknown as number
}

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
      /*
       * `arrived` and `missing` are consulted alongside the store because publication
       * is now deferred by up to a frame: the fetch has settled and `pending` has
       * already released the code, but the record it will land in has not been written
       * yet. Without them that window is a second request for artwork already in hand.
       */
      if (get().flags[code] || get().failed[code] || pending.has(code)) continue
      if (arrived.has(code) || missing.has(code)) continue

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
          arrived.set(code, uri)
          scheduleFlush(set)
        })
        .catch((error) => {
          // Loud in development, silent and harmless in production: the country simply
          // keeps its land colour.
          if (import.meta.env.DEV) console.warn(`[flags] ${code} failed to load`, error)
          missing.add(code)
          scheduleFlush(set)
        })
        .finally(() => {
          pending.delete(code)
        })

      pending.set(code, task)
    }
  },
}))
