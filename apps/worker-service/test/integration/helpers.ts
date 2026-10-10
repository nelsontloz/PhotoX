import { createHash, randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Test } from '@nestjs/testing'
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
import { CleanupProcessor } from '../../src/queue/cleanup.processor'
import { CleanupOrphansProcessor } from '../../src/queue/cleanup-orphans.processor'
import { FakeCoreClient, makeAsset, makeFileRecord } from '../fake-core-client'
import { setupRedis, teardownRedis } from './test-setup'

export interface TestApp {
  app: INestApplicationContext
  storage: LocalStorageService
  storageDir: string
  fake: FakeCoreClient
  getQueue(name: string): Queue
}

export interface CreateTestAppOptions {
  detect?: FaceDetectorService['detect']
  // 'media' wires only the four media processors (thumbnail/video/metadata/face); default all seven
  processors?: 'all' | 'media'
}

// ponytail: Redis-only harness for the worker's processors — no Postgres anywhere in the worker.
// Processors start via their own OnModuleInit hook when moduleRef.init() runs.
export async function createTestApp(opts: CreateTestAppOptions = {}): Promise<TestApp> {
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
          : [FaceClusterService, CleanupProcessor, CleanupOrphansProcessor]),
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
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await cond()) return
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`Condition not met within ${timeoutMs}ms`)
}

export async function waitForJob(
  queue: Queue,
  jobId: string,
  timeoutMs = 30_000,
): Promise<'completed' | 'failed'> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const job = await queue.getJob(jobId)
    if (job) {
      const state = await job.getState()
      if (state === 'completed' || state === 'failed') return state
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`Job ${jobId} did not finish in ${timeoutMs}ms`)
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
