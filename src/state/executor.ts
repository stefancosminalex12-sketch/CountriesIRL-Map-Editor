/**
 * Validates and applies map operations.
 *
 * Pure functions only — given a document and a list of operations, produce the next
 * document plus a per-operation result. No React, no store, no side effects, so the
 * same path serves the UI, the future AI assistant, tests and replay.
 */
import { MAX_COMPARISON_GROUPS } from '../types/map'
import { BUILT_IN_PALETTES, createCountryEntry, createGroup } from './defaults'
import { PRESET_IDS } from './presets'
import {
  KNOWN_OPERATIONS,
  PLANNED_OPERATIONS,
  type MapOperation,
  type OperationResult,
} from './operations'
import { REGIONS } from '../geo/regions'
import { ALL_DATASETS } from '../maps/atlas'
import { PROJECTIONS } from '../geo/projections'
import type {
  CountryEntry,
  CountryId,
  CountryLabels,
  MapCaption,
  MapDocument,
  MapGroup,
  MapStyle,
  RegionId,
} from '../types/map'

export interface ExecutionContext {
  /** Country ids present in the loaded dataset. Empty/omitted skips the existence check. */
  knownCountryIds?: Set<CountryId>
  /**
   * Group ids present in the document. Filled in per operation by `executeOperations`
   * rather than passed in, since a batch can create a group and then use it.
   */
  groupIds?: Set<string>
}

const REGION_IDS = new Set<string>(REGIONS.map((r) => r.id))
const DATASET_IDS = new Set<string>(ALL_DATASETS.map((d) => d.id))
const PROJECTION_IDS = new Set<string>([...PROJECTIONS.map((p) => p.id), 'auto'])
const PLANNED = new Set<string>(PLANNED_OPERATIONS)
const PALETTE_IDS = new Set<string>(BUILT_IN_PALETTES.map((p) => p.id))

/** Structural validation. Returns an error message, or null when the operation is valid. */
export function validateOperation(op: MapOperation, ctx: ExecutionContext = {}): string | null {
  if (!op || typeof op !== 'object' || typeof op.op !== 'string') {
    return 'Operation must be an object with an "op" field'
  }

  if (PLANNED.has(op.op)) {
    return `Operation "${op.op}" is planned but not implemented yet`
  }

  /*
   * Anything the executor does not implement is refused rather than waved through.
   * A no-op reported as a success is worse than an error: it is what let the retired
   * `set_country_color` keep answering "ok" after the colour it set had stopped
   * existing, and an assistant reading that log would have no way to know.
   */
  if (!KNOWN_OPERATIONS.has(op.op)) {
    return `Unknown operation "${op.op}"`
  }

  if ('countryId' in op) {
    const countryId = op.countryId
    if (typeof countryId !== 'string' || !countryId.trim()) {
      return 'countryId must be a non-empty string'
    }
    if (ctx.knownCountryIds && ctx.knownCountryIds.size > 0 && !ctx.knownCountryIds.has(countryId)) {
      return `Unknown country "${countryId}" in the active dataset`
    }
  }

  // Every group operation except the one that creates it must name a group that
  // exists, so a stale id from an undone creation is refused rather than ignored.
  if ('groupId' in op && op.op !== 'create_group') {
    if (!ctx.groupIds || !ctx.groupIds.has(op.groupId)) {
      return `Unknown group "${op.groupId}"`
    }
  }

  /*
   * Country lists get the same existence check a single `countryId` gets, so a batch
   * that names a country the dataset does not have is rejected rather than quietly
   * adding a member nothing can draw.
   */
  if ('countryIds' in op) {
    if (!Array.isArray(op.countryIds) || op.countryIds.length === 0) {
      return 'countryIds must be a non-empty array'
    }
    const known = ctx.knownCountryIds
    if (known && known.size > 0) {
      const unknown = op.countryIds.find((id) => !known.has(id))
      if (unknown) return `Unknown country "${unknown}" in the active dataset`
    }
  }

  switch (op.op) {
    case 'create_group':
      if (typeof op.groupId !== 'string' || !op.groupId.trim()) return 'groupId is required'
      if (typeof op.name !== 'string' || !op.name.trim()) return 'name must be a non-empty string'
      return null
    case 'rename_group':
      if (typeof op.name !== 'string' || !op.name.trim()) return 'name must be a non-empty string'
      return null
    case 'set_active_palette':
      return PALETTE_IDS.has(op.paletteId) ? null : `Unknown palette "${op.paletteId}"`
    case 'set_active_preset':
      return PRESET_IDS.has(op.presetId) ? null : `Unknown preset "${op.presetId}"`
    case 'set_comparison': {
      if (!op.patch || typeof op.patch !== 'object') return 'patch must be an object'
      const count = op.patch.groupCount
      if (
        count !== undefined &&
        (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > MAX_COMPARISON_GROUPS)
      ) {
        return `groupCount must be an integer from 1 to ${MAX_COMPARISON_GROUPS}`
      }
      return null
    }
    case 'set_comparison_group':
    case 'add_to_comparison':
    case 'remove_from_comparison':
      // Indexed rather than keyed by id: the four groups are a fixed, ordered set, so
      // an out-of-range index is a malformed operation rather than a missing group.
      if (!Number.isInteger(op.index) || op.index < 0 || op.index >= MAX_COMPARISON_GROUPS) {
        return `index must be an integer from 0 to ${MAX_COMPARISON_GROUPS - 1}`
      }
      return null
    case 'set_country_property':
      if (!op.key) return 'key is required'
      return null
    case 'create_merge': {
      if (!op.id) return 'a merge needs an id'
      if (!Array.isArray(op.members) || op.members.length < 2) {
        return 'a merge needs at least two countries'
      }
      return null
    }
    case 'update_merge':
      return op.id ? null : 'a merge needs an id'
    case 'delete_merge':
      return op.id ? null : 'a merge needs an id'

    case 'set_screen': {
      if (!op.patch || typeof op.patch !== 'object') return 'patch must be an object'
      const rect = op.patch.rect as Record<string, unknown> | null | undefined
      if (rect !== undefined && rect !== null) {
        for (const key of ['x', 'y', 'width', 'height']) {
          const value = rect[key]
          if (typeof value !== 'number' || !Number.isFinite(value)) {
            return `rect.${key} must be a finite number`
          }
        }
        if ((rect.width as number) <= 0 || (rect.height as number) <= 0) {
          return 'rect must have a positive width and height'
        }
      }
      return null
    }
    case 'set_legend': {
      if (!op.patch || typeof op.patch !== 'object') return 'patch must be an object'
      const anchor = op.patch.anchor as { x?: unknown; y?: unknown } | undefined
      if (anchor !== undefined) {
        if (typeof anchor?.x !== 'number' || typeof anchor?.y !== 'number') {
          return 'anchor must be { x: number, y: number }'
        }
        if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) {
          return 'anchor components must be finite'
        }
      }
      /*
       * The size is validated rather than clamped here.
       *
       * Clamping would silently accept a broken value and store a different one, and an
       * operation that does not do what it says is worse than one that refuses. The two
       * places that produce a size — the corner drag and the size controls — both clamp
       * before they dispatch, so anything out of range is a bug worth surfacing.
       */
      const size = op.patch.size as { width?: unknown; height?: unknown } | null | undefined
      if (size !== undefined && size !== null) {
        if (typeof size.width !== 'number' || typeof size.height !== 'number') {
          return 'size must be { width: number, height: number } or null'
        }
        if (!Number.isFinite(size.width) || !Number.isFinite(size.height)) {
          return 'size components must be finite'
        }
        if (size.width <= 0 || size.height <= 0) return 'size components must be positive'
      }
      /*
       * Only the keys actually present are checked. `sizes` is merged rather than
       * replaced when it is applied, so a patch naming one element is the normal case,
       * not a malformed one — requiring all four here would reject every real edit.
       */
      const sizes = op.patch.sizes as Record<string, unknown> | undefined
      if (sizes !== undefined) {
        if (typeof sizes !== 'object' || sizes === null) return 'sizes must be an object'
        for (const [key, value] of Object.entries(sizes)) {
          if (!['title', 'subtitle', 'text', 'icon', 'items'].includes(key)) {
            return `sizes has no element "${key}"`
          }
          if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
            return `sizes.${key} must be a positive number`
          }
        }
      }
      return null
    }
    case 'set_scope_dataset':
      return DATASET_IDS.has(op.datasetId) ? null : `Unknown dataset "${op.datasetId}"`
    case 'set_scope_regions': {
      if (!Array.isArray(op.regionIds) || op.regionIds.length === 0) {
        return 'regionIds must be a non-empty array'
      }
      const bad = op.regionIds.find((id) => !REGION_IDS.has(id))
      return bad ? `Unknown region "${bad}"` : null
    }
    case 'set_scope_projection':
      return PROJECTION_IDS.has(op.projectionId) ? null : `Unknown projection "${op.projectionId}"`
    default:
      return null
  }
}

function upsert(
  countries: Record<CountryId, CountryEntry>,
  id: CountryId,
  patch: (entry: CountryEntry) => CountryEntry,
): Record<CountryId, CountryEntry> {
  const current = countries[id] ?? createCountryEntry(id)
  return { ...countries, [id]: patch(current) }
}

/** The layer key an operation writes into, honouring an explicit `layerId`. */
function keyFor(doc: MapDocument, layerId?: string): string {
  const layer = doc.layers.find((l) => l.id === (layerId ?? doc.activeLayerId)) ?? doc.layers[0]
  return layer ? layer.dataKey : 'value'
}

/** Replaces one group, leaving the rest of the list untouched. */
function patchGroup(
  doc: MapDocument,
  groupId: string,
  patch: (group: MapGroup) => MapGroup,
): MapDocument {
  return { ...doc, groups: doc.groups.map((g) => (g.id === groupId ? patch(g) : g)) }
}

/** Applies a single already-validated operation. Never mutates `doc`. */
function applyOperation(doc: MapDocument, op: MapOperation): MapDocument {
  switch (op.op) {
    case 'set_country_value': {
      const key = keyFor(doc, op.layerId)
      return {
        ...doc,
        countries: upsert(doc.countries, op.countryId, (e) => ({
          ...e,
          properties: { ...e.properties, [key]: op.value },
        })),
      }
    }
    case 'clear_country_value': {
      const key = keyFor(doc, op.layerId)
      const entry = doc.countries[op.countryId]
      if (!entry) return doc
      const properties = { ...entry.properties }
      delete properties[key]
      return { ...doc, countries: { ...doc.countries, [op.countryId]: { ...entry, properties } } }
    }
    case 'set_country_property':
      return {
        ...doc,
        countries: upsert(doc.countries, op.countryId, (e) => ({
          ...e,
          properties: { ...e.properties, [op.key]: op.value },
        })),
      }
    case 'set_country_label':
      return {
        ...doc,
        countries: upsert(doc.countries, op.countryId, (e) => ({ ...e, label: op.label })),
      }
    case 'clear_country': {
      const next = { ...doc.countries }
      delete next[op.countryId]
      return { ...doc, countries: next }
    }
    case 'clear_all_countries':
      return { ...doc, countries: {} }

    case 'create_group':
      // Re-creating an existing id is a no-op rather than a duplicate, so replaying a
      // log twice cannot leave two groups answering to the same name.
      return doc.groups.some((g) => g.id === op.groupId)
        ? doc
        : { ...doc, groups: [...doc.groups, createGroup(op.groupId, op.name, op.members ?? [])] }
    case 'rename_group':
      return patchGroup(doc, op.groupId, (g) => ({ ...g, name: op.name }))
    case 'delete_group':
      return { ...doc, groups: doc.groups.filter((g) => g.id !== op.groupId) }
    case 'add_to_group':
      return patchGroup(doc, op.groupId, (g) => ({
        ...g,
        members: [...new Set([...g.members, ...op.countryIds])],
      }))
    case 'remove_from_group': {
      const drop = new Set(op.countryIds)
      return patchGroup(doc, op.groupId, (g) => ({
        ...g,
        members: g.members.filter((id) => !drop.has(id)),
      }))
    }
    case 'set_group_value': {
      const key = keyFor(doc, op.layerId)
      return patchGroup(doc, op.groupId, (g) => ({
        ...g,
        properties: { ...g.properties, [key]: op.value },
      }))
    }
    case 'set_scope_dataset':
      return { ...doc, scope: { ...doc.scope, datasetId: op.datasetId } }
    case 'set_scope_regions':
      return { ...doc, scope: { ...doc.scope, regionIds: op.regionIds as RegionId[] } }
    case 'set_scope_projection':
      return { ...doc, scope: { ...doc.scope, projectionId: op.projectionId } }
    case 'set_style':
      return { ...doc, style: { ...doc.style, ...(op.patch as Partial<MapStyle>) } }
    /*
     * A shallow merge like the style's, so one control writes one field: setting the
     * outline colour leaves the face, the size and the switch exactly as they were.
     */
    /* A shallow merge like the style's, so one control writes one field. */
    case 'set_caption':
      return { ...doc, caption: { ...doc.caption, ...(op.patch as Partial<MapCaption>) } }
    case 'set_labels':
      return { ...doc, labels: { ...doc.labels, ...(op.patch as Partial<CountryLabels>) } }
    case 'set_map_name':
      return { ...doc, name: op.name }
    case 'set_active_layer':
      return doc.layers.some((l) => l.id === op.layerId) ? { ...doc, activeLayerId: op.layerId } : doc
    case 'set_layer':
      return {
        ...doc,
        layers: doc.layers.map((l) => (l.id === op.layerId ? { ...l, ...op.patch } : l)),
      }
    case 'set_active_palette':
      return { ...doc, activePaletteId: op.paletteId }
    /*
     * A shallow merge, so setting a rect leaves the aspect alone and vice versa — the
     * two are written by different controls.
     */
    /*
     * Additive. The countries a merge names are left exactly where they are — the
     * renderer draws them as one body, and deleting the merge is all it takes to have
     * them back.
     */
    case 'create_merge':
      return {
        ...doc,
        merges: [...doc.merges, { id: op.id, name: op.name, members: op.members, flag: null }],
      }
    case 'update_merge':
      return {
        ...doc,
        merges: doc.merges.map((m) => (m.id === op.id ? { ...m, ...op.patch } : m)),
      }
    case 'delete_merge':
      return { ...doc, merges: doc.merges.filter((m) => m.id !== op.id) }

    case 'set_screen':
      return { ...doc, screen: { ...doc.screen, ...(op.patch as Partial<MapDocument['screen']>) } }
    case 'set_legend': {
      const patch = op.patch as Partial<MapDocument['legend']>
      /*
       * `sizes` merges rather than replacing, because every other field on the legend is
       * a single value and this one is a record of four. A caller nudging the title's
       * size should not have to restate the other three, and a shallow spread would
       * silently reset them to undefined if it forgot.
       */
      const sizes = patch.sizes ? { ...doc.legend.sizes, ...patch.sizes } : doc.legend.sizes
      return { ...doc, legend: { ...doc.legend, ...patch, sizes } }
    }
    case 'set_flags':
      return { ...doc, flags: { ...doc.flags, ...op.patch } }
    case 'set_active_preset':
      return { ...doc, activePresetId: op.presetId }
    case 'set_comparison':
      return { ...doc, comparison: { ...doc.comparison, ...op.patch } }
    case 'set_comparison_group': {
      const groups = doc.comparison.groups.map((g, i) =>
        i === op.index ? { ...g, ...op.patch } : g,
      )
      return { ...doc, comparison: { ...doc.comparison, groups } }
    }
    case 'add_to_comparison': {
      const groups = doc.comparison.groups.map((g, i) => {
        if (i !== op.index) return g
        // A set, not a list: adding a country already in the group is a no-op rather
        // than a duplicate, so repeating the gesture cannot corrupt the membership.
        const members = [...new Set([...g.members, ...op.countryIds])]
        return { ...g, members }
      })
      return { ...doc, comparison: { ...doc.comparison, groups } }
    }
    case 'remove_from_comparison': {
      const drop = new Set(op.countryIds)
      const groups = doc.comparison.groups.map((g, i) =>
        i === op.index ? { ...g, members: g.members.filter((id) => !drop.has(id)) } : g,
      )
      return { ...doc, comparison: { ...doc.comparison, groups } }
    }
    default:
      return doc
  }
}

export interface ExecutionOutcome {
  doc: MapDocument
  results: OperationResult[]
  applied: number
}

/**
 * Validates then applies a batch. Invalid operations are skipped and reported, so a
 * single bad operation in an AI-produced batch can never corrupt the document.
 */
export function executeOperations(
  doc: MapDocument,
  ops: MapOperation[],
  ctx: ExecutionContext = {},
): ExecutionOutcome {
  let next = doc
  const results: OperationResult[] = []
  let applied = 0

  for (const op of ops) {
    // Group ids are re-read from the running document, so a batch may create a group
    // and then add to it — which is exactly the shape an assistant's batch will take.
    const error = validateOperation(op, {
      ...ctx,
      groupIds: new Set(next.groups.map((g) => g.id)),
    })
    if (error) {
      results.push({ op, ok: false, error })
      continue
    }
    next = applyOperation(next, op)
    results.push({ op, ok: true })
    applied++
  }

  return { doc: next, results, applied }
}
