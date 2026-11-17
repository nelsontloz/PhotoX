import { PersonsService } from './persons.service';

function chain(result: unknown) {
  const qb = {
    innerJoin: vi.fn(),
    select: vi.fn(),
    where: vi.fn(),
    andWhere: vi.fn(),
    getRawOne: vi.fn(() => Promise.resolve(result)),
  } as unknown as {
    innerJoin: (...args: unknown[]) => unknown;
    select: (...args: unknown[]) => unknown;
    where: (...args: unknown[]) => unknown;
    andWhere: (...args: unknown[]) => unknown;
    getRawOne: () => Promise<unknown>;
  };
  const self = qb as unknown as Record<string, { mockReturnValue: (v: unknown) => unknown }>;
  self.innerJoin!.mockReturnValue(qb);
  self.select!.mockReturnValue(qb);
  self.where!.mockReturnValue(qb);
  self.andWhere!.mockReturnValue(qb);
  return qb;
}

function makeService(countResult: { count: string }) {
  const person = {
    id: 'person-1',
    userId: 'u1',
    name: 'Old',
    coverFaceId: null,
    clusterLabel: null,
    faceCount: 7,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-01T00:00:00.000Z'),
  };
  const personRepo = {
    findOne: vi.fn(() => Promise.resolve({ ...person })),
    save: vi.fn((row: unknown) => Promise.resolve(row)),
  };
  const qb = chain(countResult);
  const faceRepo = { createQueryBuilder: vi.fn(() => qb) };
  const service = new PersonsService(personRepo as never, faceRepo as never, {} as never);
  return { service, personRepo, faceRepo, qb };
}

describe('PersonsService.update live count (C4)', () => {
  it('returns the live non-trashed count, not the stored faceCount', async () => {
    const { service } = makeService({ count: '0' });
    const res = await service.update('u1', 'person-1', 'New');
    // stored row had faceCount 7; live count is 0 after its asset was trashed/deleted
    expect(res.faceCount).toBe(0);
  });

  it('reflects the live count when faces remain', async () => {
    const { service } = makeService({ count: '3' });
    const res = await service.update('u1', 'person-1', 'New');
    expect(res.faceCount).toBe(3);
  });
});

function makeListService(pageRows: Record<string, unknown>[]) {
  const query = vi.fn((sql: string) =>
    Promise.resolve(sql.includes('COUNT(*) OVER') ? pageRows : []),
  );
  const count = vi.fn(() => Promise.resolve(9));
  const service = new PersonsService({ query, count } as never, {} as never, {} as never);
  return { service, count };
}

describe('PersonsService.list total', () => {
  it('reads the whole-set total off the page query', async () => {
    const { service, count } = makeListService([
      {
        id: 'p1',
        userId: 'u1',
        name: null,
        coverFaceId: null,
        clusterLabel: null,
        faceCount: 4,
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: new Date('2024-01-01T00:00:00.000Z'),
        totalCount: '5',
      },
    ]);
    const res = await service.list('u1');
    expect(res.total).toBe(5);
    expect(count).not.toHaveBeenCalled();
    // the window column stays out of the wire row
    expect(res.items[0]).not.toHaveProperty('totalCount');
    expect(res.items[0]!.createdAt).toBe('2024-01-01T00:00:00.000Z');
  });

  it('counts when the page is empty (offset past the end)', async () => {
    const { service, count } = makeListService([]);
    const res = await service.list('u1', 20, 40);
    expect(res).toEqual({ items: [], total: 9 });
    expect(count).toHaveBeenCalled();
  });
});
