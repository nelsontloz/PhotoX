import { describe, expect, it } from 'vitest';
import { UnrecoverableError, type Job } from 'bullmq';
import { randomUUID } from 'crypto';
import { unlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { branchFor, metadataProcessor } from './metadata.processor';
import type { AssetRefsJob } from './job-schemas';
import type { CoreClient } from '../core/core-client.service';
import { FakeCoreClient, makeAsset, makeFileRecord } from '../../test/fake-core-client';
import { signJob, useTestAuthEnv } from '../../test/sign-job';

describe('branchFor', () => {
  it('branches on the probed mime type', () => {
    expect(branchFor('image/jpeg')).toBe('photo');
    expect(branchFor('image/heic')).toBe('photo');
    expect(branchFor('video/mp4')).toBe('video');
    expect(branchFor('video/webm')).toBe('video');
  });

  it('returns null for unknown or missing mime types', () => {
    expect(branchFor('application/octet-stream')).toBeNull();
    expect(branchFor(null)).toBeNull();
    expect(branchFor('')).toBeNull();
  });
});

describe('MetadataProcessor job guards', () => {
  const base = {
    assetId: randomUUID(),
    fileId: randomUUID(),
    userId: randomUUID(),
  };
  const fakeJob = (data: unknown) => ({ data }) as unknown as Job<AssetRefsJob>;

  beforeEach(useTestAuthEnv);

  function setup(
    opts: {
      storage?: { pathFor(key: string): string };
      metadataExtractor?: { extract(buffer: Buffer): Record<string, unknown> };
      videoMetadataExtractor?: { extract(path: string): Promise<Record<string, unknown>> };
    } = {},
  ) {
    const fake = new FakeCoreClient();
    const spec = metadataProcessor({
      core: fake as unknown as CoreClient,
      storage: (opts.storage ?? {}) as never,
      metadataExtractor: (opts.metadataExtractor ?? {}) as never,
      videoMetadataExtractor: (opts.videoMetadataExtractor ?? {}) as never,
    });
    return { run: spec.run, fake };
  }

  it('rejects an invalid payload before any core call', async () => {
    const { run, fake } = setup();

    await expect(run(fakeJob({ ...base, assetId: 'not-a-uuid' }))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );

    expect(fake.calls).toHaveLength(0);
  });

  it('rejects a job whose asset belongs to another user without patching', async () => {
    const otherUser = randomUUID();
    const { run, fake } = setup();
    fake.files.set(base.fileId, makeFileRecord({ id: base.fileId, userId: base.userId }));
    fake.assets.set(
      base.assetId,
      makeAsset({ id: base.assetId, userId: otherUser, fileId: base.fileId }),
    );

    await expect(run(fakeJob(signJob(base)))).rejects.toBeInstanceOf(UnrecoverableError);

    expect(fake.callsOf('patchMetadata')).toHaveLength(0);
  });

  it('rounds a fractional EXIF iso before patching', async () => {
    const sourcePath = join(tmpdir(), `metadata-spec-${randomUUID()}`);
    await writeFile(sourcePath, 'exif-source');
    try {
      const { run, fake } = setup({
        storage: { pathFor: () => sourcePath },
        metadataExtractor: { extract: () => ({ iso: 100.5 }) },
      });
      fake.files.set(
        base.fileId,
        makeFileRecord({ id: base.fileId, userId: base.userId, mimeType: 'image/jpeg' }),
      );
      fake.assets.set(
        base.assetId,
        makeAsset({ id: base.assetId, userId: base.userId, fileId: base.fileId }),
      );

      await run(fakeJob(signJob(base)));

      const patch = fake.callsOf('patchMetadata').at(-1)!.args[1] as {
        iso: number;
        status: string;
      };
      expect(patch.iso).toBe(101);
      expect(patch.status).toBe('ready');
      expect(fake.assets.get(base.assetId)!.metadataStatus).toBe('ready');
    } finally {
      await unlink(sourcePath).catch(() => undefined);
    }
  });

  it('omits takenAt from the photo patch when EXIF has no date, preserving a client value', async () => {
    const sourcePath = join(tmpdir(), `metadata-spec-${randomUUID()}`);
    await writeFile(sourcePath, 'exif-source');
    try {
      const { run, fake } = setup({
        storage: { pathFor: () => sourcePath },
        metadataExtractor: { extract: () => ({ iso: 100, takenAt: null }) },
      });
      fake.files.set(
        base.fileId,
        makeFileRecord({ id: base.fileId, userId: base.userId, mimeType: 'image/jpeg' }),
      );
      fake.assets.set(
        base.assetId,
        makeAsset({
          id: base.assetId,
          userId: base.userId,
          fileId: base.fileId,
          takenAt: '2024-01-02T03:04:05.000Z',
        }),
      );

      await run(fakeJob(signJob(base)));

      const patch = fake.callsOf('patchMetadata').at(-1)!.args[1] as Record<string, unknown>;
      expect('takenAt' in patch).toBe(false);
      expect(fake.assets.get(base.assetId)!.takenAt).toBe('2024-01-02T03:04:05.000Z');
    } finally {
      await unlink(sourcePath).catch(() => undefined);
    }
  });

  it('sends the extracted photo date in the patch', async () => {
    const sourcePath = join(tmpdir(), `metadata-spec-${randomUUID()}`);
    await writeFile(sourcePath, 'exif-source');
    try {
      const takenAt = new Date('2024-06-15T12:30:00.000Z');
      const { run, fake } = setup({
        storage: { pathFor: () => sourcePath },
        metadataExtractor: { extract: () => ({ iso: 100, takenAt }) },
      });
      fake.files.set(
        base.fileId,
        makeFileRecord({ id: base.fileId, userId: base.userId, mimeType: 'image/jpeg' }),
      );
      fake.assets.set(
        base.assetId,
        makeAsset({ id: base.assetId, userId: base.userId, fileId: base.fileId }),
      );

      await run(fakeJob(signJob(base)));

      const patch = fake.callsOf('patchMetadata').at(-1)!.args[1] as Record<string, unknown>;
      expect(patch.takenAt).toEqual(takenAt);
      expect(fake.assets.get(base.assetId)!.takenAt).toBe('2024-06-15T12:30:00.000Z');
    } finally {
      await unlink(sourcePath).catch(() => undefined);
    }
  });

  it('omits takenAt from the video patch when ffprobe has no date, preserving a client value', async () => {
    const sourcePath = join(tmpdir(), `metadata-spec-${randomUUID()}`);
    await writeFile(sourcePath, 'video-source');
    try {
      const { run, fake } = setup({
        storage: { pathFor: () => sourcePath },
        videoMetadataExtractor: {
          extract: () => Promise.resolve({ durationSeconds: 2.5, takenAt: null }),
        },
      });
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
          takenAt: '2024-01-02T03:04:05.000Z',
        }),
      );

      await run(fakeJob(signJob(base)));

      const patch = fake.callsOf('patchMetadata').at(-1)!.args[1] as Record<string, unknown>;
      expect('takenAt' in patch).toBe(false);
      expect(patch.durationSeconds).toBe(2.5);
      expect(fake.assets.get(base.assetId)!.takenAt).toBe('2024-01-02T03:04:05.000Z');
    } finally {
      await unlink(sourcePath).catch(() => undefined);
    }
  });

  it('sends the probed video date in the patch', async () => {
    const sourcePath = join(tmpdir(), `metadata-spec-${randomUUID()}`);
    await writeFile(sourcePath, 'video-source');
    try {
      const takenAt = new Date('2024-06-15T12:30:00.000Z');
      const { run, fake } = setup({
        storage: { pathFor: () => sourcePath },
        videoMetadataExtractor: {
          extract: () => Promise.resolve({ durationSeconds: 1, takenAt }),
        },
      });
      fake.files.set(
        base.fileId,
        makeFileRecord({ id: base.fileId, userId: base.userId, mimeType: 'video/mp4' }),
      );
      fake.assets.set(
        base.assetId,
        makeAsset({ id: base.assetId, userId: base.userId, fileId: base.fileId, kind: 'video' }),
      );

      await run(fakeJob(signJob(base)));

      const patch = fake.callsOf('patchMetadata').at(-1)!.args[1] as Record<string, unknown>;
      expect(patch.takenAt).toEqual(takenAt);
      expect(fake.assets.get(base.assetId)!.takenAt).toBe('2024-06-15T12:30:00.000Z');
    } finally {
      await unlink(sourcePath).catch(() => undefined);
    }
  });
});
