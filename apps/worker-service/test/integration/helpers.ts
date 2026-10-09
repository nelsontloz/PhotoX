import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Test } from '@nestjs/testing'
import type { INestApplicationContext } from '@nestjs/common'
import type { Queue } from 'bullmq'
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
import { FakeCoreClient } from '../fake-core-client'
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
}

// ponytail: Redis-only harness for all 7 processors — no Postgres anywhere in the worker
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
        FaceClusterService,
        CleanupProcessor,
        CleanupOrphansProcessor,
      ],
    }).compile()

    await moduleRef.init()
    const app = moduleRef as unknown as INestApplicationContext

    for (const p of [
      app.get(ThumbnailProcessor),
      app.get(VideoProcessor),
      app.get(MetadataProcessor),
      app.get(FaceProcessor),
      app.get(FaceClusterService),
      app.get(CleanupProcessor),
      app.get(CleanupOrphansProcessor),
    ]) {
      p.start()
    }

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
