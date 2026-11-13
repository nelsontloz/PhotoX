import { Module } from '@nestjs/common';
import { UserFilesModule } from '../ingest/user-files.module';
import { StuckAssetsSweeper } from './stuck-assets.sweeper';

@Module({
  imports: [UserFilesModule],
  providers: [StuckAssetsSweeper],
})
export class MaintenanceModule {}
