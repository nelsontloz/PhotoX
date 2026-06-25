import { describe, it, expect } from 'vitest'
import { getHlsPlaylistUrl, getVideoStreamUrl } from './assets'

describe('video URL builders', () => {
  it('getHlsPlaylistUrl targets the gateway through the /api prefix', () => {
    expect(getHlsPlaylistUrl('asset-1')).toBe('/api/v1/videos/asset-1/playlist.m3u8')
  })

  it('getVideoStreamUrl targets the gateway through the /api prefix and includes userId', () => {
    expect(getVideoStreamUrl('asset-1', 'user-1')).toBe(
      '/api/v1/videos/asset-1/stream?userId=user-1',
    )
  })

  it('getVideoStreamUrl encodes special characters in userId', () => {
    const url = getVideoStreamUrl('asset-1', 'user id with spaces')
    expect(url).toBe('/api/v1/videos/asset-1/stream?userId=user+id+with+spaces')
  })
})
