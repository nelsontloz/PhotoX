import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AssetEmbedding } from '../database/entities/asset-embedding.entity';
import { AssetsModule } from '../assets/assets.module';
import { EmbeddingsService } from './embeddings.service';

@Module({
  imports: [TypeOrmModule.forFeature([AssetEmbedding]), AssetsModule],
  providers: [EmbeddingsService],
  exports: [EmbeddingsService],
})
export class EmbeddingsModule {}
