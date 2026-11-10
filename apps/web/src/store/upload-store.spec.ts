import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUploadStore, type UploadItem } from './upload-store';

function makeItem(patch: Partial<UploadItem> & Pick<UploadItem, 'id' | 'status'>): UploadItem {
  return { fileName: 'a.jpg', sizeBytes: 1, kind: 'photo', progress: 0, ...patch };
}

describe('upload-store clearDone', () => {
  const revoke = vi.fn();
  // jsdom ships no URL.createObjectURL/revokeObjectURL, so the preview lifecycle must be stubbed
  const urlWithRevoke = URL as unknown as { revokeObjectURL?: (url: string) => void };

  beforeEach(() => {
    revoke.mockClear();
    urlWithRevoke.revokeObjectURL = revoke;
    useUploadStore.setState({ items: [], dismissed: false });
  });

  afterEach(() => {
    delete urlWithRevoke.revokeObjectURL;
  });

  it('revokes done/error previews and leaves uploading rows alive', () => {
    useUploadStore.setState({
      items: [
        makeItem({ id: 'done', status: 'done', localThumbUrl: 'blob:done' }),
        makeItem({ id: 'error', status: 'error', localThumbUrl: 'blob:error' }),
        makeItem({ id: 'uploading', status: 'uploading', localThumbUrl: 'blob:uploading' }),
        makeItem({ id: 'queued', status: 'queued' }),
      ],
    });

    useUploadStore.getState().clearDone();

    expect(revoke.mock.calls).toEqual([['blob:done'], ['blob:error']]);
    const remaining = useUploadStore.getState().items;
    expect(remaining.map((i) => i.id)).toEqual(['uploading', 'queued']);
    expect(remaining[0]!.localThumbUrl).toBe('blob:uploading');
  });

  it('filters done/error rows that have no preview URL without throwing', () => {
    useUploadStore.setState({ items: [makeItem({ id: 'done', status: 'done' })] });

    useUploadStore.getState().clearDone();

    expect(revoke).not.toHaveBeenCalled();
    expect(useUploadStore.getState().items).toEqual([]);
  });
});
