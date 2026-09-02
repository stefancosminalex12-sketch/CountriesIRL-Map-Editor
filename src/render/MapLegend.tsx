/**
 * The map legend.
 *
 * Drawn **inside the map's `<svg>`**, in screen space, outside the zoomed group. That
 * is the load-bearing decision: an HTML overlay would be simpler to position and
 * would be missing from every PNG, JPG and SVG the exporter produces, because the
 * exporter copies the SVG and nothing else. Living in the SVG means the legend is
 * captured exactly where it appears, at no cost to the export at all.
 *
 * Being outside the zoomed group is the other half: the legend is a caption on the
 * map, not a feature of it, so panning and zooming move the geography underneath and
 * leave the caption where the author put it.
 *
 * Position is stored as a fraction of the room the legend has to move in (see
 * `LegendAnchor`), never as pixels — so a resize keeps a corner in the corner and the
 * centre in the centre.
 */
import { useEffect, useRef, useState } from 'react'
import { buildLegendModel, LEGEND_WIDTH, type LegendModel } from '../state/legend'
import { useMapStore } from '../state/mapStore'
import type {
  LegendAnchor,
  LegendElementSizes,
  LegendIconId,
  LegendSize,
  MapDocument,
} from '../types/map'
import { LEGEND_MAX_SIZE, LEGEND_MIN_SIZE } from '../types/map'
import { layoutLegend, naturalLegendSize } from '../state/legendLayout'
import { LEGEND_STYLES, resolveLegendPaint } from '../state/legendStyles'
import type { LegendStyleTokens } from '../state/legendStyles'
import type { LegendLayout, TextBlock } from '../state/legendLayout'
import { ICON_STROKE, ICON_VIEWBOX, LEGEND_ICONS } from '../state/legendIcons'

/** Clearance kept between the legend and the edge of the drawable map. */
const MARGIN = 12

/** How close a drag has to get before an alignment claims it, in pixels. */
const SNAP = 14

const FONT =
  "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"

/** Attribute the canvas checks to keep legend clicks away from country picking. */
export const LEGEND_MARKER = 'data-legend'

/** Keeps a label inside the panel without measuring glyphs. Mirrors `legend.ts`. */
function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

/** Pixels available to the legend's top-left corner on one axis. */
function travel(viewport: number, legend: number): number {
  return Math.max(0, viewport - legend - MARGIN * 2)
}

function anchorToPixels(anchor: number, viewport: number, legend: number): number {
  return MARGIN + clamp(anchor, 0, 1) * travel(viewport, legend)
}

function pixelsToAnchor(pixels: number, viewport: number, legend: number): number {
  const room = travel(viewport, legend)
  return room <= 0 ? 0 : clamp((pixels - MARGIN) / room, 0, 1)
}

/**
 * Snaps one axis to the alignments a map author actually wants.
 *
 * Three targets per axis — both edges and the centre — which between them give the
 * four corners, the two centred edges and the dead centre, without the drag ever
 * feeling magnetic: outside `SNAP` pixels the position is exactly where the pointer
 * put it. The axes snap independently, so a legend can be centred horizontally while
 * sitting at the top, which is the arrangement a corner-only rule cannot express.
 */
function snapAxis(
  pixels: number,
  viewport: number,
  legend: number,
): { value: number; centred: boolean } {
  const room = travel(viewport, legend)
  const centre = (viewport - legend) / 2
  const candidates: { value: number; centred: boolean }[] = [
    { value: MARGIN, centred: false },
    { value: MARGIN + room, centred: false },
    { value: centre, centred: true },
  ]

  let best: { value: number; centred: boolean } | null = null
  let bestDistance = SNAP
  for (const candidate of candidates) {
    const distance = Math.abs(pixels - candidate.value)
    if (distance <= bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return best ?? { value: pixels, centred: false }
}

export interface MapLegendProps {
  doc: MapDocument
  width: number
  height: number
}

export function MapLegend({ doc, width, height }: MapLegendProps) {
  const dispatch = useMapStore((s) => s.dispatch)
  const groupRef = useRef<SVGGElement>(null)

  /**
   * The live position while a drag is in flight.
   *
   * Held here rather than in the document on purpose. Dispatching per pointermove
   * would put a hundred entries on the undo stack for one gesture; the drag runs on
   * local state and commits a single operation on release, so one drag is one undo.
   */
  const [drag, setDrag] = useState<{
    pointerId: number
    grabX: number
    grabY: number
    x: number
    y: number
    snapX: boolean
    snapY: boolean
  } | null>(null)

  /**
   * The live geometry while a resize is in flight.
   *
   * Held locally for the same reason the drag is, and carrying the panel's origin as
   * well as its size: resizing from the top-right has to move the top edge while the
   * bottom-left stays exactly where it was, so the two change together.
   */
  const [resize, setResize] = useState<{
    pointerId: number
    startX: number
    startY: number
    startW: number
    startH: number
    grabX: number
    grabY: number
    size: LegendSize
    origin: { x: number; y: number }
  } | null>(null)

  const model = buildLegendModel(doc)
  const clipId = 'map-legend-clip'

  /*
   * A drag left dangling by the legend disappearing mid-gesture — the author cleared
   * the values, or switched colouring off — would otherwise keep the guides on screen
   * with nothing to move.
   */
  useEffect(() => {
    if (!model && drag) setDrag(null)
  }, [model, drag])

  if (!model || width < 2 || height < 2) return null

  const tokens = LEGEND_STYLES[doc.legend.style] ?? LEGEND_STYLES.classic
  const paint = resolveLegendPaint(tokens, doc.style)

  /*
   * The panel's size: the author's if they have resized it, otherwise whatever the
   * content needs at its natural scale. Live while a resize is in flight, for the same
   * reason the drag is — one gesture should be one undo step, not one per pointermove.
   */
  const sizes = doc.legend.sizes
  const stored = doc.legend.size
  const size =
    resize?.size ?? stored ?? naturalLegendSize(model, tokens, sizes, LEGEND_WIDTH)
  const restX = anchorToPixels(doc.legend.anchor.x, width, size.width)
  const restY = anchorToPixels(doc.legend.anchor.y, height, size.height)
  const x = resize ? resize.origin.x : drag ? drag.x : restX
  const y = resize ? resize.origin.y : drag ? drag.y : restY

  const { style } = doc

  const onPointerDown = (event: React.PointerEvent<SVGGElement>) => {
    if (event.button !== 0) return
    /*
     * Keeps the gesture on the legend even when the pointer outruns it. Guarded
     * because capture throws on a pointer id the browser no longer considers active —
     * a pointer released outside the window, say — and losing the capture is a far
     * smaller problem than losing the drag.
     */
    try {
      groupRef.current?.setPointerCapture(event.pointerId)
    } catch {
      // Capture is an enhancement; the drag works without it.
    }
    setDrag({
      pointerId: event.pointerId,
      grabX: event.clientX - x,
      grabY: event.clientY - y,
      x,
      y,
      snapX: false,
      snapY: false,
    })
  }

  const onPointerMove = (event: React.PointerEvent<SVGGElement>) => {
    if (!drag || event.pointerId !== drag.pointerId) return
    const rawX = clamp(event.clientX - drag.grabX, MARGIN, MARGIN + travel(width, size.width))
    const rawY = clamp(event.clientY - drag.grabY, MARGIN, MARGIN + travel(height, size.height))
    const sx = snapAxis(rawX, width, size.width)
    const sy = snapAxis(rawY, height, size.height)
    setDrag({ ...drag, x: sx.value, y: sy.value, snapX: sx.centred, snapY: sy.centred })
  }

  const endDrag = (event: React.PointerEvent<SVGGElement>) => {
    if (!drag || event.pointerId !== drag.pointerId) return
    try {
      groupRef.current?.releasePointerCapture?.(drag.pointerId)
    } catch {
      // Already released, or never captured.
    }
    const anchor: LegendAnchor = {
      x: pixelsToAnchor(drag.x, width, size.width),
      y: pixelsToAnchor(drag.y, height, size.height),
    }
    setDrag(null)
    // One operation, at the end of the gesture: one undo step for one drag.
    if (anchor.x !== doc.legend.anchor.x || anchor.y !== doc.legend.anchor.y) {
      dispatch({ op: 'set_legend', patch: { anchor } })
    }
  }

  /*
   * Resizing, from the top-right corner.
   *
   * The bottom-left is the fixed point: width grows to the right, height grows upward,
   * so the corner the author is not holding does not move. That is why the origin is
   * recomputed here rather than left to the anchor — the anchor is resolved against the
   * size, so changing the size without moving the origin would slide the panel.
   */
  const onResizeDown = (event: React.PointerEvent<SVGRectElement>) => {
    if (event.button !== 0) return
    event.stopPropagation()
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Capture is an enhancement; the gesture works without it.
    }
    setResize({
      pointerId: event.pointerId,
      startX: x,
      startY: y,
      startW: size.width,
      startH: size.height,
      grabX: event.clientX,
      grabY: event.clientY,
      size: { width: size.width, height: size.height },
      origin: { x, y },
    })
  }

  const onResizeMove = (event: React.PointerEvent<SVGRectElement>) => {
    if (!resize || event.pointerId !== resize.pointerId) return
    event.stopPropagation()
    const nextW = clamp(
      resize.startW + (event.clientX - resize.grabX),
      LEGEND_MIN_SIZE.width,
      LEGEND_MAX_SIZE.width,
    )
    const nextH = clamp(
      resize.startH - (event.clientY - resize.grabY),
      LEGEND_MIN_SIZE.height,
      LEGEND_MAX_SIZE.height,
    )
    setResize({
      ...resize,
      size: { width: nextW, height: nextH },
      // Bottom edge held: the top moves by whatever the height gained.
      origin: { x: resize.startX, y: resize.startY + (resize.startH - nextH) },
    })
  }

  const endResize = (event: React.PointerEvent<SVGRectElement>) => {
    if (!resize || event.pointerId !== resize.pointerId) return
    event.stopPropagation()
    try {
      event.currentTarget.releasePointerCapture?.(resize.pointerId)
    } catch {
      // Already released, or never captured.
    }
    const next = resize.size
    const anchor: LegendAnchor = {
      x: pixelsToAnchor(resize.origin.x, width, next.width),
      y: pixelsToAnchor(resize.origin.y, height, next.height),
    }
    setResize(null)
    // One operation at the end of the gesture: one undo step for one resize.
    dispatch({ op: 'set_legend', patch: { size: next, anchor } })
  }

  return (
    <>
      {/*
        Alignment guides, shown only while a centre snap is holding. They are drawn
        under the legend and never hit-tested, so they read as feedback rather than as
        map content — and they vanish the moment the drag ends.
      */}
      {drag?.snapX && (
        <line
          x1={width / 2}
          y1={0}
          x2={width / 2}
          y2={height}
          stroke={style.selectedOutline}
          strokeWidth={1}
          strokeDasharray="4 4"
          strokeOpacity={0.7}
          pointerEvents="none"
        />
      )}
      {drag?.snapY && (
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke={style.selectedOutline}
          strokeWidth={1}
          strokeDasharray="4 4"
          strokeOpacity={0.7}
          pointerEvents="none"
        />
      )}

      <g
        ref={groupRef}
        {...{ [LEGEND_MARKER]: '' }}
        className={`map-legend${drag ? ' map-legend--dragging' : ''}`}
        transform={`translate(${x},${y})`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <defs>
          <clipPath id={clipId}>
            <rect
              x={0}
              y={0}
              width={size.width}
              height={size.height}
              rx={tokens.surface.radius}
            />
          </clipPath>
        </defs>

        <rect
          x={0}
          y={0}
          width={size.width}
          height={size.height}
          rx={tokens.surface.radius}
          fill={paint.surfaceFill}
          fillOpacity={tokens.surface.fillOpacity}
          stroke={paint.surfaceStroke}
          strokeOpacity={tokens.surface.strokeOpacity}
          strokeWidth={tokens.surface.strokeWidth}
        />

        {/*
          Decoration, behind the content and clipped to the panel.

          Drawn before the body so it can never sit over a word, and derived from the
          current size so a resize re-draws it rather than stretching it.
        */}
        {tokens.decoration && (
          <g clipPath={`url(#${clipId})`} pointerEvents="none">
            {tokens
              .decoration({ width: size.width, height: size.height, ink: paint.ink })
              .paths.map((path, i) => (
                <path
                  key={i}
                  d={path.d}
                  fill={path.fill ?? 'none'}
                  stroke={path.stroke ?? 'none'}
                  strokeWidth={path.strokeWidth ?? 1}
                  strokeLinecap="round"
                  opacity={path.opacity ?? 1}
                />
              ))}
          </g>
        )}

        <LegendBody
          model={model}
          size={size}
          tokens={tokens}
          sizes={sizes}
          ink={paint.ink}
          clipId={clipId}
        />

        {/*
          The resize corner.

          A short bracket rather than a box: it has to say "this corner moves" without
          becoming a second thing to look at. The hit area is larger than the mark, and
          it stops the event so grabbing the corner never also starts a drag.

          Both the mark and its hit area are marked as chrome, because they are an
          invitation to edit rather than part of the picture — an exported map is not
          being resized by whoever opens it, so the bracket has nothing to say there.
        */}
        <g data-export="none" pointerEvents="none" opacity={resize ? 0.85 : 0.4}>
          <path
            d={`M ${size.width - 10} 3.5 L ${size.width - 3.5} 3.5 L ${size.width - 3.5} 10`}
            fill="none"
            stroke={paint.ink}
            strokeWidth={1.2}
            strokeLinecap="round"
          />
        </g>
        <rect
          className="map-legend__resize"
          data-export="none"
          x={size.width - 16}
          y={0}
          width={16}
          height={16}
          fill="transparent"
          onPointerDown={onResizeDown}
          onPointerMove={onResizeMove}
          onPointerUp={endResize}
          onPointerCancel={endResize}
        />
      </g>
    </>
  )
}

/**
 * The panel's contents.
 *
 * Draws exclusively from the resolved {@link LegendLayout} — every position and every
 * size here is a number the layout already solved against the panel's dimensions, so
 * this function contains no measuring and no fitting of its own. That separation is
 * what makes the legend one component rather than a box with contents: the layout is
 * the only thing that decides how big anything is, and it decides it from the size the
 * author gave the panel.
 *
 * One body for every style, too. What changes between Classic and Historical is the
 * numbers and colours in {@link LegendStyleTokens}, not the drawing code — so a new
 * style is an entry in that registry and nothing here, and every style gets the
 * responsive layout, the text fitting and the export for free.
 *
 * Everything is clipped to the panel. The layout reflows and then gives up lines before
 * it comes to that, but the clip is what makes "nothing escapes the legend" true
 * regardless of what the author types.
 */
function LegendBody({
  model,
  size,
  tokens,
  sizes,
  ink,
  clipId,
}: {
  model: LegendModel
  size: { width: number; height: number }
  tokens: LegendStyleTokens
  sizes: LegendElementSizes
  ink: string
  clipId: string
}) {
  const layout: LegendLayout = layoutLegend(model, tokens, sizes, size.width, size.height)

  return (
    <g clipPath={`url(#${clipId})`}>
      {layout.icon && model.icon && (
        <LegendIcon id={model.icon} box={layout.icon} ink={ink} />
      )}

      <Lines
        block={layout.title}
        ink={ink}
        weight={tokens.title.weight}
        letterSpacing={tokens.title.letterSpacing}
        keyPrefix="t"
      />
      <Lines
        block={layout.subtitle}
        ink={ink}
        opacity={tokens.subtitle.opacity}
        keyPrefix="s"
      />

      {layout.body.kind === 'ramp' && model.kind === 'ramp' ? (
        <RampBodyView body={layout.body} model={model} ink={ink} />
      ) : layout.body.kind === 'rows' && model.kind === 'rows' ? (
        <RowsBodyView body={layout.body} model={model} ink={ink} />
      ) : null}

      <Lines block={layout.note} ink={ink} opacity={tokens.note.opacity} keyPrefix="n" />
    </g>
  )
}

/** A positioned run of wrapped lines. The layout has already decided all of this. */
function Lines({
  block,
  ink,
  opacity = 1,
  weight,
  letterSpacing,
  keyPrefix,
}: {
  block: TextBlock
  ink: string
  opacity?: number
  weight?: number
  letterSpacing?: number
  keyPrefix: string
}) {
  if (block.lines.length === 0) return null
  return (
    <>
      {block.lines.map((line, i) => (
        <text
          key={`${keyPrefix}${i}`}
          x={block.x}
          y={block.baseline + block.lineHeight * i}
          fill={ink}
          fillOpacity={opacity}
          fontFamily={FONT}
          fontSize={block.size}
          fontWeight={weight}
          letterSpacing={letterSpacing === undefined ? undefined : `${letterSpacing}em`}
          pointerEvents="none"
        >
          {line}
        </text>
      ))}
    </>
  )
}

/**
 * The icon element.
 *
 * Drawn in its own 24-unit space and placed with a transform, so the paths in the
 * registry never have to know what size they are being used at. The transform scales
 * geometry the layout has already sized — it is not a substitute for the layout, which
 * is what decided the box in the first place.
 */
function LegendIcon({
  id,
  box,
  ink,
}: {
  id: LegendIconId
  box: { x: number; y: number; size: number }
  ink: string
}) {
  const icon = LEGEND_ICONS[id]
  if (!icon) return null
  const k = box.size / ICON_VIEWBOX
  return (
    <g transform={`translate(${box.x} ${box.y}) scale(${k})`} pointerEvents="none">
      {icon.paths.map((path, i) => (
        <path
          key={i}
          d={path.d}
          fill={path.stroke ? 'none' : ink}
          fillRule={path.evenOdd ? 'evenodd' : undefined}
          stroke={path.stroke ? ink : 'none'}
          strokeWidth={path.stroke ? ICON_STROKE : undefined}
          strokeLinecap={path.stroke ? 'round' : undefined}
          strokeLinejoin={path.stroke ? 'round' : undefined}
        />
      ))}
    </g>
  )
}

/**
 * The colour ramp.
 *
 * The steps divide the full inner width and the bar takes the height the layout gave
 * it, so a wider legend is a wider palette with wider steps and a taller one is a
 * taller bar — rather than the same strip with more space around it.
 */
function RampBodyView({
  body,
  model,
  ink,
}: {
  body: Extract<LegendLayout['body'], { kind: 'ramp' }>
  model: Extract<LegendModel, { kind: 'ramp' }>
  ink: string
}) {
  return (
    <>
      {model.colors.map((color, i) => (
        <rect
          key={i}
          x={body.x + i * body.stepWidth}
          y={body.y}
          // The half-unit overlap closes the hairline seam antialiasing leaves between
          // abutting rects; the last step is clipped by the panel anyway.
          width={body.stepWidth + 0.5}
          height={body.height}
          fill={color}
          pointerEvents="none"
        />
      ))}
      {body.radius > 0 && (
        <rect
          x={body.x}
          y={body.y}
          width={body.width}
          height={body.height}
          rx={Math.min(body.radius, body.height / 2)}
          fill="none"
          stroke={ink}
          strokeOpacity={0.14}
          strokeWidth={0.8}
          pointerEvents="none"
        />
      )}
      <text
        x={body.x}
        y={body.labelBaseline}
        fill={ink}
        fontFamily={FONT}
        fontSize={body.labelSize}
        fillOpacity={0.72}
        pointerEvents="none"
      >
        {model.minLabel}
      </text>
      {model.midLabel && (
        <text
          x={body.x + body.width / 2}
          y={body.labelBaseline}
          textAnchor="middle"
          fill={ink}
          fontFamily={FONT}
          fontSize={body.labelSize}
          fillOpacity={0.72}
          pointerEvents="none"
        >
          {model.midLabel}
        </text>
      )}
      <text
        x={body.x + body.width}
        y={body.labelBaseline}
        textAnchor="end"
        fill={ink}
        fontFamily={FONT}
        fontSize={body.labelSize}
        fillOpacity={0.72}
        pointerEvents="none"
      >
        {model.maxLabel}
      </text>
    </>
  )
}

/**
 * Swatch-and-label rows, as thresholds and comparison groups both use.
 *
 * The swatch size comes from the layout, where it is a proportion of the row height —
 * so growing the legend grows the colour boxes rather than spreading the same small
 * chips further apart.
 */
function RowsBodyView({
  body,
  model,
  ink,
}: {
  body: Extract<LegendLayout['body'], { kind: 'rows' }>
  model: Extract<LegendModel, { kind: 'rows' }>
  ink: string
}) {
  return (
    <>
      {model.rows.map((row, i) => {
        const cy = body.y + i * body.rowHeight + body.rowHeight / 2
        const fitted = body.labels[i]
        return (
          <g key={i} pointerEvents="none">
            <rect
              x={body.x}
              y={cy - body.swatch / 2}
              width={body.swatch}
              height={body.swatch}
              rx={body.swatchRadius}
              fill={row.color}
            />
            <text
              x={body.labelX}
              y={cy + body.labelSize * 0.35}
              fill={ink}
              fontFamily={FONT}
              fontSize={body.labelSize}
            >
              {fitted?.label ?? row.label}
            </text>
            {fitted?.detail && (
              <text
                x={body.x + body.width}
                y={cy + body.labelSize * 0.35}
                textAnchor="end"
                fill={ink}
                fontFamily={FONT}
                fontSize={body.labelSize}
                fillOpacity={0.62}
              >
                {fitted.detail}
              </text>
            )}
          </g>
        )
      })}
    </>
  )
}
