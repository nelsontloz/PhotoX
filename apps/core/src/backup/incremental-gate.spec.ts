import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { User } from '../database/entities/user.entity';
import { shouldSkipUpload, UserBackupService } from './user-backup.service';

const file = { id: 'file-1', checksumSha256: 'abc', sizeBytes: 10 };
const key = 'backups/a__u1/originals/file-1.bin';

function prevWith(entry: { checksumSha256: string; sizeBytes: number }) {
  return new Map([['file-1', entry]]);
}

describe('shouldSkipUpload', () => {
  it('skips when id + checksum + size + listed all hold', () => {
    const prev = prevWith({ checksumSha256: 'abc', sizeBytes: 10 });
    expect(shouldSkipUpload(prev, new Set([key]), file, key)).toBe(true);
  });

  it('uploads when the previous map is null', () => {
    expect(shouldSkipUpload(null, new Set([key]), file, key)).toBe(false);
  });

  it('uploads when the id is unknown', () => {
    const prev = new Map([['other', { checksumSha256: 'abc', sizeBytes: 10 }]]);
    expect(shouldSkipUpload(prev, new Set([key]), file, key)).toBe(false);
  });

  it('uploads when the checksum changed', () => {
    const prev = prevWith({ checksumSha256: 'different', sizeBytes: 10 });
    expect(shouldSkipUpload(prev, new Set([key]), file, key)).toBe(false);
  });

  it('uploads when the size changed', () => {
    const prev = prevWith({ checksumSha256: 'abc', sizeBytes: 11 });
    expect(shouldSkipUpload(prev, new Set([key]), file, key)).toBe(false);
  });

  it('uploads when the key is S3-missing despite a manifest match', () => {
    const prev = prevWith({ checksumSha256: 'abc', sizeBytes: 10 });
    expect(shouldSkipUpload(prev, new Set(), file, key)).toBe(false);
  });

  it('uploads when every conjunct fails at once', () => {
    expect(shouldSkipUpload(null, new Set(), { ...file, id: 'ghost' }, 'missing')).toBe(false);
  });
});

function makeProgressService(user: User | null, run: unknown = null) {
  const findOne = vi.fn().mockResolvedValue(user);
  const users = { findOne } as unknown as Repository<User>;
  const runs = { findOne: vi.fn().mockResolvedValue(run) };
  // ponytail: progress transitions need no S3/DB — every other dep is nil and
  // only the users/runs repos are faked, so this stays a pure unit spec (no
  // testcontainers); full backup runs stay in test/integration/user-backup
  const nil = undefined as never;
  const svc = new UserBackupService(
    nil,
    nil,
    nil,
    nil,
    nil,
    users,
    nil,
    nil,
    nil,
    nil,
    nil,
    nil,
    nil,
    runs as never,
    nil,
    nil,
  );
  return { svc, findOne };
}

describe('getBackupProgress', () => {
  it('throws NotFoundException for an unknown user', async () => {
    const { svc } = makeProgressService(null);
    await expect(svc.getBackupProgress('ghost@example.com')).rejects.toThrow(NotFoundException);
  });

  it('returns an idle zero snapshot when no run ever started', async () => {
    const { svc } = makeProgressService({ id: 'user-1' } as User);
    const progress = await svc.getBackupProgress('someone@example.com');
    expect(progress).toMatchObject({
      userId: 'user-1',
      inProgress: false,
      total: 0,
      completed: 0,
      uploaded: 0,
      skipped: 0,
    });
  });

  it('maps the latest run row to the progress snapshot', async () => {
    const run = {
      userId: 'user-1',
      state: 'running',
      totalItems: 3,
      completedItems: 1,
      uploaded: 1,
      skipped: 0,
      currentFile: 'a.jpg',
      startedAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:01.000Z'),
    };
    const { svc } = makeProgressService({ id: 'user-1' } as User, run);
    const progress = await svc.getBackupProgress('someone@example.com');
    expect(progress).toEqual({
      userId: 'user-1',
      inProgress: true,
      total: 3,
      completed: 1,
      uploaded: 1,
      skipped: 0,
      currentFile: 'a.jpg',
      startedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:01.000Z',
    });
  });
});
