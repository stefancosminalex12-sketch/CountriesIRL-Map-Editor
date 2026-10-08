/**
 * Stickers: pictures on the territories, put there by hand or chosen by the data.
 *
 * In the order the work goes:
 *
 * - the one colour row, and the size of the stickers on the selected territories — they change
 *   only those, the stickers on the map, never the Library;
 * - **Library** — every sticker: the author's own and the gallery of faces. Select territories on
 *   the map and tap one to put it on them; tap it again to take it off;
 * - **Emoji**, **Create** — more stickers, added to the Library;
 * - **Size**;
 * - **Tiers** — the ladder, lowest value first, with what each rung covers under the active
 *   scale: the advanced part, last.
 *
 * Everything that changes the map is one operation (`set_stickers`, `assign_sticker`,
 * `clear_sticker`), so every change is one undo step. The library is the exception: it is the
 * author's collection of images, kept in this browser, not part of any one map.
 */
import { useMemo } from 'react'
import { useMapStore } from '../state/mapStore'
import { colourModeOf } from '../state/colourMode'
import { describeRungs, resolveStickers, stickersOf } from '../state/stickers'
import { getPreset } from '../state/presets'
import { saveLadder, stickerIndex, useStickerLibrary } from '../stickers/stickerLibrary'
import type { Sticker } from '../stickers/types'
import { STICKER_SIZE } from '../types/map'
import { Section } from './Panels'
import { StickerFinder } from './StickerFinder'
import { StickerLibrary } from './StickerLibrary'
import { ChosenSticker } from './ChosenSticker'
import { StickerCreator } from './StickerCreator'

function Thumb({ sticker, size = 28 }: { sticker: Sticker | undefined; size?: number }) {
  if (!sticker) return <span className="sticker-thumb sticker-thumb--missing" style={{ width: size, height: size }} title="Missing image">?</span>
  return <img className="sticker-thumb" src={sticker.src} alt="" width={size} height={size} draggable={false} />
}

/** What the stickers are following, in a sentence. */
function useStatus(): string {
  const doc = useMapStore((s) => s.doc)
  const mode = stickersOf(doc)
  if (!mode.auto) return 'Only stickers you place by hand are shown.'
  const colour = colourModeOf(doc)
  if (colour !== 'data') {
    return 'Following the data needs Data → Data mode. Stickers you place by hand still show.'
  }
  const layer = doc.layers.find((l) => l.id === doc.activeLayerId) ?? doc.layers[0]
  if (layer?.colorScale.mode === 'threshold') {
    const preset = getPreset(doc.activePresetId)
    return `Following the predefined ${preset?.name ?? ''} bands: each band gets its tier’s sticker.`
  }
  if (layer?.colorScale.mode === 'numeric') {
    return 'Following your Custom scale: the range of values is split evenly across the tiers, lowest first.'
  }
  return 'Categories have no low-to-high order, so only stickers you place by hand are shown.'
}

export function StickerTiers() {
  const doc = useMapStore((s) => s.doc)
  const dispatch = useMapStore((s) => s.dispatch)
  const uploads = useStickerLibrary((s) => s.uploads)
  const index = useMemo(() => stickerIndex(uploads), [uploads])
  const mode = stickersOf(doc)
  const ranges = describeRungs(doc)
  const counts = useMemo(() => {
    const byRung = new Map<string, number>()
    if (!mode.enabled) return byRung
    for (const stickerId of resolveStickers(doc).values()) byRung.set(stickerId, (byRung.get(stickerId) ?? 0) + 1)
    return byRung
  }, [doc, mode.enabled])

  const setLadder = (ladder: string[]) => {
    dispatch({ op: 'set_stickers', patch: { ladder } })
    saveLadder(ladder)
  }
  const move = (from: number, to: number) => {
    const ladder = [...mode.ladder]
    const [item] = ladder.splice(from, 1)
    ladder.splice(to, 0, item)
    setLadder(ladder)
  }

  const status = useStatus()
  return (
    <div className="stack">
      {mode.enabled && <p className="hint">{status}</p>}
      <div className="mode-switch mode-switch--pair" role="group" aria-label="How stickers are chosen">
        {[true, false].map((auto) => (
          <button
            key={String(auto)}
            type="button"
            className={`chip${mode.auto === auto ? ' chip--active' : ''}`}
            aria-pressed={mode.auto === auto}
            onClick={() => dispatch({ op: 'set_stickers', patch: { auto } })}
          >
            {auto ? 'Follow the data' : 'By hand only'}
          </button>
        ))}
      </div>

      {mode.ladder.length === 0 ? (
        <p className="hint">No tiers yet. Pick stickers in the Library and add them here, lowest value first.</p>
      ) : (
        <ol className="sticker-ladder">
          {mode.ladder.map((id, i) => {
            const sticker = index.get(id)
            const range = ranges?.[i]
            const count = counts.get(id)
            return (
              <li key={`${id}-${i}`} className="sticker-ladder__row">
                <span className="sticker-ladder__rank">{i + 1}</span>
                <Thumb sticker={sticker} />
                <span className="sticker-ladder__text">
                  <span className="sticker-ladder__name">{sticker?.name ?? 'Missing image'}</span>
                  {mode.auto && ranges && (
                    <span className="sticker-ladder__range">
                      {range ?? 'no band lands here'}
                      {count ? ` · ${count} on map` : ''}
                    </span>
                  )}
                </span>
                <span className="sticker-ladder__actions">
                  <button type="button" className="btn btn--icon" title="Move towards lowest" aria-label="Move up" disabled={i === 0} onClick={() => move(i, i - 1)}>
                    ↑
                  </button>
                  <button type="button" className="btn btn--icon" title="Move towards highest" aria-label="Move down" disabled={i === mode.ladder.length - 1} onClick={() => move(i, i + 1)}>
                    ↓
                  </button>
                  <button type="button" className="btn btn--icon" title="Remove from tiers" aria-label="Remove" onClick={() => setLadder(mode.ladder.filter((_, j) => j !== i))}>
                    ×
                  </button>
                </span>
              </li>
            )
          })}
        </ol>
      )}

      {mode.ladder.length > 1 && (
        <button type="button" className="btn btn--ghost" onClick={() => setLadder([...mode.ladder].reverse())}>
          Reverse order
        </button>
      )}
      <p className="hint">
        Tier 1 goes to the lowest values. Reverse the order when a high number is the bad end, like inflation.
      </p>
    </div>
  )
}

export function StickerSize() {
  const size = useMapStore((s) => stickersOf(s.doc).size)
  const dispatch = useMapStore((s) => s.dispatch)
  const percent = Math.round(size * 100)
  return (
    <label className="field">
      <span className="field__row">
        <span className="field__label">Sticker size</span>
        <span className="field__value">{percent}%</span>
      </span>
      <input
        className="slider"
        type="range"
        min={STICKER_SIZE.min}
        max={STICKER_SIZE.max}
        step={STICKER_SIZE.step}
        value={size}
        aria-label="Sticker size"
        aria-valuetext={`${percent} percent`}
        onChange={(event) => dispatch({ op: 'set_stickers', patch: { size: Number(event.target.value) } })}
      />
    </label>
  )
}

export function StickerControls() {
  return (
    <div className="stack">
      <ChosenSticker />
      <Section title="Library">
        <StickerLibrary />
      </Section>
      <Section title="Emoji">
        <StickerFinder />
      </Section>
      <Section title="Create">
        <StickerCreator />
      </Section>
      <Section title="Size of all stickers">
        <StickerSize />
      </Section>
      {/* Stickers chosen by the data, lowest value first: the advanced part, so it comes last. */}
      <Section title="Tiers">
        <StickerTiers />
      </Section>
    </div>
  )
}
