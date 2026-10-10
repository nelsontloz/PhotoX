import { Test } from '@nestjs/testing'
import { LocalStorageService } from '@photox/shared-config'
import { StorageModule } from './storage.module'

// ponytail: shared-config dropped @nestjs/common, so LocalStorageService is undecorated —
// this pins that Nest still instantiates the zero-arg provider
describe('StorageModule', () => {
  it('provides LocalStorageService without @Injectable', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [StorageModule] }).compile()
    expect(moduleRef.get(LocalStorageService)).toBeInstanceOf(LocalStorageService)
  })
})
