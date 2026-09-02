/**
 * Reading the generated entity table from a build script.
 *
 * One place that knows the envelope's shape, because there is more than one reader and
 * they must not be able to disagree about it. `prepare-flags` is in the `prepare-assets`
 * chain, so a reader that guesses wrong does not fail quietly — it takes the flags, the
 * manifest, the sound effects and the dev server down with it.
 *
 * The table is written by `prepare-data.mjs` and carries its entities under `entities`.
 * It was `countries` before this editor drew anything but countries; the fallback is
 * kept so a stale `public/geo/country-meta.json` from before that rename still reads,
 * which is exactly what the runtime loader in `src/geo/countryMeta.ts` does. The two
 * deliberately agree.
 */
import { readFileSync } from 'node:fs'

/** The entities in a generated meta file, keyed by id. */
export function readEntityMeta(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  const entities = raw.entities ?? raw.countries
  if (!entities || typeof entities !== 'object') {
    throw new Error(
      `Entity table at ${path} has no "entities" — regenerate it with: npm run prepare-data`,
    )
  }
  return entities
}
