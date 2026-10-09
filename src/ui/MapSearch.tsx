/**
 * Search, in the header after undo and redo: type a territory's name, and the map goes there.
 *
 * A magnifier that opens a dropdown — the same `Popover` the File menu uses — holding the search
 * field (`EntitySearch`). Choosing a match adds it to the selection and centres the map on it
 * (`focusMapOn`). Added, not selected alone: a selection can be a hundred entities built tap by
 * tap, and a search must not throw it away.
 */
import { useRef, useState } from 'react'
import { focusMapOn } from '../render/mapCamera'
import { useMapStore } from '../state/mapStore'
import { EntitySearch } from './EntitySearch'
import { Popover } from './Menu'

export function MapSearch() {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const close = () => setOpen(false)

  const choose = (id: string) => {
    const store = useMapStore.getState()
    if (!store.selectedCountryIds.includes(id)) store.addToSelection([id])
    focusMapOn(id)
    close()
  }

  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="btn btn--icon"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Search"
        title="Search the map"
        onClick={() => setOpen(!open)}
      >
        <svg
          viewBox="0 0 16 16"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          aria-hidden="true"
          focusable="false"
        >
          <circle cx="7" cy="7" r="4.6" />
          <path d="m10.4 10.4 3.4 3.4" />
        </svg>
      </button>
      <Popover anchor={anchor} open={open} onClose={close} label="Search the map" align="end">
        <div className="map-search--popover">
          <EntitySearch onChoose={choose} autoFocus label="Territory name" />
        </div>
      </Popover>
    </>
  )
}
