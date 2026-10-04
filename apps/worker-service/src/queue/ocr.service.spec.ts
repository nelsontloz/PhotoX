import { describe, expect, it } from 'vitest'
import { finalizeOcrText } from './ocr.service'

describe('finalizeOcrText', () => {
  it('joins detected lines with \\n, trimming and dropping blanks', () => {
    expect(finalizeOcrText('  TOTAL 12.50 \n\n  thanks for visiting  \n', 0.9)).toEqual({
      text: 'TOTAL 12.50\nthanks for visiting',
      confidence: 0.9,
    })
  })

  it('skips empty or whitespace-only text regardless of confidence', () => {
    expect(finalizeOcrText('', 0.99)).toBeNull()
    expect(finalizeOcrText(' \n\t\n ', 0.99)).toBeNull()
  })

  it('carries the mean confidence through — the floor is per-item inside the library', () => {
    expect(finalizeOcrText('TOTAL 12.50', 0.42)).toEqual({
      text: 'TOTAL 12.50',
      confidence: 0.42,
    })
  })
})
