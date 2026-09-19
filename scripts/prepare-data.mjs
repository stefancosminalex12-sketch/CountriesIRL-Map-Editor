/**
 * Copies the curated geographic datasets into public/geo/ and writes the entity tables the
 * app reads them with.
 *
 * Runs automatically before `npm run dev` / `npm run build`, and only ever copies: the
 * geometry itself is prepared once, by `scripts/build-geography.mjs`, into
 * `data/natural-earth/` — the shared foundation every map draws from (see that script).
 * Keeping this a copy rather than an import means datasets are fetched lazily at runtime,
 * and the build stays offline.
 */
import { mkdirSync, copyFileSync, cpSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildCountryTable } from './country-table.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = resolve(root, 'data/natural-earth')
const outDir = resolve(root, 'public/geo')

mkdirSync(outDir, { recursive: true })

/* --------------------------------------------------------- curated geometry */

/**
 * Everything a map draws: the World map's land at three resolutions, the administrative
 * world, the USA map, and the shared inland water and rivers — all from one pipeline.
 */
const CURATED = [
  'countries-110m.json',
  'countries-50m.json',
  'countries-10m.json',
  'us-states-10m.json',
  'lakes-10m.geojson',
  'lakes-50m.geojson',
  'rivers-10m.geojson',
  'rivers-50m.geojson',
  /*
   * The named oceans and seas, one file for every map — `scripts/build-waters.mjs`. Copied
   * like the rest even though the layer is off by default, so a clean checkout has it and the
   * app can fetch it the moment somebody switches Water Regions on.
   */
  'waters.geojson',
]
const missing = []
for (const file of CURATED) {
  const src = resolve(dataDir, file)
  if (existsSync(src)) copyFileSync(src, resolve(outDir, file))
  else missing.push(file)
}
if (missing.length > 0) {
  console.warn(`[prepare-data] missing ${missing.join(', ')} - run: npm run build-geography`)
}

/*
 * Island water: the maritime zones `scripts/fetch-eez.mjs` vendors into `data/maritime/`.
 * Copied here like the rest, so a clean checkout — the deploy — has them too.
 */
const EEZ = resolve(root, 'data/maritime/eez-territories.geojson')
if (existsSync(EEZ)) copyFileSync(EEZ, resolve(outDir, 'eez-territories.geojson'))
else console.warn('[prepare-data] missing data/maritime/eez-territories.geojson - run: npm run fetch-eez')

/* -------------------------------------------------------- country metadata */

const table = buildCountryTable()
const { byId, numericToId, nameToId } = table

writeFileSync(
  resolve(outDir, 'country-meta.json'),
  JSON.stringify({ generatedAt: new Date().toISOString(), numericToId, nameToId, entities: byId }),
)

/* --------------------------------------------------------------- US states */

/**
 * The USA map's entity table, in the envelope every table shares so one loader reads them
 * all. States are identified by the feature id Natural Earth carries (`US-CA`), so the
 * numeric and name indexes a country table needs are simply empty here.
 */
{
  const src = resolve(dataDir, 'us-states-meta.json')
  if (existsSync(src)) {
    const entities = JSON.parse(readFileSync(src, 'utf8'))
    writeFileSync(
      resolve(outDir, 'us-state-meta.json'),
      JSON.stringify({ generatedAt: new Date().toISOString(), numericToId: {}, nameToId: {}, entities }),
    )
    console.log(`[prepare-data] ${Object.keys(entities).length} USA States entities -> public/geo/us-state-meta.json`)
  } else {
    console.warn('[prepare-data] missing us-states-meta.json - run: npm run build-geography')
  }
}

/* ------------------------------------------------- Modern Administrative World */

/**
 * The administrative world is written whole by `scripts/admin/build-admin.mjs` — its base
 * topology, the entity table, one fragment per country and level, and the index that says
 * which fragments each detail level uses — so this only copies it. Stale files from an
 * earlier build are removed first, or a fragment the table no longer uses would linger.
 */
{
  const src = resolve(root, 'data/admin')
  const dest = resolve(outDir, 'admin')
  if (existsSync(resolve(src, 'index.json'))) {
    rmSync(dest, { recursive: true, force: true })
    mkdirSync(dest, { recursive: true })
    const files = readdirSync(src).filter((f) => f.endsWith('.json') && f !== 'report.json')
    for (const file of files) copyFileSync(resolve(src, file), resolve(dest, file))
    for (const stale of ['admin1-10m.json', 'admin1-meta.json']) rmSync(resolve(outDir, stale), { force: true })
    console.log(`[prepare-data] administrative world: ${files.length} files -> public/geo/admin/`)
  } else {
    console.warn('[prepare-data] missing data/admin/index.json - run: npm run build-geography')
  }
}

/* ---------------------------------------------- Official USA Administrative Map */

/**
 * Written whole by `scripts/usa/build-usa.mjs` from Census Bureau and USGS data — a topology,
 * an entity table and a details file per level, and the USGS water — so this only copies it.
 */
{
  const src = resolve(root, 'data/usa-official')
  const dest = resolve(outDir, 'usa-official')
  if (existsSync(resolve(src, 'counties.json'))) {
    rmSync(dest, { recursive: true, force: true })
    cpSync(src, dest, { recursive: true, filter: (path) => !path.endsWith('report.json') })
    console.log(`[prepare-data] official USA map -> public/geo/usa-official/`)
  } else {
    console.warn('[prepare-data] missing data/usa-official/ - run: npm run build-usa')
  }
}

/* --------------------------------------------------------------------- Europe */

/**
 * Written whole by `scripts/europe/build-europe.mjs` from EuroGlobalMap — the Europe Countries
 * topologies, the Europe Administrative presets, their entity tables and EuroGlobalMap's lakes —
 * so this only copies it.
 */
{
  const src = resolve(root, 'data/europe')
  const dest = resolve(outDir, 'europe')
  if (existsSync(resolve(src, 'countries-meta.json'))) {
    rmSync(dest, { recursive: true, force: true })
    cpSync(src, dest, { recursive: true, filter: (path) => !path.endsWith('report.json') })
    console.log(`[prepare-data] Europe maps -> public/geo/europe/`)
  } else {
    console.warn('[prepare-data] missing data/europe/ - run: npm run build-europe')
  }
}

console.log(
  `[prepare-data] ${CURATED.length - missing.length} of ${CURATED.length} curated layers copied, ` +
    `${Object.keys(byId).length} countries indexed -> public/geo/`,
)
