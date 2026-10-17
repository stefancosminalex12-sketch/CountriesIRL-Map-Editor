/**
 * Merge: collecting entities into a group, then making one entity of them.
 *
 * **A group is a container, not a merge.** Making one changes nothing on the map and needs
 * nothing selected; it can be made before choosing anything, with a selection already made, or
 * beside a group already being filled. Entities go into it only when the author presses Add to
 * group, and they are drawn as one body only when the author presses Merge. Three separate
 * acts, in whichever order suits the work:
 *
 *     select → New group → Add to group → Merge
 *     New group → select → Add to group → Merge
 *
 * Both routes are the same three buttons, and neither does anything the author did not press.
 * New group with a selection made is the first two in one: the selected go into a new group,
 * which stays closed, and the selection is cleared. Searching selects, exactly as a tap does, and
 * what is selected can also be dragged onto a group, as can a member of one group onto another.
 * This panel used to do all three at once: opening it turned every tap on the map into "add to
 * the group being edited", the first tap made a group if none existed, and a group *was* a
 * merge from the moment it existed. There was no way to gather a selection and look at it
 * first, no way to hold a group of one, and a stray tap edited a map entity.
 *
 * The map behaves here exactly as it does everywhere else: taps, the rectangle and the brush
 * select. What is selected is what Add to group puts in.
 *
 * The merge itself is the same `update_merge` operation and the same topological dissolve as
 * ever — its own name, flag and value, one selectable, labelled, exportable entity, with no
 * border inside it.
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { useMapStore } from '../state/mapStore'
import { SelectField } from './Select'
import { flagOptions as allFlagOptions } from '../flags/flagChoices'
import { useNoun } from '../maps/useNoun'
import { EntitySearch } from './EntitySearch'

/** Sentinel for "no flag": a select cannot carry `null`. */
const NO_FLAG = ''

/** Idle time before a typed name reaches the document. */
const NAME_COMMIT_MS = 250

/** Below this there is nothing to dissolve, so Merge has nothing to do. */
const MERGE_MINIMUM = 2

/**
 * A name field that types locally and commits on a pause.
 *
 * The input is uncontrolled by the document while it has focus. That is the point: a
 * keystroke updates one piece of local state and re-renders one `<input>`, instead of
 * replacing the document and re-rendering the map with it.
 */
function NameField({ value, onCommit, label }: {
  value: string
  onCommit: (next: string) => void
  label: string
}) {
  const [draft, setDraft] = useState(value)
  const timer = useRef<number | null>(null)
  const editing = useRef(false)

  useEffect(() => {
    if (!editing.current) setDraft(value)
  }, [value])

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    },
    [],
  )

  const commit = (next: string) => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    if (next !== value) onCommit(next)
  }

  return (
    <input
      className="input"
      type="text"
      value={draft}
      aria-label={label}
      onChange={(event) => {
        const next = event.target.value
        editing.current = true
        setDraft(next)
        if (timer.current !== null) window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => commit(next), NAME_COMMIT_MS)
      }}
      onBlur={(event) => {
        editing.current = false
        commit(event.target.value)
      }}
    />
  )
}

/**
 * A group's members, one per row, named, with a remove at the right.
 *
 * **The box is a fixed height, not a growing one**, so a member arriving or leaving never
 * moves the controls below it while the author is reaching for them.
 */
function MemberList({ members, nameOf, onRemove, label, startDrag }: {
  members: string[]
  nameOf: (id: string) => string
  onRemove: (id: string) => void
  label: string
  startDrag: StartDrag
}) {
  return (
    <ul className="merge-members" aria-label={label}>
      {members.length === 0 && <li className="merge-members__empty">No members yet.</li>}
      {members.map((id) => (
        <li key={id} className="merge-members__row">
          <span
            className="merge-drag-grip"
            title={`Drag ${nameOf(id)} to another group`}
            aria-hidden="true"
            onPointerDown={(event) => startDrag(event, [id], nameOf(id))}
          >
            <GripIcon />
          </span>
          <span className="merge-members__code" title={id}>
            {nameOf(id)}
          </span>
          <button
            type="button"
            className="merge-members__remove"
            aria-label={`Remove ${nameOf(id)}`}
            title={`Remove ${nameOf(id)}`}
            onClick={() => {
              onRemove(id)
            }}
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  )
}

/** Six dots: a handle that says "drag me". */
function GripIcon() {
  return (
    <svg viewBox="0 0 10 14" width="8" height="12" fill="currentColor" aria-hidden="true" focusable="false">
      <circle cx="3" cy="3" r="1.2" />
      <circle cx="7" cy="3" r="1.2" />
      <circle cx="3" cy="7" r="1.2" />
      <circle cx="7" cy="7" r="1.2" />
      <circle cx="3" cy="11" r="1.2" />
      <circle cx="7" cy="11" r="1.2" />
    </svg>
  )
}

/** Begins dragging `ids` (named `label` while they travel) from a pointer press. */
type StartDrag = (event: ReactPointerEvent, ids: string[], label: string) => void

/** Past this many pixels a press is a drag; short of it, still a click. */
const DRAG_SLOP_PX = 5

/** The group under a point, by the `data-merge-drop` its block carries. */
function groupAt(x: number, y: number): string | null {
  const element = document.elementFromPoint(x, y)
  return (element?.closest('[data-merge-drop]') as HTMLElement | null)?.dataset.mergeDrop ?? null
}

/**
 * Dragging territories onto a group: the selected ones, or a member of another group.
 *
 * Pointer events rather than the browser's drag and drop, which a phone does not have, so a
 * finger drags exactly as a mouse does. The press starts nothing until it has moved a few pixels,
 * so a click on a name is still a click. While it travels a label follows the pointer and the
 * group under it lights; let go over one and the territories move into it (`moveToMerge`).
 */
function useGroupDrag() {
  const moveToMerge = useMapStore((s) => s.moveToMerge)
  const [drag, setDrag] = useState<{ label: string; count: number; x: number; y: number; over: string | null } | null>(null)

  const start: StartDrag = (event, ids, label) => {
    if (ids.length === 0 || (event.pointerType === 'mouse' && event.button !== 0)) return
    if ((event.target as Element).closest('button')) return
    // No text selection and no browser drag of it: either would take the pointer away mid-drag.
    if (event.pointerType === 'mouse') event.preventDefault()
    const x0 = event.clientX
    const y0 = event.clientY
    let live = false
    const move = (e: PointerEvent) => {
      if (!live && Math.hypot(e.clientX - x0, e.clientY - y0) < DRAG_SLOP_PX) return
      if (!live) {
        window.getSelection()?.removeAllRanges()
        document.documentElement.classList.add('merge-dragging')
      }
      live = true
      e.preventDefault()
      setDrag({ label, count: ids.length, x: e.clientX, y: e.clientY, over: groupAt(e.clientX, e.clientY) })
    }
    const finish = (e: PointerEvent, drop: boolean) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      if (!live) return
      document.documentElement.classList.remove('merge-dragging')
      setDrag(null)
      const over = drop ? groupAt(e.clientX, e.clientY) : null
      if (over) moveToMerge(ids, over)
    }
    const up = (e: PointerEvent) => finish(e, true)
    const cancel = (e: PointerEvent) => finish(e, false)
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
  }

  const ghost = drag
    ? createPortal(
        <div className="merge-drag-ghost" style={{ left: drag.x, top: drag.y }} aria-hidden="true">
          {drag.count > 1 ? `${drag.label} (${drag.count})` : drag.label}
        </div>,
        document.body,
      )
    : null

  return { start, over: drag?.over ?? null, ghost }
}

/**
 * Search, which selects: choosing a territory adds it to the map's selection, exactly as tapping
 * it does — so New group, Add to group and a drag treat a searched territory and a tapped one the
 * same. Only what a group can take is offered: a territory of this map no group holds yet.
 */
function MergeSearch() {
  const geo = useMapStore((s) => s.geo)
  const merges = useMapStore((s) => s.doc.merges)
  const selected = useMapStore((s) => s.selectedCountryIds)
  const addToSelection = useMapStore((s) => s.addToSelection)

  const held = new Set(merges.flatMap((m) => m.members))
  const groupIds = new Set(merges.map((m) => m.id))
  const exclude = (id: string) => selected.includes(id) || held.has(id) || groupIds.has(id) || !geo?.byId.has(id)

  return <EntitySearch label="Search" placeholder="Search" exclude={exclude} onChoose={(id) => addToSelection([id])} />
}

/** Above this many, the selection's names give way to a count. */
const SELECTION_CHIPS_MAX = 24

/**
 * What is selected, as names to drag onto a group — each alone, or all of them together — with an
 * × to take one off the selection. Only what a group can take; nothing at all when nothing is.
 */
function SelectedChips({ addable, nameOf, startDrag }: { addable: string[]; nameOf: (id: string) => string; startDrag: StartDrag }) {
  const removeFromSelection = useMapStore((s) => s.removeFromSelection)
  if (addable.length === 0) return null
  const shown = addable.slice(0, SELECTION_CHIPS_MAX)
  return (
    <div className="stack merge-selected">
      <span className="field__label">Selected · drag onto a group</span>
      <ul className="pick-tabs" aria-label="Selected">
        {addable.length > 1 && (
          <li
            className="pick-tab pick-tab--all merge-draggable"
            title={`Drag all ${addable.length} onto a group`}
            onPointerDown={(event) => startDrag(event, addable, 'Selected')}
          >
            <span className="pick-tab__name">All {addable.length}</span>
          </li>
        )}
        {shown.map((id) => (
          <li key={id} className="pick-tab merge-draggable" onPointerDown={(event) => startDrag(event, [id], nameOf(id))}>
            <span className="pick-tab__name">{nameOf(id)}</span>
            <button
              type="button"
              className="pick-tab__remove"
              aria-label={`Deselect ${nameOf(id)}`}
              title={`Deselect ${nameOf(id)}`}
              onClick={() => removeFromSelection([id])}
            >
              ×
            </button>
          </li>
        ))}
        {addable.length > shown.length && <li className="pick-tab pick-tab--more">+{addable.length - shown.length} more</li>}
      </ul>
    </div>
  )
}

export function MergeControls() {
  const merges = useMapStore((s) => s.doc.merges)
  const geo = useMapStore((s) => s.geo)
  const selected = useMapStore((s) => s.selectedCountryIds)
  const activeId = useMapStore((s) => s.activeMergeId)
  const dispatch = useMapStore((s) => s.dispatch)
  const createGroup = useMapStore((s) => s.createGroupFromSelection)
  const setActive = useMapStore((s) => s.setActiveMerge)
  const addSelection = useMapStore((s) => s.addSelectionToMerge)
  const mergeGroup = useMapStore((s) => s.mergeGroup)
  const removeMember = useMapStore((s) => s.removeFromMerge)
  const deleteGroup = useMapStore((s) => s.deleteMerge)
  const noun = useNoun()

  const nameOf = (id: string) => geo?.meta[id]?.name ?? geo?.byId.get(id)?.properties.name ?? id

  /*
   * What Add to group would actually put in: entities of this map that no group holds yet. A
   * group itself is never a member of another, and an entity already in a group is drawn as
   * part of that one, so neither can be added again. Counting them here is what lets the
   * button say how many will go in, and disable itself when the answer is none.
   */
  const held = new Set(merges.flatMap((m) => m.members))
  const groupIds = new Set(merges.map((m) => m.id))
  const addable = selected.filter((id) => !groupIds.has(id) && !held.has(id) && !!geo?.byId.has(id))

  /*
   * Every flag there is to choose, sorted into one alphabet — the point of offering them together is
   * that the author is choosing a flag, not a category first. The one list the Flags panel and the
   * overlays offer too; see `flagOptions`.
   */
  const flagOptions = allFlagOptions(geo?.meta ?? {})
  const drag = useGroupDrag()

  return (
    <div className="stack">
      <MergeSearch />
      <SelectedChips addable={addable} nameOf={nameOf} startDrag={drag.start} />
      {/*
        Always in the same place. With a selection, the selected go into the new group in one
        step, the group stays closed and the selection clears; it never takes the author away
        from the group being edited.
      */}
      <button
        type="button"
        className="btn"
        title={addable.length > 0 ? `A new group of the ${addable.length} selected` : 'A new, empty group'}
        onClick={() => {
          createGroup()
        }}
      >
        {addable.length > 0 ? `New group (${addable.length})` : 'New group'}
      </button>
      {drag.ghost}

      {/*
        One region of constant height for everything that can grow, so a group appearing or
        a member arriving never moves a control while it is being used.
      */}
      <div className="merge-scroll">

        {/* In creation order: the document keeps them in the order they were made. */}
        {merges.map((entity) => {
          const editing = entity.id === activeId
          const canMerge = !entity.merged && entity.members.length >= MERGE_MINIMUM
          return (
            <div
              key={entity.id}
              data-merge-drop={entity.id}
              className={`merge-group${editing ? ' merge-group--on' : ''}${drag.over === entity.id ? ' merge-group--drop' : ''}`}
            >
              <div className="merge-group__head">
                {/* Chooses this group to edit and to add to. It never makes one. */}
                <button
                  type="button"
                  className="merge-group__pick"
                  aria-expanded={editing}
                  aria-pressed={editing}
                  onClick={() => {
                    setActive(entity.id)
                  }}
                >
                  <span className="merge-group__name">{entity.name}</span>
                  <span className="merge-group__count">{entity.members.length}</span>
                  {entity.merged && <span className="merge-group__state">merged</span>}
                  {editing && <span className="merge-group__live">editing</span>}
                </button>

                <button
                  type="button"
                  className="merge-group__drop"
                  aria-label={`Delete ${entity.name}`}
                  title="Delete group"
                  onClick={() => {
                    // Nothing to undo but the record: the entities were never altered.
                    deleteGroup(entity.id)
                  }}
                >
                  ×
                </button>
              </div>

              {editing && (
                <>
                  <div className="merge-actions">
                    {/* The selection goes in here, and only when this is pressed. */}
                    <button
                      type="button"
                      className="btn"
                      disabled={addable.length === 0}
                      title={
                        addable.length === 0
                          ? `Select ${noun.many} on the map to add them`
                          : `Add ${addable.length} selected to ${entity.name}`
                      }
                      onClick={() => {
                        addSelection(entity.id)
                      }}
                    >
                      {addable.length > 0 ? `Add to group (${addable.length})` : 'Add to group'}
                    </button>
                    {/* The merge itself: nothing before this draws the members as one. */}
                    <button
                      type="button"
                      className="btn btn--primary"
                      disabled={!canMerge}
                      title={
                        entity.merged
                          ? 'Already merged'
                          : entity.members.length < MERGE_MINIMUM
                            ? `A merge needs at least ${MERGE_MINIMUM} members`
                            : `Draw ${entity.name} as one ${noun.one}`
                      }
                      onClick={() => {
                        mergeGroup(entity.id)
                      }}
                    >
                      {entity.merged ? 'Merged' : 'Merge'}
                    </button>
                  </div>

                  <NameField
                    value={entity.name}
                    label={`Name for ${entity.name}`}
                    onCommit={(name) => dispatch({ op: 'update_merge', id: entity.id, patch: { name } })}
                  />
                  <SelectField
                    label="Flag"
                    value={entity.flag ?? NO_FLAG}
                    onChange={(code) => {
                      dispatch({
                        op: 'update_merge',
                        id: entity.id,
                        patch: { flag: code === NO_FLAG ? null : code },
                      })
                    }}
                  >
                    <option value={NO_FLAG}>None</option>
                    {flagOptions.map((option) => (
                      <option key={option.code} value={option.code}>
                        {option.name}
                      </option>
                    ))}
                  </SelectField>
                  <MemberList
                    members={entity.members}
                    nameOf={nameOf}
                    label={`${entity.name} members`}
                    onRemove={(id) => removeMember(entity.id, id)}
                    startDrag={drag.start}
                  />
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
