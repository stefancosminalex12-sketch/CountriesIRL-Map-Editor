/**
 * Merge: making one entity out of several.
 *
 * **A group is a merged entity, from the moment it is made.** "New group" creates one —
 * nothing else does — and it is listed where it was made, the first group at the top and
 * every new one beneath the last. Choosing a group opens it for editing and selects it on
 * the map as one entity; clicking its body on the map chooses it too. Select countries or
 * regions on the map and press Add to put them in; × takes one out. Every change edits
 * the group in place, is one undo step, and redraws the merged body at once.
 *
 * The merge itself is the same `create_merge`/`update_merge` operation and the same
 * topological dissolve as ever — its own name, flag and value, one selectable, labelled,
 * exportable entity, with no border inside it.
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

/** Idle time before a typed name reaches the document. */
const NAME_COMMIT_MS = 250

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
              playSfx('click')
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
  const removeMember = useMapStore((s) => s.removeFromMerge)
  const deleteGroup = useMapStore((s) => s.deleteMerge)
  const setMergeMode = useMapStore((s) => s.setMergeMode)
  const noun = useNoun()

  /* What the last Add could not do, until the next thing the author does. */
  const [notice, setNotice] = useState<string | null>(null)

  /*
   * Merge mode is simply this panel being open — it is unmounted when the section is
   * collapsed, so mounting and unmounting is exactly the signal, with nothing to keep in
   * step. It keeps the Data section's selection card out of the way, and lets a click on a
   * merged body choose that group.
   */
  useEffect(() => {
    setMergeMode(true)
    return () => setMergeMode(false)
  }, [setMergeMode])

  const nameOf = (id: string) => geo?.meta[id]?.name ?? geo?.byId.get(id)?.properties.name ?? id

  const active = merges.find((m) => m.id === activeId) ?? null

  /* What Add would put in the chosen group: selected entities of this map in no group. */
  const mergeIds = new Set(merges.map((m) => m.id))
  const held = new Set(merges.flatMap((m) => m.members))
  const addable = active
    ? selected.filter((id) => !mergeIds.has(id) && !held.has(id) && !!geo?.byId.has(id))
    : []

  /*
   * Every entity's own flag, plus the historical set, sorted into one alphabet — the point
   * of offering them together is that the author is choosing a flag, not a category first.
   * One entry per flag, not per entity: Kosovo is in the dataset as both UNK and XKX, both
   * carrying `xk`, and two `<option>`s with one React key could lose one.
   */
  const byCode = new Map<string, string>()
  for (const extra of FLAG_EXTRAS) byCode.set(extra.code, extra.name)
  for (const meta of Object.values(geo?.meta ?? {})) {
    if (!hasFlag(meta.iso2)) continue
    const code = (meta.iso2 as string).toLowerCase()
    if (!byCode.has(code)) byCode.set(code, meta.name)
  }
  const flagOptions = [...byCode]
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="stack">
      {/* The one control that is always in the same place, and the only one that makes a group. */}
      <button
        type="button"
        className="btn"
        onClick={() => {
          createGroup()
          setNotice(null)
          playSfx('confirm')
        }}
      >
        New group
      </button>

      {/*
        One region of constant height for everything that can grow, so a group appearing or
        a member arriving never moves a control while it is being used.
      */}
      <div className="merge-scroll">
        {merges.length === 0 && (
          <p className="hint">
            Make a group, then select {noun.many} on the map and press Add.
          </p>
        )}

        {/* In creation order: the document keeps them in the order they were made. */}
        {merges.map((entity) => {
          const editing = entity.id === activeId
          return (
            <div key={entity.id} className={`merge-group${editing ? ' merge-group--on' : ''}`}>
              <div className="merge-group__head">
                <button
                  type="button"
                  className="merge-group__pick"
                  aria-expanded={editing}
                  onClick={() => {
                    setActive(editing ? null : entity.id)
                    setNotice(null)
                    playSfx('click')
                  }}
                >
                  <span className="merge-group__name">{entity.name}</span>
                  <span className="merge-group__count">{entity.members.length}</span>
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
                    setNotice(null)
                    playSfx('click')
                  }}
                >
                  ×
                </button>
              </div>

              {editing && (
                <>
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
                  <MemberList
                    members={entity.members}
                    nameOf={nameOf}
                    label={`${entity.name} members`}
                    onRemove={(id) => {
                      removeMember(entity.id, id)
                      setNotice(null)
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn--on"
                    disabled={addable.length === 0}
                    onClick={() => {
                      const { added, elsewhere } = addSelection()
                      setNotice(
                        elsewhere.length > 0
                          ? `${elsewhere.map(nameOf).join(', ')} ${elsewhere.length === 1 ? 'is' : 'are'} already in another group.`
                          : null,
                      )
                      playSfx(added.length > 0 ? 'confirm' : 'click')
                    }}
                  >
                    {addable.length === 1
                      ? `Add ${nameOf(addable[0])}`
                      : addable.length > 1
                        ? `Add ${addable.length} selected`
                        : 'Add'}
                  </button>
                  <p className="hint">
                    {notice ?? (addable.length === 0 ? `Select a ${noun.one} on the map, then press Add.` : '')}
                  </p>
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
