/**
 * What the open map calls one of its things.
 *
 * The editor says "Click a country to select it" in half a dozen places, and on a map of
 * Nevada that sentence is simply false. One hook, reading the atlas the document names,
 * is what lets every panel be correct without any of them knowing which map is open —
 * and what makes a future atlas of counties or provinces read correctly on the day it is
 * added, with no copy to revisit.
 */
import { useMapStore } from '../state/mapStore'
import { getAtlas } from './atlas'

export interface Noun {
  /** "country" / "state" */
  one: string
  /** "countries" / "states" */
  many: string
  /** "Country" / "State", for the start of a sentence or a field label. */
  One: string
}

const capitalise = (word: string) => word.replace(/^./, (c) => c.toUpperCase())

export function useNoun(): Noun {
  const atlasId = useMapStore((s) => s.doc.scope.atlasId)
  const noun = getAtlas(atlasId).noun
  return { one: noun.one, many: noun.many, One: capitalise(noun.one) }
}
