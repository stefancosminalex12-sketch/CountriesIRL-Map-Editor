/**
 * The caption across the top of the composition.
 *
 * A headline for the picture, and deliberately not a map label: it names what the reader
 * is looking at rather than anything on the map, so it belongs to the *frame* and not to
 * the geography. That is the whole of its positioning rule — it sits in screen space, like
 * the legend, so zooming, panning, changing projection and changing region all leave it
 * exactly where it was. A caption that drifted with the camera would be a label without a
 * territory.
 *
 * It is anchored to the resolved Screen rectangle rather than to the canvas. With no frame
 * set that rectangle *is* the canvas, so the uncomposed case needs no special handling; and
 * with a frame set the caption is at the top of the composition, which is the part that
 * gets exported. Anchoring to the canvas instead would have put it above most frames and
 * quietly dropped it from the very export it was written for.
 *
 * Being inside the map's `<svg>` is what puts it in PNG, JPG and SVG exports: the exporter
 * clones this element, and the Screen crop is a view box over the same scene.
 */
import { LABEL_FONTS, type MapCaption as CaptionConfig } from '../types/map'

interface Props {
  caption: CaptionConfig
  /** The composition frame, already resolved — the canvas when none is set. */
  frame: { x: number; y: number; width: number; height: number }
}

/** Space above the caption, in proportion to it, so large type is not cramped. */
const TOP_PAD = 0.55

function fontStack(id: CaptionConfig['font']): string {
  return (LABEL_FONTS.find((font) => font.id === id) ?? LABEL_FONTS[0]).stack
}

export function MapCaption({ caption, frame }: Props) {
  const text = caption.text.trim()
  if (!caption.enabled || !text) return null

  const size = caption.size
  const pad = Math.max(12, size * TOP_PAD)

  return (
    <text
      /*
       * Inert to the pointer. The caption sits over the map, and a click on it has to
       * select the country underneath exactly as a click beside it would — so it is not
       * there as far as hit testing is concerned, and `pickCountryAt` needs to know
       * nothing about it.
       */
      pointerEvents="none"
      x={frame.x + frame.width / 2}
      y={frame.y + pad}
      textAnchor="middle"
      /* Hanging, so the pad above is the space a reader actually sees. */
      dominantBaseline="hanging"
      fontFamily={fontStack(caption.font)}
      fontSize={size}
      fontWeight={caption.weight}
      fill={caption.color}
      /*
       * The outline is a stroke on the same glyphs painted *under* the fill, the same
       * trick the country names use: stroked over the fill a heavy outline eats into the
       * letterforms, under it the stroke only ever shows outside the glyph. It is what
       * lets one caption colour stay readable over a dark theme, a pale one and a flag.
       */
      stroke={caption.outlineWidth > 0 ? caption.outlineColor : undefined}
      strokeWidth={caption.outlineWidth > 0 ? size * caption.outlineWidth : undefined}
      strokeLinejoin="round"
      paintOrder="stroke"
    >
      {text}
    </text>
  )
}
