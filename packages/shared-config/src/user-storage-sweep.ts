import { opendir, rm } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

/** The storage surface the sweep needs; `LocalStorageService` satisfies it. */
export interface SweepableStorage {
  pathFor(storageKey: string): string;
  delete(storageKey: string): Promise<void>;
}

/**
 * Every byte a user owns lives under one of these prefixes (AGENTS.md: originals, derivative
 * thumbnails, derivative transcodes, upload-session chunks). The account wipe sweeps them by
 * id, so it never needs the DB to find a file.
 */
export const USER_STORAGE_PREFIXES = [
  'originals',
  'derivatives/thumbnails',
  'derivatives/transcodes',
  'upload-sessions',
] as const;

export interface UserStorageSweepResult {
  deleted: number;
  failed: number;
  /** First failure message, for the terminal `partial` report. */
  firstError?: string;
}

export interface UserStorageSweepOptions {
  /** Keys deleted per batch (bounded memory on a 100k-file account). */
  pageSize?: number;
  /** Retries per key after the first failure; ENOENT is always success. */
  retries?: number;
  retryDelayMs?: number;
}

const DEFAULTS: Required<UserStorageSweepOptions> = {
  pageSize: 200,
  retries: 2,
  retryDelayMs: 50,
};

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Deletes every stored byte for `userId` under the four user prefixes, streaming each
 * directory instead of listing it recursively (a 100k-file account must not materialise the
 * whole tree). Individual failures are retried and counted, never thrown: the caller decides
 * whether a non-zero `failed` makes the wipe `partial`.
 */
export async function sweepUserStorage(
  storage: SweepableStorage,
  userId: string,
  options: UserStorageSweepOptions = {},
): Promise<UserStorageSweepResult> {
  const { pageSize, retries, retryDelayMs } = { ...DEFAULTS, ...options };
  const result: UserStorageSweepResult = { deleted: 0, failed: 0 };

  const removeOne = async (key: string): Promise<void> => {
    for (let attempt = 0; ; attempt++) {
      try {
        await storage.delete(key);
        result.deleted++;
        return;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          result.deleted++;
          return;
        }
        if (attempt >= retries) {
          result.failed++;
          result.firstError ??= `${key}: ${err instanceof Error ? err.message : String(err)}`;
          return;
        }
        await delay(retryDelayMs);
      }
    }
  };

  for (const prefix of USER_STORAGE_PREFIXES) {
    const root = storage.pathFor(`${prefix}/${userId}`);
    const page: string[] = [];
    const failedBefore = result.failed;
    const flush = async (): Promise<void> => {
      if (page.length === 0) return;
      const keys = page.splice(0, page.length);
      await Promise.all(keys.map((key) => removeOne(key)));
    };

    const walk = async (dir: string): Promise<void> => {
      const handle = await opendir(dir);
      for await (const entry of handle) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
          continue;
        }
        if (!entry.isFile()) continue;
        // separator-normalised so a key always matches what LocalStorageService built
        const rel = relative(root, full).split(sep).join('/');
        page.push(`${prefix}/${userId}/${rel}`);
        if (page.length >= pageSize) await flush();
      }
    };

    try {
      await walk(root);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    await flush();
    // only when every file under this prefix really went: `rm -rf` would otherwise delete the
    // survivors and silently turn a reported `partial` into data loss
    if (result.failed === failedBefore) {
      await rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  return result;
}
