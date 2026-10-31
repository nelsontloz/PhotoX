import { GroupsService } from './groups.service';

function makeService(queryResult: { id: string }[] = []) {
  let capturedSql = '';
  const dataSource = {
    query: vi.fn((sql: string) => {
      capturedSql = sql;
      return Promise.resolve(queryResult);
    }),
  };
  const assetRepo = { findOne: vi.fn(() => Promise.resolve({ id: 'asset-1', userId: 'u1' })) };
  const assets = {
    listByIdsRanked: vi.fn((_userId: string, ids: string[]) =>
      Promise.resolve(ids.map((id) => ({ id }))),
    ),
  };
  const service = new GroupsService(
    dataSource as never,
    assets as never,
    assetRepo as never,
    {} as never,
  );
  return { service, dataSource, assets, captured: () => capturedSql };
}

function makeSimilarService(annRows: { id: string }[], fallbackRows: { id: string }[] = []) {
  const statements: string[] = [];
  const em = {
    query: vi.fn((sql: string) => {
      statements.push(sql);
      return Promise.resolve(sql.includes('set_config') ? [] : annRows);
    }),
  };
  const dataSource = {
    transaction: vi.fn((run: (e: unknown) => unknown) => run(em)),
    query: vi.fn((sql: string) => {
      statements.push(sql);
      return Promise.resolve(fallbackRows);
    }),
  };
  const assetRepo = { findOne: vi.fn(() => Promise.resolve({ id: 'asset-1', userId: 'u1' })) };
  const embeddingRepo = {
    findOne: vi.fn(() => Promise.resolve({ assetId: 'asset-1', embedding: [1, 0] })),
  };
  const service = new GroupsService(
    dataSource as never,
    {
      listByIdsRanked: vi.fn((_userId: string, ids: string[]) =>
        Promise.resolve(ids.map((id) => ({ id }))),
      ),
    } as never,
    assetRepo as never,
    embeddingRepo as never,
  );
  return { service, statements, dataSource };
}

describe('GroupsService.similar owner filter vs the global HNSW index', () => {
  // The index spans every user and pgvector filters after the scan, so another user's identical
  // vectors filled the ef_search window and the endpoint answered { items: [], total: 0 } for an
  // owner that had a neighbour (the flaky "More like this" e2e tray). A short ANN page must be
  // completed by the exact per-owner scan — and that scan must not be ordered by the index.
  it('completes a short ANN page with an exact owner scan', async () => {
    const { service, statements, dataSource } = makeSimilarService([], [{ id: 'own' }]);
    const res = await service.similar('u1', 'asset-1', {});
    expect(res.items).toEqual([{ id: 'own' }]);
    expect(dataSource.query).toHaveBeenCalledTimes(1);
    expect(statements.at(-1)).toMatch(/ORDER BY .*\+ 0/);
  });

  it('keeps the ANN page when it is full', async () => {
    const annRows = Array.from({ length: 12 }, (_, i) => ({ id: `near-${i}` }));
    const { service, dataSource } = makeSimilarService(annRows);
    const res = await service.similar('u1', 'asset-1', {});
    expect(res.total).toBe(12);
    expect(dataSource.query).not.toHaveBeenCalled();
  });
});

describe('GroupsService.duplicates bound (C7-limit-only)', () => {
  it('bounds the SQL with LIMIT 200', async () => {
    const { service, captured } = makeService([]);
    await service.duplicates('u1', 'asset-1', {});
    expect(captured()).toMatch(/LIMIT 200/i);
  });

  it('caps total at the bounded row count', async () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ id: `dup-${i}` }));
    const { service, assets } = makeService(rows);
    const res = await service.duplicates('u1', 'asset-1', { threshold: 10 });
    expect(res.total).toBe(200);
    expect(res.items).toHaveLength(200);
    expect(assets.listByIdsRanked).toHaveBeenCalledWith(
      'u1',
      rows.map((r) => r.id),
    );
  });
});
