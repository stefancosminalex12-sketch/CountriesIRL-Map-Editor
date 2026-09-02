/**
 * Copies the flag artwork this map can actually use into `public/flags/`.
 *
 * The source is `flag-icons`, which ships one SVG per ISO 3166-1 alpha-2 code at a
 * uniform 4:3 viewBox. Nothing is drawn, simplified or recoloured here — the files
 * are copied verbatim, so a flag on the map is the flag the library publishes.
 *
 * Only codes the country table actually names are copied. `flag-icons` also carries
 * subdivision flags (gb-eng, es-ct, …) that no entity in this dataset maps to, and
 * shipping them would be dead weight in `dist/`.
 *
 * The manifest it writes is the other half of the contract: the renderer asks it
 * whether a flag exists *before* requesting one, so a country with no flag falls back
 * to plain land instead of firing a 404 and drawing a broken image. Entities that
 * genuinely have no flag — the Spratly Islands, a UN buffer zone, a glacier — are
 * reported here rather than papered over.
 */
import { createRequire } from 'node:module'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readEntityMeta } from './entity-meta.mjs'
import { TERRITORY_FLAGS, TERRITORY_NO_FLAG } from './territory-flags.mjs'
import { HISTORICAL_FLAGS } from './historical-flags.mjs'

const require = createRequire(import.meta.url)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const SOURCE = join(dirname(require.resolve('flag-icons/package.json')), 'flags', '4x3')
/** Flags drawn in this repo, for entities `flag-icons` has no code for. */
const LOCAL_SOURCE = join(root, 'assets', 'flags')

/**
 * Codes where the local file deliberately replaces the library's, and why.
 *
 * Local artwork is otherwise only ever *added*, never substituted, so that nothing
 * shipped here can quietly diverge from the published flag set. An override is a
 * decision about what a country's flag currently is, so each one is named here rather
 * than taking effect merely by existing.
 */
const FLAG_OVERRIDES = {
  hn: 'Honduras returned to navy blue in 2026; flag-icons still ships the 2022 turquoise',
}
const OUT_DIR = join(root, 'public', 'flags')
const MANIFEST = join(root, 'src', 'flags', 'manifest.ts')
const META = join(root, 'public', 'geo', 'country-meta.json')

if (!existsSync(SOURCE)) {
  console.error('[flags] flag-icons is not installed; run npm install first')
  process.exit(1)
}
if (!existsSync(META)) {
  console.error('[flags] country-meta.json is missing; run prepare-data first')
  process.exit(1)
}

const countries = readEntityMeta(META)
const localCodes = existsSync(LOCAL_SOURCE)
  ? readdirSync(LOCAL_SOURCE).filter((file) => file.endsWith('.svg')).map((file) => file.slice(0, -4))
  : []
const available = new Map()
for (const file of readdirSync(SOURCE)) {
  if (file.endsWith('.svg')) available.set(file.slice(0, -4), join(SOURCE, file))
}
// Local artwork is added, never substituted — except where an override says otherwise,
// so nothing shipped here can quietly replace a real flag without a stated reason.
const overridden = []
for (const code of localCodes) {
  if (!available.has(code)) available.set(code, join(LOCAL_SOURCE, `${code}.svg`))
  else if (FLAG_OVERRIDES[code]) {
    available.set(code, join(LOCAL_SOURCE, `${code}.svg`))
    overridden.push(code)
  }
}

/** iso2 -> the country ids that use it. Kosovo appears twice (UNK and XKX). */
const wanted = new Map()
for (const country of Object.values(countries)) {
  // A territory named in the policy uses the code stated there; everything else uses
  // its own iso2. This is the only place the two can disagree.
  const code = (TERRITORY_FLAGS[country.id] || country.iso2 || '').toLowerCase()
  if (!code) continue
  if (!wanted.has(code)) wanted.set(code, [])
  wanted.get(code).push(country.id)
}

rmSync(OUT_DIR, { recursive: true, force: true })
mkdirSync(OUT_DIR, { recursive: true })

const copied = []
const missing = []
for (const [code, ids] of [...wanted].sort()) {
  if (available.has(code)) {
    copyFileSync(available.get(code), join(OUT_DIR, `${code}.svg`))
    copied.push(code)
  } else {
    missing.push({ code, ids, names: ids.map((id) => countries[id].name) })
  }
}

/*
 * The historical flags, which no country asks for.
 *
 * The loop above is driven by the country list, so a flag nothing in the dataset flies
 * would never be copied. These are offered to merged entities instead, which is exactly
 * the case the country list cannot know about.
 */
const historical = []
for (const flag of HISTORICAL_FLAGS) {
  const file = join(LOCAL_SOURCE, `${flag.code}.svg`)
  if (!existsSync(file)) {
    missing.push({ code: flag.code, ids: [], names: [flag.name] })
    continue
  }
  copyFileSync(file, join(OUT_DIR, `${flag.code}.svg`))
  copied.push(flag.code)
  historical.push(flag)
}

writeFileSync(
  MANIFEST,
  `/**
 * Which flags exist on disk, by ISO 3166-1 alpha-2.
 *
 * Generated by \`scripts/prepare-flags.mjs\` — do not edit by hand.
 *
 * The renderer checks this before requesting a file, so an entity without artwork
 * falls back to ordinary land instead of asking for a URL that is not there.
 */
export const FLAG_CODES: ReadonlySet<string> = new Set(${JSON.stringify(copied)})

/**
 * Entities whose flag is not the one their own code would find.
 *
 * Every entry comes from \`scripts/territory-flags.mjs\`, where the reason for it is
 * written down. Consulted before an entity's own iso2, so a territory that flies
 * another state's flag resolves to that state's artwork.
 */
export const FLAG_ALIASES: ReadonlyMap<string, string> = new Map(${JSON.stringify(
    Object.entries(TERRITORY_FLAGS).map(([id, code]) => [id, code.toLowerCase()]),
  )})

/**
 * Flags that belong to no country in the dataset, offered by name.
 *
 * Historical and regional artwork a merged entity can fly. Every one is the Wikimedia
 * Commons file named in \`scripts/historical-flags.mjs\`, stored verbatim — the name
 * here is what the flag chooser searches on.
 */
export const FLAG_EXTRAS: ReadonlyArray<{ code: string; name: string }> = ${JSON.stringify(
    historical.map((flag) => ({ code: flag.code, name: flag.name })),
  )}
`,
  'utf8',
)

console.log(`[flags] ${copied.length} flags -> public/flags`)
console.log(`[flags] ${Object.keys(TERRITORY_FLAGS).length} territories flagged by policy`)
for (const code of overridden) console.log(`[flags] ${code} overridden — ${FLAG_OVERRIDES[code]}`)
for (const code of Object.keys(FLAG_OVERRIDES)) {
  if (!overridden.includes(code)) console.warn(`[flags] override for "${code}" has no file in assets/flags`)
}
if (missing.length) {
  console.log(`[flags] ${missing.length} entities have no flag and will render as plain land:`)
  for (const entry of missing) {
    const reason = entry.ids.map((id) => TERRITORY_NO_FLAG[id]).find(Boolean)
    console.log(`  ${entry.ids.join('/')} (${entry.code}) — ${entry.names[0]}${reason ? ` — ${reason}` : ''}`)
  }
}
