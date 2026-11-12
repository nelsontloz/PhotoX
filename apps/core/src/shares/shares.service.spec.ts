import { QueryFailedError } from 'typeorm';
import * as crypto from 'crypto';
import { SharesService } from './shares.service';
import type { Share } from './entities/share.entity';

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

describe('SharesService.findShareByToken', () => {
  const hash = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

  // fake repo: rows are matched exactly like the column lookup would match them
  function makeService(storedTokens: string[]) {
    const shareRepo = {
      findOne: vi.fn((opts: { where: { token: string } }) =>
        Promise.resolve(
          storedTokens.includes(opts.where.token)
            ? ({ id: 'share-1', token: opts.where.token } as Share)
            : null,
        ),
      ),
    };
    const service = new SharesService(
      shareRepo as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const find = (token: string): Promise<Share | null> =>
      (
        service as unknown as { findShareByToken: (t: string) => Promise<Share | null> }
      ).findShareByToken(token);
    return { find, shareRepo };
  }

  it('resolves a presented token against its stored hash', async () => {
    const { find } = makeService([hash('real-token')]);
    await expect(find('real-token')).resolves.toMatchObject({ id: 'share-1' });
  });

  it('does not accept the stored hash itself as a capability', async () => {
    const stored = hash('real-token');
    const { find, shareRepo } = makeService([stored]);
    await expect(find(stored)).resolves.toBeNull();
    // the digest-shaped guard skips the raw fallback entirely
    expect(shareRepo.findOne).toHaveBeenCalledTimes(1);
  });

  it('still resolves a legacy 22-char plaintext token', async () => {
    const legacy = crypto.randomBytes(16).toString('base64url');
    expect(legacy).toHaveLength(22);
    const { find } = makeService([legacy]);
    await expect(find(legacy)).resolves.toMatchObject({ id: 'share-1' });
  });

  it('returns null on a miss', async () => {
    const { find } = makeService([]);
    await expect(find('no-such-token')).resolves.toBeNull();
  });
});
