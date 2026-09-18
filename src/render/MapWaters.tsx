/**
 * The named oceans and seas, drawn as entities.
 *
 * Real marine polygons — Natural Earth's, prepared by `scripts/build-waters.mjs` and loaded by
 * `geo/waters.ts` — projected exactly as the land is, with a hole for every island the source
 * cuts out. Nothing here is a circle, a rectangle, a bounding box or a screen-space mask.
 *
 * **Drawn beneath every country path, always.** That ordering is the whole of the containment
 * rule, and it is the same one the maritime layer relies on: the coastlines, the islands, the
 * narrow channels and the lakes are painted over this afterwards, so a coloured sea can never
 * cover a coast and the generalisation that keeps the file to a megabyte can never show. It is
 * also what makes a selected sea read correctly without being lifted above the land — lifting
 * it would bury the islands inside it, which is the opposite of respecting the coastline.
 *
 * **Nothing is drawn for an ordinary sea.** A region with no paint and no selection is a
 * transparent shape: the map's own background water shows through it exactly as before, and
 * there is no outline, halo or border anywhere on it. What the shape does carry is
 * `pointer-events`, which is what makes the sea something the pointer can find at all — and
 * only while the layer is switched on, because with it off this component is not rendered.
 *
 * The paint is `doc.waters` and it is read here in the order `resolveCountryFill` reads a
 * country's: selection first, because selection *is* a fill on this map; then the author's
 * colour; then hover, which only ever tints what nothing else has coloured.
 */
import { memo } from 'react'
import type { WaterEntry } from '../types/map'

/** The attribute that marks a water region on the map, for hit-testing. */
export const WATER_MARKER = 'data-water-id'

/** One water region, projected. */
export interface WaterShape {
  id: string
  name: string
  d: string
}

export interface MapWatersProps {
  shapes: readonly WaterShape[]
  /** `doc.waters`: the regions an author has painted. */
  paint: Record<string, WaterEntry>
  selected: ReadonlySet<string>
  hoveredId: string | null
  /** `style.selected` — the selection colour the land uses, so one selection looks like one. */
  selectedColor: string
  /** `style.hover`. */
  hoverColor: string
}

/**
 * How strongly hover tints a sea.
 *
 * Lighter than the land's hover, which is opaque: a hover on the Pacific covers a third of the
 * map, and at full strength the whole picture flashes as the pointer crosses the sea. Enough to
 * say "this is one thing you can click", not enough to repaint the map.
 */
const HOVER_OPACITY = 0.35

export const MapWaters = memo(function MapWaters({
  shapes,
  paint,
  selected,
  hoveredId,
  selectedColor,
  hoverColor,
}: MapWatersProps) {
  return (
    <g className="map-waters">
      {shapes.map((shape) => {
        const entry = paint[shape.id]
        const isSelected = selected.has(shape.id)
        const painted = entry?.color ?? null
        const fill = isSelected ? selectedColor : (painted ?? (shape.id === hoveredId ? hoverColor : 'none'))
        const opacity = isSelected ? 1 : painted ? (entry?.opacity ?? 1) : HOVER_OPACITY

        return (
          <path
            key={shape.id}
            {...{ [WATER_MARKER]: shape.id }}
            d={shape.d}
            fill={fill}
            fillOpacity={fill === 'none' ? undefined : opacity}
            stroke="none"
            /*
             * `all`, not the default: an unpainted region is `fill="none"`, and a shape with no
             * fill is not there as far as the pointer is concerned. This is what lets a sea be
             * clicked, brushed and hovered before it has any colour — and the land drawn after
             * it still wins every point it covers, because it is drawn after it.
             */
            pointerEvents="all"
          >
            {/*
              The sea's name, for the pointer. A `<title>` rather than anything drawn: the map
              has a labels layer of its own and this is not it, and a tooltip costs no ink in
              the export.
            */}
            <title>{shape.name}</title>
          </path>
        )
      })}
    </g>
  )
})
