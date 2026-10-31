import { QueryFailedError } from 'typeorm';
import { SharesService } from './shares.service';

function uniqueViolation(): QueryFailedError {
  return new QueryFailedError(
    'INSERT INTO "shares"("assetId", "userId") VALUES ($1, $2)',
    ['asset-1', 'u1'],
    Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' }),
  );
}

function makeAssetService(opts: { saveBehavior: 'ok' | 'race-then-ok' }) {
  const asset = { id: 'asset-1', userId: 'u1', isTrashed: false };
  const shareRepo = {
    findOne: vi.fn(() => Promise.resolve(null)),
    delete: vi.fn(() => Promise.resolve({ affected: 1 })),
    create: vi.fn((v: unknown) => v),
    save:
      opts.saveBehavior === 'ok'
        ? vi.fn((v: unknown) =>
            Promise.resolve({ ...(v as object), id: 'share-1', createdAt: new Date() }),
          )
        : vi
            .fn()
            .mockRejectedValueOnce(uniqueViolation())
            .mockImplementation((v: unknown) =>
              Promise.resolve({ ...(v as object), id: 'share-retry', createdAt: new Date() }),
            ),
  };
  const service = new SharesService(
    shareRepo as never,
    { findOne: vi.fn(() => Promise.resolve(asset)) } as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, shareRepo };
}

describe('SharesService.create concurrent rotation (C10)', () => {
  it('creates normally when there is no race', async () => {
    const { service } = makeAssetService({ saveBehavior: 'ok' });
    const res = await service.create('u1', { assetId: 'asset-1' });
    expect(res.kind).toBe('asset');
    expect(typeof res.token).toBe('string');
  });

  it('retries inline instead of 500ing when a concurrent rotation wins', async () => {
    const { service, shareRepo } = makeAssetService({ saveBehavior: 'race-then-ok' });
    const res = await service.create('u1', { assetId: 'asset-1' });
    expect(res.kind).toBe('asset');
    expect(typeof res.token).toBe('string');
    // first save raced, then the winner was dropped and our row saved
    expect(shareRepo.save).toHaveBeenCalledTimes(2);
    expect(shareRepo.delete).toHaveBeenCalled();
  });

  it('rethrows non-unique errors untouched', async () => {
    const err = new Error('connection lost');
    const shareRepo = {
      findOne: vi.fn(() => Promise.resolve(null)),
      delete: vi.fn(),
      create: vi.fn((v: unknown) => v),
      save: vi.fn(() => Promise.reject(err)),
    };
    const service = new SharesService(
      shareRepo as never,
      { findOne: vi.fn(() => Promise.resolve({ id: 'asset-1', userId: 'u1' })) } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await expect(service.create('u1', { assetId: 'asset-1' })).rejects.toBe(err);
  });
});
