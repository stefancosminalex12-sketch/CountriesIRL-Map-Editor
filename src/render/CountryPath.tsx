/**
 * One entity's outline on the map.
 *
 * A component rather than the inline `<path>` this used to be, and memoised, for one
 * measured reason: the canvas re-renders on things that have nothing to say about any
 * particular country. Moving the pointer, selecting an entity, committing the camera at
 * the end of a pan, dragging the legend, typing in a name — each of those re-ran the
 * country loop and handed React 254 fresh host elements to diff, on the world map at
 * 10m detail where the average `d` is 39kB and Canada's is a megabyte.
 *
 * The result was measured at ~3.3ms of main-thread work to change a *single* fill
 * attribute, and 0ms of work to change nothing at all — a pointer crossing a coastline
 * cost a full reconciliation of the entire world. On a phone that is the difference
 * between a tap that feels immediate and one that does not.
 *
 * So the props are the *resolved* attribute values, not the inputs they were resolved
 * from. Nine primitives, shallow-compared: a country whose appearance did not change
 * bails out before React looks at its geometry, and the ones that did change are the
 * only ones reconciled. Nothing about what is drawn moves here — every attribute is
 * computed exactly where it was computed before, by exactly the same functions.
 */
import { memo } from 'react'

export interface CountryPathProps {
  /** The entity id, published to the DOM so the picker can resolve a hit. */
  countryId: string
  d: string
  fill: string
  /** Set only for a muted out-of-scope flag; `undefined` renders no attribute. */
  fillOpacity: number | undefined
  stroke: string
  strokeWidth: number
  /** `'stroke'` while a flag is painted, so the fill covers the border's inner half. */
  paintOrder: string | undefined
  /** An SVG transform for the path. The canvas passes none: nothing is drawn larger than it is. */
  transform: string | undefined
  clipPath: string | undefined
  /**
   * Present on a merged body, absent on a country. Carried alongside `data-country-id`
   * rather than instead of it, because the picker resolves an entity id and a merge is
   * an entity — this is only for anything that needs to tell the two apart.
   */
  mergeId?: string
}

export const CountryPath = memo(function CountryPath({
  countryId,
  d,
  fill,
  fillOpacity,
  stroke,
  strokeWidth,
  paintOrder,
  transform,
  clipPath,
  mergeId,
}: CountryPathProps) {
  return (
    <path
      d={d}
      fill={fill}
      /*
       * Out-of-scope land is drawn muted, and that distinction has to survive in flags
       * mode — but by dimming the flag rather than withholding it. Withholding was the
       * old behaviour and it meant a map of Europe drew Algeria's geography with no
       * flag at all, which reads as the mode being broken rather than as the country
       * being outside the subject.
       */
      fillOpacity={fillOpacity}
      /*
       * This one stroke is the coastline *and* the shared borders — where two countries
       * meet, each path draws its half of the same line. So hiding coastlines means not
       * stroking the paths at all, and the boundaries that were riding along with them
       * are drawn from their own network instead.
       *
       * The tone is chosen against the land, not against the fill: a pattern reference
       * is not a colour, and a flag is many colours at once, so there is nothing to
       * measure. The land is what the boundary has to separate the country from at its
       * coast.
       */
      stroke={stroke}
      strokeWidth={strokeWidth}
      /*
       * In flags mode the stroke is painted *under* the fill.
       *
       * A border is centred on the outline, so half of it lies inside the country — and
       * for anything close to the border's own width that is the whole country. Hong
       * Kong is 1.3px across at world zoom against a 0.8px border: every pixel of it
       * came out border-coloured, and the flag underneath was invisible. That reads as
       * "this country has no flag", and it is why so many island states appeared to be
       * missing one. Painting the stroke first lets the fill cover its inner half, so
       * the flag always survives and the boundary keeps its outer edge.
       */
      paintOrder={paintOrder}
      strokeLinejoin="round"
      vectorEffect="non-scaling-stroke"
      className="map-canvas__country"
      data-country-id={countryId}
      data-merge-id={mergeId}
      transform={transform}
      /*
       * Set only for an entity an inset draws. `undefined` renders no attribute at all,
       * so every path on a map without insets — which is every world map — is
       * byte-for-byte what it always was.
       */
      clipPath={clipPath}
    />
  )
})

export interface CountryCoastProps {
  /** The entity whose coast this is, published to the DOM beside `data-country-id`. */
  entityId: string
  d: string
  stroke: string
  strokeWidth: number
  transform: string | undefined
  clipPath: string | undefined
}

/**
 * One entity's coast, drawn on its own — the Coastlines layer while Borders is off.
 *
 * The stroke is the entity's own outline stroke, resolved once and handed to both (see
 * `paintCountry` in `MapCanvas`): same colour, same width, same minimum-size transform,
 * same clip. So the coast is the same line whether the outline draws it or this does, and
 * turning Borders off or on cannot change how it looks. Memoised for the same reason
 * `CountryPath` is, and inert to the pointer so hit testing still reaches the country.
 */
export const CountryCoast = memo(function CountryCoast({
  entityId,
  d,
  stroke,
  strokeWidth,
  transform,
  clipPath,
}: CountryCoastProps) {
  return (
    <path
      data-coast-of={entityId}
      d={d}
      fill="none"
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinejoin="round"
      strokeLinecap="butt"
      vectorEffect="non-scaling-stroke"
      transform={transform}
      clipPath={clipPath}
      pointerEvents="none"
    />
  )
})
