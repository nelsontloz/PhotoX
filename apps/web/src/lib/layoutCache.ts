import type { AssetLayoutMonth } from '@photox/shared-types';
import type { TimelineItem } from './timelineLayout';

/**
 * Browser-side cache of timeline layout month windows (docs/timeline-layout-paging.md).
 * Only `{ t, w, h }` + window metadata is stored. There is no eviction beyond `pruneExcept`:
 * the exact scroll track needs every window, so a full cache is the point, not a leak.
 */
const DB_NAME = 'photox-layout';
const STORE = 'months';

export interface CachedMonth {
  from: string;
  to: string;
  count: number;
  version: string;
  items: TimelineItem[];
  savedAt: number;
}

// jsdom has no IndexedDB and private-mode browsers reject every call: one module-level Map backs
// both cases, so the tests exercise the same fallback path the browser uses (no test-only seam).
const memory = new Map<string, CachedMonth>();
let dbPromise: Promise<IDBDatabase | null> | null = null;

function memoryKey(userId: string | undefined, filterKey: string, monthKey: string): string {
  return `${userId ?? ''}\u0000${filterKey}\u0000${monthKey}`;
}

/** Opens the DB once; `null` means "use the memory fallback" (no IDB, or it refuses to open). */
function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  dbPromise ??= new Promise<IDBDatabase | null>((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      // an older tab holds the DB open: never hang the layout load on it
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  }).then((db) => {
    // a failed open is retried by the next load instead of disabling the cache for the session
    if (!db) dbPromise = null;
    return db;
  });
  return dbPromise;
}

function requestDone<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexedDB request failed'));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('indexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('indexedDB transaction aborted'));
  });
}

function readMemory(
  userId: string | undefined,
  filterKey: string,
  keys: readonly string[],
): Map<string, CachedMonth> {
  const found = new Map<string, CachedMonth>();
  for (const key of keys) {
    const hit = memory.get(memoryKey(userId, filterKey, key));
    if (hit) found.set(key, hit);
  }
  return found;
}

/** Cached windows among `keys`, keyed by month. Never throws (a cache miss is the fallback). */
export async function readMonths(
  userId: string | undefined,
  filterKey: string,
  keys: readonly string[],
): Promise<Map<string, CachedMonth>> {
  // no id → memory only: the logged-out state and person views must not touch a user's records
  if (!userId) return readMemory(userId, filterKey, keys);
  const db = await openDb();
  if (!db) return readMemory(userId, filterKey, keys);
  try {
    const store = db.transaction(STORE, 'readonly').objectStore(STORE);
    const pairs = await Promise.all(
      keys.map(
        async (key) =>
          [key, (await requestDone(store.get([userId, filterKey, key]))) as CachedMonth] as const,
      ),
    );
    const found = new Map<string, CachedMonth>();
    for (const [key, value] of pairs) if (value) found.set(key, value);
    return found;
  } catch {
    return readMemory(userId, filterKey, keys);
  }
}

/** Stores one window; falls back to memory when IDB is unavailable or out of quota. Never throws. */
export async function writeMonth(
  userId: string | undefined,
  filterKey: string,
  monthKey: string,
  month: Omit<CachedMonth, 'savedAt'>,
): Promise<void> {
  const record: CachedMonth = { ...month, savedAt: Date.now() };
  if (userId) {
    const db = await openDb();
    if (db) {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(record, [userId, filterKey, monthKey]);
        await transactionDone(tx);
        return;
      } catch {
        // fall through: the memory copy still serves this session when IDB rejects the write
      }
    }
  }
  memory.set(memoryKey(userId, filterKey, monthKey), record);
}

/** Drops this user/filter's records whose window vanished from the latest index. Never throws. */
export async function pruneExcept(
  userId: string | undefined,
  filterKey: string,
  keys: readonly string[],
): Promise<void> {
  const keep = new Set(keys);
  const prefix = memoryKey(userId, filterKey, '');
  for (const key of [...memory.keys()]) {
    if (key.startsWith(prefix) && !keep.has(key.slice(prefix.length))) memory.delete(key);
  }
  if (!userId) return;
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    // the 3-element stored keys of this namespace: [userId, filterKey, <anything>]
    const range = IDBKeyRange.bound([userId, filterKey], [userId, filterKey, []], false, true);
    const all = store.getAllKeys(range);
    all.onsuccess = () => {
      for (const key of all.result) {
        if (!keep.has(String((key as [string, string, string])[2]))) store.delete(key);
      }
    };
    await transactionDone(tx);
  } catch {
    // best effort: a stale record only costs one extra fetch if it is ever read again
  }
}

/** Windows whose cached copy is missing or stale — the only ones a load has to fetch. */
export function diffMonths(
  indexMonths: readonly AssetLayoutMonth[],
  cached: ReadonlyMap<string, Pick<CachedMonth, 'version'>>,
): AssetLayoutMonth[] {
  return indexMonths.filter((month) => cached.get(month.key)?.version !== month.version);
}
