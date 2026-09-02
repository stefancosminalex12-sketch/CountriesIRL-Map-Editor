/** Dataset, projection and rendering controls. Every change goes through an operation. */
import { datasetsForAtlas } from '../geo/datasets'
import { AUTO_PROJECTION_ID, PROJECTIONS } from '../geo/projections'
import { useMapStore } from '../state/mapStore'
import { playSfx } from '../audio/sfx'
import { MapToggle } from './MapToggle'
import { SelectField } from './Select'
import type { MapStyle, ProjectionId } from '../types/map'

/**
 * What the map is *of*: which data, drawn how, and what to do with everything outside
 * the chosen region.
 *
 * Split from the display switches and the colour wells below so the sidebar can file
 * them under different headings. Same hooks and the same operations — the only thing
 * that changed is which section each control appears in.
 */
export function MapScopeSettings() {
  const scope = useMapStore((s) => s.doc.scope)
  // Only the datasets belonging to the map that is open: offering the world's 110m
  // countries while a states map is on screen would be offering to break it.
  const datasets = datasetsForAtlas(scope.atlasId)
  const style = useMapStore((s) => s.doc.style)
  const dispatch = useMapStore((s) => s.dispatch)
  const setStyle = (patch: Partial<MapStyle>) => dispatch({ op: 'set_style', patch })

  /** Changing how the map is drawn gets a short click; colours stay silent. */
  const tick = () => playSfx('click')

  return (
    <div className="stack">
      <SelectField
        label="Dataset"
        value={scope.datasetId}
        onChange={(datasetId) => {
          dispatch({ op: 'set_scope_dataset', datasetId })
          tick()
        }}
      >
        {datasets.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name} · {d.detail}
          </option>
        ))}
      </SelectField>

      <SelectField
        label="Projection"
        value={scope.projectionId}
        onChange={(value) => {
          dispatch({
            op: 'set_scope_projection',
            projectionId: value as ProjectionId | 'auto',
          })
          tick()
        }}
      >
        <option value="auto">
          Auto ({PROJECTIONS.find((p) => p.id === AUTO_PROJECTION_ID)?.name ?? 'Albers'})
        </option>
        {PROJECTIONS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </SelectField>

      <SelectField
        label="Outside the region"
        value={style.outsideScope}
        onChange={(value) => {
          setStyle({ outsideScope: value as MapStyle['outsideScope'] })
          tick()
        }}
      >
        <option value="muted">Muted</option>
        <option value="hidden">Hidden</option>
        <option value="normal">Same as in-region</option>
      </SelectField>
    </div>
  )
}

/**
 * The layers the map draws, as switches.
 *
 * The first four go through the same `set_style` operation as the rest of the panel;
 * the legend's visibility lives on the legend rather than the style, because that is
 * where every other thing about the legend already lives and splitting it across two
 * places would mean two opinions about one component.
 */
export function MapDisplayToggles() {
  const style = useMapStore((s) => s.doc.style)
  const legendVisible = useMapStore((s) => s.doc.legend.visible)
  const dispatch = useMapStore((s) => s.dispatch)
  const setStyle = (patch: Partial<MapStyle>) => dispatch({ op: 'set_style', patch })

  // `MapToggle` owns the sound, so all five behave alike.
  return (
      <div className="toggles">
        <MapToggle
          icon="borders"
          label="Borders"
          checked={style.showBorders}
          onChange={(showBorders) => setStyle({ showBorders })}
        />
        {/*
          The country outline, which is also the coast. Its own switch rather than part
          of Borders, because the single stroke the paths draw is both things at once —
          see `showCoastlines`, and the boundary network that replaces it when this is
          off.
        */}
        <MapToggle
          icon="coastline"
          label="Coastlines"
          checked={style.showCoastlines}
          onChange={(showCoastlines) => setStyle({ showCoastlines })}
        />
        <MapToggle
          icon="lakes"
          label="Lakes"
          checked={style.showLakes}
          onChange={(showLakes) => setStyle({ showLakes })}
        />
        <MapToggle
          icon="graticule"
          label="Graticule"
          checked={style.showGraticule}
          onChange={(showGraticule) => setStyle({ showGraticule })}
        />
        <MapToggle
          icon="globe"
          label="Globe outline"
          checked={style.showSphere}
          onChange={(showSphere) => setStyle({ showSphere })}
        />
        {/*
          Visibility only. What the legend *says* follows the colouring mode and is
          derived in `buildLegendModel`; this decides whether any of it is drawn, so
          switching modes never needs the toggle touched.
        */}
        <MapToggle
          icon="legend"
          label="Legend"
          checked={legendVisible}
          onChange={(visible) => dispatch({ op: 'set_legend', patch: { visible } })}
        />
      </div>
  )
}

/**
 * The base map's three colours: the water, the land and the boundaries.
 *
 * Base appearance, which means they rank below anything a visualisation mode decided —
 * a palette fill, a comparison group, a flag. See `resolveCountryFill` and
 * `resolveBorderInk`.
 */
export function MapColorSwatches() {
  const style = useMapStore((s) => s.doc.style)
  const dispatch = useMapStore((s) => s.dispatch)
  const setStyle = (patch: Partial<MapStyle>) => dispatch({ op: 'set_style', patch })

  /*
   * The label wraps the input, so the caption and the surround open the picker as well
   * as the well itself — and the container carries the focus ring, so the native input
   * never has to draw one of its own.
   */
  return (
      <div className="swatches">
        <label className="swatch">
          <input
            type="color"
            value={style.background}
            onChange={(e) => setStyle({ background: e.target.value })}
          />
          <span>Background</span>
        </label>
        <label className="swatch">
          <input type="color" value={style.land} onChange={(e) => setStyle({ land: e.target.value })} />
          <span>Land</span>
        </label>
        <label className="swatch">
          <input
            type="color"
            value={style.border}
            onChange={(e) => setStyle({ border: e.target.value })}
          />
          <span>Border</span>
        </label>
      </div>
  )
}
