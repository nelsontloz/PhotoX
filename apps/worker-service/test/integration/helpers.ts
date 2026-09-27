import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Test } from '@nestjs/testing'
import { ConfigModule } from '@nestjs/config'
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm'
import type { INestApplicationContext } from '@nestjs/common'
import type { Queue } from 'bullmq'
import { DataSource, Repository } from 'typeorm'
import {
  Asset,
  AssetThumbnail,
  Face,
  FileRecord,
  LocalStorageService,
  Person,
} from '@photox/data-access'
import { BullMqService } from '../../src/queue/bullmq.service'
import { ThumbnailProcessor } from '../../src/queue/thumbnail.processor'
import { VideoProcessor } from '../../src/queue/video.processor'
import { MetadataProcessor } from '../../src/queue/metadata.processor'
import { MetadataExtractor, VideoMetadataExtractor } from '../../src/queue/metadata.extractor'
import { FaceDetectorService } from '../../src/queue/face.detector'
import { FaceProcessor } from '../../src/queue/face.processor'
import { FaceClusterService } from '../../src/queue/face.cluster'
import { CleanupProcessor } from '../../src/queue/cleanup.processor'
import { CleanupOrphansProcessor } from '../../src/queue/cleanup-orphans.processor'
import { setupTestInfra, teardownTestInfra } from './test-setup'

export interface TestApp {
  app: INestApplicationContext
  dataSource: DataSource
  storage: LocalStorageService
  storageDir: string
  fileRepo: Repository<FileRecord>
  assetRepo: Repository<Asset>
  thumbRepo: Repository<AssetThumbnail>
  faceRepo: Repository<Face>
  personRepo: Repository<Person>
  getQueue(name: string): Queue
}

export interface CreateTestAppOptions {
  detect?: FaceDetectorService['detect']
}

// ponytail: explicit module instead of AppModule — SharedDatabaseModule.forRoot() reads env at import time, before the testcontainer ports exist; explicit TypeOrmModule.forRoot gets the mapped ports directly
export async function createTestApp(opts: CreateTestAppOptions = {}): Promise<TestApp> {
  const { pgHost, pgPort } = await setupTestInfra()

  const storageDir = mkdtempSync(join(tmpdir(), 'worker-int-storage-'))
  const prevStorageDir = process.env.STORAGE_DIR
  process.env.STORAGE_DIR = storageDir

  try {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        TypeOrmModule.forRoot({
          type: 'postgres',
          host: pgHost,
          port: pgPort,
          username: 'photox',
          password: 'photox',
          database: 'photox',
          entities: [FileRecord, Asset, AssetThumbnail, Face, Person],
          synchronize: true,
        }),
        TypeOrmModule.forFeature([FileRecord, Asset, AssetThumbnail, Face, Person]),
      ],
      providers: [
        BullMqService,
        LocalStorageService,
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
      dataSource: app.get(DataSource),
      storage: app.get(LocalStorageService),
      storageDir,
      fileRepo: app.get(getRepositoryToken(FileRecord)),
      assetRepo: app.get(getRepositoryToken(Asset)),
      thumbRepo: app.get(getRepositoryToken(AssetThumbnail)),
      faceRepo: app.get(getRepositoryToken(Face)),
      personRepo: app.get(getRepositoryToken(Person)),
      getQueue: (name: string) => bullMq.getQueue(name),
    }
  } catch (err) {
    if (prevStorageDir === undefined) delete process.env.STORAGE_DIR
    else process.env.STORAGE_DIR = prevStorageDir
    throw err
  }
}

export async function resetDb(testApp: TestApp): Promise<void> {
  await testApp.dataSource.query(
    'TRUNCATE faces, persons, asset_thumbnails, assets, files RESTART IDENTITY CASCADE',
  )
  rmSync(testApp.storageDir, { recursive: true, force: true })
  await testApp.storage.ensureDir()
}

export async function closeTestApp(testApp: TestApp): Promise<void> {
  await testApp.app.close()
  await teardownTestInfra()
  rmSync(testApp.storageDir, { recursive: true, force: true })
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
