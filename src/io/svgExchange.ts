/**
 * SVG in and out: a blank map to edit anywhere, and the edited file read back onto the map.
 *
 * The round trip is the whole feature: download the selected map as a plain SVG, have something
 * else — ChatGPT, Illustrator, a script — colour it, number it and give it a legend, and drop the
 * result back in. So this module does two things and asks the author nothing in between.
 *
 * **The blank map** is the map's geography and nothing else — no data, no palette, no legend, no
 * flags, no customisation. Every entity is one `<path>` carrying the identifiers an outside editor
 * is least likely to disturb and most likely to recognise: the editor's own id (`data-id`, and
 * `id` where the id is a valid XML name), its name, its ISO codes, and a `<title>` with its name.
 * The outlines are the map's own, exactly as drawn — every entity of the map, including ones a
 * merge or Hide keeps off the screen, and the tiny ones: a path whose outline would round away to
 * a point keeps full precision, so Vatican City is in the file as the shape the map draws. A short
 * `<desc>` tells whoever edits it how to add data so it can be read back.
 *
 * **Reading it back** finds, for every element that names an entity, what was added to it: a
 * fill, a number (`data-value`, or any numeric `data-*` attribute), or a text value. It finds a
 * legend — a group called legend, its swatches and the text beside each — a title, and whether
 * names were written onto the map. And it applies all of it in one operation batch, so it is one
 * undo step:
 *
 *   - numbers become the active layer's values, real numbers the editor can re-colour later;
 *   - fills are kept exactly: each value is pinned to the colour it was given, through the
 *     categorical scale's `categoryColors`, so the map looks the way the edited file does;
 *   - the legend's rows become the legend (`legend.source: 'manual'`), in the file's order, with
 *     its title; a legend is built from the colours when the file has none;
 *   - a title becomes the caption, and names on the map turn the names layer on.
 *
 * Nothing about the map selection changes: the file is read onto whichever map is open, and
 * matched by id first, then ISO code, then name, so a file made from this map matches exactly
 * and one from elsewhere matches as far as its names allow.
 */
import type { MapOperation, OperationResult } from '../state/operations'
import type { LoadedDataset } from '../geo/datasets'
import type { EntityMeta } from '../geo/countryMeta'
import type { LegendEntry, MapDocument, MapValue } from '../types/map'
import { formatValue } from '../state/legend'
import { getAtlas } from '../maps/atlas'
import { getLiveLand } from '../render/liveProjection'

const SVG_NS = 'http://www.w3.org/2000/svg'

/** The fill every entity has in the blank map, so an untouched one is told from a coloured one. */
export const BLANK_FILL = '#e6e6e6'
const BLANK_STROKE = '#8a8f98'
const BLANK_BACKGROUND = '#ffffff'

/** Marks a file as one of ours, with the version of these conventions. */
const MARKER = 'map-editor-blank-map'

/* ------------------------------------------------------------------ export */

const escapeXml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** A valid XML `id`, or null — some entity ids carry characters an id may not. */
const xmlId = (id: string) => (/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(id) ? id : null)

/**
 * A path string at one decimal place, where that keeps the shape.
 *
 * The map's paths carry three decimals, which is sub-pixel detail nobody editing the file will
 * see and a third of its size. Rounded to a tenth of a pixel the outline is unchanged on screen —
 * except for a speck, whose every vertex would round onto the same point. So a path left with
 * fewer than three distinct points by rounding keeps its full precision: Vatican City, a fifth of
 * a pixel across at this scale, is in the file as a shape rather than a dot or nothing.
 */
function compactPath(d: string): string {
  const rounded = d.replace(/-?\d+\.\d+/g, (n) => {
    const v = Math.round(Number(n) * 10) / 10
    return Object.is(v, -0) ? '0' : String(v)
  })
  const points = new Set(rounded.match(/-?[\d.]+,-?[\d.]+/g) ?? [])
  return points.size >= 3 ? rounded : d
}

/** The ISO 3166-1 alpha-3 code an entity belongs to, where there is one. */
function iso3Of(id: string, meta: EntityMeta | undefined): string | null {
  if (/^[A-Z]{3}$/.test(id)) return id
  const parent = meta?.parent?.id
  return parent && /^[A-Z]{3}$/.test(parent) ? parent : null
}

const iso31662Of = (meta: EntityMeta | undefined): string | null =>
  (meta as { source?: { iso31662?: string | null } } | undefined)?.source?.iso31662 ?? null

/** How the blank map explains itself to whoever edits it. Plain text, for any tool or person. */
function instructions(noun: string): string {
  return [
    `Blank map from Map Editor. Each ${noun} is one <path> inside <g id="entities">, identified by`,
    'data-id (and id, data-name, data-iso2, data-iso3). Keep those attributes as they are.',
    'To add information, edit the paths and add elements:',
    '- colour an entity: set fill="#rrggbb" on its <path>;',
    '- give it a number: add data-value="123.4" (or a named attribute such as data-gdp="2.9");',
    '- add a legend: a <g id="legend"> containing, for each item, a <rect fill="#rrggbb"/> followed',
    '  by a <text> with its label, plus an optional <text class="legend-title">Title</text>;',
    '- add a title: <text id="title">Your title</text>.',
    'Drop the edited file back into Map Editor (Maps > SVG) and these additions are applied to the map.',
  ].join('\n')
}

export interface BlankSvg {
  markup: string
  filename: string
  entities: number
}

/**
 * The selected map as a blank SVG: its geography, one identified path per entity.
 *
 * Null before a map has been drawn. Read from the land the canvas projected, so the file is the
 * map on screen — its dataset, its projection, its insets — and costs no reprojection.
 */
export function buildBlankSvg(doc: MapDocument, geo: LoadedDataset | null): BlankSvg | null {
  const land = getLiveLand()
  if (!land || !geo || land.geo !== geo) return null

  const atlas = getAtlas(doc.scope.atlasId)
  const width = Math.round(land.width)
  const height = Math.round(land.height)
  const noun = atlas.noun?.one ?? 'entity'

  const clips = land.insets.map(
    ({ inset, clip }) =>
      `<clipPath id="inset-${escapeXml(inset.id)}"><rect x="${clip.x}" y="${clip.y}" width="${clip.width}" height="${clip.height}"/></clipPath>`,
  )

  const paths: string[] = []
  for (const feature of geo.features) {
    const id = feature.properties.countryId
    const drawn = land.paths.get(id)
    if (!drawn || !drawn.d) continue
    const meta = geo.meta[id]
    const name = meta?.name ?? feature.properties.name
    const attrs: string[] = []
    const asId = xmlId(id)
    if (asId) attrs.push(`id="${asId}"`)
    attrs.push(`data-id="${escapeXml(id)}"`, `data-name="${escapeXml(name)}"`)
    const iso2 = meta?.iso2 ?? null
    if (iso2) attrs.push(`data-iso2="${escapeXml(iso2)}"`)
    const iso3 = iso3Of(id, meta)
    if (iso3) attrs.push(`data-iso3="${iso3}"`)
    const sub = iso31662Of(meta)
    if (sub) attrs.push(`data-iso3166-2="${escapeXml(sub)}"`)
    if (meta?.parent?.name) attrs.push(`data-country="${escapeXml(meta.parent.name)}"`)
    if (drawn.clipId) attrs.push(`clip-path="url(#inset-${escapeXml(drawn.clipId)})"`)
    paths.push(`<path ${attrs.join(' ')} d="${compactPath(drawn.d)}"><title>${escapeXml(name)}</title></path>`)
  }

  const markup = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="${SVG_NS}" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"` +
      ` data-map-editor="${MARKER}" data-version="1" data-atlas="${escapeXml(doc.scope.atlasId)}"` +
      ` data-dataset="${escapeXml(doc.scope.datasetId)}" data-projection="${escapeXml(doc.scope.projectionId)}">`,
    `<title>${escapeXml(atlas.name)} (blank map)</title>`,
    `<desc>${escapeXml(instructions(noun))}</desc>`,
    clips.length > 0 ? `<defs>${clips.join('')}</defs>` : '',
    `<rect id="background" x="0" y="0" width="${width}" height="${height}" fill="${BLANK_BACKGROUND}"/>`,
    `<g id="entities" fill="${BLANK_FILL}" stroke="${BLANK_STROKE}" stroke-width="0.4" stroke-linejoin="round">`,
    ...paths,
    '</g>',
    '</svg>',
    '',
  ]
    .filter(Boolean)
    .join('\n')

  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return { markup, filename: `${slug(atlas.name)}-${slug(doc.scope.datasetId)}-blank.svg`, entities: paths.length }
}

/* ------------------------------------------------------------------ import */

export interface SvgImportResult {
  ok: boolean
  /** What happened, in a sentence the panel can show. */
  message: string
  matched: number
  values: number
  colours: number
  legendItems: number
  title: string | null
  labels: boolean
}

/** The attributes that identify an entity rather than describing it. */
const ID_ATTRS = new Set([
  'data-id',
  'data-name',
  'data-iso2',
  'data-iso3',
  'data-iso3166-2',
  'data-country',
  'data-map-editor',
  'data-version',
])

/** Turns any CSS colour into `#rrggbb`, or null for none, transparent, or a pattern. */
function normaliseColour(value: string | null | undefined): string | null {
  if (!value) return null
  const v = value.trim()
  if (!v || v === 'none' || v === 'transparent' || v.startsWith('url(') || v === 'currentColor' || v === 'inherit') {
    return null
  }
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase()
  if (/^#[0-9a-f]{3}$/i.test(v)) return `#${[...v.slice(1)].map((c) => c + c).join('')}`.toLowerCase()
  const ctx = colourContext()
  if (!ctx) return null
  ctx.fillStyle = '#000001'
  ctx.fillStyle = v
  const out = String(ctx.fillStyle)
  if (out === '#000001') return null
  if (/^#[0-9a-f]{6}$/i.test(out)) return out.toLowerCase()
  // rgba(...) with transparency: take the colour, ignore the alpha.
  const m = out.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  return m ? `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}` : null
}

let colourCtx: CanvasRenderingContext2D | null | undefined
function colourContext(): CanvasRenderingContext2D | null {
  if (colourCtx === undefined) colourCtx = document.createElement('canvas').getContext('2d')
  return colourCtx
}

/** An element's own fill — attribute or inline style — never an inherited one. */
function ownFill(el: Element): string | null {
  const style = el.getAttribute('style') ?? ''
  const fromStyle = style.match(/(?:^|;)\s*fill\s*:\s*([^;]+)/i)?.[1]
  return normaliseColour(fromStyle ?? el.getAttribute('fill'))
}

/** A number written the way data is written: "2,940", "$2.9", "42%", "1.2e6". */
function parseNumber(value: string): number | null {
  const m = value.replace(/,/g, '').match(/-?\d*\.?\d+(?:e[-+]?\d+)?/i)
  if (!m) return null
  const n = Number(m[0])
  return Number.isFinite(n) ? n : null
}

/** "data-gdp-per-capita" -> "GDP per capita"; "data-value" -> "Value". */
function prettyKey(attr: string): string {
  const words = attr.replace(/^data-/, '').split(/[-_]+/).filter(Boolean)
  return words
    .map((w, i) => (w.length <= 3 && /^[a-z]+$/.test(w) && w !== 'per' && w !== 'the' ? w.toUpperCase() : i === 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')
}

/** Resolves whatever an element says it is to one of this map's entities. */
function entityResolver(geo: LoadedDataset) {
  const byName = new Map<string, string | null>()
  const byIso2 = new Map<string, string | null>()
  const byIso3 = new Map<string, string | null>()
  const bySub = new Map<string, string | null>()
  /* A key that two entities share identifies neither, so it resolves to null. */
  const add = (map: Map<string, string | null>, key: string | null | undefined, id: string) => {
    if (!key) return
    const k = key.trim().toLowerCase()
    map.set(k, map.has(k) && map.get(k) !== id ? null : id)
  }
  for (const feature of geo.features) {
    const id = feature.properties.countryId
    const meta = geo.meta[id]
    add(byName, meta?.name ?? feature.properties.name, id)
    add(byName, meta?.officialName, id)
    add(byName, feature.properties.name, id)
    add(byIso2, meta?.iso2, id)
    add(byIso3, iso3Of(id, meta) === id ? id : null, id)
    add(bySub, iso31662Of(meta), id)
  }
  const look = (map: Map<string, string | null>, key: string | null) => (key ? (map.get(key.trim().toLowerCase()) ?? null) : null)

  return (el: Element): string | null => {
    for (const key of [el.getAttribute('data-id'), el.getAttribute('id')]) {
      if (key && geo.byId.has(key)) return key
    }
    const title = [...el.children].find((c) => c.localName === 'title')?.textContent ?? null
    return (
      look(bySub, el.getAttribute('data-iso3166-2')) ??
      look(byIso3, el.getAttribute('data-iso3')) ??
      look(byIso3, el.getAttribute('id')) ??
      look(byIso2, el.getAttribute('data-iso2')) ??
      look(byName, el.getAttribute('data-name')) ??
      look(byName, title) ??
      look(byName, el.getAttribute('id')?.replace(/[-_]+/g, ' ') ?? null)
    )
  }
}

interface LegendRead {
  title: string | null
  items: { color: string; label: string }[]
}

/**
 * The legend, if the file has one: a group whose id or class says legend, its swatches, and the
 * text that follows each in document order. Its title is text marked as one, or text before the
 * first swatch.
 */
function readLegend(root: Element): { legend: LegendRead | null; element: Element | null } {
  const element =
    [...root.querySelectorAll('[id], [class]')].find((el) =>
      /legend/i.test(`${el.getAttribute('id') ?? ''} ${el.getAttribute('class') ?? ''}`) && el.localName === 'g',
    ) ?? null
  if (!element) return { legend: null, element: null }

  const items: { color: string; label: string }[] = []
  let title: string | null = null
  let pending: string | null = null
  const texts = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim()
  for (const el of element.querySelectorAll('*')) {
    const name = el.localName
    if (name === 'text') {
      const text = texts(el)
      if (!text) continue
      const marked = /title/i.test(`${el.getAttribute('id') ?? ''} ${el.getAttribute('class') ?? ''}`)
      if (marked || (!pending && items.length === 0 && title === null)) {
        title = text
        continue
      }
      if (pending) {
        items.push({ color: pending, label: text })
        pending = null
      }
    } else if (name === 'rect' || name === 'circle' || name === 'path' || name === 'polygon' || name === 'ellipse') {
      const colour = ownFill(el)
      if (colour) pending = colour
    } else if (name === 'tspan') {
      continue
    }
  }
  return { legend: { title, items }, element }
}

interface EntityRead {
  id: string
  colour: string | null
  value: MapValue
}

/** The number or text value an element carries, and the attribute it came from. */
function readValue(el: Element): { value: MapValue; key: string | null } {
  const direct = el.getAttribute('data-value')
  if (direct !== null && direct.trim() !== '') {
    const n = parseNumber(direct)
    return { value: n !== null && /^[\s$€£¥+-]*[\d.,]+\s*(e[-+]?\d+)?\s*[%a-zA-Z$€£¥]*\s*$/i.test(direct) ? n : direct.trim(), key: 'data-value' }
  }
  for (const attr of el.getAttributeNames()) {
    if (!attr.startsWith('data-') || ID_ATTRS.has(attr)) continue
    const raw = el.getAttribute(attr) ?? ''
    const n = parseNumber(raw)
    if (n !== null) return { value: n, key: attr }
  }
  return { value: null, key: null }
}

/**
 * Reads an edited SVG and applies what was added to it to the open map, as one undo step.
 *
 * `dispatch` is the store's own, so every change is an ordinary validated operation.
 */
export function importMapSvg(
  text: string,
  doc: MapDocument,
  geo: LoadedDataset | null,
  dispatch: (ops: MapOperation[]) => OperationResult[],
): SvgImportResult {
  const fail = (message: string): SvgImportResult => ({
    ok: false,
    message,
    matched: 0,
    values: 0,
    colours: 0,
    legendItems: 0,
    title: null,
    labels: false,
  })
  if (!geo) return fail('The map is still loading. Try again in a moment.')

  const parsed = new DOMParser().parseFromString(text, 'image/svg+xml')
  const root = parsed.documentElement
  if (!root || root.localName !== 'svg' || parsed.getElementsByTagName('parsererror').length > 0) {
    return fail('That file is not a readable SVG.')
  }

  const resolve = entityResolver(geo)
  const { legend, element: legendElement } = readLegend(root)
  const outside = (el: Element) => !legendElement || !legendElement.contains(el)

  /* ---------------------------------------------------------- the entities */

  const reads = new Map<string, EntityRead>()
  let valueKey: string | null = null
  const candidates = root.querySelectorAll('path, polygon, polyline, rect, circle, ellipse, g, use')
  for (const el of candidates) {
    if (!outside(el) || el.getAttribute('id') === 'background' || el.getAttribute('id') === 'entities') continue
    const identifies =
      el.hasAttribute('data-id') ||
      el.hasAttribute('data-name') ||
      el.hasAttribute('data-iso2') ||
      el.hasAttribute('data-iso3') ||
      el.hasAttribute('id') ||
      [...el.children].some((c) => c.localName === 'title')
    if (!identifies) continue
    const id = resolve(el)
    if (!id) continue

    /* A group standing for an entity takes its colour from itself, or from its first shape. */
    let colour = ownFill(el)
    if (!colour && el.localName === 'g') {
      const shape = el.querySelector('path, polygon, rect, circle, ellipse')
      colour = shape ? ownFill(shape) : null
    }
    if (colour === BLANK_FILL) colour = null
    const { value, key } = readValue(el)
    if (key && key !== 'data-value' && !valueKey) valueKey = key
    if (key === 'data-value' && !valueKey) valueKey = key

    const previous = reads.get(id)
    reads.set(id, {
      id,
      colour: colour ?? previous?.colour ?? null,
      value: value ?? previous?.value ?? null,
    })
  }

  const withColour = [...reads.values()].filter((r) => r.colour)
  const withValue = [...reads.values()].filter((r) => r.value !== null)

  /* ----------------------------------------------- title and names on the map */

  const textOf = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim()
  const titleElement = [...root.querySelectorAll('text')].find(
    (el) => outside(el) && /(^|[\s_-])title($|[\s_-])/i.test(`${el.getAttribute('id') ?? ''} ${el.getAttribute('class') ?? ''}`),
  )
  const title = titleElement ? textOf(titleElement) || null : null
  const names = new Set(geo.features.map((f) => (geo.meta[f.properties.countryId]?.name ?? f.properties.name).toLowerCase()))
  const namedOnMap = [...root.querySelectorAll('text')].filter(
    (el) => outside(el) && el !== titleElement && names.has(textOf(el).toLowerCase()),
  ).length
  const labels = namedOnMap >= 3

  if (withColour.length === 0 && withValue.length === 0 && !legend?.items.length && !title && !labels) {
    return {
      ...fail(
        reads.size > 0
          ? `Matched ${reads.size} ${reads.size === 1 ? 'entity' : 'entities'}, but nothing was added to them — no colours, values, legend or title.`
          : 'No entity of this map was found in that file. Download this map’s SVG and edit that one.',
      ),
      matched: reads.size,
    }
  }

  /* ------------------------------------------------------------- the batch */

  const layer = doc.layers.find((l) => l.id === doc.activeLayerId) ?? doc.layers[0]
  const ops: MapOperation[] = []
  const labelFor = new Map((legend?.items ?? []).map((item) => [item.color, item.label]))

  if (withColour.length > 0 || withValue.length > 0) {
    /* The layer's old values go, so what is on the map afterwards is what the file says. */
    for (const [id, entry] of Object.entries(doc.countries)) {
      if (entry.properties[layer.dataKey] !== undefined && entry.properties[layer.dataKey] !== null && geo.byId.has(id)) {
        ops.push({ op: 'clear_country_value', countryId: id, layerId: layer.id })
      }
    }
  }

  const layerName =
    legend?.title ?? (valueKey && valueKey !== 'data-value' ? prettyKey(valueKey) : null) ?? title ?? layer.name

  if (withColour.length > 0) {
    /*
     * Colours kept exactly: every entity's value is pinned to the colour it was given. A value
     * is its number where it has one, and otherwise the legend's label for its colour, or the
     * colour itself.
     */
    const categoryColors: Record<string, string> = {}
    for (const read of reads.values()) {
      const value: MapValue =
        read.value ?? (read.colour ? (labelFor.get(read.colour) ?? read.colour) : null)
      if (value === null) continue
      ops.push({ op: 'set_country_value', countryId: read.id, value, layerId: layer.id })
      categoryColors[String(value)] = read.colour ?? doc.style.land
    }

    /* The legend: the file's own, or one built from the colours when it has none. */
    let entries: LegendEntry[] = (legend?.items ?? []).map((item) => ({ label: item.label, color: item.color }))
    if (entries.length === 0) {
      const byColour = new Map<string, number[]>()
      for (const read of withColour) {
        const list = byColour.get(read.colour!) ?? []
        if (typeof read.value === 'number') list.push(read.value)
        byColour.set(read.colour!, list)
      }
      entries = [...byColour.entries()]
        .map(([color, values]) => {
          const lo = values.length ? Math.min(...values) : null
          const hi = values.length ? Math.max(...values) : null
          const label =
            lo === null ? color : lo === hi ? formatValue(lo) : `${formatValue(lo)}–${formatValue(hi!)}`
          return { label, color, sort: lo ?? 0 }
        })
        .sort((a, b) => a.sort - b.sort)
        .map(({ label, color }) => ({ label, color }))
    }

    ops.push({
      op: 'set_layer',
      layerId: layer.id,
      patch: { name: layerName, colorScale: { ...layer.colorScale, mode: 'categorical', categoryColors, domain: null } },
    })
    ops.push({
      op: 'set_legend',
      patch: { source: 'manual', entries, visible: true, ...(legend?.title ? { title: legend.title } : {}) },
    })
  } else if (withValue.length > 0) {
    /* Numbers without colours: the editor's own scale colours them. */
    for (const read of withValue) {
      ops.push({ op: 'set_country_value', countryId: read.id, value: read.value, layerId: layer.id })
    }
    const numeric = withValue.every((r) => typeof r.value === 'number')
    ops.push({
      op: 'set_layer',
      layerId: layer.id,
      patch: {
        name: layerName,
        colorScale: { ...layer.colorScale, mode: numeric ? 'numeric' : 'categorical', domain: null, categoryColors: {} },
      },
    })
    ops.push({ op: 'set_legend', patch: { source: 'auto', entries: [], visible: true, ...(legend?.title ? { title: legend.title } : {}) } })
  } else if (legend && legend.items.length > 0) {
    /* A legend with nothing coloured to match it is still the author's legend. */
    ops.push({
      op: 'set_legend',
      patch: { source: 'manual', entries: legend.items.map((i) => ({ label: i.label, color: i.color })), visible: true, ...(legend.title ? { title: legend.title } : {}) },
    })
  }

  if (withColour.length > 0 || withValue.length > 0) {
    ops.push({ op: 'set_comparison', patch: { enabled: false } })
    ops.push({ op: 'set_flags', patch: { enabled: false } })
  }
  if (title) ops.push({ op: 'set_caption', patch: { enabled: true, text: title } })
  if (labels) ops.push({ op: 'set_labels', patch: { enabled: true } })

  const results = dispatch(ops)
  const refused = results.filter((r) => !r.ok)
  const values = results.filter((r) => r.ok && r.op.op === 'set_country_value').length
  const colours = new Set(withColour.map((r) => r.colour)).size
  const legendItems = withColour.length > 0 || !withValue.length ? (legend?.items.length ?? 0) : 0

  const parts: string[] = [`${reads.size} matched`]
  if (values) parts.push(`${values} values`)
  if (colours) parts.push(`${colours} colours`)
  if (legend?.items.length) parts.push(`a legend of ${legend.items.length}`)
  if (title) parts.push(`the title “${title}”`)
  if (labels) parts.push('names')
  return {
    ok: refused.length === 0 || values > 0,
    message: `Applied: ${parts.join(', ')}.${refused.length ? ` ${refused.length} changes were refused.` : ''}`,
    matched: reads.size,
    values,
    colours,
    legendItems,
    title,
    labels,
  }
}
