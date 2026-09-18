/** Factory for a blank map document. */
import { DEFAULT_ATLAS_ID, getAtlas } from '../maps/atlas'
import { buildPalettes, DEFAULT_PALETTE_ID } from './palettes'
import { DEFAULT_PRESET_ID } from './presets'
import {
  CAPTION_OUTLINE,
  CAPTION_SIZE,
  LABEL_OUTLINE,
  LABEL_SIZE,
  LEGEND_BORDER,
  LEGEND_SPACING,
} from '../types/map'
import type {
  CountryEntry,
  CountryId,
  MapDocument,
  ComparisonMode,
  MapGroup,
  MapLayer,
  Palette,
} from '../types/map'

/**
 * The palettes a new document starts with: three sequential families and one
 * diverging, each at six and nine steps. Defined in `palettes.ts` so the ramps have
 * one home and the UI, the document and the renderer cannot drift apart.
 */
export const BUILT_IN_PALETTES: Palette[] = buildPalettes()

export function createLayer(overrides: Partial<MapLayer> = {}): MapLayer {
  return {
    id: 'layer-1',
    name: 'Data layer',
    type: 'choropleth',
    visible: true,
    dataKey: 'value',
    unit: '',
    colorScale: {
      /*
       * Numeric from the start. A blank map has no values, so this colours nothing
       * until the author types a number — and then it colours immediately, which is
       * the only behaviour that makes sense of a value field. Leaving it `none` (as
       * it was while the palette UI was still being built) meant every value entered
       * on a fresh map was stored correctly and drawn as plain land, which reads
       * exactly like the value having been lost.
       */
      mode: 'numeric',
      /*
       * Which palette is active is the document's business, not the layer's — see
       * `MapDocument.activePaletteId`, which is what the renderer reads. Kept null so
       * there is one answer rather than two that can disagree; it used to name a
       * `blues` palette that no longer exists.
       */
      paletteId: null,
      // Derived from the data. See `computeDomain` — a pinned domain would defeat the
      // normalisation that makes 10…90 and 100…900 colour the same map.
      domain: null,
      categoryColors: {},
      noDataColor: null,
    },
    ...overrides,
  }
}

export function createCountryEntry(id: CountryId, overrides: Partial<CountryEntry> = {}): CountryEntry {
  return {
    id,
    label: null,
    properties: {},
    hidden: false,
    notes: null,
    ...overrides,
  }
}

export function createGroup(id: string, name: string, members: CountryId[] = []): MapGroup {
  return { id, name, members: [...new Set(members)], properties: {} }
}

/**
 * The next free group id for a document.
 *
 * Derived from the document rather than from a counter or a clock, so the same
 * document always yields the same next id. That matters because the id travels
 * inside the `create_group` operation: the operation has to say which group it made,
 * or replaying a log — or an assistant referring to the group it just created —
 * would be guessing.
 */
/**
 * The six comparison groups a document starts with, and their colours.
 *
 * Six distinct hues that hold up against each other and against the land tone, in a
 * fixed order so the same map always opens the same way. Only the first `groupCount`
 * are in play; the rest wait with their colours already chosen, so raising the count
 * never asks the author to pick a colour before they can use a group.
 *
 * The first four are unchanged, so a map made before there were six opens looking
 * exactly as it did. The two added — a teal and a warm ochre — are spaced away from
 * those four in hue rather than squeezed between them, which is what keeps six
 * distinguishable where a sixth near-blue would not be.
 */
const COMPARISON_COLORS = ['#4b8bf5', '#e8663c', '#3fa34d', '#a45bd6', '#1e9c9c', '#d29a2b']

export function createComparison(): ComparisonMode {
  return {
    enabled: false,
    groupCount: 2,
    groups: COMPARISON_COLORS.map((color, i) => ({
      id: `compare-${i + 1}`,
      name: `Group ${i + 1}`,
      color,
      members: [],
    })),
  }
}

export function nextGroupId(doc: Pick<MapDocument, 'groups'>): string {
  let highest = 0
  for (const group of doc.groups) {
    const match = /^group-(\d+)$/.exec(group.id)
    if (match) highest = Math.max(highest, Number(match[1]))
  }
  return `group-${highest + 1}`
}

/**
 * A blank document for one atlas.
 *
 * The atlas supplies its own dataset and region rather than the world's, which is what
 * makes "open the USA States map" a document for that atlas instead of a world document
 * pointed at the wrong geography. Everything else — palettes, legend, style — is the
 * same starting point for every map.
 */
export function createMapDocument(
  overrides: Partial<MapDocument> = {},
  atlasId: string = DEFAULT_ATLAS_ID,
): MapDocument {
  const atlas = getAtlas(atlasId)
  return {
    schemaVersion: 2,
    id: 'map-1',
    name: 'Untitled map',
    scope: {
      atlasId: atlas.id,
      datasetId: atlas.defaultDatasetId,
      regionIds: [...atlas.defaultRegionIds],
      projectionId: 'auto',
      padding: 32,
    },
    countries: {},
    groups: [],
    layers: [createLayer()],
    activeLayerId: 'layer-1',
    palettes: BUILT_IN_PALETTES,
    activePaletteId: DEFAULT_PALETTE_ID,
    /*
     * Which preset the threshold scale would use, held whether or not that scale is
     * the active one. Switching Palette -> Predefined -> Palette therefore returns to
     * the ramp and the preset the author last chose, and neither switch is a decision
     * about the other.
     */
    activePresetId: DEFAULT_PRESET_ID,
    comparison: createComparison(),
    // Off by default: a new map is a data map until the author says otherwise.
    flags: {
      enabled: false,
      islandWater: false,
      internationalBorders: false,
      // Off, with nobody chosen: the mode's own behaviour is every country's own flag,
      // and this is an override an author opts into.
      worldDomination: false,
      dominationCountryId: null,
      // Every country flies its own flag until told otherwise.
      overrides: {},
    },
    /*
     * Off, and empty. A caption is something an author decides to add, and a map that
     * invented a headline for itself would be putting words in their mouth. White with a
     * hairline of black behind it is the one pairing that stays legible over every theme's
     * background and over a flag, which is what "clean by default" has to mean when the
     * thing underneath is not known in advance.
     */
    caption: {
      enabled: false,
      text: '',
      font: 'system',
      size: CAPTION_SIZE.default,
      color: '#ffffff',
      weight: 600,
      outlineColor: '#000000',
      outlineWidth: CAPTION_OUTLINE.default,
    },
    /*
     * Uncomposed: the frame is the whole canvas. A map that has never had a Screen set
     * therefore frames and exports exactly as it did before the frame existed.
     */
    screen: { enabled: false, rect: null, aspect: null },
    // Nothing merged: every country is its own entity, which is the base state.
    merges: [],
    // No overlays: the map shows the map until an author puts something over it.
    overlays: [],
    // No sea is painted. The regions themselves are geography and are not stored here.
    waters: {},
    /*
     * Off by default: a map says what its author asked it to say, and 250 names is a
     * decision rather than a starting point. The appearance beneath the switch is
     * settled anyway, so turning it on is the whole of the setup — white on black is
     * the one pairing that reads over land, over a data ramp and over a flag alike.
     */
    labels: {
      enabled: false,
      color: '#ffffff',
      outlineColor: '#000000',
      font: 'system',
      size: LABEL_SIZE.default,
      outlineWidth: LABEL_OUTLINE.default,
    },
    legend: {
      /*
       * On by default, but only *shown* when the active mode has something to
       * explain — `buildLegendModel` returns null for colouring that is off, or for
       * a numeric scale with no values yet. So a blank map stays blank and the
       * legend appears the moment the first value does.
       */
      visible: true,
      // Empty means "take the title from whatever is being explained": the layer's
      // name, the preset's name, or "Comparison".
      title: '',
      // Shown, so a legend looks exactly as it always has until someone turns it off.
      showTitle: true,
      subtitle: '',
      // Bottom-left, out of the way of the zoom controls in the top-right.
      anchor: { x: 0, y: 1 },
      source: 'auto',
      entries: [],
      style: 'classic',
      // The same face the country names use, so the map has one type palette.
      font: 'system',
      // Null throughout: the style paints the panel until an author says otherwise.
      surface: null,
      ink: null,
      border: null,
      borderWidth: LEGEND_BORDER.default,
      spacing: LEGEND_SPACING.default,
      // Sizes itself to its content until the author drags the corner or sets a size.
      size: null,
      // Both empty: the free line and the icon are additions the author opts into, and
      // a legend that invents either would be putting words on their map.
      text: '',
      icon: null,
      // 1 means "whatever the style asks for", so a new map opens in the proportions
      // the style was designed with.
      sizes: { title: 1, subtitle: 1, text: 1, icon: 1, items: 1 },
    },
    geoEdits: [],
    style: {
      background: '#12161c',
      land: '#2c333d',
      border: '#0d1116',
      borderOnDark: '#93a1b3',
      /*
       * Up from 0.6. A hairline was part of why boundaries vanished, but only part:
       * the contrast fix does the heavy lifting, and this stays fine enough that a
       * dense region like the Balkans does not turn into a mesh of lines.
       */
      borderWidth: 0.8,
      legendSurface: '#22272f',
      legendText: '#e2e6ec',
      hover: '#3d4855',
      selected: '#4c8fbd',
      selectedOutline: '#a8d3f0',
      outsideScope: 'muted',
      outsideScopeColor: '#1c2128',
      showBorders: true,
      // On, so the map looks exactly as it always has until someone turns it off.
      showCoastlines: true,
      showGraticule: false,
      showLakes: true,
      lake: '#22303d',
      lakeOutline: '#1a252f',
      /*
       * Off. Unlike the lakes, a full river network is a lot of line for a map that is
       * usually about the countries — so it is there for the asking rather than by
       * default, and switching it on is one click in Display.
       */
      showRivers: false,
      river: '#3c6d8e',
      /*
       * A hair under a pixel. Rivers are drawn with a non-scaling stroke, so this is a
       * screen width that holds at every zoom rather than a ground width that would
       * thicken into a ribbon as the map comes closer.
       */
      riverWidth: 0.7,
      /*
       * Off. Water Regions adds sixteen selectable entities to the map and a megabyte of
       * geometry to fetch, and a map of countries is about the countries: it is there for the
       * asking, one click in Display, and until then the sea is the background it always was.
       */
      showWaterRegions: false,
      graticule: '#1e242c',
      showSphere: true,
    },
    ...overrides,
  }
}
