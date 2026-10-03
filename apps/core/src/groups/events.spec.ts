import { formatEventLabel, splitEvents, type EventSourceRow } from './events'

const row = (
  id: string,
  takenAt: string,
  placeCity: string | null,
  placeCountryCode: string | null = null,
): EventSourceRow => ({ id, takenAt, placeCity, placeCountryCode })

describe('formatEventLabel', () => {
  it('labels a place group with city + start month', () => {
    expect(
      formatEventLabel('Paris', new Date('2026-06-03T10:00:00Z'), new Date('2026-06-05T10:00:00Z')),
    ).toBe('Paris · Jun 2026')
  })

  it('labels a city-less group as an untitled trip with a date range', () => {
    expect(
      formatEventLabel(null, new Date('2026-06-03T10:00:00Z'), new Date('2026-06-05T10:00:00Z')),
    ).toBe('Untitled trip · Jun 3 – 5, 2026')
  })

  it('collapses a single-day range', () => {
    expect(
      formatEventLabel(null, new Date('2026-06-03T08:00:00Z'), new Date('2026-06-03T20:00:00Z')),
    ).toBe('Untitled trip · Jun 3, 2026')
  })

  it('keeps both month names when the range spans months', () => {
    expect(
      formatEventLabel(null, new Date('2026-06-28T10:00:00Z'), new Date('2026-07-02T10:00:00Z')),
    ).toBe('Untitled trip · Jun 28 – Jul 2, 2026')
  })

  it('spans years', () => {
    expect(
      formatEventLabel(null, new Date('2025-12-30T00:00:00Z'), new Date('2026-01-02T00:00:00Z')),
    ).toBe('Untitled trip · Dec 30, 2025 – Jan 2, 2026')
  })
})

describe('splitEvents', () => {
  it('splits on gap and city change, keeps a null-city run contiguous, newest first', () => {
    const groups = splitEvents(
      [
        row('a1', '2026-06-01T10:00:00Z', 'Paris', 'FR'),
        row('a2', '2026-06-02T10:00:00Z', 'Paris', 'FR'),
        row('a3', '2026-06-10T10:00:00Z', 'Paris', 'FR'), // 8-day gap -> new group
        row('a4', '2026-06-11T10:00:00Z', null),
        row('a5', '2026-06-12T10:00:00Z', null), // contiguous null bucket
        row('a6', '2026-06-13T10:00:00Z', 'Paris', 'FR'), // city change -> new group
      ],
      3,
    )

    expect(groups.map((g) => g.id)).toEqual([
      '2026-06-13T10:00:00.000Z_Paris',
      '2026-06-11T10:00:00.000Z_any',
      '2026-06-10T10:00:00.000Z_Paris',
      '2026-06-01T10:00:00.000Z_Paris',
    ])

    const nullGroup = groups[1]!
    expect(nullGroup.placeCity).toBeNull()
    expect(nullGroup.count).toBe(2)
    expect(nullGroup.label).toBe('Untitled trip · Jun 11 – 12, 2026')
    expect(nullGroup.coverAssetId).toBe('a5')

    const first = groups[3]!
    expect(first.count).toBe(2)
    expect(first.coverAssetId).toBe('a2')
    expect(first.placeCountryCode).toBe('FR')
    expect(first.takenFrom).toBe('2026-06-01T10:00:00.000Z')
    expect(first.takenTo).toBe('2026-06-02T10:00:00.000Z')
    expect(first.label).toBe('Paris · Jun 2026')
  })

  it('keeps a gap of exactly gapDays inside the group', () => {
    const groups = splitEvents(
      [row('a1', '2026-06-01T00:00:00Z', 'Paris'), row('a2', '2026-06-04T00:00:00Z', 'Paris')],
      3,
    )
    expect(groups).toHaveLength(1)
    expect(groups[0]!.count).toBe(2)
  })

  it('merges same-place photos across a large gap when gapDays allows', () => {
    const groups = splitEvents(
      [row('a1', '2026-06-01T00:00:00Z', 'Paris'), row('a2', '2026-06-10T00:00:00Z', 'Paris')],
      30,
    )
    expect(groups).toHaveLength(1)
  })

  it('returns no groups for no rows', () => {
    expect(splitEvents([], 3)).toEqual([])
  })
})
