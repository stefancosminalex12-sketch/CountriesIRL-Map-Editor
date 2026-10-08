/**
 * Writes the sticker catalogue the editor's Find Stickers panel searches: one image per emoji in
 * `public/stickers/fluent-emoji-3d/`, and an index of every emoji's name and category.
 *
 * The artwork is Microsoft's Fluent Emoji in its **3D** style — rendered, shaded, glossy faces,
 * people, animals, objects and symbols — from the `@lobehub/fluent-emoji-3d` package, which ships
 * them as 256-pixel WebP files of about 6 KB each. MIT licensed, so they can be shipped with the
 * editor and used on maps and in videos without conditions.
 *
 * That package names each file by its code points (`1f600.webp`). The names and categories come
 * from Iconify's packaging of the same emoji set (`@iconify-json/fluent-emoji-flat`), which maps
 * code points to names (`grinning-face`) and names to Unicode categories. An emoji with no name
 * there — mostly national flags, which the editor has its own artwork for — is left out, and so
 * are the skin-tone variants: the default yellow figure is what a map wants, and five copies of
 * every person would bury everything else.
 */
import { createRequire } from 'node:module'
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(root, 'public', 'stickers')
const PREFIX = 'fluent-emoji-3d'

const SOURCE = join(dirname(require.resolve('@lobehub/fluent-emoji-3d/package.json')), 'assets')
const META_DIR = dirname(require.resolve('@iconify-json/fluent-emoji-flat/package.json'))
const read = (file) => JSON.parse(readFileSync(join(META_DIR, file), 'utf8'))

const SKIN_TONE = /-(light|medium-light|medium|medium-dark|dark)$/

/** Code points → name, with the variation selector ignored so `2639` and `2639-fe0f` agree. */
const chars = read('chars.json')
const strip = (codes) => codes.replace(/-fe0f/g, '')
const nameOf = new Map()
for (const [codes, name] of Object.entries(chars)) {
  nameOf.set(codes, name)
  if (!nameOf.has(strip(codes))) nameOf.set(strip(codes), name)
}

const categories = Object.keys(read('metadata.json').categories ?? {})
const categoryOf = new Map()
for (const [category, names] of Object.entries(read('metadata.json').categories ?? {})) {
  for (const name of names) categoryOf.set(name, categories.indexOf(category))
}

rmSync(OUT_DIR, { recursive: true, force: true })
const dir = join(OUT_DIR, PREFIX)
mkdirSync(dir, { recursive: true })

const icons = []
const seen = new Set()
for (const file of readdirSync(SOURCE).sort()) {
  if (!file.endsWith('.webp')) continue
  const codes = file.slice(0, -5)
  const name = nameOf.get(codes) ?? nameOf.get(strip(codes))
  if (!name || SKIN_TONE.test(name) || seen.has(name) || !categoryOf.has(name)) continue
  seen.add(name)
  copyFileSync(join(SOURCE, file), join(dir, `${name}.webp`))
  icons.push([0, name, categoryOf.get(name), Number.parseInt(codes, 16)])
}

/*
 * Faces first, then by code point, which keeps related emoji together (the grinning faces, the
 * hearts) — so Smileys opens on faces rather than on whatever sorts first alphabetically.
 */
const isFace = (name) => /(^|-)face(-|$)/.test(name)
icons.sort((a, b) => Number(isFace(b[1])) - Number(isFace(a[1])) || a[3] - b[3])
for (const icon of icons) icon.length = 3

const index = {
  sets: [
    {
      prefix: PREFIX,
      label: 'Emoji',
      ext: 'webp',
      name: 'Fluent Emoji 3D',
      author: 'Microsoft',
      license: 'MIT',
      categories,
    },
  ],
  icons,
}
writeFileSync(join(OUT_DIR, 'index.json'), JSON.stringify(index))
console.log(`[stickers] ${icons.length} Fluent Emoji 3D (MIT) -> public/stickers/${PREFIX}`)
