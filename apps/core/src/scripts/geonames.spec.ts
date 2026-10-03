import { parseCityLine } from './geonames'

const ROW = [
  '2988507',
  'Paris',
  'Paris',
  '',
  '48.85341',
  '2.3488',
  'P',
  'PPL',
  'FR',
  '',
  '11',
  '75',
  '',
  '',
  '2145906',
  '35',
  '35',
  'Europe/Paris',
  '2024-01-01',
].join('\t')

describe('parseCityLine', () => {
  it('parses a cities500 row, blanks as null, empty population as 0', () => {
    expect(parseCityLine(ROW)).toEqual({
      geonameId: 2988507,
      name: 'Paris',
      asciiName: 'Paris',
      latitude: 48.85341,
      longitude: 2.3488,
      countryCode: 'FR',
      admin1Code: '11',
      admin2Code: '75',
      population: 2145906,
      timezone: 'Europe/Paris',
    })

    const noPop = ROW.replace('\t2145906\t', '\t\t')
    expect(parseCityLine(noPop)?.population).toBe(0)
  })

  it('rejects malformed rows', () => {
    expect(parseCityLine('')).toBeNull()
    expect(parseCityLine(ROW.replace('48.85341', 'abc'))).toBeNull()
    expect(parseCityLine(ROW.replace('\tFR\t', '\t\t'))).toBeNull()
  })
})
