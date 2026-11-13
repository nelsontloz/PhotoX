import { describe, expect, it, vi, type Mock } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import { backupPrefix, manifestKey, originalKey } from '@photox/shared-config';
import type { BackupRun } from '../database/entities/backup-run.entity';
import { UserBackupService, type UserBackupManifest } from './user-backup.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const EMAIL = 'ada@example.com';
const OLD_FILE_ID = '22222222-2222-4222-8222-222222222222';
const NEW_FILE_ID = '33333333-3333-4333-8333-333333333333';
const EXTRA_FILE_ID = '55555555-5555-4555-8555-555555555555';

const PREFIX = backupPrefix(EMAIL, USER_ID);
const MANIFEST_KEY = manifestKey(EMAIL, USER_ID);
const OLD_KEY = originalKey(EMAIL, USER_ID, OLD_FILE_ID, 'jpg');
const NEW_KEY = originalKey(EMAIL, USER_ID, NEW_FILE_ID, 'jpg');
const EXTRA_KEY = originalKey(EMAIL, USER_ID, EXTRA_FILE_ID, 'jpg');

/** The previous, still-published manifest — it references exactly the stale key. */
const OLD_MANIFEST = Buffer.from(
  JSON.stringify({
    manifestVersion: 1,
    files: [{ id: OLD_FILE_ID, storageKey: 'originals/a.jpg' }],
  }),
);

interface PruneS3 {
  putObject: Mock<(key: string, body: Buffer, contentType?: string) => Promise<void>>;
  headObject: Mock<(key: string) => Promise<void>>;
  listKeys: Mock<(prefix: string) => Promise<string[]>>;
  deleteKeys: Mock<(keys: string[]) => Promise<void>>;
}

function run(over: Partial<BackupRun> = {}): BackupRun {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    kind: 'backup',
    userId: USER_ID,
    state: 'finalizing',
    email: EMAIL,
    prefix: PREFIX,
    manifestKey: MANIFEST_KEY,
    manifestPath: null,
    identity: '2026-10-01T00:00:00.000Z',
    stalePrefixes: [],
    brokenFileIds: [],
    counts: { files: 1 },
    totalItems: 1,
    completedItems: 1,
    uploaded: 0,
    skipped: 1,
    failedItems: 0,
    currentFile: null,
    error: null,
    result: null,
    startedAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    finishedAt: null,
    ...over,
  };
}

/** Only `files[].id` and `files[].storageKey` are read by the prune. */
function manifestWith(fileId: string): UserBackupManifest {
  return {
    files: [{ id: fileId, storageKey: `originals/${USER_ID}/${fileId}.jpg` }],
  } as unknown as UserBackupManifest;
}

interface LiveFilesQuery {
  where(): LiveFilesQuery;
  andWhere(): LiveFilesQuery;
  getMany(): Promise<{ id: string; storageKey: string }[]>;
}

function makeService(
  store: Map<string, Buffer>,
  {
    failPut = false,
    liveFileIds = [NEW_FILE_ID],
  }: {
    failPut?: boolean;
    liveFileIds?: string[];
  } = {},
) {
  const s3: PruneS3 = {
    putObject: vi.fn((key: string, body: Buffer) => {
      if (failPut) return Promise.reject(new Error('S3 putObject failed'));
      store.set(key, Buffer.from(body));
      return Promise.resolve();
    }),
    headObject: vi.fn((key: string) =>
      store.has(key)
        ? Promise.resolve()
        : Promise.reject(Object.assign(new Error(`missing key ${key}`), { name: 'NotFound' })),
    ),
    listKeys: vi.fn((prefix: string) =>
      Promise.resolve([...store.keys()].filter((key) => key.startsWith(prefix))),
    ),
    deleteKeys: vi.fn((keys: string[]) => {
      for (const key of keys) store.delete(key);
      return Promise.resolve();
    }),
  };
  const runs = { update: vi.fn(() => Promise.resolve()) };
  const runItems = { count: vi.fn(() => Promise.resolve(0)), findOne: vi.fn() };
  const liveRows = liveFileIds.map((id) => ({ id, storageKey: `originals/${USER_ID}/${id}.jpg` }));
  const liveFiles: LiveFilesQuery = {
    where: () => liveFiles,
    andWhere: () => liveFiles,
    getMany: () => Promise.resolve(liveRows),
  };
  const files = { createQueryBuilder: () => liveFiles };
  const storage = { pathFor: (key: string) => join(tmpdir(), 'photox-prune-spec', key) };
  const nil = undefined as never;
  const svc = new UserBackupService(
    s3 as never,
    nil, // dataSource
    nil, // bullMq
    nil, // places
    storage as never,
    nil, // users
    files as never,
    nil, // assets
    nil, // albums
    nil, // albumAssets
    nil, // shares
    nil, // persons
    nil, // backupMerges
    runs as never,
    runItems as never,
    nil,
  );
  type Finalize = (run: BackupRun, manifest: UserBackupManifest) => Promise<void>;
  const finalize = (svc as unknown as { finalizeBackupRun: Finalize }).finalizeBackupRun.bind(svc);
  return { finalize, s3, runs, runItems };
}

function seededStore(): Map<string, Buffer> {
  return new Map([
    [MANIFEST_KEY, Buffer.from(OLD_MANIFEST)],
    [OLD_KEY, Buffer.from('old bytes')],
    [NEW_KEY, Buffer.from('new bytes')],
  ]);
}

describe('finalizeBackupRun — prune ordering', () => {
  it('publishes and HEAD-verifies the new manifest before pruning stale originals', async () => {
    const store = seededStore();
    const { finalize, s3, runs } = makeService(store);

    await finalize(run(), manifestWith(NEW_FILE_ID));

    // the stale key is gone, the backed-up key survives
    expect(store.has(OLD_KEY)).toBe(false);
    expect(store.has(NEW_KEY)).toBe(true);
    expect(s3.deleteKeys.mock.calls[0]?.[0]).toEqual([OLD_KEY]);
    // deleteKeys strictly after the manifest is durable
    expect(s3.putObject.mock.invocationCallOrder[0]).toBeLessThan(
      s3.headObject.mock.invocationCallOrder[0]!,
    );
    expect(s3.headObject.mock.invocationCallOrder[0]).toBeLessThan(
      s3.deleteKeys.mock.invocationCallOrder[0]!,
    );
    // the published manifest only lists bytes that exist
    const published = JSON.parse(store.get(MANIFEST_KEY)!.toString()) as {
      files: { id: string }[];
    };
    expect(published.files.map((file) => file.id)).toEqual([NEW_FILE_ID]);
    for (const file of published.files) {
      expect(store.has(originalKey(EMAIL, USER_ID, file.id, 'jpg'))).toBe(true);
    }
    expect(runs.update).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ state: 'completed' }),
    );
  });

  it('leaves the previous manifest and its bytes untouched when the manifest write fails', async () => {
    const store = seededStore();
    const { finalize, s3, runs } = makeService(store, { failPut: true });

    await expect(finalize(run(), manifestWith(NEW_FILE_ID))).rejects.toThrow('putObject failed');

    // nothing was pruned: the published manifest still resolves its file
    expect(s3.deleteKeys).not.toHaveBeenCalled();
    expect(store.has(OLD_KEY)).toBe(true);
    expect(store.get(MANIFEST_KEY)).toEqual(OLD_MANIFEST);
    expect(runs.update).not.toHaveBeenCalled();
  });

  it('keeps an original uploaded by another run while this one was copying', async () => {
    const store = seededStore();
    // a second start (the one the per-user guard must refuse) uploaded EXTRA_KEY after this
    // run took its snapshot: the row exists now, the snapshot does not list it
    store.set(EXTRA_KEY, Buffer.from('concurrent bytes'));
    const { finalize, s3 } = makeService(store, {
      liveFileIds: [NEW_FILE_ID, EXTRA_FILE_ID],
    });

    await finalize(run(), manifestWith(NEW_FILE_ID));

    expect(store.has(EXTRA_KEY)).toBe(true);
    expect(store.has(NEW_KEY)).toBe(true);
    expect(store.has(OLD_KEY)).toBe(false);
    expect(s3.deleteKeys.mock.calls[0]?.[0]).toEqual([OLD_KEY]);
  });
});
