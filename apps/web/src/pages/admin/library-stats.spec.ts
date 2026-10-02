import { describe, it, expect } from 'vitest'
import type { AdminLibraryStorageMonth } from '@photox/shared-types'
import { toCumulative, scaleToHeight, formatStorage } from './library-stats'

const month = (over: Partial<AdminLibraryStorageMonth> = {}): AdminLibraryStorageMonth => ({
  month: '2026-01-01',
  originalsBytes: 0,
  transcodesBytes: 0,
  thumbnailsBytes: 0,
  ...over,
})

describe('toCumulative', () => {
  it('accumulates running totals across months', () => {
    const rows = [
      month({ month: '2026-01-01', originalsBytes: 100, transcodesBytes: 10, thumbnailsBytes: 1 }),
      month({ month: '2026-02-01', originalsBytes: 50, transcodesBytes: 5, thumbnailsBytes: 2 }),
      month({ month: '2026-03-01', originalsBytes: 0, transcodesBytes: 0, thumbnailsBytes: 0 }),
    ]
    expect(toCumulative(rows)).toEqual([
      { month: '2026-01-01', originalsBytes: 100, transcodesBytes: 10, thumbnailsBytes: 1 },
      { month: '2026-02-01', originalsBytes: 150, transcodesBytes: 15, thumbnailsBytes: 3 },
      { month: '2026-03-01', originalsBytes: 150, transcodesBytes: 15, thumbnailsBytes: 3 },
    ])
  })

  it('keeps a zero-filled month at the previous level and handles an empty series', () => {
    expect(toCumulative([])).toEqual([])
    const one = toCumulative([month({ originalsBytes: 7 })])
    expect(one).toEqual([
      { month: '2026-01-01', originalsBytes: 7, transcodesBytes: 0, thumbnailsBytes: 0 },
    ])
  })
})

describe('scaleToHeight', () => {
  it('scales proportionally against the max', () => {
    expect(scaleToHeight(5, 10, 100)).toBe(50)
    expect(scaleToHeight(10, 10, 100)).toBe(100)
  })

  it('returns 0 instead of NaN when max is 0', () => {
    expect(scaleToHeight(0, 0, 100)).toBe(0)
    expect(scaleToHeight(5, 0, 100)).toBe(0)
    expect(Number.isNaN(scaleToHeight(0, 0, 100))).toBe(false)
  })

  it('never goes negative or past the chart height', () => {
    expect(scaleToHeight(-5, 10, 100)).toBe(0)
    expect(scaleToHeight(50, 10, 100)).toBe(100)
  })
})

describe('formatStorage', () => {
  it('formats plain byte counts', () => {
    expect(formatStorage(512)).toBe('512 B')
    expect(formatStorage(1536)).toBe('1.50 KB')
  })

  it('formats large values in binary units', () => {
    expect(formatStorage(5 * 1024 ** 3)).toBe('5.00 GB')
  })

  it('renders 0 (and negatives) as a real string, never null', () => {
    expect(formatStorage(0)).toBe('0 B')
    expect(formatStorage(-1)).toBe('0 B')
  })
})
