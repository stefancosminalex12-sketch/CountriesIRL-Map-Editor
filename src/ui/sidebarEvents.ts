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
