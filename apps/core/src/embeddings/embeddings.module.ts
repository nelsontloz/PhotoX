import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Asset } from '../database/entities'
import { AssetEmbedding } from '../database/entities/asset-embedding.entity'
import { EmbeddingsController } from './embeddings.controller'
import { EmbeddingsService } from './embeddings.service'

@Module({
  imports: [TypeOrmModule.forFeature([AssetEmbedding, Asset])],
  controllers: [EmbeddingsController],
  providers: [EmbeddingsService],
  exports: [EmbeddingsService],
})
export class EmbeddingsModule {}
