import { Module } from '@nestjs/common'
import { LocalStorageService } from '@photox/data-access'

@Module({
  providers: [LocalStorageService],
  exports: [LocalStorageService],
})
export class StorageModule {}
