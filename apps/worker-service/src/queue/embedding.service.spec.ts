import { describe, expect, it } from 'vitest'
import { SEARCH_EMBEDDING_DIM, toEmbedding } from '@photox/shared-types'

describe('toEmbedding', () => {
  it('L2-normalizes a full-dim vector', () => {
    const raw = new Float32Array(SEARCH_EMBEDDING_DIM)
    raw[0] = 3
    raw[1] = 4

    const out = toEmbedding(raw)

    expect(out).toHaveLength(SEARCH_EMBEDDING_DIM)
    expect(out[0]).toBeCloseTo(0.6, 6)
    expect(out[1]).toBeCloseTo(0.8, 6)
    expect(Math.hypot(out[0]!, out[1]!)).toBeCloseTo(1, 6)
  })

  it('rejects a wrong-dim vector before normalizing', () => {
    expect(() => toEmbedding(new Float32Array(512))).toThrow(/expected 768/)
  })
})
