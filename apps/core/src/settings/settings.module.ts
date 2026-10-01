import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AppSetting, Face } from '../database/entities'
import { SettingsService } from './settings.service'

@Module({
  imports: [TypeOrmModule.forFeature([AppSetting, Face])],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
