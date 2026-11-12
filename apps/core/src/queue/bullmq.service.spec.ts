import { SEARCH_EMBEDDING_MODEL } from '@photox/shared-types';
import { BullMqService } from './bullmq.service';

// ponytail: the jobId prefixes are the dedup contract of enqueueAssetJob — pin them
describe('BullMqService.enqueueAssetJob', () => {
  function makeService() {
    const service = new BullMqService();
    const add = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(service, 'getQueue').mockReturnValue({ add } as never);
    return { service, add };
  }

  it.each([
    ['embed', 'process-embeddings', `embed-a1-${SEARCH_EMBEDDING_MODEL}`],
    ['detect', 'process-detect', 'detect-a1'],
  ] as const)('%s enqueues %s with the prefix jobId', async (kind, queue, jobId) => {
    const { service, add } = makeService();
    await service.enqueueAssetJob(kind, 'a1', 'f1', 'u1');
    await vi.waitFor(() => expect(add).toHaveBeenCalled());
    expect(add).toHaveBeenCalledWith(
      queue,
      { assetId: 'a1', fileId: 'f1', userId: 'u1' },
      expect.objectContaining({ jobId }),
    );
  });
});

// ponytail: a video retry can cost up to 1h of SVT-AV1 — pin attempts:2 so only one
// expensive retry runs; every other queue keeps the shared default of 3
describe('BullMqService.enqueueVideo', () => {
  function makeService() {
    const service = new BullMqService();
    const add = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(service, 'getQueue').mockReturnValue({ add } as never);
    return { service, add };
  }

  it('enqueues with attempts:2', async () => {
    const { service, add } = makeService();
    await service.enqueueVideo('a1', 'f1', 'u1');
    await vi.waitFor(() => expect(add).toHaveBeenCalled());
    expect(add).toHaveBeenCalledWith(
      'process-video',
      { assetId: 'a1', fileId: 'f1', userId: 'u1' },
      expect.objectContaining({ jobId: 'video-a1', attempts: 2 }),
    );
  });

  it('honors the restore run-scoped jobId override', async () => {
    const { service, add } = makeService();
    await service.enqueueVideo('a1', 'f1', 'u1', { jobId: 'video-restore-123-a1' });
    await vi.waitFor(() => expect(add).toHaveBeenCalled());
    expect(add).toHaveBeenCalledWith(
      'process-video',
      { assetId: 'a1', fileId: 'f1', userId: 'u1' },
      expect.objectContaining({ jobId: 'video-restore-123-a1', attempts: 2 }),
    );
  });
});

// ponytail: a retained completed job never disappears (~6 per asset), so a long-lived library
// fills Redis and noeviction starts refusing uploads — the default must remove them
describe('BullMqService.enqueue retention defaults', () => {
  function makeService() {
    const service = new BullMqService();
    const add = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(service, 'getQueue').mockReturnValue({ add } as never);
    return { service, add };
  }

  it('removes completed jobs by default', async () => {
    const { service, add } = makeService();
    await service.enqueue('process-metadata', 'process-metadata', { userId: 'u1' });
    await vi.waitFor(() => expect(add).toHaveBeenCalled());
    expect(add).toHaveBeenCalledWith(
      'process-metadata',
      { userId: 'u1' },
      expect.objectContaining({ removeOnComplete: true, removeOnFail: true, attempts: 3 }),
    );
  });

  it('lets an explicit removeOnComplete:false win', async () => {
    const { service, add } = makeService();
    await service.enqueue(
      'process-metadata',
      'process-metadata',
      { userId: 'u1' },
      { removeOnComplete: false },
    );
    await vi.waitFor(() => expect(add).toHaveBeenCalled());
    expect(add).toHaveBeenCalledWith(
      'process-metadata',
      { userId: 'u1' },
      expect.objectContaining({ removeOnComplete: false }),
    );
  });
});
