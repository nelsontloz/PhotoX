import { mkdtempSync, rmSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { Test } from '@nestjs/testing'
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm'
import { ValidationPipe, type ExecutionContext, type INestApplication } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { JwtModule, JwtService } from '@nestjs/jwt'
import type { Queue } from 'bullmq'
import type { Express } from 'express'
import { DataSource, type Repository } from 'typeorm'
import {
  Asset,
  AssetThumbnail,
  Face,
  FileRecord,
  Person,
  AppSetting,
} from '../../src/database/entities'
import { LocalStorageService } from '@photox/shared-config'
import { User } from '../../src/users/entities/user.entity'
import { RefreshToken } from '../../src/users/entities/refresh-token.entity'
import { Album } from '../../src/albums/entities/album.entity'
import { AlbumAsset } from '../../src/albums/entities/album-asset.entity'
import { Share } from '../../src/shares/entities/share.entity'
import { AssetsModule } from '../../src/assets/assets.module'
import { AlbumsModule } from '../../src/albums/albums.module'
import { SharesModule } from '../../src/shares/shares.module'
import { PersonsModule } from '../../src/persons/persons.module'
import { FacesModule } from '../../src/faces/faces.module'
import { UserFilesModule } from '../../src/files/user/user-files.module'
import { StorageModule } from '../../src/files/storage/storage.module'
import { AdminModule } from '../../src/admin/admin.module'
import { AdminModule as FilesAdminModule } from '../../src/files/admin/admin.module'
import { UsersModule } from '../../src/users/users.module'
import { AuthModule } from '../../src/auth/auth.module'
import { BullMqModule } from '../../src/queue/bullmq.module'
import { BullMqService } from '../../src/queue/bullmq.service'
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter'
import { TEST_AUTH_SECRET, setupTestInfra, teardownTestInfra } from './test-setup'

export interface MockUser {
  id: string
  email: string
  role: 'user' | 'admin'
}

export interface ApiTestApp {
  app: INestApplication
  dataSource: DataSource
  storage: LocalStorageService
  storageDir: string
  userRepo: Repository<User>
  refreshRepo: Repository<RefreshToken>
  albumRepo: Repository<Album>
  albumAssetRepo: Repository<AlbumAsset>
  shareRepo: Repository<Share>
  fileRepo: Repository<FileRecord>
  assetRepo: Repository<Asset>
  thumbRepo: Repository<AssetThumbnail>
  faceRepo: Repository<Face>
  personRepo: Repository<Person>
  getQueue: (name: string) => Queue
  signToken: (user: MockUser) => string
  authHeader: (token: string) => Record<string, string>
}

const DEFAULT_MOCK_USER: MockUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'test@example.com',
  role: 'user',
}

const ENTITIES = [
  User,
  RefreshToken,
  Album,
  AlbumAsset,
  Share,
  FileRecord,
  Asset,
  AssetThumbnail,
  Face,
  Person,
  AppSetting,
]

export async function createApiTestApp(opts?: {
  mockUser?: MockUser | null
  storageDir?: string
}): Promise<ApiTestApp> {
  const mockUser = opts?.mockUser === undefined ? DEFAULT_MOCK_USER : opts.mockUser
  const { pgHost, pgPort } = await setupTestInfra()

  const storageDir = opts?.storageDir ?? mkdtempSync(join(tmpdir(), 'api-int-storage-'))
  const prevStorageDir = process.env.STORAGE_DIR
  process.env.STORAGE_DIR = storageDir

  try {
    const builder = Test.createTestingModule({
      imports: [
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
        FilesAdminModule,
      ],
    })

    if (mockUser !== null) {
      const current: MockUser = mockUser
      builder.overrideProvider(APP_GUARD).useValue({
        canActivate: (ctx: ExecutionContext) => {
          const req = ctx.switchToHttp().getRequest<{ user?: MockUser }>()
          req.user = current
          return true
        },
      })
    }

    const moduleRef = await builder.compile()
    const app = moduleRef.createNestApplication()
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    )
    app.useGlobalFilters(new HttpExceptionFilter())
    await app.init()

    const bullMq = app.get<BullMqService>(BullMqService)
    const jwt = app.get<JwtService>(JwtService)
    const signToken = (user: MockUser): string =>
      jwt.sign({ sub: user.id, email: user.email, role: user.role })
    // ponytail: core verifies the Bearer JWT itself — no x-user-* mirror needed;
    // malformed tokens keep the Authorization header and hit the 401 path
    const authHeader = (token: string): Record<string, string> => ({
      Authorization: `Bearer ${token}`,
    })

    return {
      app,
      dataSource: app.get<DataSource>(DataSource),
      storage: app.get<LocalStorageService>(LocalStorageService),
      storageDir,
      userRepo: app.get<Repository<User>>(getRepositoryToken(User)),
      refreshRepo: app.get<Repository<RefreshToken>>(getRepositoryToken(RefreshToken)),
      albumRepo: app.get<Repository<Album>>(getRepositoryToken(Album)),
      albumAssetRepo: app.get<Repository<AlbumAsset>>(getRepositoryToken(AlbumAsset)),
      shareRepo: app.get<Repository<Share>>(getRepositoryToken(Share)),
      fileRepo: app.get<Repository<FileRecord>>(getRepositoryToken(FileRecord)),
      assetRepo: app.get<Repository<Asset>>(getRepositoryToken(Asset)),
      thumbRepo: app.get<Repository<AssetThumbnail>>(getRepositoryToken(AssetThumbnail)),
      faceRepo: app.get<Repository<Face>>(getRepositoryToken(Face)),
      personRepo: app.get<Repository<Person>>(getRepositoryToken(Person)),
      getQueue: (name: string) => bullMq.getQueue(name),
      signToken,
      authHeader,
    }
  } catch (err) {
    if (prevStorageDir === undefined) delete process.env.STORAGE_DIR
    else process.env.STORAGE_DIR = prevStorageDir
    throw err
  }
}

export async function resetDb(t: ApiTestApp): Promise<void> {
  await t.dataSource.query(
    'TRUNCATE users, refresh_tokens, albums, album_assets, shares, files, assets, asset_thumbnails, faces, persons, app_settings RESTART IDENTITY CASCADE',
  )
  rmSync(t.storageDir, { recursive: true, force: true })
  await t.storage.ensureDir()
}

export async function closeTestApp(t: ApiTestApp): Promise<void> {
  await t.app.close()
  await teardownTestInfra()
  rmSync(t.storageDir, { recursive: true, force: true })
}

export async function seedUser(
  t: ApiTestApp,
  opts?: { role?: 'user' | 'admin'; email?: string },
): Promise<User> {
  const user = t.userRepo.create({
    email: opts?.email ?? `${randomUUID()}@example.com`,
    role: opts?.role ?? 'user',
    passwordHash: 'test-hash',
    displayName: 'Test User',
  })
  return t.userRepo.save(user)
}

export async function seedFile(
  t: ApiTestApp,
  userId: string,
  opts?: { bytes?: Buffer; mimeType?: string; originalName?: string },
): Promise<FileRecord> {
  const bytes = opts?.bytes ?? Buffer.from(`file-${randomUUID()}`)
  const mimeType = opts?.mimeType ?? 'image/png'
  const originalName = opts?.originalName ?? 'photo.png'
  const storageKey = `originals/${userId}/${randomUUID()}.bin`
  await mkdir(dirname(t.storage.pathFor(storageKey)), { recursive: true })
  await writeFile(t.storage.pathFor(storageKey), bytes)
  const record = t.fileRepo.create({
    userId,
    storageKey,
    originalName,
    mimeType,
    sizeBytes: bytes.length,
    checksumSha256: createHash('sha256').update(bytes).digest('hex'),
    purpose: 'original',
    assetId: null,
  })
  return t.fileRepo.save(record)
}

export async function seedAsset(
  t: ApiTestApp,
  userId: string,
  fileId: string,
  opts?: {
    kind?: 'photo' | 'video'
    isTrashed?: boolean
    width?: number
    height?: number
    sizeBytes?: number
    transcodeStatus?: 'pending' | 'ready' | 'failed' | null
    transcodeFileId?: string
  },
): Promise<Asset> {
  const asset = t.assetRepo.create({
    userId,
    kind: opts?.kind ?? 'photo',
    fileId,
    isTrashed: opts?.isTrashed ?? false,
    width: opts?.width ?? null,
    height: opts?.height ?? null,
    sizeBytes: opts?.sizeBytes ?? null,
    transcodeStatus: opts?.transcodeStatus ?? null,
    transcodeFileId: opts?.transcodeFileId ?? null,
  })
  return t.assetRepo.save(asset)
}

export async function seedThumbnail(
  t: ApiTestApp,
  assetId: string,
  opts?: { size?: string; width?: number; height?: number; bytes?: number; createdAt?: Date },
): Promise<AssetThumbnail> {
  const asset = await t.assetRepo.findOneOrFail({ where: { id: assetId } })
  const file = await seedFile(t, asset.userId, {
    mimeType: 'image/jpeg',
    originalName: 'thumb.jpg',
  })
  const thumb = t.thumbRepo.create({
    assetId,
    fileId: file.id,
    size: opts?.size ?? 'md',
    width: opts?.width ?? 512,
    height: opts?.height ?? 512,
    bytes: opts?.bytes ?? 4096,
    createdAt: opts?.createdAt,
  })
  return t.thumbRepo.save(thumb)
}

export function apiServer(t: ApiTestApp): Express {
  const server: unknown = t.app.getHttpServer()
  return server as Express
}
