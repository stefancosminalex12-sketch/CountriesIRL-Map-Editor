/**
 * The composition frame's controls.
 *
 * A switch, a ratio picker and two numbers. The frame's real editing surface is its own
 * edges on the map — dragging those is how a composition actually gets made — so this
 * panel is for the decisions a drag is bad at: turning the frame on at all, naming an
 * exact ratio, typing an exact size, and asking for one derived from the region.
 */
import { useMapStore } from '../state/mapStore'
import { MAP_SVG_ID } from '../render/MapCanvas'
import { playSfx } from '../audio/sfx'
import { SCREEN_ASPECTS, type ScreenAspectId } from '../types/map'
import { fitAspect, fitRegionScreen, MIN_SCREEN } from '../render/screenFrame'
import { computeFraming } from '../geo/framing'
import { getLiveProjection } from '../render/liveProjection'
import { MapToggle } from './MapToggle'
import { Disclosure } from './Panels'

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

export function ScreenControls() {
  const screen = useMapStore((s) => s.doc.screen)
  const dispatch = useMapStore((s) => s.dispatch)
  const geo = useMapStore((s) => s.geo)
  const regionIds = useMapStore((s) => s.doc.scope.regionIds)
  const transform = useMapStore((s) => s.transform)

  /*
   * The canvas owns its own size — it measures its container — so the presets read it
   * off the live element rather than from a copy in the store that would have to be
   * kept in step with it.
   */
  const canvas = typeof document === 'undefined' ? null : document.getElementById(MAP_SVG_ID)
  const box = canvas?.getBoundingClientRect()
  const width = Math.max(1, Math.round(box?.width ?? 1))
  const height = Math.max(1, Math.round(box?.height ?? 1))
  const rect = screen.rect
  const composed = screen.enabled && rect !== null
  const freeform = composed && screen.aspect === 'freeform'

  /**
   * Taking the frame away.
   *
   * The same patch the Clear button used to send, now reached by pressing whichever
   * option is currently selected. It is the one that returns the workspace to having no
   * composition at all — not merely switched off, but with the rectangle and the ratio
   * forgotten — which is what makes the next choice start fresh rather than resume.
   */
  const remove = () => {
    dispatch({ op: 'set_screen', patch: { enabled: false, rect: null, aspect: null } })
    playSfx('toggleOff')
  }

  /**
   * Choosing a ratio, or unchoosing the one already chosen.
   *
   * Every option in this panel is the same control seen once per ratio, so the selected
   * one is the only thing that can say "no frame" — pressing it is the gesture, and a
   * separate Clear button beside it was a second way to say what the selection could
   * already say for itself.
   */
  const choose = (id: ScreenAspectId, ratio: number, active: boolean) => {
    if (active) {
      remove()
      return
    }
    dispatch({
      op: 'set_screen',
      patch: { enabled: true, rect: fitAspect(ratio, width, height), aspect: id },
    })
    playSfx('confirm')
  }

  /*
   * A frame sized to the region as it is currently drawn.
   *
   * The composition's aspect is read off the *projected* geometry rather than declared,
   * so the same continent gets a different frame under every projection — Africa tall,
   * Europe wide, Asia wide and shallow — with no continent named anywhere. The map is
   * not touched: this measures where the region already is and puts a rectangle round it.
   */
  const fitToRegion = () => {
    const projection = getLiveProjection()
    if (!projection || !geo) return

    const framing = computeFraming(regionIds, geo)
    const points: [number, number][] = []
    for (const coordinate of framing.fitTarget.coordinates) {
      const projected = projection(coordinate as [number, number])
      if (projected) points.push(projected)
    }

    const next = fitRegionScreen(points, transform, width, height)
    if (!next) return
    dispatch({ op: 'set_screen', patch: { enabled: true, rect: next, aspect: 'freeform' } })
    playSfx('confirm')
  }

  /*
   * Typing a dimension keeps the frame's top-left corner and moves the opposite edge,
   * which is what dragging that edge would have done — so the two ways of resizing agree
   * about what a size means. A typed size is a custom one, so it stops answering to a
   * ratio. Choosing a ratio re-centres instead, because a ratio is a fresh statement
   * about the composition rather than an adjustment to one.
   */
  const setSize = (next: { width?: number; height?: number }) => {
    const base = rect ?? { x: 0, y: 0, width, height }
    const w = clamp(next.width ?? base.width, MIN_SCREEN, width)
    const h = clamp(next.height ?? base.height, MIN_SCREEN, height)
    dispatch({
      op: 'set_screen',
      patch: {
        enabled: true,
        rect: {
          x: clamp(base.x, 0, width - w),
          y: clamp(base.y, 0, height - h),
          width: w,
          height: h,
        },
        aspect: 'freeform',
      },
    })
  }

  return (
    <div className="stack">
      {/*
        The frame is an overlay. Off, the map is exactly what it was — nothing about the
        projection, the zoom or the placement knows the frame exists, so switching it on
        places a frame over the composition rather than making one.
      */}
      <div className="toggles">
        <MapToggle
          icon="legend"
          label="Canvas Frame"
          checked={screen.enabled}
          onChange={(enabled) =>
            dispatch({
              op: 'set_screen',
              // Switched on with nothing composed yet, it starts from a sensible frame.
              patch:
                enabled && !screen.rect
                  ? { enabled, rect: fitAspect(16 / 9, width, height), aspect: '16:9' }
                  : { enabled },
            })
          }
        />
      </div>

      {!screen.enabled && (
        <p className="hint">Off: the whole map is the picture, and exports are uncropped.</p>
      )}

      <Disclosure title="Aspect Ratio">
      <div className="stack">
      <div className="field">
        <span className="field__row">
          <span className="field__label">Aspect</span>
          <span className="field__value">{composed ? (screen.aspect ?? 'Custom') : 'Full'}</span>
        </span>
        <div className="aspect-grid" role="group" aria-label="Canvas aspect ratio">
          {SCREEN_ASPECTS.map((preset) => {
            /*
             * Selected means *there is a frame* in this ratio, not merely that this ratio
             * was the last one named. The two come apart when the switch above is turned
             * off with a frame still remembered, and telling them apart is what this
             * control now depends on: a chip that lit up while nothing was framed would
             * offer to remove a frame that is not there.
             */
            const active = composed && screen.aspect === preset.id
            return (
              <button
                key={preset.id}
                type="button"
                className={`chip${active ? ' chip--active' : ''}`}
                aria-pressed={active}
                title={active ? `Remove the ${preset.id} frame` : `Frame ${preset.id}`}
                onClick={() => choose(preset.id, preset.ratio, active)}
              >
                {preset.id}
              </button>
            )
          })}
        </div>
      </div>

      {/*
        Freeform is not one of the presets above: it is the absence of a ratio, so
        choosing it releases the constraint rather than resizing anything. Pressing it
        while it is the selected option removes the frame, exactly as pressing a selected
        ratio does — it is an option in the same set and behaves like one.
      */}
      <button
        type="button"
        className={`btn${freeform ? ' btn--on' : ''}`}
        aria-pressed={freeform}
        onClick={() => {
          if (freeform) {
            remove()
            return
          }
          dispatch({
            op: 'set_screen',
            patch: {
              enabled: true,
              aspect: 'freeform',
              rect: screen.rect ?? fitAspect(16 / 9, width, height),
            },
          })
          playSfx('click')
        }}
      >
        Freeform
      </button>
      </div>
      </Disclosure>

      <Disclosure title="Dimensions">
      <div className="stack">
      <div className="field">
        <span className="field__row">
          <span className="field__label">Width</span>
          <input
            className="input input--compact"
            type="number"
            min={MIN_SCREEN}
            max={width}
            step={1}
            value={Math.round(rect?.width ?? width)}
            aria-label="Canvas width in pixels"
            onChange={(event) => {
              const next = Number(event.target.value)
              if (Number.isFinite(next)) setSize({ width: next })
            }}
          />
        </span>
      </div>

      <div className="field">
        <span className="field__row">
          <span className="field__label">Height</span>
          <input
            className="input input--compact"
            type="number"
            min={MIN_SCREEN}
            max={height}
            step={1}
            value={Math.round(rect?.height ?? height)}
            aria-label="Canvas height in pixels"
            onChange={(event) => {
              const next = Number(event.target.value)
              if (Number.isFinite(next)) setSize({ height: next })
            }}
          />
        </span>
      </div>

      </div>
      </Disclosure>

      {/*
        Framing: a frame measured off the region as it is drawn now. It only places a rectangle
        round what is already on screen — the map's zoom, pan, projection and geometry are never
        touched by anything in this section.
      */}
      <Disclosure title="Framing">
      <div className="stack">
      <button type="button" className="btn" onClick={fitToRegion}>
        Fit to Region
      </button>
      <p className="hint">
        {composed
          ? 'Everything inside the frame is exported. Drag inside it to move it, or its edges to resize. Press the selected ratio again to remove it.'
          : 'Choose a ratio, or fit a frame to the region on screen.'}
      </p>
      </div>
      </Disclosure>

    </div>
  )
}
