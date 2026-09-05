/**
 * Merge: making one entity out of several.
 *
 * **Add a group, tap entities on the map, confirm.** There is no staging step and no
 * intermediate screen: a group that is collecting takes what is tapped as it is tapped,
 * so the map is the input rather than something you gather from and then hand over.
 *
 * The merge itself is untouched — the same `create_merge` operation, the same
 * topological dissolve, the same merged entity afterwards, with its own name, flag and
 * unmerge. What changed is only how a group is filled.
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
 * The entities in a group, one per row, with the code left and its remove at the right.
 *
 * **The box is a fixed height, not a growing one.** That is the whole reason this is a
 * separate element: if it grew with its contents, every entity tapped would push the
 * groups below it — and the merged entities below those — a row further down, so the
 * control the author was reaching for would move while they were reaching for it. At a
 * fixed height the list scrolls inside itself and nothing outside it ever moves.
 */
function MemberList({ members, onRemove, label }: {
  members: string[]
  onRemove?: (id: string) => void
  label: string
}) {
  return (
    <ul className="merge-members" aria-label={label}>
      {members.length === 0 && (
        <li className="merge-members__empty">Tap on the map to add.</li>
      )}
      {members.map((id) => (
        <li key={id} className="merge-members__row">
          <span className="merge-members__code">{id}</span>
          {onRemove && (
            <button
              type="button"
              className="merge-members__remove"
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
  const geo = useMapStore((s) => s.geo)
  const dispatch = useMapStore((s) => s.dispatch)
  const noun = useNoun()

  const drafts = useMapStore((s) => s.mergeDrafts)
  const collectingId = useMapStore((s) => s.activeMergeDraftId)
  const addDraft = useMapStore((s) => s.addMergeDraft)
  const setCollecting = useMapStore((s) => s.setActiveMergeDraft)
  const removeMember = useMapStore((s) => s.removeFromMergeDraft)
  const deleteDraft = useMapStore((s) => s.deleteMergeDraft)
  const commitDraft = useMapStore((s) => s.commitMergeDraft)
  const setMergeMode = useMapStore((s) => s.setMergeMode)

  /*
   * Merge mode is simply this panel being open — it is unmounted when the section is
   * collapsed, so mounting and unmounting is exactly the signal, with nothing to keep
   * in step. It is what lets a tap on the map start a group, and what keeps the Data
   * section's selection card out of the way while it does.
   */
  useEffect(() => {
    setMergeMode(true)
    return () => setMergeMode(false)
  }, [setMergeMode])

  /*
   * Which rows are open. Local, a set, and independent per row: expanding one group to
   * check what is in it says nothing about any other.
   */
  const [open, setOpen] = useState<Set<string>>(new Set())
  const toggleOpen = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  /*
   * Every entity's own flag, plus the historical set, sorted into one alphabet — the
   * point of offering them together is that the author is choosing a flag, not choosing
   * a category first.
   *
   * One entry per flag, not per entity. A code can be reached by more than one record —
   * Kosovo is in the dataset as both UNK and XKX, and both carry `xk` — and the choice
   * here is of a flag, so the same artwork twice is one option, not two. Listing it
   * twice also gave two `<option>`s the same React key, which React is entitled to
   * resolve by dropping one.
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
      {/* The one control that is always in the same place. */}
      <button
        type="button"
        className="btn"
        onClick={() => {
          // Opened as it is created, so the entities tapped next are visibly arriving.
          const id = addDraft()
          setOpen((prev) => new Set(prev).add(id))
          playSfx('confirm')
        }}
      >
        Add group
      </button>

      {/*
        One region of constant height for everything that can grow.

        A group appearing, a group being confirmed, an entity arriving — none of it
        changes how tall this panel is, so no control is ever anywhere but where it was
        a moment ago. Without this, creating a group pushes the merged entities down and
        confirming one pulls them back up, and the button under the pointer moves while
        it is being used.
      */}
      <div className="merge-scroll">
      {drafts.length === 0 && merges.length === 0 && (
        <p className="hint">
          Tap {noun.many} on the map — the first one starts a group.
        </p>
      )}

      {drafts.map((draft, index) => {
        const collecting = draft.id === collectingId
        const expanded = open.has(draft.id)
        return (
          <div key={draft.id} className={`merge-group${collecting ? ' merge-group--on' : ''}`}>
            <div className="merge-group__head">
              {/*
                One tap does both things the row is for: it makes this the group that
                map taps land in, and it opens it so you can see them arriving.
              */}
              <button
                type="button"
                className="merge-group__pick"
                aria-expanded={expanded}
                onClick={() => {
                  setCollecting(collecting ? null : draft.id)
                  toggleOpen(draft.id)
                  playSfx('click')
                }}
              >
                <span className="merge-group__name">Group {index + 1}</span>
                <span className="merge-group__count">{draft.members.length}</span>
                {collecting && <span className="merge-group__live">collecting</span>}
              </button>

              <button
                type="button"
                className="btn btn--on merge-group__confirm"
                disabled={draft.members.length < 2}
                onClick={() => {
                  commitDraft(draft.id)
                  playSfx('confirm')
                }}
              >
                Confirm
              </button>

              <button
                type="button"
                className="merge-group__drop"
                aria-label={`Discard group ${index + 1}`}
                title="Discard group"
                onClick={() => {
                  deleteDraft(draft.id)
                  playSfx('click')
                }}
              >
                ×
              </button>
            </div>

            {expanded && (
              <MemberList
                members={draft.members}
                label={`Group ${index + 1} members`}
                onRemove={(id) => removeMember(draft.id, id)}
              />
            )}
          </div>
        )
      })}

      {merges.length > 0 && <hr className="rule" />}

      {/*
        The merged entities. Same row, same expansion — what differs is that these exist
        on the map, so opening one offers its name and its flag alongside its members.
      */}
      {merges.map((entity) => {
        const expanded = open.has(entity.id)
        return (
          <div key={entity.id} className="merge-group merge-group--done">
            <div className="merge-group__head">
              <button
                type="button"
                className="merge-group__pick"
                aria-expanded={expanded}
                onClick={() => {
                  toggleOpen(entity.id)
                  playSfx('click')
                }}
              >
                <span className="merge-group__name">{entity.name}</span>
                <span className="merge-group__count">{entity.members.length}</span>
              </button>

              <button
                type="button"
                className="merge-group__drop"
                aria-label={`Unmerge ${entity.name}`}
                title="Unmerge"
                onClick={() => {
                  // Nothing to undo but the record: the entities were never altered.
                  dispatch({ op: 'delete_merge', id: entity.id })
                  playSfx('click')
                }}
              >
                ×
              </button>
            </div>

            {expanded && (
              <>
                <NameField
                  value={entity.name}
                  label={`Name for ${entity.name}`}
                  onCommit={(name) =>
                    dispatch({ op: 'update_merge', id: entity.id, patch: { name } })
                  }
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
                <MemberList members={entity.members} label={`${entity.name} members`} />
              </>
            )}
          </div>
        )
      })}
      </div>
    </div>
  )
}
