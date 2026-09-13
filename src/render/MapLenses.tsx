/**
 * Magnifiers for selected small entities.
 *
 * Drawn outside the zoomed group, in screen space, but anchored to the feature's
 * projected representative point — so it tracks pan, zoom, projection and region
 * changes while keeping a constant, legible size. The lens shows the feature's OWN
 * projected outline scaled up: the same path data the map draws, never a stand-in
 * symbol, and never a change to the geometry itself.
 *
 * **A lens moves with the camera that moves the map, not after it.** During a pan or a
 * pinch the canvas moves its zoomed group by writing the transform straight onto it, and
 * tells React only once the gesture is over (see the zoom behaviour in `MapCanvas`). A
 * lens placed from React's transform therefore stood still for the whole gesture while
 * the land slid away from under it, and jumped when the gesture was finally committed —
 * after d3 had waited out a wheel gesture's idle timer, and after the canvas had
 * re-rendered — so a continuous zoom left it trailing behind in a series of catch-ups.
 *
 * So the canvas hands every camera it writes onto the group to `follow`, in the same
 * call, and the lens is placed from that same camera before the frame is painted. Only
 * its position is written: nothing re-renders, nothing is re-created, and the magnified
 * shape inside the lens never depended on the camera in the first place.
 */
import { forwardRef, memo, useImperativeHandle, useRef } from 'react'
import {
  anchorScreenPosition,
  SMALL_ENTITY_LENS_OFFSET_PX,
  SMALL_ENTITY_LENS_RADIUS_PX,
  type SmallEntityAnchor,
  type Transform,
} from './smallEntities'
import type { CountryId } from '../types/map'

/** One magnifier: the feature it shows, the path it magnifies and the paint it uses. */
export interface Lens {
  anchor: SmallEntityAnchor
  d: string
  fill: string
}

/**
 * The uniform scale and offset the zoomed group is drawn through while a resize is in
 * flight — see `fitTransform` in `MapCanvas`. Null once the viewport has settled.
 */
export interface FitCorrection {
  scale: number
  dx: number
  dy: number
}

export interface MapLensesHandle {
  /** Places every lens for a camera the canvas has just written onto the map, directly. */
  follow: (camera: Transform) => void
}

interface Props {
  lenses: Lens[]
  /** The camera React last committed. A gesture's live camera arrives through `follow`. */
  transform: Transform
  fit: FitCorrection | null
  width: number
  height: number
  outline: string
  background: string
}

/**
 * Where a lens goes for this camera.
 *
 * The anchor goes through exactly what the land goes through — the camera, then the
 * resize correction the zoomed group sits inside — so the tether ends on the feature.
 * The lens then keeps its offset from the anchor, held inside the viewport.
 */
function placeLens(
  anchor: SmallEntityAnchor,
  camera: Transform,
  fit: FitCorrection | null,
  width: number,
  height: number,
) {
  let [sx, sy] = anchorScreenPosition(anchor, camera)
  if (fit) {
    sx = fit.dx + fit.scale * sx
    sy = fit.dy + fit.scale * sy
  }
  const radius = SMALL_ENTITY_LENS_RADIUS_PX
  const lensX = Math.min(
    Math.max(sx + SMALL_ENTITY_LENS_OFFSET_PX.x, radius + 2),
    Math.max(radius + 2, (width || 1) - radius - 2),
  )
  const lensY = Math.min(
    Math.max(sy + SMALL_ENTITY_LENS_OFFSET_PX.y, radius + 2),
    Math.max(radius + 2, (height || 1) - radius - 2),
  )
  return { sx, sy, lensX, lensY }
}

/** The only elements of a lens whose attributes depend on the camera. */
interface LensNodes {
  tether: SVGLineElement | null
  anchor: SVGCircleElement | null
  body: SVGGElement | null
}

export const MapLenses = memo(
  forwardRef<MapLensesHandle, Props>(function MapLenses(
    { lenses, transform, fit, width, height, outline, background },
    ref,
  ) {
    const nodes = useRef(new Map<CountryId, LensNodes>())

    /**
     * The camera a gesture has moved on to, and the committed camera it moved on from.
     *
     * It only counts while that committed camera is still the current one: when the
     * gesture is committed, or the camera is reset from anywhere else, the new transform
     * arrives as a prop and takes over. So a render in the middle of a gesture — a flag
     * finishing loading, a lens being added — draws the lens where the land is now, not
     * where the last commit left it.
     */
    const live = useRef<{ from: Transform; camera: Transform } | null>(null)
    const camera = live.current && live.current.from === transform ? live.current.camera : transform

    /** What `follow` places against: always the latest props, never a stale closure. */
    const latest = useRef({ lenses, transform, fit, width, height })
    latest.current = { lenses, transform, fit, width, height }

    useImperativeHandle(
      ref,
      () => ({
        follow(next) {
          const current = latest.current
          live.current = { from: current.transform, camera: next }
          for (const lens of current.lenses) {
            const node = nodes.current.get(lens.anchor.id)
            if (!node) continue
            const { sx, sy, lensX, lensY } = placeLens(
              lens.anchor,
              next,
              current.fit,
              current.width,
              current.height,
            )
            node.tether?.setAttribute('x1', String(sx))
            node.tether?.setAttribute('y1', String(sy))
            node.tether?.setAttribute('x2', String(lensX))
            node.tether?.setAttribute('y2', String(lensY))
            node.anchor?.setAttribute('cx', String(sx))
            node.anchor?.setAttribute('cy', String(sy))
            node.body?.setAttribute('transform', `translate(${lensX},${lensY})`)
          }
        },
      }),
      [],
    )

    const bind =
      <K extends keyof LensNodes>(id: CountryId, key: K) =>
      (element: LensNodes[K]) => {
        let entry = nodes.current.get(id)
        if (!entry) {
          entry = { tether: null, anchor: null, body: null }
          nodes.current.set(id, entry)
        }
        entry[key] = element
      }

    return (
      <>
        {lenses.map(({ anchor, d, fill }) => {
          const { sx, sy, lensX, lensY } = placeLens(anchor, camera, fit, width, height)
          const radius = SMALL_ENTITY_LENS_RADIUS_PX
          const clipId = `map-lens-${anchor.id}`

          return (
            /*
             * An editor aid inside the `<svg>`, so it is marked for the exporter to leave
             * out — a lens is not part of the map, and a PNG, JPG or SVG never shows one.
             */
            <g key={`lens-${anchor.id}`} pointerEvents="none" data-export="none">
              <defs>
                {/* In the lens body's own coordinates, so it moves with the body. */}
                <clipPath id={clipId}>
                  <circle cx={0} cy={0} r={radius - 2} />
                </clipPath>
              </defs>
              {/* tether back to where the country actually is */}
              <line
                ref={bind(anchor.id, 'tether')}
                x1={sx}
                y1={sy}
                x2={lensX}
                y2={lensY}
                stroke={outline}
                strokeWidth={1.2}
                opacity={0.8}
              />
              <circle ref={bind(anchor.id, 'anchor')} cx={sx} cy={sy} r={2.5} fill={outline} />
              {/*
                The lens itself, placed by a single translation so following the camera is
                one attribute on one element.
              */}
              <g ref={bind(anchor.id, 'body')} transform={`translate(${lensX},${lensY})`}>
                <circle
                  cx={0}
                  cy={0}
                  r={radius}
                  fill={background}
                  stroke={outline}
                  strokeWidth={2}
                />
                <g clipPath={`url(#${clipId})`}>
                  <g
                    transform={`scale(${anchor.magnification}) translate(${-anchor.lensCenterX},${-anchor.lensCenterY})`}
                  >
                    {/*
                      The lens paints the same path with the same fill, so in flags mode
                      it shows the country's flag clipped to its outline, magnified —
                      no second placement pass and no special case, because the pattern
                      is defined in the projected space this group is magnifying.
                    */}
                    <path
                      d={d}
                      fill={fill}
                      stroke={outline}
                      strokeWidth={1.2}
                      vectorEffect="non-scaling-stroke"
                    />
                  </g>
                </g>
              </g>
            </g>
          )
        })}
      </>
    )
  }),
)
