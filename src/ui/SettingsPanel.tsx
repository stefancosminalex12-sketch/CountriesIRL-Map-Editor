/**
 * Editor settings: appearance and sound.
 *
 * Structured as independent sections so later settings (export defaults, shortcuts,
 * the AI assistant) drop in without rearranging anything.
 */
import { playSfx } from '../audio/sfx'
import { useSettingsStore } from '../state/settingsStore'
import { getTheme, THEMES, type ThemeId } from '../theme/themes'

/**
 * Quick colours for the selection highlight.
 *
 * Six, in the muted register the themes use, so a preset never looks pasted in from a
 * different application. Theme Color leads and is what a fresh install selects with;
 * Green is the tone the Geographic theme picks for itself, so choosing it restores that
 * exactly rather than approximating it.
 *
 * The two blues are the same hue an octave apart — `hsl(213, 45%, 52%)` against
 * `hsl(217, 98%, 24%)` — so they read as one family with a real choice in it rather than
 * as two attempts at the same colour. The lighter one leads because a selection is meant
 * to be seen against land: at 52% lightness it separates from the land tones without the
 * deep navy's habit of reading as a hole in the map. The navy is unchanged and directly
 * behind it, so a map that used it keeps it and anyone who prefers it is one click away.
 */
const HIGHLIGHT_PRESETS = [
  { name: 'Theme Color', color: '#4a7fbf' },
  { name: 'Deep Blue', color: '#012c79' },
  { name: 'Green', color: '#38705f' },
  { name: 'Red', color: '#a8443b' },
  { name: 'Yellow', color: '#c69a2e' },
  { name: 'Purple', color: '#6b5aa6' },
] as const

/**
 * The colour selected countries are filled with.
 *
 * Unset by default, which means "whatever this theme selects with" — each theme already
 * picks one that belongs with its palette, and a literal default would restyle the two
 * themes nobody asked about. So the well shows the colour actually in use, and setting
 * it pins that choice across every theme until it is handed back.
 */
export function SelectionHighlight() {
  const themeId = useSettingsStore((s) => s.themeId)
  const highlight = useSettingsStore((s) => s.selectionHighlight)
  const setHighlight = useSettingsStore((s) => s.setSelectionHighlight)
  const current = highlight ?? getTheme(themeId).map.selected

  return (
    <div className="stack">
      <div className="swatches">
        <label className="swatch">
          <input
            type="color"
            value={current}
            aria-label="Selection highlight colour"
            onChange={(event) => setHighlight(event.target.value)}
          />
          <span>Selection</span>
        </label>
      </div>

      <div className="preset-colors" role="group" aria-label="Selection highlight presets">
        {HIGHLIGHT_PRESETS.map((preset) => (
          <button
            key={preset.name}
            type="button"
            className={`preset-color${current.toLowerCase() === preset.color ? ' preset-color--on' : ''}`}
            style={{ background: preset.color }}
            title={preset.name}
            aria-label={preset.name}
            aria-pressed={current.toLowerCase() === preset.color}
            onClick={() => {
              setHighlight(preset.color)
              playSfx('click')
            }}
          />
        ))}
      </div>

      {/* Only once there is something to hand back. */}
      {highlight && (
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => {
            setHighlight(null)
            playSfx('click')
          }}
        >
          Use theme colour
        </button>
      )}
    </div>
  )
}

function ThemeChoice({ id }: { id: ThemeId }) {
  const themeId = useSettingsStore((s) => s.themeId)
  const setTheme = useSettingsStore((s) => s.setTheme)
  const theme = THEMES.find((t) => t.id === id)!
  const active = themeId === id

  return (
    <button
      type="button"
      className={`theme-choice${active ? ' theme-choice--active' : ''}`}
      aria-pressed={active}
      onClick={() => {
        if (active) return
        setTheme(id)
        playSfx('confirm')
      }}
    >
      <span className="theme-choice__swatches" aria-hidden="true">
        <span style={{ background: theme.map.background }} />
        <span style={{ background: theme.map.land }} />
        <span style={{ background: theme.ui.panel }} />
        <span style={{ background: theme.ui.accent }} />
      </span>
      <span className="theme-choice__text">
        <strong>{theme.name}</strong>
        <span className="hint">{theme.description}</span>
      </span>
    </button>
  )
}

/** The three interface themes, each carrying its own map palette. */
export function ThemePicker() {
  return (
    <div className="theme-choices">
      {THEMES.map((theme) => (
        <ThemeChoice key={theme.id} id={theme.id} />
      ))}
    </div>
  )
}

export function SoundSettings() {
  const sfxVolume = useSettingsStore((s) => s.sfxVolume)
  const setSfxVolume = useSettingsStore((s) => s.setSfxVolume)
  const percent = Math.round(sfxVolume * 100)

  // The sidebar supplies the heading; this is the section's contents.
  return (
        <div className="stack">
          <label className="field" htmlFor="sfx-volume">
            <span className="field__row">
              <span className="field__label">Sound effects</span>
              <span className="field__value">{percent}%</span>
            </span>
            <input
              id="sfx-volume"
              className="slider"
              type="range"
              min={0}
              max={100}
              step={1}
              value={percent}
              aria-valuetext={`${percent} percent`}
              onChange={(event) => setSfxVolume(Number(event.target.value) / 100)}
              // Preview the level once the drag ends rather than on every step.
              onPointerUp={() => playSfx('tick')}
              onKeyUp={() => playSfx('tick')}
            />
          </label>
          <p className="hint">
            {percent === 0
              ? 'Muted. Interface sounds are off.'
              : 'Brief tactile clicks on meaningful actions only.'}
          </p>
        </div>
  )
}
