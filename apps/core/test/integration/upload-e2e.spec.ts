import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import sharp from 'sharp'
import { Test } from '@nestjs/testing'
import { ConfigModule } from '@nestjs/config'
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm'
import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { JwtModule, JwtService } from '@nestjs/jwt'
import type { Express } from 'express'
import type { Repository } from 'typeorm'
import { Asset, AssetThumbnail, Face, FileRecord, Person } from '@photox/data-access'
import { LocalStorageService, loadEnv } from '@photox/shared-config'
import { FACE_EMBEDDING_DIM } from '@photox/shared-types'
import { User } from '../../src/users/entities/user.entity'
import { RefreshToken } from '../../src/users/entities/refresh-token.entity'
import { Album } from '../../src/albums/entities/album.entity'
import { AlbumAsset } from '../../src/albums/entities/album-asset.entity'
import { AssetShare } from '../../src/shares/entities/asset-share.entity'
import { AssetsModule } from '../../src/assets/assets.module'
import { AlbumsModule } from '../../src/albums/albums.module'
import { SharesModule } from '../../src/shares/shares.module'
import { PersonsModule } from '../../src/persons/persons.module'
import { FacesModule } from '../../src/faces/faces.module'
import { UserFilesModule } from '../../src/files/user/user-files.module'
import { StorageModule } from '../../src/files/storage/storage.module'
import { AdminModule } from '../../src/admin/admin.module'
import { UsersModule } from '../../src/users/users.module'
import { AuthModule } from '../../src/auth/auth.module'
import { BullMqModule } from '../../src/queue/bullmq.module'
import { BullMqService as WorkerBullMqService } from '../../../worker-service/src/queue/bullmq.service'
import { ThumbnailProcessor } from '../../../worker-service/src/queue/thumbnail.processor'
import { VideoProcessor } from '../../../worker-service/src/queue/video.processor'
import { MetadataProcessor } from '../../../worker-service/src/queue/metadata.processor'
import {
  MetadataExtractor,
  VideoMetadataExtractor,
} from '../../../worker-service/src/queue/metadata.extractor'
import { FaceProcessor } from '../../../worker-service/src/queue/face.processor'
import {
  FaceDetectorService,
  type DetectedFace,
} from '../../../worker-service/src/queue/face.detector'
import {
  FACE_MODEL_FILE,
  FaceEmbedderService,
  alignFaceCrop,
} from '../../../worker-service/src/queue/face.embedder'
import { runFfmpeg } from '../../../worker-service/src/queue/ffmpeg'
import { CoreClient } from '../../../worker-service/src/core/core-client.service'
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter'
import { TEST_AUTH_SECRET, setupTestInfra, teardownTestInfra } from './test-setup'

const ENTITIES = [
  User,
  RefreshToken,
  Album,
  AlbumAsset,
  AssetShare,
  FileRecord,
  Asset,
  AssetThumbnail,
  Face,
  Person,
]

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function pollAsset(
  repo: Repository<Asset>,
  id: string,
  ready: (asset: Asset) => boolean,
  timeoutMs = 90_000,
): Promise<Asset> {
  const start = Date.now()
  for (;;) {
    const row = await repo.findOne({ where: { id } })
    if (row && ready(row)) return row
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out polling asset ${id}`)
    await sleep(500)
  }
}

async function uploadAsset(
  expressApp: Express,
  auth: Record<string, string>,
  bytes: Buffer,
  filename: string,
  contentType: string,
): Promise<string> {
  const res = await request(expressApp)
    .post('/api/v1/files')
    .set(auth)
    .attach('file', bytes, { filename, contentType })
  expect(res.status).toBe(201)
  return (res.body as unknown as { id: string }).id
}

// ponytail: ffmpeg-static fixture generation (via the worker's own helper so it resolves the
// worker's binary) — 2 frames of 64x64 (SVT-AV1 min width), AV1 encode stays fast
async function writeVideoFixture(
  path: string,
  opts: { videoCodec: 'libx264' | 'mpeg4'; withAudio: boolean },
): Promise<void> {
  const frameBytes = 64 * 64 * 3
  const input = Buffer.concat([Buffer.alloc(frameBytes, 0x20), Buffer.alloc(frameBytes, 0x80)])
  const args = [
    '-y',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    '-s',
    '64x64',
    '-r',
    '10',
    '-i',
    'pipe:0',
    ...(opts.withAudio
      ? ['-f', 'lavfi', '-i', 'anullsrc=channel_layout=mono:sample_rate=8000']
      : []),
    '-frames:v',
    '2',
    '-c:v',
    opts.videoCodec,
    '-pix_fmt',
    'yuv420p',
    ...(opts.withAudio ? ['-c:a', 'aac', '-t', '0.2'] : []),
    path,
  ]
  await runFfmpeg(args, { input, timeoutMs: 30_000 })
}

// ponytail: same shape a real detection has (box in resized coords + real embedding), but the
// embedder is the real ONNX service — landmarks are synthesised from the box like the detector's
// box-fraction fallback, then aligned and embedded for real
function syntheticDetect(
  embedder: FaceEmbedderService,
  box: { x: number; y: number; w: number; h: number },
  confidence = 0.99,
): (buffer: Buffer) => Promise<DetectedFace[]> {
  const points: [number, number][] = [
    [box.x + box.w * 0.35, box.y + box.h * 0.38],
    [box.x + box.w * 0.65, box.y + box.h * 0.38],
    [box.x + box.w * 0.5, box.y + box.h * 0.55],
    [box.x + box.w * 0.38, box.y + box.h * 0.75],
    [box.x + box.w * 0.62, box.y + box.h * 0.75],
  ]
  return async (buffer) => {
    const raw = await sharp(buffer).raw().toBuffer({ resolveWithObject: true })
    const aligned = alignFaceCrop(
      {
        data: raw.data,
        width: raw.info.width,
        height: raw.info.height,
        channels: raw.info.channels,
      },
      points,
    )
    return [{ box, confidence, embedding: await embedder.embed(aligned) }]
  }
}

async function enqueueAndWait(
  bullMq: WorkerBullMqService,
  queueName: string,
  data: Record<string, unknown>,
  timeoutMs = 60_000,
): Promise<void> {
  const job = await bullMq.getQueue(queueName).add(queueName, data)
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await job.isCompleted()) return
    if (await job.isFailed()) throw new Error(`Job ${job.id} on ${queueName} failed`)
    if (Date.now() > deadline) throw new Error(`Timed out waiting for job ${job.id}`)
    await sleep(200)
  }
}

describe('upload e2e pipeline', () => {
  let app: INestApplication
  let expressApp: Express
  let storage: LocalStorageService
  let storageDir = ''
  let prevCoreUrl: string | undefined
  let prevStorageDir: string | undefined
  let prevFaceModelPath: string | undefined
  let userRepo: Repository<User>
  let assetRepo: Repository<Asset>
  let thumbRepo: Repository<AssetThumbnail>
  let fileRepo: Repository<FileRecord>
  let faceRepo: Repository<Face>
  let jwt: JwtService
  let workerBullMq: WorkerBullMqService
  let detectImpl: (buffer: Buffer) => Promise<DetectedFace[]> = () => Promise.resolve([])
  const detectorMock = { detect: (buffer: Buffer) => detectImpl(buffer) }

  async function makeUser(email: string) {
    const user = await userRepo.save(
      userRepo.create({
        email,
        role: 'user',
        passwordHash: 'test-hash',
        displayName: 'E2E User',
      }),
    )
    const token = jwt.sign({ sub: user.id, email: user.email, role: user.role })
    return { user, auth: { Authorization: `Bearer ${token}` } }
  }

  beforeAll(async () => {
    const { pgHost, pgPort } = await setupTestInfra()
    // resolve the host's provisioned ONNX weights BEFORE STORAGE_DIR is repointed at the temp dir
    const modelPath =
      process.env.FACE_MODEL_PATH ?? join(loadEnv().STORAGE_DIR, 'models', FACE_MODEL_FILE)
    if (!existsSync(modelPath)) {
      throw new Error(
        `Face embedding model not found at ${modelPath} — run 'pnpm install' ` +
          `(face-model seed) or set FACE_MODEL_PATH to a ${FACE_MODEL_FILE} copy`,
      )
    }
    prevFaceModelPath = process.env.FACE_MODEL_PATH
    process.env.FACE_MODEL_PATH = modelPath

    storageDir = mkdtempSync(join(tmpdir(), 'api-e2e-storage-'))
    prevStorageDir = process.env.STORAGE_DIR
    process.env.STORAGE_DIR = storageDir
    prevCoreUrl = process.env.CORE_URL
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
            entities: ENTITIES,
            synchronize: true,
          }),
          TypeOrmModule.forFeature(ENTITIES),
          JwtModule.register({ secret: TEST_AUTH_SECRET, signOptions: { algorithm: 'HS256' } }),
          StorageModule,
          BullMqModule,
          AuthModule,
          UsersModule,
          AssetsModule,
          AlbumsModule,
          SharesModule,
          PersonsModule,
          FacesModule,
          UserFilesModule,
          AdminModule,
        ],
        providers: [
          WorkerBullMqService,
          CoreClient,
          ThumbnailProcessor,
          VideoProcessor,
          MetadataProcessor,
          MetadataExtractor,
          VideoMetadataExtractor,
          FaceEmbedderService,
          { provide: FaceDetectorService, useValue: detectorMock },
          FaceProcessor,
        ],
      }).compile()
      app = moduleRef.createNestApplication()
      app.useGlobalPipes(
        new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
      )
      app.useGlobalFilters(new HttpExceptionFilter())
      // real HTTP loopback: worker processors call CoreClient → this app (the E2E proof)
      await app.listen(0)
      const httpServer: unknown = app.getHttpServer()
      const address = (httpServer as { address(): { port: number } | string | null }).address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      process.env.CORE_URL = `http://127.0.0.1:${port}`
      expressApp = httpServer as Express
      storage = app.get<LocalStorageService>(LocalStorageService)
      userRepo = app.get<Repository<User>>(getRepositoryToken(User))
      assetRepo = app.get<Repository<Asset>>(getRepositoryToken(Asset))
      thumbRepo = app.get<Repository<AssetThumbnail>>(getRepositoryToken(AssetThumbnail))
      fileRepo = app.get<Repository<FileRecord>>(getRepositoryToken(FileRecord))
      faceRepo = app.get<Repository<Face>>(getRepositoryToken(Face))
      jwt = app.get<JwtService>(JwtService)
      workerBullMq = app.get<WorkerBullMqService>(WorkerBullMqService)
      app.get<ThumbnailProcessor>(ThumbnailProcessor).start()
      app.get<MetadataProcessor>(MetadataProcessor).start()
      app.get<VideoProcessor>(VideoProcessor).start()
      app.get<FaceProcessor>(FaceProcessor).start()
    } catch (err) {
      if (prevStorageDir === undefined) delete process.env.STORAGE_DIR
      else process.env.STORAGE_DIR = prevStorageDir
      if (prevCoreUrl === undefined) delete process.env.CORE_URL
      else process.env.CORE_URL = prevCoreUrl
      if (prevFaceModelPath === undefined) delete process.env.FACE_MODEL_PATH
      else process.env.FACE_MODEL_PATH = prevFaceModelPath
      throw err
    }
  }, 120_000)

  afterAll(async () => {
    // close drains the BullMQ workers first (in-flight jobs still need CORE_URL pointed at the
    // test app) — restoring the env before close sends stragglers to whatever runs on :3000
    await app.close()
    if (prevCoreUrl === undefined) delete process.env.CORE_URL
    else process.env.CORE_URL = prevCoreUrl
    if (prevStorageDir === undefined) delete process.env.STORAGE_DIR
    else process.env.STORAGE_DIR = prevStorageDir
    if (prevFaceModelPath === undefined) delete process.env.FACE_MODEL_PATH
    else process.env.FACE_MODEL_PATH = prevFaceModelPath
    await teardownTestInfra()
    rmSync(storageDir, { recursive: true, force: true })
  })

  it('processes upload end to end', async () => {
    const server: unknown = app.getHttpServer()
    const expressApp = server as Express
    const user = await userRepo.save(
      userRepo.create({
        email: 'e2e@example.com',
        role: 'user',
        passwordHash: 'test-hash',
        displayName: 'E2E User',
      }),
    )
    const token = jwt.sign({ sub: user.id, email: user.email, role: user.role })
    const auth = { Authorization: `Bearer ${token}` }
    const bytes = await sharp({
      create: { width: 128, height: 128, channels: 3, background: 'green' },
    })
      .jpeg()
      .toBuffer()
    const res = await request(expressApp)
      .post('/api/v1/files')
      .set(auth)
      .attach('file', bytes, 'e2e.jpg')
    expect(res.status).toBe(201)
    const asset = res.body as unknown as { id: string }
    const start = Date.now()
    let ready = false
    while (Date.now() - start < 90_000) {
      const row = await assetRepo.findOne({ where: { id: asset.id } })
      // thumbnailStatus is patched 'ready' by each size job after its own register, so 'ready'
      // only means ≥1 thumbnail — poll the actual 4 rows to avoid racing the serial job queue
      const thumbCount = await thumbRepo.count({ where: { assetId: asset.id } })
      if (
        row?.thumbnailStatus === 'ready' &&
        row?.metadataStatus === 'ready' &&
        row?.faceStatus === 'ready' &&
        thumbCount === 4
      ) {
        ready = true
        break
      }
      await new Promise((r) => setTimeout(r, 500))
    }
    expect(ready).toBe(true)
    const thumbs = await thumbRepo.find({ where: { assetId: asset.id } })
    expect(thumbs).toHaveLength(4)
    const list = await request(expressApp).get('/api/v1/assets').set(auth)
    expect(list.status).toBe(200)
    const body = list.body as unknown as { items: { id: string }[] }
    expect(body.items.some((a) => a.id === asset.id)).toBe(true)
    await storage.ensureDir()
  }, 120_000)

  it('skips transcode for an h264+aac video end to end', async () => {
    const fixture = join(storageDir, 'skip-source.mp4')
    await writeVideoFixture(fixture, { videoCodec: 'libx264', withAudio: true })
    const bytes = await readFile(fixture)
    const { auth } = await makeUser('e2e-video-skip@example.com')

    const assetId = await uploadAsset(expressApp, auth, bytes, 'skip-source.mp4', 'video/mp4')
    const row = await pollAsset(assetRepo, assetId, (a) => a.transcodeStatus === 'ready')

    expect(row.transcodeStatus).toBe('ready')
    expect(row.transcodeFileId).toBeNull()
  }, 120_000)

  it('transcodes a non-h264 video into a separate immutable derivative', async () => {
    const fixture = join(storageDir, 'transcode-source.avi')
    await writeVideoFixture(fixture, { videoCodec: 'mpeg4', withAudio: false })
    const bytes = await readFile(fixture)
    const { auth } = await makeUser('e2e-video-transcode@example.com')

    const assetId = await uploadAsset(
      expressApp,
      auth,
      bytes,
      'transcode-source.avi',
      'video/x-msvideo',
    )
    const uploaded = await assetRepo.findOneOrFail({ where: { id: assetId } })
    const originalBefore = await fileRepo.findOneOrFail({ where: { id: uploaded.fileId } })

    const row = await pollAsset(
      assetRepo,
      assetId,
      (a) => a.transcodeStatus === 'ready' && a.transcodeFileId !== null,
    )
    const transcodeId = row.transcodeFileId
    if (!transcodeId) throw new Error('transcodeFileId missing after ready')

    const transcode = await fileRepo.findOneOrFail({ where: { id: transcodeId } })
    expect(transcode.purpose).toBe('transcode')
    expect(transcode.assetId).toBe(assetId)
    expect(transcode.mimeType).toBe('video/webm')
    expect(await storage.exists(transcode.storageKey)).toBe(true)

    // originals are immutable: same row, same storageKey, same bytes on disk
    const originalAfter = await fileRepo.findOneOrFail({ where: { id: originalBefore.id } })
    expect(originalAfter.purpose).toBe('original')
    expect(originalAfter.storageKey).toBe(originalBefore.storageKey)
    expect(originalAfter.checksumSha256).toBe(createHash('sha256').update(bytes).digest('hex'))
    const originalBytes = await readFile(storage.pathFor(originalAfter.storageKey))
    expect(originalBytes.equals(bytes)).toBe(true)
  }, 120_000)

  it('detects a face with the real ONNX embedder and replaces faces on re-run', async () => {
    const embedder = app.get<FaceEmbedderService>(FaceEmbedderService)
    const { user, auth } = await makeUser('e2e-faces@example.com')
    const boxA = { x: 24, y: 20, w: 64, h: 64 }

    detectImpl = syntheticDetect(embedder, boxA)
    const bytes = await sharp({
      create: { width: 128, height: 128, channels: 3, background: 'green' },
    })
      .jpeg()
      .toBuffer()
    const assetId = await uploadAsset(expressApp, auth, bytes, 'face.jpg', 'image/jpeg')
    const row = await pollAsset(assetRepo, assetId, (a) => a.faceStatus === 'ready')

    expect(row.faceCount).toBe(1)
    const faces = await faceRepo.find({ where: { assetId } })
    expect(faces).toHaveLength(1)
    expect(faces[0]!.box).toEqual(boxA)
    expect(faces[0]!.embedding).toHaveLength(FACE_EMBEDDING_DIM)
    expect(faces[0]!.personId).toBeNull()

    // second run with a different box: unconditional DELETE→POST replaces, never appends
    const boxB = { x: 28, y: 30, w: 58, h: 58 }
    detectImpl = syntheticDetect(embedder, boxB)
    await enqueueAndWait(workerBullMq, 'process-faces', {
      assetId,
      fileId: row.fileId,
      userId: user.id,
    })

    const after = await assetRepo.findOneOrFail({ where: { id: assetId } })
    expect(after.faceStatus).toBe('ready')
    expect(after.faceCount).toBe(1)
    const facesAfter = await faceRepo.find({ where: { assetId } })
    expect(facesAfter).toHaveLength(1)
    expect(facesAfter[0]!.box).toEqual(boxB)
  }, 180_000)
})
