import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import type { Repository } from 'typeorm'
import { SEARCH_EMBEDDING_DIM, SEARCH_EMBEDDING_MODEL } from '@photox/shared-types'
import { Asset } from '../database/entities'
import { AssetEmbedding } from '../database/entities/asset-embedding.entity'
import type { RegisterEmbeddingDto } from './dto/register-embedding.dto'

const EMBEDDING_KIND = 'image'

@Injectable()
export class EmbeddingsService {
  constructor(
    @InjectRepository(AssetEmbedding)
    private readonly repo: Repository<AssetEmbedding>,
    @InjectRepository(Asset)
    private readonly assetRepo: Repository<Asset>,
  ) {}

  async register(
    assetId: string,
    userId: string,
    dto: RegisterEmbeddingDto,
  ): Promise<{ ok: true }> {
    await this.assertAssetOwned(userId, assetId)
    this.assertValid(dto)
    await this.repo.upsert(
      [{ assetId, kind: dto.kind, model: dto.model, embedding: dto.embedding }],
      ['assetId', 'kind', 'model'],
    )
    return { ok: true }
  }

  // untrusted wire body — validate the real values, not the DTO's declared types
  private assertValid(dto: RegisterEmbeddingDto): void {
    if (dto.kind !== EMBEDDING_KIND) {
      throw new UnprocessableEntityException(
        `Unsupported embedding kind '${dto.kind}' (only '${EMBEDDING_KIND}')`,
      )
    }
    if (dto.model !== SEARCH_EMBEDDING_MODEL) {
      throw new UnprocessableEntityException(
        `Unsupported embedding model '${dto.model}' (expected '${SEARCH_EMBEDDING_MODEL}')`,
      )
    }
    const embedding: unknown = dto.embedding
    if (
      !Array.isArray(embedding) ||
      embedding.length !== SEARCH_EMBEDDING_DIM ||
      embedding.some((n) => typeof n !== 'number' || !Number.isFinite(n))
    ) {
      throw new UnprocessableEntityException(
        `embedding must be ${SEARCH_EMBEDDING_DIM} finite numbers`,
      )
    }
  }

  private async assertAssetOwned(userId: string, assetId: string): Promise<void> {
    const asset = await this.assetRepo.findOne({ where: { id: assetId, userId } })
    if (!asset) throw new NotFoundException('Asset not found')
  }
}
