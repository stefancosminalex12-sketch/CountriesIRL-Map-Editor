/**
 * Merge: making one custom entity out of several map entities.
 *
 * The workflow is four steps and reads in order down the panel — **add a group, select
 * on the map, add selected, merge**. That is the whole change here. The mechanism
 * underneath is untouched: the same selection store, the same `create_merge` operation,
 * the same topological dissolve, the same merged entities afterwards.
 *
 * What it replaces was one button that consumed whatever happened to be selected at the
 * moment it was pressed. That made a merge something the author committed to before they
 * could see it, gave them nowhere to put a second one they were still assembling, and
 * offered no way to collect six entities in two comfortable gestures rather than one
 * careful one. A **group** is that missing middle: a numbered basket you fill, review and
 * merge when it is right.
 *
 * A group is not map content — nothing on the map is different because one exists — so it
 * lives beside the selection in the store rather than in the document. See `MergeDraft`.
 */
import { useEffect, useRef, useState } from 'react'
import { useMapStore } from '../state/mapStore'
import { playSfx } from '../audio/sfx'
import { SelectField } from './Select'
import { FLAG_EXTRAS } from '../flags/manifest'
import { hasFlag } from '../flags/flagStore'
import { useNoun } from '../maps/useNoun'

/** Sentinel for "no flag": a select cannot carry `null`. */
const NO_FLAG = ''

/** Idle time before a typed name reaches its destination. */
const NAME_COMMIT_MS = 250

/**
 * A name field that types locally and commits on a pause.
 *
 * The input is uncontrolled by its source while it has focus. That is the point: a
 * keystroke updates one piece of local state and re-renders one `<input>`, instead of
 * replacing the document and re-rendering the map with it. Used by both the group and
 * the merged entity, so the two behave identically under the hand.
 */
function NameField({
  value,
  onCommit,
  label,
}: {
  value: string
  onCommit: (next: string) => void
  label: string
}) {
  const [draft, setDraft] = useState(value)
  const timer = useRef<number | null>(null)
  const editing = useRef(false)

  // Follow the source while the author is not typing — undo, or an edit from anywhere
  // else, should show up here.
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

/** Member codes as chips — the same compact three-letter read-out as before. */
function MemberChips({
  members,
  onRemove,
  label,
}: {
  members: string[]
  onRemove?: (id: string) => void
  label: string
}) {
  return (
    <ul className="compare-members" aria-label={label}>
      {members.map((id) => (
        <li key={id} className="compare-members__item">
          {id}
          {onRemove && (
            <button
              type="button"
              className="compare-members__drop"
              aria-label={`Remove ${id}`}
              title={`Remove ${id}`}
              onClick={() => {
                onRemove(id)
                playSfx('click')
              }}
            >
              ×
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}

export function MergeControls() {
  const merges = useMapStore((s) => s.doc.merges)
  const selected = useMapStore((s) => s.selectedCountryIds)
  const geo = useMapStore((s) => s.geo)
  const dispatch = useMapStore((s) => s.dispatch)
  const noun = useNoun()

  const drafts = useMapStore((s) => s.mergeDrafts)
  const activeId = useMapStore((s) => s.activeMergeDraftId)
  const addDraft = useMapStore((s) => s.addMergeDraft)
  const setActive = useMapStore((s) => s.setActiveMergeDraft)
  const updateDraft = useMapStore((s) => s.updateMergeDraft)
  const addSelection = useMapStore((s) => s.addSelectionToMergeDraft)
  const removeMember = useMapStore((s) => s.removeFromMergeDraft)
  const deleteDraft = useMapStore((s) => s.deleteMergeDraft)
  const commitDraft = useMapStore((s) => s.commitMergeDraft)

  /*
   * Every entity's own flag, plus the historical set. Sorted by name so the list reads
   * as one alphabet rather than as two appended groups — the point of offering them
   * together is that the author is choosing a flag, not choosing a category first.
   */
  const flagOptions = [
    ...FLAG_EXTRAS.map((extra) => ({ code: extra.code, name: extra.name })),
    ...Object.entries(geo?.meta ?? {})
      .filter(([, meta]) => hasFlag(meta.iso2))
      .map(([, meta]) => ({ code: (meta.iso2 as string).toLowerCase(), name: meta.name })),
  ].sort((a, b) => a.name.localeCompare(b.name))

  const active = drafts.find((d) => d.id === activeId) ?? drafts[drafts.length - 1] ?? null
  const activeIndex = active ? drafts.findIndex((d) => d.id === active.id) : -1
  const canMerge = !!active && active.members.length >= 2

  return (
    <div className="stack">
      {/*
        Everything the author acts with stays above everything that grows.

        Add group, the group switcher, Add selected and Merge are the four things this
        panel is for, and each of the lists below them — a group's members, then the
        merged entities — grows without limit. With the actions underneath, filling a
        group would push the button that merges it off the bottom of the panel, further
        away with every entity added. Above them it never moves.
      */}
      <button
        type="button"
        className="btn"
        onClick={() => {
          addDraft()
          playSfx('confirm')
        }}
      >
        Add group
      </button>

      {drafts.length === 0 ? (
        <p className="hint">
          Add a group, tap {noun.many} on the map to select them, then add them to the
          group and merge it.
        </p>
      ) : (
        <>
          {/*
            The group switcher. Only shown once there is a choice to make: with one group
            open, a row of one tab is a control that cannot do anything.
          */}
          {drafts.length > 1 && (
            <div className="merge-tabs" role="group" aria-label="Merge groups">
              {drafts.map((draft, index) => (
                <button
                  key={draft.id}
                  type="button"
                  className={`chip${draft.id === active?.id ? ' chip--active' : ''}`}
                  aria-pressed={draft.id === active?.id}
                  onClick={() => {
                    setActive(draft.id)
                    playSfx('click')
                  }}
                >
                  {index + 1}
                  {draft.members.length > 0 && (
                    <span className="merge-tabs__count">{draft.members.length}</span>
                  )}
                </button>
              ))}
            </div>
          )}

          {active && (
            <>
              <span className="field__label">
                Group {activeIndex + 1}
                {drafts.length > 1 ? ` of ${drafts.length}` : ''}
              </span>

              <div className="merge-actions">
                <button
                  type="button"
                  className="btn"
                  disabled={selected.length === 0}
                  onClick={() => {
                    addSelection(active.id)
                    playSfx('confirm')
                  }}
                >
                  {selected.length > 0 ? `Add selected (${selected.length})` : 'Add selected'}
                </button>
                <button
                  type="button"
                  className="btn btn--on"
                  disabled={!canMerge}
                  onClick={() => {
                    commitDraft(active.id)
                    playSfx('confirm')
                  }}
                >
                  Merge
                </button>
              </div>

              {/*
                Name and flag are decided before the merge rather than after it, which is
                what lets the button above finish the job instead of starting a second
                round of editing on the thing it just made.
              */}
              <div className="field">
                <span className="field__label">{noun.One} Name</span>
                <NameField
                  value={active.name}
                  label={`Name for group ${activeIndex + 1}`}
                  onCommit={(name) => updateDraft(active.id, { name })}
                />
              </div>

              <SelectField
                label="Select Flag"
                value={active.flag ?? NO_FLAG}
                onChange={(code) => {
                  updateDraft(active.id, { flag: code === NO_FLAG ? null : code })
                  playSfx('click')
                }}
              >
                <option value={NO_FLAG}>None</option>
                {flagOptions.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.name}
                  </option>
                ))}
              </SelectField>

              {/*
                What is in the group, in the same compact code read-out the comparison
                groups use. Scrolled on its own so a group of thirty cannot push the
                merged entities below it — or the actions above it — out of reach.
              */}
              {active.members.length > 0 ? (
                <div className="selection-scroll">
                  <MemberChips
                    members={active.members}
                    label={`Group ${activeIndex + 1} members`}
                    onRemove={(id) => removeMember(active.id, id)}
                  />
                </div>
              ) : (
                <p className="hint">
                  Nothing in this group yet. Select {noun.many} on the map, then Add
                  selected.
                </p>
              )}

              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => {
                  deleteDraft(active.id)
                  playSfx('click')
                }}
              >
                Remove group
              </button>
            </>
          )}
        </>
      )}

      {merges.length > 0 && <hr className="rule" />}

      {/*
        The merged entities themselves: what each is called, what it flies, what it holds.
        Listed rather than hidden behind a selector, because the whole point of allowing
        several is that they are separate things the author can still get back to.
      */}
      {merges.map((entity) => (
        <div key={entity.id} className="merge-entity">
          <div className="field">
            <span className="field__label">{noun.One} Name</span>
            <NameField
              value={entity.name}
              label={`Name for ${entity.name}`}
              onCommit={(name) => dispatch({ op: 'update_merge', id: entity.id, patch: { name } })}
            />
          </div>

          <SelectField
            label="Select Flag"
            value={entity.flag ?? NO_FLAG}
            onChange={(code) => {
              dispatch({
                op: 'update_merge',
                id: entity.id,
                patch: { flag: code === NO_FLAG ? null : code },
              })
              playSfx('click')
            }}
          >
            <option value={NO_FLAG}>None</option>
            {flagOptions.map((option) => (
              <option key={option.code} value={option.code}>
                {option.name}
              </option>
            ))}
          </SelectField>

          <div className="selection-scroll">
            <MemberChips members={entity.members} label={`${entity.name} members`} />
          </div>

          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              // Nothing to undo but the record: the entities were never altered.
              dispatch({ op: 'delete_merge', id: entity.id })
              playSfx('click')
            }}
          >
            Remove merge
          </button>
        </div>
      ))}
    </div>
  )
}
