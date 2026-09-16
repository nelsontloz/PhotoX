import { Module } from '@nestjs/common'
import { AssetsModule } from '../assets/assets.module'
import { TrashController } from './trash.controller'

@Module({
  imports: [AssetsModule],
  controllers: [TrashController],
})
export class TrashModule {}
