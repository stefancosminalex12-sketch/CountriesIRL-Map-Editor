/**
 * The face maker: a glossy 3D face assembled from parts, in any colour.
 *
 * Original artwork, drawn here as SVG. A face is a colour and one choice from each part list —
 * eyes, brows, mouth — plus any extras, and the same options always draw the same face.
 *
 * **What makes it look rendered rather than flat** is light, applied the same way to every part:
 *
 * - The head is a lit sphere: a radial body gradient lit from the top left, a darker rim, a pale
 *   bounce of light along the bottom edge, a soft specular bloom and a sharp highlight. Every
 *   shade is the face's own colour, darker — never black — so no colour turns muddy at the edge.
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

/**
 * The colour presets: the nine base colours of the recolourable emoji site the gallery follows,
 * sampled exactly from its swatches, plus orange, which the default tiers use between red and
 * yellow.
 */
export const FACE_COLORS: Array<{ name: string; color: string }> = [
  { name: 'Blue', color: '#1b4fd8' },
  { name: 'Purple', color: '#9062f9' },
  { name: 'Yellow', color: '#faca15' },
  { name: 'Red', color: '#b00302' },
  { name: 'Pink', color: '#db8eb6' },
  { name: 'Teal', color: '#1ca6be' },
  { name: 'Green', color: '#82c431' },
  { name: 'White', color: '#f3f4f6' },
  { name: 'Black', color: '#111827' },
  { name: 'Orange', color: '#f57c1f' },
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
  /** Every open eye drawn, so the head can be sculpted round it: a socket, a fold of skin above. */
  eyeballs: Array<{ cx: number; cy: number; rx: number; ry: number; lid: boolean }>
  /** The corners of a smiling mouth, which push the cheeks up. */
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
  c.eyeballs.push({ cx: e.cx, cy: e.cy, rx: e.rx, ry: e.ry, lid: !!e.lid })
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
  eye(c, { ...spec, cx: 43 }, 1, 'l') + eye(c, { ...spec, cx: 77, ...right }, -1, 'r')

/**
 * A line carved into the face: closed eyes, a closed smile. Dark, with the lip of the groove
 * catching the light just below it, which is what makes it read as cut in rather than drawn on.
 */
const ridge = (c: Ctx, d: string, width = 5.6, color?: string) =>
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
function brow(c: Ctx, x1: number, y1: number, qx: number, qy: number, x2: number, y2: number, thick = 9.5): string {
  return `<path d="M${x1} ${y1} Q${qx} ${qy - thick} ${x2} ${y2} Q${qx} ${qy + thick * 0.55} ${x1} ${y1} Z" fill="url(#brow)" stroke="${c.brow}" stroke-width="2.2" stroke-linejoin="round" filter="url(#bevelSoft)"/>`
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
  angry: { name: 'Angry', draw: (c: Ctx) => browPair(c, 30, 30, 43, 33, 57, 42, 11) },
  worried: { name: 'Worried', draw: (c: Ctx) => browPair(c, 31, 38, 42, 30, 55, 26) },
  suspicious: {
    name: 'One up',
    draw: (c: Ctx) => brow(c, 32, 37, 43, 34, 55, 37) + brow(c, 65, 28, 77, 16, 89, 26),
  },
  thick: { name: 'Bushy', draw: (c: Ctx) => browPair(c, 31, 34, 44, 28, 57, 35, 14) },
} as const satisfies Record<string, { name: string; draw: (c: Ctx) => string }>

/** An open mouth: the cavity, sunk into the face, with whatever is inside it clipped to it. */
function cavity(c: Ctx, d: string, inside: string, key: string): string {
  c.defs.push(`<clipPath id="mouth-${key}"><path d="${d}"/></clipPath>`)
  return (
    // The mouth sits in a soft hollow, ringed by a raised lip that catches the light.
    `<path d="${d}" fill="none" stroke="${c.line}" stroke-width="12" stroke-linejoin="round" opacity="0.35" filter="url(#soft)"/>` +
    `<path d="${d}" fill="none" stroke="${c.skinLight}" stroke-width="6.5" stroke-linejoin="round" ${RAISED}/>` +
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
          `<path d="M26 79 Q60 83 94 79" stroke="#7a1b2e" stroke-width="1.6" fill="none"/>`,
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
          `<path d="M26 80.5 H94" stroke="#7a1b2e" stroke-width="1.2"/>`,
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

/* ------------------------------------------------------------------- hands */

/*
 * Cartoon gloves. Each pose is a few smooth shapes — a palm, tapered fingers with round tips, a
 * thumb — filled one flat white and drawn as **one** piece through the `gloveFx` filter, which
 * traces a single clean outline round the whole silhouette, shades its lower right edge, lights its
 * upper left and casts a soft shadow. So a hand reads as one hand, not as a stack of outlined
 * blocks. What the outline cannot show — where one finger lies against the next, a knuckle's fold,
 * the three stitched lines on the back — is drawn inside as soft crease lines. A part that sits in
 * front of the rest (a thumb folded over a fist, the cuff) is its own piece, outlined on its own.
 *
 * Every pose is drawn at the origin with the wrist at (0, 0) and the hand reaching up (−y), about
 * 32 units across, then placed beside the face by its extra.
 */
const GLOVE_FILL = '#f7f9fc'
const SEAM = 'fill="none" stroke="#a3afc2" stroke-width="1.15" stroke-linecap="round"'
const SEAM_SOFT = 'fill="none" stroke="#b8c2d2" stroke-width="0.9" stroke-linecap="round"'

/** One piece of glove, outlined and shaded as a whole. */
const piece = (inner: string) => `<g filter="url(#gloveFx)" fill="${GLOVE_FILL}">${inner}</g>`

/** A finger: tapered from its base to a round tip, `len` long, reaching along `angle` degrees from straight up. */
function finger(x: number, y: number, len: number, width: number, angle: number): string {
  // Cartoon gloves have fat fingers: every finger is drawn a little wider than it is placed.
  const w = width * 1.22
  const tip = w * 0.48
  return (
    `<path transform="translate(${x} ${y}) rotate(${angle})" ` +
    `d="M${-w / 2} 4 L${-tip} ${-len + tip} A${tip} ${tip} 0 0 1 ${tip} ${-len + tip} L${w / 2} 4 Z"/>`
  )
}

/** The fold across a finger's middle knuckle. */
function knuckleCrease(x: number, y: number, len: number, width: number, angle: number, at = 0.55): string {
  const w = width * 1.22
  const yy = -len * at
  return `<path transform="translate(${x} ${y}) rotate(${angle})" d="M${-w * 0.3} ${yy + 1} Q0 ${yy - 1.2} ${w * 0.3} ${yy + 1}" ${SEAM_SOFT}/>`
}

/** The rolled cuff at the wrist, in front of the hand. */
const cuff = (w = 30) =>
  piece(`<rect x="${-w / 2}" y="-5" width="${w}" height="11" rx="4.5"/>`) +
  `<path d="M${-w / 2 + 2.5} -0.5 Q0 1.5 ${w / 2 - 2.5} -0.5" ${SEAM}/>` +
  `<path d="M${-w / 2 + 4} 3 Q0 4.6 ${w / 2 - 4} 3" ${SEAM_SOFT}/>`

/** The three stitched lines on the back of a glove. */
const stitches = (y: number, spread = 5.2, len = 9) =>
  [-1, 0, 1].map((k) => `<path d="M${k * spread} ${y} q${k * 0.8} ${-len * 0.5} ${k * 0.4} ${-len}" ${SEAM_SOFT}/>`).join('')

/* An open hand, palm out, fingers spread. */
const OPEN_FINGERS: Array<[number, number, number, number, number]> = [
  // x, y, length, width, angle
  [-11.6, -26.5, 18, 8, -18],
  [-4, -29, 22, 8.4, -6],
  [4, -29, 21, 8.4, 6],
  [11.4, -26, 15.5, 7.4, 19],
]
/** Where neighbouring fingers lie against each other, between their bases: x, y, angle. */
const OPEN_SEAMS: Array<[number, number, number]> = [
  [-7.9, -28.5, -12],
  [0, -30, 0],
  [7.8, -28.5, 12.5],
]
const OPEN =
  piece(
    OPEN_FINGERS.map(([x, y, l, w, a]) => finger(x, y, l, w, a)).join('') +
      `<path d="M-15 -4 C-17 -14 -16.5 -26 -13 -31 Q0 -34 13 -31 C16.5 -26 17 -14 15 -4 Z"/>` +
      finger(-14, -12, 16, 9.4, -60),
  ) +
  OPEN_FINGERS.map(([x, y, l, w, a]) => knuckleCrease(x, y, l, w, a)).join('') +
  OPEN_SEAMS.map(([x, y, a]) => `<path transform="translate(${x} ${y}) rotate(${a})" d="M0 1 Q0.6 -6 0 -12" ${SEAM}/>`).join('') +
  `<path d="M-8 -17 Q-1 -13 7 -19" ${SEAM}/>` +
  `<path d="M-6 -11 Q0 -8.5 6 -12" ${SEAM_SOFT}/>` +
  `<path d="M-11.5 -9 Q-8 -14 -9.5 -21" ${SEAM_SOFT}/>` +
  cuff(29)

/*
 * A fist seen from the front: four curled fingers in a row along the top, their tips tucked in
 * along a crease below, and the thumb folded across in front.
 */
const FIST_KNUCKLES = [-11.4, -3.8, 3.8, 11.4]
const fistBody = (skipFirst = false) =>
  piece(
    `<path d="M-16 -4 C-18.5 -14 -18 -24 -15 -28 Q0 -31 15 -28 C18 -24 18.5 -14 16 -4 Z"/>` +
      FIST_KNUCKLES.filter((_, i) => !(skipFirst && i === 0))
        .map((x) => `<rect x="${x - 4.9}" y="-36.5" width="9.8" height="17" rx="4.9"/>`)
        .join(''),
  ) +
  FIST_KNUCKLES.slice(1)
    .map((x) => `<path d="M${x - 3.8} -34 Q${x - 4.4} -28 ${x - 3.8} -21" ${SEAM}/>`)
    .join('') +
  `<path d="M${skipFirst ? -7.6 : -15} -24 Q0 -21.5 15 -24" ${SEAM_SOFT}/>`

const foldedThumb = (y: number) =>
  piece(`<path d="M-18 ${y + 4} C-19 ${y - 1} -15 ${y - 4.5} -9 ${y - 4.5} L4 ${y - 4} C8 ${y - 4} 9 ${y + 4} 4 ${y + 4.5} L-12 ${y + 6} C-15.5 ${y + 6} -17.5 ${y + 5.5} -18 ${y + 4} Z"/>`) +
  `<path d="M-6 ${y - 3.5} Q-5 ${y} -6 ${y + 4.5}" ${SEAM_SOFT}/>`

const FIST = fistBody() + foldedThumb(-14) + stitches(-9, 4.6, 6) + cuff(30)

/* A fist from the side, the thumb up and the curled fingers stacked down its front. */
const THUMB =
  piece(
    `<path d="M-12 -4 C-15 -12 -15 -22 -11 -27 Q0 -30 9 -27 C13 -22 13 -12 12 -4 Z"/>` +
      [-27, -20.5, -14, -7.5].map((y, i) => `<rect x="2" y="${y}" width="${17 - i * 0.8}" height="7.6" rx="3.8"/>`).join('') +
      finger(-4.5, -24, 18, 10.4, -8),
  ) +
  [-20.5, -14, -7.5].map((y) => `<path d="M4 ${y + 0.2} Q11 ${y - 1} ${17.5} ${y + 0.6}" ${SEAM}/>`).join('') +
  knuckleCrease(-4.5, -24, 18, 10.4, -8, 0.5) +
  `<path d="M-1.2 -22 Q1.4 -14 0.5 -6" ${SEAM}/>` +
  stitches(-8, 3.8, 7) +
  cuff(27)

/* A fist with the index finger out. */
const POINT =
  piece(finger(-11.4, -28, 22, 8.2, -5)) +
  knuckleCrease(-11.4, -28, 22, 8.2, -5) +
  fistBody(true) +
  `<path d="M-7.6 -34 Q-8.2 -28 -7.6 -21" ${SEAM}/>` +
  foldedThumb(-14) +
  stitches(-9, 4.6, 6) +
  cuff(30)

/* Two fingers up in a V, the other two curled under the thumb. */
const PEACE =
  piece(
    finger(-6.2, -28, 21, 8.2, -13) +
      finger(2.2, -29, 22, 8.2, 9) +
      `<path d="M-15 -4 C-17.5 -14 -17 -24 -14 -28 Q0 -31 14 -28 C17 -24 17.5 -14 15 -4 Z"/>` +
      `<rect x="5.5" y="-31" width="7.6" height="12" rx="3.8"/><rect x="11" y="-29" width="7" height="10.5" rx="3.5"/>`,
  ) +
  knuckleCrease(-6.2, -28, 21, 8.2, -13) +
  knuckleCrease(2.2, -29, 22, 8.2, 9) +
  `<path d="M-2 -27 Q-1.6 -22 -2.4 -18" ${SEAM}/>` +
  `<path d="M11.2 -29 Q10.6 -25 11.2 -20" ${SEAM}/>` +
  foldedThumb(-13) +
  cuff(29)

const HAND = { open: OPEN, fist: FIST, thumb: THUMB, point: POINT, peace: PEACE } as const

const place = (hand: string, x: number, y: number, rotate: number, scale = 1.5, flip = false) =>
  `<g transform="translate(${x} ${y}) rotate(${rotate}) scale(${flip ? -scale : scale} ${scale})">${hand}</g>`

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
      `<g ${RAISED} transform="rotate(14 60 10)">` +
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
      `<circle cx="102" cy="66" r="12" fill="#d61f36" stroke="#7a0a18" stroke-width="1"/>` +
      `<path d="M94 62 Q102 54 110 62 Q104 66 102 74 Q98 66 94 62 Z" fill="#ff4d63" stroke="#7a0a18" stroke-width="0.8"/>` +
      `<path d="M98 68 Q102 62 106 68 Q102 72 98 68 Z" fill="#a8122a"/>` +
      `</g>`,
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
      `<g ${RAISED}>` +
      `<path d="M60 -26 C72 -26 78 -16 74 -6 C72 -1 68 2 67 7 H53 C52 2 48 -1 46 -6 C42 -16 48 -26 60 -26 Z" fill="#ffe46b" stroke="#b88a00" stroke-width="1.2"/>` +
      `<rect x="53" y="7" width="14" height="7" rx="2" fill="#b9c0c9" stroke="#6f7787" stroke-width="1"/>` +
      `<path d="M56 0 Q60 -10 64 0" fill="none" stroke="#c98a00" stroke-width="1.4"/>` +
      `</g>` +
      `<path d="M38 -18 L32 -22 M82 -18 L88 -22 M60 -34 V-40 M44 -30 L40 -35 M76 -30 L80 -35" stroke="#ffcf2e" stroke-width="2.4" stroke-linecap="round"/>`,
  },
  thumbsUp: { name: 'Thumbs up', draw: () => place(HAND.thumb, 20, 112, -10) },
  thumbsDown: { name: 'Thumbs down', draw: () => place(HAND.thumb, 100, 80, 170, 1.5, true) },
  point: { name: 'Pointing', draw: () => place(HAND.point, 16, 114, -28) },
  wave: { name: 'Waving', draw: () => place(HAND.open, 106, 84, 22) },
  fist: { name: 'Fist', draw: () => place(HAND.fist, 104, 118, 12) },
  peace: { name: 'Peace', draw: () => place(HAND.peace, 106, 88, 16) },
  shrug: {
    name: 'Shrug',
    draw: () => place(HAND.open, 24, 98, -66) + place(HAND.open, 96, 98, 66, 1.5, true),
  },
  // The flames are drawn behind the head — see `BEHIND_PARTS` — so only the fist sits over it.
  firePunch: { name: 'Fire punch', draw: () => place(HAND.fist, 20, 108, -18, 1.75) },
  facepalm: { name: 'Facepalm', draw: () => place(HAND.open, 44, 88, -16, 1.75) },
  salute: { name: 'Salute', draw: () => place(HAND.open, 100, 46, 64, 1.35, true) },
  think: { name: 'Thinking', draw: () => place(HAND.point, 66, 126, -14, 1.35) },
} as const satisfies Record<string, { name: string; draw: (c: Ctx) => string }>

/** The extras that are hands, listed apart from the rest in the panel. */
export const HAND_EXTRAS: ExtraId[] = ['thumbsUp', 'thumbsDown', 'point', 'wave', 'fist', 'peace', 'shrug', 'firePunch', 'facepalm', 'salute', 'think']

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

/** A flame: a teardrop licking up and back, in three nested colours. */
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
const BEHIND_PARTS: Partial<Record<ExtraId, () => string>> = {
  // Flames streaming back from the punch, behind the head and round the fist.
  firePunch: () => flame(6, 114, 2.7, -60) + flame(-4, 96, 2, -78) + flame(18, 124, 1.7, -38),
}

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
    eyeballs: [],
    cheeks: [],
  }
  const eyes = (EYES[options.eyes] ?? EYES.round).draw(c)
  const brows = (BROWS[options.brows] ?? BROWS.none).draw(c)
  const mouth = (MOUTHS[options.mouth] ?? MOUTHS.smile).draw(c)
  /*
   * Sculpting, from what the parts drew: a shadowed socket round every open eye and a fold of
   * skin over the ones with no lid of their own; cheeks bulging up beside a smile. This is the
   * difference between features painted on a ball and a face with relief.
   */
  const shadowTone = dark ? shade(base, -0.06) : shade(base, -0.2, 1.1)
  const sockets = c.eyeballs
    .map(
      (e) =>
        `<ellipse cx="${e.cx}" cy="${e.cy + 1}" rx="${e.rx + 5}" ry="${e.ry + 5}" fill="${shadowTone}" opacity="0.75" filter="url(#soft)"/>` +
        `<ellipse cx="${e.cx}" cy="${e.cy - e.ry - 4}" rx="${e.rx + 3}" ry="4" fill="${c.skinLight}" opacity="0.55" filter="url(#soft)"/>`,
    )
    .join('')
  const folds = c.eyeballs
    .filter((e) => !e.lid)
    .map((e) => {
      const l = e.cx - e.rx - 1.5
      const r = e.cx + e.rx + 1.5
      const top = e.cy - e.ry
      return (
        `<path d="M${l} ${e.cy - e.ry * 0.25} C${l} ${top - 7} ${r} ${top - 7} ${r} ${e.cy - e.ry * 0.25} ` +
        `C${r - 2} ${top - 1} ${l + 2} ${top - 1} ${l} ${e.cy - e.ry * 0.25} Z" fill="url(#lid)" ${RAISED}/>`
      )
    })
    .join('')
  const cheekShapes = c.cheeks
    .map(
      ([x, y]) =>
        `<ellipse cx="${x + (x < 60 ? -7 : 7)}" cy="${y - 7}" rx="12" ry="9" fill="${c.skinLight}" opacity="0.6" filter="url(#soft)"/>` +
        `<path d="M${x + (x < 60 ? -3 : 3)} ${y - 9} Q${x + (x < 60 ? -7 : 7)} ${y - 2} ${x + (x < 60 ? -3 : 3)} ${y + 5}" fill="none" stroke="${shadowTone}" stroke-width="2.4" stroke-linecap="round" opacity="0.7" filter="url(#blur1)"/>`,
    )
    .join('')
  const extras = options.extras.filter((id) => id in EXTRAS)
  const behind =
    extras.map((id) => BEHIND_PARTS[id]?.() ?? '').join('') +
    extras.filter((id) => BEHIND.includes(id)).map((id) => EXTRAS[id].draw(c)).join('')
  const over = extras.filter((id) => !BEHIND.includes(id)).map((id) => EXTRAS[id].draw(c)).join('')

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 140">` +
    `<defs>` +
    // The head.
    `<radialGradient id="body" cx="0.38" cy="0.3" r="0.8">` +
    `<stop offset="0" stop-color="${shade(base, 0.2, 0.95)}"/>` +
    `<stop offset="0.5" stop-color="${base}"/>` +
    `<stop offset="0.85" stop-color="${shade(base, -0.07, 1.04)}"/>` +
    `<stop offset="1" stop-color="${shade(base, -0.13, 1.06)}"/>` +
    `</radialGradient>` +
    `<radialGradient id="rim" cx="0.5" cy="0.5" r="0.5"><stop offset="0.8" stop-color="${shade(base, -0.2, 1.05)}" stop-opacity="0"/><stop offset="1" stop-color="${shade(base, -0.2, 1.05)}" stop-opacity="0.3"/></radialGradient>` +
    `<radialGradient id="bounce" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${shade(base, 0.25)}" stop-opacity="0.7"/><stop offset="1" stop-color="${shade(base, 0.25)}" stop-opacity="0"/></radialGradient>` +
    `<radialGradient id="bloom" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#fff" stop-opacity="0.7"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>` +
    // Parts.
    `<linearGradient id="brow" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${dark ? shade(base, 0.4) : shade(base, -0.18, 1.05)}"/><stop offset="1" stop-color="${c.brow}"/></linearGradient>` +
    `<linearGradient id="lid" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.skinLight}"/><stop offset="1" stop-color="${c.skin}"/></linearGradient>` +
    `<radialGradient id="sclera" cx="0.42" cy="0.38" r="0.68"><stop offset="0.45" stop-color="#ffffff"/><stop offset="0.85" stop-color="#d6dee9"/><stop offset="1" stop-color="#aebbcc"/></radialGradient>` +
    `<radialGradient id="iris" cx="0.4" cy="0.35" r="0.7"><stop offset="0" stop-color="#4a3326"/><stop offset="1" stop-color="#140c08"/></radialGradient>` +
    `<linearGradient id="mouth" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a0611"/><stop offset="1" stop-color="#6b1427"/></linearGradient>` +
    `<linearGradient id="teeth" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#d9e0ea"/></linearGradient>` +
    `<radialGradient id="tongue" cx="0.45" cy="0.35" r="0.7"><stop offset="0" stop-color="#ff8fb0"/><stop offset="1" stop-color="#d94672"/></radialGradient>` +
    `<linearGradient id="gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff3a6"/><stop offset="0.5" stop-color="#ffd23f"/><stop offset="1" stop-color="#e59a00"/></linearGradient>` +
    `<linearGradient id="cash" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9df27c"/><stop offset="1" stop-color="#1f9a3a"/></linearGradient>` +
    `<linearGradient id="heart" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff6d8a"/><stop offset="1" stop-color="#d4123b"/></linearGradient>` +
    `<linearGradient id="water" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d6f3ff"/><stop offset="1" stop-color="#3fa9f5"/></linearGradient>` +
    `<linearGradient id="lens" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b4250"/><stop offset="0.5" stop-color="#11141a"/><stop offset="1" stop-color="#262b35"/></linearGradient>` +
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
    // Raised, but matte: dark features (brows) keep their colour and only catch a little light.
    `<filter id="bevelSoft" x="-30%" y="-30%" width="160%" height="160%">` +
    `<feGaussianBlur in="SourceAlpha" stdDeviation="1.6" result="b"/>` +
    `<feSpecularLighting in="b" surfaceScale="2" specularConstant="0.28" specularExponent="30" lighting-color="#ffffff" result="s">` +
    `<feDistantLight azimuth="225" elevation="48"/></feSpecularLighting>` +
    `<feComposite in="s" in2="SourceAlpha" operator="in" result="si"/>` +
    `<feOffset in="SourceAlpha" dx="0.6" dy="1.6" result="o"/><feGaussianBlur in="o" stdDeviation="1.1" result="ob"/>` +
    `<feFlood flood-color="#000" flood-opacity="0.35"/><feComposite in2="ob" operator="in" result="drop"/>` +
    `<feMerge><feMergeNode in="drop"/><feMergeNode in="SourceGraphic"/><feMergeNode in="si"/></feMerge>` +
    `</filter>` +
    // One glove piece: a single outline round the whole silhouette, its lower right edge shaded,
    // its upper left lit, and a soft shadow beneath.
    `<filter id="gloveFx" x="-25%" y="-25%" width="150%" height="150%">` +
    `<feMorphology in="SourceAlpha" operator="dilate" radius="1.05" result="d"/>` +
    `<feFlood flood-color="#6c7890"/><feComposite in2="d" operator="in" result="outline"/>` +
    `<feOffset in="d" dx="0.8" dy="1.8" result="do"/><feGaussianBlur in="do" stdDeviation="1.3" result="db"/>` +
    `<feFlood flood-color="#000" flood-opacity="0.2"/><feComposite in2="db" operator="in" result="drop"/>` +
    `<feComponentTransfer in="SourceAlpha" result="inv"><feFuncA type="table" tableValues="1 0"/></feComponentTransfer>` +
    `<feOffset in="inv" dx="-2" dy="-2.4" result="io"/><feGaussianBlur in="io" stdDeviation="2" result="ib"/>` +
    `<feFlood flood-color="#8a98b2" flood-opacity="0.8"/><feComposite in2="ib" operator="in" result="sh"/>` +
    `<feComposite in="sh" in2="SourceAlpha" operator="in" result="shade"/>` +
    `<feGaussianBlur in="SourceAlpha" stdDeviation="1.5" result="b"/>` +
    `<feSpecularLighting in="b" surfaceScale="2.2" specularConstant="0.55" specularExponent="22" lighting-color="#ffffff" result="s">` +
    `<feDistantLight azimuth="225" elevation="42"/></feSpecularLighting>` +
    `<feComposite in="s" in2="SourceAlpha" operator="in" result="spec"/>` +
    `<feMerge><feMergeNode in="drop"/><feMergeNode in="outline"/><feMergeNode in="SourceGraphic"/><feMergeNode in="shade"/><feMergeNode in="spec"/></feMerge>` +
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
    `<filter id="blur1" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1"/></filter>` +
    `<clipPath id="rimSide"><path d="M120 30 L120 120 L20 120 Z"/></clipPath>` +
    `<filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.4"/></filter>` +
    `<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3.2"/></filter>` +
    c.defs.join('') +
    `</defs>` +
    `<g transform="translate(10 8)">` +
    behind +
    `<circle cx="60" cy="60" r="50" fill="url(#body)"${options.outline ? ' stroke="#121212" stroke-width="5"' : ''}/>` +
    `<circle cx="60" cy="60" r="50" fill="url(#rim)"/>` +
    `<ellipse cx="60" cy="98" rx="30" ry="9" fill="url(#bounce)"/>` +
    `<ellipse cx="42" cy="27" rx="25" ry="13" fill="url(#bloom)" transform="rotate(-28 42 27)" filter="url(#glow)"/>` +
    `<ellipse cx="36" cy="24" rx="8" ry="4" fill="#ffffff" opacity="0.75" transform="rotate(-32 36 24)"/>` +
    // Rim light: a band of brighter, more saturated colour along the lower right edge.
    `<circle cx="60" cy="60" r="47" fill="none" stroke="${shade(base, 0.2, 1.15)}" stroke-width="4" opacity="0.7" clip-path="url(#rimSide)" filter="url(#blur1)"/>` +
    sockets +
    cheekShapes +
    eyes +
    folds +
    brows +
    mouth +
    over +
    `</g>` +
    `</svg>`
  )
}

/**
 * The face's frame widened to everything drawn — a hand held out to the side, a crown, steam —
 * so nothing is cut off at the edge. Measured by laying the markup out in the page, because the
 * hands are rotated and scaled and their extent is easiest to ask the browser for. Kept square,
 * and never smaller than the plain face's frame, so a face with no extras is the size it always
 * was. Null outside a browser, or when measuring fails; the 140-unit frame is then used.
 */
function fittedViewBox(svg: string): string | null {
  if (typeof document === 'undefined' || !document.body) return null
  const host = document.createElement('div')
  host.style.cssText = 'position:absolute;left:-10000px;top:0;width:140px;height:140px;visibility:hidden;pointer-events:none'
  host.innerHTML = svg
  document.body.appendChild(host)
  try {
    const root = host.querySelector('svg')
    if (!(root instanceof SVGSVGElement)) return null
    const box = root.getBBox()
    const PAD = 3
    const minX = Math.min(0, box.x - PAD)
    const minY = Math.min(0, box.y - PAD)
    const maxX = Math.max(140, box.x + box.width + PAD)
    const maxY = Math.max(140, box.y + box.height + PAD)
    const size = Math.max(maxX - minX, maxY - minY)
    const x = (minX + maxX - size) / 2
    const y = (minY + maxY - size) / 2
    return [x, y, size, size].map((v) => +v.toFixed(2)).join(' ')
  } catch {
    return null
  } finally {
    host.remove()
  }
}

export function faceDataUri(options: FaceOptions): string {
  let svg = faceSvg(options)
  const viewBox = fittedViewBox(svg)
  if (viewBox) svg = svg.replace('viewBox="0 0 140 140"', `viewBox="${viewBox}"`)
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
