import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Asset } from '@photox/shared-types';
import { ViewerActions } from './ViewerActions';
import { preflightAssetDownload } from '../../api/assets';

vi.mock('../../api/assets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/assets')>();
  return { ...actual, preflightAssetDownload: vi.fn() };
});

function makeAsset(): Asset {
  return {
    id: 'asset-1',
    fileId: 'file-1',
    contentVersion: 'file-1',
    kind: 'photo',
    uploadedAt: '2024-01-01T00:00:00Z',
    originalName: 'Trip.jpg',
  } as Asset;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('ViewerActions download', () => {
  it('preflights, then clicks a native anchor at the download URL', async () => {
    vi.mocked(preflightAssetDownload).mockResolvedValue(undefined);
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    render(<ViewerActions asset={makeAsset()} />);
    fireEvent.click(screen.getByTitle('Download'));

    await vi.waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));
    const anchor = clickSpy.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.getAttribute('href')).toBe('/api/v1/assets/asset-1/content/download?v=file-1');
    expect(anchor.download).toBe('Trip.jpg');
    expect(preflightAssetDownload).toHaveBeenCalledWith(expect.objectContaining({ id: 'asset-1' }));
  });

  it('never starts a download when the preflight rejects', async () => {
    vi.mocked(preflightAssetDownload).mockRejectedValue(new Error('401'));
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    render(<ViewerActions asset={makeAsset()} />);
    fireEvent.click(screen.getByTitle('Download'));

    await vi.waitFor(() =>
      expect(preflightAssetDownload).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'asset-1' }),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(clickSpy).not.toHaveBeenCalled();
  });
});
