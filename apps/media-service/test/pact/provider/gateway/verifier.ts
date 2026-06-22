/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
import path from 'node:path'
import { type INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { getRepositoryToken } from '@nestjs/typeorm'
import { Asset } from '../../../../src/entities/asset.entity'
import { AssetThumbnail } from '../../../../src/entities/asset-thumbnail.entity'
import { AssetsModule } from '../../../../src/assets/assets.module'
import { createAssetRepo, createBasicRepo } from './mock-repos'
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

  const module = await Test.createTestingModule({
    imports: [AssetsModule],
  })
    .overrideProvider(getRepositoryToken(Asset))
    .useValue(mockAssetRepo)
    .overrideProvider(getRepositoryToken(AssetThumbnail))
    .useValue(mockThumbnailRepo)
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
    repos: { mockAssetRepo },
  }
}
