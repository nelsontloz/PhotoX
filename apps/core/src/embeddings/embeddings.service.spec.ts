import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { SEARCH_EMBEDDING_DIM, SEARCH_EMBEDDING_MODEL } from '@photox/shared-types';
import { AssetEmbedding } from '../database/entities/asset-embedding.entity';
import { AssetsService } from '../assets/assets.service';
import type { RegisterEmbeddingDto } from './dto/register-embedding.dto';
import { EmbeddingsService } from './embeddings.service';

const UNIT_EMBEDDING = Array.from({ length: SEARCH_EMBEDDING_DIM }, (_, i) => (i === 0 ? 1 : 0));

function makeService(owned = true) {
  const upsert = vi.fn().mockResolvedValue({});
  const markReady = vi.fn(() => Promise.resolve());
  const assertOwned = owned
    ? vi.fn(() => Promise.resolve())
    : vi.fn(() => Promise.reject(new NotFoundException('Asset not found')));
  const service = new EmbeddingsService(
    { upsert } as unknown as Repository<AssetEmbedding>,
    {
      assertOwned,
      markEmbeddingStatus: markReady,
    } as unknown as AssetsService,
  );
  return { service, upsert, markReady };
}

function validDto(): RegisterEmbeddingDto {
  return { kind: 'image', model: SEARCH_EMBEDDING_MODEL, embedding: [...UNIT_EMBEDDING] };
}

describe('EmbeddingsService.register', () => {
  it('404s an asset the token does not own and writes nothing', async () => {
    const { service, upsert, markReady } = makeService(false);
    await expect(service.register('asset-1', 'u1', validDto())).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(upsert).not.toHaveBeenCalled();
    expect(markReady).not.toHaveBeenCalled();
  });

  it('upserts the image embedding on (assetId, kind, model) and marks the asset ready', async () => {
    const { service, upsert, markReady } = makeService();
    await expect(service.register('asset-1', 'u1', validDto())).resolves.toEqual({ ok: true });
    expect(upsert).toHaveBeenCalledWith(
      [
        {
          assetId: 'asset-1',
          kind: 'image',
          model: SEARCH_EMBEDDING_MODEL,
          embedding: UNIT_EMBEDDING,
        },
      ],
      ['assetId', 'kind', 'model'],
    );
    expect(markReady).toHaveBeenCalledWith('asset-1', 'ready');
  });

  const invalid: [string, RegisterEmbeddingDto][] = [
    ['an unsupported kind', { ...validDto(), kind: 'video_frame' }],
    ['an unknown model', { ...validDto(), model: 'clip-vit-b32' }],
    [
      'wrong dimensions (512-d face embedding)',
      { ...validDto(), embedding: Array.from({ length: 512 }, () => 0.1) },
    ],
    ['a non-finite entry', { ...validDto(), embedding: [NaN, ...UNIT_EMBEDDING.slice(1)] }],
    ['a scaled (non-unit) vector', { ...validDto(), embedding: UNIT_EMBEDDING.map((v) => v * 2) }],
  ];

  it.each(invalid)('422s %s without writing', async (_label, dto) => {
    const { service, upsert, markReady } = makeService();
    await expect(service.register('asset-1', 'u1', dto)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(upsert).not.toHaveBeenCalled();
    expect(markReady).not.toHaveBeenCalled();
  });
});
