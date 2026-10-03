import { toPlaceFields } from './places-resolve.service'

const paris = {
  name: 'Paris',
  admin1Code: '11',
  countryCode: 'FR',
  timezone: 'Europe/Paris',
}

describe('toPlaceFields', () => {
  it('maps the nearest city to place fields', () => {
    expect(toPlaceFields(paris, 0.4)).toEqual({
      placeCity: 'Paris',
      placeAdmin1: '11',
      placeCountryCode: 'FR',
      placeTimezone: 'Europe/Paris',
      placeDistanceKm: 0.4,
    })
  })

  it('keeps null admin1/timezone', () => {
    expect(toPlaceFields({ ...paris, admin1Code: null, timezone: null }, 12.5)).toEqual({
      placeCity: 'Paris',
      placeAdmin1: null,
      placeCountryCode: 'FR',
      placeTimezone: null,
      placeDistanceKm: 12.5,
    })
  })

  it('accepts exactly 50km', () => {
    expect(toPlaceFields(paris, 50)).not.toBeNull()
  })

  it('returns null beyond 50km', () => {
    expect(toPlaceFields(paris, 50.1)).toBeNull()
    expect(toPlaceFields(paris, 1427)).toBeNull()
  })
})
