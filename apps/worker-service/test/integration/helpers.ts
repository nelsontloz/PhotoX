import { createHash, randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Test } from '@nestjs/testing'
import { vi } from 'vitest'
import type { INestApplicationContext } from '@nestjs/common'
import type { Queue } from 'bullmq'
import type { Asset, FileRecord } from '@photox/shared-types'
import { LocalStorageService } from '@photox/shared-config'
import { BullMqService } from '../../src/queue/bullmq.service'
import { CoreClient } from '../../src/core/core-client.service'
import { ThumbnailProcessor } from '../../src/queue/thumbnail.processor'
import { VideoProcessor } from '../../src/queue/video.processor'
import { MetadataProcessor } from '../../src/queue/metadata.processor'
import { MetadataExtractor, VideoMetadataExtractor } from '../../src/queue/metadata.extractor'
import { FaceDetectorService } from '../../src/queue/face.detector'
import { FaceProcessor } from '../../src/queue/face.processor'
import { FaceClusterService } from '../../src/queue/face.cluster'
import { EmbeddingService } from '../../src/queue/embedding.service'
import { EmbeddingProcessor } from '../../src/queue/embed.processor'
import { OcrService } from '../../src/queue/ocr.service'
import { OcrProcessor } from '../../src/queue/ocr.processor'
import { DetectService } from '../../src/queue/detect.service'
import { DetectProcessor } from '../../src/queue/detect.processor'
import { FakeCoreClient, makeAsset, makeFileRecord } from '../fake-core-client'
import { setupRedis, teardownRedis } from './test-setup'

export { signJob } from '../sign-job'

export interface TestApp {
  app: INestApplicationContext
  storage: LocalStorageService
  storageDir: string
  fake: FakeCoreClient
  getQueue(name: string): Queue
}

export interface CreateTestAppOptions {
  detect?: FaceDetectorService['detect']
  // 'media' wires only the four media processors (thumbnail/video/metadata/face); default all eight
  processors?: 'all' | 'media'
}

// ponytail: Redis-only harness for the worker's processors — no Postgres anywhere in the worker.
// Processors start via their own OnModuleInit hook when moduleRef.init() runs.
export async function createTestApp(opts: CreateTestAppOptions = {}): Promise<TestApp> {
  // must run before the testing module compiles: BullMqService.onModuleInit reads loadEnv()
  // (REDIS_HOST/REDIS_PORT/REDIS_DB) when moduleRef.init() runs, so the slot this file claimed
  // has to be in process.env by then
  await setupRedis()

  const storageDir = mkdtempSync(join(tmpdir(), 'worker-int-storage-'))
  process.env.STORAGE_DIR = storageDir

  try {
    const storage = new LocalStorageService()
    const fake = new FakeCoreClient(storage)
    const moduleRef = await Test.createTestingModule({
      providers: [
        BullMqService,
        { provide: LocalStorageService, useValue: storage },
        { provide: CoreClient, useValue: fake },
        ThumbnailProcessor,
        VideoProcessor,
        MetadataProcessor,
        MetadataExtractor,
        VideoMetadataExtractor,
        {
          provide: FaceDetectorService,
          useValue: { detect: opts.detect ?? vi.fn().mockResolvedValue([]) },
        },
        FaceProcessor,
        ...(opts.processors === 'media'
          ? []
          : [
              FaceClusterService,
              EmbeddingService,
              EmbeddingProcessor,
              OcrService,
              OcrProcessor,
              DetectService,
              DetectProcessor,
            ]),
      ],
    }).compile()

    await moduleRef.init()
    const app = moduleRef as unknown as INestApplicationContext
    const bullMq = app.get(BullMqService)

    return {
      app,
      storage,
      storageDir,
      fake,
      getQueue: (name: string) => bullMq.getQueue(name),
    }
  } catch (err) {
    await teardownRedis()
    throw err
  }
}

export async function resetTestApp(testApp: TestApp): Promise<void> {
  testApp.fake.reset()
  rmSync(testApp.storageDir, { recursive: true, force: true })
  await testApp.storage.ensureDir()
}

export async function closeTestApp(testApp: TestApp): Promise<void> {
  await testApp.app.close()
  await teardownRedis()
  rmSync(testApp.storageDir, { recursive: true, force: true })
}

export async function waitUntil(
  cond: () => boolean | Promise<boolean>,
  timeoutMs = 30_000,
): Promise<void> {
  await vi.waitUntil(cond, { timeout: timeoutMs, interval: 100 })
}

export async function waitForJob(
  queue: Queue,
  jobId: string,
  timeoutMs = 30_000,
): Promise<'completed' | 'failed'> {
  return vi.waitFor(
    async () => {
      const job = await queue.getJob(jobId)
      const state = job ? await job.getState() : undefined
      if (state !== 'completed' && state !== 'failed') {
        throw new Error(`Job ${jobId} did not finish yet`)
      }
      return state
    },
    { timeout: timeoutMs, interval: 100 },
  )
}

export async function seedOriginal(
  testApp: TestApp,
  opts: {
    userId: string
    bytes: Buffer
    mimeType: string
    ext: string
    asset?: Partial<Asset>
  },
): Promise<{ record: FileRecord; asset: Asset }> {
  const fileId = randomUUID()
  const storageKey = testApp.storage.buildKey('original', opts.userId, fileId, opts.ext)
  await mkdir(dirname(testApp.storage.pathFor(storageKey)), { recursive: true })
  await writeFile(testApp.storage.pathFor(storageKey), opts.bytes)

  const record = makeFileRecord({
    id: fileId,
    userId: opts.userId,
    storageKey,
    originalName: `source.${opts.ext}`,
    mimeType: opts.mimeType,
    sizeBytes: opts.bytes.length,
    checksumSha256: createHash('sha256').update(opts.bytes).digest('hex'),
  })
  testApp.fake.files.set(record.id, record)

  const asset = makeAsset({
    id: randomUUID(),
    userId: opts.userId,
    fileId: record.id,
    kind: opts.mimeType.startsWith('video/') ? 'video' : 'photo',
    ...opts.asset,
  })
  testApp.fake.assets.set(asset.id, asset)

  return { record, asset }
}
