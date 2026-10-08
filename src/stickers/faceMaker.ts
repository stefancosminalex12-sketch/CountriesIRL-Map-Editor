/**
 * The face maker: a countryball, assembled from parts, in any colour — or in a country's flag.
 *
 * Original artwork, drawn here as SVG. A face is a fill and one choice from each part list —
 * eyes, brows, mouth — plus any extras, and the same options always draw the same face.
 *
 * **The countryball look**, applied the same way to every part:
 *
 * - The head is a flat ball with a black outline, filled with one colour or with a flag
 *   (`color: 'flag'`, the artwork in `flagHref`), under a faint highlight and shade so it still
 *   reads as round. With no flag given — a gallery thumbnail — it shows white over red, the
 *   original countryball.
 * - The eyes are countryball eyes: white shapes with a black outline, the emotion in their shape —
 *   cut flat for half-closed, slanting to the nose for angry, up to it for sad, pushed up from
 *   below for happy. A pupil is a plain black dot, drawn only where the eye looks somewhere.
 * - Everything is drawn over the fill — eyes, brows, mouth, hands — so it is always on top of the
 *   colour or the flag.
 * - Mouths, brows and lines are flat and black-edged. Hands are the author's own 3D glove hands
 *   (`handArt.ts`), placed as pictures by `hand()`.
 *
 * The result is an SVG data URI: small, sharp at any size, and in every export.
 */

import { HAND_ART, type HandId } from './handArt'

export interface FaceOptions {
  /** `#rrggbb`, or `'flag'` for a ball in a country's flag (see `flagHref`). */
  color: string
  /** The flag a `'flag'` ball is filled with, as an image URL (a data URI, so exports keep it). */
  flagHref?: string
  eyes: EyeId
  brows: BrowId
  mouth: MouthId
  extras: ExtraId[]
  outline: boolean
}

/**
 * The colour presets, in the order the panels show them: light blue, blue, lime, yellow, orange,
 * red, purple, gray, black. Blue, lime, yellow, orange, red and purple are the default tiers'
 * colours; a picker beside them gives any other, and the flag dot a country's flag.
 */
export const FACE_COLORS: Array<{ name: string; color: string }> = [
  { name: 'Light blue', color: '#41b6e6' },
  { name: 'Blue', color: '#1b4fd8' },
  { name: 'Lime', color: '#82c431' },
  { name: 'Yellow', color: '#faca15' },
  { name: 'Orange', color: '#f57c1f' },
  { name: 'Red', color: '#b00302' },
  { name: 'Purple', color: '#9062f9' },
  { name: 'Gray', color: '#8a9099' },
  { name: 'Black', color: '#111827' },
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
  /** The ball's own colour, for parts drawn in it (cat ears, a nose). */
  skin: string
  skinLight: string
  /** Brows: black, or light on a black ball. */
  brow: string
  /** Lines and edges — a closed eye, a smile, a mouth's edge. */
  line: string
  /** The outline every eye and the ball itself is drawn with. */
  ink: string
  /** Defs a part needs (clip paths), collected and written once. */
  defs: string[]
  /** The corners of a smiling mouth. Kept for the parts that note them; nothing is sculpted now. */
  cheeks: Array<[number, number]>
}

const RAISED = 'filter="url(#bevel)"'
const SUNKEN = 'filter="url(#inset)"'

type Side = -1 | 1

interface EyeSpec {
  cx: number
  cy: number
  rx: number
  ry: number
  /** Where the eye looks, in units — and, given, that it has a pupil. */
  look?: [number, number]
  /** Pupil size, as a share of the eye's smaller radius (scaled down to a countryball's dot). */
  iris?: number
  lid?: 'half' | 'heavy' | 'angry' | 'sad' | 'happy'
}

/**
 * One countryball eye: a white shape with a black outline, cut by its lid. The cut is the
 * expression — flat across for half-closed or heavy, slanting hard down to the nose for angry, up
 * to it for sad; a happy eye is cut from below, pushed up by the cheek. A pupil, where the eye
 * looks somewhere, is a plain black dot inside what shows.
 */
function eye(c: Ctx, e: EyeSpec, side: Side, key: string): string {
  const { cx, cy, rx, ry } = e
  const sw = 2.4
  const left = cx - rx - 4
  const right = cx + rx + 4
  const top = cy - ry - 4
  const bottom = cy + ry + 4
  // `side` is +1 for the left eye: its outer corner is on the left.
  const outer = side === 1 ? left : right
  const inner = side === 1 ? right : left
  let region: string | null = null
  let cut = ''
  const keepBelow = (a: number, b: number, bulge: number) => {
    const mid = (a + b) / 2 + bulge
    cut = `M${outer} ${a.toFixed(2)} Q${cx} ${mid.toFixed(2)} ${inner} ${b.toFixed(2)}`
    region = `${cut} L${inner} ${bottom} L${outer} ${bottom} Z`
  }
  switch (e.lid) {
    case 'half':
      keepBelow(cy - ry * 0.18, cy - ry * 0.18, ry * 0.12)
      break
    case 'heavy':
      keepBelow(cy + ry * 0.12, cy + ry * 0.12, ry * 0.1)
      break
    case 'angry':
      keepBelow(cy - ry * 1.05, cy + ry * 0.12, ry * 0.08)
      break
    case 'sad':
      keepBelow(cy + ry * 0.05, cy - ry * 1.0, ry * 0.08)
      break
    case 'happy': {
      const low = cy + ry * 0.3
      cut = `M${left} ${(low + 2).toFixed(2)} Q${cx} ${(low - ry * 0.75).toFixed(2)} ${right} ${(low + 2).toFixed(2)}`
      region = `M${left} ${top} L${right} ${top} L${right} ${(low + 2).toFixed(2)} Q${cx} ${(low - ry * 0.75).toFixed(2)} ${left} ${(low + 2).toFixed(2)} Z`
      break
    }
  }
  const inside = `eye-${key}-in`
  const edge = `eye-${key}-edge`
  c.defs.push(
    `<clipPath id="${inside}"><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"/></clipPath>` +
      `<clipPath id="${edge}"><ellipse cx="${cx}" cy="${cy}" rx="${rx + sw / 2}" ry="${ry + sw / 2}"/></clipPath>` +
      (region ? `<clipPath id="eye-${key}-shown"><path d="${region}"/></clipPath>` : ''),
  )
  let pupil = ''
  if (e.look) {
    const [dx, dy] = e.look
    const r = Math.min(rx, ry) * (e.iris ?? 0.6) * 0.62
    pupil =
      `<g clip-path="url(#${inside})"><circle cx="${cx + dx}" cy="${cy + dy}" r="${r.toFixed(2)}" fill="#0c0c0c"/>` +
      (r > 4.5 ? `<circle cx="${cx + dx - r * 0.35}" cy="${cy + dy - r * 0.4}" r="${(r * 0.28).toFixed(2)}" fill="#ffffff"/>` : '') +
      `</g>`
  }
  const ball = `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#ffffff" stroke="${c.ink}" stroke-width="${sw}"/>` + pupil
  return (
    (region ? `<g clip-path="url(#eye-${key}-shown)">${ball}</g>` : ball) +
    (cut ? `<path d="${cut}" fill="none" stroke="${c.ink}" stroke-width="${sw}" stroke-linecap="round" clip-path="url(#${edge})"/>` : '')
  )
}

const pair = (c: Ctx, spec: EyeSpec, right: Partial<EyeSpec> = {}) =>
  eye(c, { ...spec, cx: 43 }, 1, 'l') + eye(c, { ...spec, cx: 77, ...right }, -1, 'r')

/** A line drawn on the ball: a closed eye, a smile — flat and black, round at the ends. */
const ridge = (c: Ctx, d: string, width = 5.6, color?: string) =>
  `<path d="${d}" fill="none" stroke="${color ?? c.line}" stroke-width="${Math.max(1.5, width * 0.52).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`

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

/** A rose head: outer petals cupping a tight spiral, lit from the top left. */
function rose(cx: number, cy: number, r: number): string {
  const t = `translate(${cx} ${cy}) scale(${r / 12})`
  return (
    `<g transform="${t}" ${RAISED}>` +
    `<path d="M-12 1 C-13 -8 -6 -13 0 -12 C6 -13 13 -8 12 1 C11 9 5 12 0 12 C-5 12 -11 9 -12 1 Z" fill="url(#roseG)" stroke="#7a0a18" stroke-width="0.8"/>` +
    `<path d="M-9 3 C-10 -4 -4 -8 1 -7 C6 -7 9 -3 8 2 C6 7 -6 8 -9 3 Z" fill="#e2263f" stroke="#8e0c20" stroke-width="0.7"/>` +
    `<path d="M-5 0 C-5 -4 0 -6 3 -4 C6 -2 5 2 2 3 C-1 4 -3 1 -1 -1" fill="none" stroke="#a0122a" stroke-width="0.8" stroke-linecap="round"/>` +
    `<path d="M-12 1 C-9 6 -4 8 0 8 C4 8 9 6 12 1" fill="none" stroke="#9b0f24" stroke-width="0.8" opacity="0.7"/>` +
    `<ellipse cx="-5" cy="-7" rx="3.4" ry="1.8" fill="#ffffff" opacity="0.45" transform="rotate(-25 -5 -7)"/>` +
    `</g>`
  )
}

/** A brow: a slim black crescent, thickest in the middle and tapering to round ends. */
function brow(c: Ctx, x1: number, y1: number, qx: number, qy: number, x2: number, y2: number, thick = 4.6): string {
  return `<path d="M${x1} ${y1} Q${qx} ${qy - thick} ${x2} ${y2} Q${qx} ${qy + thick * 0.2} ${x1} ${y1} Z" fill="${c.brow}" stroke="${c.brow}" stroke-width="0.8" stroke-linejoin="round"/>`
}

const mirror = (x: number) => 120 - x
const browPair = (c: Ctx, x1: number, y1: number, qx: number, qy: number, x2: number, y2: number, thick?: number) =>
  brow(c, x1, y1, qx, qy, x2, y2, thick) + brow(c, mirror(x1), y1, mirror(qx), qy, mirror(x2), y2, thick)

/* ------------------------------------------------------------------- parts */

const ROUND: EyeSpec = { cx: 43, cy: 52, rx: 10.5, ry: 12.5 }

export const EYES = {
  round: { name: 'Round', draw: (c: Ctx) => pair(c, ROUND) },
  wide: { name: 'Shocked', draw: (c: Ctx) => pair(c, { cx: 43, cy: 50, rx: 13, ry: 15, iris: 0.42, look: [0, 0] }) },
  side: { name: 'Side-eye', draw: (c: Ctx) => pair(c, { ...ROUND, look: [4.2, 1], lid: 'half' }) },
  smug: { name: 'Smug', draw: (c: Ctx) => pair(c, { ...ROUND, rx: 11.5, ry: 11, look: [3.5, 3], lid: 'half' }) },
  tired: { name: 'Tired', draw: (c: Ctx) => pair(c, { ...ROUND, rx: 11.5, ry: 11, look: [0, 3.5], lid: 'heavy' }) },
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
  rolling: { name: 'Eye roll', draw: (c: Ctx) => pair(c, { ...ROUND, look: [1, -6], iris: 0.55 }) },
  puppy: {
    name: 'Puppy',
    draw: (c: Ctx) =>
      pair(c, { cx: 44, cy: 53, rx: 11, ry: 12.5, iris: 0.82, look: [0, 1.5], lid: 'sad' }) +
      // Extra catch-lights: the wet, pleading look.
      [44, 76]
        .map((x) => `<circle cx="${x + 4}" cy="57" r="1.8" fill="#ffffff" opacity="0.9"/><circle cx="${x - 3}" cy="58.5" r="1.1" fill="#ffffff" opacity="0.8"/>`)
        .join(''),
  },
  money: {
    name: 'Money',
    draw: () =>
      [44, 76]
        .map(
          (x) =>
            `<text x="${x}" y="61" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="25" fill="url(#cash)" stroke="#145c22" stroke-width="1.2" ${RAISED}>$</text>`,
        )
        .join(''),
  },
  spiral: {
    name: 'Spiral',
    draw: (c: Ctx) =>
      [44, 76]
        .map(
          (x) =>
            `<circle cx="${x}" cy="52" r="10.5" fill="url(#sclera)" ${SUNKEN}/>` +
            `<path d="M${x} 52 m0 -1.5 a1.5 1.5 0 1 1 -1.5 1.5 a3 3 0 1 1 3 3 a4.5 4.5 0 1 1 -4.5 -4.5 a6 6 0 1 1 6 6 a7.5 7.5 0 1 1 -7.5 -7.5" fill="none" stroke="${c.line}" stroke-width="1.8" stroke-linecap="round"/>`,
        )
        .join(''),
  },
  glossy: {
    name: 'Glossy',
    draw: (c: Ctx) =>
      pair(c, { cx: 43, cy: 52, rx: 12.5, ry: 14, iris: 0.86, look: [0, 1] }) +
      [43, 77].map((x) => `<circle cx="${x - 3.5}" cy="47.5" r="3.6" fill="#ffffff" opacity="0.95"/><circle cx="${x + 3.6}" cy="56.5" r="1.6" fill="#ffffff" opacity="0.85"/>`).join(''),
  },
  lashes: {
    name: 'Lashes',
    draw: (c: Ctx) =>
      pair(c, { cx: 43, cy: 52, rx: 12, ry: 13.5, iris: 0.78, look: [0.5, 1.5] }) +
      [
        [43, 1],
        [77, -1],
      ]
        .map(([x, side]) =>
          [0, 1, 2, 3, 4]
            .map((k) => {
              const a = (-150 + k * 22) * (Math.PI / 180)
              const bx = x + Math.cos(a) * 12.5 * (side as number)
              const by = 52 + Math.sin(a) * 14
              const tx = x + Math.cos(a) * 18 * (side as number)
              const ty = 52 + Math.sin(a) * 19.5
              return `<path d="M${bx.toFixed(1)} ${by.toFixed(1)} Q${((bx + tx) / 2).toFixed(1)} ${(ty - 1).toFixed(1)} ${tx.toFixed(1)} ${ty.toFixed(1)}" stroke="#141822" stroke-width="1.5" fill="none" stroke-linecap="round"/>`
            })
            .join(''),
        )
        .join('') +
      [43, 77].map((x) => `<circle cx="${x - 3}" cy="48" r="3" fill="#ffffff" opacity="0.95"/>`).join(''),
  },
  bloodshot: {
    name: 'Bloodshot',
    draw: (c: Ctx) =>
      [43, 77].map((x) => `<ellipse cx="${x}" cy="53" rx="13.5" ry="12.5" fill="#e8708a" opacity="0.55" filter="url(#soft)"/>`).join('') +
      pair(c, { ...ROUND, rx: 11.5, ry: 11, look: [0, 0.5], iris: 0.5, lid: 'heavy' }) +
      [43, 77].map((x) => `<path d="M${x - 10} 59 Q${x} 66 ${x + 10} 59" fill="none" stroke="#d3415e" stroke-width="1.6" stroke-linecap="round" opacity="0.8"/>`).join(''),
  },
  oneBig: {
    name: 'One big',
    draw: (c: Ctx) =>
      eye(c, { cx: 40, cy: 55, rx: 9.5, ry: 7.5, look: [2, 0.5], lid: 'angry' }, 1, 'l') +
      `<ellipse cx="77" cy="50" rx="17" ry="18" fill="#e8708a" opacity="0.4" filter="url(#soft)"/>` +
      eye(c, { cx: 77, cy: 50, rx: 15.5, ry: 16.5, iris: 0.48, look: [-2, 1] }, -1, 'r'),
  },
  // A kitten's eyes: big and round, glossy pupils with two sparkles, three little lashes at the outer corner.
  cat: {
    name: 'Cat',
    draw: (c: Ctx) =>
      pair(c, { cx: 43, cy: 53, rx: 12, ry: 13, iris: 0.95, look: [1.2, 1.4] }, { look: [-1.2, 1.4] }) +
      [
        [43, 1],
        [77, -1],
      ]
        .map(
          ([x, d]) =>
            `<circle cx="${x + d * -1.8}" cy="57.6" r="1.5" fill="#ffffff"/>` +
            [0, 1, 2]
              .map((k) => {
                const a = ((-158 + k * 16) * Math.PI) / 180
                const bx = x + Math.cos(a) * 12 * d
                const by = 53 + Math.sin(a) * 13
                const tx = x + Math.cos(a) * 17 * d
                const ty = 53 + Math.sin(a) * 17.6
                return `<path d="M${bx.toFixed(1)} ${by.toFixed(1)} L${tx.toFixed(1)} ${ty.toFixed(1)}" stroke="${c.ink}" stroke-width="1.5" stroke-linecap="round"/>`
              })
              .join(''),
        )
        .join(''),
  },
  squeeze: {
    name: 'Squeezed',
    draw: (c: Ctx) =>
      ridge(c, 'M32 49 Q42 57 53 52', 3.8) +
      ridge(c, 'M88 49 Q78 57 67 52', 3.8) +
      ridge(c, 'M34 44 Q40 47 46 46 M86 44 Q80 47 74 46 M54 46 Q57 44 60 45 Q63 44 66 46', 1.6),
  },
  tearful: {
    name: 'Teary',
    draw: (c: Ctx) =>
      pair(c, { ...ROUND, look: [0, 2.5], lid: 'sad', iris: 0.66 }) +
      [43, 77]
        .map(
          (x) =>
            `<path d="M${x - 9.5} 57 Q${x} 67 ${x + 9.5} 57" fill="none" stroke="#bfe8ff" stroke-width="3.2" stroke-linecap="round" opacity="0.95"/>` +
            `<circle cx="${x + 4}" cy="60.5" r="1.4" fill="#ffffff"/>`,
        )
        .join(''),
  },
  winkSide: {
    name: 'Squint and look',
    draw: (c: Ctx) => ridge(c, 'M33 54 Q43 49 53 55', 4.2) + eye(c, { ...ROUND, cx: 77, lid: 'half', look: [-3.5, 1] }, -1, 'r'),
  },
  halfSide: { name: 'Half, aside', draw: (c: Ctx) => pair(c, { ...ROUND, rx: 11.5, ry: 10.5, look: [4, 2.5], lid: 'heavy' }) },
  hopeful: { name: 'Lidded, up', draw: (c: Ctx) => pair(c, { ...ROUND, rx: 11, ry: 12, look: [0.5, -0.5], lid: 'sad', iris: 0.62 }) },
  bags: {
    name: 'Heavy-lidded',
    draw: (c: Ctx) =>
      pair(c, { ...ROUND, cy: 53, rx: 12, ry: 10, look: [1.5, 2], lid: 'heavy' }) +
      ridge(c, 'M34 65 Q43 69 52 65', 1.5) +
      ridge(c, 'M68 65 Q77 69 86 65', 1.5),
  },
  staring: { name: 'Staring', draw: (c: Ctx) => pair(c, { cx: 43, cy: 50, rx: 12.5, ry: 14.5, iris: 0.36, look: [2, 0] }, { look: [-2, 0] }) },
  narrowed: {
    name: 'Narrowed',
    draw: (c: Ctx) => pair(c, { cx: 43, cy: 55, rx: 12.5, ry: 9.5, iris: 0.62, look: [3, 0.5], lid: 'angry' }, { look: [-3, 0.5] }),
  },
  fury: {
    name: 'Fury',
    draw: (c: Ctx) =>
      pair(c, { cx: 43, cy: 56, rx: 13.5, ry: 10, iris: 0.6, look: [3, 1.5], lid: 'angry' }, { look: [-3, 1.5] }) +
      ridge(c, 'M55 43 L60 49 L65 43', 1.6),
  },
  blackEye: {
    name: 'Black eye',
    draw: (c: Ctx) =>
      eye(c, { cx: 42, cy: 52, rx: 12, ry: 13.5, iris: 0.42, look: [1, -1] }, 1, 'l') +
      `<ellipse cx="78" cy="53" rx="16.5" ry="17" fill="url(#bruise)" ${RAISED}/>` +
      eye(c, { cx: 78, cy: 53, rx: 12, ry: 12.5, iris: 0.42, look: [-1, -1], lid: 'half' }, -1, 'r'),
  },
  goofy: {
    name: 'Goofy',
    draw: (c: Ctx) =>
      eye(c, { cx: 42, cy: 50, rx: 14, ry: 15, iris: 0.5, look: [3, -1] }, 1, 'l') +
      eye(c, { cx: 78, cy: 52, rx: 11, ry: 12, iris: 0.5, look: [-1, 2] }, -1, 'r'),
  },
  uneven: {
    name: 'Uneven',
    draw: (c: Ctx) =>
      eye(c, { cx: 42, cy: 57, rx: 9.5, ry: 9, iris: 0.62, look: [2, 0.5], lid: 'sad' }, 1, 'l') +
      eye(c, { cx: 77, cy: 48, rx: 11.5, ry: 11, iris: 0.6, look: [-2.5, 1], lid: 'half' }, -1, 'r'),
  },
  hot: {
    name: 'Overheated',
    draw: (c: Ctx) =>
      eye(c, { ...ROUND, cx: 42, rx: 12, ry: 12.5, look: [0.5, 2.5], lid: 'heavy' }, 1, 'l') +
      eye(c, { cx: 78, cy: 51, rx: 13, ry: 14.5, iris: 0.4, look: [-1, 0] }, -1, 'r'),
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
  calm: { name: 'Calm', draw: (c: Ctx) => browPair(c, 32, 35, 43, 28, 55, 33) },
  raised: { name: 'Raised', draw: (c: Ctx) => browPair(c, 32, 31, 43, 19, 55, 27) },
  angry: { name: 'Angry', draw: (c: Ctx) => browPair(c, 30, 30, 43, 33, 57, 42, 5.6) },
  worried: { name: 'Worried', draw: (c: Ctx) => browPair(c, 31, 38, 42, 30, 55, 26) },
  suspicious: {
    name: 'One up',
    draw: (c: Ctx) => brow(c, 32, 37, 43, 34, 55, 37) + brow(c, 65, 28, 77, 16, 89, 26),
  },
  thick: { name: 'Bushy', draw: (c: Ctx) => browPair(c, 31, 34, 44, 28, 57, 35, 7.5) },
  // Floating just above the head, as cartoon brows do when the eyes go wide.
  floating: { name: 'Floating', draw: (c: Ctx) => browPair(c, 27, 12, 38, 5, 50, 6) },
  floatingWorried: { name: 'Floating, worried', draw: (c: Ctx) => browPair(c, 26, 15, 37, 6, 49, 2) },
  floatingAngry: { name: 'Floating, cross', draw: (c: Ctx) => browPair(c, 28, 4, 40, 6, 51, 13) },
  floatingOne: {
    name: 'Floating, one up',
    draw: (c: Ctx) => brow(c, 26, 16, 36, 9, 47, 9) + brow(c, 71, 0, 83, -6, 95, 1),
  },
} as const satisfies Record<string, { name: string; draw: (c: Ctx) => string }>

/** An open mouth: dark inside, black-edged, with whatever is inside it clipped to it. */
function cavity(c: Ctx, d: string, inside: string, key: string): string {
  c.defs.push(`<clipPath id="mouth-${key}"><path d="${d}"/></clipPath>`)
  return (
    `<path d="${d}" fill="url(#mouth)"/>` +
    `<g clip-path="url(#mouth-${key})">${inside}</g>` +
    `<path d="${d}" fill="none" stroke="${c.line}" stroke-width="2.4" stroke-linejoin="round"/>`
  )
}

/**
 * A row of teeth: one clean white band, clipped by the mouth, with a thin divider at each gap —
 * so the row reads as teeth without turning into a stack of separate blocks.
 */
const teethRow = (y: number, h: number, x1 = 30, x2 = 90, gaps: number[] = []) =>
  `<rect x="${x1}" y="${y}" width="${x2 - x1}" height="${h}" rx="${Math.min(3, h / 3).toFixed(2)}" fill="url(#teeth)"/>` +
  gaps
    .map((x) => `<path d="M${x} ${(y + h * 0.1).toFixed(2)} V${(y + h * 0.9).toFixed(2)}" stroke="#9aa1ab" stroke-width="0.8" stroke-linecap="round"/>`)
    .join('')

const tongue = (cx: number, cy: number, rx: number, ry: number) =>
  `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#tongue)"/>` +
  `<path d="M${cx} ${cy - ry * 0.6} V${cy + ry * 0.2}" stroke="#c43c63" stroke-width="1.2" stroke-linecap="round" opacity="0.7"/>` +
  `<ellipse cx="${cx - rx * 0.35}" cy="${cy - ry * 0.35}" rx="${rx * 0.22}" ry="${ry * 0.18}" fill="#ffffff" opacity="0.45"/>`


/** Pursed lips, raised off the face, `scale` times their usual size, optionally open in an O. */
function lips(c: Ctx, scale = 1, open = false, fill = 'url(#lips)', dy = 0): string {
  const t = `translate(${60 - 60 * scale} ${80 * (1 - scale) + dy}) scale(${scale})`
  return (
    `<g transform="${t}">` +
    `<path d="M48.5 79 C51 72.5 57 72.8 60 76 C63 72.8 69 72.5 71.5 79 C64 80.8 56 80.8 48.5 79 Z" fill="${fill}" stroke="${c.line}" stroke-width="1.5"/>` +
    `<path d="M49.5 80 C53 89.5 67 89.5 70.5 80 C64 81.8 56 81.8 49.5 80 Z" fill="${fill}" stroke="${c.line}" stroke-width="1.5"/>` +
    `<path d="M49 79.6 Q60 82.4 71 79.6" fill="none" stroke="${c.line}" stroke-width="1.5" stroke-linecap="round"/>` +
    (open ? `<ellipse cx="60" cy="80.4" rx="3.6" ry="2.6" fill="url(#mouth)"/>` : '') +
    `<ellipse cx="56" cy="84.6" rx="4" ry="1.4" fill="#ffffff" opacity="0.35"/>` +
    `</g>`
  )
}

/** An even row of tooth gaps from `x1` to `x2`, about `step` apart. */
const gapsBetween = (x1: number, x2: number, step: number) => {
  const n = Math.max(1, Math.round((x2 - x1) / step))
  return Array.from({ length: n - 1 }, (_, i) => +(x1 + ((i + 1) * (x2 - x1)) / n).toFixed(2))
}

/** Records the corners of a smile, so the head pushes its cheeks up there. Draws nothing itself. */
function cheeks(c: Ctx, ...corners: Array<[number, number]>): string {
  c.cheeks.push(...corners)
  return ''
}

/** Little creases at the corners of a closed smile. */
const dimples = (c: Ctx, lx: number, ly: number, rx: number, ry: number) =>
  ridge(c, `M${lx - 2} ${ly - 3} Q${lx - 3.5} ${ly} ${lx - 1.5} ${ly + 2.5}`, 2) +
  ridge(c, `M${rx + 2} ${ry - 3} Q${rx + 3.5} ${ry} ${rx + 1.5} ${ry + 2.5}`, 2)

export const MOUTHS = {
  smile: {
    name: 'Smile',
    draw: (c: Ctx) => cheeks(c, [41, 75], [79, 75]) +
      ridge(c, 'M41 75 Q60 92 79 75') + dimples(c, 41, 75, 79, 75),
  },
  grin: {
    name: 'Grin',
    draw: (c: Ctx) =>
cheeks(c, [35, 71], [85, 71]) +
            cavity(c, 'M35 71 Q60 76 85 71 Q80 99 60 99 Q40 99 35 71 Z', teethRow(70, 9.5, 30, 90, [44, 52, 60, 68, 76]) + tongue(60, 98, 13, 7), 'grin'),
  },
  laugh: {
    name: 'Laugh',
    draw: (c: Ctx) =>
cheeks(c, [32, 68], [88, 68]) +
            cavity(c, 'M32 68 Q60 72 88 68 Q86 106 60 106 Q34 106 32 68 Z', teethRow(66, 8.5, 28, 92, [42, 51, 60, 69, 78]) + tongue(60, 102, 17, 10), 'laugh'),
  },
  teeth: {
    name: 'Big teeth',
    draw: (c: Ctx) =>
cheeks(c, [30, 70], [90, 70]) +
            cavity(
        c,
        'M30 70 Q60 64 90 70 Q88 94 60 96 Q32 94 30 70 Z',
        teethRow(60, 19, 26, 94, [38, 49, 60, 71, 82]) +
          teethRow(79, 20, 26, 94, [40, 50, 60, 70, 80]) +
          `<path d="M26 79 Q60 83 94 79" stroke="${c.line}" stroke-width="1" opacity="0.55" fill="none"/>`,
        'teeth',
      ),
  },
  flat: { name: 'Flat', draw: (c: Ctx) => ridge(c, 'M45 80 Q60 81 75 80') },
  smirk: {
    name: 'Smirk',
    draw: (c: Ctx) => cheeks(c, [78, 71]) +
      ridge(c, 'M43 81 Q63 85 78 71') + ridge(c, 'M80 68 Q83 71 80 75', 2),
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
cheeks(c, [42, 76], [78, 76]) +
            `<path d="M53 80 Q53 97 61 97 Q69 97 69 80 Z" fill="url(#tongue)" stroke="#a52a52" stroke-width="1.2" ${RAISED}/>` +
      `<path d="M61 82 V91" stroke="#c43c63" stroke-width="1.2" stroke-linecap="round"/>` +
      ridge(c, 'M42 76 Q60 86 78 76'),
  },
  kiss: {
    name: 'Kiss',
    draw: (c: Ctx) =>
      `<path d="M55 72 Q66 72 61 79 Q68 85 55 88 Q60 84 57 80 Q61 76 55 72 Z" fill="${c.brow}" ${RAISED}/>`,
  },
  sly: {
    name: 'Sly grin',
    draw: (c: Ctx) =>
cheeks(c, [40, 76], [84, 66]) +
            cavity(c, 'M40 76 Q62 80 84 66 Q82 88 64 91 Q48 92 40 76 Z', teethRow(64, 11, 36, 90, [50, 58, 66, 74, 81]) + tongue(64, 92, 12, 6), 'sly') +
      ridge(c, 'M85 63 Q88 66 86 70', 2),
  },
  grimace: {
    name: 'Grimace',
    draw: (c: Ctx) =>
      cavity(
        c,
        'M30 74 Q60 70 90 74 Q92 88 90 88 Q60 92 30 88 Q28 88 30 74 Z',
        teethRow(70, 10.5, 26, 94, [38, 46, 53, 60, 67, 74, 82]) + teethRow(80.5, 10, 26, 94, [38, 46, 53, 60, 67, 74, 82]) +
          `<path d="M26 80.5 H94" stroke="${c.line}" stroke-width="1" opacity="0.55"/>`,
        'grimace',
      ),
  },
  bite: {
    name: 'Lip bite',
    draw: (c: Ctx) =>
cheeks(c, [42, 78], [78, 78]) +
            ridge(c, 'M42 78 Q60 88 78 78') +
      `<path d="M50 78.5 Q60 82 70 78.5 L69 84 Q60 86.5 51 84 Z" fill="url(#teeth)" stroke="#9aa6b8" stroke-width="0.9" ${RAISED}/>` +
      `<path d="M57 79.5 V85 M63 79.5 V85" stroke="#b9c3d1" stroke-width="0.9"/>`,
  },
  zip: {
    name: 'Zipped',
    draw: (c: Ctx) =>
      ridge(c, 'M40 80 H80', 3.4) +
      Array.from({ length: 9 }, (_, i) => `<rect x="${42.5 + i * 4.3}" y="77" width="2.4" height="6" rx="0.6" fill="#c9ced8" stroke="#6f7787" stroke-width="0.6"/>`).join('') +
      `<g ${RAISED}><rect x="78" y="76" width="7" height="8" rx="1.5" fill="#d7dce5" stroke="#6f7787" stroke-width="0.8"/><rect x="80" y="83" width="3.2" height="9" rx="1.6" fill="#d7dce5" stroke="#6f7787" stroke-width="0.8"/></g>`,
  },
  puff: {
    name: 'Puffed',
    draw: (c: Ctx) =>
      cheeks(c, [36, 74], [84, 74]) +
      `<ellipse cx="60" cy="80" rx="7" ry="4.6" fill="url(#brow)" stroke="${c.brow}" stroke-width="1.2" filter="url(#bevelSoft)"/>` +
      ridge(c, 'M51 79 Q53 76 55 79', 1.6) +
      ridge(c, 'M65 79 Q67 76 69 79', 1.6),
  },
  whistle: {
    name: 'Whistle',
    draw: (c: Ctx) =>
      cavity(c, 'M64 74 C70 74 70 84 64 84 C58 84 58 74 64 74 Z', '', 'whistle'),
  },
  drool: {
    name: 'Drool',
    draw: (c: Ctx) =>
      cavity(c, 'M40 74 Q60 79 80 74 Q76 92 60 93 Q44 92 40 74 Z', teethRow(72, 7, 36, 84, [48, 56, 64, 72]) + tongue(60, 92, 11, 6), 'drool') +
      `<path d="M76 84 Q80 96 78 104 Q75 109 72 104 Q71 96 76 84 Z" fill="url(#water)" stroke="#2a8ad6" stroke-width="0.8" ${RAISED}/>`,
  },
  wow: {
    name: 'Wow',
    draw: (c: Ctx) => cavity(c, 'M60 68 C76 68 76 98 60 98 C44 98 44 68 60 68 Z', tongue(60, 98, 11, 7), 'wow'),
  },
  lips: { name: 'Lips', draw: (c: Ctx) => lips(c) },
  ooh: { name: 'Ooh', draw: (c: Ctx) => lips(c, 1.05, true) },
  pout: { name: 'Pout', draw: (c: Ctx) => lips(c, 0.85, false, 'url(#lips)', 3) },
  redLips: { name: 'Red lips', draw: (c: Ctx) => lips(c, 1.4, false, 'url(#redLip)') },
  blank: { name: 'Blank smile', draw: (c: Ctx) => cheeks(c, [31, 78], [89, 78]) + ridge(c, 'M31 78 Q60 90 89 78', 3.6) },
  wobble: { name: 'Wobbly', draw: (c: Ctx) => ridge(c, 'M40 80 Q46 91 52 83 Q56 78 60 82 Q64 78 68 83 Q74 91 80 80', 4.4) },
  frownSmall: { name: 'Small frown', draw: (c: Ctx) => ridge(c, 'M50 87 Q60 80 70 87', 3.6) },
  fewTeeth: {
    name: 'Few teeth',
    draw: (c: Ctx) =>
      cheeks(c, [38, 78], [82, 78]) +
      cavity(c, 'M38 78 Q60 85 82 78 Q78 92 60 93 Q42 92 38 78 Z', teethRow(77.5, 9, 45, 75, [51, 57, 63, 69]), 'few'),
  },
  troll: {
    name: 'Troll grin',
    draw: (c: Ctx) =>
      cheeks(c, [22, 64], [98, 64]) +
      cavity(
        c,
        'M22 64 Q60 77 98 64 Q95 99 60 102 Q25 99 22 64 Z',
        teethRow(63, 14, 18, 102, gapsBetween(18, 102, 8)) + teethRow(86, 14, 22, 98, gapsBetween(22, 98, 8.5)),
        'troll',
      ),
  },
  openTeeth: {
    name: 'Open grin',
    draw: (c: Ctx) =>
      cheeks(c, [28, 66], [92, 66]) +
      cavity(c, 'M28 66 Q60 73 92 66 Q88 105 60 107 Q32 105 28 66 Z', teethRow(64, 11, 24, 96, gapsBetween(24, 96, 8.5)), 'open'),
  },
  tallShout: {
    name: 'Tall shout',
    draw: (c: Ctx) =>
      cavity(
        c,
        'M40 67 Q60 62 80 67 Q86 90 80 104 Q60 110 40 104 Q34 90 40 67 Z',
        teethRow(63, 9.5, 36, 84, gapsBetween(36, 84, 7)) + teethRow(97, 10, 36, 84, gapsBetween(36, 84, 7)),
        'tall',
      ),
  },
  longO: {
    name: 'Long O',
    draw: (c: Ctx) =>
      cavity(c, 'M60 66 C73 66 75 100 60 103 C45 100 47 66 60 66 Z', teethRow(94, 9, 48, 72, [54, 60, 66]), 'longo'),
  },
  fangs: {
    name: 'Fangs',
    draw: (c: Ctx) => {
      const top = [32, 41, 50, 59, 68, 77, 86]
        .map((x, i) => `<path d="M${x - 4.5} 64 L${x} ${i === 0 || i === 6 ? 84 : 74} L${x + 4.5} 64 Z" fill="url(#teeth)" stroke="#c3ccd8" stroke-width="0.5"/>`)
        .join('')
      const bottom = [38, 48, 58, 68, 78]
        .map((x, i) => `<path d="M${x - 4.5} 106 L${x} ${i === 0 || i === 4 ? 88 : 96} L${x + 4.5} 106 Z" fill="url(#teeth)" stroke="#c3ccd8" stroke-width="0.5"/>`)
        .join('')
      return cavity(c, 'M26 66 Q60 58 94 66 Q92 104 60 107 Q28 104 26 66 Z', top + bottom + tongue(52, 98, 12, 6), 'fangs')
    },
  },
  tongueOut: {
    name: 'Tongue out',
    draw: (c: Ctx) =>
      cheeks(c, [30, 68], [90, 68]) +
      cavity(c, 'M30 68 Q60 74 90 68 Q86 100 60 102 Q34 100 30 68 Z', teethRow(66, 10, 26, 94, gapsBetween(26, 94, 8.5)), 'tongueout') +
      `<path d="M50 96 L50 116 Q60 128 70 116 L70 96 Z" fill="url(#tongue)" stroke="#a52a52" stroke-width="1" ${RAISED}/>` +
      `<path d="M60 99 V114" stroke="#c43c63" stroke-width="1.2" stroke-linecap="round"/>`,
  },
  yawn: {
    name: 'Yawn',
    draw: (c: Ctx) =>
      cavity(
        c,
        'M30 66 Q50 54 84 60 Q90 82 74 100 Q52 110 40 98 Q28 84 30 66 Z',
        `<g transform="rotate(-6 57 62)">${teethRow(55, 11, 26, 92, gapsBetween(28, 90, 8))}</g>`,
        'yawn',
      ),
  },
  dotO: { name: 'Little o', draw: (c: Ctx) => cavity(c, 'M60 81.5 C65 81.5 65 89.5 60 89.5 C55 89.5 55 81.5 60 81.5 Z', '', 'doto') },
  tiny: { name: 'Tiny', draw: (c: Ctx) => ridge(c, 'M55 86 Q60 85 65 86', 3) },
  aside: { name: 'Aside', draw: (c: Ctx) => ridge(c, 'M58 90 Q63 89.5 68 87.5', 3) },
  wideFlat: {
    name: 'Wide flat',
    draw: (c: Ctx) => ridge(c, 'M30 82 Q60 85 90 82', 3.4) + ridge(c, 'M28 78.5 Q30.5 82 28 85.5', 1.8) + ridge(c, 'M92 78.5 Q89.5 82 92 85.5', 1.8),
  },
  wideFrown: { name: 'Wide frown', draw: (c: Ctx) => ridge(c, 'M30 89 Q60 74 90 89', 3.6) },
  grimaceSide: {
    name: 'Sideways grimace',
    draw: (c: Ctx) =>
      cavity(
        c,
        'M44 92 Q64 78 88 70 Q95 80 89 89 Q68 97 44 92 Z',
        `<g transform="rotate(-17 70 83)">${teethRow(71, 11.5, 36, 104, gapsBetween(40, 100, 7))}${teethRow(83, 11, 36, 104, gapsBetween(40, 100, 7))}</g>`,
        'gside',
      ),
  },
  rageO: {
    name: 'Roar',
    draw: (c: Ctx) => cavity(c, 'M46 72 Q60 67 74 72 Q77 94 60 107 Q43 94 46 72 Z', teethRow(66, 9.5, 40, 80, [53, 60, 67]) + tongue(60, 106, 9, 6), 'rage'),
  },
  hangTongue: {
    name: 'Tongue hanging',
    draw: (c: Ctx) =>
      cavity(c, 'M49 74 Q60 69 71 74 Q75 92 66 101 Q60 104 54 101 Q45 92 49 74 Z', '', 'hang') +
      `<path d="M51 93 Q50 113 61 114 Q72 113 71 95 Q61 99 51 93 Z" fill="url(#tongue)" stroke="#c4466d" stroke-width="0.9" ${RAISED}/>` +
      `<path d="M61 99 V109" stroke="#c43c63" stroke-width="1" stroke-linecap="round" opacity="0.7"/>`,
  },
  sideTongue: {
    name: 'Tongue aside',
    draw: (c: Ctx) =>
      cheeks(c, [88, 76]) +
      `<path d="M43 83 Q41 99 50 100 Q59 100 58 86 Z" fill="url(#tongue)" stroke="#c4466d" stroke-width="0.9" ${RAISED}/>` +
      `<path d="M50 88 V96" stroke="#c43c63" stroke-width="1" stroke-linecap="round" opacity="0.7"/>` +
      ridge(c, 'M38 83 Q66 92 88 76', 3.6),
  },
  blep: {
    name: 'Blep',
    draw: (c: Ctx) =>
      `<path d="M52 84 Q51 101 60 101 Q69 101 68 84 Z" fill="url(#tongue)" stroke="#c4466d" stroke-width="0.9" ${RAISED}/>` +
      `<path d="M60 87 V96" stroke="#c43c63" stroke-width="1" stroke-linecap="round" opacity="0.7"/>` +
      ridge(c, 'M50 84 Q60 81 70 84', 3),
  },
  growl: {
    name: 'Growl',
    draw: (c: Ctx) =>
      cavity(
        c,
        'M36 80 Q60 72 84 80 Q88 90 82 97 Q60 92 38 97 Q32 90 36 80 Z',
        teethRow(72, 12.5, 30, 90, gapsBetween(36, 84, 6.5)) + teethRow(85.5, 12, 30, 90, gapsBetween(36, 84, 6.5)),
        'growl',
      ),
  },
  sadOpen: { name: 'Sad open', draw: (c: Ctx) => cavity(c, 'M47 93 Q59 79 75 90 Q61 87 47 93 Z', '', 'sadopen') },
  poutSide: { name: 'Pout aside', draw: (c: Ctx) => `<g transform="translate(6 3) rotate(-8 60 80)">${lips(c, 0.8)}</g>` },
  lipDrool: {
    name: 'Drooling lips',
    draw: (c: Ctx) =>
      lips(c, 0.85, true, 'url(#lips)', 6) +
      `<path d="M65 87 Q67.5 96 65.5 103 Q63.5 106 62.5 102 Q62.5 95 65 87 Z" fill="url(#water)" stroke="#5aaee6" stroke-width="0.6"/>`,
  },
  wacky: {
    name: 'Stretched',
    draw: (c: Ctx) =>
      cheeks(c, [22, 72], [98, 72]) +
      cavity(c, 'M22 72 Q60 66 98 72 Q92 88 60 94 Q28 88 22 72 Z', teethRow(64, 12, 18, 102, gapsBetween(22, 98, 7)), 'wacky') +
      `<g transform="rotate(-38 80 96)"><path d="M73 86 Q72 106 80 107 Q88 106 87 86 Z" fill="url(#tongue)" stroke="#c4466d" stroke-width="0.9" ${RAISED}/>` +
      `<path d="M80 89 V101" stroke="#c43c63" stroke-width="1" stroke-linecap="round" opacity="0.7"/></g>` +
      `<path d="M90 104 Q96 112 101 114" fill="none" stroke="#bfe8ff" stroke-width="1.4" stroke-linecap="round"/>`,
  },
  twoTeeth: {
    name: 'Two teeth',
    draw: (c: Ctx) =>
      cheeks(c, [30, 76], [90, 76]) +
      cavity(
        c,
        'M30 76 Q60 68 90 76 Q90 94 77 98 Q68 92 60 97 Q52 92 43 98 Q30 94 30 76 Z',
        `<rect x="45" y="68" width="8.5" height="12" rx="2.6" fill="url(#teeth)"/><rect x="65" y="68" width="8.5" height="12" rx="2.6" fill="url(#teeth)"/>`,
        'two',
      ),
  },
  // A kitten's mouth: a little pink nose, and under it one "3" on its side — ω.
  kitty: {
    name: 'Kitten',
    draw: (c: Ctx) =>
      `<path d="M56.4 67.4 Q60 66 63.6 67.4 Q62 71.2 60 71.6 Q58 71.2 56.4 67.4 Z" fill="#ff8fb0" stroke="${c.line}" stroke-width="1.2" stroke-linejoin="round"/>` +
      `<path d="M60 71.6 V74.2 M50.6 73.6 Q52.4 79.4 56.6 78.4 Q59.2 77.6 60 74.2 Q60.8 77.6 63.4 78.4 Q67.6 79.4 69.4 73.6" fill="none" stroke="${c.line}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  smallSmile: { name: 'Small smile', draw: (c: Ctx) => ridge(c, 'M53 82 Q60 88 67 82', 2.6) },
  grit: {
    name: 'Gritted',
    draw: (c: Ctx) =>
      cavity(
        c,
        'M34 84 Q60 66 86 84 Q60 94 34 84 Z',
        teethRow(70, 14, 30, 90, [42, 51, 60, 69, 78]) + teethRow(84, 12, 30, 90, [44, 52, 60, 68, 76]) +
          `<path d="M30 84 H90" stroke="${c.line}" stroke-width="1" opacity="0.55"/>`,
        'grit',
      ),
  },
} as const satisfies Record<string, { name: string; draw: (c: Ctx) => string }>

/* ------------------------------------------------------------------- hands */

/*
 * Hands are drawn by `hands.ts`: each sticker holds the pose its reference does, seen the way it is
 * seen there — a fist coming at the viewer, a fist from the side, palms up, a finger gun, praying
 * hands edge on — placed beside the ball by its extra below.
 */

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
      `<g ${RAISED}><path d="M26 44 H94 L92 50 H87 Q85 64 72 64 Q62 64 61 51 H59 Q58 64 48 64 Q35 64 33 50 H28 Z" fill="url(#lens)" stroke="#1a1f2a" stroke-width="1"/></g>` +
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
  nose: {
    name: 'Nose',
    draw: (c: Ctx) =>
      `<path d="M55 66 Q60 58 65 66 Q66 72 60 72 Q54 72 55 66 Z" fill="${c.skinLight}" ${RAISED}/>` +
      `<path d="M56.5 69.5 Q58 71 59 69.8 M61 69.8 Q62 71 63.5 69.5" stroke="${c.line}" stroke-width="1.1" fill="none" stroke-linecap="round"/>`,
  },
  steam: {
    name: 'Steam',
    draw: () =>
      [
        [8, 30, -20],
        [112, 30, 20],
      ]
        .map(
          ([x, y, r]) =>
            `<g transform="translate(${x} ${y}) rotate(${r})" ${RAISED}>` +
            `<circle cx="0" cy="0" r="7" fill="#f4f6fa"/><circle cx="-6" cy="-7" r="5.5" fill="#f4f6fa"/><circle cx="4" cy="-11" r="6" fill="#f4f6fa"/><circle cx="-1" cy="-19" r="4.5" fill="#f4f6fa"/>` +
            `</g>`,
        )
        .join(''),
  },
  zzz: {
    name: 'Zzz',
    draw: () =>
      `<g ${RAISED} font-family="Arial Black, Arial, sans-serif" font-weight="900" fill="#8fd0ff" stroke="#1f6fbf" stroke-width="1">` +
      `<text x="92" y="30" font-size="16">Z</text><text x="104" y="16" font-size="12">z</text><text x="113" y="6" font-size="9">z</text></g>`,
  },
  question: {
    name: 'Question',
    draw: () =>
      `<text x="96" y="30" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="30" fill="url(#gold)" stroke="#b87900" stroke-width="1.2" ${RAISED}>?</text>`,
  },
  exclaim: {
    name: 'Exclaim',
    draw: () =>
      `<text x="98" y="30" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="30" fill="url(#heart)" stroke="#9c0f2e" stroke-width="1.2" ${RAISED}>!</text>`,
  },
  crown: {
    name: 'Crown',
    draw: () =>
      `<g ${RAISED}>` +
      `<path d="M36 18 L40 -4 L50 10 L60 -8 L70 10 L80 -4 L84 18 Q60 24 36 18 Z" fill="url(#gold)" stroke="#a86b00" stroke-width="1.2" stroke-linejoin="round"/>` +
      `<circle cx="40" cy="-4" r="2.6" fill="url(#gold)" stroke="#a86b00" stroke-width="0.8"/><circle cx="60" cy="-8" r="2.8" fill="url(#gold)" stroke="#a86b00" stroke-width="0.8"/><circle cx="80" cy="-4" r="2.6" fill="url(#gold)" stroke="#a86b00" stroke-width="0.8"/>` +
      `<circle cx="60" cy="11" r="3.2" fill="#e8264a"/><circle cx="47" cy="13" r="2.4" fill="#2a7de1"/><circle cx="73" cy="13" r="2.4" fill="#2a7de1"/>` +
      `</g>`,
  },
  partyHat: {
    name: 'Party hat',
    draw: () =>
      `<g ${RAISED} transform="translate(0 10) rotate(14 60 10)">` +
      `<path d="M46 16 L60 -22 L74 16 Q60 21 46 16 Z" fill="#ff5fa2" stroke="#b5246a" stroke-width="1.2" stroke-linejoin="round"/>` +
      `<path d="M52 0 L66 -3 M49 9 L70 6" stroke="#ffe066" stroke-width="3" stroke-linecap="round"/>` +
      `<circle cx="60" cy="-22" r="4.5" fill="#ffe066" stroke="#b87900" stroke-width="1"/>` +
      `</g>`,
  },
  rose: {
    name: 'Rose',
    draw: () =>
      `<g ${RAISED}>` +
      `<path d="M36 90 L98 70" stroke="#2f8a2f" stroke-width="3.6" stroke-linecap="round"/>` +
      `<path d="M58 84 Q60 72 72 72 Q66 82 58 84 Z M74 78 Q82 88 92 86 Q84 76 74 78 Z" fill="#43a843" stroke="#1f6a1f" stroke-width="0.8"/>` +
      `</g>` +
      rose(102, 66, 12),
  },
  mustache: {
    name: 'Mustache',
    draw: () =>
      `<path d="M60 74 C54 68 42 68 36 76 C40 74 44 76 46 79 C50 80 56 79 60 76 C64 79 70 80 74 79 C76 76 80 74 84 76 C78 68 66 68 60 74 Z" fill="#3a2414" stroke="#1a0e06" stroke-width="1" ${RAISED}/>`,
  },
  glasses: {
    name: 'Glasses',
    draw: () =>
      `<g ${RAISED} fill="none" stroke="#1d1f26" stroke-width="3">` +
      `<circle cx="43" cy="52" r="15"/><circle cx="77" cy="52" r="15"/><path d="M58 50 Q60 46 62 50 M28 50 L16 46 M92 50 L104 46"/></g>` +
      `<path d="M34 46 L40 42 M68 46 L74 42" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" opacity="0.7"/>`,
  },
  monocle: {
    name: 'Monocle',
    draw: () =>
      `<g ${RAISED}><circle cx="77" cy="52" r="15" fill="#d8ecff" fill-opacity="0.25" stroke="url(#gold)" stroke-width="3.4"/></g>` +
      `<path d="M90 60 Q96 80 88 100" fill="none" stroke="#c99a12" stroke-width="1.4" stroke-dasharray="2 2"/>` +
      `<path d="M70 45 L75 42" stroke="#ffffff" stroke-width="2" stroke-linecap="round" opacity="0.8"/>`,
  },
  bandage: {
    name: 'Bandage',
    draw: () =>
      `<g ${RAISED} transform="translate(82 24)">` +
      [45, -45]
        .map(
          (a) =>
            `<g transform="rotate(${a})"><rect x="-16" y="-5" width="32" height="10" rx="4" fill="#f2c9a0" stroke="#b8865a" stroke-width="1"/>` +
            `<rect x="-5" y="-4" width="10" height="8" fill="#e8b88a"/></g>`,
        )
        .join('') +
      `</g>`,
  },
  headphones: {
    name: 'Headphones',
    draw: () =>
      `<g ${RAISED}>` +
      `<path d="M14 62 C10 18 110 18 106 62" fill="none" stroke="#2b2f38" stroke-width="7" stroke-linecap="round"/>` +
      `<rect x="2" y="50" width="18" height="30" rx="8" fill="#e8344a" stroke="#7a0a18" stroke-width="1.2"/>` +
      `<rect x="100" y="50" width="18" height="30" rx="8" fill="#e8344a" stroke="#7a0a18" stroke-width="1.2"/>` +
      `</g>`,
  },
  floatHearts: {
    name: 'Hearts',
    draw: () => heart(100, 22, 7) + heart(112, 6, 5) + heart(16, 16, 5.5),
  },
  notes: {
    name: 'Music',
    draw: () =>
      `<g ${RAISED} fill="#2b2f38" stroke="#2b2f38">` +
      `<ellipse cx="96" cy="30" rx="5" ry="4" transform="rotate(-20 96 30)"/><path d="M100 29 V10 L112 6 V24" fill="none" stroke-width="2.4"/>` +
      `<ellipse cx="108" cy="25" rx="5" ry="4" transform="rotate(-20 108 25)"/>` +
      `<ellipse cx="14" cy="22" rx="4.5" ry="3.6" transform="rotate(-20 14 22)"/><path d="M18 21 V6" fill="none" stroke-width="2.2"/><path d="M18 6 Q24 8 22 14" fill="none" stroke-width="2"/>` +
      `</g>`,
  },
  bulb: {
    name: 'Idea',
    draw: () =>
      `<g transform="translate(60 7) scale(0.68) translate(-60 0)">` +
      `<g ${RAISED}>` +
      `<path d="M60 -26 C72 -26 78 -16 74 -6 C72 -1 68 2 67 7 H53 C52 2 48 -1 46 -6 C42 -16 48 -26 60 -26 Z" fill="#ffe46b" stroke="#b88a00" stroke-width="1.2"/>` +
      `<rect x="53" y="7" width="14" height="7" rx="2" fill="#b9c0c9" stroke="#6f7787" stroke-width="1"/>` +
      `<path d="M56 0 Q60 -10 64 0" fill="none" stroke="#c98a00" stroke-width="1.4"/>` +
      `</g>` +
      `<path d="M38 -18 L32 -22 M82 -18 L88 -22 M60 -34 V-40 M44 -30 L40 -35 M76 -30 L80 -35" stroke="#ffcf2e" stroke-width="2.4" stroke-linecap="round"/>` +
      `</g>`,
  },
  helmet: {
    name: 'Helmet',
    draw: (c: Ctx) => {
      c.defs.push(`<clipPath id="helmetShell"><path d="M5 45 A55 55 0 0 1 115 45 Q60 53 5 45 Z"/></clipPath>`)
      return (
        // Chin straps, hugging the cheeks, under the shell.
        `<path d="M16 50 C15 74 28 96 48 104 M104 50 C105 74 92 96 72 104" fill="none" stroke="#4a5530" stroke-width="1.7" stroke-linecap="round" opacity="0.85"/>` +
        `<g ${RAISED}>` +
        `<path d="M5 45 A55 55 0 0 1 115 45 Q60 53 5 45 Z" fill="url(#olive)" stroke="#2c3519" stroke-width="1"/>` +
        `<g clip-path="url(#helmetShell)" opacity="0.5">` +
        [[26, 16, 9, 5, -20], [52, 4, 11, 5, 10], [80, 14, 10, 6, 25], [38, 32, 8, 4, 0], [94, 34, 7, 4, -15], [66, 28, 9, 4, 5]]
          .map(([x, y, rx, ry, a]) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="#3d4a24" transform="rotate(${a} ${x} ${y})"/>`)
          .join('') +
        `</g>` +
        `<path d="M1 44 Q60 55 119 44 Q120 49 118 51 Q60 62 2 51 Q0 49 1 44 Z" fill="#56652f" stroke="#2c3519" stroke-width="1"/>` +
        `</g>` +
        `<ellipse cx="38" cy="10" rx="17" ry="7" fill="#ffffff" opacity="0.22" transform="rotate(-24 38 10)"/>`
      )
    },
  },
  catEars: {
    name: 'Cat ears',
    draw: (c: Ctx) =>
      // Whiskers growing out of the muzzle, either side of the nose, fanning out past the cheeks.
      [-1, 1]
        .map(
          (d) =>
            `<path d="M${60 + d * 13} 71 Q${60 + d * 34} 66 ${60 + d * 56} 62 M${60 + d * 13} 74 Q${60 + d * 34} 73 ${60 + d * 58} 74 M${60 + d * 13} 77 Q${60 + d * 34} 80 ${60 + d * 55} 86" ` +
            `fill="none" stroke="${c.line}" stroke-width="1.1" stroke-linecap="round"/>`,
        )
        .join(''),
  },
  partyBlower: {
    name: 'Party blower',
    draw: () =>
      `<g ${RAISED}>` +
      `<path d="M62 79 L96 70 L98 76 L64 83 Z" fill="url(#candy)" stroke="#6b2a7a" stroke-width="0.8"/>` +
      `<circle cx="103" cy="70" r="8" fill="none" stroke="#e05fc0" stroke-width="3.4"/><circle cx="103" cy="70" r="4" fill="none" stroke="#5fd0e0" stroke-width="2.4"/>` +
      `</g>`,
  },
  confetti: {
    name: 'Confetti',
    draw: () =>
      [
        [6, 20, '#a855f7'], [18, 4, '#f59e0b'], [100, 6, '#ec4899'], [112, 26, '#22c55e'], [4, 70, '#3b82f6'],
        [114, 90, '#ef4444'], [16, 108, '#ec4899'], [104, 112, '#a855f7'], [56, -6, '#06b6d4'], [84, -2, '#fb923c'],
      ]
        .map(([x, y, color], i) => `<rect x="${x}" y="${y}" width="5" height="3.2" rx="0.8" fill="${color}" transform="rotate(${i * 37} ${x} ${y})"/>`)
        .join(''),
  },
  goatee: {
    name: 'Goatee',
    draw: () =>
      `<path d="M48 90 Q60 102 72 90 Q70 106 60 108 Q50 106 48 90 Z" fill="#1d2433" opacity="0.55"/>` +
      `<path d="M50 74 Q60 70 70 74" fill="none" stroke="#1d2433" stroke-width="1.6" opacity="0.5"/>`,
  },
  aviators: {
    name: 'Aviators',
    draw: () =>
      `<g ${RAISED}>` +
      `<path d="M24 44 Q40 40 55 45 Q56 62 42 66 Q26 64 24 44 Z M96 44 Q80 40 65 45 Q64 62 78 66 Q94 64 96 44 Z" fill="url(#lens)" stroke="#c9a227" stroke-width="1.6"/>` +
      `<path d="M55 46 Q60 43 65 46 M24 44 L14 42 M96 44 L106 42" fill="none" stroke="#c9a227" stroke-width="1.8"/>` +
      `</g>` +
      `<path d="M30 48 L36 46 L28 58 Z M70 48 L76 46 L68 58 Z" fill="#ffffff" opacity="0.4"/>`,
  },
  nerdGlasses: {
    name: 'Nerd glasses',
    draw: () =>
      `<g ${RAISED} fill="none" stroke="#14161c" stroke-width="4.2">` +
      `<circle cx="43" cy="52" r="16.5"/><circle cx="77" cy="52" r="16.5"/><path d="M59.5 50 Q60 47 60.5 50 M26.5 50 L14 46 M93.5 50 L106 46"/></g>`,
  },
  waterfall: {
    name: 'Waterfall tears',
    draw: () =>
      [-1, 1]
        .map((d) => {
          const x = 60 + d * 18
          return (
            `<path d="M${x} 46 C${x + d * 22} 30 ${x + d * 44} 40 ${x + d * 52} 70" fill="none" stroke="url(#water)" stroke-width="7" stroke-linecap="round" opacity="0.85"/>` +
            [0, 1, 2, 3, 4].map((k) => `<circle cx="${x + d * (40 + k * 4)}" cy="${48 + k * 9}" r="${1.4 + (k % 2)}" fill="#9fdcff"/>`).join('')
          )
        })
        .join(''),
  },
  foreheadSweat: {
    name: 'Forehead sweat',
    draw: () =>
      [
        [44, 22], [56, 18], [70, 21], [82, 27], [36, 30], [64, 28],
      ]
        .map(([x, y]) => `<path d="M${x} ${y - 3} Q${x - 2.2} ${y + 1} ${x} ${y + 2.4} Q${x + 2.2} ${y + 1} ${x} ${y - 3} Z" fill="#bfe8ff" stroke="#5aaee6" stroke-width="0.5"/>`)
        .join(''),
  },
  fadeAway: {
    name: 'Fading away',
    draw: () =>
      `<rect x="6" y="56" width="108" height="60" fill="url(#fade)"/>` +
      [[24, 96], [36, 106], [52, 110], [70, 108], [86, 102], [98, 92], [44, 118], [78, 118], [60, 122]]
        .map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${1 + (i % 3) * 0.6}" fill="#c8d6ea"/>`)
        .join(''),
  },
  motion: {
    name: 'Motion lines',
    draw: () => `<path d="M-4 66 Q-12 80 -6 96 M-12 62 Q-22 80 -14 100" fill="none" stroke="#c9d2df" stroke-width="2" stroke-linecap="round"/>`,
  },
  bigBlush: {
    name: 'Big blush',
    draw: () =>
      [26, 94].map((x) => `<circle cx="${x}" cy="70" r="13" fill="url(#rosy)" ${RAISED}/><ellipse cx="${x - 4}" cy="64.5" rx="4.6" ry="3" fill="#ffffff" opacity="0.55"/>`).join(''),
  },
  seasick: {
    name: 'Green cheeks',
    draw: () =>
      [24, 96].map((x) => `<circle cx="${x}" cy="74" r="15" fill="url(#sick)" ${RAISED}/><ellipse cx="${x - 5}" cy="67.5" rx="5" ry="3.2" fill="#ffffff" opacity="0.45"/>`).join(''),
  },
  strain: { name: 'Strain lines', draw: (c: Ctx) => ridge(c, 'M29 68 Q32 84 40 98', 1.6) + ridge(c, 'M91 68 Q88 84 80 98', 1.6) },
  hotSweat: {
    name: 'Sweating all over',
    draw: () =>
      [
        [30, 28], [42, 19], [60, 15], [76, 18], [90, 26], [100, 40], [20, 46], [104, 58], [16, 66], [100, 76], [26, 88], [92, 92], [44, 104], [76, 104],
      ]
        .map(([x, y], i) => {
          const r = 1.2 + (i % 3) * 0.4
          return `<path d="M${x} ${y - r * 2} Q${x - r} ${y} ${x} ${y + r} Q${x + r} ${y} ${x} ${y - r * 2} Z" fill="#d9f1ff" stroke="#6bb8ea" stroke-width="0.4"/>`
        })
        .join(''),
  },
  plaster: {
    name: 'Plaster',
    draw: () =>
      `<g ${RAISED} transform="rotate(-52 30 84)"><rect x="19" y="79.5" width="22" height="9" rx="4.5" fill="#f3bf96" stroke="#cf9468" stroke-width="0.7"/>` +
      `<rect x="26.5" y="80.5" width="7" height="7" rx="1" fill="#e9a97c"/></g>`,
  },
  thumbsUp: { name: 'Thumbs up', draw: () => hand('thumbUp', 20, 112, 54) },
  thumbsDown: { name: 'Thumbs down', draw: () => hand('thumbUp', 20, 106, 52, 180, true) },
  point: { name: 'Pointing', draw: () => hand('pointRight', 104, 110, 52) },
  wave: { name: 'Waving', draw: () => hand('wave', 106, 94, 56) },
  byeLeft: { name: 'Waving goodbye', draw: () => hand('wave', 16, 106, 54, 0, true) },
  fist: { name: 'Fist', draw: () => hand('fistSide', 108, 116, 44) },
  peace: { name: 'Peace', draw: () => hand('peace', 108, 102, 52, 8) },
  shrug: { name: 'Shrug', draw: () => hand('palmUp', 10, 90, 46, -10, true) + hand('palmUp', 110, 90, 46, 10) },
  // The fist on fire: flames bursting up and back round it, over the ball and under the fist.
  firePunch: {
    name: 'Fire punch',
    draw: () => flame(18, 104, 1.15, -44) + flame(12, 116, 0.85, -76) + flame(30, 92, 0.8, -12) + hand('fistFront', 26, 112, 58, -6),
  },
  facepalm: { name: 'Facepalm', draw: () => hand('backLeft', 42, 70, 60, 8) },
  salute: { name: 'Salute', draw: () => hand('raised', 98, 30, 50, -62) },
  think: { name: 'Thinking', draw: () => hand('indexUp', 82, 114, 54, -34) },
  okSign: { name: 'OK sign', draw: () => hand('ok', 22, 110, 52, -6) },
  doubleThumbs: { name: 'Double thumbs up', draw: () => hand('thumbUp', 12, 116, 48) + hand('thumbUp', 108, 116, 48, 0, true) },
  cheer: { name: 'Cheering fists', draw: () => hand('fistFront', 6, 34, 42, -14) + hand('fistFront', 114, 34, 42, 14, true) },
  coverEyes: { name: 'Covering eyes', draw: () => hand('backLeft', 36, 58, 50, 6) + hand('backRight', 84, 58, 50, -6) },
  coverMouth: { name: 'Hand on mouth', draw: () => hand('backRight', 74, 92, 46, -10) },
  bothMouth: { name: 'Hands on mouth', draw: () => hand('backLeft', 46, 96, 40, 4) + hand('backRight', 74, 96, 40, -4) },
  pray: { name: 'Praying hands', draw: () => hand('pray', 60, 116, 56) },
  shyHands: { name: 'Shy fingers', draw: () => hand('pointRight', 40, 116, 38, 8) + hand('pointRight', 80, 116, 38, -8, true) },
  palmsUp: { name: 'Palms up', draw: () => hand('palmUp', 12, 108, 46, -6, true) + hand('palmUp', 108, 108, 46, 6) },
  holdHeart: { name: 'Holding a heart', draw: () => hand('heldHeart', 60, 108, 62) },
  offerRose: {
    name: 'Offering a rose',
    draw: () =>
      hand('cupped', 60, 118, 70) +
      `<g ${RAISED}><path d="M46 104 Q54 92 62 100 Q56 108 46 104 Z M72 98 Q82 92 86 100 Q78 104 72 98 Z" fill="#43a843" stroke="#1f6a1f" stroke-width="0.8"/></g>` +
      rose(60, 96, 13),
  },
  pointLaugh: { name: 'Pointing and wiping', draw: () => hand('atYou', 26, 112, 54) + hand('backRight', 102, 72, 36, -16) },
  mewing: { name: 'Finger at chin', draw: () => hand('indexUp', 92, 118, 50, -14) },
  cookie: {
    name: 'Cookie',
    // The fingers pinch the cookie up to the mouth, the cookie in front of them.
    draw: () =>
      hand('pinch', 98, 110, 46, 0, true) +
      `<circle cx="80" cy="92" r="12" fill="url(#cookie)" stroke="#151515" stroke-width="1.6"/>` +
      [[76, 88], [83, 94], [78, 98], [85, 87]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.6" fill="#4a2a10"/>`).join(''),
  },
  bat: {
    name: 'Baseball bat',
    draw: () =>
      `<g ${RAISED}><path d="M4 2 C10 -4 18 0 18 6 L30 112 C30 116 24 117 22 113 Z" fill="url(#wood)" stroke="#6b3d14" stroke-width="1"/>` +
      `<ellipse cx="26" cy="116" rx="6" ry="3" fill="#8a5220" stroke="#6b3d14" stroke-width="1"/></g>` +
      hand('fistSide', 24, 114, 42, 0, true),
  },
  bawlFists: { name: 'Fists down', draw: () => hand('fistFront', 10, 126, 40, -8) + hand('fistFront', 110, 126, 40, 8, true) },
  adjustShades: { name: 'Hand on shades', draw: () => hand('pinch', 112, 60, 40) },
  yawnHand: { name: 'Hand to a yawn', draw: () => hand('backRight', 80, 96, 42, -12) },
  cheekHands: { name: 'Hands to cheeks', draw: () => hand('backLeft', 14, 92, 46, 14) + hand('backRight', 106, 92, 46, -14) },
  rubFingers: { name: 'Rubbing fingers', draw: () => hand('snap', 22, 112, 50) },
  pullMouth: { name: 'Pulling the mouth', draw: () => hand('pointRight', 8, 96, 40, 10) + hand('pointRight', 112, 96, 40, -10, true) },
  handsOnHead: { name: 'Hands on head', draw: () => hand('backLeft', 20, 24, 46, -40) + hand('backRight', 100, 24, 46, 40) },
  shush: { name: 'Finger to lips', draw: () => hand('indexUp', 64, 104, 54) },
  hug: { name: 'Open arms', draw: () => hand('spread', 6, 90, 48, -18) + hand('spread', 114, 90, 48, 18, true) },
  waveLeft: { name: 'Waving, left', draw: () => hand('wave', 18, 38, 46, 0, true) },
  // The rest of the author's gestures, each on its own.
  indexUp: { name: 'Index up', draw: () => hand('indexUp', 108, 106, 50) },
  atYou: { name: 'Pointing at you', draw: () => hand('atYou', 60, 114, 60) },
  writing: { name: 'Writing', draw: () => hand('write', 100, 116, 56) },
  clasped: { name: 'Clasped hands', draw: () => hand('clasped', 60, 116, 56) },
  cupped: { name: 'Cupped hands', draw: () => hand('cupped', 60, 120, 70) },
  raisedHand: { name: 'Raised hand', draw: () => hand('raised', 108, 96, 52) },
  spreadHand: { name: 'Spread hand', draw: () => hand('spread', 108, 100, 52) },
  palmUp: { name: 'Palm up', draw: () => hand('palmUp', 106, 112, 50) },
  callMe: { name: 'Call me', draw: () => hand('callMe', 106, 104, 54) },
  rockOn: { name: 'Rock on', draw: () => hand('rock', 108, 100, 54) },
  loveYou: { name: 'Love you', draw: () => hand('loveYou', 106, 102, 56) },
  pointDown: { name: 'Pointing down', draw: () => hand('pointDown', 108, 110, 50) },
  claw: { name: 'Claw', draw: () => hand('claw', 104, 108, 56) },
  crossedArms: { name: 'Crossed arms', draw: () => hand('crossed', 60, 114, 64) },
  heartHands: { name: 'Heart hands', draw: () => hand('heartHands', 60, 116, 70) },
  fistBump: { name: 'Fist bump', draw: () => hand('fistBump', 60, 120, 76) },
  clap: { name: 'Clapping', draw: () => hand('clap', 104, 108, 56) },
  pinch: { name: 'Pinch', draw: () => hand('pinch', 106, 108, 48) },
  snap: { name: 'Finger heart', draw: () => hand('snap', 106, 106, 50) },
} as const satisfies Record<string, { name: string; draw: (c: Ctx) => string }>

/** The extras that are hands, listed apart from the rest in the panel. */
export const HAND_EXTRAS: ExtraId[] = [
  'thumbsUp', 'thumbsDown', 'doubleThumbs', 'point', 'pointLaugh', 'wave', 'fist', 'cheer', 'bawlFists', 'peace', 'okSign', 'shrug', 'palmsUp',
  'firePunch', 'facepalm', 'salute', 'think', 'mewing', 'coverEyes', 'coverMouth', 'bothMouth', 'pray', 'shyHands', 'holdHeart', 'offerRose',
  'cookie', 'bat', 'adjustShades', 'byeLeft', 'yawnHand', 'cheekHands', 'rubFingers', 'pullMouth', 'handsOnHead', 'shush', 'hug', 'waveLeft',
  'indexUp', 'atYou', 'writing', 'clasped', 'cupped', 'raisedHand', 'spreadHand', 'palmUp', 'callMe', 'rockOn', 'loveYou', 'pointDown', 'claw',
  'crossedArms', 'heartHands', 'fistBump', 'clap', 'pinch', 'snap',
]

export type EyeId = keyof typeof EYES
export type BrowId = keyof typeof BROWS
export type MouthId = keyof typeof MOUTHS
export type ExtraId = keyof typeof EXTRAS

export const DEFAULT_FACE: FaceOptions = {
  color: FACE_COLORS[1].color,
  eyes: 'smug',
  brows: 'suspicious',
  mouth: 'smirk',
  extras: [],
  outline: false,
}

/** Drawn behind the head rather than over it. */
const BEHIND: ExtraId[] = ['halo']

/** A flame: a teardrop licking up and back, in three nested colours. */
/**
 * One of the author's hands (`handArt.ts`) centred on (`x`, `y`), `size` across its longer side,
 * turned `rotate` degrees and, with `flip`, mirrored — a left hand made right.
 */
function hand(id: HandId, x: number, y: number, size: number, rotate = 0, flip = false): string {
  const art = HAND_ART[id]
  const scale = size / Math.max(art.w, art.h)
  const w = art.w * scale
  const h = art.h * scale
  return (
    `<g transform="translate(${x} ${y}) rotate(${rotate})${flip ? ' scale(-1 1)' : ''}">` +
    `<image href="${art.src}" x="${(-w / 2).toFixed(2)}" y="${(-h / 2).toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}"/></g>`
  )
}

function flame(x: number, y: number, size: number, angle: number): string {
  const layer = (scale: number, color: string) =>
    `<path transform="scale(${scale})" d="M0 0 C-9 -2 -12 -12 -6 -22 C-4 -16 -1 -15 0 -18 C1 -26 6 -32 12 -36 C9 -26 14 -20 13 -10 C12 -3 7 1 0 0 Z" fill="${color}"/>`
  return (
    `<g transform="translate(${x} ${y}) rotate(${angle}) scale(${size})">` +
    layer(1, '#ff3b1f') +
    `<g transform="translate(1 -2)">${layer(0.72, '#ff8a1f')}</g>` +
    `<g transform="translate(2 -3)">${layer(0.42, '#ffe066')}</g>` +
    `</g>`
  )
}

/** Parts of an extra that are drawn behind the head, while the extra itself is drawn over it. */
const BEHIND_PARTS: Partial<Record<ExtraId, (c: Ctx) => string>> = {
  // Rounded cat ears, their bases tucked behind the head.
  catEars: (c) =>
    [1, -1]
      .map((d) => {
        const x = (v: number) => 60 + d * (v - 60)
        return (
          `<path d="M${x(16)} 34 C${x(12)} 16 ${x(14)} 0 ${x(22)} -4 C${x(30)} -3 ${x(42)} 6 ${x(50)} 14 Z" fill="${c.skin}" stroke="${c.line}" stroke-width="0.9" stroke-linejoin="round" ${RAISED}/>` +
          `<path d="M${x(21)} 26 C${x(19)} 15 ${x(20)} 6 ${x(24)} 3 C${x(30)} 5 ${x(37)} 10 ${x(42)} 15 Z" fill="#ff9dbd" opacity="0.75"/>`
        )
      })
      .join(''),
  // Flames streaming back from the punch, behind the head and round the fist.
}

/**
 * Every face's frame: the same square for every face, so every head is the same size — on the
 * map and in the gallery — whatever is held beside it. The head (radius 50) sits in the middle with
 * 30 units round it, about the room a cartoon sticker sheet gives its hands and hats; every extra
 * is drawn to fit inside (in the head's coordinates, x and y from −20 to 140).
 */
const FRAME = '-10 -12 160 160'

/**
 * The width ÷ height of a flag's artwork. A flag that is an SVG keeps its own proportions whatever
 * the `<image>` asks — the referenced file's own `preserveAspectRatio` wins — so it is read from
 * the file: its `viewBox`, else its `width` and `height`. 3:2 when it cannot be read.
 */
function flagAspect(href: string): number {
  const comma = href.indexOf(',')
  if (!href.startsWith('data:image/svg') || comma < 0) return 1.5
  let text = href.slice(comma + 1)
  try {
    text = href.slice(0, comma).includes(';base64') ? atob(text) : decodeURIComponent(text)
  } catch {
    return 1.5
  }
  const root = /<svg[^>]*>/i.exec(text)?.[0] ?? ''
  const box = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(root)
  if (box) return Number(box[1]) / Number(box[2]) || 1.5
  const w = /\swidth\s*=\s*["']([\d.]+)/i.exec(root)
  const h = /\sheight\s*=\s*["']([\d.]+)/i.exec(root)
  return w && h ? Number(w[1]) / Number(h[1]) || 1.5 : 1.5
}

/**
 * A flag laid over the whole ball, edge to edge: drawn at its own proportions, just large enough
 * to cover the ball's square, and centred — so no band of the ball is ever left bare, whatever
 * shape the flag is. (Clipped to the ball by the caller.)
 */
function flagCover(href: string): string {
  const ratio = flagAspect(href)
  const width = ratio >= 1 ? 100 * ratio : 100
  const height = ratio >= 1 ? 100 : 100 / ratio
  // White under it, for a flag that is not a rectangle (Nepal's) or has clear parts.
  return `<rect x="10" y="10" width="100" height="100" fill="#ffffff"/><image href="${href}" x="${(60 - width / 2).toFixed(2)}" y="${(60 - height / 2).toFixed(2)}" width="${width.toFixed(2)}" height="${height.toFixed(2)}" preserveAspectRatio="none"/>`
}

/** The face as standalone SVG markup. */
export function faceSvg(options: FaceOptions): string {
  const flag = options.color === 'flag'
  // A flag ball's own colour, for the few parts drawn in it (cat ears, a nose, lips): a neutral.
  const base = flag ? '#d9d4cc' : options.color
  const [, , lightness] = hexToHsl(base)
  const dark = !flag && lightness < 0.25
  const ink = '#151515'
  const c: Ctx = {
    skin: shade(base, 0.03),
    skinLight: shade(base, 0.16, 0.95),
    brow: dark ? '#ececec' : ink,
    line: dark ? '#ececec' : ink,
    ink,
    defs: [],
    cheeks: [],
  }
  const eyes = (EYES[options.eyes] ?? EYES.round).draw(c)
  const brows = (BROWS[options.brows] ?? BROWS.none).draw(c)
  const mouth = (MOUTHS[options.mouth] ?? MOUTHS.smile).draw(c)
  const extras = options.extras.filter((id) => id in EXTRAS)
  const behind =
    extras.map((id) => BEHIND_PARTS[id]?.(c) ?? '').join('') +
    extras.filter((id) => BEHIND.includes(id)).map((id) => EXTRAS[id].draw(c)).join('')
  const over = extras.filter((id) => !BEHIND.includes(id)).map((id) => EXTRAS[id].draw(c)).join('')

  /*
   * The ball's fill: its colour, or a flag laid over the whole ball and clipped to it — the
   * country's own when given, else white over red, the first countryball.
   */
  const fill = !flag
    ? `<circle cx="60" cy="60" r="50" fill="${base}"/>`
    : `<g clip-path="url(#head)">` +
      (options.flagHref
        ? flagCover(options.flagHref)
        : `<rect x="10" y="10" width="100" height="50" fill="#ffffff"/><rect x="10" y="60" width="100" height="50" fill="#dc143c"/>`) +
      `</g>`

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${FRAME}">` +
    `<defs>` +
    // The ball's light: a faint glow at the top left, a faint shade at the bottom right.
    `<radialGradient id="ballLight" cx="0.36" cy="0.3" r="0.78">` +
    `<stop offset="0" stop-color="#ffffff" stop-opacity="0.28"/>` +
    `<stop offset="0.45" stop-color="#ffffff" stop-opacity="0"/>` +
    `<stop offset="0.8" stop-color="#000000" stop-opacity="0.04"/>` +
    `<stop offset="1" stop-color="#000000" stop-opacity="0.2"/>` +
    `</radialGradient>` +
    // Parts.
    `<linearGradient id="brow" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.brow}"/><stop offset="1" stop-color="${c.brow}"/></linearGradient>` +
    `<linearGradient id="lid" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.skin}"/><stop offset="1" stop-color="${c.skin}"/></linearGradient>` +
    `<radialGradient id="sclera" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#ffffff"/></radialGradient>` +
    `<radialGradient id="iris" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#0c0c0c"/><stop offset="1" stop-color="#0c0c0c"/></radialGradient>` +
    // Inside an open mouth: a deep red, darker at the top, as a countryball's is.
    `<linearGradient id="mouth" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a0c12"/><stop offset="1" stop-color="#6b1a24"/></linearGradient>` +
    `<linearGradient id="teeth" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#eef1f5"/></linearGradient>` +
    `<radialGradient id="tongue" cx="0.45" cy="0.35" r="0.7"><stop offset="0" stop-color="#ff8aa6"/><stop offset="1" stop-color="#e2557a"/></radialGradient>` +
    `<linearGradient id="gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff3a6"/><stop offset="0.5" stop-color="#ffd23f"/><stop offset="1" stop-color="#e59a00"/></linearGradient>` +
    `<linearGradient id="lips" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${flag ? '#e8838f' : shade(base, 0.08, 0.95)}"/><stop offset="1" stop-color="${flag ? '#c9566a' : shade(base, -0.08, 1.05)}"/></linearGradient>` +
    `<linearGradient id="redLip" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff5a6e"/><stop offset="1" stop-color="#b3122a"/></linearGradient>` +
    `<linearGradient id="olive" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8a9a5b"/><stop offset="0.6" stop-color="#5d6b35"/><stop offset="1" stop-color="#3c4722"/></linearGradient>` +
    `<linearGradient id="wood" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#c98a4b"/><stop offset="0.5" stop-color="#e7b277"/><stop offset="1" stop-color="#a86b30"/></linearGradient>` +
    `<radialGradient id="cookie" cx="0.4" cy="0.35" r="0.7"><stop offset="0" stop-color="#f2c27a"/><stop offset="1" stop-color="#c58a3a"/></radialGradient>` +
    `<linearGradient id="candy" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#a855f7"/><stop offset="0.33" stop-color="#ec4899"/><stop offset="0.66" stop-color="#22d3ee"/><stop offset="1" stop-color="#a855f7"/></linearGradient>` +
    `<linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0"/><stop offset="1" stop-color="#ffffff" stop-opacity="0.92"/></linearGradient>` +
    `<radialGradient id="rosy" cx="0.4" cy="0.35" r="0.7"><stop offset="0" stop-color="#ffc2d2"/><stop offset="0.6" stop-color="#f08aa6"/><stop offset="1" stop-color="#d4607f"/></radialGradient>` +
    `<radialGradient id="sick" cx="0.4" cy="0.35" r="0.7"><stop offset="0" stop-color="#b9e58a"/><stop offset="0.6" stop-color="#6fb544"/><stop offset="1" stop-color="#3f7f26"/></radialGradient>` +
    `<radialGradient id="bruise" cx="0.5" cy="0.5" r="0.5"><stop offset="0.6" stop-color="#7a3ff0"/><stop offset="0.86" stop-color="#5420c2"/><stop offset="1" stop-color="#9a6bff"/></radialGradient>` +
    `<radialGradient id="roseG" cx="0.4" cy="0.35" r="0.75"><stop offset="0" stop-color="#ff5a70"/><stop offset="0.6" stop-color="#d4152f"/><stop offset="1" stop-color="#8e0c20"/></radialGradient>` +
    `<linearGradient id="cash" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9df27c"/><stop offset="1" stop-color="#1f9a3a"/></linearGradient>` +
    `<linearGradient id="heart" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff6d8a"/><stop offset="1" stop-color="#d4123b"/></linearGradient>` +
    `<linearGradient id="water" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d6f3ff"/><stop offset="1" stop-color="#3fa9f5"/></linearGradient>` +
    `<linearGradient id="lens" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b4250"/><stop offset="0.5" stop-color="#11141a"/><stop offset="1" stop-color="#262b35"/></linearGradient>` +
    // Flat, as countryballs are: what was raised or sunk is drawn as it is, with no lighting.
    `<filter id="bevel"><feMerge><feMergeNode in="SourceGraphic"/></feMerge></filter>` +
    `<filter id="bevelSoft"><feMerge><feMergeNode in="SourceGraphic"/></feMerge></filter>` +
    `<filter id="inset"><feMerge><feMergeNode in="SourceGraphic"/></feMerge></filter>` +
    `<filter id="groove"><feMerge><feMergeNode in="SourceGraphic"/></feMerge></filter>` +
    `<filter id="blur1" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1"/></filter>` +
    `<clipPath id="head"><circle cx="60" cy="60" r="50"/></clipPath>` +
        `<filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.4"/></filter>` +
    `<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3.2"/></filter>` +
    c.defs.join('') +
    `</defs>` +
    `<g transform="translate(10 8)">` +
    behind +
    fill +
    `<circle cx="60" cy="60" r="50" fill="url(#ballLight)"/>` +
    `<circle cx="60" cy="60" r="50" fill="none" stroke="${ink}" stroke-width="${options.outline ? 5 : 2.8}"/>` +
    eyes +
    brows +
    mouth +
    over +
    `</g>` +
    `</svg>`
  )
}

export function faceDataUri(options: FaceOptions): string {
  const svg = faceSvg(options)
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/** A random face, for the dice button. */
export function randomFace(): FaceOptions {
  const pick = <T,>(items: readonly T[]) => items[Math.floor(Math.random() * items.length)]
  // At most one hand, and a few other extras now and then.
  const others = (Object.keys(EXTRAS) as ExtraId[]).filter((id) => !HAND_EXTRAS.includes(id) && Math.random() < 0.1)
  const extras = Math.random() < 0.35 ? [...others, pick(HAND_EXTRAS)] : others
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
