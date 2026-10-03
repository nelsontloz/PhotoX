import { NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import type { Repository } from 'typeorm'
import { SEARCH_EMBEDDING_DIM, SEARCH_EMBEDDING_MODEL } from '@photox/shared-types'
import { Asset } from '../database/entities'
import { AssetEmbedding } from '../database/entities/asset-embedding.entity'
import type { RegisterEmbeddingDto } from './dto/register-embedding.dto'
import { EmbeddingsService } from './embeddings.service'

const EMBEDDING = Array.from({ length: SEARCH_EMBEDDING_DIM }, () => 0.1)

function makeService(owned = true) {
  const upsert = vi.fn().mockResolvedValue({})
  const findOne = vi.fn().mockResolvedValue(owned ? { id: 'asset-1', userId: 'u1' } : null)
  const service = new EmbeddingsService(
    { upsert } as unknown as Repository<AssetEmbedding>,
    { findOne } as unknown as Repository<Asset>,
  )
  return { service, upsert, findOne }
}

function validDto(): RegisterEmbeddingDto {
  return { kind: 'image', model: SEARCH_EMBEDDING_MODEL, embedding: [...EMBEDDING] }
}

describe('EmbeddingsService.register', () => {
  it('404s an asset the token does not own and writes nothing', async () => {
    const { service, upsert } = makeService(false)
    await expect(service.register('asset-1', 'u1', validDto())).rejects.toBeInstanceOf(
      NotFoundException,
    )
    expect(upsert).not.toHaveBeenCalled()
  })

  it('upserts the image embedding on (assetId, kind, model)', async () => {
    const { service, upsert } = makeService()
    await expect(service.register('asset-1', 'u1', validDto())).resolves.toEqual({ ok: true })
    expect(upsert).toHaveBeenCalledWith(
      [
        {
          assetId: 'asset-1',
          kind: 'image',
          model: SEARCH_EMBEDDING_MODEL,
          embedding: EMBEDDING,
        },
      ],
      ['assetId', 'kind', 'model'],
    )
  })

  const invalid: [string, RegisterEmbeddingDto][] = [
    ['an unsupported kind', { ...validDto(), kind: 'video_frame' }],
    ['an unknown model', { ...validDto(), model: 'clip-vit-b32' }],
    [
      'wrong dimensions (512-d face embedding)',
      { ...validDto(), embedding: Array.from({ length: 512 }, () => 0.1) },
    ],
    ['a non-finite entry', { ...validDto(), embedding: [NaN, ...EMBEDDING.slice(1)] }],
  ]

  it.each(invalid)('422s %s without writing', async (_label, dto) => {
    const { service, upsert } = makeService()
    await expect(service.register('asset-1', 'u1', dto)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    )
    expect(upsert).not.toHaveBeenCalled()
  })
})
