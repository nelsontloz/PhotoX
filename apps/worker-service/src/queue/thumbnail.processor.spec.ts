import { describe, expect, it, vi, beforeEach } from 'vitest';
import { UnrecoverableError, type Job } from 'bullmq';
import { randomUUID } from 'crypto';
import { thumbnailProcessor } from './thumbnail.processor';
import type { ThumbnailJob } from './job-schemas';
import type { CoreClient } from '../core/core-client.service';
import { FakeCoreClient, makeAsset, makeFileRecord } from '../../test/fake-core-client';
import { signJob, useTestAuthEnv } from '../../test/sign-job';

describe('ThumbnailProcessor job guards', () => {
  const base = { assetId: randomUUID(), fileId: randomUUID(), userId: randomUUID() };
  const fakeJob = (data: unknown) =>
    ({ data, name: 'process-thumbnail' }) as unknown as Job<ThumbnailJob>;

  beforeEach(useTestAuthEnv);

  function setup() {
    const fake = new FakeCoreClient();
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const spec = thumbnailProcessor({
      bullMq: { enqueue } as never,
      core: fake as unknown as CoreClient,
      storage: { pathFor: (key: string) => key } as never,
    });
    return { run: spec.run, fake, bullMq: { enqueue } };
  }

  it('rejects an invalid payload before any core call', async () => {
    const { run, fake } = setup();

    await expect(run(fakeJob({ ...base, size: 'huge' }))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );

    expect(fake.calls).toHaveLength(0);
  });

  it('rejects a job whose file and asset belong to another user without mutating', async () => {
    const otherUser = randomUUID();
    const { run, fake } = setup();
    fake.files.set(base.fileId, makeFileRecord({ id: base.fileId, userId: otherUser }));
    fake.assets.set(
      base.assetId,
      makeAsset({ id: base.assetId, userId: otherUser, fileId: base.fileId }),
    );

    await expect(run(fakeJob(signJob({ ...base, size: 'sm' as const })))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );

    expect(fake.callsOf('patchMetadata')).toHaveLength(0);
    expect(fake.callsOf('registerFile')).toHaveLength(0);
    expect(fake.thumbnails).toHaveLength(0);
  });

  it('rejects a job whose asset points at a different file', async () => {
    const { run, fake } = setup();
    fake.files.set(base.fileId, makeFileRecord({ id: base.fileId, userId: base.userId }));
    fake.assets.set(
      base.assetId,
      makeAsset({ id: base.assetId, userId: base.userId, fileId: randomUUID() }),
    );

    await expect(run(fakeJob(signJob({ ...base, size: 'sm' as const })))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );

    expect(fake.callsOf('patchMetadata')).toHaveLength(0);
  });

  it('defers a pending video thumbnail with a bounded delayed re-enqueue instead of polling', async () => {
    const { run, fake, bullMq } = setup();
    fake.files.set(
      base.fileId,
      makeFileRecord({ id: base.fileId, userId: base.userId, mimeType: 'video/mp4' }),
    );
    fake.assets.set(
      base.assetId,
      makeAsset({
        id: base.assetId,
        userId: base.userId,
        fileId: base.fileId,
        kind: 'video',
        metadataStatus: 'pending',
      }),
    );
    const payload = signJob({ ...base, size: 'lg' as const });

    await run(fakeJob(payload));

    // no thumbnail work yet; a delayed copy of the job carries the wait counter
    expect(fake.thumbnails).toHaveLength(0);
    expect(fake.callsOf('registerFile')).toHaveLength(0);
    expect(bullMq.enqueue).toHaveBeenCalledWith(
      'process-thumbnail',
      'process-thumbnail',
      { ...payload, metadataWaits: 1 },
      expect.objectContaining({ delay: 1000 }),
    );
  });

  it('stops deferring once the metadata wait budget is spent', async () => {
    const { run, fake, bullMq } = setup();
    fake.files.set(
      base.fileId,
      makeFileRecord({ id: base.fileId, userId: base.userId, mimeType: 'video/mp4' }),
    );
    fake.assets.set(
      base.assetId,
      makeAsset({
        id: base.assetId,
        userId: base.userId,
        fileId: base.fileId,
        kind: 'video',
        metadataStatus: 'pending',
      }),
    );

    // budget spent: falls through to the real attempt (and fails on the missing source file here)
    await expect(
      run(fakeJob(signJob({ ...base, size: 'lg' as const, metadataWaits: 5 }))),
    ).rejects.toThrow();

    expect(bullMq.enqueue).not.toHaveBeenCalled();
    expect(fake.callsOf('patchMetadata').at(-1)!.args[1]).toEqual({
      thumbnailStatus: 'failed',
    });
  });
});
