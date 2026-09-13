/**
 * What the open map calls one of its things.
 *
 * The editor says "Click a country to select it" in half a dozen places, and on a map of
 * Nevada that sentence is simply false. One hook, reading the atlas the document names,
 * is what lets every panel be correct without any of them knowing which map is open —
 * and what makes a future atlas of counties or provinces read correctly on the day it is
 * added, with no copy to revisit.
 *
 * A dataset can name its own things where one atlas holds several kinds: the official USA
 * map is states, counties or county subdivisions depending on the level chosen.
 */
import { useMapStore } from '../state/mapStore'
import { getDataset } from '../geo/datasets'
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

/** The noun for a document's scope: its dataset's, else its atlas's. */
export function nounFor(scope: { atlasId: string; datasetId: string }): { one: string; many: string } {
  const dataset = getDataset(scope.datasetId)
  return dataset.atlasId === scope.atlasId && dataset.noun ? dataset.noun : getAtlas(scope.atlasId).noun
}

export function useNoun(): Noun {
  const atlasId = useMapStore((s) => s.doc.scope.atlasId)
  const datasetId = useMapStore((s) => s.doc.scope.datasetId)
  const noun = nounFor({ atlasId, datasetId })
  return { one: noun.one, many: noun.many, One: capitalise(noun.one) }
}
