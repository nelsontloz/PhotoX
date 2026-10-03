import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { Place } from '../database/entities/place.entity'

/** place* columns written on an asset from the nearest GeoNames city. */
export interface PlaceFields {
  placeCity: string
  placeAdmin1: string | null
  placeCountryCode: string
  placeTimezone: string | null
  placeDistanceKm: number
}

const MAX_PLACE_DISTANCE_KM = 50

type NearestCity = Pick<Place, 'name' | 'admin1Code' | 'countryCode' | 'timezone'>

interface NearestCityRow extends NearestCity {
  distanceKm: number | null
}

// earthdistance 1.2 dropped the <@> operator, so nearest is the KNN <-> operator (chord length in
// meters, backed by places_earth_idx). Ordering by chord is monotonic with great-circle distance
// and the arc/chord error is <0.01% at the 50km cutoff.
const NEAREST_CITY_SQL = `
  SELECT name, "admin1Code", "countryCode", timezone,
         (ll_to_earth(latitude, longitude) <-> ll_to_earth($1, $2)) / 1000 AS "distanceKm"
  FROM places
  ORDER BY ll_to_earth(latitude, longitude) <-> ll_to_earth($1, $2)
  LIMIT 1
`

/**
 * Nearest GeoNames city -> asset place columns; null beyond MAX_PLACE_DISTANCE_KM.
 * ponytail: wilderness (nearest city >50km, e.g. open ocean/Antarctica) leaves the whole place
 * group NULL — no country/timezone fallback. Derive those from a coarser dataset if it matters.
 */
export function toPlaceFields(city: NearestCity, distanceKm: number | null): PlaceFields | null {
  // null/NaN/Infinity all mean "no usable distance" (NULL GPS params make the KNN expression NULL,
  // and a NULL distance slips a bare `> MAX` check) — reject before writing any place field
  if (distanceKm === null || !Number.isFinite(distanceKm) || distanceKm > MAX_PLACE_DISTANCE_KM)
    return null
  return {
    placeCity: city.name,
    placeAdmin1: city.admin1Code,
    placeCountryCode: city.countryCode,
    placeTimezone: city.timezone,
    placeDistanceKm: distanceKm,
  }
}

@Injectable()
export class PlacesResolveService {
  constructor(
    @InjectRepository(Place)
    private readonly repo: Repository<Place>,
  ) {}

  /** ponytail: one indexed KNN lookup per call; materialize per coordinate cell if it ever shows in slow-query logs. */
  async resolve(latitude: number, longitude: number): Promise<PlaceFields | null> {
    const rows = await this.repo.query<NearestCityRow[]>(NEAREST_CITY_SQL, [latitude, longitude])
    const row = rows[0]
    return row ? toPlaceFields(row, row.distanceKm) : null
  }
}
