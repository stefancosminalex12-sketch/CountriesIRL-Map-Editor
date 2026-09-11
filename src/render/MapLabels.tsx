/**
 * The names, drawn on the territories.
 *
 * Everything hard about a label happened before this: `labelPlacement` decided where
 * each name goes, how large it is set, and where its lines break. What is left is a
 * `<text>` per entity, which is why this can be memoised — hovering a country re-renders
 * the map, and it must not re-render two hundred glyph runs to do it.
 *
 * The text lives in **projected user space**, inside the same transformed group as the
 * country paths. So panning and zooming carry the labels exactly as they carry the land,
 * at no cost and with no drift, and a name stays the same size *relative to its country*
 * at every zoom — which is what makes zooming in reveal more names rather than inflate
 * the ones already there.
 *
 * Being inside the map's `<svg>` is also what puts the labels in exports: the exporter
 * clones this element, so a name is in the PNG for the same reason the coastline is, and
 * the Screen frame crops it by being a view box over the same scene.
 */
import { memo } from 'react'
import { lineAdvance, LABEL_WEIGHT, type VisibleLabel } from './labelPlacement'
import { LABEL_FONTS, type CountryLabels } from '../types/map'

interface Props {
  /**
   * The labels this zoom draws, each at the size the layout gave it.
   *
   * The camera decides only which names are in this list — see `visibleLabels`. Nothing in
   * here re-decides anything: a name's position, size and line breaks were settled in the
   * map's own coordinates, and the camera transform on the group scales them with the land.
   */
  placements: VisibleLabel[]
  labels: CountryLabels
}

function fontStack(id: CountryLabels['font']): string {
  return (LABEL_FONTS.find((font) => font.id === id) ?? LABEL_FONTS[0]).stack
}

export const MapLabels = memo(function MapLabels({ placements, labels }: Props) {
  const family = fontStack(labels.font)

  return (
    /*
     * Inert to the pointer, all of it. A name is a caption on a country, not a second
     * thing to hit: clicking the word "France" has to select France exactly as clicking
     * the land does, and it does because the text is not there as far as hit testing is
     * concerned. This also keeps `pickCountryAt` unchanged — there is no new element for
     * it to learn about.
     */
    <g pointerEvents="none" aria-hidden="true">
      {placements.map((label) => {
        const advance = lineAdvance(label.fontSize)
        /*
         * The block is centred on the anchor, so the first baseline sits half a block
         * above it. With `dominant-baseline` centring each line on its own baseline, a
         * one-line label is unchanged and a three-line one straddles the anchor evenly —
         * which is what "centred on the territory" has to mean once a name has more than
         * one line.
         */
        const first = label.y - ((label.lines.length - 1) * advance) / 2

        return (
          <text
            key={label.id}
            x={label.x}
            y={first}
            textAnchor="middle"
            dominantBaseline="central"
            fontFamily={family}
            fontSize={label.fontSize}
            /*
             * The same weight the fitting measured the text at. A block measured semibold
             * and drawn regular would be measured for text that is never set.
             */
            fontWeight={LABEL_WEIGHT}
            fill={labels.color}
            /*
             * The outline is a stroke on the same glyphs, painted *under* the fill.
             *
             * `paint-order` is the whole trick: stroked over the fill, a heavy outline
             * eats into the letterforms from both sides and a small name closes up into a
             * blob. Under it, the stroke only ever shows outside the glyph, so the text
             * keeps its shape and gains a halo — which is what lets white type stay
             * readable over a flag, a dark ramp and pale land alike.
             *
             * Its width is a fraction of the font size rather than a fixed number, so it
             * holds the same proportion on a name of any size and at any zoom.
             */
            stroke={labels.outlineWidth > 0 ? labels.outlineColor : undefined}
            strokeWidth={labels.outlineWidth > 0 ? label.fontSize * labels.outlineWidth : undefined}
            strokeLinejoin="round"
            paintOrder="stroke"
            clipPath={label.clipId ? `url(#map-inset-${label.clipId})` : undefined}
          >
            {label.lines.map((line, index) => (
              /*
               * `x` is repeated on every line, which is what makes each one centre on the
               * anchor rather than continue from where the last one ended. Without it a
               * wrapped name staircases away to the right.
               */
              <tspan key={line + index} x={label.x} dy={index === 0 ? 0 : advance}>
                {line}
              </tspan>
            ))}
          </text>
        )
      })}
    </g>
  )
})
