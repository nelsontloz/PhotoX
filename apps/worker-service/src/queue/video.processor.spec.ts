import { describe, it, expect, vi } from 'vitest'
import { of } from 'rxjs'
import { rm, stat } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'node:crypto'
import { HttpService } from '@nestjs/axios'
import {
  buildAbrArgs,
  ABR_LADDER,
  HDR_TONEMAP_FILTER,
  isHdrStream,
  detectTranspose,
  VideoProcessor,
} from './video.processor'
import { BullMqService } from './bullmq.service'
import { HlsHttpClient } from '../storage/hls-http.client'
import type { FfprobeStream } from './ffmpeg'

describe('buildAbrArgs', () => {
  it('produces correct ffmpeg args for a 1080p source without audio', () => {
    const args = buildAbrArgs('/tmp/src.mp4', '/tmp/out', ABR_LADDER)

    expect(args[0]).toBe('-y')
    expect(args[1]).toBe('-i')
    expect(args[2]).toBe('/tmp/src.mp4')

    expect(args).toContain('-filter_complex')
    const filterIdx = args.indexOf('-filter_complex')
    const filterVal = args[filterIdx + 1]
    expect(filterVal).toContain('split=5')
    expect(filterVal).not.toContain('anull')

    expect(args).toContain('libx264')
    expect(args).toContain('-f')
    expect(args).toContain('hls')
    expect(args).toContain('-hls_time')
    expect(args).toContain('6')
    expect(args).toContain('-hls_playlist_type')
    expect(args).toContain('vod')
    expect(args).toContain('-hls_segment_type')
    expect(args).toContain('fmp4')
    expect(args).toContain('-master_pl_name')
    expect(args).toContain('master.m3u8')
    expect(args).toContain('-var_stream_map')

    const mapIdx = args.indexOf('-var_stream_map')
    const mapVal = args[mapIdx + 1]
    expect(mapVal).toBe('v:0 v:1 v:2 v:3 v:4')

    expect(args).toContain('-b:v:0')
    expect(args).toContain('4500k')
    expect(args).toContain('-b:v:4')
    expect(args).toContain('400k')
    expect(args).not.toContain('-c:a')
    expect(args).not.toContain('aac')
    expect(args).not.toContain('-b:a')
    expect(args).not.toContain('128k')

    const lastArg = args[args.length - 1]
    expect(lastArg).toBe('/tmp/out/%v/playlist.m3u8')
  })

  it('produces correct ffmpeg args for a 1080p source with audio', () => {
    const args = buildAbrArgs('/tmp/src.mp4', '/tmp/out', ABR_LADDER, { hasAudio: true })

    const filterIdx = args.indexOf('-filter_complex')
    const filterVal = args[filterIdx + 1]!
    expect(filterVal).toContain('split=5')
    expect(filterVal).not.toContain('anull')

    const mapIdx = args.indexOf('-var_stream_map')
    const mapVal = args[mapIdx + 1]
    expect(mapVal).toBe('v:0,a:0 v:1,a:1 v:2,a:2 v:3,a:3 v:4,a:4')

    const audioMapCount = args.filter((a, i) => a === '-map' && args[i + 1] === '0:a:0').length
    expect(audioMapCount).toBe(ABR_LADDER.length)

    expect(args).toContain('-c:a')
    expect(args).toContain('aac')
    expect(args).toContain('-b:a')
    expect(args).toContain('128k')
    expect(args).toContain('-ac')
    expect(args).toContain('2')
  })

  it('audio var_stream_map is type-relative (v:N,a:N per variant)', () => {
    const smallLadder = ABR_LADDER.slice(0, 3)
    const args = buildAbrArgs('/tmp/src.mp4', '/tmp/out', smallLadder, { hasAudio: true })

    const mapIdx = args.indexOf('-var_stream_map')
    const mapVal = args[mapIdx + 1]
    expect(mapVal).toBe('v:0,a:0 v:1,a:1 v:2,a:2')
  })

  it('filters ladder by source height but keeps lowest variant', () => {
    const smallLadder = [
      {
        name: '0',
        width: 1920,
        height: 1080,
        vBitrate: '4500k',
        maxRate: '5500k',
        bufSize: '11000k',
      },
      {
        name: '1',
        width: 1280,
        height: 720,
        vBitrate: '2800k',
        maxRate: '3500k',
        bufSize: '7000k',
      },
      { name: '2', width: 854, height: 480, vBitrate: '1400k', maxRate: '1800k', bufSize: '3600k' },
      { name: '3', width: 640, height: 360, vBitrate: '800k', maxRate: '1000k', bufSize: '2000k' },
      { name: '4', width: 426, height: 240, vBitrate: '400k', maxRate: '500k', bufSize: '1000k' },
    ]
    const args = buildAbrArgs('/tmp/src.mp4', '/tmp/out', smallLadder)

    const filterIdx = args.indexOf('-filter_complex')
    const filterVal = args[filterIdx + 1]
    expect(filterVal).toContain('split=5')
    expect(filterVal).toContain('[v1out]')
    expect(filterVal).toContain('[v5out]')
  })

  it('uses correct segment filename pattern', () => {
    const args = buildAbrArgs('/tmp/src.mp4', '/tmp/out', ABR_LADDER)
    expect(args).toContain('-hls_segment_filename')
    const segIdx = args.indexOf('-hls_segment_filename')
    expect(args[segIdx + 1]).toBe('/tmp/out/%v/seg_%03d.m4s')
  })

  it('includes HDR tonemap filter when hdrFilter is provided', () => {
    const args = buildAbrArgs('/tmp/src.mp4', '/tmp/out', ABR_LADDER, {
      hdrFilter: HDR_TONEMAP_FILTER,
    })
    const filterIdx = args.indexOf('-filter_complex')
    const filterVal = args[filterIdx + 1]
    expect(filterVal).toContain(HDR_TONEMAP_FILTER)
    expect(filterVal).toContain('split=5')
    expect(filterVal).toContain('zscale=t=linear:npl=100')
    expect(filterVal).toContain('tonemap=hable:desat=0')
  })

  it('includes transpose=1 when transpose is 1', () => {
    const args = buildAbrArgs('/tmp/src.mp4', '/tmp/out', ABR_LADDER, { transpose: 1 })
    const filterIdx = args.indexOf('-filter_complex')
    const filterVal = args[filterIdx + 1]
    expect(filterVal).toContain('transpose=1')
    expect(filterVal).toContain('split=5')
  })

  it('includes both HDR tonemap and transpose in correct order', () => {
    const args = buildAbrArgs('/tmp/src.mp4', '/tmp/out', ABR_LADDER, {
      hdrFilter: HDR_TONEMAP_FILTER,
      transpose: 1,
    })
    const filterIdx = args.indexOf('-filter_complex')
    const filterVal = args[filterIdx + 1]!

    const tonemapIdx = filterVal.indexOf(HDR_TONEMAP_FILTER)
    const transposeIdx = filterVal.indexOf('transpose=1')
    const splitIdx = filterVal.indexOf('split=5')
    expect(tonemapIdx).toBeGreaterThan(-1)
    expect(transposeIdx).toBeGreaterThan(-1)
    expect(splitIdx).toBeGreaterThan(-1)
    expect(tonemapIdx).toBeLessThan(transposeIdx)
    expect(transposeIdx).toBeLessThan(splitIdx)
  })

  it('does NOT include transpose when transpose is 0', () => {
    const args = buildAbrArgs('/tmp/src.mp4', '/tmp/out', ABR_LADDER, { transpose: 0 })
    const filterIdx = args.indexOf('-filter_complex')
    const filterVal = args[filterIdx + 1]!
    expect(filterVal).not.toContain('transpose=')
    expect(filterVal).toContain('split=5')
  })

  it('produces same args as no-options case when no preprocess filters', () => {
    const baseArgs = buildAbrArgs('/tmp/src.mp4', '/tmp/out', ABR_LADDER)
    const noOptArgs = buildAbrArgs('/tmp/src.mp4', '/tmp/out', ABR_LADDER, {})
    expect(baseArgs).toEqual(noOptArgs)
  })
})

describe('isHdrStream', () => {
  it('returns true for bt2020 + smpte2084', () => {
    const stream = { color_primaries: 'bt2020', color_transfer: 'smpte2084' } as FfprobeStream
    expect(isHdrStream(stream)).toBe(true)
  })

  it('returns true for bt2020 + arib-std-b67', () => {
    const stream = { color_primaries: 'bt2020', color_transfer: 'arib-std-b67' } as FfprobeStream
    expect(isHdrStream(stream)).toBe(true)
  })

  it('returns false for bt709 transfer', () => {
    const stream = { color_primaries: 'bt2020', color_transfer: 'bt709' } as FfprobeStream
    expect(isHdrStream(stream)).toBe(false)
  })

  it('returns false for undefined color_primaries', () => {
    const stream = { color_transfer: 'smpte2084' } as FfprobeStream
    expect(isHdrStream(stream)).toBe(false)
  })

  it('returns false for undefined stream', () => {
    expect(isHdrStream(undefined)).toBe(false)
  })

  it('returns false for sRGB primaries', () => {
    const stream = { color_primaries: 'bt709', color_transfer: 'smpte2084' } as FfprobeStream
    expect(isHdrStream(stream)).toBe(false)
  })
})

describe('detectTranspose', () => {
  it('returns 1 for 90° rotation via tags.rotate', () => {
    const stream = { tags: { rotate: '90' } } as unknown as FfprobeStream
    expect(detectTranspose(stream)).toBe(1)
  })

  it('returns 2 for 180° rotation', () => {
    const stream = { tags: { rotate: '180' } } as unknown as FfprobeStream
    expect(detectTranspose(stream)).toBe(2)
  })

  it('returns 3 for 270° rotation', () => {
    const stream = { tags: { rotate: '270' } } as unknown as FfprobeStream
    expect(detectTranspose(stream)).toBe(3)
  })

  it('returns 0 for 0° rotation', () => {
    const stream = { tags: { rotate: '0' } } as unknown as FfprobeStream
    expect(detectTranspose(stream)).toBe(0)
  })

  it('falls back to side_data_list rotation', () => {
    const stream = {
      side_data_list: [{ side_data_type: 'Display Matrix', rotation: 90 }],
    } as unknown as FfprobeStream
    expect(detectTranspose(stream)).toBe(1)
  })

  it('returns 0 for undefined stream', () => {
    expect(detectTranspose(undefined)).toBe(0)
  })

  it('returns 0 when no rotation info', () => {
    const stream = { codec_name: 'h264' } as FfprobeStream
    expect(detectTranspose(stream)).toBe(0)
  })
})

describe('VideoProcessor.downloadSource', () => {
  it('creates the destination directory before writing the source file', async () => {
    const fileId = randomUUID()
    const destDir = join(tmpdir(), `photox-vp-test-${fileId}`)
    const fileBytes = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7])
    const presignedUrl = 'http://127.0.0.1:1/never-fetched.mp4'

    const http = {
      get: vi
        .fn()
        .mockReturnValueOnce(of({ data: { url: presignedUrl }, headers: {}, status: 200 } as never))
        .mockReturnValueOnce(
          of({
            data: fileBytes,
            headers: { 'content-type': 'video/mp4' },
            status: 200,
          } as never),
        ),
    } as unknown as HttpService

    const processor = new VideoProcessor({} as BullMqService, http, {} as HlsHttpClient)

    const downloadSource = (
      processor as unknown as {
        downloadSource: (id: string, dir: string) => Promise<string>
      }
    ).downloadSource.bind(processor)

    const result = await downloadSource(fileId, destDir)

    expect(result).toBe(join(destDir, 'source.mp4'))
    const fileStat = await stat(result)
    expect(fileStat.isFile()).toBe(true)
    expect(fileStat.size).toBe(fileBytes.length)

    await rm(destDir, { recursive: true, force: true })
  })
})
