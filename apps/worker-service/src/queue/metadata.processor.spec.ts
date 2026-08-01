import { branchFor } from './metadata.processor'

describe('branchFor', () => {
  it('branches on the probed mime type', () => {
    expect(branchFor('image/jpeg')).toBe('photo')
    expect(branchFor('image/heic')).toBe('photo')
    expect(branchFor('video/mp4')).toBe('video')
    expect(branchFor('video/webm')).toBe('video')
  })

  it('returns null for unknown or missing mime types', () => {
    expect(branchFor('application/octet-stream')).toBeNull()
    expect(branchFor(null)).toBeNull()
    expect(branchFor('')).toBeNull()
  })
})
