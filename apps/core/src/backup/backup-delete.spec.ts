import { describe, expect, it, vi, type Mock } from 'vitest';
import { randomUUID } from 'crypto';
import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { backupPrefix, manifestKey } from '@photox/shared-config';
import { User } from '../users/entities/user.entity';
import { UserBackupService } from './user-backup.service';

function user(over: Partial<User> = {}): User {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'ada@example.com',
    role: 'user',
    passwordHash: 'x',
    displayName: 'Ada',
    tokensValidAfter: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function manifestJson(opts: { userId: string; email: string }): Buffer {
  const { userId, email } = opts;
  return Buffer.from(
    JSON.stringify({
      manifestVersion: 1,
      userId,
      emailAtBackup: email,
      backedUpAt: '2026-10-01T00:00:00.000Z',
      user: {
        id: userId,
        email,
        role: 'user',
        passwordHash: 'x',
        displayName: 'Test',
        tokensValidAfter: null,
      },
      files: [],
      assets: [],
      albums: [],
      albumAssets: [],
      shares: [],
      persons: [],
    }),
  );
}

interface DeleteMocks {
  usersRepo: {
    findOne: Mock<(where: unknown) => Promise<User | null>>;
    save: Mock<() => Promise<never>>;
    update: Mock<() => Promise<never>>;
    delete: Mock<() => Promise<never>>;
    remove: Mock<() => Promise<never>>;
  };
  dataSource: { transaction: Mock<() => Promise<never>>; query: Mock<() => Promise<never>> };
  s3: {
    ensureBucket: Mock<() => Promise<void>>;
    listKeys: Mock<(prefix: string) => Promise<string[]>>;
    getBuffer: Mock<(key: string) => Promise<Buffer>>;
    headObject: Mock<(key: string) => Promise<void>>;
    deleteKeys: Mock<(keys: string[]) => Promise<void>>;
  };
}

function makeDeleteService(opts: {
  user: User | null;
  keys: string[];
  objects?: Map<string, Buffer>;
}): { svc: UserBackupService; mocks: DeleteMocks } {
  const { user: found, keys, objects = new Map<string, Buffer>() } = opts;
  const usersRepo = {
    findOne: vi.fn().mockResolvedValue(found),
    save: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    remove: vi.fn(),
  };
  const writeOnlyRepo = () => ({
    save: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    remove: vi.fn(),
  });
  const filesRepo = writeOnlyRepo();
  const assetsRepo = writeOnlyRepo();
  const dataSource = { transaction: vi.fn(), query: vi.fn() };
  const s3 = {
    ensureBucket: vi.fn().mockResolvedValue(undefined),
    listKeys: vi.fn((prefix: string) => Promise.resolve(keys.filter((k) => k.startsWith(prefix)))),
    getBuffer: vi.fn((key: string) => {
      const hit = objects.get(key);
      if (!hit) {
        const err = new Error(`missing key ${key}`);
        err.name = 'NoSuchKey';
        throw err;
      }
      return Promise.resolve(Buffer.from(hit));
    }),
    headObject: vi.fn((key: string) => {
      if (!objects.has(key)) {
        const err = new Error(`missing key ${key}`);
        err.name = 'NoSuchKey';
        throw err;
      }
      return Promise.resolve();
    }),
    deleteKeys: vi.fn(() => Promise.resolve()),
  };
  const nil = undefined as never;
  const svc = new UserBackupService(
    s3 as never,
    dataSource as never,
    nil,
    nil,
    nil,
    usersRepo as unknown as Repository<User>,
    filesRepo as never,
    assetsRepo as never,
    nil,
    nil,
    nil,
    nil,
    nil,
  );
  return { svc, mocks: { usersRepo, dataSource, s3 } };
}

function expectNoDbWrites(mocks: DeleteMocks): void {
  const { usersRepo, dataSource } = mocks;
  expect(usersRepo.save).not.toHaveBeenCalled();
  expect(usersRepo.update).not.toHaveBeenCalled();
  expect(usersRepo.delete).not.toHaveBeenCalled();
  expect(usersRepo.remove).not.toHaveBeenCalled();
  expect(dataSource.transaction).not.toHaveBeenCalled();
  expect(dataSource.query).not.toHaveBeenCalled();
}

describe('locateBackup fallback (email-matched legacy backup)', () => {
  it('resolves status/delete to an email-matched orphan when the live user has no exact manifest', async () => {
    const ada = user({ email: 'ada@example.com' });
    const orphanId = '33333333-3333-4333-8333-333333333333';
    const orphanPrefix = backupPrefix(ada.email, orphanId);
    const orphanManifest = `${orphanPrefix}manifest.json`;
    const orphanBytes = `${orphanPrefix}originals/a.bin`;
    const objects = new Map([
      [orphanManifest, manifestJson({ userId: orphanId, email: ada.email })],
    ]);
    const { svc, mocks } = makeDeleteService({
      user: ada,
      keys: [orphanManifest, orphanBytes],
      objects,
    });

    await expect(svc.backupStatus(ada.id)).resolves.toMatchObject({
      exists: true,
      userId: orphanId,
      emailAtBackup: ada.email,
    });
    const deleted = await svc.deleteBackup(ada.id);
    expect(deleted).toMatchObject({ userId: orphanId, email: ada.email, prefix: orphanPrefix });
    expect(mocks.s3.deleteKeys.mock.calls[0]![0].sort()).toEqual(
      [orphanManifest, orphanBytes].sort(),
    );
  });

  it('prefers the exact live prefix when its manifest exists', async () => {
    const ada = user({ email: 'ada@example.com' });
    const exactPrefix = backupPrefix(ada.email, ada.id);
    const exactManifest = manifestKey(ada.email, ada.id);
    const exactBytes = `${exactPrefix}originals/live.bin`;
    const orphanId = '33333333-3333-4333-8333-333333333333';
    const orphanPrefix = backupPrefix(ada.email, orphanId);
    const orphanManifest = `${orphanPrefix}manifest.json`;
    const objects = new Map([
      [exactManifest, manifestJson({ userId: ada.id, email: ada.email })],
      [orphanManifest, manifestJson({ userId: orphanId, email: ada.email })],
    ]);
    const { svc, mocks } = makeDeleteService({
      user: ada,
      keys: [exactManifest, exactBytes, orphanManifest],
      objects,
    });

    await expect(svc.backupStatus(ada.id)).resolves.toMatchObject({
      exists: true,
      userId: ada.id,
    });
    const deleted = await svc.deleteBackup(ada.id);
    expect(deleted).toMatchObject({ userId: ada.id, prefix: exactPrefix, deletedObjects: 2 });
    expect(mocks.s3.deleteKeys.mock.calls[0]![0].sort()).toEqual(
      [exactManifest, exactBytes].sort(),
    );
  });

  it('restore of a listed-but-missing manifest is a 404, not an S3 error', async () => {
    const orphanId = '33333333-3333-4333-8333-333333333333';
    const orphanPrefix = backupPrefix('ghost@example.com', orphanId);
    const { svc } = makeDeleteService({
      user: null,
      keys: [`${orphanPrefix}manifest.json`],
    });
    await expect(svc.restoreUser(orphanId)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('picks the newest manifest for a deleted user with multiple prefixes', async () => {
    const orphanId = '33333333-3333-4333-8333-333333333333';
    const olderPrefix = backupPrefix('old@example.com', orphanId);
    const newerPrefix = backupPrefix('new@example.com', orphanId);
    const olderManifest = `${olderPrefix}manifest.json`;
    const newerManifest = `${newerPrefix}manifest.json`;
    const older = JSON.parse(
      manifestJson({ userId: orphanId, email: 'old@example.com' }).toString(),
    ) as { backedUpAt: string };
    older.backedUpAt = '2026-01-01T00:00:00.000Z';
    const newer = JSON.parse(
      manifestJson({ userId: orphanId, email: 'new@example.com' }).toString(),
    ) as { backedUpAt: string };
    newer.backedUpAt = '2026-10-01T00:00:00.000Z';
    const objects = new Map([
      [olderManifest, Buffer.from(JSON.stringify(older))],
      [newerManifest, Buffer.from(JSON.stringify(newer))],
    ]);
    const { svc } = makeDeleteService({
      user: null,
      keys: [olderManifest, newerManifest, `${olderPrefix}originals/a.bin`],
      objects,
    });

    const deleted = await svc.deleteBackup(orphanId);
    expect(deleted).toMatchObject({ prefix: newerPrefix, email: 'new@example.com' });
  });
});

describe('deleteBackup', () => {
  it('deletes every key under the live prefix and reports the manifest backup-time email', async () => {
    const ada = user({ email: 'new@example.com' });
    const prefix = backupPrefix(ada.email, ada.id);
    const manifestObjectKey = manifestKey(ada.email, ada.id);
    const byteKeys = [`${prefix}originals/a.bin`, `${prefix}originals/b.bin`];
    // pending email-change rename: the manifest still carries the old address
    const objects = new Map([
      [manifestObjectKey, manifestJson({ userId: ada.id, email: 'old@example.com' })],
    ]);
    const { svc, mocks } = makeDeleteService({
      user: ada,
      keys: [...byteKeys, manifestObjectKey],
      objects,
    });

    const result = await svc.deleteBackup(ada.email);
    expect(result).toEqual({
      userId: ada.id,
      email: 'old@example.com',
      prefix,
      deletedObjects: 3,
    });
    expect(mocks.s3.deleteKeys).toHaveBeenCalledTimes(1);
    expect(mocks.s3.deleteKeys.mock.calls[0]![0].sort()).toEqual(
      [...byteKeys, manifestObjectKey].sort(),
    );
    expectNoDbWrites(mocks);
  });

  it('resolves deleted-user backups by userId and deletes only that prefix', async () => {
    const orphanId = '33333333-3333-4333-8333-333333333333';
    const orphanEmail = 'gone@example.com';
    const orphanPrefix = backupPrefix(orphanEmail, orphanId);
    const orphanManifest = `${orphanPrefix}manifest.json`;
    const otherPrefix = backupPrefix('live@example.com', '22222222-2222-4222-8222-222222222222');
    const otherManifest = `${otherPrefix}manifest.json`;
    const objects = new Map([
      [orphanManifest, manifestJson({ userId: orphanId, email: orphanEmail })],
      [
        otherManifest,
        manifestJson({ userId: '22222222-2222-4222-8222-222222222222', email: 'live@example.com' }),
      ],
    ]);
    const orphanBytes = `${orphanPrefix}originals/file.bin`;
    const { svc, mocks } = makeDeleteService({
      user: null,
      keys: [orphanManifest, orphanBytes, otherManifest, `${otherPrefix}originals/x.bin`],
      objects,
    });

    const result = await svc.deleteBackup(orphanId);
    expect(result).toEqual({
      userId: orphanId,
      email: orphanEmail,
      prefix: orphanPrefix,
      deletedObjects: 2,
    });
    expect(mocks.s3.deleteKeys).toHaveBeenCalledTimes(1);
    expect(mocks.s3.deleteKeys.mock.calls[0]![0].sort()).toEqual(
      [orphanBytes, orphanManifest].sort(),
    );
    expectNoDbWrites(mocks);
  });

  it('throws 404 for unknown ids and emails', async () => {
    const { svc: byId } = makeDeleteService({ user: null, keys: [] });
    await expect(byId.deleteBackup(randomUUID())).rejects.toBeInstanceOf(NotFoundException);
    const { svc: byEmail, mocks } = makeDeleteService({ user: null, keys: [] });
    await expect(byEmail.deleteBackup('ghost@example.com')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(mocks.s3.deleteKeys).not.toHaveBeenCalled();
  });

  it('throws 404 when the live prefix is empty (never backed up)', async () => {
    const ada = user();
    const { svc, mocks } = makeDeleteService({ user: ada, keys: [] });
    await expect(svc.deleteBackup(ada.id)).rejects.toBeInstanceOf(NotFoundException);
    expect(mocks.s3.deleteKeys).not.toHaveBeenCalled();
    expectNoDbWrites(mocks);
  });

  it('falls back to the prefix email when the manifest is unreadable', async () => {
    const ada = user();
    const prefix = backupPrefix(ada.email, ada.id);
    const manifestObjectKey = manifestKey(ada.email, ada.id);
    const { svc, mocks } = makeDeleteService({
      user: ada,
      keys: [`${prefix}originals/a.bin`, manifestObjectKey],
      objects: new Map([[manifestObjectKey, Buffer.from('unreadable-bytes')]]),
    });
    mocks.s3.getBuffer.mockImplementation((key: string) => {
      if (key === manifestObjectKey) {
        const err = new Error('injected unreadable');
        err.name = 'InternalError';
        throw err;
      }
      throw new Error(`unexpected key ${key}`);
    });

    const result = await svc.deleteBackup(ada.id);
    expect(result).toEqual({ userId: ada.id, email: ada.email, prefix, deletedObjects: 2 });
    expect(mocks.s3.deleteKeys).toHaveBeenCalledTimes(1);
  });

  it('maps S3 outages to 503 (ensureBucket, listKeys, deleteKeys)', async () => {
    const ada = user();
    const prefix = backupPrefix(ada.email, ada.id);
    const manifestObjectKey = manifestKey(ada.email, ada.id);
    const keys = [`${prefix}originals/a.bin`, manifestObjectKey];
    const objects = new Map([
      [manifestObjectKey, manifestJson({ userId: ada.id, email: ada.email })],
    ]);

    const bucketDown = makeDeleteService({ user: ada, keys, objects });
    bucketDown.mocks.s3.ensureBucket.mockRejectedValue(new Error('s3 down'));
    await expect(bucketDown.svc.deleteBackup(ada.id)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    const listDown = makeDeleteService({ user: ada, keys, objects });
    listDown.mocks.s3.listKeys.mockRejectedValue(new Error('s3 down'));
    await expect(listDown.svc.deleteBackup(ada.id)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(listDown.mocks.s3.deleteKeys).not.toHaveBeenCalled();

    const deleteDown = makeDeleteService({ user: ada, keys, objects });
    deleteDown.mocks.s3.deleteKeys.mockRejectedValue(new Error('s3 down'));
    await expect(deleteDown.svc.deleteBackup(ada.id)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});

describe('backupStatus invariants', () => {
  it('reports exists:false for a missing manifest', async () => {
    const ada = user();
    const { svc } = makeDeleteService({ user: ada, keys: [] });
    await expect(svc.backupStatus(ada.id)).resolves.toEqual({ exists: false });
  });

  it('maps an S3 outage to 503 instead of exists:false', async () => {
    const ada = user();
    const { svc, mocks } = makeDeleteService({ user: ada, keys: [] });
    const err = new Error('s3 down');
    err.name = 'InternalError';
    mocks.s3.headObject.mockRejectedValue(err);
    await expect(svc.backupStatus(ada.id)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('reports a corrupt manifest as degraded (never 404) and still resolves the delete email', async () => {
    const ada = user();
    const prefix = backupPrefix(ada.email, ada.id);
    const manifestObjectKey = manifestKey(ada.email, ada.id);
    const { svc, mocks } = makeDeleteService({
      user: ada,
      keys: [`${prefix}originals/a.bin`, manifestObjectKey],
      objects: new Map([[manifestObjectKey, Buffer.from('{"emailAtBackup":')]]),
    });

    await expect(svc.backupStatus(ada.id)).resolves.toMatchObject({
      exists: true,
      degraded: 'corrupt',
      emailAtBackup: ada.email,
    });
    await expect(svc.deleteBackup(ada.id)).resolves.toEqual({
      userId: ada.id,
      email: ada.email,
      prefix,
      deletedObjects: 2,
    });
    expect(mocks.s3.deleteKeys).toHaveBeenCalledTimes(1);
  });
});
