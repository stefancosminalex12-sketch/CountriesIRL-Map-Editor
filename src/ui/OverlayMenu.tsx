/**
 * The menu a right-click on an overlay opens, where the overlay is: Delete, Duplicate, and its
 * Texture and Display mode, each cascading to its choices like the File menu's rows.
 *
 * Duplicate puts the copy down beside the original (`overlayBeside`), so it is plain there are
 * two, and chooses it, ready to drag. Every choice is the same operation the Overlay panel uses,
 * so each is one undo step.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMapStore } from '../state/mapStore'
import { openSidebarSection } from './sidebarEvents'
import { ChevronRight, Flyout, MenuItem } from './Menu'
import { OVERLAY_MODES, OVERLAY_TEXTURES, texturePatch } from './overlayChoices'
import type { MapOverlay } from '../types/map'
import { overlayBeside } from '../render/MapOverlays'

export interface OverlayMenuRequest {
  overlayId: string
  /** Where the pointer was, in the window. */
  x: number
  y: number
}

type Sub = 'texture' | 'mode'

export function OverlayMenu({ request, onClose }: { request: OverlayMenuRequest; onClose: () => void }) {
  const overlay = useMapStore((s) => (s.doc.overlays ?? []).find((o) => o.id === request.overlayId) ?? null)
  const dispatch = useMapStore((s) => s.dispatch)
  const panel = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const [sub, setSub] = useState<{ id: Sub; row: HTMLElement } | null>(null)

  useLayoutEffect(() => {
    const width = panel.current?.offsetWidth ?? 200
    const height = panel.current?.offsetHeight ?? 160
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
    window.addEventListener('wheel', onClose, { passive: true })
    return () => {
      window.removeEventListener('pointerdown', onPointer, true)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('wheel', onClose)
    }
  }, [onClose])

  if (!overlay) return null
  const update = (patch: Partial<MapOverlay>) => dispatch({ op: 'update_overlay', id: overlay.id, patch })

  const open = (id: Sub, row: HTMLElement) => setSub({ id, row })
  const row = (id: Sub, name: string, value: string) => (
    <button
      type="button"
      role="menuitem"
      aria-haspopup="true"
      aria-expanded={sub?.id === id}
      className={`top-menu__item top-file__row${sub?.id === id ? ' top-file__row--open' : ''}`}
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse') open(id, event.currentTarget)
      }}
      onClick={(event) => open(id, event.currentTarget)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') open(id, event.currentTarget)
      }}
    >
      <span className="top-file__name">{name}</span>
      <span className="top-file__value">{value}</span>
      <ChevronRight />
    </button>
  )
  const plain = (name: string, onChoose: () => void, danger = false) => (
    <button
      type="button"
      role="menuitem"
      className={`top-menu__item top-file__row${danger ? ' overlay-menu__danger' : ''}`}
      onPointerEnter={() => setSub(null)}
      onClick={() => {
        onChoose()
        onClose()
      }}
    >
      <span className="top-file__name">{name}</span>
    </button>
  )

  return createPortal(
    <div
      ref={panel}
      className="top-menu overlay-menu"
      role="menu"
      aria-label={`Overlay: ${overlay.name}`}
      style={{ left: position?.left ?? -9999, top: position?.top ?? -9999 }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <span className="top-menu__heading">{overlay.name}</span>
      <div className="top-file">
        {plain('Delete', () => useMapStore.getState().deleteOverlay(overlay.id), true)}
        {plain('Duplicate', () => useMapStore.getState().duplicateOverlay(overlay.id, overlayBeside(overlay.id)))}
        {row('texture', 'Texture', OVERLAY_TEXTURES.find(([id]) => id === overlay.texture)?.[1] ?? overlay.texture)}
        {row('mode', 'Display mode', OVERLAY_MODES.find(([id]) => id === overlay.mode)?.[1] ?? overlay.mode)}
      </div>
      {sub && (
        <Flyout row={sub.row}>
          <div className="top-menu__group">
            {sub.id === 'texture'
              ? OVERLAY_TEXTURES.map(([id, label]) => (
                  <MenuItem
                    key={id}
                    name={label}
                    active={overlay.texture === id}
                    onChoose={() => {
                      const { patch, needsFlag } = texturePatch(overlay, id)
                      update(patch)
                      // No flag to fill it with yet: the Overlay panel asks for one.
                      if (needsFlag) {
                        useMapStore.getState().setActiveOverlay(overlay.id)
                        openSidebarSection('overlay')
                      }
                      onClose()
                    }}
                  />
                ))
              : OVERLAY_MODES.map(([id, label, help]) => (
                  <MenuItem
                    key={id}
                    name={label}
                    note={help}
                    active={overlay.mode === id}
                    onChoose={() => {
                      update({ mode: id })
                      onClose()
                    }}
                  />
                ))}
          </div>
        </Flyout>
      )}
    </div>,
    document.body,
  )
}
