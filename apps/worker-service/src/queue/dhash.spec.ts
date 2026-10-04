import { describe, expect, it } from 'vitest'
import { computeDhash, DHASH_HEIGHT, DHASH_WIDTH } from './dhash'

function pattern(fn: (x: number, y: number) => number): Uint8Array {
  const out = new Uint8Array(DHASH_WIDTH * DHASH_HEIGHT)
  for (let y = 0; y < DHASH_HEIGHT; y++) {
    for (let x = 0; x < DHASH_WIDTH; x++) {
      out[y * DHASH_WIDTH + x] = fn(x, y)
    }
  }
  return out
}

describe('computeDhash', () => {
  it('flat all-dark and all-light patterns hash to zero', () => {
    expect(
      computeDhash(
        pattern(() => 0),
        9,
        8,
      ),
    ).toBe('0000000000000000')
    expect(
      computeDhash(
        pattern(() => 255),
        9,
        8,
      ),
    ).toBe('0000000000000000')
  })

  it('hashes a vertical checkerboard to alternating 1010 nibbles', () => {
    expect(
      computeDhash(
        pattern((x) => (x % 2 === 0 ? 255 : 0)),
        9,
        8,
      ),
    ).toBe('aaaaaaaaaaaaaaaa')
  })

  it('sets the bit where a light column meets a dark column (right half dark)', () => {
    expect(
      computeDhash(
        pattern((x) => (x < 4 ? 255 : 0)),
        9,
        8,
      ),
    ).toBe('1010101010101010')
  })

  it('is deterministic and always 16 lowercase hex chars', () => {
    const img = pattern((x, y) => (x * 13 + y * 29) % 256)
    const first = computeDhash(img, 9, 8)
    expect(first).toBe(computeDhash(img, 9, 8))
    expect(first).toMatch(/^[0-9a-f]{16}$/)
  })

  it('rejects non-9x8 buffers', () => {
    expect(() => computeDhash(new Uint8Array(64), 8, 8)).toThrow()
  })
})
