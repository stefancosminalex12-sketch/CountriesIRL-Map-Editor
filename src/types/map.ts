/**
 * The map document model.
 *
 * This is the single source of truth for a map. Everything the renderer draws is
 * derived from a `MapDocument` plus a geographic dataset. Nothing in this file may
 * import React: the document must stay serialisable so it can be saved, undone,
 * diffed, and (later) produced/modified by AI-generated operations.
 */

/**
 * Stable identifier for one thing on the map.
 *
 * Whatever the atlas draws: a country as ISO 3166-1 alpha-3 (`USA`) or a user-assigned
 * `X..` code, a US state as ISO 3166-2 (`US-CA`), a merged body as its own generated id.
 * The namespaces cannot collide, which is what lets one editor hold a document per
 * atlas without their values ever being confused for each other.
 */
export type EntityId = string

/**
 * The same thing, under the name the country-shaped call sites use.
 *
 * Kept deliberately. Every field, operation and selector that says "country" holds an
 * entity id and always did; renaming several hundred references would be churn that
 * changes no behaviour and loses the reader's place in the git history. What matters is
 * that nothing downstream *assumes* the entity is a country, and that is a property of
 * the code, not of the identifier's name.
 */
export type CountryId = EntityId

/** A value attached to a country by the active data layer. */
export type MapValue = number | string | boolean | null

/* ------------------------------------------------------------------ palette */

export type PaletteKind = 'sequential' | 'diverging' | 'categorical'

export interface Palette {
  id: string
  name: string
  kind: PaletteKind
  /** Ordered ramp (sequential/diverging) or swatch list (categorical). */
  colors: string[]
}

/**
 * How the active layer turns values into colours.
 *
 * `numeric` and `threshold` are the two ways of reading a number and they answer
 * different questions. `numeric` normalises against the values on the map, so a
 * country's colour is its position between the lowest and the highest — relative,
 * and it moves when the data moves. `threshold` sorts the number into fixed bands
 * published with the indicator (see `state/presets.ts`), so the answer does not
 * depend on which countries are in frame. Neither reads the selection.
 */
export interface ColorScale {
  /** `none` = countries keep the land colour whatever their values say. */
  mode: 'none' | 'numeric' | 'threshold' | 'categorical'
  paletteId: string | null
  /** Numeric mode: value range. `null` = derive from the data. */
  domain: [number, number] | null
  /** Categorical mode: explicit category -> colour pinning. */
  categoryColors: Record<string, string>
  /** Used for countries with no value. */
  noDataColor: string | null
}

/* ------------------------------------------------------------------- legend */

export interface LegendEntry {
  label: string
  color: string
  /** Value or category this entry represents, when derived from data. */
  value?: MapValue
}

/**
 * Where the legend sits, as a fraction of the room it has to move in.
 *
 * Not pixels, and not a fraction of the viewport either. `0` is flush against the
 * left margin and `1` is flush against the right one, so the value is a position
 * within `viewport - legend - margins`. That is what makes a resize behave: a legend
 * parked in the bottom-right corner is at (1, 1) and stays in the corner at any
 * window size, where a viewport fraction would push it off the edge as the window
 * shrank. 0.5 is the exact centre, which is also what the centre snap writes.
 */
export interface LegendAnchor {
  x: number
  y: number
}

export interface LegendConfig {
  visible: boolean
  title: string
  /**
   * Whether the title is drawn at all.
   *
   * Separate from the title text, and deliberately so. Clearing the text does not mean
   * "no title" — an empty title means "describe yourself", and the legend falls back to
   * naming whatever it is explaining. There was therefore no way to ask for a legend
   * with no heading at all; this is that switch, and it leaves the author's words where
   * they are so turning it back on restores them.
   */
  showTitle: boolean
  /**
   * Optional second line, for a unit or a qualifier: "USD, 2024", "per 1,000".
   *
   * Deliberately its own field rather than something the author appends to the title.
   * The two are different sentences — what is being measured, and in what terms — and
   * the legend sets them differently, so folding the second into the first would
   * either lose the distinction or make the author fake it with punctuation.
   */
  subtitle: string
  /** See {@link LegendAnchor}. Replaces the old fixed corner enum. */
  anchor: LegendAnchor
  /** `auto` = derived from the active layer's scale; `manual` = author-defined. */
  source: 'auto' | 'manual'
  entries: LegendEntry[]
  /** Which look the legend takes. See `state/legendStyles.ts`. */
  style: LegendStyleId
  /** The face the whole panel is set in, shared with the country labels. */
  font: LabelFontId
  /**
   * The author's own paint, or `null` to keep whatever the chosen style decided.
   *
   * Nullable rather than resolved so that a style remains a style: picking Historical
   * still repaints the panel, and only the colours an author has actually reached for
   * survive the change. "Match style" clears all three.
   */
  surface: string | null
  ink: string | null
  border: string | null
  /** Multiplier over the style's border width; 0 removes the border. */
  borderWidth: number
  /**
   * Multiplier over the style's padding and the gaps between blocks.
   *
   * The compactness control. Everything about the legend's size is derived from those
   * two measurements, so one number takes the panel from airy to dense without any
   * layout code knowing it exists.
   */
  spacing: number
  /**
   * The panel's size, or `null` while it sizes itself to its content.
   *
   * Null until the author sets one, so a legend that has never been touched keeps
   * growing and shrinking with what it has to say — and a document written before this
   * existed opens with that same behaviour rather than a size nobody chose.
   *
   * This is the *only* record of how big the legend is. The corner drag and the width
   * and height controls both read and write it, which is what keeps them agreeing: two
   * ways of stating a size, one place it is stored.
   */
  size: LegendSize | null
  /**
   * A free line of the author's own, wrapped under the body: "Source: World Bank",
   * "2024 estimates".
   *
   * Its own element rather than something appended to the subtitle, because it is a
   * different kind of statement — the subtitle qualifies what is being measured, this
   * credits or annotates it — and the two are set differently and sized separately.
   */
  text: string
  /** A small mark beside the title, or `null` for none. See `state/legendIcons.ts`. */
  icon: LegendIconId | null
  /** See {@link LegendElementSizes}. */
  sizes: LegendElementSizes
}

/**
 * Per-element type scale, as multipliers rather than point sizes.
 *
 * A multiplier because the legend already solves a scale of its own to fill the panel
 * it has been given: these ride on top of that, so "title a bit bigger" stays true at
 * every panel size instead of being a fixed size that the fitting then overrides. 1 is
 * whatever the current style asks for, which is why every style keeps its own
 * proportions until the author says otherwise.
 */
export interface LegendElementSizes {
  title: number
  subtitle: number
  text: number
  icon: number
  /**
   * The legend's entries: the swatches and the labels beside them, and the colour bar
   * and its end labels on a ramp.
   *
   * One control rather than two because a swatch and its label are one entry — sizing
   * them apart makes a legend where the colours and the words describing them disagree
   * about how important they are, which is never what an author is reaching for.
   */
  items: number
}

/** The range the per-element size controls cover. */
export const LEGEND_ELEMENT_SIZE = { min: 0.5, max: 2.5, step: 0.05, default: 1 }

export type LegendStyleId = 'classic' | 'modern' | 'minimal' | 'historical'

/** See `state/legendIcons.ts` for the marks themselves. */
export type LegendIconId =
  | 'circle'
  | 'square'
  | 'diamond'
  | 'star'
  | 'pin'
  | 'globe'
  | 'flag'
  | 'compass'

export interface LegendSize {
  width: number
  height: number
}


/** The ranges the legend’s two new proportion controls cover. */
export const LEGEND_SPACING = { min: 0.4, max: 2, step: 0.05, default: 1 }
export const LEGEND_BORDER = { min: 0, max: 3, step: 0.1, default: 1 }

/** The range a legend may be resized within. */
export const LEGEND_MIN_SIZE = { width: 120, height: 52 }
export const LEGEND_MAX_SIZE = { width: 460, height: 420 }

/* ------------------------------------------------------------------- layers */

export type LayerType = 'choropleth' | 'labels' | 'annotation'

export interface MapLayer {
  id: string
  name: string
  type: LayerType
  visible: boolean
  /** Key inside `CountryEntry.properties` this layer reads. */
  dataKey: string
  colorScale: ColorScale
  /** Unit / suffix used when the value is rendered (e.g. "%", " years"). */
  unit: string
}

/* ---------------------------------------------------------------- countries */

/**
 * Per-country authored state. Absent countries simply have no data — the geometry
 * still comes from the dataset, so this map only stores what the author changed.
 *
 * There is deliberately no per-country colour here. Colour is decided by whichever
 * colouring mode is on — the data palette or the two-colour comparison — and a stored
 * override would outrank both, which is how a map ends up with countries that ignore
 * the palette for reasons nobody can see. What the author edits is the *value*; the
 * mode decides what that value looks like.
 */
export interface CountryEntry {
  id: CountryId
  /** Author-facing name override (real renaming is a future geo edit). */
  label: string | null
  /** Values per layer `dataKey`. */
  properties: Record<string, MapValue>
  hidden: boolean
  notes: string | null
}

/* ------------------------------------------------------------------- groups */

/**
 * A user-created collection of entities.
 *
 * Groups are an authoring structure, not geography: "Iberia" is whatever the author
 * put in it, and it exists alongside the region presets rather than inside them.
 * Membership is a list of ids and nothing more — the countries keep their own
 * geometry, their own values and their own colours, and a country may belong to as
 * many groups as the author likes. Nothing is merged; a group is a name over a set.
 *
 * `properties` is the group's own data, deliberately separate from its members'. A
 * group can carry a value that none of its members carries, and setting a member's
 * value never writes to the group or the other way round. Which of the two a future
 * colour scale reads is a question for that scale, and keeping them apart is what
 * leaves the question open.
 */
export interface MapGroup {
  id: string
  name: string
  members: CountryId[]
  /** Values per layer `dataKey`, in the same shape as a country's. */
  properties: Record<string, MapValue>
}

/* --------------------------------------------------------------- comparison */

/** How many comparison groups the panel offers, and the ceiling on `groupCount`. */
export const MAX_COMPARISON_GROUPS = 6

/**
 * One side of a comparison: a colour, a name, and the countries wearing it.
 *
 * Comparison groups are Compare's own, deliberately separate from {@link MapGroup}.
 * A `MapGroup` is a durable authoring structure that carries values and can be read by
 * a data scale; a comparison group is a colour applied to a set of countries and
 * nothing more. Folding the two together is what made the old workflow confusing —
 * countries had to be collected somewhere else, then mapped onto an A/B side here —
 * so Compare now owns its groups outright and can be used without touching anything
 * else.
 */
export interface ComparisonGroup {
  id: string
  name: string
  color: string
  members: CountryId[]
}

/**
 * Group comparison.
 *
 * A separate colouring mode from the data palettes, and deliberately so: it answers
 * "which of these" rather than "how much", reads no values at all, and picks its own
 * colours rather than sampling a ramp. Turning it on suspends the data palette instead
 * of blending with it, because a map that is simultaneously a choropleth and a
 * categorical split is neither.
 *
 * `groups` always holds {@link MAX_COMPARISON_GROUPS} of them and `groupCount` says how
 * many are in play. Showing fewer therefore never destroys anything: dropping from four
 * groups to two leaves the other two intact, with their colours and members, ready if
 * the count goes back up. Only the first `groupCount` are drawn or listed.
 *
 * Where a country is in more than one group the first in order wins, which is stated
 * here rather than left to be discovered, and is the same precedence the previous
 * side-based model used.
 */
export interface ComparisonMode {
  enabled: boolean
  /** How many groups are in play, 1..{@link MAX_COMPARISON_GROUPS}. */
  groupCount: number
  groups: ComparisonGroup[]
}

/* ------------------------------------------------------------------- flags */

/**
 * Flag overlay mode.
 *
 * A *visualisation* mode, not a theme: it decides what the map is showing, while the
 * theme decides how the map looks. Both are in force at once — flags render over the
 * active theme's land, borders, lakes and graticule, all unchanged.
 *
 * Mutually exclusive with the data scales and the comparison for the same reason
 * those are mutually exclusive with each other: a country can only carry one reading
 * at a time, and a flag over a choropleth fill is neither legible. Turning it on
 * suspends the others rather than deleting anything, so values, groups and palette
 * choices are all still there when it is turned off.
 */
export interface FlagMode {
  enabled: boolean
  /**
   * Whether an island country's maritime territory is drawn.
   *
   * Only a visibility switch over the layer that already exists — the geometry is built
   * and cached the same way regardless, so turning this on and off costs a render and
   * nothing more. Off by default: the flags on land are the mode, and the water around
   * island nations is an addition to it.
   */
  islandWater: boolean
  /**
   * Whether shared international borders get the layered pale/black/pale treatment.
   *
   * Only a visibility switch, like `islandWater`: the boundary network is derived from
   * the dataset's topology and projected regardless, so turning this on and off renders
   * differently and recomputes nothing. Off by default, which leaves the mode looking
   * exactly as it did before the treatment existed — the country paths keep their own
   * coastal border and nothing extra is drawn at all.
   */
  internationalBorders: boolean
  /**
   * One country's flag across the whole world, instead of each country's own.
   *
   * An override and nothing more. It changes what the mode *paints* and touches no
   * assignment: every country keeps the flag it has, and switching this off returns the
   * map to exactly the rendering it had a moment before, with no work to redo.
   */
  worldDomination: boolean
  /**
   * Whose flag covers the world, as a country id.
   *
   * The id rather than the flag code, so the choice is resolved through the same
   * `flagCodeFor` the rest of the mode uses — a country whose artwork comes from an
   * alias or a territory policy is picked here exactly as it is drawn there, and the
   * two can never disagree about which file a country means.
   */
  dominationCountryId: CountryId | null
  /**
   * Countries flying a flag that is not their own, as country id -> country id.
   *
   * "This country flies that country's flag", rather than a raw artwork code, for the
   * same reason `dominationCountryId` is a country: the choice is then resolved through
   * `flagCodeFor` exactly as every other flag is, so an entity whose artwork comes from
   * an alias or the territory policy is borrowed correctly rather than by guessing at a
   * filename.
   *
   * An override and nothing more. The dataset is untouched, a country with no entry here
   * flies its own flag as it always has, and removing an entry restores it.
   */
  overrides: Record<CountryId, CountryId>
}

/* -------------------------------------------------------------------- merge */

/**
 * A custom entity made by dissolving the borders between existing countries.
 *
 * Derived, never destructive: the members are recorded by id and the source dataset is
 * untouched, so deleting a merge restores exactly the countries it was made from. The
 * geometry is not stored — it is computed from the topology on demand and cached, which
 * is what keeps a merge correct across dataset resolutions rather than pinned to the one
 * it happened to be created in.
 */
export interface MergedEntity {
  id: string
  /** What the author called it, or a default derived from its members. */
  name: string
  members: CountryId[]
  /** Artwork code for Flags mode, or `null` to render as plain land. */
  flag: string | null
}

/* ------------------------------------------------------------------- screen */

/** The aspect presets the Screen offers, plus `custom` for a freely dragged frame. */
export type ScreenAspectId =
  | '1:1'
  | '9:16'
  | '16:9'
  | '4:3'
  | '3:4'
  | '2:1'
  | '1:2'
  /** No ratio held: every edge moves on its own. */
  | 'freeform'

/** The ratio presets. Freeform is not here: it holds no ratio, so it has none to list. */
export const SCREEN_ASPECTS: { id: ScreenAspectId; ratio: number }[] = [
  { id: '1:1', ratio: 1 },
  { id: '16:9', ratio: 16 / 9 },
  { id: '9:16', ratio: 9 / 16 },
  { id: '4:3', ratio: 4 / 3 },
  { id: '3:4', ratio: 3 / 4 },
  { id: '2:1', ratio: 2 },
  { id: '1:2', ratio: 0.5 },
]

/**
 * The composition frame: the part of the canvas that is the map.
 *
 * Everything inside it is the picture and is what the exporter writes; everything
 * outside is workspace. Held as a rectangle in *viewport* pixels rather than as an
 * aspect alone, because the author can drag any edge and a frame that has been dragged
 * off-centre is a composition decision, not a ratio.
 *
 * `null` means the frame is the whole canvas, which is what a map that has never been
 * composed uses — and is exactly the behaviour that existed before the frame did, so
 * an untouched document exports and frames as it always has.
 */
export interface ScreenFrame {
  /**
   * Whether the frame is in use at all.
   *
   * Its own flag rather than "a rect exists", so switching the frame off and on again
   * returns the composition the author had rather than discarding it. Off, nothing about
   * the map changes: the frame is an overlay and the map does not know it exists.
   */
  enabled: boolean
  rect: { x: number; y: number; width: number; height: number } | null
  /** The preset the rect came from, `'freeform'`, or `null` for a dragged custom size. */
  aspect: ScreenAspectId | null
}

/* ------------------------------------------------------------- geographic scope */

export type RegionId =
  | 'world'
  | 'europe'
  | 'asia'
  | 'africa'
  | 'north-america'
  | 'south-america'
  | 'oceania'
  /** The USA States atlas. Region ids are unique across atlases — see `maps/atlas.ts`. */
  | 'usa'

export type ProjectionId =
  | 'equalEarth'
  | 'naturalEarth1'
  | 'mercator'
  | 'conicEqualArea'
  | 'azimuthalEqualArea'
  | 'equirectangular'
  | 'robinson'
  | 'winkel3'
  | 'nellHammer'

/**
 * Which geography is on screen. The dataset is deliberately a reference, not the
 * geometry itself — historical datasets plug in here without touching anything else.
 */
export interface GeoScope {
  /** Which atlas this document is a map of. See `maps/atlas.ts`. */
  atlasId: string
  datasetId: string
  /** Multiple regions compose into one framing (e.g. europe + asia = Eurasia). */
  regionIds: RegionId[]
  /** `auto` picks the projection from the selected region(s). */
  projectionId: ProjectionId | 'auto'
  /** Viewport padding in px used when fitting the scope. */
  padding: number
}

/**
 * Placeholder for the future geometry-editing pipeline (merges, renames, border
 * restoration...). Kept in the document so those edits are data, not renderer state.
 */
export interface GeoEdit {
  id: string
  kind: string
  payload: Record<string, unknown>
}

/* -------------------------------------------------------------------- style */

export interface MapStyle {
  background: string
  land: string
  /**
   * The boundary line drawn over light fills.
   *
   * Two tones rather than one, because no single colour can do this job. A border has
   * to separate countries against the theme's land *and* against every stop of every
   * data palette, and those span near-black to near-white: measured as WCAG contrast,
   * the best single tone available bottoms out at 1.0–1.15:1 somewhere in each theme
   * — an invisible line. See `resolveBorderColor` in `state/colors.ts`, which picks
   * whichever of the pair contrasts with the fill actually underneath.
   */
  border: string
  /** The same line where the fill beneath is too dark for `border` to read. */
  borderOnDark: string
  borderWidth: number
  /** Legend panel fill. A map token, not a CSS variable, so exports stay standalone. */
  legendSurface: string
  /** Legend text and rules. */
  legendText: string
  hover: string
  selected: string
  selectedOutline: string
  /** How countries outside the active region are drawn. */
  outsideScope: 'muted' | 'hidden' | 'normal'
  outsideScopeColor: string
  /**
   * Whether the political borders — the lines two entities share — are drawn. Independent
   * of `showCoastlines`: turning it off leaves every coast in place.
   */
  showBorders: boolean
  /**
   * Whether the coastline — every edge with land on one side only — is drawn. Independent
   * of `showBorders`: turning it off leaves every border in place.
   *
   * A country path is stroked once, and that single stroke is both the coast and the
   * boundaries it shares with its neighbours, so it is only used when both layers are on.
   * With Borders off, each country's coast — the arcs of its outline that belong to it
   * alone — is drawn by itself with that same outline stroke, so the coast looks exactly
   * the same either way. With Coastlines off, the border network (arcs whose two sides are
   * different countries) is drawn instead. Both come from the dataset's topology, and
   * neither contains any of the other.
   */
  showCoastlines: boolean
  showGraticule: boolean
  /** Inland water bodies. A separate geographic layer, not part of any country. */
  showLakes: boolean
  lake: string
  lakeOutline: string
  /**
   * Rivers. Like lakes, a geographic layer of its own rather than part of any country.
   *
   * Drawn as lines rather than shapes, so it carries a width instead of a fill: a river
   * on a world map is a stroke whose weight is a cartographic choice, not a measurement
   * of how wide the water is.
   */
  showRivers: boolean
  river: string
  riverWidth: number
  graticule: string
  showSphere: boolean
}

/* ------------------------------------------------------------------ labels */

/** The faces a name may be set in. Real stacks, so an export resolves them too. */
export type LabelFontId = 'system' | 'sans' | 'condensed' | 'serif' | 'mono'

export const LABEL_FONTS: ReadonlyArray<{ id: LabelFontId; name: string; stack: string }> = [
  { id: 'system', name: 'System', stack: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' },
  { id: 'sans', name: 'Sans', stack: 'Helvetica Neue, Helvetica, Arial, sans-serif' },
  { id: 'condensed', name: 'Condensed', stack: 'Arial Narrow, Helvetica Neue Condensed, Arial, sans-serif' },
  { id: 'serif', name: 'Serif', stack: 'Georgia, Times New Roman, serif' },
  { id: 'mono', name: 'Mono', stack: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
]

/** What the author may set, and the range each control covers. */
export const LABEL_SIZE = { min: 0.5, max: 2.5, step: 0.05, default: 1 }
export const LABEL_OUTLINE = { min: 0, max: 0.32, step: 0.01, default: 0.14 }

/**
 * Names drawn on the territories themselves.
 *
 * Appearance only. *Where* a name goes and *how big it is* are decided from the
 * projected geometry — see `render/labelPlacement` — so nothing here can move a label
 * off its country or make one too big for the shape it sits on. What these fields do
 * is decide how the text is painted, plus a scale over the size the geometry earned.
 *
 * Which is also why changing any of them is cheap: the placement memo does not read
 * this object, so a colour, a face or a thickness re-renders the text nodes and
 * recomputes no geometry at all.
 */
export interface CountryLabels {
  enabled: boolean
  color: string
  outlineColor: string
  font: LabelFontId
  /** Multiplier over the fitted size, not an absolute size. See `LABEL_SIZE`. */
  size: number
  /** Outline width as a fraction of the font size, so it scales with the text. */
  outlineWidth: number
}


/* ----------------------------------------------------------------- caption */

/** The weights the caption may be set in. */
export const CAPTION_WEIGHTS: ReadonlyArray<{ value: number; name: string }> = [
  { value: 400, name: 'Regular' },
  { value: 600, name: 'Medium' },
  { value: 700, name: 'Bold' },
]

/** The ranges the two numeric caption controls cover. */
export const CAPTION_SIZE = { min: 12, max: 72, step: 1, default: 28 }
export const CAPTION_OUTLINE = { min: 0, max: 0.2, step: 0.01, default: 0.1 }

/**
 * A line of the author's own across the top of the composition.
 *
 * Presentation rather than geography: it says what the picture is, the way a headline
 * does, and it is not attached to any place on the map. So it lives in the same screen
 * space as the legend rather than in the projected space the countries are drawn in —
 * which is what keeps it still while the map is zoomed, panned, reprojected or reframed.
 *
 * It is anchored to the *composition* rather than to the canvas: with a Screen frame set
 * the caption sits at the top of that frame, and without one the frame is the whole
 * canvas, so the two cases are the same rule. That is what makes it reliably part of what
 * gets exported instead of something that happens to fall outside the crop.
 */
export interface MapCaption {
  enabled: boolean
  text: string
  /** The face, shared with the country labels so the map has one type palette. */
  font: LabelFontId
  /** Size in canvas pixels — screen space, so it does not scale with the camera. */
  size: number
  color: string
  weight: number
  outlineColor: string
  /** Outline width as a fraction of the size; 0 for none. */
  outlineWidth: number
}

/* ----------------------------------------------------------------- overlays */

/**
 * How an overlay follows the map when it is moved. See {@link MapOverlay}.
 *
 * - `shape`: the entity's outline exactly as the map draws it where it is, carried anywhere
 *   unchanged — the same outline at the same size, wherever it is put down.
 * - `projection`: the entity's land moved across the globe — rotated on the sphere to its new
 *   place and drawn there by the active projection, so it grows and shrinks as the land there
 *   would.
 */
export type OverlayMode = 'shape' | 'projection'

/** What an overlay is filled with, over its tint. */
export type OverlayTexture = 'hatch' | 'dots' | 'none'

/**
 * A movable copy of an entity's shape, for comparing one place with another.
 *
 * It records which entity it copies, never the geometry: the outline is worked out from the
 * map's own data every time it is drawn, so it stays exact at every resolution and in every
 * projection, and nothing about it can reach the entity it copies. Where it has been moved to
 * is a point on the globe rather than on the screen, so zooming, panning, reframing and
 * changing projection all leave it over the same place.
 */
export interface MapOverlay {
  id: string
  /** The entity copied: a country, a subdivision, a territory or a merged group. */
  sourceId: CountryId
  /** Shown in the list: the entity's name when the overlay was made. */
  name: string
  mode: OverlayMode
  /**
   * Where it has been moved to, as [longitude, latitude] — the point the centre of the entity's
   * main landmass is put on — or `null` for where it started, exactly over the entity.
   */
  anchor: [number, number] | null
  /** `#rrggbb`. */
  color: string
  /** 0–1, of the whole overlay: tint, texture and outline together. */
  opacity: number
  texture: OverlayTexture
  /**
   * Its size, as a multiple of the entity's own — within {@link OVERLAY_SCALE_RANGE}, 1 for as
   * the map draws it. Scaled about its centre, so resizing never moves it.
   */
  scale: number
}

/** How far an overlay can be shrunk and grown: from a tenth of its size to five times it. */
export const OVERLAY_SCALE_RANGE = { min: 0.1, max: 5 } as const

/* ----------------------------------------------------------------- document */

export interface MapDocument {
  /** Bumped when the shape of this model changes, for future migrations. */
  schemaVersion: number
  id: string
  name: string
  scope: GeoScope
  countries: Record<CountryId, CountryEntry>
  /** Author-created collections of countries. See {@link MapGroup}. */
  groups: MapGroup[]
  layers: MapLayer[]
  activeLayerId: string
  palettes: Palette[]
  /** Which ramp the relative (`numeric`) scale samples. */
  activePaletteId: string
  /** Which fixed-threshold preset the `threshold` scale classifies against. */
  activePresetId: string
  /** Two-colour group comparison. See {@link ComparisonMode}. */
  comparison: ComparisonMode
  /** Flag overlay. See {@link FlagMode}. */
  flags: FlagMode
  legend: LegendConfig
  /** The composition frame. See {@link ScreenFrame}. */
  screen: ScreenFrame
  /** Custom entities dissolved from countries. See {@link MergedEntity}. */
  merges: MergedEntity[]
  /** Movable copies of entities' shapes, drawn over the map. See {@link MapOverlay}. */
  overlays: MapOverlay[]
  /** Names drawn on the map. See {@link CountryLabels}. */
  labels: CountryLabels
  /** A headline across the top of the composition. See {@link MapCaption}. */
  caption: MapCaption
  geoEdits: GeoEdit[]
  style: MapStyle
}

/* ------------------------------------------------------------ ephemeral view */

/** Camera/interaction state. Not part of the document — it is not authored content. */
export interface ViewState {
  transform: { k: number; x: number; y: number }
  width: number
  height: number
}
