import { describe, it, expect } from 'vitest'
import { groupDateLabel, groupDateLabelFromSortKey, groupDateSortKey } from './dateFormat'

describe('groupDateLabelFromSortKey', () => {
  it('labels a YYYY-MM-DD key as the LOCAL day (not the UTC parse of the bare string)', () => {
    // a bare '2020-01-15' parses as UTC midnight → Jan 14 label in negative offsets; the helper must not
    expect(groupDateLabelFromSortKey('2020-01-15')).toBe('Jan 15, 2020')
    expect(groupDateLabelFromSortKey('2020-01-15')).toBe(groupDateLabel('2020-01-15T12:00:00'))
  })

  it('round-trips through groupDateSortKey for any local timestamp', () => {
    const iso = new Date(2020, 4, 3, 9, 30).toISOString() // Sat May 3 2020, 09:30 local
    const key = groupDateSortKey(iso)
    expect(key).toBe('2020-05-03')
    expect(groupDateLabelFromSortKey(key)).toBe(groupDateLabel(iso))
    expect(groupDateLabelFromSortKey(key)).toBe('May 3, 2020')
  })

  it("labels today's key 'Today'", () => {
    expect(groupDateLabelFromSortKey(groupDateSortKey(new Date().toISOString()))).toBe('Today')
  })

  it('passes malformed keys through unchanged', () => {
    expect(groupDateLabelFromSortKey('not-a-date')).toBe('not-a-date')
    expect(groupDateLabelFromSortKey('')).toBe('')
  })
})
