import { describe, it, expect, vi, afterEach } from 'vitest'
import { hashBytes, hashFile, terminate } from './hash'

const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
const ABC_SHA256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
const FOX_SHA256 = 'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592'

describe('hashBytes', () => {
  it('hashes empty input to the SHA-256 empty vector', () => {
    expect(hashBytes([])).toBe(EMPTY_SHA256)
  })

  it('hashes "abc" to the known SHA-256 vector', () => {
    expect(hashBytes([new TextEncoder().encode('abc')])).toBe(ABC_SHA256)
  })

  it('matches the whole-file digest regardless of chunk boundaries', () => {
    const bytes = new TextEncoder().encode('The quick brown fox jumps over the lazy dog')
    expect(hashBytes([bytes])).toBe(FOX_SHA256)
    for (let split = 0; split <= bytes.length; split++) {
      expect(hashBytes([bytes.slice(0, split), bytes.slice(split)])).toBe(FOX_SHA256)
    }
    expect(hashBytes([bytes.slice(0, 10), bytes.slice(10, 20), bytes.slice(20)])).toBe(FOX_SHA256)
    expect(hashBytes([new Uint8Array(0), bytes, new Uint8Array(0)])).toBe(FOX_SHA256)
  })
})

describe('hashFile fail-open', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    terminate()
  })

  it('resolves null when Worker is unavailable', async () => {
    vi.stubGlobal('Worker', undefined)
    const file = new File(['abc'], 'abc.txt', { type: 'text/plain' })
    await expect(hashFile(file)).resolves.toBeNull()
  })
})
