/**
 * Asking the sidebar to open a section, from anywhere.
 *
 * Which section is open is the sidebar's own local state, and the sections' bodies are built once
 * in its array, so nothing inside a section can reach that state directly. A window event is the
 * smallest bridge: the sidebar listens, anything may ask. Used by the built-in templates, which open
 * the section where the work they set up is done.
 */
const OPEN_SECTION = 'map-editor:open-section'

export function openSidebarSection(id: string): void {
  window.dispatchEvent(new CustomEvent<string>(OPEN_SECTION, { detail: id }))
}

/** Subscribes to open requests; returns the unsubscribe. */
export function onOpenSidebarSection(listener: (id: string) => void): () => void {
  const handle = (event: Event) => listener((event as CustomEvent<string>).detail)
  window.addEventListener(OPEN_SECTION, handle)
  return () => window.removeEventListener(OPEN_SECTION, handle)
}

/**
 * A right-click on a territory on the map: the sidebar answers with a menu of its sections, at
 * the pointer, and opens whichever is chosen. The map only says where and on what; the menu and
 * the sections are the sidebar's.
 */
export interface MapMenuRequest {
  /** The territory clicked — already in the selection, so the section opens on it. */
  entityId: string
  /** Where the pointer was, in the window. */
  x: number
  y: number
}

const OPEN_MAP_MENU = 'map-editor:open-map-menu'

export function openMapMenu(request: MapMenuRequest): void {
  window.dispatchEvent(new CustomEvent<MapMenuRequest>(OPEN_MAP_MENU, { detail: request }))
}

/** Subscribes to right-click menu requests; returns the unsubscribe. */
export function onOpenMapMenu(listener: (request: MapMenuRequest) => void): () => void {
  const handle = (event: Event) => listener((event as CustomEvent<MapMenuRequest>).detail)
  window.addEventListener(OPEN_MAP_MENU, handle)
  return () => window.removeEventListener(OPEN_MAP_MENU, handle)
}
