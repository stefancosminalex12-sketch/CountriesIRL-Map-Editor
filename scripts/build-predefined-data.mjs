/**
 * Builds the predefined datasets: real values, per entity, for Templates → Predefined Data.
 *
 * A maintenance script, NOT part of the build, like `build-geography.mjs` and `build-waters.mjs`: it
 * downloads the published figures (caching them in `.cache/datasets/`, or refetching with
 * `--refresh`) and writes one JSON file per dataset into `src/data/predefined/`, which is committed.
 * The app imports a dataset's file only when it is applied, so nothing here costs a page load.
 *
 *   node scripts/build-predefined-data.mjs
 *   node scripts/build-predefined-data.mjs --refresh
 *
 * ## What and from where
 *
 *   - **HDI** — UNDP Human Development Report 2023/24, composite indices time series: each
 *     country's 2022 Human Development Index.
 *   - **GDP per capita** (current US$), **Inflation** (consumer prices, annual %) and **Population**
 *     — the World Bank's World Development Indicators (NY.GDP.PCAP.CD, FP.CPI.TOTL.ZG,
 *     SP.POP.TOTL), each country's most recent published year (`mrnev=1`). CC BY 4.0.
 *   - **US population** — the US Census Bureau's Vintage 2023 population estimates, for every
 *     state, the District of Columbia and Puerto Rico, and for every county and county-equivalent
 *     (Connecticut's planning regions included, as the map draws them).
 *
 * ## Levels
 *
 * A dataset holds values at one or more *levels* — countries, US states, US counties — each keyed
 * by the entity ids the maps already use: ISO 3166-1 alpha-3 for countries (`FRA`, `XKX`), both
 * of the USA maps' state ids (`US-CA` and `state-06`), and county FIPS (`county-06037`). The app
 * picks the level that matches the map on screen and the fixed thresholds that suit it: a
 * population map of countries and one of counties cannot share bands. Nothing is estimated,
 * interpolated or derived — a figure is here because the source published it for that entity, and
 * an entity with no published figure has no value.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cacheDir = resolve(root, '.cache/datasets')
const outDir = resolve(root, 'src/data/predefined')
const REFRESH = process.argv.includes('--refresh')
mkdirSync(cacheDir, { recursive: true })
mkdirSync(outDir, { recursive: true })

async function cached(name, url, { json = false, encoding = 'utf8' } = {}) {
  const path = resolve(cacheDir, name)
  if (!existsSync(path) || REFRESH) {
    console.log(`[predefined] fetching ${url}`)
    const response = await fetch(url)
    if (!response.ok) throw new Error(`${url} -> ${response.status}`)
    writeFileSync(path, Buffer.from(await response.arrayBuffer()))
  }
  const text = readFileSync(path, encoding)
  return json ? JSON.parse(text) : text
}

/* ------------------------------------------------------------ entity tables */

const countryIds = new Set(Object.keys(JSON.parse(readFileSync(resolve(root, 'public/geo/country-meta.json'), 'utf8')).entities))
const usStates = JSON.parse(readFileSync(resolve(root, 'public/geo/us-state-meta.json'), 'utf8')).entities
const officialStates = JSON.parse(readFileSync(resolve(root, 'public/geo/usa-official/states-meta.json'), 'utf8')).entities
const officialCounties = JSON.parse(readFileSync(resolve(root, 'public/geo/usa-official/counties-meta.json'), 'utf8')).entities

/** A state's name -> every id the USA maps give it. */
const stateIdsByName = new Map()
for (const [id, meta] of Object.entries(usStates)) stateIdsByName.set(meta.name.toLowerCase(), [...(stateIdsByName.get(meta.name.toLowerCase()) ?? []), id])
for (const [id, meta] of Object.entries(officialStates)) stateIdsByName.set(meta.name.toLowerCase(), [...(stateIdsByName.get(meta.name.toLowerCase()) ?? []), id])

/** A minimal CSV reader: quoted fields may hold commas. */
function csv(text) {
  const rows = []
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue
    const cells = []
    let cell = ''
    let quoted = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (quoted) {
        if (c === '"' && line[i + 1] === '"') { cell += '"'; i++ }
        else if (c === '"') quoted = false
        else cell += c
      } else if (c === '"') quoted = true
      else if (c === ',') { cells.push(cell); cell = '' }
      else cell += c
    }
    cells.push(cell)
    rows.push(cells)
  }
  const [head, ...body] = rows
  return body.map((cells) => Object.fromEntries(head.map((h, i) => [h, cells[i]])))
}

/* ------------------------------------------------------------ the sources */

/** A World Bank indicator: each country's most recent published value, and its year. */
async function worldBank(indicator) {
  const url = `https://api.worldbank.org/v2/country/all/indicator/${indicator}?format=json&per_page=500&mrnev=1`
  const [, rows] = await cached(`wb-${indicator}.json`, url, { json: true })
  const values = {}
  const years = {}
  for (const row of rows ?? []) {
    const id = row.countryiso3code
    if (!countryIds.has(id) || row.value === null || !Number.isFinite(row.value)) continue
    values[id] = row.value
    years[row.date] = (years[row.date] ?? 0) + 1
  }
  return { values, years }
}

const round = (n, dp) => Number(n.toFixed(dp))
const roundAll = (values, dp) => Object.fromEntries(Object.entries(values).map(([k, v]) => [k, round(v, dp)]))
const yearsLabel = (years) => {
  const list = Object.keys(years).map(Number).sort((a, b) => a - b)
  const common = Object.entries(years).sort((a, b) => b[1] - a[1])[0]?.[0]
  return list.length === 1 ? String(list[0]) : `${common} (latest available, ${list[0]}–${list.at(-1)})`
}

function write(id, dataset) {
  const levels = Object.fromEntries(Object.entries(dataset.levels).map(([level, values]) => [level, Object.fromEntries(Object.entries(values).sort(([a], [b]) => (a < b ? -1 : 1)))]))
  writeFileSync(resolve(outDir, `${id}.json`), JSON.stringify({ ...dataset, levels }))
  const counts = Object.entries(levels).map(([level, v]) => `${Object.keys(v).length} ${level}`).join(', ')
  console.log(`[predefined] ${id}: ${counts} — ${dataset.year}`)
}

/* HDI — UNDP. */
{
  const rows = csv(await cached('hdr-2023-24.csv', 'https://hdr.undp.org/sites/default/files/2023-24_HDR/HDR23-24_Composite_indices_complete_time_series.csv', { encoding: 'latin1' }))
  const values = {}
  for (const row of rows) {
    const id = row.iso3
    const v = Number(row.hdi_2022)
    if (countryIds.has(id) && row.hdi_2022 !== '' && Number.isFinite(v)) values[id] = round(v, 3)
  }
  write('hdi', { source: 'UNDP Human Development Report 2023/24', year: '2022', levels: { countries: values } })
}

/* GDP per capita, Inflation — World Bank. */
{
  const gdp = await worldBank('NY.GDP.PCAP.CD')
  write('gdp-per-capita', { source: 'World Bank, World Development Indicators (CC BY 4.0)', year: yearsLabel(gdp.years), levels: { countries: roundAll(gdp.values, 0) } })
  const cpi = await worldBank('FP.CPI.TOTL.ZG')
  write('inflation', { source: 'World Bank, World Development Indicators (CC BY 4.0)', year: yearsLabel(cpi.years), levels: { countries: roundAll(cpi.values, 1) } })
}

/* Population — World Bank for countries, US Census for states and counties. */
{
  const pop = await worldBank('SP.POP.TOTL')
  const states = {}
  for (const row of csv(await cached('census-states-2023.csv', 'https://www2.census.gov/programs-surveys/popest/datasets/2020-2023/state/totals/NST-EST2023-ALLDATA.csv'))) {
    if (row.SUMLEV !== '040') continue
    const ids = stateIdsByName.get(row.NAME.toLowerCase()) ?? []
    const v = Number(row.POPESTIMATE2023)
    if (Number.isFinite(v)) for (const id of ids) states[id] = v
  }
  const counties = {}
  for (const row of csv(await cached('census-counties-2023.csv', 'https://www2.census.gov/programs-surveys/popest/datasets/2020-2023/counties/totals/co-est2023-alldata.csv', { encoding: 'latin1' }))) {
    if (row.SUMLEV !== '050') continue
    const id = `county-${row.STATE}${row.COUNTY}`
    const v = Number(row.POPESTIMATE2023)
    if (officialCounties[id] && Number.isFinite(v)) counties[id] = v
  }
  write('population', {
    source: 'World Bank, World Development Indicators (CC BY 4.0); US Census Bureau, Vintage 2023 estimates',
    year: `${yearsLabel(pop.years)}; US 2023`,
    levels: { countries: roundAll(pop.values, 0), 'us-states': states, 'us-counties': counties },
  })
}
