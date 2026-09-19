/**
 * The four colouring modes — Off, Data, Compare, Flags — as operations.
 *
 * The modes are exclusive, and choosing one means moving three settings together: the active
 * layer's scale, the comparison switch and the flags switch. This is that move, in one place, for
 * everything that chooses a mode: the mode chips in Styles & Data, and the built-in templates
 * (`state/templates.ts`). Nothing is deleted on the way out of a mode — values, groups, palette
 * and flag choices all stay where they are — so coming back restores what was there.
 */
import type { MapOperation } from './operations'
import type { MapDocument } from '../types/map'

export type ColourMode = 'none' | 'data' | 'comparison' | 'flags'

/** Which kind of data scale Data mode uses: the three `ColorScale` modes it can be. */
export type DataScaleMode = 'numeric' | 'threshold' | 'categorical'

/** The mode the document is in. Flags outrank the others, because turning them on suspends them. */
export function colourModeOf(doc: MapDocument): ColourMode {
  if (doc.flags.enabled) return 'flags'
  if (doc.comparison.enabled) return 'comparison'
  const layer = doc.layers.find((l) => l.id === doc.activeLayerId) ?? doc.layers[0]
  const mode = layer?.colorScale.mode
  return mode === 'numeric' || mode === 'threshold' || mode === 'categorical' ? 'data' : 'none'
}

/**
 * The operations that put the document in `mode`. `dataScale` is the scale Data mode resumes
 * with — the panel passes the one it last showed; anything else gets the relative palette.
 */
export function colourModeOps(doc: MapDocument, mode: ColourMode, dataScale: DataScaleMode = 'numeric'): MapOperation[] {
  const layer = doc.layers.find((l) => l.id === doc.activeLayerId) ?? doc.layers[0]
  const ops: MapOperation[] = []
  if (layer) {
    ops.push({
      op: 'set_layer',
      layerId: layer.id,
      patch: { colorScale: { ...layer.colorScale, mode: mode === 'data' ? dataScale : 'none' } },
    })
  }
  ops.push({ op: 'set_comparison', patch: { enabled: mode === 'comparison' } })
  ops.push({ op: 'set_flags', patch: { enabled: mode === 'flags' } })
  return ops
}
