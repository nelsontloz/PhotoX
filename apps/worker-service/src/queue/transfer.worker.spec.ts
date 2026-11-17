import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Job } from 'bullmq';
import { type Mock } from 'vitest';
import { LocalStorageService } from '@photox/shared-config';
import type { TransferClaim } from '@photox/shared-types';
import { createTransferProcessor, runTransferItem, type TransferStore } from './transfer.worker';
import type { GenericProcessorSpec, ProcessorDeps } from './processor-spec';
import type { CoreClient } from '../core/core-client.service';
import type { TransferJob } from './job-schemas';
import { signJob, useTestAuthEnv } from '../../test/sign-job';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';
const ITEM_ID = '33333333-3333-4333-8333-333333333333';
const FILE_ID = '44444444-4444-4444-8444-444444444444';
const STORAGE_KEY = `originals/${USER_ID}/${FILE_ID}.bin`;
const S3_KEY = `backups/user__${USER_ID}/originals/${FILE_ID}.bin`;
const BYTES = Buffer.from('transfer-bytes');

describe('transfer worker', () => {
  let storageDir: string;
  let prevStorageDir: string | undefined;
  let prevAuthSecret: string | undefined;
  let prevWorkerSecret: string | undefined;
  const storage = new LocalStorageService();

  beforeEach(() => {
    storageDir = mkdtempSync(join(tmpdir(), 'transfer-spec-'));
    prevStorageDir = process.env.STORAGE_DIR;
    process.env.STORAGE_DIR = storageDir;
    prevAuthSecret = process.env.AUTH_TOKEN_SECRET;
    prevWorkerSecret = process.env.WORKER_JWT_SECRET;
    useTestAuthEnv();
  });

  afterEach(() => {
    if (prevStorageDir === undefined) delete process.env.STORAGE_DIR;
    else process.env.STORAGE_DIR = prevStorageDir;
    if (prevAuthSecret === undefined) delete process.env.AUTH_TOKEN_SECRET;
    else process.env.AUTH_TOKEN_SECRET = prevAuthSecret;
    if (prevWorkerSecret === undefined) delete process.env.WORKER_JWT_SECRET;
    else process.env.WORKER_JWT_SECRET = prevWorkerSecret;
    rmSync(storageDir, { recursive: true, force: true });
  });

  function claim(over: Partial<TransferClaim> = {}): TransferClaim {
    return {
      kind: 'backup',
      runId: RUN_ID,
      itemId: ITEM_ID,
      fileId: FILE_ID,
      storageKey: STORAGE_KEY,
      s3Key: S3_KEY,
      checksumSha256: null,
      mimeType: 'image/png',
      ...over,
    };
  }

  function fakeStore() {
    const putFile =
      vi.fn<(key: string, localPath: string, contentType?: string) => Promise<void>>();
    const downloadToFile = vi.fn<(key: string, destPath: string) => Promise<void>>(
      async (_key, destPath) => {
        await writeFile(destPath, BYTES);
      },
    );
    const store: TransferStore = { putFile, downloadToFile };
    return { store, putFile, downloadToFile };
  }

  describe('runTransferItem', () => {
    it('uploads a backup item from its local path to its S3 key', async () => {
      const { store, putFile } = fakeStore();
      await mkdir(join(storageDir, 'originals', USER_ID), { recursive: true });
      await writeFile(storage.pathFor(STORAGE_KEY), BYTES);

      await runTransferItem(claim(), { storage, store });

      expect(putFile).toHaveBeenCalledTimes(1);
      expect(putFile).toHaveBeenCalledWith(S3_KEY, storage.pathFor(STORAGE_KEY), 'image/png');
    });

    it('downloads a restore item into storage, verifying its checksum and dropping the part file', async () => {
      const { store, downloadToFile } = fakeStore();
      const checksumSha256 = createHash('sha256').update(BYTES).digest('hex');

      await runTransferItem(claim({ kind: 'restore', checksumSha256 }), { storage, store });

      expect(downloadToFile).toHaveBeenCalledWith(S3_KEY, expect.stringContaining(RUN_ID));
      expect(await readFile(storage.pathFor(STORAGE_KEY))).toEqual(BYTES);
      expect(readdirSync(storage.pathFor(join('backup-runs', RUN_ID, 'tmp')))).toHaveLength(0);
    });

    it('rejects a restore whose bytes do not match the manifest checksum', async () => {
      const { store } = fakeStore();

      await expect(
        runTransferItem(claim({ kind: 'restore', checksumSha256: 'a'.repeat(64) }), {
          storage,
          store,
        }),
      ).rejects.toThrow('checksum mismatch');

      expect(await storage.exists(STORAGE_KEY)).toBe(false);
      expect(readdirSync(storage.pathFor(join('backup-runs', RUN_ID, 'tmp')))).toHaveLength(0);
    });
  });

  describe('createTransferProcessor', () => {
    let claimTransfer: Mock<CoreClient['claimTransfer']>;
    let finishTransfer: Mock<CoreClient['finishTransfer']>;
    let store: TransferStore;
    let putFile: Mock<(key: string, localPath: string, contentType?: string) => Promise<void>>;

    beforeEach(() => {
      claimTransfer = vi.fn<CoreClient['claimTransfer']>();
      finishTransfer = vi.fn<CoreClient['finishTransfer']>().mockResolvedValue({ retry: false });
      ({ store, putFile } = fakeStore());
    });

    function run(): GenericProcessorSpec<TransferJob>['run'] {
      const spec = createTransferProcessor(
        'backup',
        () => store,
      )({
        core: { claimTransfer, finishTransfer } as unknown as CoreClient,
        storage,
      } as unknown as ProcessorDeps);
      return (spec as unknown as GenericProcessorSpec<TransferJob>).run;
    }

    function job(): Job<TransferJob> {
      return {
        data: signJob({ userId: USER_ID, runId: RUN_ID, itemId: ITEM_ID }),
        attemptsMade: 0,
      } as unknown as Job<TransferJob>;
    }

    it('does nothing when the claim answers null', async () => {
      claimTransfer.mockResolvedValue(null);

      await run()(job());

      expect(finishTransfer).not.toHaveBeenCalled();
      expect(putFile).not.toHaveBeenCalled();
    });

    it('reports a success with the job attempt number', async () => {
      claimTransfer.mockResolvedValue(claim());

      await run()(job());

      expect(putFile).toHaveBeenCalledTimes(1);
      expect(finishTransfer.mock.calls[0]?.[4]).toEqual({ attempt: 1, ok: true });
    });

    it('throws when core asks for a retry', async () => {
      claimTransfer.mockResolvedValue(claim());
      putFile.mockRejectedValueOnce(
        Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }),
      );
      finishTransfer.mockResolvedValue({ retry: true });

      await expect(run()(job())).rejects.toThrow('socket hang up');

      expect(finishTransfer.mock.calls[0]?.[4]).toMatchObject({
        attempt: 1,
        ok: false,
        errorCode: 'ECONNRESET',
      });
    });

    it('resolves when core settled the failure itself', async () => {
      claimTransfer.mockResolvedValue(claim());
      putFile.mockRejectedValueOnce(Object.assign(new Error('no space left'), { code: 'ENOSPC' }));
      finishTransfer.mockResolvedValue({ retry: false });

      await expect(run()(job())).resolves.toBeUndefined();

      expect(finishTransfer.mock.calls[0]?.[4]).toMatchObject({ ok: false, errorCode: 'ENOSPC' });
    });
  });
});
