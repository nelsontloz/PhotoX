import { ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { Repository } from 'typeorm';
import type { UserDelete } from '../database/entities/user-delete.entity';
import { RunLifecycleService } from './run-lifecycle.service';

type WipeState = UserDelete['state'];

function makeService(state: WipeState | null): RunLifecycleService {
  const userDeletes = {
    findOne: () => Promise.resolve(state === null ? null : { userId: 'u', state }),
  } as unknown as Repository<UserDelete>;
  const nil = undefined as never;
  // only the wipe guard is reachable; every other dep stays nil so a surprise fails loudly
  return new RunLifecycleService(
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
}

describe('RunLifecycleService.assertNoLiveWipe', () => {
  it.each<WipeState>(['queued', 'active', 'wiping-files'])('blocks %s', async (state) => {
    await expect(makeService(state).assertNoLiveWipe('u')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it.each<WipeState>(['completed', 'partial', 'failed'])('allows %s', async (state) => {
    await expect(makeService(state).assertNoLiveWipe('u')).resolves.toBeUndefined();
  });

  it('allows an account with no wipe row', async () => {
    await expect(makeService(null).assertNoLiveWipe('u')).resolves.toBeUndefined();
  });
});
