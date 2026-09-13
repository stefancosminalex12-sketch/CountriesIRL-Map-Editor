/**
 * The map operation vocabulary.
 *
 * Everything that changes a map goes through an operation. The UI dispatches them,
 * and the future AI assistant will *only* be allowed to emit them — it never touches
 * React state or the renderer. The flow is:
 *
 *   natural language -> AI -> MapOperation[] -> validate -> apply -> re-render
 *
 * Operations are plain serialisable data so they can be logged, replayed, undone,
 * and validated before anything is mutated.
 *
 * There is no operation for painting a country directly. Colour comes from a mode —
 * the data palette or the comparison — and an operation that set a country's colour
 * would outrank whichever mode is on, which is exactly the ambiguity the mode system
 * exists to remove. To colour a country, give it a value or put it in a group.
 */
import type {
  CountryId,
  MapValue,
  ProjectionId,
  RegionId,
} from '../types/map'

export type MapOperation =
  | { op: 'set_country_value'; countryId: CountryId; value: MapValue; layerId?: string }
  | { op: 'set_country_property'; countryId: CountryId; key: string; value: MapValue }
  /**
   * Takes territories off the map without taking them out of the document.
   *
   * Hiding rather than deleting, because the interesting maps are the ones you can undo:
   * a world without France is one click away from a world with it, and while France is
   * hidden it is still a country the document knows about — it keeps its value, its
   * group, its flag and its merges, and it comes back with all of them.
   *
   * Plural because it is used on a selection, and a selection is usually more than one
   * thing. Hiding four countries is one act and should be one undo.
   */
  | { op: 'set_countries_hidden'; countryIds: CountryId[]; hidden: boolean }
  | { op: 'set_country_label'; countryId: CountryId; label: string | null }
  | { op: 'clear_country_value'; countryId: CountryId; layerId?: string }
  | { op: 'clear_country'; countryId: CountryId }
  | { op: 'clear_all_countries' }
  /*
   * Groups.
   *
   * `create_group` carries the id it is creating rather than minting one inside the
   * executor. An operation has to be able to say what it did: a log replayed twice
   * must produce the same document, and an assistant that creates a group and then
   * renames it needs to know what to name. Ids come from `nextGroupId(doc)`.
   */
  | { op: 'create_group'; groupId: string; name: string; members?: CountryId[] }
  | { op: 'rename_group'; groupId: string; name: string }
  | { op: 'delete_group'; groupId: string }
  | { op: 'add_to_group'; groupId: string; countryIds: CountryId[] }
  | { op: 'remove_from_group'; groupId: string; countryIds: CountryId[] }
  | { op: 'set_group_value'; groupId: string; value: MapValue; layerId?: string }
  | { op: 'set_scope_dataset'; datasetId: string }
  | { op: 'set_scope_regions'; regionIds: RegionId[] }
  | { op: 'set_scope_projection'; projectionId: ProjectionId | 'auto' }
  | { op: 'set_style'; patch: Record<string, unknown> }
  | { op: 'set_map_name'; name: string }
  | { op: 'set_active_layer'; layerId: string }
  | { op: 'set_layer'; layerId: string; patch: Record<string, unknown> }
  /* colouring */
  | { op: 'set_active_palette'; paletteId: string }
  /*
   * The fixed-threshold scale's chosen preset. A sibling of `set_active_palette`
   * rather than a flag inside it: the two scales are alternatives, each keeps its own
   * choice, and switching between them must not overwrite the other's.
   */
  | { op: 'set_active_preset'; presetId: string }
  /*
   * The legend, including where it sits. Authored content: a legend moved to the
   * bottom-right is a decision about the map, so it belongs in the document and on
   * the undo stack alongside every other one.
   */
  | { op: 'set_legend'; patch: Record<string, unknown> }
  /*
   * Names on the territories. Authored content — whether a map is labelled, and how
   * those labels look, is a decision about the map — so it travels the same pipeline
   * and the same undo stack as the legend beside it.
   */
  | { op: 'set_labels'; patch: Record<string, unknown> }
  /*
   * The caption across the top. Authored content — what a map is titled is a decision
   * about the map — so it travels the same pipeline and undo stack as the legend.
   */
  | { op: 'set_caption'; patch: Record<string, unknown> }
  /*
   * The composition frame. Authored content — where the picture is cropped is a
   * decision about the map — so it goes through the pipeline like everything else.
   */
  | { op: 'set_screen'; patch: Record<string, unknown> }
  /*
   * Merged entities. Additive and reversible: creating one records which countries it
   * dissolves, deleting one restores them, and the dataset is never touched by either.
   */
  | { op: 'create_merge'; id: string; name: string; members: CountryId[] }
  | { op: 'update_merge'; id: string; patch: { name?: string; flag?: string | null; members?: CountryId[] } }
  | { op: 'delete_merge'; id: string }
  /** Turns the flag overlay on or off. Deletes nothing when it goes off. */
  | {
      op: 'set_flags'
      patch: {
        enabled?: boolean
        islandWater?: boolean
        internationalBorders?: boolean
        worldDomination?: boolean
        dominationCountryId?: CountryId | null
        overrides?: Record<CountryId, CountryId>
      }
    }
  | { op: 'set_comparison'; patch: { enabled?: boolean; groupCount?: number } }
  /*
   * Comparison groups. Compare owns these outright — see `ComparisonMode` — so they
   * have their own operations rather than borrowing the `MapGroup` ones.
   *
   * Membership changes carry the whole selection, so assigning twelve countries is one
   * operation and one undo step rather than twelve.
   */
  | { op: 'set_comparison_group'; index: number; patch: { name?: string; color?: string } }
  | { op: 'add_to_comparison'; index: number; countryIds: CountryId[] }
  | { op: 'remove_from_comparison'; index: number; countryIds: CountryId[] }

export type MapOperationType = MapOperation['op']

/**
 * Every operation the executor implements, as a runtime set.
 *
 * The `Record<MapOperationType, true>` is the point: TypeScript requires every member
 * of the union to appear, so adding an operation without listing it here — or listing
 * one that no longer exists — fails the build. Without that, a retired operation like
 * the old `set_country_color` keeps arriving, matches no case, changes nothing, and is
 * reported as a success. An assistant would have no way to tell that from a real edit.
 */
const IMPLEMENTED: Record<MapOperationType, true> = {
  set_country_value: true,
  set_country_property: true,
  set_countries_hidden: true,
  set_country_label: true,
  clear_country_value: true,
  clear_country: true,
  clear_all_countries: true,
  create_group: true,
  rename_group: true,
  delete_group: true,
  add_to_group: true,
  remove_from_group: true,
  set_group_value: true,
  set_scope_dataset: true,
  set_scope_regions: true,
  set_scope_projection: true,
  set_style: true,
  set_map_name: true,
  set_active_layer: true,
  set_layer: true,
  set_active_palette: true,
  set_active_preset: true,
  set_legend: true,
  set_labels: true,
  set_caption: true,
  set_screen: true,
  create_merge: true,
  update_merge: true,
  delete_merge: true,
  set_flags: true,
  set_comparison: true,
  set_comparison_group: true,
  add_to_comparison: true,
  remove_from_comparison: true,
}

export const KNOWN_OPERATIONS = new Set<string>(Object.keys(IMPLEMENTED))

/**
 * Operations that make an undo step.
 *
 * Undo is for the map's authored content — what a country is worth, what colour it
 * was painted, which groups exist and who is in them. It is deliberately not for the
 * scope, the camera or the style: changing the region or the projection recomposes
 * the view rather than editing the map, and putting those on the same stack would
 * mean Ctrl+Z sometimes moves the camera and sometimes changes the data, which is
 * the fastest way to make an undo button untrustworthy.
 */
export const UNDOABLE_OPERATIONS = new Set<MapOperationType>([
  'set_country_value',
  'set_country_property',
  'set_countries_hidden',
  'set_country_label',
  'clear_country_value',
  'clear_country',
  'clear_all_countries',
  'create_group',
  'rename_group',
  'delete_group',
  'add_to_group',
  'remove_from_group',
  'set_group_value',
  'set_map_name',
  'set_layer',
  'set_active_palette',
  'set_active_preset',
  'set_legend',
  'set_labels',
  'set_caption',
  'set_screen',
  'create_merge',
  'update_merge',
  'delete_merge',
  'set_flags',
  'set_comparison',
  'set_comparison_group',
  'add_to_comparison',
  'remove_from_comparison',
])

/**
 * Identifies a run of edits that should collapse into one undo step.
 *
 * Typing "1200" into a value field dispatches four operations, and four presses of
 * Ctrl+Z to take them back is not what anyone means by undo. Operations that share a
 * key and arrive close together extend the step already on the stack instead of
 * adding to it. Operations with no key — creating a group, deleting one — always
 * stand alone.
 */
export function coalesceKey(ops: MapOperation[]): string | null {
  if (ops.length === 0) return null
  const first = ops[0]
  switch (first.op) {
    case 'set_country_value':
      // A multi-country assignment is one gesture, so it keys on the whole batch.
      return `set_country_value:${ops.map((o) => ('countryId' in o ? o.countryId : '')).join(',')}`
    case 'set_country_label':
      return `set_country_label:${first.countryId}`
    case 'set_group_value':
      return `set_group_value:${first.groupId}`
    case 'rename_group':
      return `rename_group:${first.groupId}`
    /*
     * Dragging a colour picker fires continuously, so a comparison group's appearance
     * coalesces into a single step per group rather than one per frame.
     */
    case 'set_comparison_group':
      return `set_comparison_group:${first.index}`
    case 'set_map_name':
      return 'set_map_name'
    /*
     * A drag commits once, on release, so this is belt and braces — but it also means
     * nudging the legend twice in quick succession is one step rather than two.
     */
    case 'set_legend':
      return 'set_legend'
    // A drag of one edge is one gesture; the handles commit per pointermove.
    case 'set_screen':
      return 'set_screen'
    // Typing a merged entity's name is one edit, like every other text field.
    case 'update_merge':
      return `update_merge:${first.id}`
    default:
      return null
  }
}

/**
 * Operations the architecture is designed for but which are deliberately not
 * implemented in this prototype. Listed here so the vocabulary is explicit and the
 * executor rejects them with a clear reason instead of failing silently.
 */
export const PLANNED_OPERATIONS = [
  'rename_country',
  'merge_group_geometry',
  'merge_countries',
  'split_territory',
  'set_border',
  'restore_historical_borders',
  'create_territory',
  'apply_dataset',
  'create_layer',
  'set_palette',
  'generate_legend',
  'add_label',
  'export_map',
] as const

export type PlannedOperation = (typeof PLANNED_OPERATIONS)[number]

export interface OperationResult {
  op: MapOperation | { op: string; [key: string]: unknown }
  ok: boolean
  error?: string
}
