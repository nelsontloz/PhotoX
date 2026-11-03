import type { Repository } from 'typeorm';
import { AlbumsService } from './albums.service';
import type { Album } from './entities/album.entity';
import type { AlbumAsset } from './entities/album-asset.entity';
import type { Asset } from '../database/entities';
import type { AssetsService } from '../assets/assets.service';

function makeService(overrides: Partial<Album> = {}) {
  const row: Album = {
    id: 'album-1',
    userId: 'u1',
    name: 'Old',
    description: null,
    hiddenFromTimeline: false,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    ...overrides,
  };
  const saveMock = vi.fn((album: Album) => Promise.resolve(album));
  const updateMock = vi.fn((_id: string, patch: Partial<Album>) => {
    Object.assign(row, patch);
    return Promise.resolve({ affected: 1 });
  });
  const deleteMock = vi.fn<(criteria: { id: string; userId: string }) => Promise<{ affected: number }>>(
    () => Promise.resolve({ affected: 1 }),
  );
  const albumAssetDeleteMock = vi.fn<(criteria: { albumId: string }) => Promise<{ affected: number }>>(
    () => Promise.resolve({ affected: 1 }),
  );
  const repo = {
    save: saveMock,
    update: updateMock,
    delete: deleteMock,
    findOne: vi.fn(() => Promise.resolve({ ...row })),
  } as unknown as Repository<Album>;
  const countQb = {
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    getCount: vi.fn(() => Promise.resolve(0)),
  };
  const assetRepo = {
    createQueryBuilder: vi.fn(() => countQb),
  } as unknown as Repository<Asset>;
  const albumAssetRepo = {
    delete: albumAssetDeleteMock,
  } as unknown as Repository<AlbumAsset>;
  const service = new AlbumsService(repo, albumAssetRepo, assetRepo, {} as unknown as AssetsService);
  return { service, saveMock, updateMock, deleteMock, albumAssetDeleteMock };
}

describe('AlbumsService hiddenFromTimeline', () => {
  it('create() defaults the flag to false', async () => {
    const { service, saveMock } = makeService();
    const dto = await service.create('u1', { name: 'Trip' });

    expect(saveMock.mock.calls[0]![0]).toMatchObject({ hiddenFromTimeline: false });
    expect(dto.hiddenFromTimeline).toBe(false);
  });

  it('create() stores an explicit true', async () => {
    const { service, saveMock } = makeService();
    const dto = await service.create('u1', { name: 'Trip', hiddenFromTimeline: true });

    expect(saveMock.mock.calls[0]![0]).toMatchObject({ hiddenFromTimeline: true });
    expect(dto.hiddenFromTimeline).toBe(true);
  });

  it('update() sets the flag', async () => {
    const { service, updateMock } = makeService();
    const dto = await service.update('u1', 'album-1', { hiddenFromTimeline: true });

    expect(updateMock.mock.calls[0]![1]).toEqual({ hiddenFromTimeline: true });
    expect(dto.hiddenFromTimeline).toBe(true);
  });

  it('update() clears the flag', async () => {
    const { service, updateMock } = makeService({ hiddenFromTimeline: true });
    const dto = await service.update('u1', 'album-1', { hiddenFromTimeline: false });

    expect(updateMock.mock.calls[0]![1]).toEqual({ hiddenFromTimeline: false });
    expect(dto.hiddenFromTimeline).toBe(false);
  });

  it('update() leaves the flag untouched when it is omitted', async () => {
    const { service, updateMock } = makeService({ hiddenFromTimeline: true });
    const dto = await service.update('u1', 'album-1', { name: 'Renamed' });

    expect(updateMock.mock.calls[0]![1]).toEqual({ name: 'Renamed' });
    expect(dto.hiddenFromTimeline).toBe(true);
  });

  it('getOne() exposes the flag', async () => {
    const { service } = makeService({ hiddenFromTimeline: true });
    await expect(service.getOne('u1', 'album-1')).resolves.toMatchObject({
      id: 'album-1',
      hiddenFromTimeline: true,
    });
  });
});

describe('AlbumsService delete', () => {
  it('removes the join rows before the album, so no orphans outlive it', async () => {
    const { service, deleteMock, albumAssetDeleteMock } = makeService();
    await service.delete('u1', 'album-1');

    expect(albumAssetDeleteMock.mock.calls[0]![0]).toEqual({ albumId: 'album-1' });
    expect(deleteMock.mock.calls[0]![0]).toEqual({ id: 'album-1', userId: 'u1' });
    expect(albumAssetDeleteMock.mock.invocationCallOrder[0]).toBeLessThan(
      deleteMock.mock.invocationCallOrder[0]!,
    );
  });
});
