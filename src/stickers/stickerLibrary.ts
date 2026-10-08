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
import { BUILTIN_STICKERS } from './builtin'
import { DEFAULT_FACE, FACE_COLORS, faceDataUri, type FaceOptions } from './faceMaker'
import { FACE_PRESETS, presetFace, type FacePreset } from './facePresets'
import type { Sticker } from './types'

const STORAGE_KEY = 'map-editor.stickers.v1'

/** Longest edge an uploaded raster is stored at, in pixels. */
export const MAX_EDGE = 256

function read(): Sticker[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (s): s is Sticker =>
        !!s &&
        typeof s.id === 'string' &&
        s.id.startsWith('user:') &&
        typeof s.name === 'string' &&
        typeof s.src === 'string' &&
        s.src.startsWith('data:image/'),
    )
  } catch {
    return []
  }
}

/** Writes the uploads, and says whether they fitted. */
function write(uploads: Sticker[]): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(uploads))
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
  /** The face open in Create → Face maker, so the gallery can hand a preset to it. Not saved. */
  face: FaceOptions
  setFace: (face: FaceOptions) => void
  /** Adds stickers; returns false when the browser would not store them (they still work until a refresh). */
  add: (stickers: Sticker[]) => boolean
  remove: (id: string) => void
  rename: (id: string, name: string) => void
}

export const useStickerLibrary = create<StickerLibrary>((set, get) => ({
  uploads: read(),
  pickedId: null,
  pick: (pickedId) => set({ pickedId }),
  face: DEFAULT_FACE,
  setFace: (face) => set({ face }),
  add: (stickers) => {
    const uploads = [...get().uploads, ...stickers]
    set({ uploads })
    return write(uploads)
  },
  remove: (id) => {
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

const FACE_ID = /^face:([a-z0-9-]+):([0-9a-f]{6})$/

/** The id of a library face in a colour: `face:fire-punch:1b4fd8`. */
export function faceStickerId(presetId: string, color: string): string {
  return `face:${presetId}:${color.replace('#', '').toLowerCase()}`
}

/** A library face id's preset and colour, or null for any other id. */
export function parseFaceSticker(id: string): { preset: FacePreset; color: string } | null {
  const match = FACE_ID.exec(id)
  if (!match) return null
  const preset = FACE_PRESETS.find((p) => p.id === match[1])
  return preset ? { preset, color: `#${match[2]}` } : null
}

export function colourName(color: string): string {
  return FACE_COLORS.find((c) => c.color === color.toLowerCase())?.name ?? color.toLowerCase()
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
  if (file.type === 'image/svg+xml') return { id: newId(), name, src: original }

  const image = await loadImage(original)
  const longest = Math.max(image.naturalWidth, image.naturalHeight)
  if (!longest) throw new Error(`${file.name} has no size`)
  const scale = Math.min(1, MAX_EDGE / longest)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const context = canvas.getContext('2d')
  if (!context) return { id: newId(), name, src: original }
  context.imageSmoothingQuality = 'high'
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return { id: newId(), name, src: canvas.toDataURL('image/png') }
}
