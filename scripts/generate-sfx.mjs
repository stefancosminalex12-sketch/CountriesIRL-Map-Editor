/**
 * Generates the application's sound effects as local WAV assets.
 *
 * Everything is synthesised from scratch — no samples, no external service, nothing
 * to license when the prototype goes out to creators.
 *
 * The design brief is a family of very short tactile clicks: the sound of a good
 * keyboard or a well-damped button, not environmental recordings. Each one is built
 * from three ingredients, all kept deliberately small:
 *
 *   - a short damped sine "body" that gives the click a pitch centre and a smooth
 *     tail, so it reads as tactile rather than as a burst of static;
 *   - a very brief noise transient for the contact itself, low-passed so it never
 *     turns into a hiss or a spike;
 *   - a raised-cosine attack of a few milliseconds, which is what removes the harsh
 *     edge a raw impulse would have.
 *
 * Everything is then gently low-passed and kept well below full scale. These are
 * meant to be heard fifty times an hour without being noticed.
 *
 * Runs before `npm run dev` / `npm run build`; output goes to public/sfx/.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SAMPLE_RATE = 44100
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(root, 'public/sfx')
mkdirSync(outDir, { recursive: true })

// Clear stale assets so renaming a sound never leaves the old file behind.
for (const file of readdirSync(outDir)) {
  if (file.endsWith('.wav')) rmSync(resolve(outDir, file))
}

/* ------------------------------------------------------------------ helpers */

/** Deterministic RNG, so regenerating the assets never changes them. */
function rng(seed) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
}

/** One-pole low-pass; the main tool for keeping these sounds soft. */
function lowPass(samples, cutoff) {
  const dt = 1 / SAMPLE_RATE
  const rc = 1 / (2 * Math.PI * cutoff)
  const alpha = dt / (rc + dt)
  let previous = 0
  return samples.map((sample) => {
    previous += alpha * (sample - previous)
    return previous
  })
}

function normalise(samples, peak) {
  let max = 0
  for (const sample of samples) max = Math.max(max, Math.abs(sample))
  if (max === 0) return samples
  const gain = peak / max
  return samples.map((sample) => sample * gain)
}

/** Mixes `part` into `target` starting at `offset` seconds. */
function mixAt(target, part, offset, gain = 1) {
  const start = Math.floor(offset * SAMPLE_RATE)
  for (let i = 0; i < part.length; i++) {
    const at = start + i
    if (at >= 0 && at < target.length) target[at] += part[i] * gain
  }
  return target
}

/* -------------------------------------------------------------- sound design */

/**
 * One tactile click.
 *
 * `frequency` sets how "heavy" it feels — higher reads as a light tick, lower as a
 * firm press. `drop` bends the pitch down slightly over the decay, which is what
 * stops it sounding like a synthesised beep and makes it feel like something
 * physical settling.
 */
function click({
  seed,
  duration,
  frequency,
  drop = 0.35,
  decay = 55,
  noise = 0.35,
  noiseMs = 4,
  attackMs = 2.5,
  tone = 0.8,
  lowPassHz = 5200,
}) {
  const length = Math.floor(duration * SAMPLE_RATE)
  const random = rng(seed)
  const samples = new Array(length).fill(0)

  // Damped, slightly falling sine: the body of the click.
  let phase = 0
  for (let i = 0; i < length; i++) {
    const t = i / SAMPLE_RATE
    const f = frequency * (1 - drop * Math.min(1, t / duration))
    phase += (2 * Math.PI * f) / SAMPLE_RATE
    samples[i] = Math.sin(phase) * Math.exp(-t * decay) * tone
  }

  // Contact transient: a handful of milliseconds of noise, nothing more.
  const noiseLength = Math.floor((noiseMs / 1000) * SAMPLE_RATE)
  const contact = new Array(noiseLength)
  for (let i = 0; i < noiseLength; i++) {
    contact[i] = (random() * 2 - 1) * Math.pow(1 - i / noiseLength, 2.2)
  }
  mixAt(samples, lowPass(contact, 3600), 0, noise)

  // Raised-cosine attack: removes the hard edge without softening the timing.
  const attack = Math.max(1, Math.floor((attackMs / 1000) * SAMPLE_RATE))
  for (let i = 0; i < attack && i < length; i++) {
    samples[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / attack)
  }

  // Fade the last few ms to zero so nothing ends on a discontinuity.
  const tail = Math.min(length, Math.floor(0.006 * SAMPLE_RATE))
  for (let i = 0; i < tail; i++) {
    samples[length - 1 - i] *= i / tail
  }

  return lowPass(samples, lowPassHz)
}

const SOUNDS = {
  /** Selecting a country. The lightest thing in the set — used most often. */
  tick: () =>
    normalise(
      click({ seed: 1207, duration: 0.055, frequency: 1180, decay: 90, noise: 0.28, noiseMs: 3 }),
      0.3,
    ),

  /** A control changing value: dataset, projection, display options. */
  click: () =>
    normalise(
      click({ seed: 3391, duration: 0.075, frequency: 820, decay: 68, noise: 0.32, noiseMs: 4 }),
      0.34,
    ),

  /** Opening or closing a panel. Lower and softer — a button being pressed. */
  press: () =>
    normalise(
      click({
        seed: 5527,
        duration: 0.11,
        frequency: 520,
        decay: 42,
        noise: 0.26,
        noiseMs: 5,
        attackMs: 4,
        lowPassHz: 4200,
      }),
      0.32,
    ),

  /**
   * A display switch going on. A shade brighter and shorter than `click`, with the
   * pitch bend reduced so it lands with a defined edge rather than settling.
   */
  toggleOn: () =>
    normalise(
      click({
        seed: 4111,
        duration: 0.05,
        frequency: 1010,
        drop: 0.22,
        decay: 96,
        noise: 0.3,
        noiseMs: 3,
        attackMs: 1.8,
        lowPassHz: 5600,
      }),
      0.32,
    ),

  /**
   * The same switch going off: same contact, released rather than made. Lower and a
   * touch softer, with the bend back up so the pair reads as one gesture in two
   * directions instead of as two unrelated sounds.
   */
  toggleOff: () =>
    normalise(
      click({
        seed: 4112,
        duration: 0.055,
        frequency: 690,
        drop: 0.42,
        decay: 88,
        noise: 0.24,
        noiseMs: 3,
        attackMs: 2.2,
        lowPassHz: 4400,
      }),
      0.28,
    ),

  /** Confirming a choice, such as a theme. A soft double tap. */
  confirm: () => {
    const length = Math.floor(0.13 * SAMPLE_RATE)
    const samples = new Array(length).fill(0)
    mixAt(samples, click({ seed: 7717, duration: 0.06, frequency: 760, decay: 80, noise: 0.24 }), 0, 1)
    mixAt(
      samples,
      click({ seed: 7718, duration: 0.075, frequency: 1010, decay: 70, noise: 0.2 }),
      0.045,
      0.85,
    )
    return normalise(samples, 0.34)
  },

  /**
   * Recomposing the map — a new region. The only sound with any sense of movement,
   * and even then it is two quiet taps and a short settle rather than a whoosh.
   */
  transition: () => {
    const length = Math.floor(0.18 * SAMPLE_RATE)
    const samples = new Array(length).fill(0)
    mixAt(samples, click({ seed: 9931, duration: 0.07, frequency: 640, decay: 60, noise: 0.22 }), 0, 1)
    mixAt(
      samples,
      click({
        seed: 9932,
        duration: 0.11,
        frequency: 430,
        decay: 34,
        noise: 0.18,
        attackMs: 5,
        lowPassHz: 3600,
      }),
      0.06,
      0.9,
    )
    return normalise(samples, 0.36)
  },
}

let total = 0
const written = []
for (const [name, build] of Object.entries(SOUNDS)) {
  const samples = build()
  const data = Buffer.alloc(samples.length * 2)
  samples.forEach((sample, i) => {
    const clamped = Math.max(-1, Math.min(1, sample))
    data.writeInt16LE(Math.round(clamped * 32767), i * 2)
  })

  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(SAMPLE_RATE, 24)
  header.writeUInt32LE(SAMPLE_RATE * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)

  writeFileSync(resolve(outDir, `${name}.wav`), Buffer.concat([header, data]))
  total += data.length + 44
  written.push(`${name} ${(samples.length / SAMPLE_RATE * 1000).toFixed(0)}ms`)
}

console.log(`[generate-sfx] ${written.join(', ')} -> public/sfx/ (${(total / 1024).toFixed(1)}kB)`)
