/**
 * Where a unit comes from and what it is officially called: its level, its codes, its source.
 *
 * Read from the entity table where the dataset carries them there, and otherwise from the
 * dataset's details file (`entityDetails.ts`), fetched the first time a unit of it is shown.
 */
import { useEffect, useState } from 'react'
import { loadEntityDetails } from '../geo/entityDetails'
import type { EntityMeta } from '../geo/countryMeta'

export function EntitySource({ meta, detailsUrl }: { meta: EntityMeta; detailsUrl?: string }) {
  const [fetched, setFetched] = useState<EntityMeta['source'] | null>(null)
  // A details file split by parent names it `{parent}`: one state's units, not the country's.
  const url = detailsUrl?.replace('{parent}', meta.parent?.id ?? '')
  useEffect(() => {
    setFetched(null)
    if (meta.source || !url) return
    let live = true
    loadEntityDetails(url)
      .then((details) => live && setFetched(details[meta.id]?.source ?? null))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [meta.id, meta.source, url])

  const source = meta.source ?? fetched
  if (!source && !meta.level) return null
  const codes = source?.codes ?? {}
  const lines = [
    [
      meta.level ? meta.level.name : null,
      source?.geoid ? `GEOID ${source.geoid}` : null,
      source?.iso31662 ? `ISO 3166-2 ${source.iso31662}` : null,
      codes.STATEFP ? `State FIPS ${codes.STATEFP}${codes.COUNTYFP ? ` · County FIPS ${codes.COUNTYFP}` : ''}${codes.COUSUBFP ? ` · Subdivision FIPS ${codes.COUSUBFP}` : ''}` : null,
    ],
    [
      source?.landKm2 != null ? `Land ${source.landKm2.toLocaleString()} km²` : null,
      source?.waterKm2 ? `water ${source.waterKm2.toLocaleString()} km²` : null,
    ],
    [source ? (source.outline ? `${source.dataset}, cut into ${source.outline}` : source.dataset) : null],
  ]
    .map((parts) => parts.filter(Boolean).join(' · '))
    .filter(Boolean)
  return (
    <>
      {lines.map((line, i) => (
        <div className="hint" key={i}>
          {line}
        </div>
      ))}
    </>
  )
}
