import { ROUTE_BONUS, fuseRrf } from './rrf'

describe('fuseRrf', () => {
  it('ranks by summed reciprocal rank', () => {
    const fused = fuseRrf([
      ['a', 'b'],
      ['b', 'c'],
    ])
    expect(fused.map((h) => h.id)).toEqual(['b', 'a', 'c'])
    expect(fused[0]!.score).toBeCloseTo(1 / 51 + 1 / 52)
  })

  it('adds a flat bonus for routed ids', () => {
    const fused = fuseRrf([['a', 'x']], new Set(['z']))
    expect(fused.find((h) => h.id === 'z')?.score).toBeCloseTo(ROUTE_BONUS)
    // z ties the rank-1 hit and beats the rank-2 hit; stable sort keeps a first
    expect(fused.map((h) => h.id)).toEqual(['a', 'z', 'x'])
  })

  it('boosts an id that is also ranked', () => {
    const fused = fuseRrf([['a']], new Set(['a']))
    expect(fused[0]!.score).toBeCloseTo(1 / 51 + ROUTE_BONUS)
  })

  it('returns empty for no lists', () => {
    expect(fuseRrf([])).toEqual([])
  })
})
