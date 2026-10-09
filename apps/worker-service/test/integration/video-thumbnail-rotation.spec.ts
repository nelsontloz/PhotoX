import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import type { RegisterFileInput } from '../../src/core/core-client.service'
import { FFMPEG_PATH } from '../../src/queue/ffmpeg'
import { waitForJob, waitUntil } from './helpers'
import {
  closeMediaTestApp,
  createMediaTestApp,
  resetMediaTestApp,
  seedOriginal,
  type MediaTestApp,
} from './media-helpers'

const FIXTURE_DIR = mkdtempSync(join(tmpdir(), 'video-thumb-rot-'))
const LANDSCAPE_PATH = join(FIXTURE_DIR, 'landscape.mp4')

function makeLandscapeMp4(): Buffer {
  if (!FFMPEG_PATH) throw new Error('ffmpeg binary not available')
  execFileSync(
    FFMPEG_PATH,
    [
      '-f',
      'lavfi',
      '-i',
      'color=c=red:s=320x240:d=1',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-t',
      '1',
      '-y',
      LANDSCAPE_PATH,
    ],
    { timeout: 30_000, stdio: 'pipe' },
  )
  return readFileSync(LANDSCAPE_PATH)
}

describe('VideoThumbnailRotation (integration)', () => {
  let testApp: MediaTestApp
  let landscapeBuffer: Buffer

  beforeAll(async () => {
    landscapeBuffer = makeLandscapeMp4()
    testApp = await createMediaTestApp()
  }, 120_000)

  afterAll(async () => {
    await closeMediaTestApp(testApp)
    rmSync(FIXTURE_DIR, { recursive: true, force: true })
  })

  beforeEach(() => {
    resetMediaTestApp(testApp)
  })

  function seedVideo(
    userId: string,
    orientation: number | null,
    metadataStatus: 'pending' | 'ready',
    durationSeconds: number | null,
  ) {
    return seedOriginal(testApp, {
      userId,
      bytes: landscapeBuffer,
      mimeType: 'video/mp4',
      ext: 'mp4',
      asset: { kind: 'video', orientation, metadataStatus, durationSeconds },
    })
  }

  async function runLgThumbnail(assetId: string, fileId: string, userId: string) {
    const queue = testApp.getQueue('process-thumbnail')
    const job = await queue.add('thumbnail', { assetId, fileId, size: 'lg', userId })
    const state = await waitForJob(queue, job.id!)
    expect(state).toBe('completed')
    const updated = testApp.fake.assets.get(assetId)!
    expect(updated.thumbnailStatus).toBe('ready')
    const dto = testApp.fake.callsOf('registerFile').at(-1)!.args[0] as RegisterFileInput
    const key = testApp.storage.buildKey('thumbnail', userId, dto.id, dto.ext)
    const bytes = await readFile(testApp.storage.pathFor(key))
    return sharp(bytes).metadata()
  }

  it('rotates portrait for orientation 90', async () => {
    const userId = randomUUID()
    const { record, asset } = await seedVideo(userId, 90, 'ready', 1)
    const meta = await runLgThumbnail(asset.id, record.id, userId)
    expect(meta.height).toBeGreaterThan(meta.width)
  })

  it('rotates portrait for orientation -90', async () => {
    const userId = randomUUID()
    const { record, asset } = await seedVideo(userId, -90, 'ready', 1)
    const meta = await runLgThumbnail(asset.id, record.id, userId)
    expect(meta.height).toBeGreaterThan(meta.width)
  })

  it('passes landscape through for orientation null', async () => {
    const userId = randomUUID()
    const { record, asset } = await seedVideo(userId, null, 'ready', 1)
    const meta = await runLgThumbnail(asset.id, record.id, userId)
    expect(meta.width).toBeGreaterThan(meta.height)
  })

  it('defers while metadata is pending, then picks up the orientation it writes', async () => {
    const userId = randomUUID()
    const { record, asset } = await seedVideo(userId, null, 'pending', null)

    const queue = testApp.getQueue('process-thumbnail')
    const first = await queue.add('thumbnail', {
      assetId: asset.id,
      fileId: record.id,
      size: 'lg',
      userId,
    })
    // the first attempt only defers — no thumbnail work yet
    expect(await waitForJob(queue, first.id!)).toBe('completed')
    expect(testApp.fake.callsOf('registerThumbnail')).toHaveLength(0)

    // metadata lands while the delayed re-enqueue waits; the deferred job's own fetch sees it
    Object.assign(testApp.fake.assets.get(asset.id)!, {
      metadataStatus: 'ready',
      orientation: 90,
      durationSeconds: 1,
    })
    await waitUntil(() => testApp.fake.callsOf('registerThumbnail').length > 0)

    expect(testApp.fake.callsOf('getAsset').length).toBeGreaterThanOrEqual(2)
    expect(testApp.fake.assets.get(asset.id)!.thumbnailStatus).toBe('ready')

    const dto = testApp.fake.callsOf('registerFile').at(-1)!.args[0] as RegisterFileInput
    const key = testApp.storage.buildKey('thumbnail', userId, dto.id, dto.ext)
    const meta = await sharp(await readFile(testApp.storage.pathFor(key))).metadata()
    expect(meta.height).toBeGreaterThan(meta.width)
  }, 30_000)

  it('fails the deferred job fast when the asset disappears', async () => {
    const userId = randomUUID()
    const { record, asset } = await seedVideo(userId, null, 'pending', null)

    const queue = testApp.getQueue('process-thumbnail')
    const first = await queue.add('thumbnail', {
      assetId: asset.id,
      fileId: record.id,
      size: 'lg',
      userId,
    })
    expect(await waitForJob(queue, first.id!)).toBe('completed')

    testApp.fake.assets.delete(asset.id)

    // the deferred job fetches the asset itself and the fake throws UnrecoverableError, so that
    // one fetch fails the job — no 4×1s poll and no retry
    await waitUntil(() => testApp.fake.callsOf('getAsset').length >= 2)
    // settle window: a plain-error retry (exponential backoff ~1s) would fetch a third time
    await new Promise((r) => setTimeout(r, 1500))
    expect(testApp.fake.callsOf('getAsset')).toHaveLength(2)
    expect(testApp.fake.callsOf('registerThumbnail')).toHaveLength(0)
  }, 30_000)
})
