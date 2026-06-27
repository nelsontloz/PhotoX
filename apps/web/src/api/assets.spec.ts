import { describe, it, expect } from 'vitest'
import { getVideoStreamUrl } from './assets'

describe('video URL builders', () => {
  it('getVideoStreamUrl targets the gateway through the /api prefix and includes userId', () => {
    expect(getVideoStreamUrl('file-1', 'user-1')).toBe('/api/v1/files/file-1/stream?userId=user-1')
  })

  it('getVideoStreamUrl encodes special characters in userId', () => {
    const url = getVideoStreamUrl('file-1', 'user id with spaces')
    expect(url).toBe('/api/v1/files/file-1/stream?userId=user+id+with+spaces')
  })
})
