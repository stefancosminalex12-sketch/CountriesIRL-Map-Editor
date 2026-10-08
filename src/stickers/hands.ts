/**
 * Hands for the sticker faces: white cartoon gloves, each pose drawn for the way it is seen.
 *
 * A hand is built from fingers — jointed, tapered segments with round ends (`finger`) — a palm and
 * a thumb, and a pose is drawn in the view the sticker needs: a fist coming at the viewer shows
 * its knuckles; a fist from the side shows its curled fingers stacked and the thumb over them; a
 * shrug's hands lie palm up with the fingers spread outwards; praying hands are seen edge on. So
 * each sticker's hands are the ones its reference holds, not one glove turned about.
 *
 * Every pose is drawn with the wrist at (0, 0), reaching up (−y), about 34 units long, and is
 * three layers: `body`, the silhouette, drawn as one piece so a single outline runs round it;
 * `front`, any part lying over the rest (a thumb folded across a fist), outlined on its own; and,
 * over both, `lines`, the creases where fingers lie together and the folds of the knuckles. `glove` draws a
 * pose through a transform — rotated, mirrored, foreshortened — keeping its outline even.
 */

export interface Pose {
  body: string
  front?: string
  lines: string
}

type Pt = [number, number]

const FILL = '#f9fbfe'
const SEAM = 'fill="none" stroke="#6b727c" stroke-width="0.6" stroke-linecap="round" stroke-linejoin="round"'
const SOFT = 'fill="none" stroke="#9aa1aa" stroke-width="0.5" stroke-linecap="round" stroke-linejoin="round"'

const f = (n: number) => n.toFixed(2)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** A tapered segment with round ends, from `a` (width `wa`) to `b` (width `wb`). */
function seg(a: Pt, b: Pt, wa: number, wb: number): string {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len
  const ny = dx / len
  const ra = wa / 2
  const rb = wb / 2
  return (
    `<circle cx="${f(a[0])}" cy="${f(a[1])}" r="${f(ra)}"/>` +
    `<circle cx="${f(b[0])}" cy="${f(b[1])}" r="${f(rb)}"/>` +
    `<path d="M${f(a[0] + nx * ra)} ${f(a[1] + ny * ra)} L${f(b[0] + nx * rb)} ${f(b[1] + ny * rb)} L${f(b[0] - nx * rb)} ${f(b[1] - ny * rb)} L${f(a[0] - nx * ra)} ${f(a[1] - ny * ra)} Z"/>`
  )
}

/** A finger through `pts`, base to tip, tapering from `w0` to `w1`. */
function finger(pts: Pt[], w0: number, w1: number): string {
  let out = ''
  for (let i = 0; i < pts.length - 1; i++) {
    out += seg(pts[i], pts[i + 1], lerp(w0, w1, i / (pts.length - 1)), lerp(w0, w1, (i + 1) / (pts.length - 1)))
  }
  return out
}

/** A crease across a finger at `p`, perpendicular to its direction `dir`, `w` wide. */
function fold(p: Pt, dir: Pt, w: number, style = SOFT): string {
  const len = Math.hypot(dir[0], dir[1]) || 1
  const nx = (-dir[1] / len) * w * 0.32
  const ny = (dir[0] / len) * w * 0.32
  const bx = (dir[0] / len) * 0.6
  const by = (dir[1] / len) * 0.6
  return `<path d="M${f(p[0] + nx)} ${f(p[1] + ny)} Q${f(p[0] + bx)} ${f(p[1] + by)} ${f(p[0] - nx)} ${f(p[1] - ny)}" ${style}/>`
}

const line = (d: string, style = SEAM) => `<path d="${d}" ${style}/>`

/** The rolled cuff at the wrist. */
const cuff = (w = 16) =>
  `<path d="M${-w / 2} -1.8 Q0 -3.4 ${w / 2} -1.8 L${w / 2 + 0.4} 3.2 Q0 4.8 ${-w / 2 - 0.4} 3.2 Z"/>`

/* --------------------------------------------------------------- open hands */

/**
 * The palm facing the viewer, fingers up. `spread` 1 fans them out, 0 lays them together (a flat
 * hand: covering, saluting, holding).
 */
function openHand(spread: number, withCuff = true): Pose {
  const s = spread
  const palm = `<path d="M-8 0 C-10 -6 -10.6 -13 -9.2 -18.2 Q0 -20.8 9.2 -18.4 C10.6 -13 10 -6 8 0 Z"/>`
  const fingers: Array<{ base: Pt; tip: Pt; w0: number; w1: number }> = [
    { base: [-6.4, -17], tip: [lerp(-6.8, -10.4, s), -33.6], w0: 4.9, w1: 4.1 },
    { base: [-2.1, -18.4], tip: [lerp(-2.2, -3, s), -36.2], w0: 5.1, w1: 4.3 },
    { base: [2.3, -18.2], tip: [lerp(2.3, 4.6, s), -34.8], w0: 4.9, w1: 4.1 },
    { base: [6.5, -16.4], tip: [lerp(6.3, 10.6, s), lerp(-30, -29.4, s)], w0: 4.3, w1: 3.6 },
  ]
  const mid = (a: Pt, b: Pt, t = 0.55): Pt => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)]
  const thumbTip: Pt = [lerp(-12.4, -16.6, s), lerp(-21, -19.4, s)]
  const thumbMid: Pt = [lerp(-10.8, -13.2, s), lerp(-13.6, -12.6, s)]
  const body =
    palm +
    fingers.map((g) => finger([g.base, mid(g.base, g.tip), g.tip], g.w0, g.w1)).join('') +
    finger([[-7.6, -6.6], thumbMid, thumbTip], 5.6, 4.6) +
    (withCuff ? cuff() : '')
  let lines = ''
  for (let i = 1; i < fingers.length; i++) {
    const a = fingers[i - 1]
    const b = fingers[i]
    const x = (a.base[0] + b.base[0]) / 2
    const y = (a.base[1] + b.base[1]) / 2
    // Together, the seam runs up between them; spread, only the root of the gap shows.
    const reach = lerp(13, 3.2, s)
    const tx = (a.tip[0] + b.tip[0]) / 2
    const ty = (a.tip[1] + b.tip[1]) / 2
    const k = reach / Math.hypot(tx - x, ty - y)
    lines += line(`M${f(x)} ${f(y + 1)} L${f(x + (tx - x) * k)} ${f(y + (ty - y) * k)}`)
  }
  for (const g of fingers) lines += fold(mid(g.base, g.tip), [g.tip[0] - g.base[0], g.tip[1] - g.base[1]], g.w0)
  lines += fold(thumbMid, [thumbTip[0] - thumbMid[0], thumbTip[1] - thumbMid[1]], 5.2)
  // The palm's own creases, faint.
  lines += line('M-5.4 -14.6 Q-6.6 -8.6 -3.4 -3.2', SOFT) + line('M-3 -12 Q2 -13 7 -10.4', SOFT)
  if (withCuff) lines += line('M-7.6 0.6 Q0 2 7.6 0.6', SOFT)
  return { body, lines }
}

/* -------------------------------------------------------------------- fists */

/**
 * A fist from the front, as a punch coming at the viewer is seen: four curled fingers side by side
 * across the top, the fold of each knuckle, and the thumb folded across them. With a cuff it is a
 * fist held up; without, the arm runs away from the viewer and its bottom is round.
 */
function fistFront(withCuff: boolean): Pose {
  const xs = [-7.65, -2.55, 2.55, 7.65]
  const block = withCuff
    ? `<path d="M-9.6 -1 C-11 -6 -11.2 -12 -10.4 -16 L10.4 -16 C11.2 -12 11 -6 9.6 -1 Z"/>`
    : `<path d="M-10.4 -16 L10.4 -16 C11.6 -10 11 -4 6 -1.6 Q0 0.6 -6 -1.6 C-11 -4 -11.6 -10 -10.4 -16 Z"/>`
  const body = block + xs.map((x) => `<rect x="${f(x - 2.6)}" y="-24.6" width="5.2" height="15.2" rx="2.6"/>`).join('') + (withCuff ? cuff() : '')
  const front = finger([[-9.6, -10], [-4.6, -10.6], [3.6, -10]], 5.8, 5.2)
  const lines =
    [-5.1, 0, 5.1].map((x) => line(`M${x} -22.8 Q${x + 0.3} -17.4 ${x} -12.6`)).join('') +
    xs.map((x) => line(`M${f(x - 1.5)} -19.8 Q${x} -20.9 ${f(x + 1.5)} -19.8`, SOFT)).join('') +
    line('M1.6 -12.6 Q2.2 -10 1.6 -7.6', SOFT) +
    (withCuff ? line('M-7.6 0.6 Q0 2 7.6 0.6', SOFT) : '')
  return { body, front, lines }
}

/**
 * A fist from the side: the curled fingers stacked down its front, the thumb lying over the top
 * of them — the fist resting beside a face, or round a bat.
 */
function fistSide(withCuff = true): Pose {
  const rolls = [-19.4, -14.4, -9.4, -4.6]
  const body =
    `<path d="M-8.4 0 C-10.4 -6 -10.6 -15 -7.6 -20.4 Q-2 -23.6 4.4 -21.4 C8 -16 8 -6 7.4 0 Z"/>` +
    rolls.map((y, i) => seg([1.4, y], [10.2 - i * 0.7, y + 0.4], 5, 4.6)).join('') +
    (withCuff ? cuff(15.4) : '')
  const front = finger([[-7, -18.6], [0, -22.4], [7.2, -20.6]], 5.4, 4.8)
  const lines =
    rolls.slice(1).map((y, i) => line(`M2.6 ${f(y - 2.4)} Q7 ${f(y - 3)} ${f(10.6 - i * 0.7)} ${f(y - 2.2)}`)).join('') +
    rolls.map((y, i) => line(`M${f(9.8 - i * 0.7)} ${f(y - 1.4)} Q${f(10.9 - i * 0.7)} ${f(y + 0.4)} ${f(9.8 - i * 0.7)} ${f(y + 2)}`, SOFT)).join('') +
    (withCuff ? line('M-7.2 0.6 Q0 2 7.2 0.6', SOFT) : '')
  return { body, front, lines }
}

/** A fist from the side with the thumb up: 👍. Turned over, thumbs down. */
function thumbUp(): Pose {
  const rolls = [-19.4, -14.4, -9.4, -4.6]
  const body =
    `<path d="M-8.4 0 C-10.4 -6 -10.6 -15 -7.6 -20.4 Q-2 -23.6 4.4 -21.4 C8 -16 8 -6 7.4 0 Z"/>` +
    rolls.map((y, i) => seg([1.4, y], [10.2 - i * 0.7, y + 0.4], 5, 4.6)).join('') +
    finger([[-3.2, -18.6], [-3.6, -27.4], [-2.6, -34.4]], 6.4, 5.4) +
    cuff(15.4)
  const lines =
    rolls.slice(1).map((y, i) => line(`M2.6 ${f(y - 2.4)} Q7 ${f(y - 3)} ${f(10.6 - i * 0.7)} ${f(y - 2.2)}`)).join('') +
    rolls.map((y, i) => line(`M${f(9.8 - i * 0.7)} ${f(y - 1.4)} Q${f(10.9 - i * 0.7)} ${f(y + 0.4)} ${f(9.8 - i * 0.7)} ${f(y + 2)}`, SOFT)).join('') +
    fold([-3.5, -27.4], [0.2, -1], 6) +
    line('M-0.2 -20.6 Q1.4 -14 0.8 -6.4', SOFT) +
    line('M-7.2 0.6 Q0 2 7.2 0.6', SOFT)
  return { body, lines }
}

/* --------------------------------------------------------------- pointing */

/** Palm forward, the index up and the other fingers curled, the thumb over them: ☝️. */
function indexUp(): Pose {
  const body =
    `<path d="M-9.2 0 C-10.8 -6 -11 -12 -10.2 -16 L10.4 -16 C11.2 -12 11 -6 9.4 0 Z"/>` +
    [-2.55, 2.55, 7.65].map((x) => `<rect x="${f(x - 2.6)}" y="-23.4" width="5.2" height="13.6" rx="2.6"/>`).join('') +
    finger([[-7.4, -16], [-7.8, -26], [-7.6, -36.2]], 5.2, 4.4) +
    cuff()
  const front = finger([[-10, -9.4], [-4.6, -10.4], [3.8, -9.8]], 5.8, 5.2)
  const lines =
    [0, 5.1].map((x) => line(`M${x} -21.6 Q${x + 0.3} -16.6 ${x} -12.6`)).join('') +
    line('M-5 -17.6 Q-4.8 -14.6 -5.2 -12.4') +
    fold([-7.8, -26.4], [0, -1], 5) +
    line('M1.6 -12.4 Q2.2 -10 1.6 -7.4', SOFT) +
    line('M-7.6 0.6 Q0 2 7.6 0.6', SOFT)
  return { body, front, lines }
}

/** A fist from the side with the index out ahead and the thumb up: a finger gun, pointing. */
function fingerGun(): Pose {
  const rolls = [-14.4, -9.4, -4.6]
  const body =
    `<path d="M-8.4 0 C-10.4 -6 -10.6 -15 -7.6 -20.4 Q-2 -23.6 4.4 -21.4 C8 -16 8 -6 7.4 0 Z"/>` +
    rolls.map((y, i) => seg([1.4, y], [9.6 - i * 0.7, y + 0.4], 5, 4.6)).join('') +
    finger([[2, -19.4], [11, -20.4], [20.4, -21]], 5, 4.2) +
    finger([[-3.4, -18.6], [-4, -25.2], [-3.2, -30.4]], 5.8, 5)
  const lines =
    rolls.slice(1).map((y, i) => line(`M2.6 ${f(y - 2.4)} Q7 ${f(y - 3)} ${f(10 - i * 0.7)} ${f(y - 2.2)}`)).join('') +
    line('M2.6 -16.8 Q7 -17.4 10.4 -16.8') +
    fold([11.2, -20.4], [1, -0.1], 5) +
    fold([-4, -25.2], [0, -1], 5.6)
  return { body, lines }
}

/**
 * A finger pointed straight at the viewer 🫵: the back of a fist, three fingers curled, and the
 * index coming forward out of it — wider as it nears, ending in a round tip.
 */
function pointAtViewer(): Pose {
  const xs = [-2.55, 2.55, 7.65]
  const body =
    `<path d="M-9.6 -1 C-11 -6 -11.2 -12 -10.4 -16 L10.4 -16 C11.2 -12 11 -6 9.6 -1 Z"/>` +
    xs.map((x) => `<rect x="${f(x - 2.6)}" y="-24.6" width="5.2" height="15.2" rx="2.6"/>`).join('') +
    `<rect x="-10.25" y="-23.4" width="5.2" height="10" rx="2.6"/>` +
    cuff()
  const front = seg([-7.6, -20.6], [-10.4, -9.2], 5.4, 8.6)
  const lines =
    [0, 5.1].map((x) => line(`M${x} -22.8 Q${x + 0.3} -17.4 ${x} -12.6`)).join('') +
    line('M-5 -22 Q-4.8 -18 -5.2 -14') +
    xs.map((x) => line(`M${f(x - 1.5)} -19.8 Q${x} -20.9 ${f(x + 1.5)} -19.8`, SOFT)).join('') +
    fold([-8.8, -15.6], [-0.3, 1], 7) +
    `<ellipse cx="-10.6" cy="-9" rx="2.2" ry="1.7" fill="none" stroke="#9aa1aa" stroke-width="0.5"/>` +
    line('M-7.6 0.6 Q0 2 7.6 0.6', SOFT)
  return { body, front, lines }
}

/** Palm forward, index and middle up and apart, the rest curled under the thumb: ✌️. */
function peace(): Pose {
  const body =
    `<path d="M-9.2 0 C-10.8 -6 -11 -12 -10.2 -16 L10.4 -16 C11.2 -12 11 -6 9.4 0 Z"/>` +
    [2.55, 7.65].map((x) => `<rect x="${f(x - 2.6)}" y="-23.4" width="5.2" height="13.6" rx="2.6"/>`).join('') +
    finger([[-7.4, -16], [-9.6, -26], [-11.4, -35.4]], 5.2, 4.4) +
    finger([[-2.4, -17], [-1.6, -27.4], [-0.4, -36.8]], 5.3, 4.5) +
    cuff()
  const front = finger([[-10, -9.4], [-4.6, -10.4], [3.8, -9.8]], 5.8, 5.2)
  const lines =
    line('M5.1 -21.6 Q5.4 -16.6 5.1 -12.6') +
    line('M-4.9 -17.4 L-5.4 -19.6') +
    fold([-9.6, -26], [-0.2, -1], 5) +
    fold([-1.6, -27.4], [0.1, -1], 5) +
    line('M1.6 -12.4 Q2.2 -10 1.6 -7.4', SOFT) +
    line('M-7.6 0.6 Q0 2 7.6 0.6', SOFT)
  return { body, front, lines }
}

/** The OK sign, palm forward: index and thumb meeting in a ring, the other three up and apart. */
function okSign(): Pose {
  const palm = `<path d="M-8 0 C-10 -6 -10.6 -13 -9.2 -18.2 Q0 -20.8 9.2 -18.4 C10.6 -13 10 -6 8 0 Z"/>`
  const up: Array<{ base: Pt; tip: Pt; w0: number; w1: number }> = [
    { base: [-1.8, -18.4], tip: [-2.4, -35.6], w0: 5.1, w1: 4.3 },
    { base: [2.6, -18.2], tip: [4.6, -34.2], w0: 4.9, w1: 4.1 },
    { base: [6.6, -16.4], tip: [10.4, -29], w0: 4.3, w1: 3.6 },
  ]
  // The ring: the index bending down to meet the thumb's tip.
  const ring =
    finger([[-6.6, -17.2], [-9.4, -27.4], [-15.6, -27.6], [-19, -21.8]], 4.8, 4.2) +
    finger([[-7.8, -6.8], [-14.6, -10.8], [-19, -18.8]], 5.6, 4.6)
  const body = palm + up.map((g) => finger([g.base, [lerp(g.base[0], g.tip[0], 0.55), lerp(g.base[1], g.tip[1], 0.55)], g.tip], g.w0, g.w1)).join('') + ring + cuff()
  const lines =
    up.map((g) => fold([lerp(g.base[0], g.tip[0], 0.55), lerp(g.base[1], g.tip[1], 0.55)], [g.tip[0] - g.base[0], g.tip[1] - g.base[1]], g.w0)).join('') +
    line('M0.4 -17.2 L0.9 -20.4') +
    line('M4.6 -16.8 L5.6 -19.8') +
    line('M-19.6 -20.2 Q-18 -19.6 -17.6 -21') +
    line('M-7.6 0.6 Q0 2 7.6 0.6', SOFT)
  return { body, lines }
}

/** The thinking hand 🤔: the index along the jaw, the thumb under the chin, the rest curled. */
function thinking(): Pose {
  const rolls = [-14.4, -9.4, -4.6]
  const body =
    `<path d="M-8.4 0 C-10.4 -6 -10.6 -15 -7.6 -20.4 Q-2 -23.6 4.4 -21.4 C8 -16 8 -6 7.4 0 Z"/>` +
    rolls.map((y, i) => seg([1.4, y], [9.6 - i * 0.7, y + 0.4], 5, 4.6)).join('') +
    finger([[2.4, -19.6], [4.4, -28.4], [5.2, -36.4]], 5, 4.2) +
    finger([[-6, -16.4], [-13.4, -20.4], [-19.4, -21.6]], 5.8, 5)
  const lines =
    rolls.slice(1).map((y, i) => line(`M2.6 ${f(y - 2.4)} Q7 ${f(y - 3)} ${f(10 - i * 0.7)} ${f(y - 2.2)}`)).join('') +
    line('M2.6 -16.8 Q7 -17.4 10.2 -16.8') +
    fold([4.4, -28.4], [0.2, -1], 5) +
    fold([-13.4, -20.4], [-1, -0.4], 5.6)
  return { body, lines }
}

/* ---------------------------------------------------------------- edge on */

/** A flat hand seen edge on, fingers together: praying hands, a hand held at the side. */
function edgeOn(): Pose {
  const body =
    `<path d="M-4.4 0 C-5.6 -10 -5.4 -24 -3.6 -33.4 Q-0.6 -38 2.4 -34 C4.6 -24 4.8 -10 4 0 Z"/>` +
    finger([[-3.6, -6], [-6.6, -12.4], [-6.4, -18.6]], 4.6, 4) +
    cuff(10)
  const lines =
    line('M-0.6 -12 Q0.6 -24 -0.2 -33', SOFT) +
    line('M-3.4 -21.6 Q-1.2 -22.4 1.4 -21.4', SOFT) +
    line('M-5 1 Q0 2 5 1', SOFT)
  return { body, lines }
}

export const POSES = {
  open: openHand(1),
  flat: openHand(0),
  fist: fistFront(true),
  punch: fistFront(false),
  fistSide: fistSide(true),
  thumb: thumbUp(),
  index: indexUp(),
  gun: fingerGun(),
  atYou: pointAtViewer(),
  peace: peace(),
  ok: okSign(),
  think: thinking(),
  edge: edgeOn(),
} as const

export type PoseId = keyof typeof POSES

/**
 * A pose, drawn: placed at (x, y), turned `rotate` degrees, scaled, mirrored with `flip`, and
 * narrowed across with `across` (below 1) — how a hand lying palm up is seen from the front,
 * foreshortened across its palm. The transform is applied inside the outline filter, so the
 * outline stays even.
 */
export function glove(
  pose: PoseId,
  x: number,
  y: number,
  rotate: number,
  scale = 1.6,
  { flip = false, across = 1 }: { flip?: boolean; across?: number } = {},
): string {
  const p = POSES[pose]
  const t = `translate(${f(x)} ${f(y)}) rotate(${f(rotate)}) scale(${f((flip ? -scale : scale) * across)} ${f(scale)})`
  const piece = (inner: string) => `<g filter="url(#gloveFx)" fill="${FILL}"><g transform="${t}">${inner}</g></g>`
  return piece(p.body) + (p.front ? piece(p.front) : '') + `<g transform="${t}">${p.lines}</g>`
}
