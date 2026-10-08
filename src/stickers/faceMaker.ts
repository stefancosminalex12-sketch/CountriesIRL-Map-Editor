/**
 * The face maker: a glossy round face assembled from parts, in any colour.
 *
 * Original artwork, drawn here as SVG. A face is a colour and one choice from each part list
 * — eyes, brows, mouth — plus any extras, and the same options always draw the same face. The
 * body is shaded from the one colour (a lighter tone where the light falls, a darker one at the
 * rim, a shine, a soft shadow beneath), and the brows and the inside of the mouth are a deep
 * shade of the same colour, so changing the colour recolours the whole face consistently.
 *
 * The result is an SVG data URI: small, sharp at any size, and in every export.
 */

export interface FaceOptions {
  color: string
  eyes: EyeId
  brows: BrowId
  mouth: MouthId
  extras: ExtraId[]
  outline: boolean
}

export const FACE_COLORS: Array<{ name: string; color: string }> = [
  { name: 'Blue', color: '#1f6fe0' },
  { name: 'Purple', color: '#8f5cf5' },
  { name: 'Yellow', color: '#f8c51b' },
  { name: 'Orange', color: '#f57c1f' },
  { name: 'Red', color: '#c81e1e' },
  { name: 'Pink', color: '#e48fbf' },
  { name: 'Teal', color: '#1ea6bf' },
  { name: 'Green', color: '#7cc22f' },
  { name: 'White', color: '#eef1f5' },
  { name: 'Black', color: '#1c2333' },
]

/* ------------------------------------------------------------------ colour */

function hexToHsl(hex: string): [number, number, number] {
  const raw = hex.replace('#', '')
  const full = raw.length === 3 ? raw.replace(/./g, (c) => c + c) : raw
  const n = Number.parseInt(full, 16) || 0
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return [0, 0, l]
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  h /= 6
  return [h, s, l]
}

function hslToHex(h: number, s: number, l: number): string {
  const sat = Math.min(1, Math.max(0, s))
  const lig = Math.min(1, Math.max(0, l))
  const f = (n: number) => {
    const k = (n + h * 12) % 12
    const a = sat * Math.min(lig, 1 - lig)
    const c = lig - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

/** The base colour moved `dl` in lightness and scaled `ks` in saturation. */
function shade(hex: string, dl: number, ks = 1): string {
  const [h, s, l] = hexToHsl(hex)
  return hslToHex(h, s * ks, l + dl)
}

/* ------------------------------------------------------------------- parts */

/*
 * Coordinates are on a 120-unit square; the face is a circle of radius 50 at (60, 60). Every
 * part takes the palette so it can use the face's own deep tone.
 */
interface Palette {
  /** The face's own colour where the eyes sit, for eyelids. */
  skin: string
  ink: string
  deep: string
  mouth: string
}

const EYE_WHITE = '#ffffff'
const PUPIL = '#16181d'

function roundEye(cx: number, cy: number, dx = 0, dy = 0, rx = 8.5, ry = 10.5, p?: Palette): string {
  return (
    `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${EYE_WHITE}"${p ? ` stroke="${p.deep}" stroke-width="1.2"` : ''}/>` +
    `<circle cx="${cx + dx}" cy="${cy + dy}" r="${Math.min(rx, ry) * 0.5}" fill="${PUPIL}"/>` +
    `<circle cx="${cx + dx + 1.6}" cy="${cy + dy - 1.8}" r="1.3" fill="#ffffff"/>`
  )
}

function star(cx: number, cy: number, r: number, fill: string): string {
  const points: string[] = []
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? r : r * 0.45
    const angle = -Math.PI / 2 + (i * Math.PI) / 5
    points.push(`${(cx + radius * Math.cos(angle)).toFixed(1)},${(cy + radius * Math.sin(angle)).toFixed(1)}`)
  }
  return `<polygon points="${points.join(' ')}" fill="${fill}" stroke="#7a5200" stroke-width="1.2" stroke-linejoin="round"/>`
}

function heart(cx: number, cy: number, r: number, fill: string): string {
  return `<path d="M${cx} ${cy + r} C${cx - r * 1.6} ${cy - r * 0.2} ${cx - r * 0.7} ${cy - r * 1.4} ${cx} ${cy - r * 0.45} C${cx + r * 0.7} ${cy - r * 1.4} ${cx + r * 1.6} ${cy - r * 0.2} ${cx} ${cy + r} Z" fill="${fill}"/>`
}

export const EYES = {
  round: { name: 'Round', draw: (p: Palette) => roundEye(44, 52, 0, 1, 8.5, 10.5, p) + roundEye(76, 52, 0, 1, 8.5, 10.5, p) },
  wide: { name: 'Shocked', draw: (p: Palette) => roundEye(43, 50, 0, 0, 11, 13, p) + roundEye(77, 50, 0, 0, 11, 13, p) },
  side: { name: 'Side-eye', draw: (p: Palette) => roundEye(44, 52, 4, 1, 8.5, 10, p) + roundEye(76, 52, 4, 1, 8.5, 10, p) },
  half: {
    name: 'Smug',
    draw: (p: Palette) =>
      roundEye(44, 52, 3, 3, 9, 9.5, p) +
      roundEye(76, 52, 3, 3, 9, 9.5, p) +
      // Heavy lids: the face's colour drawn down over the top half of each eye, with a crease.
      `<path d="M34 53 Q44 49 54 53 L54 40 L34 40 Z M66 53 Q76 49 86 53 L86 40 L66 40 Z" fill="${p.skin}"/>` +
      `<path d="M34 53 Q44 49 54 53 M66 53 Q76 49 86 53" stroke="${p.deep}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`,
  },
  happy: {
    name: 'Happy',
    draw: (p: Palette) =>
      `<path d="M36 55 Q44 44 52 55 M68 55 Q76 44 84 55" stroke="${p.deep}" stroke-width="4" fill="none" stroke-linecap="round"/>`,
  },
  closed: {
    name: 'Closed',
    draw: (p: Palette) =>
      `<path d="M36 52 Q44 58 52 52 M68 52 Q76 58 84 52" stroke="${p.deep}" stroke-width="3.6" fill="none" stroke-linecap="round"/>`,
  },
  squint: {
    name: 'Squint',
    draw: (p: Palette) =>
      `<path d="M35 47 L51 53 L35 58 M85 47 L69 53 L85 58" stroke="${p.deep}" stroke-width="3.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  wink: {
    name: 'Wink',
    draw: (p: Palette) =>
      roundEye(44, 52, 0, 1, 8.5, 10.5, p) +
      `<path d="M68 55 Q76 46 84 55" stroke="${p.deep}" stroke-width="4" fill="none" stroke-linecap="round"/>`,
  },
  dots: {
    name: 'Dots',
    draw: () => `<ellipse cx="45" cy="52" rx="4.5" ry="6.5" fill="${PUPIL}"/><ellipse cx="75" cy="52" rx="4.5" ry="6.5" fill="${PUPIL}"/>`,
  },
  stars: { name: 'Stars', draw: () => star(44, 51, 12, '#ffe066') + star(76, 51, 12, '#ffe066') },
  hearts: { name: 'Hearts', draw: () => heart(44, 52, 9, '#ff3b5c') + heart(76, 52, 9, '#ff3b5c') },
  dizzy: {
    name: 'Dizzy',
    draw: (p: Palette) =>
      `<path d="M38 46 L50 58 M50 46 L38 58 M70 46 L82 58 M82 46 L70 58" stroke="${p.deep}" stroke-width="3.8" stroke-linecap="round"/>`,
  },
} as const satisfies Record<string, { name: string; draw: (p: Palette) => string }>

export const BROWS = {
  none: { name: 'None', draw: () => '' },
  calm: {
    name: 'Calm',
    draw: (p: Palette) =>
      `<path d="M35 36 Q44 31 53 35 M67 35 Q76 31 85 36" stroke="${p.ink}" stroke-width="4.2" fill="none" stroke-linecap="round"/>`,
  },
  raised: {
    name: 'Raised',
    draw: (p: Palette) =>
      `<path d="M35 31 Q44 23 53 29 M67 29 Q76 23 85 31" stroke="${p.ink}" stroke-width="4.2" fill="none" stroke-linecap="round"/>`,
  },
  angry: {
    name: 'Angry',
    draw: (p: Palette) =>
      `<path d="M33 33 L54 42 M87 33 L66 42" stroke="${p.ink}" stroke-width="5" fill="none" stroke-linecap="round"/>`,
  },
  worried: {
    name: 'Worried',
    draw: (p: Palette) =>
      `<path d="M34 40 Q42 34 52 31 M86 40 Q78 34 68 31" stroke="${p.ink}" stroke-width="4.2" fill="none" stroke-linecap="round"/>`,
  },
  suspicious: {
    name: 'One up',
    draw: (p: Palette) =>
      `<path d="M35 39 L53 39 M67 31 Q76 23 86 30" stroke="${p.ink}" stroke-width="4.2" fill="none" stroke-linecap="round"/>`,
  },
} as const satisfies Record<string, { name: string; draw: (p: Palette) => string }>

const TONGUE = '#ff6f91'

export const MOUTHS = {
  smile: {
    name: 'Smile',
    draw: (p: Palette) => `<path d="M42 76 Q60 92 78 76" stroke="${p.deep}" stroke-width="4.2" fill="none" stroke-linecap="round"/>`,
  },
  grin: {
    name: 'Grin',
    draw: (p: Palette) =>
      `<path d="M36 72 Q60 104 84 72 Z" fill="${p.mouth}" stroke="${p.deep}" stroke-width="2" stroke-linejoin="round"/>` +
      `<path d="M38.5 73.5 Q60 80 81.5 73.5 L80 78 Q60 84 40 78 Z" fill="#ffffff"/>`,
  },
  laugh: {
    name: 'Laugh',
    draw: (p: Palette) =>
      `<path d="M34 70 Q60 108 86 70 Z" fill="${p.mouth}" stroke="${p.deep}" stroke-width="2" stroke-linejoin="round"/>` +
      `<path d="M46 88 Q60 80 74 88 Q68 98 60 98 Q52 98 46 88 Z" fill="${TONGUE}"/>` +
      `<path d="M37 71.5 H83" stroke="#ffffff" stroke-width="4" stroke-linecap="round"/>`,
  },
  teeth: {
    name: 'Teeth',
    draw: (p: Palette) =>
      `<rect x="38" y="70" width="44" height="18" rx="9" fill="#ffffff" stroke="${p.deep}" stroke-width="2.4"/>` +
      `<path d="M38.5 79 H81.5 M49 70.5 V87.5 M60 70.5 V87.5 M71 70.5 V87.5" stroke="${p.deep}" stroke-width="1.4"/>`,
  },
  flat: {
    name: 'Flat',
    draw: (p: Palette) => `<path d="M45 80 H75" stroke="${p.deep}" stroke-width="4.2" stroke-linecap="round"/>`,
  },
  smirk: {
    name: 'Smirk',
    draw: (p: Palette) => `<path d="M44 81 Q62 84 77 72" stroke="${p.deep}" stroke-width="4.2" fill="none" stroke-linecap="round"/>`,
  },
  frown: {
    name: 'Frown',
    draw: (p: Palette) => `<path d="M43 86 Q60 71 77 86" stroke="${p.deep}" stroke-width="4.2" fill="none" stroke-linecap="round"/>`,
  },
  wobbly: {
    name: 'Nervous',
    draw: (p: Palette) =>
      `<path d="M40 81 Q45 76 50 81 T60 81 T70 81 T80 81" stroke="${p.deep}" stroke-width="3.8" fill="none" stroke-linecap="round"/>`,
  },
  oh: {
    name: 'Oh!',
    draw: (p: Palette) => `<ellipse cx="60" cy="81" rx="8" ry="10" fill="${p.mouth}" stroke="${p.deep}" stroke-width="2"/>`,
  },
  tongue: {
    name: 'Tongue',
    draw: (p: Palette) =>
      `<path d="M44 76 Q60 86 76 76" stroke="${p.deep}" stroke-width="4" fill="none" stroke-linecap="round"/>` +
      `<path d="M54 80 Q54 94 61 94 Q68 94 68 80 Z" fill="${TONGUE}" stroke="${p.deep}" stroke-width="1.6"/>`,
  },
  kiss: {
    name: 'Kiss',
    draw: (p: Palette) =>
      `<path d="M58 72 Q66 74 60 79 Q67 83 58 87" stroke="${p.deep}" stroke-width="3.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  grit: {
    name: 'Gritted',
    draw: (p: Palette) =>
      `<path d="M36 84 Q60 66 84 84 Q60 92 36 84 Z" fill="#ffffff" stroke="${p.deep}" stroke-width="2.4" stroke-linejoin="round"/>` +
      `<path d="M37 84 Q60 78 83 84 M48 77 V88 M60 75 V89 M72 77 V88" stroke="${p.deep}" stroke-width="1.4" fill="none"/>`,
  },
} as const satisfies Record<string, { name: string; draw: (p: Palette) => string }>

export const EXTRAS = {
  blush: {
    name: 'Blush',
    draw: () =>
      `<ellipse cx="32" cy="70" rx="8" ry="5" fill="#ff5f8a" opacity="0.45"/><ellipse cx="88" cy="70" rx="8" ry="5" fill="#ff5f8a" opacity="0.45"/>`,
  },
  tears: {
    name: 'Tears',
    draw: () =>
      `<path d="M38 62 Q33 74 37 80 Q42 84 44 78 Q45 72 38 62 Z" fill="#7fd3ff" stroke="#2b8fd6" stroke-width="1.2"/>` +
      `<path d="M82 62 Q87 74 83 80 Q78 84 76 78 Q75 72 82 62 Z" fill="#7fd3ff" stroke="#2b8fd6" stroke-width="1.2"/>`,
  },
  sweat: {
    name: 'Sweat',
    draw: () =>
      `<path d="M92 26 Q86 38 89 43 Q94 47 97 41 Q98 34 92 26 Z" fill="#9fe0ff" stroke="#2b8fd6" stroke-width="1.2"/>`,
  },
  shades: {
    name: 'Shades',
    draw: () =>
      `<path d="M28 44 H92 L90 49 H86 Q84 62 72 62 Q62 62 61 50 H59 Q58 62 48 62 Q36 62 34 49 H30 Z" fill="#14161b"/>` +
      `<path d="M40 49 L46 49 L38 57 Z M68 49 L74 49 L66 57 Z" fill="#ffffff" opacity="0.35"/>`,
  },
  anger: {
    name: 'Anger mark',
    draw: () =>
      `<path d="M86 14 Q90 22 98 22 M86 30 Q90 22 98 22 M80 20 Q88 22 88 14 M80 24 Q88 22 88 30" stroke="#ff2a2a" stroke-width="3.2" fill="none" stroke-linecap="round"/>`,
  },
  sparkles: {
    name: 'Sparkles',
    draw: () => star(16, 22, 7, '#ffe066') + star(104, 96, 6, '#ffe066') + star(103, 18, 4.5, '#ffe066'),
  },
  halo: {
    name: 'Halo',
    draw: () => `<ellipse cx="60" cy="9" rx="26" ry="6" fill="none" stroke="#ffd84a" stroke-width="4.5"/>`,
  },
} as const satisfies Record<string, { name: string; draw: (p: Palette) => string }>

export type EyeId = keyof typeof EYES
export type BrowId = keyof typeof BROWS
export type MouthId = keyof typeof MOUTHS
export type ExtraId = keyof typeof EXTRAS

export const DEFAULT_FACE: FaceOptions = {
  color: FACE_COLORS[0].color,
  eyes: 'round',
  brows: 'calm',
  mouth: 'grin',
  extras: [],
  outline: false,
}

/** The face as standalone SVG markup. */
export function faceSvg(options: FaceOptions): string {
  const base = options.color
  const [, , lightness] = hexToHsl(base)
  const p: Palette = {
    skin: shade(base, 0.04),
    // Brows a deep shade of the face; on a very dark face they go lighter instead, to be seen.
    ink: lightness < 0.25 ? shade(base, 0.35) : shade(base, -0.3, 1.05),
    deep: lightness < 0.25 ? '#e9edf5' : shade(base, -0.38, 1.1),
    mouth: '#3b0d1a',
  }
  const extras = options.extras.filter((id) => id in EXTRAS)
  const behind: ExtraId[] = ['halo']
  const under = extras.filter((id) => behind.includes(id))
  const over = extras.filter((id) => !under.includes(id))
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">` +
    `<defs>` +
    `<radialGradient id="body" cx="0.36" cy="0.3" r="0.78">` +
    `<stop offset="0" stop-color="${shade(base, 0.22, 0.95)}"/>` +
    `<stop offset="0.55" stop-color="${base}"/>` +
    `<stop offset="1" stop-color="${shade(base, -0.22, 1.05)}"/>` +
    `</radialGradient>` +
    `<radialGradient id="shine" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#ffffff" stop-opacity="0.75"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>` +
    `<radialGradient id="shadow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#000000" stop-opacity="0.28"/><stop offset="1" stop-color="#000000" stop-opacity="0"/></radialGradient>` +
    `</defs>` +
    `<ellipse cx="60" cy="112" rx="38" ry="6" fill="url(#shadow)"/>` +
    under.map((id) => EXTRAS[id].draw()).join('') +
    `<circle cx="60" cy="60" r="50" fill="url(#body)"${options.outline ? ' stroke="#121212" stroke-width="5"' : ''}/>` +
    `<ellipse cx="44" cy="28" rx="22" ry="11" fill="url(#shine)" transform="rotate(-25 44 28)"/>` +
    EYES[options.eyes].draw(p) +
    BROWS[options.brows].draw(p) +
    MOUTHS[options.mouth].draw(p) +
    over.map((id) => EXTRAS[id].draw()).join('') +
    `</svg>`
  )
}

export function faceDataUri(options: FaceOptions): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(faceSvg(options))}`
}

/** A random face, for the dice button. */
export function randomFace(): FaceOptions {
  const pick = <T,>(items: readonly T[]) => items[Math.floor(Math.random() * items.length)]
  const extras = (Object.keys(EXTRAS) as ExtraId[]).filter(() => Math.random() < 0.15)
  return {
    color: pick(FACE_COLORS).color,
    eyes: pick(Object.keys(EYES) as EyeId[]),
    brows: pick(Object.keys(BROWS) as BrowId[]),
    mouth: pick(Object.keys(MOUTHS) as MouthId[]),
    extras,
    outline: false,
  }
}

export { hexToHsl, hslToHex }
