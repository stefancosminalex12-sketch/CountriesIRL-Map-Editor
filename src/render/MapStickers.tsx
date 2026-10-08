/**
 * Stickers, drawn on the territories.
 *
 * Each sticker's artwork is defined once, as a `<symbol>`, and every entity wearing it is a
 * `<use>` of that symbol. Two hundred countries wearing six faces is therefore six images the
 * browser decodes and two hundred cheap references, rather than two hundred copies of a data URI
 * in the DOM.
 *
 * Like the names, they live in projected user space inside the camera's group, so panning and
 * zooming carry them with the land and they keep their size relative to their country. Inside
 * the map's `<svg>`, so every export contains them.
 *
 * **A sticker is its own thing to click.** A click on one chooses that sticker — not the country
 * under it — for the Stickers panel to recolour, resize or swap (`activeStickerId`); the map
 * leaves such a click alone (`STICKER_MARKER`). A drag that starts on one still moves the map.
 * The chosen one is ringed on screen, never in an export (`data-export="none"`).
 */
import { memo } from 'react'
import type { Sticker } from '../stickers/types'

/** Marks a sticker on the map, with the entity wearing it: a click there is the sticker's. */
export const STICKER_MARKER = 'data-sticker-of'

export interface PlacedSticker {
  id: string
  stickerId: string
  /** Centre, in map units. */
  x: number
  y: number
  /** Edge of the square the artwork is fitted into, in map units. */
  size: number
}

interface Props {
  placements: PlacedSticker[]
  stickers: Map<string, Sticker>
  /** The entity whose sticker is chosen, ringed on screen; null for none. */
  activeId: string | null
}

export const MapStickers = memo(function MapStickers({ placements, stickers, activeId }: Props) {
  const used = [...new Set(placements.map((p) => p.stickerId))].filter((id) => stickers.has(id))
  const symbolOf = new Map(used.map((id, index) => [id, `map-sticker-${index}`]))

  return (
    <g aria-hidden="true" className="map-stickers">
      <defs>
        {used.map((id) => (
          <symbol key={id} id={symbolOf.get(id)} viewBox="0 0 100 100">
            <image href={stickers.get(id)!.src} width="100" height="100" preserveAspectRatio="xMidYMid meet" />
          </symbol>
        ))}
      </defs>
      {placements.map((p) => {
        const symbol = symbolOf.get(p.stickerId)
        if (!symbol) return null
        return (
          <use
            key={p.id}
            href={`#${symbol}`}
            x={p.x - p.size / 2}
            y={p.y - p.size / 2}
            width={p.size}
            height={p.size}
            {...{ [STICKER_MARKER]: p.id }}
            pointerEvents="visiblePainted"
            style={{ cursor: 'pointer' }}
          />
        )
      })}
      {placements
        .filter((p) => p.id === activeId)
        .map((p) => (
          <circle
            key="active"
            cx={p.x}
            cy={p.y}
            r={p.size * 0.56}
            fill="none"
            stroke="var(--accent, #2f6fe0)"
            strokeWidth={2}
            strokeDasharray="5 4"
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
            data-export="none"
          />
        ))}
    </g>
  )
})
