import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { LocalStorageService } from './storage';
import { sweepUserStorage, type SweepableStorage } from './user-storage-sweep';

const USER_ID = '11111111-1111-4111-8111-111111111111';

async function withStorageDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'photox-sweep-'));
  const previous = process.env.STORAGE_DIR;
  process.env.STORAGE_DIR = dir;
  try {
    return await fn(dir);
  } finally {
    if (previous === undefined) delete process.env.STORAGE_DIR;
    else process.env.STORAGE_DIR = previous;
  }
}

async function plant(dir: string, key: string): Promise<string> {
  const full = join(dir, key);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, 'x');
  return full;
}

describe('sweepUserStorage', () => {
  it('deletes every file under the four user prefixes and counts them', async () => {
    await withStorageDir(async (dir) => {
      const storage = new LocalStorageService();
      await plant(dir, `originals/${USER_ID}/a.jpg`);
      await plant(dir, `originals/${USER_ID}/nested/b.jpg`);
      await plant(dir, `derivatives/thumbnails/${USER_ID}/c.webp`);
      await plant(dir, `derivatives/transcodes/${USER_ID}/d.webm`);
      await plant(dir, `upload-sessions/${USER_ID}/session-1/part-0`);

      const result = await sweepUserStorage(storage, USER_ID);

      expect(result).toEqual({ deleted: 5, failed: 0 });
      await expect(storage.exists(`originals/${USER_ID}/a.jpg`)).resolves.toBe(false);
      await expect(storage.exists(`upload-sessions/${USER_ID}/session-1/part-0`)).resolves.toBe(
        false,
      );
    });
  });

  it('never touches another user, the models directory or the backup drafts', async () => {
    await withStorageDir(async (dir) => {
      const storage = new LocalStorageService();
      const other = '22222222-2222-4222-8222-222222222222';
      await plant(dir, `originals/${USER_ID}/mine.jpg`);
      await plant(dir, `originals/${other}/theirs.jpg`);
      await plant(dir, 'models/det_10g.onnx');
      await plant(dir, 'backup-runs/run-1/manifest.json');

      await sweepUserStorage(storage, USER_ID);

      await expect(storage.exists(`originals/${other}/theirs.jpg`)).resolves.toBe(true);
      await expect(storage.exists('models/det_10g.onnx')).resolves.toBe(true);
      await expect(storage.exists('backup-runs/run-1/manifest.json')).resolves.toBe(true);
    });
  });

  it('deletes in batches instead of holding the whole tree', async () => {
    await withStorageDir(async (dir) => {
      const storage = new LocalStorageService();
      for (let i = 0; i < 7; i++) await plant(dir, `originals/${USER_ID}/f${i}.jpg`);

      let inFlight = 0;
      let peak = 0;
      const counted: SweepableStorage = {
        pathFor: (key) => storage.pathFor(key),
        delete: async (key) => {
          inFlight++;
          peak = Math.max(peak, inFlight);
          await storage.delete(key);
          inFlight--;
        },
      };

      const result = await sweepUserStorage(counted, USER_ID, { pageSize: 3 });

      expect(result.deleted).toBe(7);
      expect(peak).toBeLessThanOrEqual(3);
    });
  });

  it('retries a failing delete and reports the survivors', async () => {
    await withStorageDir(async (dir) => {
      const storage = new LocalStorageService();
      await plant(dir, `originals/${USER_ID}/flaky.jpg`);
      await plant(dir, `originals/${USER_ID}/locked.jpg`);

      const attempts = new Map<string, number>();
      const flaky: SweepableStorage = {
        pathFor: (key) => storage.pathFor(key),
        delete: async (key) => {
          const seen = (attempts.get(key) ?? 0) + 1;
          attempts.set(key, seen);
          if (key.endsWith('flaky.jpg') && seen < 2) {
            throw Object.assign(new Error('busy'), { code: 'EBUSY' });
          }
          if (key.endsWith('locked.jpg')) {
            throw Object.assign(new Error('denied'), { code: 'EACCES' });
          }
          await storage.delete(key);
        },
      };

      const result = await sweepUserStorage(flaky, USER_ID, { retries: 2, retryDelayMs: 1 });

      // flaky succeeds on retry, locked exhausts its retries and stays put
      expect(result.deleted).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.firstError).toContain('locked.jpg');
      expect(attempts.get(`originals/${USER_ID}/flaky.jpg`)).toBe(2);
      await expect(storage.exists(`originals/${USER_ID}/locked.jpg`)).resolves.toBe(true);
    });
  });

  it('is idempotent when the prefixes are already gone', async () => {
    await withStorageDir(async () => {
      const storage = new LocalStorageService();
      await expect(sweepUserStorage(storage, USER_ID)).resolves.toEqual({ deleted: 0, failed: 0 });
      await expect(sweepUserStorage(storage, USER_ID)).resolves.toEqual({ deleted: 0, failed: 0 });
    });
  });
});
