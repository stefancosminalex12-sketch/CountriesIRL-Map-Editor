/**
 * The face maker: a glossy 3D face assembled from parts, in any colour.
 *
 * Original artwork, drawn here as SVG. A face is a colour and one choice from each part list —
 * eyes, brows, mouth — plus any extras, and the same options always draw the same face.
 *
 * **What makes it look rendered rather than flat** is light, applied the same way to every part:
 *
 * - The head is a lit sphere: a radial body gradient lit from the top left, a darker rim, a pale
 *   bounce of light along the bottom edge, a soft specular bloom and a sharp highlight, and a
 *   blurred shadow on the ground.
 * - Brows, eyelids, the closed-eye arcs, stars, hearts and hands are *raised*: the `bevel` filter
 *   lights a blurred copy of each shape's alpha (`feSpecularLighting`) from the same top-left
 *   light, so every edge facing the light catches it.
 * - Eyes and open mouths are *cavities*: the `inset` filter casts an inner shadow from their top
 *   edge, so the eye sits in the head and the mouth goes into it. Teeth, tongues and irises have
 *   their own gradients and highlights.
 *
 * Every tone — the lids, the brows, the lines, the deep inside of the mouth's rim — is derived
 * from the one face colour, so recolouring the face recolours all of it consistently.
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

/* ---------------------------------------------------------------- drawing */

/**
 * What every part draws with. Coordinates are on a 120-unit square with the head a circle of
 * radius 50 at (60, 60); the whole face is placed inside a 140-unit sticker with room around it
 * for hands, halos and drops.
 */
interface Ctx {
  /** The head's own colour, for lids. */
  skin: string
  skinLight: string
  /** Brows: a deep tone of the head. */
  brow: string
  /** Lines and edges — the lid crease, a closed smile. */
  line: string
  /** Defs a part needs (clip paths), collected and written once. */
  defs: string[]
}

const RAISED = 'filter="url(#bevel)"'
const SUNKEN = 'filter="url(#inset)"'

type Side = -1 | 1

interface EyeSpec {
  cx: number
  cy: number
  rx: number
  ry: number
  /** Where the iris looks, in units. */
  look?: [number, number]
  /** Iris radius as a share of the eye's smaller radius. */
  iris?: number
  lid?: 'half' | 'heavy' | 'angry' | 'sad' | 'happy'
}

/** One eye: a sunken white, a shaded iris and pupil, two catch-lights, and an optional lid. */
function eye(c: Ctx, e: EyeSpec, side: Side, key: string): string {
  const [dx, dy] = e.look ?? [0, 1]
  const r = Math.min(e.rx, e.ry) * (e.iris ?? 0.6)
  const clip = `eye-${key}`
  c.defs.push(`<clipPath id="${clip}"><ellipse cx="${e.cx}" cy="${e.cy}" rx="${e.rx}" ry="${e.ry}"/></clipPath>`)
  const ix = e.cx + dx
  const iy = e.cy + dy
  let out =
    `<ellipse cx="${e.cx}" cy="${e.cy + 0.8}" rx="${e.rx + 1.2}" ry="${e.ry + 1.2}" fill="${c.line}" opacity="0.35"/>` +
    `<ellipse cx="${e.cx}" cy="${e.cy}" rx="${e.rx}" ry="${e.ry}" fill="url(#sclera)" ${SUNKEN}/>` +
    `<g clip-path="url(#${clip})">` +
    `<circle cx="${ix}" cy="${iy}" r="${r}" fill="url(#iris)"/>` +
    `<circle cx="${ix}" cy="${iy}" r="${r * 0.52}" fill="#050506"/>` +
    `<ellipse cx="${ix - r * 0.32}" cy="${iy - r * 0.38}" rx="${r * 0.32}" ry="${r * 0.26}" fill="#ffffff" opacity="0.95"/>` +
    `<circle cx="${ix + r * 0.38}" cy="${iy + r * 0.34}" r="${r * 0.13}" fill="#ffffff" opacity="0.8"/>`
  if (e.lid) {
    const { cx, cy, rx, ry } = e
    const left = cx - rx - 2
    const right = cx + rx + 2
    const top = cy - ry - 3
    // The lid's cut, from the outer corner to the inner one. `side` is +1 for the left eye.
    const outer = side === 1 ? left : right
    const inner = side === 1 ? right : left
    let a: number
    let b: number
    let bulge: number
    switch (e.lid) {
      case 'half':
        a = cy - ry * 0.12
        b = cy - ry * 0.12
        bulge = ry * 0.22
        break
      case 'heavy':
        a = cy + ry * 0.12
        b = cy + ry * 0.12
        bulge = ry * 0.18
        break
      case 'angry':
        a = cy - ry * 0.85
        b = cy - ry * 0.05
        bulge = ry * 0.1
        break
      case 'sad':
        a = cy - ry * 0.1
        b = cy - ry * 0.85
        bulge = ry * 0.1
        break
      default:
        a = cy - ry * 0.95
        b = cy - ry * 0.95
        bulge = 0
    }
    if (e.lid === 'happy') {
      // A lower lid pushed up by the cheek: the eye smiles.
      const lowY = cy + ry * 0.35
      out +=
        `<path d="M${left} ${cy + ry + 3} L${left} ${lowY + 2} Q${cx} ${lowY - ry * 0.45} ${right} ${lowY + 2} L${right} ${cy + ry + 3} Z" fill="url(#lid)"/>` +
        `</g><path d="M${left + 1} ${lowY + 1.5} Q${cx} ${lowY - ry * 0.45} ${right - 1} ${lowY + 1.5}" fill="none" stroke="${c.line}" stroke-width="1.6" stroke-linecap="round"/>`
      return out
    }
    const midY = (a + b) / 2 + bulge
    out +=
      `<path d="M${outer} ${a} Q${cx} ${midY + bulge} ${inner} ${b} L${inner} ${top} L${outer} ${top} Z" fill="url(#lid)"/>` +
      `</g>` +
      `<path d="M${outer + side * 1} ${a} Q${cx} ${midY + bulge} ${inner - side * 1} ${b}" fill="none" stroke="${c.line}" stroke-width="2.2" stroke-linecap="round"/>`
    return out
  }
  return out + `</g>`
}

const pair = (c: Ctx, spec: EyeSpec, right: Partial<EyeSpec> = {}) =>
  eye(c, { ...spec, cx: 44 }, 1, 'l') + eye(c, { ...spec, cx: 76, ...right }, -1, 'r')

/**
 * A line carved into the face: closed eyes, a closed smile. Dark, with the lip of the groove
 * catching the light just below it, which is what makes it read as cut in rather than drawn on.
 */
const ridge = (c: Ctx, d: string, width = 4.6, color?: string) =>
  `<path d="${d}" fill="none" stroke="${c.skinLight}" stroke-width="${width * 0.7}" stroke-linecap="round" stroke-linejoin="round" opacity="0.8" transform="translate(0 ${(width * 0.38).toFixed(2)})"/>` +
  `<path d="${d}" fill="none" stroke="${color ?? c.line}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" filter="url(#groove)"/>`

function star(cx: number, cy: number, r: number, fill = 'url(#gold)'): string {
  const points: string[] = []
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? r : r * 0.48
    const angle = -Math.PI / 2 + (i * Math.PI) / 5
    points.push(`${(cx + radius * Math.cos(angle)).toFixed(2)},${(cy + radius * Math.sin(angle)).toFixed(2)}`)
  }
  return `<polygon points="${points.join(' ')}" fill="${fill}" stroke="#b87900" stroke-width="1" stroke-linejoin="round" ${RAISED}/>`
}

function heart(cx: number, cy: number, r: number): string {
  return (
    `<path d="M${cx} ${cy + r} C${cx - r * 1.6} ${cy - r * 0.15} ${cx - r * 0.75} ${cy - r * 1.45} ${cx} ${cy - r * 0.45} C${cx + r * 0.75} ${cy - r * 1.45} ${cx + r * 1.6} ${cy - r * 0.15} ${cx} ${cy + r} Z" fill="url(#heart)" stroke="#9c0f2e" stroke-width="1" ${RAISED}/>` +
    `<ellipse cx="${cx - r * 0.5}" cy="${cy - r * 0.45}" rx="${r * 0.25}" ry="${r * 0.15}" fill="#ffffff" opacity="0.8" transform="rotate(-35 ${cx - r * 0.5} ${cy - r * 0.45})"/>`
  )
}

/** A brow as a lens: thick in the middle, tapering to both ends, raised off the face. */
function brow(c: Ctx, x1: number, y1: number, qx: number, qy: number, x2: number, y2: number, thick = 7.5): string {
  return `<path d="M${x1} ${y1} Q${qx} ${qy - thick} ${x2} ${y2} Q${qx} ${qy + thick * 0.55} ${x1} ${y1} Z" fill="${c.brow}" stroke="${c.brow}" stroke-width="1.6" stroke-linejoin="round" ${RAISED}/>`
}

const mirror = (x: number) => 120 - x
const browPair = (c: Ctx, x1: number, y1: number, qx: number, qy: number, x2: number, y2: number, thick?: number) =>
  brow(c, x1, y1, qx, qy, x2, y2, thick) + brow(c, mirror(x1), y1, mirror(qx), qy, mirror(x2), y2, thick)

/* ------------------------------------------------------------------- parts */

const ROUND: EyeSpec = { cx: 44, cy: 52, rx: 9, ry: 11 }

export const EYES = {
  round: { name: 'Round', draw: (c: Ctx) => pair(c, ROUND) },
  wide: { name: 'Shocked', draw: (c: Ctx) => pair(c, { cx: 44, cy: 50, rx: 11.5, ry: 13.5, iris: 0.42, look: [0, 0] }) },
  side: { name: 'Side-eye', draw: (c: Ctx) => pair(c, { ...ROUND, look: [4.2, 1], lid: 'half' }) },
  smug: { name: 'Smug', draw: (c: Ctx) => pair(c, { ...ROUND, rx: 10, ry: 10, look: [3, 3], lid: 'half' }) },
  tired: { name: 'Tired', draw: (c: Ctx) => pair(c, { ...ROUND, rx: 10, ry: 10, look: [0, 3.5], lid: 'heavy' }) },
  angry: { name: 'Angry', draw: (c: Ctx) => pair(c, { ...ROUND, look: [0, 1.5], lid: 'angry' }) },
  sad: { name: 'Sad', draw: (c: Ctx) => pair(c, { ...ROUND, look: [0, 2.5], lid: 'sad', iris: 0.66 }) },
  joy: { name: 'Smiling', draw: (c: Ctx) => pair(c, { ...ROUND, look: [0, -0.5], lid: 'happy' }) },
  crazy: {
    name: 'Crazy',
    draw: (c: Ctx) =>
      eye(c, { cx: 43, cy: 51, rx: 12, ry: 13.5, iris: 0.4, look: [-3, -2] }, 1, 'l') +
      eye(c, { cx: 77, cy: 54, rx: 7.5, ry: 8.5, iris: 0.62, look: [2, 2] }, -1, 'r'),
  },
  happy: {
    name: 'Happy',
    draw: (c: Ctx) => ridge(c, 'M35 56 Q44 43 53 56') + ridge(c, 'M67 56 Q76 43 85 56'),
  },
  closed: {
    name: 'Closed',
    draw: (c: Ctx) => ridge(c, 'M35 52 Q44 60 53 52', 4) + ridge(c, 'M67 52 Q76 60 85 52', 4),
  },
  squint: {
    name: 'Squint',
    draw: (c: Ctx) => ridge(c, 'M35 46 L51 53 L35 59', 4.4) + ridge(c, 'M85 46 L69 53 L85 59', 4.4),
  },
  wink: {
    name: 'Wink',
    draw: (c: Ctx) => eye(c, ROUND, 1, 'l') + ridge(c, 'M67 55 Q76 45 85 55'),
  },
  stars: { name: 'Stars', draw: () => star(44, 51, 13) + star(76, 51, 13) },
  hearts: { name: 'Hearts', draw: () => heart(44, 52, 10) + heart(76, 52, 10) },
  dizzy: {
    name: 'Dizzy',
    draw: (c: Ctx) => ridge(c, 'M38 46 L50 58 M50 46 L38 58', 4) + ridge(c, 'M70 46 L82 58 M82 46 L70 58', 4),
  },
} as const satisfies Record<string, { name: string; draw: (c: Ctx) => string }>

export const BROWS = {
  none: { name: 'None', draw: () => '' },
  calm: { name: 'Calm', draw: (c: Ctx) => browPair(c, 34, 37, 44, 31, 54, 36) },
  raised: { name: 'Raised', draw: (c: Ctx) => browPair(c, 34, 33, 44, 22, 54, 30) },
  angry: { name: 'Angry', draw: (c: Ctx) => browPair(c, 31, 31, 43, 34, 57, 43, 9) },
  worried: { name: 'Worried', draw: (c: Ctx) => browPair(c, 33, 40, 42, 33, 54, 29) },
  suspicious: {
    name: 'One up',
    draw: (c: Ctx) => brow(c, 34, 40, 44, 38, 54, 40) + brow(c, 66, 31, 76, 20, 87, 29),
  },
  thick: { name: 'Bushy', draw: (c: Ctx) => browPair(c, 32, 36, 44, 30, 56, 37, 12) },
} as const satisfies Record<string, { name: string; draw: (c: Ctx) => string }>

/** An open mouth: the cavity, sunk into the face, with whatever is inside it clipped to it. */
function cavity(c: Ctx, d: string, inside: string, key: string): string {
  c.defs.push(`<clipPath id="mouth-${key}"><path d="${d}"/></clipPath>`)
  return (
    `<path d="${d}" fill="url(#mouth)" ${SUNKEN}/>` +
    `<g clip-path="url(#mouth-${key})">${inside}</g>` +
    `<path d="${d}" fill="none" stroke="${c.line}" stroke-width="1.8" stroke-linejoin="round"/>`
  )
}

const teethRow = (y: number, h: number, x1 = 30, x2 = 90, gaps: number[] = []) =>
  `<rect x="${x1}" y="${y}" width="${x2 - x1}" height="${h}" fill="url(#teeth)"/>` +
  gaps.map((x) => `<path d="M${x} ${y} V${y + h}" stroke="#b9c3d1" stroke-width="1.1"/>`).join('')

const tongue = (cx: number, cy: number, rx: number, ry: number) =>
  `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#tongue)"/>` +
  `<path d="M${cx} ${cy - ry * 0.6} V${cy + ry * 0.2}" stroke="#c43c63" stroke-width="1.2" stroke-linecap="round" opacity="0.7"/>` +
  `<ellipse cx="${cx - rx * 0.35}" cy="${cy - ry * 0.35}" rx="${rx * 0.22}" ry="${ry * 0.18}" fill="#ffffff" opacity="0.45"/>`

/** Little creases at the corners of a closed smile. */
const dimples = (c: Ctx, lx: number, ly: number, rx: number, ry: number) =>
  ridge(c, `M${lx - 2} ${ly - 3} Q${lx - 3.5} ${ly} ${lx - 1.5} ${ly + 2.5}`, 2) +
  ridge(c, `M${rx + 2} ${ry - 3} Q${rx + 3.5} ${ry} ${rx + 1.5} ${ry + 2.5}`, 2)

export const MOUTHS = {
  smile: {
    name: 'Smile',
    draw: (c: Ctx) => ridge(c, 'M41 75 Q60 92 79 75') + dimples(c, 41, 75, 79, 75),
  },
  grin: {
    name: 'Grin',
    draw: (c: Ctx) =>
      cavity(c, 'M35 71 Q60 76 85 71 Q80 99 60 99 Q40 99 35 71 Z', teethRow(70, 9.5, 30, 90, [44, 52, 60, 68, 76]) + tongue(60, 98, 13, 7), 'grin'),
  },
  laugh: {
    name: 'Laugh',
    draw: (c: Ctx) =>
      cavity(c, 'M32 68 Q60 72 88 68 Q86 106 60 106 Q34 106 32 68 Z', teethRow(66, 8.5, 28, 92, [42, 51, 60, 69, 78]) + tongue(60, 102, 17, 10), 'laugh'),
  },
  teeth: {
    name: 'Big teeth',
    draw: (c: Ctx) =>
      cavity(
        c,
        'M30 70 Q60 64 90 70 Q88 94 60 96 Q32 94 30 70 Z',
        teethRow(60, 19, 26, 94, [38, 49, 60, 71, 82]) +
          teethRow(79, 20, 26, 94, [40, 50, 60, 70, 80]) +
          `<path d="M26 79 Q60 83 94 79" stroke="#7a1b2e" stroke-width="1.6" fill="none"/>`,
        'teeth',
      ),
  },
  flat: { name: 'Flat', draw: (c: Ctx) => ridge(c, 'M45 80 Q60 81 75 80') },
  smirk: {
    name: 'Smirk',
    draw: (c: Ctx) => ridge(c, 'M43 81 Q63 85 78 71') + ridge(c, 'M80 68 Q83 71 80 75', 2),
  },
  frown: { name: 'Frown', draw: (c: Ctx) => ridge(c, 'M42 87 Q60 71 78 87') },
  wobbly: { name: 'Nervous', draw: (c: Ctx) => ridge(c, 'M39 81 Q44.5 75 50 81 T60 81 T70 81 T81 81', 3.8) },
  oh: {
    name: 'Oh!',
    draw: (c: Ctx) => cavity(c, 'M60 70 C70 70 70 92 60 92 C50 92 50 70 60 70 Z', tongue(60, 92, 8, 5), 'oh'),
  },
  shout: {
    name: 'Shout',
    draw: (c: Ctx) =>
      cavity(c, 'M36 92 Q36 70 60 70 Q84 70 84 92 Q60 86 36 92 Z', teethRow(68, 7, 30, 90, [46, 53, 60, 67, 74]) + tongue(60, 93, 14, 8), 'shout'),
  },
  tongue: {
    name: 'Tongue',
    draw: (c: Ctx) =>
      `<path d="M53 80 Q53 97 61 97 Q69 97 69 80 Z" fill="url(#tongue)" stroke="#a52a52" stroke-width="1.2" ${RAISED}/>` +
      `<path d="M61 82 V91" stroke="#c43c63" stroke-width="1.2" stroke-linecap="round"/>` +
      ridge(c, 'M42 76 Q60 86 78 76'),
  },
  kiss: {
    name: 'Kiss',
    draw: (c: Ctx) =>
      `<path d="M55 72 Q66 72 61 79 Q68 85 55 88 Q60 84 57 80 Q61 76 55 72 Z" fill="${c.brow}" ${RAISED}/>`,
  },
  grit: {
    name: 'Gritted',
    draw: (c: Ctx) =>
      cavity(
        c,
        'M34 84 Q60 66 86 84 Q60 94 34 84 Z',
        teethRow(70, 14, 30, 90, [42, 51, 60, 69, 78]) + teethRow(84, 12, 30, 90, [44, 52, 60, 68, 76]) +
          `<path d="M30 84 H90" stroke="#7a1b2e" stroke-width="1.4"/>`,
        'grit',
      ),
  },
} as const satisfies Record<string, { name: string; draw: (c: Ctx) => string }>

/** A cartoon glove making a fist with the thumb up, at the origin, about 30 × 40. */
const GLOVE =
  `<g ${RAISED}>` +
  `<rect x="-3" y="-30" width="11" height="22" rx="5.5" fill="url(#glove)" stroke="#8e9bb0" stroke-width="1.3"/>` +
  `<rect x="-11" y="-12" width="30" height="27" rx="9" fill="url(#glove)" stroke="#8e9bb0" stroke-width="1.3"/>` +
  `<path d="M-9 -2 H11 M-9 5 H11" stroke="#a9b4c6" stroke-width="1.2" stroke-linecap="round"/>` +
  `<rect x="-10" y="14" width="27" height="8" rx="3" fill="url(#glove)" stroke="#8e9bb0" stroke-width="1.3"/>` +
  `</g>`

export const EXTRAS = {
  blush: {
    name: 'Blush',
    draw: () =>
      `<ellipse cx="29" cy="71" rx="9" ry="5.5" fill="#ff4f86" opacity="0.5" filter="url(#soft)"/>` +
      `<ellipse cx="91" cy="71" rx="9" ry="5.5" fill="#ff4f86" opacity="0.5" filter="url(#soft)"/>`,
  },
  tears: {
    name: 'Tears',
    draw: () =>
      `<path d="M36 60 Q31 76 35 86 Q40 92 44 85 Q46 76 36 60 Z" fill="url(#water)" stroke="#2a8ad6" stroke-width="1" ${RAISED}/>` +
      `<path d="M84 60 Q89 76 85 86 Q80 92 76 85 Q74 76 84 60 Z" fill="url(#water)" stroke="#2a8ad6" stroke-width="1" ${RAISED}/>`,
  },
  sweat: {
    name: 'Sweat',
    draw: () =>
      `<path d="M95 20 Q87 34 90 41 Q95 47 100 40 Q102 32 95 20 Z" fill="url(#water)" stroke="#2a8ad6" stroke-width="1" ${RAISED}/>`,
  },
  shades: {
    name: 'Shades',
    draw: () =>
      `<g ${RAISED}><path d="M26 44 H94 L92 50 H87 Q85 64 72 64 Q62 64 61 51 H59 Q58 64 48 64 Q35 64 33 50 H28 Z" fill="url(#lens)" stroke="#000" stroke-width="1"/></g>` +
      `<path d="M37 50 L45 50 L35 60 Z M66 50 L74 50 L64 60 Z" fill="#ffffff" opacity="0.4"/>`,
  },
  anger: {
    name: 'Anger mark',
    draw: () =>
      `<g ${RAISED} stroke="#e01d1d" stroke-width="4" fill="none" stroke-linecap="round">` +
      `<path d="M88 12 Q91 19 98 20 M88 28 Q91 21 98 20 M82 18 Q89 19 90 12 M82 22 Q89 21 90 28"/></g>`,
  },
  sparkles: {
    name: 'Sparkles',
    draw: () => star(10, 18, 8) + star(108, 98, 7) + star(106, 14, 5),
  },
  halo: {
    name: 'Halo',
    draw: () => `<ellipse cx="60" cy="4" rx="28" ry="6.5" fill="none" stroke="url(#gold)" stroke-width="5" ${RAISED}/>`,
  },
  thumbsUp: { name: 'Thumbs up', draw: () => `<g transform="translate(10 96) rotate(-14) scale(1.12)">${GLOVE}</g>` },
  thumbsDown: { name: 'Thumbs down', draw: () => `<g transform="translate(110 92) rotate(166) scale(1.12)">${GLOVE}</g>` },
} as const satisfies Record<string, { name: string; draw: (c: Ctx) => string }>

export type EyeId = keyof typeof EYES
export type BrowId = keyof typeof BROWS
export type MouthId = keyof typeof MOUTHS
export type ExtraId = keyof typeof EXTRAS

export const DEFAULT_FACE: FaceOptions = {
  color: FACE_COLORS[0].color,
  eyes: 'smug',
  brows: 'suspicious',
  mouth: 'smirk',
  extras: [],
  outline: false,
}

/** Drawn behind the head rather than over it. */
const BEHIND: ExtraId[] = ['halo']

/** The face as standalone SVG markup. */
export function faceSvg(options: FaceOptions): string {
  const base = options.color
  const [, , lightness] = hexToHsl(base)
  const dark = lightness < 0.25
  const c: Ctx = {
    skin: shade(base, 0.03),
    skinLight: shade(base, 0.16, 0.95),
    brow: dark ? shade(base, 0.32) : shade(base, -0.28, 1.05),
    line: dark ? '#dfe5f0' : shade(base, -0.36, 1.1),
    defs: [],
  }
  const eyes = (EYES[options.eyes] ?? EYES.round).draw(c)
  const brows = (BROWS[options.brows] ?? BROWS.none).draw(c)
  const mouth = (MOUTHS[options.mouth] ?? MOUTHS.smile).draw(c)
  const extras = options.extras.filter((id) => id in EXTRAS)
  const behind = extras.filter((id) => BEHIND.includes(id)).map((id) => EXTRAS[id].draw()).join('')
  const over = extras.filter((id) => !BEHIND.includes(id)).map((id) => EXTRAS[id].draw()).join('')

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 140">` +
    `<defs>` +
    // The head.
    `<radialGradient id="body" cx="0.38" cy="0.3" r="0.8">` +
    `<stop offset="0" stop-color="${shade(base, 0.2, 0.95)}"/>` +
    `<stop offset="0.5" stop-color="${base}"/>` +
    `<stop offset="0.85" stop-color="${shade(base, -0.14, 1.05)}"/>` +
    `<stop offset="1" stop-color="${shade(base, -0.24, 1.1)}"/>` +
    `</radialGradient>` +
    `<radialGradient id="rim" cx="0.5" cy="0.5" r="0.5"><stop offset="0.78" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.28"/></radialGradient>` +
    `<radialGradient id="bounce" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${shade(base, 0.25)}" stop-opacity="0.7"/><stop offset="1" stop-color="${shade(base, 0.25)}" stop-opacity="0"/></radialGradient>` +
    `<radialGradient id="bloom" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#fff" stop-opacity="0.7"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>` +
    `<radialGradient id="ground" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#000" stop-opacity="0.32"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>` +
    // Parts.
    `<linearGradient id="lid" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.skinLight}"/><stop offset="1" stop-color="${c.skin}"/></linearGradient>` +
    `<radialGradient id="sclera" cx="0.45" cy="0.4" r="0.65"><stop offset="0.55" stop-color="#ffffff"/><stop offset="1" stop-color="#cdd6e3"/></radialGradient>` +
    `<radialGradient id="iris" cx="0.4" cy="0.35" r="0.7"><stop offset="0" stop-color="#4a3326"/><stop offset="1" stop-color="#140c08"/></radialGradient>` +
    `<linearGradient id="mouth" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a0611"/><stop offset="1" stop-color="#6b1427"/></linearGradient>` +
    `<linearGradient id="teeth" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#d9e0ea"/></linearGradient>` +
    `<radialGradient id="tongue" cx="0.45" cy="0.35" r="0.7"><stop offset="0" stop-color="#ff8fb0"/><stop offset="1" stop-color="#d94672"/></radialGradient>` +
    `<linearGradient id="gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff3a6"/><stop offset="0.5" stop-color="#ffd23f"/><stop offset="1" stop-color="#e59a00"/></linearGradient>` +
    `<linearGradient id="heart" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff6d8a"/><stop offset="1" stop-color="#d4123b"/></linearGradient>` +
    `<linearGradient id="water" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d6f3ff"/><stop offset="1" stop-color="#3fa9f5"/></linearGradient>` +
    `<linearGradient id="lens" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b4250"/><stop offset="0.5" stop-color="#11141a"/><stop offset="1" stop-color="#262b35"/></linearGradient>` +
    `<linearGradient id="glove" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#cfd7e4"/></linearGradient>` +
    // Light: raised shapes catch it from the top left; cavities are shadowed from their top edge.
    `<filter id="bevel" x="-30%" y="-30%" width="160%" height="160%">` +
    `<feGaussianBlur in="SourceAlpha" stdDeviation="1.4" result="b"/>` +
    `<feSpecularLighting in="b" surfaceScale="2.2" specularConstant="0.5" specularExponent="24" lighting-color="#ffffff" result="s">` +
    `<feDistantLight azimuth="225" elevation="42"/></feSpecularLighting>` +
    `<feComposite in="s" in2="SourceAlpha" operator="in" result="si"/>` +
    `<feOffset in="SourceAlpha" dx="0.6" dy="1.4" result="o"/><feGaussianBlur in="o" stdDeviation="0.9" result="ob"/>` +
    `<feFlood flood-color="#000" flood-opacity="0.32"/><feComposite in2="ob" operator="in" result="drop"/>` +
    `<feMerge><feMergeNode in="drop"/><feMergeNode in="SourceGraphic"/><feMergeNode in="si"/></feMerge>` +
    `</filter>` +
    `<filter id="inset" x="-20%" y="-20%" width="140%" height="140%">` +
    `<feComponentTransfer in="SourceAlpha" result="inv"><feFuncA type="table" tableValues="1 0"/></feComponentTransfer>` +
    `<feOffset in="inv" dx="0" dy="2.6" result="io"/><feGaussianBlur in="io" stdDeviation="1.8" result="ib"/>` +
    `<feFlood flood-color="#000" flood-opacity="0.5"/><feComposite in2="ib" operator="in" result="sh"/>` +
    `<feComposite in="sh" in2="SourceAlpha" operator="in" result="shi"/>` +
    `<feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="shi"/></feMerge>` +
    `</filter>` +
    // A carved line: its own soft inner shading, no shine.
    `<filter id="groove" x="-20%" y="-40%" width="140%" height="180%">` +
    `<feGaussianBlur in="SourceAlpha" stdDeviation="0.5" result="b"/>` +
    `<feOffset in="b" dx="0" dy="-0.8" result="o"/>` +
    `<feFlood flood-color="#000" flood-opacity="0.45"/><feComposite in2="o" operator="in" result="d"/>` +
    `<feComposite in="d" in2="SourceAlpha" operator="in" result="di"/>` +
    `<feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="di"/></feMerge>` +
    `</filter>` +
    `<filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.4"/></filter>` +
    `<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3.2"/></filter>` +
    c.defs.join('') +
    `</defs>` +
    `<ellipse cx="70" cy="128" rx="40" ry="7" fill="url(#ground)"/>` +
    `<g transform="translate(10 8)">` +
    behind +
    `<circle cx="60" cy="60" r="50" fill="url(#body)"${options.outline ? ' stroke="#121212" stroke-width="5"' : ''}/>` +
    `<circle cx="60" cy="60" r="50" fill="url(#rim)"/>` +
    `<ellipse cx="60" cy="98" rx="30" ry="9" fill="url(#bounce)"/>` +
    `<ellipse cx="42" cy="27" rx="25" ry="13" fill="url(#bloom)" transform="rotate(-28 42 27)" filter="url(#glow)"/>` +
    `<ellipse cx="36" cy="24" rx="8" ry="4" fill="#ffffff" opacity="0.75" transform="rotate(-32 36 24)"/>` +
    eyes +
    brows +
    mouth +
    over +
    `</g>` +
    `</svg>`
  )
}

export function faceDataUri(options: FaceOptions): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(faceSvg(options))}`
}

/** A random face, for the dice button. */
export function randomFace(): FaceOptions {
  const pick = <T,>(items: readonly T[]) => items[Math.floor(Math.random() * items.length)]
  const extras = (Object.keys(EXTRAS) as ExtraId[]).filter(() => Math.random() < 0.12)
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
