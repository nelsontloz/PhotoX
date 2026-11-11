import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssetLayoutMonth } from '@photox/shared-types';
import { diffMonths, pruneExcept, readMonths, writeMonth } from './layoutCache';

const ITEMS = [{ t: '2024-03-15T12:00:00', w: 1000, h: 800 }];

function month(key: string, count: number, version = `9-${count}`): AssetLayoutMonth {
  return { key, from: `${key}-from`, to: `${key}-to`, count, version };
}

function seed(userId: string | undefined, filterKey: string, key: string, version = 'v1') {
  return writeMonth(userId, filterKey, key, {
    from: `${key}-from`,
    to: `${key}-to`,
    count: ITEMS.length,
    version,
    items: ITEMS,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('diffMonths', () => {
  it('returns only missing or version-changed windows, in index order', () => {
    const index = [month('2024-04', 3), month('2024-03', 2), month('2024-02', 1)];
    const cached = new Map([
      ['2024-04', { version: '9-3' }], // unchanged
      ['2024-03', { version: '8-7' }], // content moved
    ]);
    expect(diffMonths(index, cached).map((m) => m.key)).toEqual(['2024-03', '2024-02']);
  });

  it('is empty when every window matches', () => {
    const index = [month('2024-03', 2)];
    expect(diffMonths(index, new Map([['2024-03', { version: '9-2' }]]))).toEqual([]);
  });
});

describe('layoutCache memory fallback (jsdom has no IndexedDB)', () => {
  it('round-trips a window with its metadata', async () => {
    const user = 'cache-roundtrip';
    await seed(user, '||', '2024-03', 'v7');
    const found = await readMonths(user, '||', ['2024-03', '2024-02']);
    expect([...found.keys()]).toEqual(['2024-03']);
    const hit = found.get('2024-03');
    expect(hit).toMatchObject({ from: '2024-03-from', to: '2024-03-to', version: 'v7' });
    expect(hit?.items).toEqual(ITEMS);
    expect(hit?.savedAt).toEqual(expect.any(Number));
  });

  it('prunes windows that vanished from the index, keeping the listed ones', async () => {
    const user = 'cache-prune';
    await seed(user, '||', '2024-04');
    await seed(user, '||', '2024-03');
    await seed(user, '||', '2024-02');

    await pruneExcept(user, '||', ['2024-03']);

    expect([...(await readMonths(user, '||', ['2024-03'])).keys()]).toEqual(['2024-03']);
    expect((await readMonths(user, '||', ['2024-04', '2024-02'])).size).toBe(0);
  });

  it('namespaces by user and by filter key', async () => {
    await seed('cache-user-a', '|true|', '2024-03');
    await seed('cache-user-b', '|true|', '2024-03');

    expect((await readMonths('cache-user-a', '|true|', ['2024-03'])).size).toBe(1);
    expect((await readMonths('cache-user-b', '|true|', ['2024-03'])).size).toBe(1);
    // another account on this browser sees nothing
    expect((await readMonths('cache-user-c', '|true|', ['2024-03'])).size).toBe(0);
    // same account, different filters
    expect((await readMonths('cache-user-a', '||', ['2024-03'])).size).toBe(0);
    // no user id → its own memory-only namespace
    expect((await readMonths(undefined, '|true|', ['2024-03'])).size).toBe(0);

    await seed(undefined, 'person-1||', '2024-03');
    expect((await readMonths(undefined, 'person-1||', ['2024-03'])).size).toBe(1);
    expect((await readMonths('cache-user-a', 'person-1||', ['2024-03'])).size).toBe(0);
  });

  it('prune never crosses users', async () => {
    await seed('prune-user-a', '||', '2024-01');
    await seed('prune-user-b', '||', '2024-01');
    await pruneExcept('prune-user-a', '||', []);
    expect((await readMonths('prune-user-a', '||', ['2024-01'])).size).toBe(0);
    expect((await readMonths('prune-user-b', '||', ['2024-01'])).size).toBe(1);
  });

  it('falls back to memory and never throws when IndexedDB is broken', async () => {
    vi.stubGlobal('indexedDB', {
      open: () => {
        throw new Error('blocked');
      },
    });
    const user = 'cache-broken-idb';
    await expect(seed(user, '||', '2024-03')).resolves.toBeUndefined();
    const found = await readMonths(user, '||', ['2024-03']);
    expect(found.get('2024-03')?.version).toBe('v1');
    await expect(pruneExcept(user, '||', ['2024-03'])).resolves.toBeUndefined();
  });
});
