import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnrecoverableError, type Job } from 'bullmq';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStorageService, type S3BackupService } from '@photox/shared-config';
import { transferProcessor } from './transfer.processor';
import type { TransferJob } from './job-schemas';
import type { CoreClient } from '../core/core-client.service';
import { signJob, useTestAuthEnv } from '../../test/sign-job';

describe('TransferProcessor', () => {
  const base = { userId: randomUUID(), runId: randomUUID(), itemId: randomUUID() };
  const claimedItem = {
    claimed: true as const,
    fileId: randomUUID(),
    storageKey: `originals/${base.userId}/${randomUUID()}.jpg`,
    s3Key: `backups/${base.userId}/photo.jpg`,
    mimeType: 'image/jpeg',
    checksumSha256: null,
  };
  const fakeJob = (data: unknown) =>
    ({ data, attemptsMade: 0, opts: { attempts: 5 } }) as unknown as Job<TransferJob>;

  let storageDir: string;
  let prevStorageDir: string | undefined;
  let storage: LocalStorageService;

  beforeEach(() => {
    useTestAuthEnv();
    storageDir = mkdtempSync(join(tmpdir(), 'photox-transfer-test-'));
    prevStorageDir = process.env.STORAGE_DIR;
    process.env.STORAGE_DIR = storageDir;
    storage = new LocalStorageService();
  });

  afterEach(() => {
    if (prevStorageDir === undefined) delete process.env.STORAGE_DIR;
    else process.env.STORAGE_DIR = prevStorageDir;
    rmSync(storageDir, { recursive: true, force: true });
  });

  function setup(kind: 'backup' | 'restore' = 'backup') {
    const core = {
      claimTransfer: vi.fn(),
      completeTransfer: vi.fn().mockResolvedValue(undefined),
      failTransfer: vi.fn(),
    };
    const s3 = {
      putFile: vi.fn().mockResolvedValue(undefined),
      downloadToFile: vi.fn(),
    };
    const spec = transferProcessor(
      {
        core: core as unknown as CoreClient,
        s3: s3 as unknown as S3BackupService,
        storage,
      },
      kind,
    );
    return { run: spec.run, spec, core, s3 };
  }

  it('wires both queue names and the per-kind concurrency', () => {
    expect(setup('backup').spec.queue).toBe('backup-transfer');
    expect(setup('backup').spec.workerOptions).toMatchObject({ concurrency: 4 });
    expect(setup('restore').spec.queue).toBe('restore-transfer');
    expect(setup('restore').spec.workerOptions).toMatchObject({ concurrency: 2 });
  });

  it('uploads a claimed backup item, then reports it complete', async () => {
    const { run, core, s3 } = setup();
    core.claimTransfer.mockResolvedValue(claimedItem);

    await run(fakeJob(signJob(base)));

    expect(core.claimTransfer).toHaveBeenCalledWith(
      base.userId,
      'backup',
      base.runId,
      base.itemId,
      1,
      expect.objectContaining({ scope: base.userId }),
    );
    const binding = core.claimTransfer.mock.calls[0]?.[5] as { sig: string } | undefined;
    expect(binding?.sig).toMatch(/^[0-9a-f]{64}$/);
    expect(s3.putFile).toHaveBeenCalledWith(
      claimedItem.s3Key,
      storage.pathFor(claimedItem.storageKey),
      'image/jpeg',
    );
    expect(core.completeTransfer).toHaveBeenCalledWith(
      base.userId,
      base.runId,
      base.itemId,
      expect.objectContaining({ scope: base.userId }),
    );
    expect(core.failTransfer).not.toHaveBeenCalled();
  });

  it('does nothing when core refuses the claim', async () => {
    const { run, core, s3 } = setup();
    core.claimTransfer.mockResolvedValue({ claimed: false });

    await run(fakeJob(signJob(base)));

    expect(s3.putFile).not.toHaveBeenCalled();
    expect(s3.downloadToFile).not.toHaveBeenCalled();
    expect(core.completeTransfer).not.toHaveBeenCalled();
    expect(core.failTransfer).not.toHaveBeenCalled();
  });

  it('rethrowing a transient failure lets BullMQ retry it', async () => {
    const { run, core, s3 } = setup();
    const boom = new Error('socket hang up');
    core.claimTransfer.mockResolvedValue(claimedItem);
    s3.putFile.mockRejectedValue(boom);
    core.failTransfer.mockResolvedValue({ retry: true });

    await expect(run(fakeJob(signJob(base)))).rejects.toBe(boom);

    expect(core.failTransfer).toHaveBeenCalledWith(
      base.userId,
      'backup',
      base.runId,
      base.itemId,
      {
        message: 'socket hang up',
        code: undefined,
        errorName: 'Error',
        attempt: 1,
        maxAttempts: 5,
      },
      expect.objectContaining({ scope: base.userId }),
    );
    expect(core.completeTransfer).not.toHaveBeenCalled();
  });

  it('resolves a terminal failure without reporting it complete', async () => {
    const { run, core, s3 } = setup();
    const err = Object.assign(new Error('no space left on device'), {
      code: 'ENOSPC',
      name: 'ErrnoException',
    });
    core.claimTransfer.mockResolvedValue(claimedItem);
    s3.putFile.mockRejectedValue(err);
    core.failTransfer.mockResolvedValue({ retry: false });

    await expect(run(fakeJob(signJob(base)))).resolves.toBeUndefined();

    expect(core.failTransfer).toHaveBeenCalledWith(
      base.userId,
      'backup',
      base.runId,
      base.itemId,
      expect.objectContaining({ code: 'ENOSPC', errorName: 'ErrnoException' }),
      expect.anything(),
    );
    expect(core.completeTransfer).not.toHaveBeenCalled();
  });

  it('restores a checksum-verified download into STORAGE_DIR', async () => {
    const { run, core, s3 } = setup('restore');
    const bytes = Buffer.from('restored bytes');
    const checksum = createHash('sha256').update(bytes).digest('hex');
    core.claimTransfer.mockResolvedValue({ ...claimedItem, checksumSha256: checksum });
    s3.downloadToFile.mockImplementation(async (_key: string, dest: string) => {
      await writeFile(dest, bytes);
    });

    await run(fakeJob(signJob(base)));

    expect(s3.downloadToFile).toHaveBeenCalledWith(
      claimedItem.s3Key,
      expect.stringContaining('.part'),
    );
    expect(await readFile(storage.pathFor(claimedItem.storageKey))).toEqual(bytes);
    expect(core.completeTransfer).toHaveBeenCalled();
    // the temp dir is left empty
    expect(await readdir(storage.pathFor(join('backup-runs', base.runId, 'tmp')))).toEqual([]);
  });

  it('reports a checksum mismatch as a retryable failure and writes no bytes', async () => {
    const { run, core, s3 } = setup('restore');
    core.claimTransfer.mockResolvedValue({
      ...claimedItem,
      checksumSha256: '0'.repeat(64),
    });
    s3.downloadToFile.mockImplementation(async (_key: string, dest: string) => {
      await writeFile(dest, Buffer.from('corrupt'));
    });
    core.failTransfer.mockResolvedValue({ retry: true });

    await expect(run(fakeJob(signJob(base)))).rejects.toThrow('checksum mismatch');

    expect(core.failTransfer).toHaveBeenCalledWith(
      base.userId,
      'restore',
      base.runId,
      base.itemId,
      expect.objectContaining({ attempt: 1, maxAttempts: 5 }),
      expect.anything(),
    );
    const failure = core.failTransfer.mock.calls[0]?.[4] as { message: string } | undefined;
    expect(failure?.message).toContain('checksum mismatch');
    expect(await readdir(storage.pathFor(join('backup-runs', base.runId, 'tmp')))).toEqual([]);
    expect(core.completeTransfer).not.toHaveBeenCalled();
  });

  it('rejects a job with no valid signature before any core call', async () => {
    const { run, core, s3 } = setup();

    await expect(run(fakeJob({ ...base }))).rejects.toBeInstanceOf(UnrecoverableError);
    await expect(run(fakeJob({ ...base, sig: 'deadbeef' }))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );

    expect(core.claimTransfer).not.toHaveBeenCalled();
    expect(s3.putFile).not.toHaveBeenCalled();
  });
});
