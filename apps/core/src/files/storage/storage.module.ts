import { Module } from '@nestjs/common'
import { LocalStorageService } from '@photox/shared-config'

@Module({
  providers: [LocalStorageService],
  exports: [LocalStorageService],
})
export class StorageModule {}
