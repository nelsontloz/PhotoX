import { describe, expect, it } from 'vitest'
import { finalizeOcrText, OCR_MIN_CONFIDENCE } from './ocr.service'

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

  it('skips text below the mean-confidence floor and keeps it at the boundary', () => {
    expect(finalizeOcrText('TOTAL 12.50', OCR_MIN_CONFIDENCE - 0.01)).toBeNull()
    expect(finalizeOcrText('TOTAL 12.50', OCR_MIN_CONFIDENCE)).toEqual({
      text: 'TOTAL 12.50',
      confidence: OCR_MIN_CONFIDENCE,
    })
  })
})
