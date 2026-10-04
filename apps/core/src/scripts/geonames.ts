import type { Place } from '../database/entities/place.entity'

/** Parsed cities500 row, shaped for the `places` table. */
export type PlaceRow = Pick<
  Place,
  | 'geonameId'
  | 'name'
  | 'asciiName'
  | 'latitude'
  | 'longitude'
  | 'countryCode'
  | 'admin1Code'
  | 'admin2Code'
  | 'population'
  | 'timezone'
>

const blankToNull = (value: string | undefined): string | null =>
  value === undefined || value === '' ? null : value

/**
 * Parse one line of GeoNames cities500.txt (tab-separated, no header):
 * geonameid, name, asciiname, alternatenames, lat, lon, feature class, feature code,
 * country code, cc2, admin1..admin4, population, elevation, dem, timezone, modification date.
 * Returns null for malformed or nameless-country rows.
 */
export function parseCityLine(line: string): PlaceRow | null {
  const f = line.split('\t')
  if (f.length < 19) return null

  const geonameId = Number.parseInt(f[0]!, 10)
  const latitude = Number.parseFloat(f[4]!)
  const longitude = Number.parseFloat(f[5]!)
  const countryCode = f[8]!
  if (!Number.isFinite(geonameId) || !Number.isFinite(latitude) || !Number.isFinite(longitude))
    return null
  if (countryCode === '') return null

  const population = Number.parseInt(f[14]!, 10)

  return {
    geonameId,
    name: f[1]!,
    asciiName: f[2]!,
    latitude,
    longitude,
    countryCode,
    admin1Code: blankToNull(f[10]),
    admin2Code: blankToNull(f[11]),
    population: Number.isFinite(population) ? population : 0,
    timezone: blankToNull(f[17]),
  }
}
