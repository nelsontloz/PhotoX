/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
import path from 'node:path'
import { type INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { getRepositoryToken } from '@nestjs/typeorm'
import { Asset } from '../../../../src/entities/asset.entity'
import { AssetThumbnail } from '../../../../src/entities/asset-thumbnail.entity'
import { Face } from '../../../../src/faces/entities/face.entity'
import { Person } from '../../../../src/persons/entities/person.entity'
import { AssetsModule } from '../../../../src/assets/assets.module'
import { AlbumsModule } from '../../../../src/albums/albums.module'
import { PersonsModule } from '../../../../src/persons/persons.module'
import { Album } from '../../../../src/entities/album.entity'
import { AlbumAsset } from '../../../../src/entities/album-asset.entity'
import {
  createAssetRepo,
  createBasicRepo,
  createPersonRepo,
  createAlbumRepo,
  createAlbumAssetRepo,
} from './mock-repos'
import type { MockRepos } from './mock-repos'

export const PACT_DIR = path.resolve(__dirname, '../../../../../../pacts')

export async function setupMockedApp(): Promise<{
  app: INestApplication
  url: string
  repos: MockRepos
}> {
  process.env.NODE_ENV = 'test'

  const mockAssetRepo = createAssetRepo()
  const mockThumbnailRepo = createBasicRepo()
  const mockFaceRepo = createBasicRepo()
  const mockPersonRepo = createPersonRepo()
  const mockAlbumRepo = createAlbumRepo()
  const mockAlbumAssetRepo = createAlbumAssetRepo()

  const module = await Test.createTestingModule({
    imports: [AssetsModule, AlbumsModule, PersonsModule],
  })
    .overrideProvider(getRepositoryToken(Asset))
    .useValue(mockAssetRepo)
    .overrideProvider(getRepositoryToken(AssetThumbnail))
    .useValue(mockThumbnailRepo)
    .overrideProvider(getRepositoryToken(Face))
    .useValue(mockFaceRepo)
    .overrideProvider(getRepositoryToken(Person))
    .useValue(mockPersonRepo)
    .overrideProvider(getRepositoryToken(Album))
    .useValue(mockAlbumRepo)
    .overrideProvider(getRepositoryToken(AlbumAsset))
    .useValue(mockAlbumAssetRepo)
    .compile()

  const app = module.createNestApplication()
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  )
  await app.listen(0)

  const url = await app.getUrl()

  return {
    app,
    url,
    repos: {
      mockAssetRepo,
      mockThumbnailRepo,
      mockFaceRepo,
      mockPersonRepo,
      mockAlbumRepo,
      mockAlbumAssetRepo,
    },
  }
}
