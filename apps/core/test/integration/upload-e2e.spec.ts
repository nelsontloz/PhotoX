import { mkdtempSync, rmSync } from 'node:fs'
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
import {
  Asset,
  AssetThumbnail,
  Face,
  FileRecord,
  LocalStorageService,
  Person,
} from '@photox/data-access'
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
import { TrashModule } from '../../src/trash/trash.module'
import { UserFilesModule } from '../../src/files/user/user-files.module'
import { StorageModule } from '../../src/files/storage/storage.module'
import { AdminModule } from '../../src/admin/admin.module'
import { UsersModule } from '../../src/users/users.module'
import { AuthModule } from '../../src/auth/auth.module'
import { BullMqModule } from '../../src/queue/bullmq.module'
import { BullMqService as WorkerBullMqService } from '../../../worker-service/src/queue/bullmq.service'
import { ThumbnailProcessor } from '../../../worker-service/src/queue/thumbnail.processor'
import { MetadataProcessor } from '../../../worker-service/src/queue/metadata.processor'
import {
  MetadataExtractor,
  VideoMetadataExtractor,
} from '../../../worker-service/src/queue/metadata.extractor'
import { FaceProcessor } from '../../../worker-service/src/queue/face.processor'
import { FaceDetectorService } from '../../../worker-service/src/queue/face.detector'
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

describe('upload e2e pipeline', () => {
  let app: INestApplication
  let storage: LocalStorageService
  let storageDir = ''
  let userRepo: Repository<User>
  let assetRepo: Repository<Asset>
  let thumbRepo: Repository<AssetThumbnail>
  let jwt: JwtService

  beforeAll(async () => {
    const { pgHost, pgPort } = await setupTestInfra()
    storageDir = mkdtempSync(join(tmpdir(), 'api-e2e-storage-'))
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
          TrashModule,
          UserFilesModule,
          AdminModule,
        ],
        providers: [
          WorkerBullMqService,
          ThumbnailProcessor,
          MetadataProcessor,
          MetadataExtractor,
          VideoMetadataExtractor,
          { provide: FaceDetectorService, useValue: { detect: vi.fn().mockResolvedValue([]) } },
          FaceProcessor,
        ],
      }).compile()
      app = moduleRef.createNestApplication()
      app.useGlobalPipes(
        new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
      )
      app.useGlobalFilters(new HttpExceptionFilter())
      await app.init()
      storage = app.get<LocalStorageService>(LocalStorageService)
      userRepo = app.get<Repository<User>>(getRepositoryToken(User))
      assetRepo = app.get<Repository<Asset>>(getRepositoryToken(Asset))
      thumbRepo = app.get<Repository<AssetThumbnail>>(getRepositoryToken(AssetThumbnail))
      jwt = app.get<JwtService>(JwtService)
      app.get<ThumbnailProcessor>(ThumbnailProcessor).start()
      app.get<MetadataProcessor>(MetadataProcessor).start()
      app.get<FaceProcessor>(FaceProcessor).start()
    } catch (err) {
      if (prevStorageDir === undefined) delete process.env.STORAGE_DIR
      else process.env.STORAGE_DIR = prevStorageDir
      throw err
    }
  }, 120_000)

  afterAll(async () => {
    await app.close()
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
      if (row?.thumbnailStatus === 'ready' && row?.metadataStatus === 'ready') {
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
})
