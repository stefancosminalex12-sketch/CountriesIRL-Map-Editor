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
import { useEffect, useRef, useState } from 'react'
import { useMapStore } from '../state/mapStore'
import { SelectField } from './Select'
import { flagOptions as allFlagOptions } from '../flags/flagChoices'
import { useNoun } from '../maps/useNoun'

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
function MemberList({ members, nameOf, onRemove, label }: {
  members: string[]
  nameOf: (id: string) => string
  onRemove: (id: string) => void
  label: string
}) {
  return (
    <ul className="merge-members" aria-label={label}>
      {members.length === 0 && <li className="merge-members__empty">No members yet.</li>}
      {members.map((id) => (
        <li key={id} className="merge-members__row">
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

export function MergeControls() {
  const merges = useMapStore((s) => s.doc.merges)
  const geo = useMapStore((s) => s.geo)
  const selected = useMapStore((s) => s.selectedCountryIds)
  const activeId = useMapStore((s) => s.activeMergeId)
  const dispatch = useMapStore((s) => s.dispatch)
  const createGroup = useMapStore((s) => s.createMergeGroup)
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

  return (
    <div className="stack">
      {/* Always in the same place. It never takes the author away from the group being edited. */}
      <button
        type="button"
        className="btn"
        onClick={() => {
          createGroup()
        }}
      >
        New group
      </button>

      {/*
        One region of constant height for everything that can grow, so a group appearing or
        a member arriving never moves a control while it is being used.
      */}
      <div className="merge-scroll">
        <p className="hint">
          {merges.length === 0
            ? `Select ${noun.many} on the map, then make a group to collect them in.`
            : activeId
              ? `Select ${noun.many} on the map and press Add to group. Merge draws the group as one ${noun.one}.`
              : 'Choose a group to add to, or make another.'}
        </p>

        {/* In creation order: the document keeps them in the order they were made. */}
        {merges.map((entity) => {
          const editing = entity.id === activeId
          const canMerge = !entity.merged && entity.members.length >= MERGE_MINIMUM
          return (
            <div key={entity.id} className={`merge-group${editing ? ' merge-group--on' : ''}`}>
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
