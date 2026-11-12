import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from 'typeorm';
import { Asset } from '../database/entities';
import { BackupRunItem } from './entities/backup-run-item.entity';
import { BULK_CHUNK, bulkInsert, bulkSave, chunked } from './user-backup.service';

describe('chunked', () => {
  it('splits 2500 ids into 3 ordered groups without loss', () => {
    const ids = Array.from({ length: 2500 }, (_, i) => `id-${i}`);
    const groups = chunked(ids);
    expect(groups.map((group) => group.length)).toEqual([1000, 1000, 500]);
    expect(groups.flat()).toEqual(ids);
  });

  it('keeps a short list in one group and an empty one in none', () => {
    expect(chunked(['a', 'b'])).toEqual([['a', 'b']]);
    expect(chunked([])).toEqual([]);
  });
});

describe('bulkSave', () => {
  it('always passes the chunk size — an unchunked save is one INSERT past the bind cap', async () => {
    const save = vi.fn().mockResolvedValue([]);
    const rows = [{ id: 'asset-1' }] as unknown as Asset[];

    await bulkSave({ save } as unknown as EntityManager, Asset, rows);

    expect(BULK_CHUNK).toBe(500);
    expect(save).toHaveBeenCalledWith(Asset, rows, { chunk: 500 });
  });
});

describe('bulkInsert', () => {
  it('splits 1200 rows into 3 ordered inserts without loss', async () => {
    const insert = vi.fn().mockResolvedValue({});
    const rows = Array.from({ length: 1200 }, (_, i) => ({ id: `row-${i}` }));

    await bulkInsert({ insert } as unknown as EntityManager, BackupRunItem, rows);

    expect(insert).toHaveBeenCalledTimes(3);
    const groups = insert.mock.calls.map(([, group]) => group as { id: string }[]);
    expect(groups.map((group) => group.length)).toEqual([500, 500, 200]);
    expect(groups.flat().map((row) => row.id)).toEqual(rows.map((row) => row.id));
  });

  it('issues no insert for an empty list', async () => {
    const insert = vi.fn().mockResolvedValue({});

    await bulkInsert({ insert } as unknown as EntityManager, BackupRunItem, []);

    expect(insert).not.toHaveBeenCalled();
  });
});
