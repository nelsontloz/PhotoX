import { routeMatches } from './routing'

describe('routeMatches', () => {
  const candidates = {
    persons: [
      { id: 'p1', name: 'Sarah' },
      { id: 'p2', name: 'Bob' },
    ],
    places: ['Paris', 'Berlin', 'FR'],
  }

  it('matches person names case-insensitively by substring', () => {
    expect(routeMatches('sar', candidates).personIds).toEqual(['p1'])
  })

  it('matches places case-insensitively', () => {
    expect(routeMatches('PARIS', candidates).places).toEqual(['Paris'])
  })

  it('returns nothing when neither persons nor places match', () => {
    expect(routeMatches('beach', candidates)).toEqual({ personIds: [], places: [] })
  })

  it('treats whitespace-only queries as no match', () => {
    expect(routeMatches('   ', candidates)).toEqual({ personIds: [], places: [] })
  })
})
