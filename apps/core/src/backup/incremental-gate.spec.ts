import { describe, expect, it } from 'vitest'
import { shouldSkipUpload } from './user-backup.service'

const file = { id: 'file-1', checksumSha256: 'abc', sizeBytes: 10 }
const key = 'backups/a__u1/originals/file-1.bin'

function prevWith(entry: { checksumSha256: string; sizeBytes: number }) {
  return new Map([['file-1', entry]])
}

describe('shouldSkipUpload', () => {
  it('skips when id + checksum + size + listed all hold', () => {
    const prev = prevWith({ checksumSha256: 'abc', sizeBytes: 10 })
    expect(shouldSkipUpload(prev, new Set([key]), file, key)).toBe(true)
  })

  it('uploads when the previous map is null', () => {
    expect(shouldSkipUpload(null, new Set([key]), file, key)).toBe(false)
  })

  it('uploads when the id is unknown', () => {
    const prev = new Map([['other', { checksumSha256: 'abc', sizeBytes: 10 }]])
    expect(shouldSkipUpload(prev, new Set([key]), file, key)).toBe(false)
  })

  it('uploads when the checksum changed', () => {
    const prev = prevWith({ checksumSha256: 'different', sizeBytes: 10 })
    expect(shouldSkipUpload(prev, new Set([key]), file, key)).toBe(false)
  })

  it('uploads when the size changed', () => {
    const prev = prevWith({ checksumSha256: 'abc', sizeBytes: 11 })
    expect(shouldSkipUpload(prev, new Set([key]), file, key)).toBe(false)
  })

  it('uploads when the key is S3-missing despite a manifest match', () => {
    const prev = prevWith({ checksumSha256: 'abc', sizeBytes: 10 })
    expect(shouldSkipUpload(prev, new Set(), file, key)).toBe(false)
  })

  it('uploads when every conjunct fails at once', () => {
    expect(shouldSkipUpload(null, new Set(), { ...file, id: 'ghost' }, 'missing')).toBe(false)
  })
})
