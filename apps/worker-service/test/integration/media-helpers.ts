import { mkdir, writeFile } from 'node:fs/promises'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { Test } from '@nestjs/testing'
import { ConfigModule } from '@nestjs/config'
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
import { FakeCoreClient, makeAsset, makeFileRecord } from '../fake-core-client'
import { setupRedis, teardownRedis } from './test-setup'

export interface MediaTestApp {
  app: INestApplicationContext
  storage: LocalStorageService
  storageDir: string
  fake: FakeCoreClient
  getQueue(name: string): Queue
}

export interface CreateMediaTestAppOptions {
  detect?: FaceDetectorService['detect']
}

// ponytail: Redis-only harness for the four media processors — no Postgres, DB access is faked
export async function createMediaTestApp(
  opts: CreateMediaTestAppOptions = {},
): Promise<MediaTestApp> {
  await setupRedis()

  const storageDir = mkdtempSync(join(tmpdir(), 'worker-media-storage-'))
  process.env.STORAGE_DIR = storageDir

  try {
    const storage = new LocalStorageService()
    const fake = new FakeCoreClient(storage)
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true })],
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
      ],
    }).compile()

    await moduleRef.init()
    const app = moduleRef as unknown as INestApplicationContext

    for (const p of [
      app.get(ThumbnailProcessor),
      app.get(VideoProcessor),
      app.get(MetadataProcessor),
      app.get(FaceProcessor),
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

export async function closeMediaTestApp(testApp: MediaTestApp): Promise<void> {
  await testApp.app.close()
  await teardownRedis()
  rmSync(testApp.storageDir, { recursive: true, force: true })
}

export function resetMediaTestApp(testApp: MediaTestApp): void {
  testApp.fake.reset()
  rmSync(testApp.storageDir, { recursive: true, force: true })
}

export async function seedOriginal(
  testApp: MediaTestApp,
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
