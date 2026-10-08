/**
 * The sticker library: the built-in faces plus every image the author has uploaded.
 *
 * Not part of the map document, the same way flag artwork is not: the document says *which*
 * sticker a tier or a country uses, by id, and this is where the pictures live. Uploads are kept
 * in localStorage so they survive a refresh — the document itself does not yet — and so a set
 * uploaded once is there for every map made in this browser afterwards.
 *
 * Every upload is redrawn onto a canvas no larger than {@link MAX_EDGE} pixels and stored as a
 * PNG data URI. A sticker is drawn a few dozen pixels wide, so a phone photo or a 2000-pixel
 * render would only be spending the storage quota (about 5 MB per site) on detail nobody sees;
 * redrawn, a typical sticker is 10–40 KB and a hundred of them fit. SVG uploads are kept as they
 * are, since they are already small and stay sharp at any size.
 *
 * **Library faces are not stored at all.** A face from the gallery is named by what it is —
 * `face:<preset>:<colour>`, say `face:fire-punch:1b4fd8` — and drawn from that on demand
 * (`faceSticker`), the same face every time. So putting a face on a country, or changing its
 * colour ten times, spends no storage, and the index below answers for every such id.
 */
import { create } from 'zustand'
import { BUILTIN_FACES, BUILTIN_STICKERS } from './builtin'
import { DEFAULT_FACE, FACE_COLORS, faceDataUri, type FaceOptions } from './faceMaker'
import { FACE_PRESETS, presetFace, type FacePreset } from './facePresets'
import type { Sticker } from './types'

const STORAGE_KEY = 'map-editor.stickers.v1'

/** Longest edge an uploaded raster is stored at, in pixels. */
export const MAX_EDGE = 256

/**
 * Copies the editor used to store on its own — an emoji the moment it was tapped
 * (`user:icon-…`), a gallery face in each colour tried (`user:face-…`) — which filled the
 * author's own stickers with things they never chose to keep. Dropped on load unless the saved
 * tiers use them; emoji are now kept only for the session unless added to the tiers, and gallery
 * faces are drawn from their ids.
 */
const AUTO_SAVED = /^user:(icon|face)-/

/**
 * Whether a stored sticker is the author's own: an upload or one made in Create — not an emoji or
 * a face copy the editor stored by itself. Stickers stored before `origin` was recorded are judged
 * by what they are: copies of catalogue emoji are WebP (an upload is redrawn as PNG, a made face is
 * SVG), so a WebP with no origin is one of those, however it came to be saved.
 */
export const isOwnSticker = (s: Sticker) =>
  s.origin !== undefined || (!AUTO_SAVED.test(s.id) && !s.src.startsWith('data:image/webp'))

function ladderIds(): Set<string> {
  try {
    const parsed = JSON.parse(localStorage.getItem('map-editor.stickers.ladder.v1') ?? '[]') as unknown
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [])
  } catch {
    return new Set()
  }
}

function read(): Sticker[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const inLadder = ladderIds()
    const stickers = parsed.filter(
      (s): s is Sticker =>
        !!s &&
        typeof s.id === 'string' &&
        s.id.startsWith('user:') &&
        typeof s.name === 'string' &&
        typeof s.src === 'string' &&
        s.src.startsWith('data:image/'),
    )
    const kept = stickers.filter((s) => isOwnSticker(s) || inLadder.has(s.id))
    if (kept.length !== stickers.length) write(kept)
    return kept
  } catch {
    return []
  }
}

/** Stickers in the library for this session only — an emoji picked but not yet kept. */
const sessionOnly = new Set<string>()

/** Writes the uploads, and says whether they fitted. */
function write(uploads: Sticker[]): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(uploads.filter((s) => !sessionOnly.has(s.id))))
    return true
  } catch {
    return false
  }
}

interface StickerLibrary {
  uploads: Sticker[]
  /**
   * The sticker picked in the panel, shared by the Library, Find and Create parts so a sticker
   * found or made is the one the next action applies to. Not saved.
   */
  pickedId: string | null
  pick: (id: string | null) => void
  /**
   * The colour stickers are put on in — `#rrggbb`, or `'flag'` — set by the Stickers panel's one
   * colour row, which also recolours the stickers on the selected countries. Not saved.
   */
  colour: string
  setColour: (colour: string) => void
  /** The face open in Create → Face maker, so the gallery can hand a preset to it. Not saved. */
  face: FaceOptions
  setFace: (face: FaceOptions) => void
  /**
   * Adds stickers; returns false when the browser would not store them (they still work until a
   * refresh). With `save` false they are kept for this session only, until `keep` saves them.
   */
  add: (stickers: Sticker[], save?: boolean) => boolean
  /** Saves a session-only sticker, so it outlasts a refresh — done when it joins the tiers. */
  keep: (id: string) => void
  remove: (id: string) => void
  rename: (id: string, name: string) => void
}

export const useStickerLibrary = create<StickerLibrary>((set, get) => ({
  uploads: read(),
  pickedId: null,
  pick: (pickedId) => set({ pickedId }),
  colour: FACE_COLORS[1].color,
  setColour: (colour) => set({ colour }),
  face: DEFAULT_FACE,
  setFace: (face) => set({ face }),
  add: (stickers, save = true) => {
    if (!save) for (const s of stickers) sessionOnly.add(s.id)
    const uploads = [...get().uploads, ...stickers]
    set({ uploads })
    return write(uploads)
  },
  keep: (id) => {
    if (!sessionOnly.delete(id)) return
    write(get().uploads)
  },
  remove: (id) => {
    sessionOnly.delete(id)
    const uploads = get().uploads.filter((s) => s.id !== id)
    set({ uploads, pickedId: get().pickedId === id ? null : get().pickedId })
    write(uploads)
  },
  rename: (id, name) => {
    const uploads = get().uploads.map((s) => (s.id === id ? { ...s, name } : s))
    set({ uploads })
    write(uploads)
  },
}))

const LADDER_KEY = 'map-editor.stickers.ladder.v1'

/**
 * The tiers last set up in this browser, or null for none.
 *
 * A new map starts from them, so a set of uploaded faces arranged once is still arranged after
 * a refresh — the document is not kept yet, and without this every reload would put the
 * built-in faces back. Ids whose upload has since been deleted are dropped.
 */
export function savedLadder(): string[] | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(LADDER_KEY) ?? 'null') as unknown
    if (!Array.isArray(parsed)) return null
    const known = stickerIndex(read())
    const ladder = parsed.filter((id): id is string => typeof id === 'string' && known.has(id))
    return ladder.length > 0 ? ladder : null
  } catch {
    return null
  }
}

export function saveLadder(ladder: string[]): void {
  try {
    localStorage.setItem(LADDER_KEY, JSON.stringify(ladder))
  } catch {
    // Private browsing or a full quota: the tiers simply are not remembered.
  }
}

/** Every sticker on offer, built-in first. */
export function allStickers(uploads: Sticker[]): Sticker[] {
  return [...BUILTIN_STICKERS, ...uploads]
}

/* ------------------------------------------------------------ library faces */

const FACE_ID = /^face:([a-z0-9-]+):([0-9a-f]{6}|flag)$/

/**
 * The id of a library face in a colour: `face:fire-punch:1b4fd8` — or `face:fire-punch:flag`, the
 * face in the flag of whichever territory wears it (the map fills each one in; see `MapCanvas`).
 */
export function faceStickerId(presetId: string, color: string): string {
  return `face:${presetId}:${color === 'flag' ? 'flag' : color.replace('#', '').toLowerCase()}`
}

/** A library face id's preset and colour, or null for any other id. */
export function parseFaceSticker(id: string): { preset: FacePreset; color: string } | null {
  const match = FACE_ID.exec(id)
  if (!match) return null
  const preset = FACE_PRESETS.find((p) => p.id === match[1])
  return preset ? { preset, color: match[2] === 'flag' ? 'flag' : `#${match[2]}` } : null
}

/**
 * The face and colour any face sticker is — a library face, a built-in tier face, or one of the
 * older stored face copies (`user:face-<preset>-<colour>`) — or null for a picture that is not a
 * face. What lets a face be recoloured wherever it came from.
 */
export function faceOf(stickerId: string): { preset: FacePreset; color: string } | null {
  const face = parseFaceSticker(stickerId)
  if (face) return face
  const builtin = BUILTIN_FACES.get(stickerId)
  const legacy = /^user:face-([a-z0-9-]+)-([0-9a-f]{6})$/.exec(stickerId)
  const presetId = builtin?.presetId ?? legacy?.[1]
  const color = builtin?.color ?? (legacy ? `#${legacy[2]}` : null)
  const preset = presetId ? FACE_PRESETS.find((p) => p.id === presetId) : undefined
  return preset && color ? { preset, color } : null
}

export function colourName(color: string): string {
  if (color === 'flag') return 'Flag'
  return FACE_COLORS.find((c) => c.color === color.toLowerCase())?.name ?? color.toLowerCase()
}

const flagFaces = new Map<string, Sticker>()

/**
 * A flag face as worn by one territory: the face filled with `flagSrc`, the artwork of the flag it
 * flies. Drawn once per face and flag, and kept.
 */
export function flagFaceSticker(stickerId: string, code: string, flagSrc: string): Sticker | undefined {
  const key = `${stickerId}@${code}`
  const known = flagFaces.get(key)
  if (known) return known
  const face = parseFaceSticker(stickerId)
  if (!face || face.color !== 'flag') return undefined
  const sticker = { id: key, name: face.preset.name, src: faceDataUri({ ...presetFace(face.preset, 'flag'), flagHref: flagSrc }) }
  flagFaces.set(key, sticker)
  return sticker
}

const faces = new Map<string, Sticker>()

/** A library face as a sticker, drawn the first time it is asked for and kept. */
export function faceSticker(id: string): Sticker | undefined {
  const known = faces.get(id)
  if (known) return known
  const face = parseFaceSticker(id)
  if (!face) return undefined
  const sticker = { id, name: `${face.preset.name} (${colourName(face.color)})`, src: faceDataUri(presetFace(face.preset, face.color)) }
  faces.set(id, sticker)
  return sticker
}

/** The built-in faces and the uploads by id — and every library face, drawn when first asked for. */
class StickerIndex extends Map<string, Sticker> {
  override get(id: string): Sticker | undefined {
    return super.get(id) ?? faceSticker(id)
  }
  override has(id: string): boolean {
    return super.has(id) || parseFaceSticker(id) !== null
  }
}

/** Stickers by id, for the renderer and the panels. */
export function stickerIndex(uploads: Sticker[]): Map<string, Sticker> {
  return new StickerIndex(allStickers(uploads).map((s) => [s.id, s]))
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'))
    reader.readAsDataURL(file)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Not an image the browser can read'))
    image.src = src
  })
}

/** A name from a file name: `hard-face_02.png` → `hard face 02`. */
function nameFromFile(file: File): string {
  const base = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim()
  return base || 'Sticker'
}

let counter = 0
export function newId(): string {
  counter += 1
  return `user:${Date.now().toString(36)}-${counter.toString(36)}`
}

/**
 * Turns one uploaded file into a sticker.
 *
 * Rasters are drawn onto a canvas at most {@link MAX_EDGE} pixels on their longest edge, keeping
 * their transparency, and stored as PNG. SVGs are stored as uploaded.
 */
export async function stickerFromFile(file: File): Promise<Sticker> {
  if (!file.type.startsWith('image/')) throw new Error(`${file.name} is not an image`)
  const original = await readAsDataUrl(file)
  const name = nameFromFile(file)
  if (file.type === 'image/svg+xml') return { id: newId(), name, src: original, origin: 'upload' }

  const image = await loadImage(original)
  const longest = Math.max(image.naturalWidth, image.naturalHeight)
  if (!longest) throw new Error(`${file.name} has no size`)
  const scale = Math.min(1, MAX_EDGE / longest)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const context = canvas.getContext('2d')
  if (!context) return { id: newId(), name, src: original, origin: 'upload' }
  context.imageSmoothingQuality = 'high'
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return { id: newId(), name, src: canvas.toDataURL('image/png'), origin: 'upload' }
}
