/**
 * The built-in stickers: six original faces, one per mood, from furious to starstruck.
 *
 * Drawn here as SVG and handed out as `data:` URIs, for the same reason flag artwork is (see
 * `flags/flagStore.ts`): an image the map references by URL is blank in every export, because the
 * exporter rasterises the map inside an `<img>`, which may not fetch anything. A data URI is
 * already inside the document, so what draws on screen also draws in the PNG, the JPG and the SVG.
 *
 * Ordered lowest to highest, which is the order the default ladder uses: the lowest value on the
 * map gets the furious face and the highest the starstruck one. Each face is its own colour as
 * well as its own expression, so the tiers stay apart for a reader who cannot tell the colours
 * apart, and at sizes too small to read an expression.
 */
import type { Sticker } from './types'

/** The ring, the shaded body and the shine every face shares. */
function face(top: string, bottom: string, features: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<defs><radialGradient id="g" cx="0.4" cy="0.32" r="0.75"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></radialGradient></defs>
<circle cx="50" cy="50" r="45" fill="url(#g)" stroke="#141414" stroke-width="6"/>
<ellipse cx="38" cy="22" rx="17" ry="7" fill="#ffffff" opacity="0.35" transform="rotate(-18 38 22)"/>
${features}
</svg>`.replace(/\n/g, '')
}

/** An eye: white, outlined, with its pupil nudged by `dx`, `dy`. */
const eye = (cx: number, cy: number, dx = 0, dy = 0, ry = 9) =>
  `<ellipse cx="${cx}" cy="${cy}" rx="7.5" ry="${ry}" fill="#ffffff" stroke="#141414" stroke-width="2.5"/>` +
  `<circle cx="${cx + dx}" cy="${cy + dy}" r="3.6" fill="#141414"/>`

/** A five-pointed star centred on `cx`, `cy`. */
function star(cx: number, cy: number, r: number): string {
  const points: string[] = []
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? r : r * 0.45
    const angle = -Math.PI / 2 + (i * Math.PI) / 5
    points.push(`${(cx + radius * Math.cos(angle)).toFixed(1)},${(cy + radius * Math.sin(angle)).toFixed(1)}`)
  }
  return `<polygon points="${points.join(' ')}" fill="#fff59d" stroke="#141414" stroke-width="2.5" stroke-linejoin="round"/>`
}

const SVGS: Array<{ id: string; name: string; svg: string }> = [
  {
    id: 'builtin:furious',
    name: 'Furious',
    svg: face(
      '#ff7a6b',
      '#c62828',
      eye(36, 48, 2, 2) +
        eye(64, 48, -2, 2) +
        '<path d="M24 34 L44 42 M76 34 L56 42" stroke="#141414" stroke-width="5" stroke-linecap="round"/>' +
        '<path d="M34 76 Q50 62 66 76" fill="none" stroke="#141414" stroke-width="5" stroke-linecap="round"/>',
    ),
  },
  {
    id: 'builtin:sad',
    name: 'Sad',
    svg: face(
      '#ffc266',
      '#ef6c00',
      eye(37, 47, 0, 3) +
        eye(63, 47, 0, 3) +
        '<path d="M27 37 Q33 31 43 33 M73 37 Q67 31 57 33" fill="none" stroke="#141414" stroke-width="4" stroke-linecap="round"/>' +
        '<path d="M37 73 Q50 65 63 73" fill="none" stroke="#141414" stroke-width="4.5" stroke-linecap="round"/>',
    ),
  },
  {
    id: 'builtin:meh',
    name: 'Meh',
    svg: face(
      '#fff59d',
      '#f9a825',
      eye(37, 47, 0, 2, 6) +
        eye(63, 47, 0, 2, 6) +
        '<path d="M28 41 H46 M54 41 H72" stroke="#141414" stroke-width="4" stroke-linecap="round"/>' +
        '<path d="M37 70 H63" stroke="#141414" stroke-width="4.5" stroke-linecap="round"/>',
    ),
  },
  {
    id: 'builtin:happy',
    name: 'Happy',
    svg: face(
      '#9be37c',
      '#2e7d32',
      eye(37, 45) +
        eye(63, 45) +
        '<path d="M32 63 Q50 80 68 63" fill="none" stroke="#141414" stroke-width="5" stroke-linecap="round"/>',
    ),
  },
  {
    id: 'builtin:joyful',
    name: 'Joyful',
    svg: face(
      '#8fe3ff',
      '#0277bd',
      eye(37, 42, 0, -1) +
        eye(63, 42, 0, -1) +
        '<path d="M27 58 Q50 92 73 58 Z" fill="#3b0d1a" stroke="#141414" stroke-width="4" stroke-linejoin="round"/>' +
        '<path d="M38 74 Q50 66 62 74 Q56 84 50 84 Q44 84 38 74 Z" fill="#ff6f91"/>' +
        '<path d="M30 59 H70" stroke="#ffffff" stroke-width="4" stroke-linecap="round"/>',
    ),
  },
  {
    id: 'builtin:starstruck',
    name: 'Starstruck',
    svg: face(
      '#e1a6ff',
      '#6a1b9a',
      star(36, 43, 12) +
        star(64, 43, 12) +
        '<path d="M27 60 Q50 92 73 60 Z" fill="#3b0d1a" stroke="#141414" stroke-width="4" stroke-linejoin="round"/>' +
        '<path d="M38 75 Q50 67 62 75 Q56 85 50 85 Q44 85 38 75 Z" fill="#ff6f91"/>' +
        '<path d="M30 61 H70" stroke="#ffffff" stroke-width="4" stroke-linecap="round"/>',
    ),
  },
]

export const BUILTIN_STICKERS: Sticker[] = SVGS.map(({ id, name, svg }) => ({
  id,
  name,
  src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
  builtin: true,
}))

/** The ladder a new map starts with: every built-in face, lowest value first. */
export const DEFAULT_STICKER_LADDER: string[] = BUILTIN_STICKERS.map((s) => s.id)
