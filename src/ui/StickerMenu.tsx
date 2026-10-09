/**
 * The menu a right-click on a sticker opens, at the pointer: that one sticker's colour and size,
 * putting it back in the middle of its territory, and deleting it.
 *
 * The colour row and the size are the Stickers panel's own (`ChosenSticker`), pointed at the one
 * territory wearing this sticker rather than at the selection, so they behave exactly as there —
 * a face recoloured by name, any other picture by hue, every change one undo step. Delete is the
 * panel's "take it off" (`removeOps`): a sticker placed by hand is cleared, one the data chose is
 * hidden so the data does not put it straight back. The selection is not touched.
 *
 * Closes on Delete, a press anywhere else, Escape or a resize, like every menu here.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMapStore } from '../state/mapStore'
import { ChosenSticker } from './ChosenSticker'
import { removeOps } from './useSelectionStickers'

export interface StickerMenuRequest {
  /** The territory wearing the sticker. */
  entityId: string
  /** Where the pointer was, in the window. */
  x: number
  y: number
}

export function StickerMenu({ request, onClose }: { request: StickerMenuRequest; onClose: () => void }) {
  const dispatch = useMapStore((s) => s.dispatch)
  const name = useMapStore((s) => {
    const merge = s.doc.merges.find((m) => m.id === request.entityId)
    return merge?.name || s.geo?.meta[request.entityId]?.name || request.entityId
  })
  const panel = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const width = panel.current?.offsetWidth ?? 260
    const height = panel.current?.offsetHeight ?? 300
    setPosition({
      left: Math.max(8, Math.min(request.x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(request.y, window.innerHeight - height - 8)),
    })
  }, [request])

  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node)) onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', onPointer, true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('pointerdown', onPointer, true)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={panel}
      className="top-menu sticker-menu"
      role="dialog"
      aria-label={`Sticker on ${name}`}
      style={{ left: position?.left ?? -9999, top: position?.top ?? -9999 }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <span className="top-menu__heading">{name}</span>
      <ChosenSticker only={[request.entityId]} />
      <button
        type="button"
        className="btn sticker-menu__delete"
        onClick={() => {
          dispatch(removeOps([request.entityId]))
          onClose()
        }}
      >
        Delete sticker
      </button>
    </div>,
    document.body,
  )
}
