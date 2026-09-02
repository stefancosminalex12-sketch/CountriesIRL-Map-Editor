/**
 * The legend's icon element.
 *
 * A small, deliberately finite set drawn as paths rather than an icon library: the
 * legend lives inside the map's `<svg>` so that the exporter captures it for free, and
 * a font or a sprite sheet would be exactly the kind of external reference that stops
 * travelling when the file is opened somewhere else. Paths are geometry, and geometry
 * survives serialisation.
 *
 * Every icon is drawn in the same 24×24 box so the renderer can size one the way it
 * sizes type — one number, scaled — without knowing anything about which mark it is.
 */
import type { LegendIconId } from '../types/map'

export interface LegendIconPath {
  d: string
  /** Stroked rather than filled, for marks that read as line work (the globe). */
  stroke?: boolean
  /** Even-odd, for a mark with a hole punched through it (the pin). */
  evenOdd?: boolean
}

export interface LegendIcon {
  id: LegendIconId
  name: string
  paths: LegendIconPath[]
}

/** The box every path above is drawn in. */
export const ICON_VIEWBOX = 24

/** Stroke weight for line-work icons, in the 24-unit box. */
export const ICON_STROKE = 1.7

export const LEGEND_ICONS: Record<LegendIconId, LegendIcon> = {
  circle: {
    id: 'circle',
    name: 'Circle',
    paths: [{ d: 'M 12 2.9 a 9.1 9.1 0 1 0 0.01 0 Z' }],
  },
  square: {
    id: 'square',
    name: 'Square',
    paths: [{ d: 'M 3.6 3.6 h 16.8 v 16.8 h -16.8 Z' }],
  },
  diamond: {
    id: 'diamond',
    name: 'Diamond',
    paths: [{ d: 'M 12 2.2 L 21.8 12 L 12 21.8 L 2.2 12 Z' }],
  },
  star: {
    id: 'star',
    name: 'Star',
    paths: [
      {
        d:
          'M 12 2.2 L 14.94 8.98 L 22.3 9.66 L 16.76 14.5 L 18.37 21.7 ' +
          'L 12 17.9 L 5.63 21.7 L 7.24 14.5 L 1.7 9.66 L 9.06 8.98 Z',
      },
    ],
  },
  pin: {
    id: 'pin',
    name: 'Map pin',
    paths: [
      {
        // Body and bowl in one path: even-odd punches the hole, so the mark reads at
        // 10px as well as at 40 without a second colour behind it.
        d:
          'M 12 2.2 C 8.0 2.2 4.8 5.4 4.8 9.4 C 4.8 14.9 12 21.9 12 21.9 ' +
          'S 19.2 14.9 19.2 9.4 C 19.2 5.4 16.0 2.2 12 2.2 Z ' +
          'M 12 6.6 a 2.9 2.9 0 1 0 0.01 0 Z',
        evenOdd: true,
      },
    ],
  },
  globe: {
    id: 'globe',
    name: 'Globe',
    paths: [
      { d: 'M 12 2.9 a 9.1 9.1 0 1 0 0.01 0', stroke: true },
      { d: 'M 12 2.9 C 7.4 7.2 7.4 16.8 12 21.1 C 16.6 16.8 16.6 7.2 12 2.9', stroke: true },
      { d: 'M 2.9 12 H 21.1', stroke: true },
    ],
  },
  flag: {
    id: 'flag',
    name: 'Flag',
    paths: [
      { d: 'M 5.4 2.6 V 21.6', stroke: true },
      { d: 'M 6.9 4.0 H 19.0 L 16.2 8.6 L 19.0 13.2 H 6.9 Z' },
    ],
  },
  compass: {
    id: 'compass',
    name: 'North arrow',
    paths: [
      { d: 'M 12 2.2 L 16.6 21.4 L 12 17.4 L 7.4 21.4 Z' },
    ],
  },
}

export const LEGEND_ICON_IDS = Object.keys(LEGEND_ICONS) as LegendIconId[]
