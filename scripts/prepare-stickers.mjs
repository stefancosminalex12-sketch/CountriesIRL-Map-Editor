/**
 * Writes the sticker catalogue the editor's Find Stickers panel searches: one SVG per icon in
 * `public/stickers/<set>/`, and an index of every icon's set, name and category.
 *
 * The artwork comes from Iconify's packaging of open icon sets, chosen for licences that let
 * the pictures be shipped with the editor and used in maps and videos without conditions:
 *
 * - Fluent Emoji Flat (Microsoft, MIT): faces, people, animals, objects, symbols — the flat
 *   coloured style mapping videos use for "time zones" and "currency" icons.
 * - Flat Color Icons (Icons8, MIT): simple flat icons.
 *
 * One file per icon rather than one bundle, so the panel's thumbnails load lazily as plain
 * images and a search that shows forty icons downloads forty small files. Skin-tone variants
 * are left out (`-light`, `-medium-dark`, …): the default yellow figure is what a map wants, and
 * five copies of every person would bury everything else.
 */
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(root, 'public', 'stickers')

const SETS = [
  { prefix: 'fluent-emoji-flat', label: 'Emoji' },
  { prefix: 'flat-color-icons', label: 'Icons' },
]

const SKIN_TONE = /-(light|medium-light|medium|medium-dark|dark)$/

function readSet(prefix) {
  const dir = dirname(require.resolve(`@iconify-json/${prefix}/package.json`))
  const read = (file) => JSON.parse(readFileSync(join(dir, file), 'utf8'))
  return {
    icons: read('icons.json'),
    info: read('info.json'),
    metadata: existsSync(join(dir, 'metadata.json')) ? read('metadata.json') : {},
  }
}

rmSync(OUT_DIR, { recursive: true, force: true })
const index = { sets: [], icons: [] }

for (const { prefix, label } of SETS) {
  const { icons, info, metadata } = readSet(prefix)
  const categoryOf = new Map()
  const categories = Object.keys(metadata.categories ?? {})
  for (const [category, names] of Object.entries(metadata.categories ?? {})) {
    for (const name of names) categoryOf.set(name, categories.indexOf(category))
  }
  if (categories.length === 0) categories.push(label)

  const setIndex = index.sets.length
  index.sets.push({
    prefix,
    label,
    name: info.name,
    author: info.author?.name ?? '',
    license: info.license?.title ?? '',
    categories,
  })

  const dir = join(OUT_DIR, prefix)
  mkdirSync(dir, { recursive: true })
  let written = 0
  for (const [name, icon] of Object.entries(icons.icons)) {
    if (SKIN_TONE.test(name) || icon.hidden) continue
    const width = icon.width ?? icons.width ?? 16
    const height = icon.height ?? icons.height ?? 16
    const left = icon.left ?? 0
    const top = icon.top ?? 0
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${left} ${top} ${width} ${height}">${icon.body}</svg>`
    writeFileSync(join(dir, `${name}.svg`), svg)
    index.icons.push([setIndex, name, categoryOf.get(name) ?? 0])
    written++
  }
  console.log(`[stickers] ${written} ${info.name} (${info.license?.title}) -> public/stickers/${prefix}`)
}

writeFileSync(join(OUT_DIR, 'index.json'), JSON.stringify(index))
