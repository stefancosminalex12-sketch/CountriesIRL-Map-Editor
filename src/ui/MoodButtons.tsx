/**
 * The mood stickers' switch and Shuffle (see `stickers/moods.ts`): a face on every country with a
 * number, from its mood's group. Shown in Stickers → Moods and in Data under the Moods colours,
 * where an author who has just coloured the map by mood looks for the faces.
 */
import { useMapStore } from '../state/mapStore'
import { stickersOf } from '../state/stickers'

export function MoodButtons() {
  const mode = useMapStore((s) => stickersOf(s.doc))
  const dispatch = useMapStore((s) => s.dispatch)
  const on = !!mode.moods
  return (
    <div className="sticker-moods__actions">
      <button
        type="button"
        className={`btn${on ? ' btn--on' : ''}`}
        aria-pressed={on}
        onClick={() =>
          dispatch({ op: 'set_stickers', patch: on ? { moods: false } : { moods: true, auto: false, enabled: true } })
        }
      >
        {on ? 'Remove mood stickers' : 'Add mood stickers'}
      </button>
      {on && (
        <button
          type="button"
          className="btn"
          title="Give every country a different face from its mood"
          onClick={() => dispatch({ op: 'set_stickers', patch: { moodSeed: (mode.moodSeed ?? 0) + 1 } })}
        >
          Shuffle
        </button>
      )}
    </div>
  )
}
