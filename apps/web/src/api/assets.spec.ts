import { describe, it, expect, vi } from 'vitest';
import type { Asset, AssetListResponse, FileExistsCheckHit } from '@photox/shared-types';
import {
  CHECK_FILES_EXIST_TIMEOUT_MS,
  getFileDownloadUrl,
  getFileStreamUrl,
  listAllAssets,
  checkFilesExist,
  preflightFileDownload,
} from './assets';

const { getMock, postMock, headMock } = vi.hoisted(() => ({
  getMock: vi.fn<
    (
      url: string,
      config?: { params?: Record<string, unknown> },
    ) => Promise<{
      data: AssetListResponse;
    }>
  >(),
  postMock: vi.fn<
    (
      url: string,
      body?: { items: { checksumSha256: string; sizeBytes?: number }[] },
      config?: { timeout?: number },
    ) => Promise<{
      data: { items: FileExistsCheckHit[] };
    }>
  >(),
  headMock: vi.fn<(url: string) => Promise<void>>(),
}));

vi.mock('./client', () => ({ api: { get: getMock, post: postMock, head: headMock } }));

function makeAsset(id: string): Asset {
  return { id, kind: 'photo', uploadedAt: '2024-01-01T00:00:00Z' } as Asset;
}

describe('stream URL builders', () => {
  it('getFileStreamUrl targets core through the /api prefix', () => {
    expect(getFileStreamUrl('file-1')).toBe('/api/v1/files/file-1/stream');
  });

  it('getFileDownloadUrl targets core through the /api prefix', () => {
    expect(getFileDownloadUrl('file-1')).toBe('/api/v1/files/file-1/download');
  });
});

describe('preflightFileDownload', () => {
  it('HEADs the download route through the axios client', async () => {
    headMock.mockResolvedValue(undefined);

    await preflightFileDownload('file-1');

    expect(headMock).toHaveBeenCalledWith('/v1/files/file-1/download');
  });
});

describe('checkFilesExist', () => {
  it('posts checksums to /v1/files/exists and returns the result items', async () => {
    postMock.mockResolvedValue({
      data: {
        items: [
          {
            checksumSha256: 'abc',
            exists: true,
            existingFileId: 'file-1',
            existingAssetId: 'asset-1',
          },
          { checksumSha256: 'def', exists: false },
        ],
      },
    });

    const items = await checkFilesExist([{ checksumSha256: 'abc' }, { checksumSha256: 'def' }]);

    expect(postMock).toHaveBeenCalledWith(
      '/v1/files/exists',
      {
        items: [{ checksumSha256: 'abc' }, { checksumSha256: 'def' }],
      },
      { timeout: CHECK_FILES_EXIST_TIMEOUT_MS },
    );
    expect(items).toEqual([
      {
        checksumSha256: 'abc',
        exists: true,
        existingFileId: 'file-1',
        existingAssetId: 'asset-1',
      },
      { checksumSha256: 'def', exists: false },
    ]);
  });

  it('passes an explicit timeout through to the exists POST', async () => {
    postMock.mockResolvedValue({ data: { items: [] } });

    await checkFilesExist([{ checksumSha256: 'abc' }], { timeout: 5000 });

    expect(postMock).toHaveBeenCalledWith(
      '/v1/files/exists',
      { items: [{ checksumSha256: 'abc' }] },
      { timeout: 5000 },
    );
  });
});

describe('listAllAssets', () => {
  it('walks nextCursor until the server stops, filters riding along', async () => {
    const pages: Record<string, { items: Asset[]; nextCursor: string | null }> = {
      first: { items: [makeAsset('a-0')], nextCursor: 'c1' },
      c1: { items: [makeAsset('a-1')], nextCursor: 'c2' },
      c2: { items: [makeAsset('a-2')], nextCursor: null },
    };
    getMock.mockImplementation((_url, config) => {
      const page = pages[(config?.params?.cursor as string | undefined) ?? 'first']!;
      const data: AssetListResponse = { ...page, total: 3, limit: 1, offset: 0 };
      return Promise.resolve({ data });
    });

    const all = await listAllAssets({ limit: 1, personId: 'p-1', albumId: 'al-1' });

    expect(getMock.mock.calls.map(([, config]) => config?.params?.cursor)).toEqual([
      undefined,
      'c1',
      'c2',
    ]);
    // the person/album filters ride along on every page request
    expect(
      getMock.mock.calls.map(([, config]) => [config?.params?.personId, config?.params?.albumId]),
    ).toEqual([
      ['p-1', 'al-1'],
      ['p-1', 'al-1'],
      ['p-1', 'al-1'],
    ]);
    expect(all.map((a) => a.id)).toEqual(['a-0', 'a-1', 'a-2']);
  });

  it('stops on a repeated cursor instead of looping forever', async () => {
    getMock.mockResolvedValue({
      data: { items: [makeAsset('a-0')], total: 9, limit: 50, offset: 0, nextCursor: 'stuck' },
    });

    const all = await listAllAssets({ limit: 50 });

    expect(getMock).toHaveBeenCalledTimes(2);
    expect(all).toHaveLength(2);
  });
});
