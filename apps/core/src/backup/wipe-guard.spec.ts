import { ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { Repository } from 'typeorm';
import type { UserDelete } from '../database/entities/user-delete.entity';
import { RunLifecycleService } from './run-lifecycle.service';
import { UserBackupService } from './user-backup.service';

type WipeState = UserDelete['state'];

function makeService(state: WipeState | null): UserBackupService {
  const userDeletes = {
    findOne: () => Promise.resolve(state === null ? null : { userId: 'u', state }),
  } as unknown as Repository<UserDelete>;
  const nil = undefined as never;
  // only the lifecycle phase is reachable; every other phase stays nil so a
  // delegation surprise fails loudly
  const lifecycle = new RunLifecycleService(
    nil,
    nil,
    nil,
    nil,
    nil,
    nil,
    nil,
    nil,
    nil,
    nil,
    nil,
    nil,
    nil,
    nil,
    nil,
    userDeletes,
  );
  return new UserBackupService(nil, nil, nil, nil, lifecycle, nil);
}

function assertNoLiveWipe(service: UserBackupService): Promise<void> {
  return (
    service as unknown as { assertNoLiveWipe(userId: string): Promise<void> }
  ).assertNoLiveWipe('u');
}

describe('UserBackupService.assertNoLiveWipe', () => {
  it.each<WipeState>(['queued', 'active', 'wiping-files'])('blocks %s', async (state) => {
    await expect(assertNoLiveWipe(makeService(state))).rejects.toBeInstanceOf(ConflictException);
  });

  it.each<WipeState>(['completed', 'partial', 'failed'])('allows %s', async (state) => {
    await expect(assertNoLiveWipe(makeService(state))).resolves.toBeUndefined();
  });

  it('allows an account with no wipe row', async () => {
    await expect(assertNoLiveWipe(makeService(null))).resolves.toBeUndefined();
  });
});
