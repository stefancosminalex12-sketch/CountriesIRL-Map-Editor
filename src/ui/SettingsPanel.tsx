/**
 * Editor settings: appearance and sound.
 *
 * Structured as independent sections so later settings (export defaults, shortcuts,
 * the AI assistant) drop in without rearranging anything.
 */
import { useEffect, useState } from 'react'
import { playSfx } from '../audio/sfx'
import { loadCompositionIndex, type CompositionIndex } from '../geo/composition'
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

/**
 * Where the map's data comes from, and the terms it comes under.
 *
 * In the app rather than only in the README, so the credit travels with the tool and with
 * every map made in it. Natural Earth is public domain and asks for a credit rather than
 * requiring one; Marine Regions' licence (CC BY 4.0) and the country table's (ODbL)
 * require attribution, and the flag artwork's MIT licence asks for its notice to be kept.
 */
export function DataSources() {
  return (
    <div className="stack">
      <p className="hint">
        <strong>Natural Earth</strong> — country outlines, first-level administrative
        subdivisions (admin-1 states and provinces), lakes and rivers. Public domain. Made
        with Natural Earth: naturalearthdata.com
      </p>
      <p className="hint">
        <strong>Marine Regions</strong> — exclusive economic zones, for Island Water
        Coverage. Flanders Marine Institute (2019), Maritime Boundaries Geodatabase v11,
        marineregions.org. CC BY 4.0.
      </p>
      <p className="hint">
        <strong>world-countries</strong> — country names, codes and regions, by Mohammed Le
        Doze. Open Database License (ODbL) 1.0.
      </p>
      <p className="hint">
        <strong>flag-icons</strong> — flag artwork, by Panayiotis Lipiridis. MIT licence.
      </p>
      <AdministrativeSources />
      <p className="hint">
        <strong>U.S. Census Bureau</strong> — the Official USA Administrative Map, and Puerto
        Rico, the U.S. Virgin Islands, Guam, the Northern Mariana Islands and American Samoa on
        USA States: cartographic boundary files, 2024, 1:500,000 — states, counties and county
        subdivisions
        (cb_2024_us_state_500k, cb_2024_us_county_500k, cb_2024_us_cousub_500k),
        www2.census.gov/geo/tiger/GENZ2024. Public domain: works of the U.S. Government are not
        subject to copyright (17 U.S.C. §105). TIGER/Line® is a registered trademark of the
        Census Bureau; this map is not endorsed or certified by the Census Bureau.
      </p>
      <p className="hint">
        <strong>U.S. Geological Survey</strong> — lakes and rivers on the Official USA
        Administrative Map: Small-scale Dataset, 1:1,000,000-scale hydrography (waterbodies,
        streams), The National Map. The Minor Outlying Islands on USA States: Global Islands,
        version 3 (Sayre, R., 2023, U.S. Geological Survey data release, doi:10.5066/P91ZCSGM),
        shorelines from 30 m Landsat imagery, with Esri and UNEP-WCMC. Public domain. Credit:
        U.S. Geological Survey.
      </p>
    </div>
  )
}

/**
 * The Modern Administrative World's finer boundaries, each with its own agency and licence.
 *
 * Read from the build's index rather than written out here, so the credit is always the one
 * for the data actually shipped: when a country's level changes source, its line changes
 * with it. Fetched only when this section is opened; the file is the one the map loads.
 */
function AdministrativeSources() {
  const [sources, setSources] = useState<CompositionIndex['sources'] | null>(null)
  useEffect(() => {
    let live = true
    loadCompositionIndex('geo/admin/index.json')
      .then((index) => live && setSources(index.sources.filter((s) => s.id !== 'naturalearth')))
      .catch(() => live && setSources([]))
    return () => {
      live = false
    }
  }, [])
  if (!sources || sources.length === 0) return null
  return (
    <>
      <p className="hint">
        <strong>geoBoundaries</strong> — finer and current official boundaries for the Modern
        Administrative World, cut into Natural Earth’s outlines or used to group its units.
        gbOpen release, William &amp; Mary geoLab (Runfola et al. 2020, PLoS ONE 15(4):
        e0231866), geoboundaries.org. From the national agencies below, under their licences:
      </p>
      <ul className="hint sources-list">
        {sources.map((s) => (
          <li key={s.id}>
            {s.countries.join(', ')}: {s.agency}
            {s.year ? ` (${s.year})` : ''} — {s.licence}
          </li>
        ))}
      </ul>
    </>
  )
}
