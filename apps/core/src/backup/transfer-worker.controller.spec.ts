import type { UserBackupService } from './user-backup.service';
import { TransferWorkerController } from './transfer-worker.controller';

const USER = '33333333-3333-4333-8333-333333333333';
const RUN = '44444444-4444-4444-8444-444444444444';
const ITEM = '55555555-5555-4555-8555-555555555555';

function controllerWith() {
  const service = {
    claimTransfer: vi.fn(),
    completeTransfer: vi.fn(),
    failTransfer: vi.fn(),
  };
  return {
    controller: new TransferWorkerController(service as unknown as UserBackupService),
    service,
  };
}

describe('TransferWorkerController', () => {
  it('maps a claimed ledger item and pins the call to the verified job user', async () => {
    const { controller, service } = controllerWith();
    service.claimTransfer.mockResolvedValue({
      run: { id: RUN },
      item: {
        fileId: 'f1',
        storageKey: 'originals/u/f.bin',
        s3Key: 'backups/u/f.bin',
        mimeType: null,
        checksumSha256: 'abc',
      },
    });

    const res = await controller.claim(USER, {
      runId: RUN,
      itemId: ITEM,
      kind: 'backup',
      attempt: 2,
    });

    expect(service.claimTransfer).toHaveBeenCalledWith('backup', RUN, ITEM, 2, USER);
    expect(res).toEqual({
      claimed: true,
      fileId: 'f1',
      storageKey: 'originals/u/f.bin',
      s3Key: 'backups/u/f.bin',
      mimeType: null,
      checksumSha256: 'abc',
    });
  });

  it('reports a stale/duplicate claim as claimed:false without exposing ledger rows', async () => {
    const { controller, service } = controllerWith();
    service.claimTransfer.mockResolvedValue(null);

    await expect(
      controller.claim(USER, { runId: RUN, itemId: ITEM, kind: 'restore', attempt: 1 }),
    ).resolves.toEqual({ claimed: false });
  });

  it('completes idempotently for the job user', async () => {
    const { controller, service } = controllerWith();

    await expect(controller.complete(USER, { runId: RUN, itemId: ITEM })).resolves.toEqual({
      ok: true,
    });
    expect(service.completeTransfer).toHaveBeenCalledWith(RUN, ITEM, USER);
  });

  it('threads the failure facts and returns the retry disposition', async () => {
    const { controller, service } = controllerWith();
    service.failTransfer.mockResolvedValue(true);
    const dto = {
      runId: RUN,
      itemId: ITEM,
      kind: 'restore' as const,
      message: 'checksum mismatch',
      code: 'ENOSPC',
      attempt: 2,
      maxAttempts: 5,
    };

    await expect(controller.fail(USER, dto)).resolves.toEqual({ retry: true });
    expect(service.failTransfer).toHaveBeenCalledWith('restore', RUN, ITEM, dto, USER);
  });
});
